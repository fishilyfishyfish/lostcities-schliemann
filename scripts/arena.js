// 미러 대국으로 두 에이전트 비교.
// 사용법: node scripts/arena.js <A> <B> [쌍 수=500] [시드=1] [워커 수=CPU 수]
//   에이전트 지정: 이름 또는 이름:키=값,... (예: mcts:iterations=2000,bias=10)
//   예: node scripts/arena.js rule random 2000
//       node scripts/arena.js mcts:iterations=2000 rule 1000 1 4
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { agentFactory } from '../engine/agents/index.js';
import { formatMatch, runPairs, summarize } from '../engine/eval.js';

if (isMainThread) {
  const [a = 'rule', b = 'random', pairsArg = '500', seedArg = '1', workersArg] = process.argv.slice(2);
  agentFactory(a);
  agentFactory(b); // 이름 검증
  const pairs = Number(pairsArg);
  const seed = Number(seedArg);
  const nWorkers = Math.max(1, Math.min(pairs, Number(workersArg ?? os.availableParallelism?.() ?? os.cpus().length)));
  const t0 = Date.now();
  const chunk = Math.ceil(pairs / nWorkers);
  let done = 0;
  const jobs = [];
  for (let w = 0; w < nWorkers; w++) {
    const from = w * chunk;
    const to = Math.min(pairs, from + chunk);
    if (from >= to) break;
    jobs.push(new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { a, b, from, to, seed } });
      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          done++;
          if (process.stderr.isTTY && done % 10 === 0) process.stderr.write(`\r${done}/${pairs}`);
        } else if (msg.type === 'done') {
          resolve(msg.part);
        }
      });
      worker.on('error', reject);
    }));
  }
  const parts = await Promise.all(jobs);
  if (process.stderr.isTTY) process.stderr.write('\r');
  const r = summarize(parts, { seed, ms: Date.now() - t0 });
  console.log(formatMatch(a, b, r) + `\n  워커 ${jobs.length}개`);
} else {
  const { a, b, from, to, seed } = workerData;
  const part = runPairs(agentFactory(a), agentFactory(b), {
    from, to, seed, onPair: () => parentPort.postMessage({ type: 'progress' }),
  });
  parentPort.postMessage({ type: 'done', part });
}
