export const APP_REQUEST_SQL = `
  n.data_origin='REAL' AND j.data_origin='REAL' AND n.channel='FCM'
  AND (n.initial_delivery_state IS NULL OR n.initial_delivery_state='ACCEPTED')`;

// 요청에 응답할 수 있는지만 판정한다. 이력에는 청소 일정의 배정 상태를 내려주지 않는다.
export const CAN_DECLINE_REQUEST_SQL = `
  n.response IS NULL AND j.cleaning_start_at > NOW()
  AND (j.status='NOTIFYING_' || n.tier OR (n.tier='BULK' AND j.status='BULK_REMINDED'))
  AND (n.initial_delivery_state IS NULL OR (
    j.property_id=n.initial_delivery_data->>'propertyId'
    AND j.checkout_at=(n.initial_delivery_data->>'checkoutAt')::timestamptz
    AND j.cleaning_start_at=(n.initial_delivery_data->>'cleaningStartAt')::timestamptz
  ))`;

export async function listWorkerRequests(db, token) {
  const { rows } = await db.query(`
    WITH owners AS (SELECT id, active FROM cleaners WHERE fcm_token=$1 LIMIT 2)
    SELECT owner.owner_count, owner.active, requests.*
    FROM (SELECT COUNT(*)::int AS owner_count, BOOL_AND(active) AS active FROM owners) owner
    LEFT JOIN LATERAL (
      SELECT n.id, p.name, j.property_id, COALESCE(n.initial_accepted_at, n.sent_at) AS sent_at,
        to_char(COALESCE((n.initial_delivery_data->>'cleaningStartAt')::timestamptz, j.cleaning_start_at)
          AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS cleaning_at,
        CASE WHEN ${CAN_DECLINE_REQUEST_SQL} THEN n.token END AS decline_token
      FROM owners c JOIN cleaning_notifs n ON n.cleaner_id=c.id
      JOIN cleaning_jobs j ON j.id=n.job_id
      JOIN property_cleaning_config p ON p.property_id=j.property_id
      WHERE owner.owner_count=1 AND c.active AND p.data_origin='REAL' AND ${APP_REQUEST_SQL}
    ) requests ON true
    ORDER BY requests.sent_at DESC, requests.id DESC`, [token]);

  const [owner] = rows;
  if (owner.owner_count === 0) return { status: 404, error: '등록되지 않은 토큰' };
  if (owner.owner_count !== 1) return { status: 409, error: '담당자 연결 확인 필요' };
  if (!owner.active) return { status: 403, error: '비활성 담당자' };
  return { status: 200, requests: rows.filter(row => row.id).map(row => ({
    id: row.id,
    propertyName: row.name,
    cleaningAt: row.cleaning_at,
    calendarPath: `/c/${encodeURIComponent(row.property_id)}`,
    declineToken: row.decline_token,
  })) };
}
