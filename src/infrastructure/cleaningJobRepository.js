/**
 * cleaning_jobs 집계 저장소 — 청소 스케줄 할당 성공률(지표 7)용.
 * db는 인자로 주입 ({ query }) — eventRepository와 동일 방식.
 */

/**
 * 기간 내 체크아웃(checkout_at) 기준 청소 잡 수.
 *   created  = 취소(CANCELLED)를 제외한 생성 잡 수 (지표 7 분모)
 *   assigned = 그 중 ASSIGNED + COMPLETED (지표 7 분자)
 *
 * @param {object} db
 * @param {{ from: Date, to: Date }} range - to 포함
 * @param {string[]|null} propertyIds - null=전체, []=DB 호출 없이 0, [...]=ANY 필터
 * @returns {Promise<{ created: number, assigned: number }>}
 */
export async function queryCleaningJobCounts(db, range, propertyIds = null) {
  if (Array.isArray(propertyIds) && propertyIds.length === 0) {
    return { created: 0, assigned: 0 };
  }

  const params = [range.from, range.to];
  let where = "checkout_at >= $1 AND checkout_at <= $2";
  if (Array.isArray(propertyIds)) {
    where += " AND property_id = ANY($3::text[])";
    params.push(propertyIds);
  }

  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'CANCELLED')               AS created,
       COUNT(*) FILTER (WHERE status IN ('ASSIGNED','COMPLETED'))  AS assigned
     FROM cleaning_jobs
     WHERE ${where}`,
    params
  );

  return {
    created:  Number(rows[0]?.created)  || 0,
    assigned: Number(rows[0]?.assigned) || 0,
  };
}
