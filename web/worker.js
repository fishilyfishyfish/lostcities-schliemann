// 엔진은 이 워커 안에서만 돈다. 메인 스레드는 "지금 화면을 보는 플레이어"의 관측 객체와 합법수만 받는다.
//
// 두 가지 모드:
//   ai  : 사람(player 0) vs AI(player 1). 화면을 보는 사람은 항상 player 0.
//   pvp : 한 화면에서 번갈아 두는 2인 플레이 (플레이 방법을 보여주는 용도). 가리는 과정 없이, 수를 두면 곧바로
//         다음 차례 사람 시점의 화면을 보낸다. 라운드가 끝나면 두 손패를 모두 공개한다.
import { Game, legalMovesFromObservation, randomSeed, cardTracker, analyzeMoves } from '../engine/index.js';
import { agentFactory } from '../engine/agents/index.js';

// AI 종류. 화면에는 가장 센 mcts만 노출한다 (측정: 규칙 봇 대비 판당 +3.6점).
// 나머지는 개발·확인용으로 주소에 ?ai=rule 또는 ?ai=random을 붙였을 때만 쓴다.
const WEB_AIS = {
  mcts: 'mcts', // 측정한 기본값 그대로 (2000회 반복, 한 수 약 50ms)
  rule: 'rule',
  random: 'random',
};

const HUMAN = 0;
const AI = 1;
const AI_DELAY_MS = 700;
const ANALYSIS_MS = 1500;

let mode = 'ai';
let game = null;
let ai = null;
let timer = null;
let seed = 0;

function finalInfo() {
  const s = game.scores();
  return { scores: [s[0], s[1]], hands: game.revealHands() };
}

/** viewer 시점 화면 갱신. */
function sendUpdate(viewer) {
  const obs = game.observe(viewer);
  postMessage({
    type: 'update',
    mode,
    seed,
    viewer,
    obs,
    legalMoves: legalMovesFromObservation(obs),
    tracker: cardTracker(obs),
    final: game.over ? finalInfo() : null,
  });
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
      sendUpdate(HUMAN);
      scheduleAi();
    }, Math.max(0, AI_DELAY_MS - (Date.now() - t0)));
  }, 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'new') {
      clearTimeout(timer);
      mode = msg.mode === 'pvp' ? 'pvp' : 'ai';
      seed = Number.isInteger(msg.seed) ? msg.seed >>> 0 : randomSeed();
      const startingPlayer = msg.startingPlayer ?? (Math.random() < 0.5 ? 0 : 1);
      game = new Game({ seed, startingPlayer });
      if (mode === 'pvp') {
        ai = null;
        sendUpdate(game.current);
        return;
      }
      ai = agentFactory(WEB_AIS[msg.ai] ?? WEB_AIS.mcts)(seed ^ 0x9e3779b9);
      sendUpdate(HUMAN);
      scheduleAi();
    } else if (msg.type === 'analyze') {
      // 사람 시점 관측 객체만으로 분석한다. 문구가 AI 상대 기준이라 2인 플레이에서는 쓰지 않는다.
      if (!game || mode !== 'ai' || game.over || game.current !== HUMAN) {
        throw new Error('analysis is only available on your turn against the AI');
      }
      const obs = game.observe(HUMAN);
      const result = analyzeMoves(obs, { timeMs: ANALYSIS_MS, seed: seed ^ obs.turn });
      postMessage({ type: 'analysis', turn: obs.turn, result });
    } else if (msg.type === 'move') {
      if (!game || game.over) throw new Error('game is not running');
      if (mode === 'ai') {
        if (game.current !== HUMAN) throw new Error('not your turn');
        game.play(msg.move);
        sendUpdate(HUMAN);
        scheduleAi();
      } else {
        const mover = game.current;
        game.play(msg.move);
        sendUpdate(game.over ? mover : game.current); // 끝나면 마지막으로 둔 사람 시점으로 결과 표시
      }
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err.message ?? err) });
  }
};
