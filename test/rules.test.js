import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C, cardColor, HAND_SIZE } from '../engine/cards.js';
import { applyMove, canPlace, cloneState, legalMoves, moveError, newRound, EXPEDITION, DISCARD, DECK } from '../engine/rules.js';
import { makeState } from './helpers.js';

const Y = 0, B = 1, W = 2, G = 3, R = 4;

test('새 라운드: 60장, 손패 8장씩, 덱 44장, 중복 없음', () => {
  const s = newRound({ seed: 42 });
  assert.equal(s.hands[0].length, HAND_SIZE);
  assert.equal(s.hands[1].length, HAND_SIZE);
  assert.equal(s.deck.length, 44);
  const all = new Set([...s.deck, ...s.hands[0], ...s.hands[1]]);
  assert.equal(all.size, 60);
});

test('같은 시드 → 같은 배분, 덱 지정 가능', () => {
  assert.deepEqual(newRound({ seed: 7 }), newRound({ seed: 7 }));
  const deck = Array.from({ length: 60 }, (_, i) => i);
  const s = newRound({ deck, startingPlayer: 1 });
  assert.deepEqual(s.hands[1], [59, 57, 55, 53, 51, 49, 47, 45]);
  assert.equal(s.current, 1);
  assert.throws(() => newRound({ deck: deck.slice(1) }));
});

test('오름차순 위반은 탐험대에 놓을 수 없음', () => {
  assert.equal(canPlace([C(R, 5)], C(R, 3)), false);
  assert.equal(canPlace([C(R, 5)], C(R, 6)), true);
  const s = makeState({ hands: [[C(R, 3), C(R, 9)], []], expeditions: [[[], [], [], [], [C(R, 5)]], [[], [], [], [], []]] });
  assert.match(moveError(s, { card: C(R, 3), target: EXPEDITION, draw: DECK }), /ascending/);
  assert.throws(() => applyMove(cloneState(s), { card: C(R, 3), target: EXPEDITION, draw: DECK }), /illegal/);
  const moves = legalMoves(s);
  assert.ok(!moves.some((m) => m.card === C(R, 3) && m.target === EXPEDITION));
  assert.ok(moves.some((m) => m.card === C(R, 3) && m.target === DISCARD));
  assert.ok(moves.some((m) => m.card === C(R, 9) && m.target === EXPEDITION));
});

test('숫자 카드 뒤 투자 카드 금지, 투자 뒤 투자는 허용', () => {
  assert.equal(canPlace([C(G, 2)], C(G, 0, 0)), false);
  assert.equal(canPlace([C(G, 0, 0)], C(G, 0, 1)), true);
  assert.equal(canPlace([C(G, 0, 0), C(G, 0, 1)], C(G, 2)), true);
  const s = makeState({ hands: [[C(G, 0, 1)], []], expeditions: [[[], [], [], [C(G, 4)], []], [[], [], [], [], []]] });
  assert.match(moveError(s, { card: C(G, 0, 1), target: EXPEDITION, draw: DECK }), /wager/);
  assert.ok(!legalMoves(s).some((m) => m.target === EXPEDITION));
});

test('상대 탐험대 상태는 내 놓기에 영향 없음', () => {
  const s = makeState({ hands: [[C(B, 2)], []], expeditions: [[[], [], [], [], []], [[], [C(B, 9)], [], [], []]] });
  assert.equal(moveError(s, { card: C(B, 2), target: EXPEDITION, draw: DECK }), null);
});

test('방금 버린 카드는 바로 다시 가져올 수 없음', () => {
  const s = makeState({ hands: [[C(W, 5), C(Y, 3)], []], discards: [[C(Y, 7)], [], [C(W, 2)], [], []] });
  // 하양에 버리고 하양 더미에서 뽑기 금지
  assert.match(moveError(s, { card: C(W, 5), target: DISCARD, draw: W }), /just discarded/);
  // 하양에 버리고 다른 더미나 덱은 가능
  assert.equal(moveError(s, { card: C(W, 5), target: DISCARD, draw: Y }), null);
  assert.equal(moveError(s, { card: C(W, 5), target: DISCARD, draw: DECK }), null);
  // 하양 카드를 탐험대에 놓으면 하양 더미에서 뽑기 가능
  assert.equal(moveError(s, { card: C(W, 5), target: EXPEDITION, draw: W }), null);
  // 빈 더미에서 뽑기 불가
  assert.match(moveError(s, { card: C(W, 5), target: EXPEDITION, draw: B }), /empty/);
  const moves = legalMoves(s);
  assert.ok(!moves.some((m) => m.target === DISCARD && m.draw === cardColor(m.card)));
  assert.ok(moves.some((m) => m.card === C(Y, 3) && m.target === DISCARD && m.draw === W));
});

test('빈 더미에 버리고 같은 더미에서 뽑기도 금지 (뽑을 수 있는 건 방금 버린 카드뿐)', () => {
  const s = makeState({ hands: [[C(W, 5)], []] });
  assert.match(moveError(s, { card: C(W, 5), target: DISCARD, draw: W }), /just discarded/);
});

test('상대가 지난 차례 버린 카드는 가져올 수 있음', () => {
  const s = makeState({ hands: [[C(Y, 2)], [C(B, 4)]] });
  applyMove(s, { card: C(Y, 2), target: DISCARD, draw: DECK });
  assert.equal(s.current, 1);
  applyMove(s, { card: C(B, 4), target: EXPEDITION, draw: Y });
  assert.ok(s.hands[1].includes(C(Y, 2)));
});

test('합법수 = 놓기/버리기 × 뽑기 조합, 투자 카드 중복 제거', () => {
  const s = makeState({
    hands: [[C(Y, 0, 0), C(Y, 0, 1), C(B, 5)], []],
    discards: [[], [C(B, 2)], [], [C(G, 3)], []],
  });
  const moves = legalMoves(s);
  // Y 투자 (한 장으로 취급): 놓기(덱, B, G) 3 + 버리기(덱, B, G) 3 = 6
  // B5: 놓기(덱, B, G) 3 + 버리기(덱, G) 2 = 5
  assert.equal(moves.length, 11);
  assert.ok(moves.every((m) => m.card !== C(Y, 0, 1)));
  // 생성하지 않은 동등한 투자 카드도 applyMove는 받는다
  assert.equal(moveError(s, { card: C(Y, 0, 1), target: EXPEDITION, draw: DECK }), null);
  const keys = new Set(moves.map((m) => `${m.card}/${m.target}/${m.draw}`));
  assert.equal(keys.size, moves.length);
});

test('합법수는 모두 적용 가능하고, 생성되지 않은 수는 불법이거나 동등한 투자 카드', () => {
  for (let seed = 0; seed < 30; seed++) {
    const s = newRound({ seed });
    for (let t = 0; t < 10; t++) {
      const moves = legalMoves(s);
      for (const m of moves) assert.equal(moveError(s, m), null);
      applyMove(s, moves[(seed * 7 + t) % moves.length]);
    }
  }
});

test('손에 없는 카드, 잘못된 대상/뽑기는 거부', () => {
  const s = makeState({ hands: [[C(Y, 2)], [C(B, 3)]] });
  assert.match(moveError(s, { card: C(B, 3), target: DISCARD, draw: DECK }), /not in hand/);
  assert.match(moveError(s, { card: C(Y, 2), target: 'table', draw: DECK }), /target/);
  assert.match(moveError(s, { card: C(Y, 2), target: DISCARD, draw: 9 }), /draw/);
  assert.match(moveError(s, null), /object/);
});

test('덱의 마지막 장을 뽑는 순간 라운드 종료', () => {
  const s = makeState({ hands: [[C(Y, 2)], [C(B, 3)]], deck: [C(R, 10), C(R, 9)] });
  applyMove(s, { card: C(Y, 2), target: DISCARD, draw: DECK });
  assert.equal(s.over, false);
  assert.equal(s.deck.length, 1);
  applyMove(s, { card: C(B, 3), target: EXPEDITION, draw: Y });
  assert.equal(s.over, false, '버림 더미에서 뽑으면 덱이 줄지 않는다');
  applyMove(s, { card: C(R, 9), target: EXPEDITION, draw: DECK });
  assert.equal(s.over, true);
  assert.equal(s.deck.length, 0);
  assert.deepEqual(legalMoves(s), []);
  assert.match(moveError(s, { card: C(R, 10), target: DISCARD, draw: DECK }), /over/);
});

test('랜덤 대국 불변식: 카드 보존, 손패 8장, 오름차순, 종료', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = newRound({ seed, startingPlayer: seed % 2 });
    let rng = seed + 1;
    while (!s.over) {
      const moves = legalMoves(s);
      assert.ok(moves.length > 0);
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      applyMove(s, moves[rng % moves.length]);
      assert.equal(s.hands[0].length, 8);
      assert.equal(s.hands[1].length, 8);
      const all = [...s.deck, ...s.hands.flat(), ...s.expeditions.flat(2), ...s.discards.flat()];
      assert.equal(all.length, 60);
      assert.equal(new Set(all).size, 60);
      assert.ok(s.turn < 2000);
    }
    for (const p of s.expeditions) for (const e of p) {
      for (let i = 1; i < e.length; i++) assert.ok(canPlace(e.slice(0, i), e[i]));
    }
  }
});
