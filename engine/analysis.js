// 분석 기능: 카드 추적표, 점수 내역, 수별 기대 점수. 모두 관측 객체(한 플레이어 시점)만 입력으로 받는다.

import { ALL_CARDS, NUM_COLORS, cardColor, cardValue, isWager } from './cards.js';
import { expeditionBreakdown } from './scoring.js';

export { expeditionBreakdown };
import { legalMovesFromObservation } from './observation.js';
import { createMctsAgent } from './agents/mcts.js';

/** 카드 위치 (관측자 시점). */
export const CARD_STATUS = Object.freeze({
  MY_HAND: 'myHand',
  MY_EXPEDITION: 'myExpedition',
  OPP_EXPEDITION: 'oppExpedition',
  DISCARD: 'discard', // 버림 더미 (맨 위가 아닐 수도 있음)
  OPP_HAND_KNOWN: 'oppHandKnown', // 상대가 버림 더미에서 가져가 아직 들고 있는 카드
  UNSEEN: 'unseen', // 덱 또는 상대의 미공개 손패
});

/**
 * 카드 추적표.
 * @returns {{
 *   status: string[],            // 카드 id → CARD_STATUS
 *   discardTop: boolean[],       // 카드 id → 버림 더미 맨 위인가
 *   unseenByColor: number[],     // 색별 미확인 장수
 *   unseenNumbersByColor: number[][], // 색별 미확인 숫자 카드 값
 *   unseenWagersByColor: number[],
 *   unseenTotal: number          // = 덱 장수 + 상대 미공개 손패 장수
 * }}
 */
export function cardTracker(obs) {
  const status = new Array(ALL_CARDS.length).fill(CARD_STATUS.UNSEEN);
  const discardTop = new Array(ALL_CARDS.length).fill(false);
  for (const c of obs.hand) status[c] = CARD_STATUS.MY_HAND;
  for (const e of obs.myExpeditions) for (const c of e) status[c] = CARD_STATUS.MY_EXPEDITION;
  for (const e of obs.oppExpeditions) for (const c of e) status[c] = CARD_STATUS.OPP_EXPEDITION;
  for (const d of obs.discards) {
    d.forEach((c, i) => {
      status[c] = CARD_STATUS.DISCARD;
      if (i === d.length - 1) discardTop[c] = true;
    });
  }
  for (const c of obs.opponentKnownCards) status[c] = CARD_STATUS.OPP_HAND_KNOWN;
  const unseenByColor = new Array(NUM_COLORS).fill(0);
  const unseenWagersByColor = new Array(NUM_COLORS).fill(0);
  const unseenNumbersByColor = Array.from({ length: NUM_COLORS }, () => []);
  let unseenTotal = 0;
  for (const c of ALL_CARDS) {
    if (status[c] !== CARD_STATUS.UNSEEN) continue;
    unseenTotal++;
    unseenByColor[cardColor(c)]++;
    if (isWager(c)) unseenWagersByColor[cardColor(c)]++;
    else unseenNumbersByColor[cardColor(c)].push(cardValue(c));
  }
  return { status, discardTop, unseenByColor, unseenNumbersByColor, unseenWagersByColor, unseenTotal };
}

/** 양쪽 점수 내역. [나, 상대] 각각 { colors: breakdown[5], total }. */
export function scoreBreakdown(obs) {
  return [obs.myExpeditions, obs.oppExpeditions].map((exps) => {
    const colors = exps.map(expeditionBreakdown);
    return { colors, total: colors.reduce((t, b) => t + b.total, 0) };
  });
}

export const ANALYSIS_DEFAULTS = Object.freeze({ timeMs: 1500, iterations: 200000, topK: 8 });

/**
 * 현재 국면의 수별 기대 점수 차 (MCTS). 관측자의 차례에만 의미가 있다.
 * topK: 규칙 봇 평가 상위 몇 수를 탐색할지 (나머지는 expected: null).
 */
export function analyzeMoves(obs, opts = {}) {
  const legalMoves = legalMovesFromObservation(obs);
  if (!legalMoves.length) return { iterations: 0, moves: [] };
  const P = { ...ANALYSIS_DEFAULTS, ...opts };
  const agent = createMctsAgent(opts.seed ?? 1, { timeMs: P.timeMs, iterations: P.iterations, topK: P.topK });
  return agent.analyze(obs, legalMoves);
}
