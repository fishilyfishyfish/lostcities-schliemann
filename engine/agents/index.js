import { createRandomAgent } from './random.js';
import { createRuleAgent } from './rule.js';

/** 이름 → (seed) => agent. 측정 스크립트와 웹 워커가 같은 목록을 쓴다. */
export const AGENTS = {
  random: (seed) => createRandomAgent(seed),
  rule: (seed) => createRuleAgent(seed),
};

export { createRandomAgent, createRuleAgent };
