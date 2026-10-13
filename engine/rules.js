// 전체 정보 상태를 다루는 내부 계층. 에이전트에게 이 상태를 직접 넘기지 않는다 (observation.js 참고).

import { ALL_CARDS, DECK_SIZE, HAND_SIZE, NUM_COLORS, cardColor, cardValue, isWager } from './cards.js';
import { mulberry32, shuffle } from './rng.js';
import { playerScore } from './scoring.js';

export const EXPEDITION = 'expedition';
export const DISCARD = 'discard';
export const DECK = 'deck';

const emptyPiles = () => Array.from({ length: NUM_COLORS }, () => []);

/**
 * 새 라운드 상태.
 * - deck: 덱 순서를 직접 지정 (배열 끝이 맨 위). 미러 대국/테스트용. 없으면 seed로 셔플.
 * - startingPlayer: 0 또는 1.
 * 손패는 덱 맨 위에서 번갈아 8장씩 나눈다 (선부터).
 */
export function newRound({ seed = 0, deck = null, startingPlayer = 0 } = {}) {
  let cards;
  if (deck) {
    if (deck.length !== DECK_SIZE || new Set(deck).size !== DECK_SIZE || deck.some((c) => !(c >= 0 && c < DECK_SIZE))) {
      throw new Error('deck must be a permutation of 0..59');
    }
    cards = deck.slice();
  } else {
    cards = shuffle(ALL_CARDS.slice(), mulberry32(seed));
  }
  const hands = [[], []];
  for (let i = 0; i < HAND_SIZE * 2; i++) {
    hands[(startingPlayer + i) % 2].push(cards.pop());
  }
  return {
    deck: cards,
    hands,
    expeditions: [emptyPiles(), emptyPiles()],
    discards: emptyPiles(),
    current: startingPlayer,
    startingPlayer,
    turn: 0,
    over: false,
    // { player, card, target, draw, drawnCard }. drawnCard는 덱에서 뽑았으면 비공개 정보.
    history: [],
  };
}

export function cloneState(s) {
  return {
    deck: s.deck.slice(),
    hands: [s.hands[0].slice(), s.hands[1].slice()],
    expeditions: s.expeditions.map((p) => p.map((e) => e.slice())),
    discards: s.discards.map((d) => d.slice()),
    current: s.current,
    startingPlayer: s.startingPlayer,
    turn: s.turn,
    over: s.over,
    history: s.history.map((h) => ({ ...h })),
  };
}

/** 오름차순 규칙. 투자 카드(0)는 숫자 카드가 없을 때만, 숫자 카드는 마지막 카드보다 커야 함. */
export function canPlace(expedition, card) {
  if (expedition.length === 0) return true;
  const top = cardValue(expedition[expedition.length - 1]);
  const v = cardValue(card);
  return isWager(card) ? top === 0 : v > top;
}

/**
 * 합법수 생성. 상태가 아니라 (손패, 자기 탐험대, 버림 더미)만 받으므로 관측 객체에서도 그대로 쓴다.
 * 같은 색 투자 카드는 동등하므로 가장 작은 id 하나만 생성한다.
 */
export function generateMoves(hand, myExpeditions, discards) {
  const moves = [];
  const seenWagerColor = new Set();
  const sorted = hand.slice().sort((a, b) => a - b);
  for (const card of sorted) {
    const color = cardColor(card);
    if (isWager(card)) {
      if (seenWagerColor.has(color)) continue;
      seenWagerColor.add(color);
    }
    const targets = canPlace(myExpeditions[color], card) ? [EXPEDITION, DISCARD] : [DISCARD];
    for (const target of targets) {
      moves.push({ card, target, draw: DECK });
      for (let c = 0; c < NUM_COLORS; c++) {
        if (discards[c].length === 0) continue;
        if (target === DISCARD && c === color) continue; // 방금 버린 카드 재획득 금지
        moves.push({ card, target, draw: c });
      }
    }
  }
  return moves;
}

export function legalMoves(state) {
  if (state.over) return [];
  const p = state.current;
  return generateMoves(state.hands[p], state.expeditions[p], state.discards);
}

/** 수가 합법인지 검사. 문제가 있으면 이유 문자열, 없으면 null. */
export function moveError(state, move) {
  if (state.over) return 'round is over';
  if (!move || typeof move !== 'object') return 'move must be an object';
  const { card, target, draw } = move;
  const p = state.current;
  const hand = state.hands[p];
  if (!hand.includes(card)) return 'card not in hand';
  const color = cardColor(card);
  if (target === EXPEDITION) {
    if (!canPlace(state.expeditions[p][color], card)) {
      return isWager(card) ? 'wager after number card' : 'not ascending';
    }
  } else if (target !== DISCARD) {
    return 'bad target';
  }
  if (draw === DECK) {
    if (state.deck.length === 0) return 'deck empty';
  } else if (Number.isInteger(draw) && draw >= 0 && draw < NUM_COLORS) {
    if (target === DISCARD && draw === color) return 'cannot redraw the card just discarded';
    if (state.discards[draw].length === 0) return 'discard pile empty';
  } else {
    return 'bad draw source';
  }
  return null;
}

/** 수 적용 (상태를 직접 바꿈). 불법이면 throw. 덱 마지막 장을 뽑으면 라운드 종료. */
export function applyMove(state, move) {
  const err = moveError(state, move);
  if (err) throw new Error(`illegal move: ${err}`);
  const { card, target, draw } = move;
  const p = state.current;
  const hand = state.hands[p];
  hand.splice(hand.indexOf(card), 1);
  const color = cardColor(card);
  if (target === EXPEDITION) state.expeditions[p][color].push(card);
  else state.discards[color].push(card);

  const drawnCard = draw === DECK ? state.deck.pop() : state.discards[draw].pop();
  hand.push(drawnCard);

  state.history.push({ player: p, card, target, draw, drawnCard });
  state.turn++;
  if (state.deck.length === 0) state.over = true;
  else state.current = 1 - p;
  return state;
}

export function scores(state) {
  return [playerScore(state.expeditions[0]), playerScore(state.expeditions[1])];
}
