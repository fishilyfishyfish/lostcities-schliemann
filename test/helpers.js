import { NUM_COLORS } from '../engine/cards.js';

/** 테스트용 상태 직접 구성. 지정하지 않은 카드는 덱으로. */
export function makeState({ hands = [[], []], expeditions, discards, deck, current = 0, history = [] } = {}) {
  const empty = () => Array.from({ length: NUM_COLORS }, () => []);
  const exps = expeditions ?? [empty(), empty()];
  const disc = discards ?? empty();
  let d = deck;
  if (!d) {
    const used = new Set([...hands.flat(), ...exps.flat(2), ...disc.flat()]);
    d = [];
    for (let i = 0; i < 60; i++) if (!used.has(i)) d.push(i);
  }
  return {
    deck: d, hands, expeditions: exps, discards: disc,
    current, startingPlayer: 0, turn: history.length, over: false, history,
  };
}
