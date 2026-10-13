/**
 * 다음 라운드 선 결정. 룰: 지금까지 누적 점수가 높은 플레이어가 선.
 * 누적 동점이면 직전 라운드 후공이 선 (룰에 언급이 없어 정한 것, CLAUDE.md 참고).
 * @param {number[]} totals 누적 점수 [p0, p1]
 * @param {0|1} prevStarter 직전 라운드 선
 */
export function nextRoundStarter(totals, prevStarter) {
  if (totals[0] > totals[1]) return 0;
  if (totals[1] > totals[0]) return 1;
  return 1 - prevStarter;
}

export const ROUNDS_PER_MATCH = 3;
