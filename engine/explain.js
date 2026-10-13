// 사람이 읽을 수 있는 분석: 정적 평가(규칙 봇과 같은 색별 기대 점수 모델)를 항목별로 분해하고 근거 문장을 만든다.
// 입력은 관측 객체뿐. 분해한 값의 합은 규칙 봇의 평가값과 정확히 같다 (test/explain.test.js).
//
// 예상 최종 점수 (색마다):
//   숫자 합 = 놓인 카드 + w × 손패 중 이어 놓을 수 있는 카드 + q × 미확인 카드 중 이어 놓을 수 있는 카드
//   (숫자 합 − 20) × 배수 + 8장 보너스(장수 6~8에서 0→20). 시작 안 한 색은 손해면 시작 안 한다고 보고 0.
//   w = 손패를 실제로 놓을 가중치 (남은 차례가 모자라면 줄어듦), q = 미확인 카드를 내가 뽑아 쓸 확률 근사.
// AI 쪽도 내가 아는 것만으로: AI 탐험대 + AI가 버림 더미에서 가져간 카드(w) + 미확인 카드(AI가 뽑을 몫 + AI 손에 있을 확률 × w).

import { NUM_COLORS, cardColor, cardValue, isWager } from './cards.js';
import { DECK, DISCARD, EXPEDITION, canPlace } from './rules.js';
import { expeditionScore } from './scoring.js';
import { RULE_DEFAULTS, expInfo, giftValue } from './agents/rule.js';
import { unseenCards } from './sim.js';

export const COLOR_NAMES_KO = ['노랑', '파랑', '하양', '초록', '빨강'];

const byColor = (cards) => {
  const out = Array.from({ length: NUM_COLORS }, () => []);
  for (const c of cards) out[cardColor(c)].push(c);
  return out;
};
const topOf = (pile) => (pile.length ? pile[pile.length - 1] : -1);
const vals = (cards) => cards.filter((c) => !isWager(c)).map(cardValue).sort((a, b) => a - b);

/** 카드 이름. 예: '빨강 7', '초록 투자'. */
export function cardNameKo(card) {
  return `${COLOR_NAMES_KO[cardColor(card)]} ${isWager(card) ? '투자' : cardValue(card)}`;
}

/**
 * 한 색의 예상 최종 점수와 그 구성. projected는 rule.colorValue와 같은 값.
 */
export function colorProjection(exp, handCol, unseenCol, ctx) {
  const e = expInfo(exp);
  const handPlayable = handCol.filter((c) => !isWager(c) && cardValue(c) > e.top);
  const handWagers = e.hasNum ? 0 : handCol.filter(isWager).length;
  const unseenAbove = unseenCol.filter((c) => !isWager(c) && cardValue(c) > e.top);
  const handSum = handPlayable.reduce((t, c) => t + cardValue(c), 0);
  const unSum = unseenAbove.reduce((t, c) => t + cardValue(c), 0);
  const { w, q } = ctx;
  const S = e.sum + w * handSum + q * unSum;
  const N = e.len + w * handPlayable.length + q * unseenAbove.length;
  let best = -Infinity, bestK = 0, bestMult = 1, bestBonus = 0;
  for (let k = 0; k <= handWagers; k++) {
    const mult = 1 + e.wagers + w * k;
    const n = N + w * k;
    const bonus = 20 * Math.min(1, Math.max(0, (n - 6) / 2));
    const v = (S - 20) * mult + bonus;
    if (v > best) { best = v; bestK = k; bestMult = mult; bestBonus = bonus; }
  }
  const started = e.len > 0;
  return {
    started,
    current: expeditionScore(exp),
    placedSum: e.sum,
    top: e.top,
    wagersPlaced: e.wagers,
    handPlayable,
    handWagers,
    wagersUsed: bestK,
    unseenAbove,
    expectedSum: S,
    expectedCount: N,
    multiplier: bestMult,
    bonus: bestBonus,
    raw: best,
    projected: started ? best : Math.max(0, best),
    worthStarting: !started && best > 0,
  };
}

/** 관측자 시점 맥락: 남은 차례, 가중치, 미확인 카드. rule.js의 context와 같은 값. */
export function viewContext(obs, P = RULE_DEFAULTS) {
  const unseen = unseenCards(obs);
  const D = obs.deckCount;
  const meToMove = obs.current === obs.player;
  const myTurns = meToMove ? Math.ceil(D / 2) : Math.floor(D / 2);
  const oppTurns = meToMove ? Math.floor(D / 2) : Math.ceil(D / 2);
  let planned = 0;
  for (const c of obs.hand) if (canPlace(obs.myExpeditions[cardColor(c)], c)) planned++;
  const w = P.handWeight * Math.min(1, myTurns / Math.max(1, planned));
  const q = unseen.length ? Math.min(1, (P.drawShare * Math.max(0, myTurns - 1)) / unseen.length) : 0;
  // AI: 손패를 모르므로 남은 차례 제한은 덜 정확하다. 미확인 카드가 AI 손에 있을 확률 = 모르는 AI 손패 수 / 미확인 수
  const hidden = obs.opponentHandCount - obs.opponentKnownCards.length;
  const wOpp = P.handWeight;
  const inHand = unseen.length ? hidden / unseen.length : 0;
  const qOpp = unseen.length ? Math.min(1, (P.drawShare * Math.max(0, oppTurns - 1)) / unseen.length + wOpp * inHand) : 0;
  return { unseen, unseenBy: byColor(unseen), deckCount: D, myTurns, oppTurns, planned, w, q, wOpp, qOpp, hidden, P };
}

/** 양쪽 색별 예상 최종 점수. */
export function projectPosition(obs, ctx = viewContext(obs)) {
  const handBy = byColor(obs.hand);
  const knownBy = byColor(obs.opponentKnownCards);
  const me = obs.myExpeditions.map((e, c) => colorProjection(e, handBy[c], ctx.unseenBy[c], ctx));
  const opp = obs.oppExpeditions.map((e, c) => colorProjection(e, knownBy[c], ctx.unseenBy[c], { w: ctx.wOpp, q: ctx.qOpp }));
  const sum = (xs, k) => xs.reduce((t, x) => t + x[k], 0);
  return {
    me,
    opp,
    current: [sum(me, 'current'), sum(opp, 'current')],
    projected: [sum(me, 'projected'), sum(opp, 'projected')],
    myTurns: ctx.myTurns,
    oppTurns: ctx.oppTurns,
    planned: ctx.planned,
    deckCount: ctx.deckCount,
  };
}

// 조사: 마지막 글자의 받침 여부로 고른다. 숫자는 한국어 읽기 기준 (3 삼, 6 육, 7 칠, 8 팔, 10 십은 받침 있음).
function hasBatchim(word) {
  const last = String(word).trim().slice(-1);
  if (/[0-9]/.test(last)) {
    if (/10$/.test(String(word).trim())) return true;
    return '3678'.includes(last) || last === '0' || last === '1';
  }
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}
/** josa('빨강 6', '을', '를') → '빨강 6을' */
export const josa = (word, withB, withoutB) => `${word}${hasBatchim(word) ? withB : withoutB}`;

const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (x) => {
  const v = r1(x);
  return v > 0 ? `+${v}` : `${v}`;
};
const list = (cards) => vals(cards).join('·');

/**
 * 한 수의 정적 평가를 분해하고 근거 문장을 만든다.
 * @returns {{
 *   value: number,        // 규칙 봇 평가값 (rule.scoreMoves와 같음)
 *   colorDelta: number[], // 색별 내 예상 점수 변화 (뽑기 포함, 덱 뽑기 기대 제외)
 *   deckGain: number,     // 덱 뽑기 기대 이득 (덱에서 뽑을 때만)
 *   giftCost: number,     // 상대에게 줄 위험 (giftWeight 적용 후, 뺄 값)
 *   effects: { play, draw, gift, total }, // 현재 국면 대비 효과. 수 사이 비교는 total로 (value와 순위 같음)
 *   reasons: { text: string, delta: number|null, kind: string }[]
 * }}
 */
export function explainMove(obs, move, ctx = viewContext(obs)) {
  const P = ctx.P;
  const { card, target, draw } = move;
  const color = cardColor(card);
  const handBy0 = byColor(obs.hand);
  const before = obs.myExpeditions.map((e, c) => colorProjection(e, handBy0[c], ctx.unseenBy[c], ctx));

  // 놓기 후
  const exps = obs.myExpeditions.map((e) => e.slice());
  const piles = obs.discards.map((d) => d.slice());
  const hand = obs.hand.filter((c) => c !== card);
  if (target === EXPEDITION) exps[color].push(card);
  else piles[color].push(card);
  const handByMid = byColor(hand);
  const mid = exps.map((e, c) => colorProjection(e, handByMid[c], ctx.unseenBy[c], ctx)); // 놓기만 한 상태
  // 뽑기 후
  let drawn = -1;
  if (draw !== DECK) {
    drawn = piles[draw].pop();
    hand.push(drawn);
  }
  const handBy = byColor(hand);
  const after = exps.map((e, c) => colorProjection(e, handBy[c], ctx.unseenBy[c], ctx));
  const colorDelta = after.map((a, c) => a.projected - before[c].projected);

  let deckGain = 0;
  let usefulUnseen = 0;
  if (draw === DECK && ctx.unseen.length) {
    let total = 0;
    for (let c = 0; c < NUM_COLORS; c++) {
      const col = ctx.unseenBy[c];
      if (!col.length) continue;
      const base = after[c].projected;
      for (const u of col) {
        const g = colorProjection(exps[c], [...handBy[c], u], col.filter((x) => x !== u), ctx).projected - base;
        total += g;
        if (g > 0.5) usefulUnseen++;
      }
    }
    deckGain = total / ctx.unseen.length;
  }

  let gift = 0;
  let giftBefore = 0;
  for (let c = 0; c < NUM_COLORS; c++) {
    gift += giftValue(topOf(piles[c]), obs.oppExpeditions[c], P);
    giftBefore += giftValue(topOf(obs.discards[c]), obs.oppExpeditions[c], P);
  }
  const giftCost = P.giftWeight * gift;
  const value = after.reduce((t, a) => t + a.projected, 0) + deckGain - giftCost;
  // 효과 분해 (모든 수에 공통인 현재 국면 값을 뺀 것). 합 = value − (현재 예상 합 − 현재 위험)
  const effects = {
    play: mid.reduce((t, x, c) => t + x.projected - before[c].projected, 0),
    draw: after.reduce((t, x, c) => t + x.projected - mid[c].projected, 0) + deckGain,
    gift: -P.giftWeight * (gift - giftBefore),
  };
  effects.total = effects.play + effects.draw + effects.gift;

  // ---- 근거 문장 ----
  const reasons = [];
  const name = COLOR_NAMES_KO[color];
  const b = before[color];
  const a = mid[color];
  const playDelta = a.projected - b.projected;
  const oppExp = obs.oppExpeditions[color];
  const oi = expInfo(oppExp);

  if (target === EXPEDITION) {
    if (isWager(card)) {
      reasons.push({
        kind: 'play',
        text: `${name} 투자: 배수 ×${1 + b.wagersPlaced} → ×${2 + b.wagersPlaced}. ${name} 예상 ${fmt(b.projected)} → ${fmt(a.projected)}` +
          (a.projected < 0 ? ' (적자 위험: 이어 놓을 카드가 부족하면 손해가 커진다)' : ''),
        delta: playDelta,
      });
    } else if (!b.started) {
      const more = [];
      if (a.handPlayable.length) more.push(`손패 ${name} ${list(a.handPlayable)}`);
      if (a.unseenAbove.length) more.push(`미확인 ${name} ${a.unseenAbove.length}장`);
      reasons.push({
        kind: 'play',
        text: `${name} 탐험대 시작 (${cardValue(card)}): ${name} 예상 ${fmt(b.projected)} → ${fmt(a.projected)}` +
          (more.length ? ` — 이어 놓을 후보: ${more.join(', ')}` : '') +
          (a.projected < 0 ? '. 비용 20을 못 넘을 가능성이 크다' : ''),
        delta: playDelta,
      });
    } else {
      reasons.push({
        kind: 'play',
        text: `${name} 탐험대에 ${cardValue(card)} 추가: ${name} 예상 ${fmt(b.projected)} → ${fmt(a.projected)}`,
        delta: playDelta,
      });
    }
    // 건너뛰어 못 쓰게 되는 손패
    if (!isWager(card)) {
      const skipped = obs.hand.filter((c) => c !== card && cardColor(c) === color && !isWager(c) && cardValue(c) > b.top && cardValue(c) < cardValue(card));
      if (skipped.length) {
        reasons.push({ kind: 'skip', text: `${josa(String(cardValue(card)), '을', '를')} 먼저 놓으면 손패 ${josa(`${name} ${list(skipped)}`, '은', '는')} 더 놓을 수 없다`, delta: null });
      }
      const unseenSkipped = b.unseenAbove.filter((c) => cardValue(c) < cardValue(card));
      if (unseenSkipped.length) {
        reasons.push({
          kind: 'skip',
          text: `아직 안 나온 ${josa(`${name} ${list(unseenSkipped)}`, '은', '는')} 뽑아도 더는 놓을 수 없게 된다 (그 기대분 −${r1(ctx.q * unseenSkipped.reduce((t, c) => t + cardValue(c), 0) * b.multiplier)})`,
          delta: null,
        });
      }
    }
  } else {
    if (Math.abs(playDelta) < 0.5) {
      reasons.push({
        kind: 'discard',
        text: `${cardNameKo(card)} 버리기: 내 ${name} 예상에는 영향이 거의 없다` +
          (isWager(card) && b.top > 0 ? ` (${name}에 이미 숫자 카드가 있어 투자 카드는 놓을 수 없다)`
            : !isWager(card) && b.started && cardValue(card) <= b.top ? ` (이미 ${b.top}까지 놓아 쓸 수 없는 카드)`
            : !b.started && !b.worthStarting ? ` (${josa(name, '은', '는')} 지금 시작하면 손해로 보는 색)` : ''),
        delta: playDelta,
      });
    } else {
      reasons.push({ kind: 'discard', text: `${cardNameKo(card)} 버리기: 내 ${name} 예상 ${fmt(b.projected)} → ${fmt(a.projected)}`, delta: playDelta });
    }
    const g = giftValue(card, oppExp, P);
    if (g > 0) {
      const where = oi.len === 0 ? `AI는 ${josa(name, '을', '를')} 아직 시작하지 않았지만 새로 시작하는 데 쓸 수 있다`
        : isWager(card) ? `AI ${name} 탐험대는 아직 숫자 카드가 없어 투자 카드를 더 놓을 수 있다`
        : `AI ${name} 탐험대(맨 위 ${oi.top})에 바로 이어지는 카드다`;
      reasons.push({ kind: 'gift', text: `AI에게 줄 위험: ${where} (위험도 ${fmt(-P.giftWeight * g)})`, delta: -P.giftWeight * g });
    }
    const covered = topOf(obs.discards[color]);
    if (covered >= 0 && giftValue(covered, oppExp, P) > 0 && draw !== color) {
      reasons.push({ kind: 'cover', text: `AI가 가져갈 수 있던 ${josa(cardNameKo(covered), '을', '를')} 덮는다`, delta: P.giftWeight * giftValue(covered, oppExp, P) });
    }
  }

  if (draw === DECK) {
    reasons.push({
      kind: 'draw',
      text: `덱에서 뽑기: 기대 ${fmt(deckGain)} (미확인 ${ctx.unseen.length}장 중 내게 쓸모 있는 카드 약 ${usefulUnseen}장). 덱이 1장 줄어 라운드 끝이 가까워진다`,
      delta: deckGain,
    });
  } else {
    const dName = COLOR_NAMES_KO[draw];
    const md = mid[draw];
    const ad = after[draw];
    reasons.push({
      kind: 'draw',
      text: `${dName} 더미에서 ${cardNameKo(drawn)} 가져오기: 내 ${dName} 예상 ${fmt(md.projected)} → ${fmt(ad.projected)}. 덱은 줄지 않아 라운드가 길어진다`,
      delta: ad.projected - md.projected,
    });
    const deny = giftValue(drawn, obs.oppExpeditions[draw], P);
    if (deny > 0) reasons.push({ kind: 'deny', text: `AI도 쓸 수 있는 카드를 먼저 가져간다`, delta: null });
    const revealed = topOf(piles[draw]);
    if (revealed >= 0 && giftValue(revealed, obs.oppExpeditions[draw], P) > 0) {
      reasons.push({ kind: 'gift', text: `그 아래 ${josa(cardNameKo(revealed), '이', '가')} 드러나 AI가 가져갈 수 있다`, delta: -P.giftWeight * giftValue(revealed, obs.oppExpeditions[draw], P) });
    }
  }

  // 템포
  const plannedAfter = hand.filter((c) => canPlace(exps[cardColor(c)], c)).length;
  const turnsAfter = ctx.myTurns - 1;
  if (plannedAfter > turnsAfter && turnsAfter >= 0) {
    reasons.push({ kind: 'tempo', text: `남은 내 차례 약 ${turnsAfter}번인데 놓을 수 있는 손패가 ${plannedAfter}장이라 다 놓기 어렵다`, delta: null });
  }

  return { value, effects, colorDelta, deckGain, giftCost, before, after, reasons };
}
