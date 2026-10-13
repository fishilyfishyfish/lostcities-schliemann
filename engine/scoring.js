import { NUM_COLORS, cardValue, isWager } from './cards.js';

export const EXPEDITION_COST = 20;
export const BONUS_MIN_CARDS = 8;
export const BONUS = 20;

/** 탐험대 하나의 점수. 빈 탐험대 0점. 투자 카드만 있어도 시작한 것으로 본다. */
export function expeditionScore(cards) {
  if (cards.length === 0) return 0;
  let sum = 0;
  let wagers = 0;
  for (const c of cards) {
    if (isWager(c)) wagers++;
    else sum += cardValue(c);
  }
  let score = (sum - EXPEDITION_COST) * (wagers + 1);
  if (cards.length >= BONUS_MIN_CARDS) score += BONUS;
  return score;
}

/** 한 플레이어의 탐험대 5개 → { perColor: number[5], total }. */
export function playerScore(expeditions) {
  const perColor = new Array(NUM_COLORS);
  let total = 0;
  for (let c = 0; c < NUM_COLORS; c++) {
    perColor[c] = expeditionScore(expeditions[c]);
    total += perColor[c];
  }
  return { perColor, total };
}
