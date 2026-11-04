/**
 * 청소 할당율 도메인 로직
 * CANCELLED 제외, ASSIGNED + COMPLETED = 배정 완료
 */

/** 담당자가 정해진 청소 상태 — 레포트·캘린더·숙소 상세가 같은 정의를 쓴다 */
export const ASSIGNED_STATUSES = new Set(['ASSIGNED', 'COMPLETED']);

/**
 * @param {Array<{ status: string }>} jobs
 * @returns {{ total: number, assigned: number, unassigned: number }}
 */
export function computeCleaningStats(jobs) {
  const active   = jobs.filter(j => j.status !== 'CANCELLED');
  const total    = active.length;
  const assigned = active.filter(j => ASSIGNED_STATUSES.has(j.status)).length;
  return { total, assigned, unassigned: total - assigned };
}
