// 엔진은 이 워커 안에서만 돈다. 메인 스레드는 사람(player 0)의 관측 객체와 합법수만 받는다.
import { Game, legalMovesFromObservation, randomSeed, cardTracker, analyzeMoves } from '../engine/index.js';
import { agentFactory } from '../engine/agents/index.js';

// 웹에서 고를 수 있는 AI.
const WEB_AIS = {
  mcts: 'mcts', // 측정한 기본값 그대로 (2000회 반복, 한 수 약 50ms)
  rule: 'rule',
  random: 'random',
};

const HUMAN = 0;
const AI = 1;
const AI_DELAY_MS = 700;
const ANALYSIS_MS = 1500;

let game = null;
let ai = null;
let timer = null;
let seed = 0;

function send() {
  const obs = game.observe(HUMAN);
  const msg = {
    type: 'update',
    seed,
    obs,
    legalMoves: legalMovesFromObservation(obs),
    tracker: cardTracker(obs),
    final: null,
  };
  if (game.over) {
    const s = game.scores();
    msg.final = { scores: [s[HUMAN], s[AI]], aiHand: game.revealHands()[AI] };
  }
  postMessage(msg);
}

function scheduleAi() {
  clearTimeout(timer);
  if (game.over || game.current !== AI) return;
  // 생각하는 시간이 지연보다 짧으면 남은 만큼 기다렸다가 둔다 (사람이 AI 수를 볼 수 있게)
  timer = setTimeout(() => {
    const t0 = Date.now();
    const obs = game.observe(AI);
    const move = ai.chooseMove(obs, legalMovesFromObservation(obs));
    timer = setTimeout(() => {
      game.play(move);
      send();
      scheduleAi();
    }, Math.max(0, AI_DELAY_MS - (Date.now() - t0)));
  }, 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'new') {
      clearTimeout(timer);
      seed = Number.isInteger(msg.seed) ? msg.seed >>> 0 : randomSeed();
      const startingPlayer = msg.startingPlayer ?? (Math.random() < 0.5 ? HUMAN : AI);
      game = new Game({ seed, startingPlayer });
      ai = agentFactory(WEB_AIS[msg.ai] ?? WEB_AIS.mcts)(seed ^ 0x9e3779b9);
      send();
      scheduleAi();
    } else if (msg.type === 'analyze') {
      // 사람 시점 관측 객체만으로 분석한다
      if (!game || game.over || game.current !== HUMAN) throw new Error('analysis is only available on your turn');
      const obs = game.observe(HUMAN);
      const result = analyzeMoves(obs, { timeMs: ANALYSIS_MS, seed: seed ^ obs.turn });
      postMessage({ type: 'analysis', turn: obs.turn, result });
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
