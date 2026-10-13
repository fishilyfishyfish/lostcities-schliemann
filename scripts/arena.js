// 미러 대국으로 두 에이전트 비교.
// 사용법: node scripts/arena.js <A> <B> [쌍 수=500] [시드=1]
//   예: node scripts/arena.js rule random 2000
import { AGENTS } from '../engine/agents/index.js';
import { mirrorMatch, formatMatch } from '../engine/eval.js';

const [a = 'rule', b = 'random', pairsArg = '500', seedArg = '1'] = process.argv.slice(2);
for (const name of [a, b]) {
  if (!AGENTS[name]) {
    console.error(`unknown agent: ${name}. available: ${Object.keys(AGENTS).join(', ')}`);
    process.exit(1);
  }
}
const pairs = Number(pairsArg);
const r = mirrorMatch(AGENTS[a], AGENTS[b], {
  pairs,
  seed: Number(seedArg),
  onPair: (i) => { if (process.stderr.isTTY && i % 50 === 0) process.stderr.write(`\r${i}/${pairs}`); },
});
if (process.stderr.isTTY) process.stderr.write('\r');
console.log(formatMatch(a, b, r));
