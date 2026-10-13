// 성능 기준값. 사용법: node scripts/bench.js
import { Game, createRandomAgent, legalMovesFromObservation, playRound } from '../engine/index.js';
import { createRuleAgent } from '../engine/agents/rule.js';
import { mulberry32 } from '../engine/rng.js';
import { newRound } from '../engine/rules.js';
import { cloneSimState, determinize, randomPlayout } from '../engine/sim.js';

function time(label, n, unit, fn) {
  fn(Math.min(n, 200)); // 워밍업
  const t0 = performance.now();
  const extra = fn(n) ?? n;
  const s = (performance.now() - t0) / 1000;
  console.log(`${label}: ${Math.round(extra / s).toLocaleString('en-US')} ${unit}/s`);
}

const rng = mulberry32(1);

time('무작위 플레이아웃 (새 배분부터 끝까지, simStep)', 50000, 'playouts', (n) => {
  let turns = 0;
  for (let i = 0; i < n; i++) {
    const s = newRound({ seed: i });
    randomPlayout(s, rng);
    turns += s.turn;
  }
  return n;
});

// 중반 국면에서 결정화 + 플레이아웃 (MCTS 한 반복의 대략적인 비용)
const game = new Game({ seed: 3 });
const ra = createRandomAgent(3);
for (let i = 0; i < 20; i++) {
  const o = game.observe(game.current);
  game.play(ra.chooseMove(o, legalMovesFromObservation(o)));
}
const mid = game.observe(game.current);
time('결정화 (중반 관측 → 상태)', 200000, 'samples', (n) => {
  for (let i = 0; i < n; i++) determinize(mid, rng);
});
time('결정화 + 플레이아웃 (중반부터)', 50000, 'iterations', (n) => {
  for (let i = 0; i < n; i++) randomPlayout(determinize(mid, rng), rng);
});
time('상태 복사 (cloneSimState)', 500000, 'clones', (n) => {
  const s = determinize(mid, rng);
  for (let i = 0; i < n; i++) cloneSimState(s);
});

time('playRound 랜덤 vs 랜덤 (관측 객체 경유)', 5000, 'rounds', (n) => {
  const agents = [createRandomAgent(1), createRandomAgent(2)];
  for (let i = 0; i < n; i++) playRound(agents, { seed: i, keepHistory: false });
});

let decisions = 0;
time('규칙 봇 결정 (rule vs rule 대국 중)', 300, 'decisions', (n) => {
  let d = 0;
  for (let i = 0; i < n; i++) d += playRound([createRuleAgent(1), createRuleAgent(2)], { seed: i, keepHistory: false }).turns;
  decisions = d;
  return d;
});
