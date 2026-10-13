// 빠른 탐욕 정책. MCTS 롤아웃용이라 할당이 거의 없고 규칙 봇보다 수백 배 빠르다.
// 입력은 한 플레이어 시점에서 보이는 것뿐 (내 손패, 양쪽 탐험대, 버림 더미, 덱 장수)이라
// 관측 객체로도, 시뮬레이션 상태로도 그대로 쓸 수 있다.
//
// 놓기: 시작한 탐험대에 이어 놓을 수 있는 카드 중 건너뛰는 폭이 작은 것. 새 탐험대는 그 색 손패 합이 충분하고
//       덱이 넉넉할 때만. 투자 카드는 그 색 손패 합이 크고 덱이 많이 남았을 때만.
// 버리기: 나에게 쓸모가 적고 상대에게 줄 위험이 적은 카드.
// 뽑기: 버림 더미 맨 위가 시작한 탐험대에 작은 폭으로 이어지면 가져오고, 아니면 덱.

import { NUM_COLORS, cardColor, cardValue, isWager } from './cards.js';
import { DECK, DISCARD, EXPEDITION } from './rules.js';

const handSum = new Int32Array(NUM_COLORS);
const handCnt = new Int32Array(NUM_COLORS);

function topValue(exp) {
  for (let i = exp.length - 1; i >= 0; i--) if (!isWager(exp[i])) return cardValue(exp[i]);
  return 0;
}
const hasNumber = (exp) => exp.length > 0 && !isWager(exp[exp.length - 1]);

export const GREEDY_DEFAULTS = Object.freeze({
  maxGap: 3, // 시작한 탐험대에 이 폭 이하로 이어지면 놓는다
  startSum: 20, // 새 탐험대: 그 색 손패 숫자 합 기준
  startDeck: 10, // 새 탐험대: 덱이 이 장수 이상 남았을 때
  wagerSum: 24, // 투자: 그 색 손패 숫자 합 기준
  wagerDeck: 20, // 투자: 덱 장수 기준
  takeGap: 2, // 버림 더미 카드를 가져오는 폭 기준
});

/**
 * 한 수 고르기. 결과는 out 객체에 기록 (할당 없이 재사용).
 * out: { card, target, draw }. draw는 DECK 또는 색 번호.
 */
export function greedyMove(hand, myExps, oppExps, discards, deckCount, out, P = GREEDY_DEFAULTS) {
  handSum.fill(0);
  handCnt.fill(0);
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (!isWager(c)) {
      handSum[cardColor(c)] += cardValue(c);
      handCnt[cardColor(c)]++;
    }
  }

  // --- 놓기 후보 ---
  let bestCard = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const color = cardColor(card);
    const exp = myExps[color];
    const top = topValue(exp);
    let score;
    if (isWager(card)) {
      if (hasNumber(exp)) continue;
      if (handSum[color] < P.wagerSum || deckCount < P.wagerDeck) continue;
      score = 2;
    } else {
      const v = cardValue(card);
      if (v <= top) continue;
      // 이 카드를 놓으면 사라지는 손패 (top과 v 사이)
      let wasted = 0;
      for (let j = 0; j < hand.length; j++) {
        const o = hand[j];
        if (o !== card && cardColor(o) === color && !isWager(o) && cardValue(o) > top && cardValue(o) < v) wasted += cardValue(o);
      }
      if (exp.length === 0) {
        if (handSum[color] < P.startSum || deckCount < P.startDeck) continue;
        score = 4 - (v - 2) - wasted;
      } else {
        const gap = v - top;
        if (gap > P.maxGap && deckCount > 2 * handCnt[color]) continue;
        score = 6 - gap - wasted;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  let target;
  if (bestCard >= 0) {
    target = EXPEDITION;
  } else {
    // --- 버릴 카드: 내 쓸모 + 상대 위험이 가장 작은 것 ---
    let worst = Infinity;
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const color = cardColor(card);
      const v = isWager(card) ? 0 : cardValue(card);
      let keep = 0;
      const exp = myExps[color];
      if (isWager(card)) {
        keep = hasNumber(exp) ? 0 : exp.length > 0 ? 8 : handSum[color] >= 15 ? 4 : 0;
      } else if (v > topValue(exp)) {
        keep = exp.length > 0 ? 6 + v : handSum[color] >= 12 ? 2 + v / 2 : v / 4;
      }
      const oexp = oppExps[color];
      if (isWager(card)) {
        if (oexp.length > 0 && !hasNumber(oexp)) keep += 6;
      } else if (oexp.length > 0 && v > topValue(oexp)) {
        keep += v;
      }
      if (keep < worst) {
        worst = keep;
        bestCard = card;
      }
    }
    target = DISCARD;
  }

  // --- 뽑기 ---
  const playedColor = cardColor(bestCard);
  let draw = DECK;
  let bestGap = P.takeGap + 1;
  for (let c = 0; c < NUM_COLORS; c++) {
    const pile = discards[c];
    if (pile.length === 0) continue;
    if (c === playedColor && target === DISCARD) continue;
    const t = pile[pile.length - 1];
    if (isWager(t)) continue;
    let exp = myExps[c];
    let top = topValue(exp);
    let started = exp.length > 0;
    if (c === playedColor && target === EXPEDITION) {
      started = true;
      if (!isWager(bestCard)) top = cardValue(bestCard);
    }
    if (!started) continue;
    const gap = cardValue(t) - top;
    if (gap > 0 && gap < bestGap) {
      bestGap = gap;
      draw = c;
    }
  }

  out.card = bestCard;
  out.target = target;
  out.draw = draw;
  return out;
}

/** 탐욕 정책 에이전트 (관측 객체 입력). arena에서 롤아웃 정책 자체의 강도를 잴 때 쓴다. */
export function createGreedyAgent(seed = 1, params = {}) {
  const P = { ...GREEDY_DEFAULTS, ...params };
  const out = { card: -1, target: DISCARD, draw: DECK };
  return {
    name: 'greedy',
    chooseMove(obs, legalMoves) {
      greedyMove(obs.hand, obs.myExpeditions, obs.oppExpeditions, obs.discards, obs.deckCount, out, P);
      // 투자 카드는 합법수에 대표 id 하나만 있으므로 색·종류로 맞춘다
      const same = (m) =>
        (m.card === out.card || (isWager(m.card) && isWager(out.card) && cardColor(m.card) === cardColor(out.card))) &&
        m.target === out.target && m.draw === out.draw;
      return legalMoves.find(same) ?? legalMoves.find((m) => m.target === DISCARD && m.draw === DECK);
    },
  };
}
