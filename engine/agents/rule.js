// 규칙 기반 봇: 카드 카운팅 + 색별 기대 점수로 합법수를 1수 평가한다.
//
// 국면 평가 = Σ 색별 기대 점수(나) − giftWeight × Σ 버림 더미 맨 위 카드가 상대에게 주는 가치
//
// 색별 기대 점수:
//   숫자 합 S = 탐험대 숫자 합 + w × (손패 중 아직 놓을 수 있는 숫자) + q × (보이지 않는 카드 중 놓을 수 있는 숫자)
//   장수 N도 같은 가중치로. 배수 = 1 + 놓은 투자 수 + w × (손패 투자 중 놓는 수, 0..k 중 최선)
//   점수 = (S − 20) × 배수 + 8장 보너스(장수 6~8 구간에서 0→20으로 완만하게)
//   아직 시작 안 한 색은 max(0, 점수): 시작하지 않을 선택권이 있으므로 (= 탐험대 시작 기대값)
//   w: 손패가 실제로 놓일 가중치. 남은 차례 수보다 놓을 카드가 많으면 줄인다.
//   q: 보이지 않는 카드 한 장을 내가 뽑아서 쓸 확률의 근사 = drawShare × (남은 내 뽑기 − 1) / 보이지 않는 카드 수.
// 덱에서 뽑기는 보이지 않는 카드 전체에 대한 평균 이득으로 평가한다.

import { NUM_COLORS, cardColor, cardValue, isWager } from '../cards.js';
import { DECK, DISCARD, EXPEDITION, canPlace } from '../rules.js';
import { mulberry32 } from '../rng.js';
import { unseenCards } from '../sim.js';

export const RULE_DEFAULTS = Object.freeze({
  handWeight: 0.85,
  drawShare: 0.7,
  giftWeight: 0.7,
  unstartedGift: 0.25,
  wagerGift: 6,
  noise: 1e-6,
});

function expInfo(exp) {
  let sum = 0, wagers = 0, top = 0;
  for (const c of exp) {
    if (isWager(c)) wagers++;
    else { sum += cardValue(c); top = cardValue(c); }
  }
  return { sum, wagers, top, hasNum: top > 0, len: exp.length };
}

/**
 * 한 색의 기대 점수.
 * handCol: 그 색 손패, unseenCol: 그 색 보이지 않는 카드, extra/skip: 덱 뽑기 평가용 (손패에 extra 추가, unseen에서 skip 제외).
 */
function colorValue(exp, handCol, unseenCol, ctx, extra = -1, skip = -1) {
  const e = expInfo(exp);
  let handSum = 0, handCnt = 0, handWagers = 0;
  const addHand = (c) => {
    if (isWager(c)) { if (!e.hasNum) handWagers++; }
    else if (cardValue(c) > e.top) { handSum += cardValue(c); handCnt++; }
  };
  for (const c of handCol) addHand(c);
  if (extra >= 0) addHand(extra);
  let unSum = 0, unCnt = 0;
  for (const c of unseenCol) {
    if (c === skip || isWager(c)) continue;
    if (cardValue(c) > e.top) { unSum += cardValue(c); unCnt++; }
  }
  const { w, q } = ctx;
  const S = e.sum + w * handSum + q * unSum;
  const N = e.len + w * handCnt + q * unCnt;
  let best = -Infinity;
  for (let k = 0; k <= handWagers; k++) {
    const mult = 1 + e.wagers + w * k;
    const n = N + w * k;
    const bonus = 20 * Math.min(1, Math.max(0, (n - 6) / 2));
    const v = (S - 20) * mult + bonus;
    if (v > best) best = v;
  }
  return e.len > 0 ? best : Math.max(0, best);
}

/** 버림 더미 맨 위 카드가 상대에게 주는 가치 (상대가 가져가 놓을 수 있는가). */
function giftValue(card, oppExp, P) {
  if (card < 0) return 0;
  const o = expInfo(oppExp);
  if (isWager(card)) {
    if (o.len > 0 && !o.hasNum) return P.wagerGift;
    return 0;
  }
  const v = cardValue(card);
  if (o.len === 0) return v * P.unstartedGift;
  return v > o.top ? v * (o.wagers + 1) : 0;
}

function byColor(cards) {
  const out = Array.from({ length: NUM_COLORS }, () => []);
  for (const c of cards) out[cardColor(c)].push(c);
  return out;
}

const topOf = (pile) => (pile.length ? pile[pile.length - 1] : -1);

export function createRuleAgent(seed = 1, params = {}) {
  const P = { ...RULE_DEFAULTS, ...params };
  const rng = mulberry32(seed);

  function context(obs) {
    const unseen = unseenCards(obs);
    const T = Math.ceil(obs.deckCount / 2); // 이번 차례 포함 내 남은 차례 (둘 다 덱에서 뽑는다고 가정)
    let planned = 0;
    for (const c of obs.hand) if (canPlace(obs.myExpeditions[cardColor(c)], c)) planned++;
    const w = P.handWeight * Math.min(1, T / Math.max(1, planned));
    const q = unseen.length ? Math.min(1, (P.drawShare * Math.max(0, T - 1)) / unseen.length) : 0;
    return { unseen, unseenBy: byColor(unseen), T, w, q };
  }

  /** 색별 기대 점수 합 − 상대 선물 위험. pileTops[c] = 맨 위 카드 또는 -1. */
  function evalPosition(obs, ctx, exps, handBy, pileTops) {
    let v = 0;
    for (let c = 0; c < NUM_COLORS; c++) {
      v += colorValue(exps[c], handBy[c], ctx.unseenBy[c], ctx);
      v -= P.giftWeight * giftValue(pileTops[c], obs.oppExpeditions[c], P);
    }
    return v;
  }

  /** 덱에서 뽑을 때 기대 이득: 보이지 않는 카드 각각이 손에 들어왔을 때의 증가분 평균. */
  function deckGain(ctx, exps, handBy) {
    const n = ctx.unseen.length;
    if (!n) return 0;
    let total = 0;
    for (let c = 0; c < NUM_COLORS; c++) {
      const col = ctx.unseenBy[c];
      if (!col.length) continue;
      const base = colorValue(exps[c], handBy[c], col, ctx);
      for (const u of col) total += colorValue(exps[c], handBy[c], col, ctx, u, u) - base;
    }
    return total / n;
  }

  return {
    name: 'rule',
    chooseMove(obs, legalMoves) {
      const ctx = context(obs);
      const groups = new Map();
      for (const m of legalMoves) {
        const key = `${m.card}|${m.target}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      let best = null;
      let bestV = -Infinity;
      for (const moves of groups.values()) {
        const { card, target } = moves[0];
        const color = cardColor(card);
        const exps = obs.myExpeditions.slice();
        const pileTops = obs.discards.map(topOf);
        const hand1 = obs.hand.filter((c) => c !== card);
        if (target === EXPEDITION) exps[color] = [...exps[color], card];
        else pileTops[color] = card;
        const handBy1 = byColor(hand1);
        for (const m of moves) {
          let v;
          if (m.draw === DECK) {
            v = evalPosition(obs, ctx, exps, handBy1, pileTops) + deckGain(ctx, exps, handBy1);
          } else {
            const pile = obs.discards[m.draw].slice();
            if (target === DISCARD && color === m.draw) pile.push(card); // 합법수에는 없지만 방어적으로
            const drawn = pile.pop();
            const tops = pileTops.slice();
            tops[m.draw] = topOf(pile);
            const handBy2 = handBy1.map((h) => h.slice());
            handBy2[cardColor(drawn)].push(drawn);
            v = evalPosition(obs, ctx, exps, handBy2, tops);
          }
          v += P.noise * rng();
          if (v > bestV) { bestV = v; best = m; }
        }
      }
      return best;
    },
  };
}

