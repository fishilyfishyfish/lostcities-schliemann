// 정보집합 MCTS (Single-Observer ISMCTS, Cowling·Powley·Whitehouse 2012).
//
// - 트리 하나 = 내 정보집합. 노드는 "결정의 나열"로 식별하고, 숨은 정보(상대 손패, 덱 순서, 뽑은 카드)는 노드에 넣지 않는다.
// - 한 차례를 두 결정으로 나눈다: 놓기 노드(카드 × 탐험대/버림) → 뽑기 노드(덱/버림 더미).
//   한 수로 묶으면 루트 분기가 최대 96개라 반복당 통계가 너무 얇다. 나누면 16 + 6.
// - 반복마다 관측 객체에서 상태를 하나 결정화(sim.determinize)하고, 그 상태에서 합법인 결정만 따라 내려간다.
// - 선택은 가용 횟수(avail)를 쓰는 ISMCTS-UCB: mean + c·sqrt(ln(avail) / n). 상대 차례 노드에선 상대 시점(부호 반전).
// - 확장 후 탐욕 정책 롤아웃(sim.greedyPlayout)으로 라운드 끝까지 두고, 보상 = (내 점수 − 상대 점수) / scale.
// - 루트에서 방문 수가 가장 많은 놓기, 그 아래에서 방문 수가 가장 많은 뽑기를 고른다.
// 실제 게임 상태에는 접근하지 않는다: 입력은 관측 객체뿐이고 결정화 상태는 매 반복 새로 샘플링한 가상 상태다.

import { NUM_COLORS, cardColor, isWager } from '../cards.js';
import { DECK, EXPEDITION, DISCARD, canPlace } from '../rules.js';
import { mulberry32 } from '../rng.js';
import { determinize, greedyPlayout, simDraw, simPlay, simStep, totalScore } from '../sim.js';
import { greedyMove } from '../policy.js';
import { evaluateState } from '../evaluate.js';
import { createRuleAgent } from './rule.js';

export const MCTS_DEFAULTS = Object.freeze({
  iterations: 2000, // 반복 수 상한
  timeMs: 0, // >0이면 시간 상한 (반복 수 상한과 둘 중 먼저 닿는 것)
  c: 1.5, // UCB 탐색 상수 (보상 스케일 기준)
  scale: 100, // 보상 = 점수 차 / scale
  eps: 0.1, // 롤아웃 무작위 비율
  leaf: 'eval', // 'eval': 정적 평가(evaluate.js), 'rollout': 탐욕 롤아웃으로 끝까지
  horizon: 0, // 리프 평가 전 최소 진행 차례 수. 트리를 벗어나면 탐욕 정책으로 채우고, 항상 내 차례 국면에서 평가
  baseline: 1, // 1이면 보상에서 같은 결정화 상태의 루트 평가값을 뺀다 (상대 손패 샘플링 잡음 제거용 control variate)
  endRollout: 12, // 리프에서 덱이 이 장수 이하면 정적 평가 대신 탐욕 롤아웃으로 끝까지 (종반 정확도)
  maxDepth: 0, // >0이면 루트부터 이 차례 수까지만 트리를 내려가고 평가 (0 = 제한 없음)
  topK: 5, // >0이면 루트 후보를 규칙 봇 평가 상위 K개 수로 제한 (샘플을 유망한 수에 몰아준다)
  bias: 0, // 루트 progressive bias 세기: + bias × (prior − 최고 prior)/scale / (n + 1). 0이면 끔
});

/** 놓기 결정 → 정수 키. 같은 색 투자 카드는 같은 키 (결정화마다 투자 카드 id가 달라도 같은 결정). */
export function playKey(card, target) {
  const kind = isWager(card) ? cardColor(card) * 12 : card;
  return kind * 2 + (target === EXPEDITION ? 1 : 0);
}
/** 뽑기 결정 → 정수 키. 색 0~4, 덱 5. */
export const drawKey = (draw) => (draw === DECK ? NUM_COLORS : draw);

class Node {
  constructor(parent, mover) {
    this.parent = parent;
    this.mover = mover; // 이 노드로 오는 결정을 내린 플레이어
    this.children = new Map();
    this.n = 0;
    this.w = 0; // 루트 플레이어 시점 보상 합
    this.avail = 0;
    this.prior = null;
  }
}

const gOut = { card: -1, target: DISCARD, draw: DECK };

// 결정 후보 버퍼 (재사용)
const candKey = new Int32Array(64);
const candCard = new Int32Array(64);
const candTarget = new Array(64);

export function createMctsAgent(seed = 1, params = {}) {
  const P = { ...MCTS_DEFAULTS, ...params };
  const rng = mulberry32(seed);
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

  /**
   * 후보 중 하나를 고른다. 미시도 후보가 있으면 그중 하나를 확장 (반환값 expanded=true).
   * 반환: 고른 후보 인덱스. 다음 노드는 node.children.get(candKey[i]).
   */
  // prior: 결정 키 → (prior − 최고 prior) / scale (≤ 0). 루트 놓기 노드와 루트 아래 뽑기 노드에만 있다.
  let expanded = false;
  function selectOrExpand(node, count, sign) {
    const prior = node.prior;
    let untried = 0, pick = -1, pickPrior = -Infinity, best = -1, bestU = -Infinity;
    for (let i = 0; i < count; i++) {
      if (P.topK > 0 && prior && !prior.has(candKey[i])) continue; // 루트 후보 제한
      const child = node.children.get(candKey[i]);
      const pr = prior ? prior.get(candKey[i]) ?? -1 : 0;
      if (!child || child.n === 0) {
        untried++;
        if (prior) {
          if (pr > pickPrior) { pickPrior = pr; pick = i; } // prior 높은 것부터 확장
        } else if (rng() * untried < 1) {
          pick = i; // 미시도 후보 중 균등
        }
        continue;
      }
      child.avail++;
      let u = (sign * child.w) / child.n + P.c * Math.sqrt(Math.log(child.avail) / child.n);
      if (prior) u += (P.bias * pr) / (child.n + 1);
      if (u > bestU) { bestU = u; best = i; }
    }
    expanded = pick >= 0;
    return expanded ? pick : best;
  }

  function childFor(node, key, mover) {
    let child = node.children.get(key);
    if (!child) {
      child = new Node(node, mover);
      node.children.set(key, child);
    }
    if (child.n === 0) child.avail = Math.max(child.avail, 1);
    return child;
  }

  const ruleAgent = createRuleAgent(seed);

  /** 규칙 봇 평가로 루트와 루트 아래 뽑기 노드에 prior를 단다. */
  function attachPriors(root, obs, legalMoves) {
    const values = ruleAgent.scoreMoves(obs, legalMoves);
    const top = Math.max(...values);
    let keep = legalMoves.map((_, i) => i);
    if (P.topK > 0) keep = keep.sort((a, b) => values[b] - values[a]).slice(0, P.topK);
    legalMoves = keep.map((i) => legalMoves[i]);
    values.splice(0, values.length, ...keep.map((i) => values[i]));
    const playBest = new Map();
    legalMoves.forEach((m, i) => {
      const k = playKey(m.card, m.target);
      playBest.set(k, Math.max(playBest.get(k) ?? -Infinity, values[i]));
    });
    root.prior = new Map([...playBest].map(([k, v]) => [k, (v - top) / P.scale]));
    legalMoves.forEach((m, i) => {
      const k = playKey(m.card, m.target);
      let child = root.children.get(k);
      if (!child) {
        child = new Node(root, obs.player);
        root.children.set(k, child);
      }
      if (!child.prior) child.prior = new Map();
      child.prior.set(drawKey(m.draw), (values[i] - playBest.get(k)) / P.scale);
    });
  }

  function search(obs, legalMoves) {
    const me = obs.player;
    const root = new Node(null, 1 - me);
    if (P.bias > 0 || P.topK > 0) attachPriors(root, obs, legalMoves);
    const deadline = P.timeMs > 0 ? now() + P.timeMs : Infinity;
    let it = 0;
    for (; it < P.iterations; it++) {
      if ((it & 15) === 0 && now() > deadline) break;
      const s = determinize(obs, rng);
      const base = P.baseline ? evaluateState(s, me) : 0;
      let node = root;
      let grew = false;
      let depth = 0;
      while (!s.over && (P.maxDepth === 0 || depth < P.maxDepth)) {
        depth++;
        const p = s.current;
        const sign = p === me ? 1 : -1;
        // --- 놓기 ---
        const hand = s.hands[p];
        const exps = s.expeditions[p];
        let n = 0;
        let wagerSeen = 0;
        for (let i = 0; i < hand.length; i++) {
          const card = hand[i];
          if (isWager(card)) {
            const bit = 1 << cardColor(card);
            if (wagerSeen & bit) continue;
            wagerSeen |= bit;
          }
          if (canPlace(exps[cardColor(card)], card)) {
            candKey[n] = playKey(card, EXPEDITION); candCard[n] = card; candTarget[n] = EXPEDITION; n++;
          }
          candKey[n] = playKey(card, DISCARD); candCard[n] = card; candTarget[n] = DISCARD; n++;
        }
        let i = selectOrExpand(node, n, sign);
        const card = candCard[i];
        const target = candTarget[i];
        node = childFor(node, candKey[i], p);
        grew = grew || expanded;
        simPlay(s, card, target);
        // --- 뽑기 ---
        const banned = target === DISCARD ? cardColor(card) : -1;
        n = 0;
        candKey[n] = drawKey(DECK); candTarget[n] = DECK; n++;
        for (let c = 0; c < NUM_COLORS; c++) {
          if (c === banned || s.discards[c].length === 0) continue;
          candKey[n] = drawKey(c); candTarget[n] = c; n++;
        }
        i = selectOrExpand(node, n, sign);
        node = childFor(node, candKey[i], p);
        grew = grew || expanded;
        simDraw(s, candTarget[i]);
        if (grew) break;
      }
      let diff;
      if ((P.leaf === 'rollout' || s.deck.length <= P.endRollout) && !s.over) {
        const sc = greedyPlayout(s, rng, P.eps);
        diff = sc[me] - sc[1 - me];
      } else {
        // 지평선까지 탐욕 정책으로 채우고, 내 차례 국면에서 평가
        while (P.horizon > 0 && !s.over && (depth < P.horizon || s.current !== me)) {
          const p = s.current;
          greedyMove(s.hands[p], s.expeditions[p], s.expeditions[1 - p], s.discards, s.deck.length, gOut);
          simStep(s, gOut.card, gOut.target, gOut.draw);
          depth++;
        }
        diff = evaluateState(s, me);
      }
      const reward = (diff - base) / P.scale;
      for (let x = node; x; x = x.parent) {
        x.n++;
        x.w += reward;
      }
    }
    return { root, iterations: it };
  }

  return {
    name: 'mcts',
    params: P,
    /** 마지막 탐색 통계 (디버그/분석용). */
    lastStats: null,
    chooseMove(obs, legalMoves) {
      if (legalMoves.length === 1) return legalMoves[0];
      const { root, iterations } = search(obs, legalMoves);
      // 루트: 방문 최다 놓기 → 그 아래 방문 최다 뽑기
      let best = null;
      let bestKey = [-1, -1];
      const stats = [];
      for (const m of legalMoves) {
        const play = root.children.get(playKey(m.card, m.target));
        const draw = play && play.children.get(drawKey(m.draw));
        const pn = play ? play.n : 0;
        const dn = draw ? draw.n : 0;
        stats.push({ move: m, playVisits: pn, visits: dn, mean: draw && dn ? (draw.w / dn) * P.scale : null });
        if (pn > bestKey[0] || (pn === bestKey[0] && dn > bestKey[1])) {
          bestKey = [pn, dn];
          best = m;
        }
      }
      this.lastStats = { iterations, moves: stats };
      return best;
    },
  };
}
