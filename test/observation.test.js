import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C } from '../engine/cards.js';
import { applyMove, cloneState, legalMoves, newRound, DECK, DISCARD, EXPEDITION } from '../engine/rules.js';
import { legalMovesFromObservation, observe } from '../engine/observation.js';
import { Game, playRound } from '../engine/game.js';
import { mulberry32 } from '../engine/rng.js';
import * as api from '../engine/index.js';

const Y = 0, B = 1, W = 2, G = 3, R = 4;

function randomPlay(s, n, seed) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n && !s.over; i++) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(rng() * moves.length)]);
  }
  return s;
}

/** 관측 객체 안의 모든 카드 id (카드가 들어가는 필드만). */
function cardsIn(obs) {
  const out = [...obs.hand, ...obs.myExpeditions.flat(), ...obs.oppExpeditions.flat(), ...obs.discards.flat(), ...obs.opponentKnownCards];
  for (const h of obs.history) {
    out.push(h.card);
    if (h.drawnCard !== null) out.push(h.drawnCard);
  }
  return out;
}

test('관측 객체에 덱/상대 손패 필드가 없음', () => {
  const obs = observe(newRound({ seed: 1 }), 0);
  const keys = Object.keys(obs).sort();
  assert.deepEqual(keys, [
    'current', 'deckCount', 'discards', 'hand', 'history', 'myExpeditions', 'opponentHandCount',
    'opponentKnownCards', 'oppExpeditions', 'over', 'player', 'scores', 'startingPlayer', 'turn',
  ].sort());
  assert.equal(obs.deckCount, 44);
  assert.equal(obs.opponentHandCount, 8);
});

test('관측에 상대의 미공개 손패와 덱 카드가 전혀 나타나지 않음', () => {
  for (let seed = 0; seed < 100; seed++) {
    const s = randomPlay(newRound({ seed }), seed % 50, seed);
    for (const p of [0, 1]) {
      const obs = observe(s, p);
      const known = new Set(obs.opponentKnownCards);
      const hidden = new Set([...s.deck, ...s.hands[1 - p].filter((c) => !known.has(c))]);
      for (const c of cardsIn(obs)) assert.ok(!hidden.has(c), `seed ${seed}: hidden card ${c} leaked`);
      // 직렬화한 문자열 전체에도 덱 순서가 들어 있지 않은지 (덱 배열 자체가 없음)
      assert.ok(!JSON.stringify(obs).includes(JSON.stringify(s.deck)));
    }
  }
});

test('구별 불가능성: 상대 손패와 덱 순서만 다른 두 상태는 같은 관측을 냄', () => {
  for (let seed = 0; seed < 100; seed++) {
    const s1 = randomPlay(newRound({ seed }), 20 + (seed % 30), seed);
    if (s1.over) continue;
    const obs1 = observe(s1, 0);
    const known = new Set(obs1.opponentKnownCards);
    // 상대의 미공개 손패와 덱을 섞어 다시 나눈다
    const s2 = cloneState(s1);
    const oppUnknown = s2.hands[1].filter((c) => !known.has(c));
    const pool = [...oppUnknown, ...s2.deck];
    const rng = mulberry32(seed + 999);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    s2.hands[1] = [...s2.hands[1].filter((c) => known.has(c)), ...pool.slice(0, oppUnknown.length)];
    s2.deck = pool.slice(oppUnknown.length);
    // 기록에서 상대가 덱에서 뽑은 카드 값도 바꿔치기 (내부 기록에만 있는 비공개 정보)
    for (const h of s2.history) if (h.player === 1 && h.draw === DECK) h.drawnCard = -1;
    assert.notDeepEqual([s1.hands[1], s1.deck], [s2.hands[1], s2.deck]);
    assert.deepEqual(observe(s2, 0), obs1);
  }
});

test('관측 객체를 수정해도 게임 상태는 그대로', () => {
  const game = new Game({ seed: 3 });
  const obs = game.observe(0);
  const before = JSON.stringify(game.observe(0));
  obs.hand.length = 0;
  obs.myExpeditions[0].push(1);
  obs.discards[2].push(30);
  obs.deckCount = 0;
  assert.equal(JSON.stringify(game.observe(0)), before);
});

test('Game은 상태를 외부로 노출하지 않음', () => {
  const game = new Game({ seed: 5 });
  assert.deepEqual(Object.keys(game), []);
  assert.equal(JSON.stringify(game), '{}');
  assert.equal(game.state, undefined);
  assert.throws(() => game.revealHands(), /hidden/);
  const ownProps = Object.getOwnPropertyNames(Game.prototype).sort();
  assert.deepEqual(ownProps, ['constructor', 'current', 'deckCount', 'legalMoves', 'observe', 'over', 'play', 'revealHands', 'scores', 'toJSON', 'turn'].sort());
  // 공개 API에 전체 상태 함수(newRound/applyMove 등)는 없음
  for (const k of ['newRound', 'applyMove', 'cloneState', 'observe', 'legalMoves']) assert.equal(api[k], undefined, k);
});

test('러너는 에이전트에게 관측 객체와 합법수만 넘김', () => {
  const calls = [];
  const spy = (p) => ({
    chooseMove(...args) {
      calls.push({ p, args });
      return args[1][0];
    },
  });
  playRound([spy(0), spy(1)], { seed: 11 });
  assert.ok(calls.length > 0);
  for (const { p, args } of calls) {
    assert.equal(args.length, 2);
    const [obs, moves] = args;
    assert.equal(obs.player, p);
    assert.equal(obs.current, p);
    assert.deepEqual(moves, legalMovesFromObservation(obs));
    assert.equal(obs.deck, undefined);
    assert.equal(obs.hands, undefined);
  }
});

test('관측 기반 합법수 = 상태 기반 합법수', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = randomPlay(newRound({ seed }), seed, seed);
    if (s.over) continue;
    assert.deepEqual(legalMovesFromObservation(observe(s, s.current)), legalMoves(s));
    assert.deepEqual(legalMovesFromObservation(observe(s, 1 - s.current)), []);
  }
});

test('기록: 버림 더미에서 가져간 카드는 공개, 덱에서 뽑은 카드는 비공개', () => {
  const deck = [C(R, 10), C(R, 9), C(R, 8)];
  const hands = [[C(Y, 2), C(B, 5)], [C(W, 3), C(G, 4)]];
  const s = {
    deck, hands,
    expeditions: [[[], [], [], [], []], [[], [], [], [], []]],
    discards: [[], [], [], [], []],
    current: 0, startingPlayer: 0, turn: 0, over: false, history: [],
  };
  applyMove(s, { card: C(Y, 2), target: DISCARD, draw: DECK }); // p0 덱에서 R8
  applyMove(s, { card: C(W, 3), target: EXPEDITION, draw: Y }); // p1 Y2 회수
  const o0 = observe(s, 0);
  assert.equal(o0.history[0].drawnCard, null);
  assert.equal(o0.history[1].drawnCard, C(Y, 2));
  assert.deepEqual(o0.opponentKnownCards, [C(Y, 2)]);
  // 자기 시점 관측에서도 덱에서 뽑은 카드는 기록에 안 남는다 (손패로만 앎)
  const o1 = observe(s, 1);
  assert.equal(o1.history[0].drawnCard, null);
  assert.deepEqual(o1.opponentKnownCards, []);
  // 상대가 회수한 카드를 내면 known에서 빠짐
  applyMove(s, { card: C(B, 5), target: DISCARD, draw: DECK });
  applyMove(s, { card: C(Y, 2), target: EXPEDITION, draw: DECK });
  assert.deepEqual(observe(s, 0).opponentKnownCards, []);
  assert.equal(s.over, true);
});

test('라운드 종료 후에만 손패 공개', () => {
  const game = new Game({ seed: 8 });
  const agent = api.createRandomAgent(8);
  while (!game.over) {
    const obs = game.observe(game.current);
    game.play(agent.chooseMove(obs, legalMovesFromObservation(obs)));
  }
  const hands = game.revealHands();
  assert.equal(hands[0].length, 8);
  assert.deepEqual(hands[0], game.observe(0).hand);
});
