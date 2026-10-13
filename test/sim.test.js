import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, cloneState, legalMoves, newRound, DECK } from '../engine/rules.js';
import { observe } from '../engine/observation.js';
import { cloneSimState, determinize, randomPlayout, simStep, totalScore, unseenCards } from '../engine/sim.js';
import { mulberry32 } from '../engine/rng.js';
import { scores } from '../engine/rules.js';

function randomPosition(seed, n) {
  const s = newRound({ seed, startingPlayer: seed % 2 });
  const rng = mulberry32(seed);
  for (let i = 0; i < n && !s.over; i++) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(rng() * moves.length)]);
  }
  return s;
}

test('보이지 않는 카드 = 덱 + 상대의 미공개 손패', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = randomPosition(seed, seed * 2);
    const obs = observe(s, 0);
    const known = new Set(obs.opponentKnownCards);
    const expected = [...s.deck, ...s.hands[1].filter((c) => !known.has(c))].sort((a, b) => a - b);
    assert.deepEqual(unseenCards(obs), expected);
  }
});

test('결정화한 상태를 다시 관측하면 원래 관측과 같음', () => {
  for (let seed = 0; seed < 100; seed++) {
    const s = randomPosition(seed, (seed * 7) % 90);
    for (const p of [0, 1]) {
      const obs = observe(s, p);
      const rng = mulberry32(seed * 31 + p);
      for (let k = 0; k < 3; k++) {
        const d = determinize(obs, rng, { withHistory: true });
        assert.deepEqual(observe(d, p), obs);
        // 상대가 들고 있다고 알려진 카드는 항상 상대 손패에
        for (const c of obs.opponentKnownCards) assert.ok(d.hands[1 - p].includes(c));
        const all = [...d.deck, ...d.hands.flat(), ...d.expeditions.flat(2), ...d.discards.flat()];
        assert.equal(new Set(all).size, 60);
      }
    }
  }
});

test('결정화는 숨은 카드를 실제로 섞음 (실제 상태를 베끼지 않음)', () => {
  const s = randomPosition(5, 10);
  const obs = observe(s, 0);
  const rng = mulberry32(1);
  const hands = new Set();
  for (let i = 0; i < 20; i++) hands.add(determinize(obs, rng).hands[1].slice().sort((a, b) => a - b).join(','));
  assert.ok(hands.size > 15);
});

test('일관되지 않은 관측은 거부', () => {
  const obs = observe(newRound({ seed: 1 }), 0);
  assert.throws(() => determinize({ ...obs, deckCount: 10 }, mulberry32(1)), /inconsistent/);
});

test('simStep 결과 = applyMove 결과 (기록 제외)', () => {
  for (let seed = 0; seed < 50; seed++) {
    const a = randomPosition(seed, 15);
    if (a.over) continue;
    const b = cloneSimState(a);
    const moves = legalMoves(a);
    const m = moves[seed % moves.length];
    applyMove(a, m);
    simStep(b, m.card, m.target, m.draw);
    const norm = (s) => ({ ...s, hands: s.hands.map((h) => h.slice().sort((x, y) => x - y)), history: [] });
    assert.deepEqual(norm(b), norm(a));
  }
});

test('무작위 플레이아웃: 끝까지 진행, 카드 보존, 점수 일치', () => {
  const rng = mulberry32(9);
  for (let seed = 0; seed < 200; seed++) {
    const s = newRound({ seed });
    const result = randomPlayout(s, rng);
    assert.equal(s.over, true);
    const all = [...s.deck, ...s.hands.flat(), ...s.expeditions.flat(2), ...s.discards.flat()];
    assert.equal(new Set(all).size, 60);
    assert.deepEqual(result, scores(s).map((x) => x.total));
    assert.equal(result[0], totalScore(s.expeditions[0]));
  }
});

test('플레이아웃은 결정화한 복사본만 바꿈', () => {
  const s = randomPosition(3, 20);
  const before = JSON.stringify(s);
  const obs = observe(s, s.current);
  randomPlayout(determinize(obs, mulberry32(2)), mulberry32(3));
  assert.equal(JSON.stringify(s), before);
});
