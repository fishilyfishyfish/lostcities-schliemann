import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meanCI, mirrorMatch, pairDeck } from '../engine/eval.js';
import { playRound } from '../engine/game.js';
import { createRandomAgent } from '../engine/agents/random.js';
import { DECK } from '../engine/rules.js';

test('meanCI', () => {
  const r = meanCI([1, 2, 3, 4, 5]);
  assert.equal(r.mean, 3);
  assert.ok(Math.abs(r.sd - Math.sqrt(2.5)) < 1e-12);
  assert.ok(Math.abs(r.hi - r.mean - 1.959963984540054 * Math.sqrt(2.5) / Math.sqrt(5)) < 1e-12);
  assert.equal(meanCI([7]).hi, Infinity);
});

test('pairDeck: 시드·쌍 번호가 같으면 같은 덱, 다르면 다른 덱', () => {
  assert.deepEqual(pairDeck(1, 0), pairDeck(1, 0));
  assert.notDeepEqual(pairDeck(1, 0), pairDeck(1, 1));
  assert.notDeepEqual(pairDeck(1, 0), pairDeck(2, 0));
  assert.equal(new Set(pairDeck(3, 4)).size, 60);
});

test('미러: 2판에서 B는 1판의 A와 같은 첫 손패를 받음', () => {
  const firstHands = [];
  const spy = (name) => () => {
    let first = true;
    return {
      chooseMove(obs, moves) {
        if (first) { firstHands.push({ name, player: obs.player, hand: obs.hand.join(',') }); first = false; }
        return moves[0];
      },
    };
  };
  mirrorMatch(spy('A'), spy('B'), { pairs: 1, seed: 5 });
  const find = (name, game) => firstHands.filter((h) => h.name === name)[game];
  // 1판: A 자리 0, 2판: A 자리 1
  assert.equal(find('A', 0).player, 0);
  assert.equal(find('B', 1).player, 0);
  assert.equal(find('B', 1).hand, find('A', 0).hand);
  assert.equal(find('A', 1).hand, find('B', 0).hand);
});

test('같은 에이전트끼리 미러 대국은 점수 차 0 근처', () => {
  const det = () => ({ chooseMove: (obs, moves) => moves[0] });
  const r = mirrorMatch(det, det, { pairs: 20, seed: 3 });
  assert.equal(r.diff.mean, 0);
  assert.equal(r.winRate.mean, 0.5);
});

// 버림 더미에만 버리고 버림 더미에서만 뽑는 봇: 덱이 줄지 않아 라운드가 끝나지 않는다
const staller = () => ({
  chooseMove(obs, moves) {
    return moves.find((m) => m.draw !== DECK && m.target === 'discard') ?? moves[0];
  },
});

test('끝나지 않는 판은 maxTurns에서 멈추고 stalled로 표시', () => {
  const r = playRound([staller(), staller()], { seed: 1, maxTurns: 300 });
  assert.equal(r.stalled, true);
  assert.equal(r.turns, 300);
  const ok = playRound([createRandomAgent(1), createRandomAgent(2)], { seed: 1 });
  assert.equal(ok.stalled, false);
});

test('stalled 판은 무승부로 집계', () => {
  const r = mirrorMatch(staller, staller, { pairs: 3, seed: 1, maxTurns: 200 });
  assert.equal(r.stalled, 6);
  assert.equal(r.draws, 6);
  assert.equal(r.diff.mean, 0);
  assert.equal(r.winRate.mean, 0.5);
});
