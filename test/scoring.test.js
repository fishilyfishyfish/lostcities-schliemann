import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCard as C } from '../engine/cards.js';
import { expeditionScore, playerScore } from '../engine/scoring.js';

const Y = 0, B = 1, W = 2, G = 3, R = 4;
const nums = (color, values) => values.map((v) => C(color, v));
const wagers = (color, n) => Array.from({ length: n }, (_, i) => C(color, 0, i));

test('시작 안 한 탐험대는 0점', () => {
  assert.equal(expeditionScore([]), 0);
});

test('숫자 합 - 20', () => {
  assert.equal(expeditionScore(nums(Y, [2, 3, 4])), 9 - 20);
  assert.equal(expeditionScore(nums(Y, [5, 7, 8])), 0);
  assert.equal(expeditionScore(nums(Y, [6, 7, 8, 9, 10])), 20);
});

test('투자 카드만 놓은 탐험대: -20 × (투자 수 + 1)', () => {
  assert.equal(expeditionScore(wagers(B, 1)), -40);
  assert.equal(expeditionScore(wagers(B, 2)), -60);
  assert.equal(expeditionScore(wagers(B, 3)), -80);
});

test('음수 점수에도 배수 적용', () => {
  // 투자 2 + 숫자 2,3 → (5-20)*3 = -45
  assert.equal(expeditionScore([...wagers(W, 2), ...nums(W, [2, 3])]), -45);
  // 투자 3 + 10 → (10-20)*4 = -40
  assert.equal(expeditionScore([...wagers(W, 3), ...nums(W, [10])]), -40);
});

test('양수 점수 배수', () => {
  // 투자 1 + 7,8,9,10 = 34 → 14*2 = 28
  assert.equal(expeditionScore([...wagers(G, 1), ...nums(G, [7, 8, 9, 10])]), 28);
});

test('7장은 보너스 없음, 정확히 8장이면 +20', () => {
  const seven = nums(R, [2, 3, 4, 5, 6, 7, 8]); // 35
  assert.equal(expeditionScore(seven), 15);
  const eight = nums(R, [2, 3, 4, 5, 6, 7, 8, 9]); // 44
  assert.equal(expeditionScore(eight), 24 + 20);
});

test('8장 보너스는 배수 적용 후 더함 (투자 카드도 장수에 포함)', () => {
  // 투자 3 + 숫자 2..6 (5장) = 8장, 합 20 → 0*4 + 20 = 20
  assert.equal(expeditionScore([...wagers(Y, 3), ...nums(Y, [2, 3, 4, 5, 6])]), 20);
  // 투자 2 + 숫자 2..7 (6장) = 8장, 합 27 → 7*3 + 20 = 41 (배수 전에 더했다면 81)
  assert.equal(expeditionScore([...wagers(Y, 2), ...nums(Y, [2, 3, 4, 5, 6, 7])]), 41);
  // 9장: 투자 3 + 2..7, 합 27 → 7*4 + 20 = 48
  assert.equal(expeditionScore([...wagers(Y, 3), ...nums(Y, [2, 3, 4, 5, 6, 7])]), 48);
  // 7장 (투자 3 + 2..5): 보너스 없음, 음수에 배수 → (14-20)*4 = -24
  assert.equal(expeditionScore([...wagers(Y, 3), ...nums(Y, [2, 3, 4, 5])]), -24);
});

test('전체 카드 12장 탐험대 최댓값', () => {
  // 투자 3 + 2..10 = 54 → 34*4 + 20 = 156
  assert.equal(expeditionScore([...wagers(B, 3), ...nums(B, [2, 3, 4, 5, 6, 7, 8, 9, 10])]), 156);
});

test('playerScore는 색별 합산', () => {
  const exps = [nums(Y, [10]), wagers(B, 1), [], nums(G, [5, 7, 8]), []];
  const s = playerScore(exps);
  assert.deepEqual(s.perColor, [-10, -40, 0, 0, 0]);
  assert.equal(s.total, -50);
});
