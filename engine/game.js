import { applyMove, legalMoves, newRound, scores } from './rules.js';
import { legalMovesFromObservation, observe } from './observation.js';

/**
 * 한 라운드 진행자. 전체 상태는 private 필드에만 있어 외부(에이전트, UI)에서 읽을 수 없다.
 * 밖으로 나가는 것은 관측 객체(observe), 현재 차례 합법수, 점수, 라운드가 끝난 뒤의 손패 공개뿐.
 */
export class Game {
  #state;

  constructor(opts = {}) {
    this.#state = newRound(opts);
  }

  get current() { return this.#state.current; }
  get over() { return this.#state.over; }
  get deckCount() { return this.#state.deck.length; }
  get turn() { return this.#state.turn; }

  observe(player) {
    return observe(this.#state, player);
  }

  /** 현재 차례 플레이어의 합법수 (그 플레이어의 관측에서 계산한 것과 같다). */
  legalMoves() {
    return legalMoves(this.#state);
  }

  /** 현재 차례 플레이어의 수를 적용. 불법이면 throw. */
  play(move) {
    applyMove(this.#state, { card: move.card, target: move.target, draw: move.draw });
  }

  /** [player0, player1] 각각 { perColor, total }. 탐험대는 공개 정보라 언제든 조회 가능. */
  scores() {
    return scores(this.#state);
  }

  /** 라운드가 끝난 뒤에만 남은 손패를 공개. */
  revealHands() {
    if (!this.#state.over) throw new Error('hands are hidden until the round is over');
    return this.#state.hands.map((h) => h.slice().sort((a, b) => a - b));
  }

  toJSON() {
    return {};
  }
}

export const DEFAULT_MAX_TURNS = 1000;

/**
 * 에이전트 두 개로 한 라운드를 끝까지 진행.
 * 에이전트 인터페이스: chooseMove(observation, legalMoves) → move. 상태나 Game에는 접근할 수 없다.
 * 룰에는 라운드 길이 제한이 없어서 양쪽이 버림 더미에서만 뽑으면 끝나지 않는다.
 * maxTurns를 넘기면 그 자리에서 멈추고 stalled: true로 돌려준다 (집계 방법은 eval.js가 정함).
 * @returns {{ scores: number[], turns: number, stalled: boolean, history }}  history는 관측 형식
 */
export function playRound(agents, opts = {}) {
  const game = new Game(opts);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let stalled = false;
  while (!game.over) {
    if (game.turn >= maxTurns) {
      stalled = true;
      break;
    }
    const p = game.current;
    const obs = game.observe(p);
    const moves = legalMovesFromObservation(obs);
    const move = agents[p].chooseMove(obs, moves);
    game.play(move);
  }
  const s = game.scores();
  return {
    scores: [s[0].total, s[1].total],
    turns: game.turn,
    stalled,
    history: opts.keepHistory === false ? null : game.observe(0).history,
  };
}
