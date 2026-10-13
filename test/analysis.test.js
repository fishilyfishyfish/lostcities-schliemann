import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C, cardColor, isWager } from '../engine/cards.js';
import { applyMove, legalMoves, newRound, DECK, DISCARD, EXPEDITION } from '../engine/rules.js';
import { observe, legalMovesFromObservation } from '../engine/observation.js';
import { expeditionScore } from '../engine/scoring.js';
import { mulberry32 } from '../engine/rng.js';
import { analyzeMoves, cardTracker, compareMoves, expeditionBreakdown, scoreBreakdown, CARD_STATUS } from '../engine/analysis.js';
import { createMctsAgent } from '../engine/agents/mcts.js';

function randomPosition(seed, n) {
  const s = newRound({ seed, startingPlayer: seed % 2 });
  const rng = mulberry32(seed);
  for (let i = 0; i < n && !s.over; i++) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(rng() * moves.length)]);
  }
  return s;
}

test('카드 추적표: 위치가 실제와 일치하고 미확인 = 덱 + 상대 미공개 손패', () => {
  for (let seed = 0; seed < 100; seed++) {
    const s = randomPosition(seed, (seed * 3) % 120);
    for (const p of [0, 1]) {
      const obs = observe(s, p);
      const t = cardTracker(obs);
      const known = new Set(obs.opponentKnownCards);
      for (const c of s.hands[p]) assert.equal(t.status[c], CARD_STATUS.MY_HAND);
      for (const c of s.expeditions[p].flat()) assert.equal(t.status[c], CARD_STATUS.MY_EXPEDITION);
      for (const c of s.expeditions[1 - p].flat()) assert.equal(t.status[c], CARD_STATUS.OPP_EXPEDITION);
      for (const c of s.discards.flat()) assert.equal(t.status[c], CARD_STATUS.DISCARD);
      for (const c of s.deck) assert.equal(t.status[c], CARD_STATUS.UNSEEN);
      for (const c of s.hands[1 - p]) assert.equal(t.status[c], known.has(c) ? CARD_STATUS.OPP_HAND_KNOWN : CARD_STATUS.UNSEEN);
      assert.equal(t.unseenTotal, s.deck.length + s.hands[1 - p].length - known.size);
      assert.equal(t.unseenByColor.reduce((a, b) => a + b, 0), t.unseenTotal);
      for (let c = 0; c < 5; c++) {
        assert.equal(t.unseenNumbersByColor[c].length + t.unseenWagersByColor[c], t.unseenByColor[c]);
        const top = s.discards[c].at(-1);
        if (top !== undefined) assert.equal(t.discardTop[top], true);
      }
    }
  }
});

test('점수 내역: 합계가 expeditionScore와 같고 항목이 맞음', () => {
  const b = expeditionBreakdown([C(1, 0, 0), C(1, 0, 1), C(1, 2), C(1, 3), C(1, 4), C(1, 5), C(1, 6), C(1, 7)]);
  assert.deepEqual(b, { started: true, count: 8, sum: 27, wagers: 2, cost: -20, base: 7, multiplier: 3, bonus: 20, total: 41 });
  assert.equal(expeditionBreakdown([]).total, 0);
  assert.equal(expeditionBreakdown([]).cost, 0);
  assert.equal(expeditionBreakdown([C(0, 0, 0)]).total, -40);
  for (let seed = 0; seed < 50; seed++) {
    const s = randomPosition(seed, 200);
    const obs = observe(s, 0);
    const [me, opp] = scoreBreakdown(obs);
    for (let c = 0; c < 5; c++) {
      assert.equal(me.colors[c].total, expeditionScore(s.expeditions[0][c]));
      assert.equal(opp.colors[c].total, expeditionScore(s.expeditions[1][c]));
    }
    assert.equal(me.total, obs.scores[0].total);
  }
});

test('수 분석: 합법수 전부에 대해 결과, 탐색한 수는 기대값과 오차, 관측 불변', () => {
  const s = randomPosition(4, 20);
  const obs = observe(s, s.current);
  const before = JSON.stringify(obs);
  const r = analyzeMoves(obs, { timeMs: 0, iterations: 1500, topK: 4 });
  const legal = legalMovesFromObservation(obs);
  assert.equal(r.moves.length, legal.length);
  assert.equal(r.iterations, 1500);
  const searched = r.moves.filter((m) => m.expected !== null);
  assert.ok(searched.length >= 1 && searched.length <= 4);
  for (const m of searched) {
    assert.ok(Number.isFinite(m.expected));
    assert.ok(m.visits > 0);
  }
  for (let i = 1; i < r.moves.length; i++) assert.ok(r.moves[i - 1].visits >= r.moves[i].visits);
  assert.equal(JSON.stringify(obs), before);
  // 상대 차례 관측에서는 빈 결과
  assert.deepEqual(analyzeMoves(observe(s, 1 - s.current), { timeMs: 0, iterations: 10 }).moves, []);
});

test('수 분석: 점수가 확실히 오르는 수를 최선으로 봄', () => {
  // 양쪽 탐험대 맨 위가 높아서 남은 카드는 누구도 놓을 수 없다. 내 손의 빨강 10만 빨강 9 위에 놓을 수 있다.
  // 지금 놓으면 +15, 안 놓으면 상대가 끝내서 +5.
  const [Y, B, W, G, R] = [0, 1, 2, 3, 4];
  const myExps = [[C(Y, 10)], [C(B, 10)], [C(W, 10)], [C(G, 10)], [C(R, 9)]];
  const oppExps = [[C(Y, 9)], [C(B, 9)], [C(W, 9)], [C(G, 9)], [C(R, 8)]];
  const hand0 = [C(R, 10), C(Y, 2), C(Y, 3), C(B, 2), C(B, 3), C(W, 2), C(W, 3), C(G, 2)];
  const hand1 = [C(Y, 4), C(Y, 5), C(B, 4), C(B, 5), C(W, 4), C(W, 5), C(G, 3), C(G, 4)];
  const used = new Set([...myExps.flat(), ...oppExps.flat(), ...hand0, ...hand1]);
  const rest = [];
  for (let i = 0; i < 60; i++) if (!used.has(i)) rest.push(i);
  const deck = rest.splice(0, 1); // 덱 1장: 지금 안 놓으면 상대가 덱을 뽑아 라운드를 끝낼 수 있다
  const discards = [[], [], [], [], []];
  for (const c of rest) discards[cardColor(c)].push(c);
  const s = {
    deck, hands: [hand0, hand1],
    expeditions: [myExps, oppExps],
    discards, current: 0, startingPlayer: 0, turn: 0, over: false, history: [],
  };
  const r = analyzeMoves(observe(s, 0), { timeMs: 0, iterations: 4000, topK: 0 });
  const best = r.moves[0];
  assert.equal(best.move.card, C(R, 10));
  assert.equal(best.move.target, EXPEDITION);
  const discardR10 = r.moves.find((m) => m.move.card === C(R, 10) && m.move.target === DISCARD && m.expected !== null);
  if (discardR10) assert.ok(best.expected > discardR10.expected + 5);
});

test('수읽기 비교: 색별 항목의 합 = 기대 점수 차이', () => {
  for (const seed of [2, 9, 13]) {
    const s = randomPosition(seed, 24);
    if (s.over) continue;
    const obs = observe(s, s.current);
    const agent = createMctsAgent(seed, { iterations: 3000, topK: 4 });
    const { moves } = agent.analyze(obs, legalMovesFromObservation(obs));
    const searched = moves.filter((m) => m.expected !== null && m.colorEffect);
    for (let i = 1; i < searched.length; i++) {
      const a = searched[0], b = searched[i];
      const { terms, total, rest, pros, cons } = compareMoves(a, b);
      const sum = terms.reduce((t, x) => t + x.value, 0);
      assert.ok(Math.abs(sum - (a.expected - b.expected)) < 1e-6, `${sum} vs ${a.expected - b.expected}`);
      assert.ok(Math.abs(total - sum) < 1e-9);
      // 보여준 항목 + 나머지 = 합계
      const shown = terms.filter((t) => [...pros, ...cons].some((x) => x.startsWith(t.text))).reduce((x, t) => x + t.value, 0);
      assert.ok(Math.abs(shown + rest - total) < 1e-6);
    }
  }
});

test('분석 결과: 1위는 2위와, 나머지는 1위와 비교한 장단점이 있음', () => {
  const s = randomPosition(7, 30);
  const obs = observe(s, s.current);
  const r = analyzeMoves(obs, { timeMs: 0, iterations: 3000, topK: 5 });
  const ranked = r.moves.filter((m) => m.rank);
  assert.equal(ranked[0].rank, 1);
  for (const m of ranked) {
    assert.ok(m.versus, `rank ${m.rank}`);
    assert.equal(m.versus.rank, m.rank === 1 ? 2 : 1);
    assert.ok(m.gap >= 0);
  }
  assert.ok(r.position && r.weights);
});
