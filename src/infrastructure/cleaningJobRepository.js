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

/**
 * 이미 체크아웃 시각이 지났지만 배정/완료되지 않은 청소 잡을 문제 아이템으로 반환한다.
 * 미래 잡은 아직 문제가 아니므로 now 이후는 조회하지 않는다.
 */
export async function queryCleaningIssueItems(db, range, propertyIds = null, now = new Date()) {
  if (Array.isArray(propertyIds) && propertyIds.length === 0) return [];

  const cappedTo = new Date(Math.min(range.to.getTime(), now.getTime()));
  if (cappedTo < range.from) return [];

  const params = [range.from, cappedTo];
  let where = "checkout_at >= $1 AND checkout_at <= $2 AND status NOT IN ('ASSIGNED','COMPLETED')";
  if (Array.isArray(propertyIds)) {
    where += " AND property_id = ANY($3::text[])";
    params.push(propertyIds);
  }

  const { rows } = await db.query(
    `SELECT property_id, checkout_at, status
       FROM cleaning_jobs
      WHERE ${where}
      ORDER BY checkout_at ASC`,
    params
  );

  return rows.map(row => ({
    property_id: row.property_id,
    occurred_at: row.checkout_at,
    category: 'CLEANING',
    type: 'cleaning_assignment_issue',
    label: row.status === 'ESCALATED'
      ? '청소 배정 실패'
      : row.status === 'CANCELLED'
        ? '청소 재배정 필요'
        : '청소 미배정',
    detail: { status: row.status },
  }));
}
