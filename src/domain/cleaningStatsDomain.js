/**
 * 청소 할당율 도메인 로직
 * CANCELLED 제외, ASSIGNED + COMPLETED = 배정 완료
 */

const ASSIGNED_STATUSES = new Set(['ASSIGNED', 'COMPLETED']);

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
