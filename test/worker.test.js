// 웹 워커의 모드별 메시지 프로토콜 검증. 브라우저 없이 self/postMessage를 흉내 내서 worker.js를 그대로 불러온다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/index.js';

const out = [];
globalThis.self ??= globalThis;
globalThis.postMessage = (m) => out.push(structuredClone(m));
await import('../web/worker.js');

const send = (data) => self.onmessage({ data });
const take = () => out.splice(0, out.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('2인 플레이 시작: 손패 없는 handover만 온다', () => {
  take();
  send({ type: 'new', mode: 'pvp', seed: 7, startingPlayer: 1 });
  const msgs = take();
  assert.equal(msgs.length, 1);
  assert.deepEqual(Object.keys(msgs[0]).sort(), ['last', 'mode', 'next', 'reason', 'seed', 'type']);
  assert.equal(msgs[0].type, 'handover');
  assert.equal(msgs[0].next, 1);
  assert.equal(msgs[0].reason, 'start');
  assert.equal(msgs[0].last, null);
});

test('2인 플레이: 가림 화면이 떠 있는 동안에는 수를 받지 않음, reveal 뒤에야 그 사람 시점 관측이 옴', () => {
  take();
  send({ type: 'new', mode: 'pvp', seed: 7, startingPlayer: 1 });
  take();
  send({ type: 'move', move: { card: 0, target: 'discard', draw: 'deck' } });
  assert.match(take()[0].message, /covered/);
  send({ type: 'reveal' });
  const [u] = take();
  assert.equal(u.type, 'update');
  assert.equal(u.viewer, 1);
  assert.equal(u.obs.player, 1);
  assert.deepEqual(u.obs.hand, new Game({ seed: 7, startingPlayer: 1 }).observe(1).hand);
  assert.ok(u.legalMoves.length > 0);
  send({ type: 'reveal' }); // 이미 열었으면 다시 열 수 없다
  assert.match(take()[0].message, /nothing to reveal/);
});

test('2인 플레이 한 판: 매 차례 그 사람 시점, 중간 메시지에 손패·관측 없음, 끝에 결과와 두 손패', () => {
  take();
  const ref = new Game({ seed: 11, startingPlayer: 0 });
  send({ type: 'new', mode: 'pvp', seed: 11, startingPlayer: 0 });
  let turns = 0;
  let final = null;
  while (!final) {
    const [h] = take();
    assert.equal(h.type, 'handover');
    assert.deepEqual(Object.keys(h).sort(), ['last', 'mode', 'next', 'reason', 'seed', 'type']);
    assert.equal(h.next, ref.current);
    if (h.last) {
      assert.equal(h.last.player, 1 - h.next);
      if (h.last.draw === 'deck') assert.equal(h.last.drawnCard, null); // 덱에서 뽑은 카드는 알려주지 않는다
    }
    send({ type: 'reveal' });
    const [u] = take();
    assert.equal(u.type, 'update');
    assert.equal(u.obs.player, h.next);
    assert.deepEqual(u.obs.hand, ref.observe(h.next).hand);
    assert.equal(u.final, null);
    const move = u.legalMoves[(turns * 7) % u.legalMoves.length];
    ref.play(move);
    send({ type: 'move', move });
    turns++;
    assert.ok(turns < 500);
    if (ref.over) {
      const msgs = take();
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].type, 'update'); // 끝나면 가림 화면 없이 결과
      final = msgs[0].final;
      assert.ok(final);
      assert.equal(msgs[0].viewer, h.next); // 마지막으로 둔 사람 시점
    }
  }
  const s = ref.scores();
  assert.deepEqual(final.scores.map((x) => x.total), [s[0].total, s[1].total]);
  assert.deepEqual(final.hands, ref.revealHands());
  assert.equal(final.hands[0].length, 8);
  assert.equal(final.hands[1].length, 8);
});

test('2인 플레이에서는 분석을 거절', () => {
  take();
  send({ type: 'new', mode: 'pvp', seed: 5, startingPlayer: 0 });
  take();
  send({ type: 'reveal' });
  take();
  send({ type: 'analyze' });
  assert.match(take()[0].message, /against the AI/);
});

test('AI 대국: 기존 동작 그대로 (사람 시점만, AI가 두고 나면 내 차례)', async () => {
  take();
  send({ type: 'new', mode: 'ai', ai: 'random', seed: 3, startingPlayer: 0 });
  const [start] = take();
  assert.equal(start.type, 'update');
  assert.equal(start.mode, 'ai');
  assert.equal(start.viewer, 0);
  assert.equal(start.obs.current, 0);
  send({ type: 'move', move: start.legalMoves[0] });
  const [afterMove] = take();
  assert.equal(afterMove.obs.current, 1); // AI 차례
  await sleep(1000);
  const msgs = take();
  assert.ok(msgs.length >= 1);
  const last = msgs[msgs.length - 1];
  assert.equal(last.type, 'update');
  assert.equal(last.viewer, 0);
  assert.equal(last.obs.current, 0);
  assert.equal(last.obs.turn, 2);
});

test('AI 대국: 분석 가능, 모르는 AI 이름은 mcts로', () => {
  take();
  send({ type: 'new', mode: 'ai', ai: 'unknown', seed: 4, startingPlayer: 0 });
  take();
  send({ type: 'analyze' });
  const [a] = take();
  assert.equal(a.type, 'analysis');
  assert.ok(a.result.moves.length > 0);
});
