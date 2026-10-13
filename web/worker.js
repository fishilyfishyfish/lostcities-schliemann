// 엔진은 이 워커 안에서만 돈다. 메인 스레드는 사람(player 0)의 관측 객체와 합법수만 받는다.
import { AGENTS, Game, legalMovesFromObservation, randomSeed } from '../engine/index.js';

const HUMAN = 0;
const AI = 1;
const AI_DELAY_MS = 700;

let game = null;
let ai = null;
let timer = null;
let seed = 0;

function send() {
  const obs = game.observe(HUMAN);
  const msg = { type: 'update', seed, obs, legalMoves: legalMovesFromObservation(obs), final: null };
  if (game.over) {
    const s = game.scores();
    msg.final = { scores: [s[HUMAN], s[AI]], aiHand: game.revealHands()[AI] };
  }
  postMessage(msg);
}

function scheduleAi() {
  clearTimeout(timer);
  if (game.over || game.current !== AI) return;
  timer = setTimeout(() => {
    const obs = game.observe(AI);
    game.play(ai.chooseMove(obs, legalMovesFromObservation(obs)));
    send();
    scheduleAi();
  }, AI_DELAY_MS);
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'new') {
      clearTimeout(timer);
      seed = Number.isInteger(msg.seed) ? msg.seed >>> 0 : randomSeed();
      const startingPlayer = msg.startingPlayer ?? (Math.random() < 0.5 ? HUMAN : AI);
      game = new Game({ seed, startingPlayer });
      const make = AGENTS[msg.ai] ?? AGENTS.rule;
      ai = make(seed ^ 0x9e3779b9);
      send();
      scheduleAi();
    } else if (msg.type === 'move') {
      if (!game || game.over || game.current !== HUMAN) throw new Error('not your turn');
      game.play(msg.move);
      send();
      scheduleAi();
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err.message ?? err) });
  }
};
