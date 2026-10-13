// 강도 측정: 미러 대국. 같은 덱 순서·같은 선 자리로 A/B 자리를 바꿔 두 판씩 둔다.
// 두 판에서 A와 B는 정확히 같은 카드 흐름을 번갈아 받으므로 카드 운이 상쇄된다.
// 통계 단위는 "쌍"(두 판 평균). 쌍끼리는 독립이라 정규 근사 신뢰구간을 쓴다.

import { ALL_CARDS } from './cards.js';
import { mulberry32, shuffle } from './rng.js';
import { playRound, DEFAULT_MAX_TURNS } from './game.js';

export const Z95 = 1.959963984540054;

/** 평균, 표본 표준편차, 95% 신뢰구간 (정규 근사). */
export function meanCI(xs) {
  const n = xs.length;
  if (n === 0) return { n, mean: NaN, sd: NaN, lo: NaN, hi: NaN };
  let sum = 0;
  for (const x of xs) sum += x;
  const mean = sum / n;
  let ss = 0;
  for (const x of xs) ss += (x - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const half = n > 1 ? (Z95 * sd) / Math.sqrt(n) : Infinity;
  return { n, mean, sd, lo: mean - half, hi: mean + half };
}

/** 쌍 번호 → 덱 순서. 시드만 같으면 어떤 에이전트 조합이든 같은 덱을 쓴다. */
export function pairDeck(seed, i) {
  return shuffle(ALL_CARDS.slice(), mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0));
}

/**
 * 미러 대국 쌍 [from, to)를 진행하고 원자료를 돌려준다 (병렬 실행 시 조각 단위).
 * - makeA, makeB: (seed) => agent. 판마다 새로 만든다 (상태를 가진 에이전트도 판 사이에 섞이지 않게).
 * - stalled 판(maxTurns 초과)은 무승부(점수 차 0, 승점 0.5)로 집계하고 개수를 따로 센다.
 *   현재 점수로 판정하면 앞선 쪽이 버림 더미만 뽑아 시간을 끄는 전략이 이득이 되기 때문.
 */
export function runPairs(makeA, makeB, { from = 0, to = 100, seed = 1, maxTurns = DEFAULT_MAX_TURNS, onPair = null } = {}) {
  const part = { pairDiff: [], pairWin: [], wins: 0, draws: 0, losses: 0, stalled: 0, turns: 0, sumA: 0, sumB: 0, finished: 0, games: 0 };
  for (let i = from; i < to; i++) {
    const deck = pairDeck(seed, i);
    const startingPlayer = i % 2;
    let diff = 0, win = 0;
    for (let g = 0; g < 2; g++) {
      const agentSeed = (seed * 2654435761 + i * 40503 + g) >>> 0;
      const a = makeA(agentSeed);
      const b = makeB(agentSeed ^ 0x5bd1e995);
      const seatA = g; // 1판: A가 0번 자리, 2판: A가 1번 자리
      const agents = seatA === 0 ? [a, b] : [b, a];
      const r = playRound(agents, { deck, startingPlayer, maxTurns, keepHistory: false });
      part.turns += r.turns;
      part.games++;
      if (r.stalled) {
        part.stalled++;
        part.draws++;
        win += 0.5;
        continue;
      }
      const sa = r.scores[seatA];
      const sb = r.scores[1 - seatA];
      part.finished++;
      part.sumA += sa;
      part.sumB += sb;
      diff += sa - sb;
      if (sa > sb) { part.wins++; win += 1; } else if (sa < sb) { part.losses++; } else { part.draws++; win += 0.5; }
    }
    part.pairDiff.push(diff / 2);
    part.pairWin.push(win / 2);
    if (onPair) onPair(i + 1 - from);
  }
  return part;
}

/** runPairs 조각들을 합쳐 통계로. */
export function summarize(parts, { seed = 1, ms = 0 } = {}) {
  const all = { pairDiff: [], pairWin: [], wins: 0, draws: 0, losses: 0, stalled: 0, turns: 0, sumA: 0, sumB: 0, finished: 0, games: 0 };
  for (const p of parts) {
    all.pairDiff.push(...p.pairDiff);
    all.pairWin.push(...p.pairWin);
    for (const k of ['wins', 'draws', 'losses', 'stalled', 'turns', 'sumA', 'sumB', 'finished', 'games']) all[k] += p[k];
  }
  return {
    pairs: all.pairDiff.length,
    games: all.games,
    seed,
    diff: meanCI(all.pairDiff),
    winRate: meanCI(all.pairWin),
    wins: all.wins,
    draws: all.draws,
    losses: all.losses,
    stalled: all.stalled,
    avgScoreA: all.finished ? all.sumA / all.finished : NaN,
    avgScoreB: all.finished ? all.sumB / all.finished : NaN,
    avgTurns: all.games ? all.turns / all.games : NaN,
    ms,
  };
}

/**
 * 미러 대국 (단일 스레드).
 * @returns 점수 차(A−B, 판당), 승률(A, 판당; 무승부 0.5), 승/무/패, 평균 점수, stalled 수, 소요 시간
 */
export function mirrorMatch(makeA, makeB, { pairs = 100, seed = 1, maxTurns = DEFAULT_MAX_TURNS, onPair = null } = {}) {
  const t0 = Date.now();
  const part = runPairs(makeA, makeB, { from: 0, to: pairs, seed, maxTurns, onPair });
  return summarize([part], { seed, ms: Date.now() - t0 });
}

export function formatMatch(nameA, nameB, r) {
  const f = (x, k = 1) => x.toFixed(k);
  return [
    `${nameA} vs ${nameB}: ${r.pairs} 쌍 (${r.games} 판), seed ${r.seed}, ${(r.ms / 1000).toFixed(1)} s`,
    `  점수 차 (A−B, 판당): ${f(r.diff.mean)}  95% CI [${f(r.diff.lo)}, ${f(r.diff.hi)}]`,
    `  승률 A: ${f(r.winRate.mean * 100)}%  95% CI [${f(r.winRate.lo * 100)}%, ${f(r.winRate.hi * 100)}%]`,
    `  승/무/패: ${r.wins}/${r.draws}/${r.losses}, stalled ${r.stalled}`,
    `  평균 점수 A ${f(r.avgScoreA)} / B ${f(r.avgScoreB)}, 평균 ${f(r.avgTurns)} 수`,
  ].join('\n');
}
