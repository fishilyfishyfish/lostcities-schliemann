// 탐색용 시뮬레이션 계층. 에이전트가 자기 관측에서 만들어 낸 가상의 상태만 다룬다.
// 실제 게임 상태(Game의 #state)에는 여전히 접근할 수 없다: determinize는 관측 객체만 입력으로 받는다.

import { ALL_CARDS, NUM_COLORS, cardColor } from './cards.js';
import { shuffle } from './rng.js';
import { DECK, DISCARD, EXPEDITION, canPlace } from './rules.js';
import { expeditionScore } from './scoring.js';

/**
 * 관측 객체에서 보이지 않는 카드 목록: 덱 + 상대의 미공개 손패.
 * 60장 − 내 손패 − 양쪽 탐험대 − 버림 더미 − 상대가 버림 더미에서 가져가 들고 있는 카드.
 */
export function unseenCards(obs) {
  const seen = new Uint8Array(ALL_CARDS.length);
  const mark = (c) => { seen[c] = 1; };
  obs.hand.forEach(mark);
  obs.myExpeditions.forEach((e) => e.forEach(mark));
  obs.oppExpeditions.forEach((e) => e.forEach(mark));
  obs.discards.forEach((d) => d.forEach(mark));
  obs.opponentKnownCards.forEach(mark);
  const out = [];
  for (let c = 0; c < ALL_CARDS.length; c++) if (!seen[c]) out.push(c);
  return out;
}

/**
 * 관측과 모순되지 않는 전체 상태를 하나 샘플링 (결정화).
 * 상대 손패 = 알려진 카드 + 보이지 않는 카드 중 무작위, 덱 = 나머지를 무작위 순서로.
 * withHistory: 관측 기록을 상태에 복사 (observe로 되돌려 볼 때만 필요. 시뮬레이션에는 불필요).
 */
export function determinize(obs, rng, { withHistory = false } = {}) {
  const me = obs.player;
  const opp = 1 - me;
  const pool = shuffle(unseenCards(obs), rng);
  const need = obs.opponentHandCount - obs.opponentKnownCards.length;
  if (need < 0 || pool.length - need !== obs.deckCount) {
    throw new Error(`inconsistent observation: pool ${pool.length}, need ${need}, deck ${obs.deckCount}`);
  }
  const hands = [null, null];
  hands[me] = obs.hand.slice();
  hands[opp] = obs.opponentKnownCards.concat(pool.slice(0, need));
  const expeditions = [null, null];
  expeditions[me] = obs.myExpeditions.map((e) => e.slice());
  expeditions[opp] = obs.oppExpeditions.map((e) => e.slice());
  return {
    deck: pool.slice(need),
    hands,
    expeditions,
    discards: obs.discards.map((d) => d.slice()),
    current: obs.current,
    startingPlayer: obs.startingPlayer,
    turn: obs.turn,
    over: obs.over,
    history: withHistory ? obs.history.map((h) => ({ ...h })) : [],
  };
}

/** 기록 없이 상태 복사 (시뮬레이션용). */
export function cloneSimState(s) {
  return {
    deck: s.deck.slice(),
    hands: [s.hands[0].slice(), s.hands[1].slice()],
    expeditions: [s.expeditions[0].map((e) => e.slice()), s.expeditions[1].map((e) => e.slice())],
    discards: s.discards.map((d) => d.slice()),
    current: s.current,
    startingPlayer: s.startingPlayer,
    turn: s.turn,
    over: s.over,
    history: [],
  };
}

/** 검사·기록 없이 수 적용. 합법수만 넘길 것 (rules.applyMove와 결과 동일, 기록만 없음). */
export function simStep(s, card, target, draw) {
  const p = s.current;
  const hand = s.hands[p];
  const i = hand.indexOf(card);
  hand[i] = hand[hand.length - 1];
  hand.pop();
  const color = cardColor(card);
  if (target === EXPEDITION) s.expeditions[p][color].push(card);
  else s.discards[color].push(card);
  hand.push(draw === DECK ? s.deck.pop() : s.discards[draw].pop());
  s.turn++;
  if (s.deck.length === 0) s.over = true;
  else s.current = 1 - p;
}

const drawBuf = new Int8Array(NUM_COLORS + 1);

/**
 * 무작위 플레이아웃: 카드 균등 → 가능한 대상 균등 → 가능한 뽑을 곳 균등. 배열 할당 없음.
 * 합법수 목록 전체에 대해 균등하지는 않다 (속도 우선). maxTurns를 넘기면 그 시점에서 멈춘다.
 * @returns {number[]} [p0 점수, p1 점수]
 */
export function randomPlayout(s, rng, maxTurns = 1000) {
  const limit = s.turn + maxTurns;
  while (!s.over && s.turn < limit) {
    const p = s.current;
    const hand = s.hands[p];
    const card = hand[Math.floor(rng() * hand.length)];
    const color = cardColor(card);
    const target = canPlace(s.expeditions[p][color], card) && rng() < 0.5 ? EXPEDITION : DISCARD;
    let n = 0;
    drawBuf[n++] = -1; // 덱
    for (let c = 0; c < NUM_COLORS; c++) {
      if (c === color && target === DISCARD) continue;
      if (s.discards[c].length) drawBuf[n++] = c;
    }
    const d = drawBuf[Math.floor(rng() * n)];
    simStep(s, card, target, d < 0 ? DECK : d);
  }
  return [totalScore(s.expeditions[0]), totalScore(s.expeditions[1])];
}

export function totalScore(exps) {
  let t = 0;
  for (let c = 0; c < NUM_COLORS; c++) t += expeditionScore(exps[c]);
  return t;
}
