import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C, cardColor, isWager } from '../engine/cards.js';
import { applyMove, legalMoves, newRound, DECK, DISCARD, EXPEDITION } from '../engine/rules.js';
import { observe } from '../engine/observation.js';
import { Game } from '../engine/game.js';
import { legalMovesFromObservation } from '../engine/observation.js';
import { mulberry32 } from '../engine/rng.js';
import { greedyMove } from '../engine/policy.js';
import { evaluateState } from '../engine/evaluate.js';
import { createMctsAgent, playKey } from '../engine/agents/mcts.js';
import { createRandomAgent } from '../engine/agents/random.js';
import { mirrorMatch } from '../engine/eval.js';
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

const sameMove = (a, b) =>
  (a.card === b.card || (isWager(a.card) && isWager(b.card) && cardColor(a.card) === cardColor(b.card))) &&
  a.target === b.target && a.draw === b.draw;

test('탐욕 정책은 항상 합법수를 냄', () => {
  const out = {};
  for (let seed = 0; seed < 300; seed++) {
    const s = randomPosition(seed, seed % 100);
    if (s.over) continue;
    const p = s.current;
    greedyMove(s.hands[p], s.expeditions[p], s.expeditions[1 - p], s.discards, s.deck.length, out);
    assert.ok(legalMoves(s).some((m) => sameMove(m, out)), `seed ${seed}: ${JSON.stringify(out)}`);
  }
});

test('playKey: 같은 색 투자 카드는 같은 키, 대상이 다르면 다른 키', () => {
  assert.equal(playKey(C(2, 0, 0), EXPEDITION), playKey(C(2, 0, 2), EXPEDITION));
  assert.notEqual(playKey(C(2, 0, 0), EXPEDITION), playKey(C(2, 0, 0), DISCARD));
  assert.notEqual(playKey(C(2, 0, 0), EXPEDITION), playKey(C(3, 0, 0), EXPEDITION));
  assert.notEqual(playKey(C(2, 5), DISCARD), playKey(C(2, 6), DISCARD));
});

test('정적 평가: 종료 상태는 정확한 점수 차, 시점을 바꾸면 부호만 바뀜', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = randomPosition(seed, 1000);
    assert.equal(s.over, true);
    const sc = scores(s);
    assert.equal(evaluateState(s, 0), sc[0].total - sc[1].total);
  }
  for (let seed = 0; seed < 50; seed++) {
    const s = randomPosition(seed, seed % 60);
    assert.ok(Math.abs(evaluateState(s, 0) + evaluateState(s, 1)) < 1e-9);
  }
});

test('MCTS: 합법수 안에서 고르고, 관측을 바꾸지 않고, 같은 시드면 같은 수', () => {
  for (let seed = 0; seed < 5; seed++) {
    const game = new Game({ seed });
    for (let t = 0; t < seed * 3; t++) {
      const o = game.observe(game.current);
      game.play(legalMovesFromObservation(o)[0]);
    }
    const obs = game.observe(game.current);
    const before = JSON.stringify(obs);
    const moves = legalMovesFromObservation(obs);
    const a = createMctsAgent(7, { iterations: 300 }).chooseMove(obs, moves);
    const b = createMctsAgent(7, { iterations: 300 }).chooseMove(obs, moves);
    assert.ok(moves.includes(a));
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(obs), before);
  }
});

test('MCTS: 시간 상한을 지킴', () => {
  const game = new Game({ seed: 1 });
  const obs = game.observe(game.current);
  const agent = createMctsAgent(1, { iterations: 1e9, timeMs: 50 });
  const t0 = Date.now();
  agent.chooseMove(obs, legalMovesFromObservation(obs));
  assert.ok(Date.now() - t0 < 500);
  assert.ok(agent.lastStats.iterations > 0);
});

test('MCTS가 랜덤 AI를 확실히 이김 (미러 6쌍, 반복 200)', () => {
  const r = mirrorMatch((s) => createMctsAgent(s, { iterations: 200 }), (s) => createRandomAgent(s), { pairs: 6, seed: 3 });
  assert.ok(r.diff.lo > 50, `diff CI ${r.diff.lo}..${r.diff.hi}`);
});
