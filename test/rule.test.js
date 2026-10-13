import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuleAgent } from '../engine/agents/rule.js';
import { createRandomAgent } from '../engine/agents/random.js';
import { Game } from '../engine/game.js';
import { legalMovesFromObservation } from '../engine/observation.js';
import { mirrorMatch } from '../engine/eval.js';

test('규칙 봇은 항상 합법수 목록 안에서 고름', () => {
  for (let seed = 0; seed < 20; seed++) {
    const game = new Game({ seed });
    const agents = [createRuleAgent(seed), createRandomAgent(seed)];
    while (!game.over) {
      const obs = game.observe(game.current);
      const moves = legalMovesFromObservation(obs);
      const m = agents[game.current].chooseMove(obs, moves);
      assert.ok(moves.includes(m));
      game.play(m);
    }
  }
});

test('규칙 봇은 관측 객체를 바꾸지 않음', () => {
  const game = new Game({ seed: 4 });
  const obs = game.observe(game.current);
  const before = JSON.stringify(obs);
  createRuleAgent(1).chooseMove(obs, legalMovesFromObservation(obs));
  assert.equal(JSON.stringify(obs), before);
});

test('규칙 봇이 랜덤 AI를 확실히 이김 (미러 30쌍)', () => {
  const r = mirrorMatch((s) => createRuleAgent(s), (s) => createRandomAgent(s), { pairs: 30, seed: 11 });
  assert.ok(r.diff.lo > 50, `diff CI ${r.diff.lo}..${r.diff.hi}`);
  assert.equal(r.stalled, 0);
});
