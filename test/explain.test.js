import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C } from '../engine/cards.js';
import { applyMove, legalMoves, newRound, DECK, DISCARD, EXPEDITION } from '../engine/rules.js';
import { observe, legalMovesFromObservation } from '../engine/observation.js';
import { mulberry32 } from '../engine/rng.js';
import { colorValue, createRuleAgent } from '../engine/agents/rule.js';
import { colorProjection, explainMove, projectPosition, viewContext } from '../engine/explain.js';

function randomPosition(seed, n) {
  const s = newRound({ seed, startingPlayer: seed % 2 });
  const rng = mulberry32(seed);
  for (let i = 0; i < n && !s.over; i++) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(rng() * moves.length)]);
  }
  return s;
}

test('설명의 합 = 규칙 봇 평가값 (모든 합법수)', () => {
  const rule = createRuleAgent(1);
  for (let seed = 0; seed < 60; seed++) {
    const s = randomPosition(seed, (seed * 5) % 110);
    if (s.over) continue;
    const obs = observe(s, s.current);
    const moves = legalMovesFromObservation(obs);
    const values = rule.scoreMoves(obs, moves);
    const ctx = viewContext(obs);
    moves.forEach((m, i) => {
      const e = explainMove(obs, m, ctx);
      assert.ok(Math.abs(e.value - values[i]) < 1e-9, `seed ${seed} move ${JSON.stringify(m)}: ${e.value} vs ${values[i]}`);
      assert.ok(e.reasons.length >= 2);
      for (const r of e.reasons) assert.equal(typeof r.text, 'string');
    });
  }
});

test('colorProjection.projected = rule.colorValue', () => {
  for (let seed = 0; seed < 40; seed++) {
    const s = randomPosition(seed, seed * 2);
    const obs = observe(s, 0);
    const ctx = viewContext(obs);
    for (let c = 0; c < 5; c++) {
      const hand = obs.hand.filter((x) => Math.floor(x / 12) === c);
      const p = colorProjection(obs.myExpeditions[c], hand, ctx.unseenBy[c], ctx);
      assert.ok(Math.abs(p.projected - colorValue(obs.myExpeditions[c], hand, ctx.unseenBy[c], ctx)) < 1e-9);
    }
  }
});

test('예상 최종 점수: 종료 국면에서는 현재 점수와 같음, 현재 점수 합이 실제와 같음', () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = randomPosition(seed, 1000);
    const obs = observe(s, 0);
    const p = projectPosition(obs);
    assert.deepEqual(p.current, [obs.scores[0].total, obs.scores[1].total]);
  }
});

test('근거 문장: 상대 탐험대에 이어지는 카드를 버리면 위험을 알림, 건너뛰기를 알림', () => {
  const [Y, B, W, G, R] = [0, 1, 2, 3, 4];
  const hand = [C(G, 7), C(B, 3), C(B, 4), C(B, 8), C(Y, 2), C(Y, 3), C(W, 2), C(W, 3)];
  const used = new Set([...hand, C(G, 5), C(B, 2)]);
  const deck = [];
  for (let i = 0; i < 60; i++) if (!used.has(i) && deck.length < 30) deck.push(i);
  const rest = [];
  for (let i = 0; i < 60; i++) if (!used.has(i) && !deck.includes(i)) rest.push(i);
  const s = {
    deck, hands: [hand, rest.slice(0, 8)],
    expeditions: [[[], [C(B, 2)], [], [], []], [[], [], [], [C(G, 5)], []]],
    discards: [[], [], [], [], []], current: 0, startingPlayer: 0, turn: 0, over: false, history: [],
  };
  const obs = observe(s, 0);
  const gift = explainMove(obs, { card: C(G, 7), target: DISCARD, draw: DECK });
  assert.ok(gift.reasons.some((r) => r.kind === 'gift' && r.text.includes('맨 위 5')), JSON.stringify(gift.reasons));
  const skip = explainMove(obs, { card: C(B, 8), target: EXPEDITION, draw: DECK });
  assert.ok(skip.reasons.some((r) => r.kind === 'skip' && r.text.includes('3·4')), JSON.stringify(skip.reasons));
});

test('효과 분해: total 차이 = value 차이 (순위가 같음)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const s = randomPosition(seed, 30);
    if (s.over) continue;
    const obs = observe(s, s.current);
    const ctx = viewContext(obs);
    const es = legalMovesFromObservation(obs).map((m) => explainMove(obs, m, ctx));
    const off = es[0].value - es[0].effects.total;
    for (const e of es) {
      assert.ok(Math.abs(e.value - e.effects.total - off) < 1e-9);
      assert.ok(Math.abs(e.effects.play + e.effects.draw + e.effects.gift - e.effects.total) < 1e-9);
    }
  }
});
