// 공개 API. 에이전트/UI는 이 모듈과 관측 객체만 사용한다.
export * from './cards.js';
export { mulberry32, shuffle, randomSeed } from './rng.js';
export { expeditionScore, playerScore, EXPEDITION_COST, BONUS, BONUS_MIN_CARDS } from './scoring.js';
export { EXPEDITION, DISCARD, DECK, canPlace } from './rules.js';
export { legalMovesFromObservation, knownCardsInHand } from './observation.js';
export { Game, playRound } from './game.js';
export { nextRoundStarter, ROUNDS_PER_MATCH } from './match.js';
export { createRandomAgent } from './agents/random.js';
export { createRuleAgent, RULE_DEFAULTS } from './agents/rule.js';
export { AGENTS } from './agents/index.js';
export { mirrorMatch, meanCI, pairDeck, formatMatch } from './eval.js';
// 탐색용 결정화/시뮬레이션은 engine/sim.js에서 직접 import (관측 객체에서 만든 가상 상태만 다룸).
export { cardTracker, expeditionBreakdown, scoreBreakdown, analyzeMoves, CARD_STATUS } from './analysis.js';
