// 랜덤 vs 랜덤 라운드 반복. 사용법: node scripts/selfplay.js [판 수] [시드]
import { playRound, createRandomAgent } from '../engine/index.js';

const n = Number(process.argv[2] ?? 10000);
const seed0 = Number(process.argv[3] ?? 1);
const agents = [createRandomAgent(seed0), createRandomAgent(seed0 + 1)];
let wins = [0, 0], draws = 0, sum = [0, 0], turns = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const r = playRound(agents, { seed: seed0 * 1000003 + i, startingPlayer: i % 2 });
  sum[0] += r.scores[0];
  sum[1] += r.scores[1];
  turns += r.turns;
  if (r.scores[0] > r.scores[1]) wins[0]++;
  else if (r.scores[1] > r.scores[0]) wins[1]++;
  else draws++;
}
const ms = performance.now() - t0;
console.log(`rounds ${n}, ${ms.toFixed(0)} ms, ${(n / (ms / 1000)).toFixed(0)} rounds/s, ${(turns / (ms / 1000)).toFixed(0)} turns/s`);
console.log(`avg turns ${(turns / n).toFixed(1)}, avg score p0 ${(sum[0] / n).toFixed(1)} p1 ${(sum[1] / n).toFixed(1)}`);
console.log(`wins p0 ${wins[0]} p1 ${wins[1]} draws ${draws}`);
