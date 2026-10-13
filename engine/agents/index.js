import { createRandomAgent } from './random.js';
import { createRuleAgent } from './rule.js';
import { createMctsAgent } from './mcts.js';
import { createGreedyAgent } from '../policy.js';

/** 이름 → (seed, params) => agent. 측정 스크립트와 웹 워커가 같은 목록을 쓴다. */
export const AGENTS = {
  random: (seed) => createRandomAgent(seed),
  greedy: (seed, params) => createGreedyAgent(seed, params),
  rule: (seed, params) => createRuleAgent(seed, params),
  mcts: (seed, params) => createMctsAgent(seed, params),
};

/**
 * 에이전트 지정 문자열 → (seed) => agent.
 * 형식: "이름" 또는 "이름:키=값,키=값" (예: "mcts:iterations=2000,bias=10"). 값은 숫자면 숫자로.
 */
export function agentFactory(spec) {
  const [name, rest] = spec.split(':');
  const make = AGENTS[name];
  if (!make) throw new Error(`unknown agent: ${name}. available: ${Object.keys(AGENTS).join(', ')}`);
  const params = {};
  if (rest) {
    for (const kv of rest.split(',')) {
      const [k, v] = kv.split('=');
      params[k] = v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
  }
  return (seed) => make(seed, params);
}

export { createRandomAgent, createRuleAgent, createMctsAgent, createGreedyAgent };
