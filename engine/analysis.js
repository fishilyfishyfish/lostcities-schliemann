// 분석 기능: 카드 추적표, 점수 내역, 수별 기대 점수. 모두 관측 객체(한 플레이어 시점)만 입력으로 받는다.

import { ALL_CARDS, NUM_COLORS, cardColor, cardValue, isWager } from './cards.js';
import { expeditionBreakdown } from './scoring.js';

export { expeditionBreakdown };
import { legalMovesFromObservation } from './observation.js';
import { createMctsAgent } from './agents/mcts.js';
import { COLOR_NAMES_KO, explainMove, josa, projectPosition, viewContext } from './explain.js';

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
 * 1위와의 차이를 말로. MCTS 표준오차는 샘플링 잡음만 반영하고 평가 함수 자체의 오차는 모르므로
 * 최소 1.5점 차이 안쪽은 "비슷함"으로 본다.
 */
export function confidenceLabel(gap, se = 0) {
  const tie = Math.max(1.5, 2 * se);
  if (gap <= tie) return 'similar';
  if (gap <= 5) return 'slight';
  return 'clear';
}

/**
 * 두 수의 수읽기 색별 효과 비교 → 사람이 읽는 장단점.
 * 항목 합(나의 색별 차 − AI 색별 차 + 위험 항 차)은 기대 점수 차이와 정확히 같다.
 * @returns {{ pros: string[], cons: string[], terms: {text, value}[] }} value > 0이면 a가 b보다 나에게 유리
 */
export function compareMoves(a, b, minAbs = 0.8) {
  if (!a.colorEffect || !b.colorEffect) return { pros: [], cons: [], terms: [] };
  const terms = [];
  const r1 = (x) => Math.round(Math.abs(x) * 10) / 10;
  for (let c = 0; c < 5; c++) {
    const dm = a.colorEffect.me[c] - b.colorEffect.me[c];
    const name = COLOR_NAMES_KO[c];
    terms.push({ value: dm, text: `내 ${name} 예상이 ${r1(dm)}점 ${dm > 0 ? '높다' : '낮다'}`, side: 'me', color: c });
    const dop = a.colorEffect.opp[c] - b.colorEffect.opp[c];
    terms.push({ value: -dop, text: `AI ${name} 예상이 ${r1(dop)}점 ${dop > 0 ? '높다' : '낮다'}`, side: 'opp', color: c });
  }
  const dg = a.colorEffect.gift - b.colorEffect.gift;
  terms.push({ value: dg, text: `버림 더미로 AI에게 줄 위험이 ${r1(dg)}점 ${dg > 0 ? '적다' : '많다'}`, side: 'gift', color: -1 });
  terms.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const prosT = terms.filter((t) => t.value >= minAbs).slice(0, 3);
  const consT = terms.filter((t) => t.value <= -minAbs).slice(0, 2);
  const shown = new Set([...prosT, ...consT]);
  const rest = terms.filter((t) => !shown.has(t)).reduce((x, t) => x + t.value, 0);
  const fmt = (x) => `${x >= 0 ? '+' : '−'}${r1(x)}`;
  return {
    pros: prosT.map((t) => `${t.text} (${fmt(t.value)})`),
    cons: consT.map((t) => `${t.text} (${fmt(t.value)})`),
    rest, // 목록에 안 나온 작은 차이들의 합 (나에게 유리하면 +)
    total: terms.reduce((x, t) => x + t.value, 0),
    terms,
  };
}

/**
 * 현재 국면의 수별 분석 (MCTS 수읽기 + 정적 평가 근거). 관측자의 차례에만 의미가 있다.
 * @returns {{
 *   iterations,
 *   position: projectPosition 결과 (색별 현재 → 예상 최종 점수, 양쪽),
 *   weights: { hand, unseen, aiUnseen } 예상 계산에 쓴 가중치 (설명용),
 *   moves: [{ move, visits, expected, se, gap, confidence, rank, staticRank, staticGap, effects, reasons }]
 *     // expected/gap: MCTS 기대 점수 차와 1위 대비 차이, staticRank/staticGap: 정적 평가 순위와 1위 대비 차이
 *     // 탐색 밖의 수는 expected: null이고 정적 평가만 있다.
 * }}
 */
export function analyzeMoves(obs, opts = {}) {
  const legalMoves = legalMovesFromObservation(obs);
  if (!legalMoves.length) return { iterations: 0, position: null, weights: null, moves: [] };
  const P = { ...ANALYSIS_DEFAULTS, ...opts };
  const agent = createMctsAgent(opts.seed ?? 1, { timeMs: P.timeMs, iterations: P.iterations, topK: P.topK });
  const { iterations, moves } = agent.analyze(obs, legalMoves);

  const ctx = viewContext(obs);
  const explained = new Map(legalMoves.map((m) => [m, explainMove(obs, m, ctx)]));
  const staticOrder = [...legalMoves].sort((a, b) => explained.get(b).effects.total - explained.get(a).effects.total);
  const staticBest = explained.get(staticOrder[0]).effects.total;
  // 사람에게 보여줄 순위는 기대값 순 (MCTS 자체는 방문 수로 고르지만 거의 같다)
  moves.sort((a, b) => (b.expected ?? -Infinity) - (a.expected ?? -Infinity) || b.visits - a.visits);
  const searched = moves.filter((m) => m.expected !== null);
  const best = searched[0];
  const out = moves.map((m) => {
    const e = explained.get(m.move);
    const gap = m.expected !== null && best ? best.expected - m.expected : null;
    return {
      ...m,
      gap,
      confidence: gap === null ? null : confidenceLabel(gap, Math.hypot(m.se ?? 0, best.se ?? 0)),
      rank: m.expected !== null ? searched.indexOf(m) + 1 : null,
      staticRank: staticOrder.indexOf(m.move) + 1,
      staticGap: staticBest - e.effects.total,
      effects: e.effects,
      reasons: e.reasons,
      colorEffect: m.colorEffect,
    };
  });
  // 1위: 2위와의 차이로 확신도, 비교 대상은 2위. 나머지: 1위와 비교
  const bestOut = out.find((m) => m.rank === 1);
  const secondOut = out.find((m) => m.rank === 2);
  if (secondOut) {
    bestOut.confidence = confidenceLabel(secondOut.gap, Math.hypot(secondOut.se ?? 0, best.se ?? 0));
    bestOut.versus = { rank: 2, ...compareMoves(bestOut, secondOut) };
  }
  for (const m of out) {
    if (m.rank && m.rank > 1) m.versus = { rank: 1, ...compareMoves(m, bestOut) };
    delete m.colorEffect;
  }
  return {
    iterations,
    position: projectPosition(obs, ctx),
    weights: { hand: ctx.w, unseen: ctx.q, aiUnseen: ctx.qOpp },
    moves: out,
  };
}
