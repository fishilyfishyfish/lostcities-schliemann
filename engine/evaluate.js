// 전체 정보 상태의 정적 평가: 라운드 끝 점수 차(me − 상대)의 추정값.
// MCTS 리프 평가용. 결정화 상태(관측에서 샘플링한 가상 상태)에만 쓰므로 숨은 정보 원칙과 충돌하지 않는다.
//
// 플레이어마다 규칙 봇과 같은 색별 기대 점수(agents/rule.js colorValue)를 쓴다:
//   q = drawShare × (그 플레이어의 남은 뽑기 − 1) / 덱 장수   (결정화 상태에선 덱 구성을 안다고 보고 덱만 풀로 씀)
//   w = handWeight × min(1, 남은 차례 / 놓을 수 있는 손패 수)
// 덱이 비면 정확한 점수 차.

import { NUM_COLORS, cardColor } from './cards.js';
import { canPlace } from './rules.js';
import { colorValue, giftValue, RULE_DEFAULTS } from './agents/rule.js';
import { totalScore } from './sim.js';

export const EVAL_DEFAULTS = Object.freeze({
  handWeight: RULE_DEFAULTS.handWeight,
  drawShare: RULE_DEFAULTS.drawShare,
  giftWeight: 0.5,
});

const deckBy = Array.from({ length: NUM_COLORS }, () => []);
const handBy = Array.from({ length: NUM_COLORS }, () => []);

function playerValue(s, p, P) {
  const D = s.deck.length;
  const turns = s.current === p ? Math.ceil(D / 2) : Math.floor(D / 2);
  const hand = s.hands[p];
  const exps = s.expeditions[p];
  for (let c = 0; c < NUM_COLORS; c++) handBy[c].length = 0;
  let planned = 0;
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    handBy[cardColor(card)].push(card);
    if (canPlace(exps[cardColor(card)], card)) planned++;
  }
  const ctx = {
    w: P.handWeight * Math.min(1, turns / Math.max(1, planned)),
    q: D ? Math.min(1, (P.drawShare * Math.max(0, turns - 1)) / D) : 0,
  };
  let v = 0;
  for (let c = 0; c < NUM_COLORS; c++) v += colorValue(exps[c], handBy[c], deckBy[c], ctx);
  return v;
}

export function evaluateState(s, me, P = EVAL_DEFAULTS) {
  if (s.over) return totalScore(s.expeditions[me]) - totalScore(s.expeditions[1 - me]);
  for (let c = 0; c < NUM_COLORS; c++) deckBy[c].length = 0;
  for (let i = 0; i < s.deck.length; i++) deckBy[cardColor(s.deck[i])].push(s.deck[i]);
  let v = playerValue(s, me, P) - playerValue(s, 1 - me, P);
  // 버림 더미 맨 위: 다음 차례 플레이어가 가져갈 수 있다
  if (P.giftWeight) {
    const next = s.current;
    let g = 0;
    for (let c = 0; c < NUM_COLORS; c++) {
      const pile = s.discards[c];
      if (pile.length) g += giftValue(pile[pile.length - 1], s.expeditions[next][c], RULE_DEFAULTS);
    }
    v += (next === me ? 1 : -1) * P.giftWeight * g;
  }
  return v;
}
