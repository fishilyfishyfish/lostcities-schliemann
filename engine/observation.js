// 관측 객체: 한 플레이어 시점에서 알 수 있는 정보만 담은 깊은 복사본.
// 상대 손패와 덱 순서는 절대 들어가지 않는다 (test/observation.test.js에서 검증).

import { DECK, generateMoves } from './rules.js';
import { playerScore } from './scoring.js';

/**
 * @returns {{
 *   player: 0|1, current: 0|1, turn: number, over: boolean, startingPlayer: 0|1,
 *   hand: number[], opponentHandCount: number, deckCount: number,
 *   myExpeditions: number[][], oppExpeditions: number[][], discards: number[][],
 *   history: {player, card, target, draw, drawnCard: number|null}[],
 *   opponentKnownCards: number[],
 *   scores: {perColor: number[], total: number}[]  // [나, 상대], 현재 탐험대 기준
 * }}
 */
export function observe(state, player) {
  if (player !== 0 && player !== 1) throw new Error('player must be 0 or 1');
  const opp = 1 - player;
  const history = state.history.map((h) => ({
    player: h.player,
    card: h.card,
    target: h.target,
    draw: h.draw,
    // 버림 더미에서 가져간 카드는 공개, 덱에서 뽑은 카드는 (자기 것이라도) 기록에 남기지 않는다.
    drawnCard: h.draw === DECK ? null : h.drawnCard,
  }));
  const myExpeditions = state.expeditions[player].map((e) => e.slice());
  const oppExpeditions = state.expeditions[opp].map((e) => e.slice());
  return {
    player,
    current: state.current,
    turn: state.turn,
    over: state.over,
    startingPlayer: state.startingPlayer,
    hand: state.hands[player].slice().sort((a, b) => a - b),
    opponentHandCount: state.hands[opp].length,
    deckCount: state.deck.length,
    myExpeditions,
    oppExpeditions,
    discards: state.discards.map((d) => d.slice()),
    history,
    opponentKnownCards: knownCardsInHand(history, opp),
    scores: [playerScore(myExpeditions), playerScore(oppExpeditions)],
  };
}

/** 공개 기록만으로 계산: 해당 플레이어가 버림 더미에서 가져가서 아직 내지 않은 카드. */
export function knownCardsInHand(history, who) {
  const known = new Set();
  for (const h of history) {
    if (h.player !== who) continue;
    known.delete(h.card);
    if (h.drawnCard !== null && h.draw !== DECK) known.add(h.drawnCard);
  }
  return [...known].sort((a, b) => a - b);
}

/** 관측 객체만으로 합법수 계산. 자기 차례가 아니거나 라운드가 끝났으면 빈 배열. */
export function legalMovesFromObservation(obs) {
  if (obs.over || obs.current !== obs.player) return [];
  return generateMoves(obs.hand, obs.myExpeditions, obs.discards);
}
