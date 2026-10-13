// 카드 = 정수 id 0~59. id = 색 * 12 + slot. slot 0~2 투자 카드, 3~11 숫자 2~10.

export const COLORS = ['yellow', 'blue', 'white', 'green', 'red'];
export const NUM_COLORS = 5;
export const CARDS_PER_COLOR = 12;
export const WAGERS_PER_COLOR = 3;
export const DECK_SIZE = NUM_COLORS * CARDS_PER_COLOR;
export const HAND_SIZE = 8;

export const cardColor = (id) => (id / CARDS_PER_COLOR) | 0;
export const isWager = (id) => id % CARDS_PER_COLOR < WAGERS_PER_COLOR;
/** 투자 카드는 0, 숫자 카드는 2~10. */
export const cardValue = (id) => {
  const slot = id % CARDS_PER_COLOR;
  return slot < WAGERS_PER_COLOR ? 0 : slot - 1;
};

/** value 0 = 투자 카드 (copy 0~2), 2~10 = 숫자 카드. */
export function makeCard(color, value, copy = 0) {
  if (value === 0) return color * CARDS_PER_COLOR + copy;
  if (value < 2 || value > 10) throw new RangeError(`bad value ${value}`);
  return color * CARDS_PER_COLOR + value + 1;
}

export const ALL_CARDS = Object.freeze(Array.from({ length: DECK_SIZE }, (_, i) => i));

const LETTERS = ['Y', 'B', 'W', 'G', 'R'];
/** 디버그/로그용 표기. 예: 'R7', 'Gw1' (초록 투자 카드 두 번째). */
export function cardLabel(id) {
  const c = LETTERS[cardColor(id)];
  return isWager(id) ? `${c}w${id % CARDS_PER_COLOR}` : `${c}${cardValue(id)}`;
}

/** 색 오름차순, 같은 색은 값 오름차순. */
export const compareCards = (a, b) => a - b;
