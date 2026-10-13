import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRoundStarter } from '../engine/match.js';
import { playRound } from '../engine/game.js';
import { createRandomAgent } from '../engine/agents/random.js';

test('다음 라운드 선: 누적 점수 높은 쪽, 동점이면 직전 후공', () => {
  assert.equal(nextRoundStarter([30, 10], 1), 0);
  assert.equal(nextRoundStarter([-5, 10], 0), 1);
  assert.equal(nextRoundStarter([10, 10], 0), 1);
  assert.equal(nextRoundStarter([10, 10], 1), 0);
});

test('랜덤 봇 대국이 재현 가능하게 끝까지 진행', () => {
  const run = () => playRound([createRandomAgent(1), createRandomAgent(2)], { seed: 123 });
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.ok(a.turns >= 44);
});
