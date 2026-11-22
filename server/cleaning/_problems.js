/**
 * 청소 운영 문제 기록 (RF-32, DEC-08) — 상태를 되돌리지 않고 문제 이벤트로 남긴다.
 *
 * - cleaning_cancel_followup_failed: 청소 취소는 저장됐지만 뒤따르는 외부 작업(담당자 구글 일정 삭제·막힘 일정 만들기/저장)이 실패
 * - cleaning_unassigned_at_start:    청소 시작 예정 시각이 됐는데 담당자가 없음 (청소 1건에 1번)
 *
 * events 표의 (숙소, 종류, 발생 시각) 중복 방지를 그대로 쓴다. 기록 실패는 로그만 — 이 기록 때문에 원래 처리가 실패하지 않게.
 */
import { randomUUID } from "node:crypto";
import { insertEvent } from "../../src/infrastructure/eventRepository.js";
import { isCheckoutCancelled } from "./_reservationSync.js";
import { SERVER_PROBLEM_EVENT_TYPES } from "../../src/config/eventTypes.js";

const { CLEANING_CANCEL_FOLLOWUP_FAILED, CLEANING_UNASSIGNED_AT_START } = SERVER_PROBLEM_EVENT_TYPES;
export { CLEANING_CANCEL_FOLLOWUP_FAILED, CLEANING_UNASSIGNED_AT_START };

export const CLEANING_PROBLEM_SOURCE = "PROPOS_CLEANING";

/** @returns {Promise<{ inserted: boolean, id: string|null }>} 실패하면 { inserted: false, id: null } */
export async function recordCleaningProblem(db, { propertyId, type, deviceTime, data, sourceRef }) {
  try {
    return await insertEvent(db, {
      id: randomUUID(),
      property_id: propertyId,
      type,
      device_time: new Date(deviceTime),
      data,
      source_system: CLEANING_PROBLEM_SOURCE,
      source_ref: sourceRef,
    }, false);
  } catch (e) {
    console.error(`[cleaning-problem] ${type} 기록 실패 (${propertyId}):`, e?.message ?? e);
    return { inserted: false, id: null };
  }
}

// 정기 작업(아침·저녁, 청소 목록을 열어 두면 1분마다)이 놓치지 않도록 이틀 안의 시작만 본다
const UNASSIGNED_LOOKBACK = "2 days";

/**
 * 청소 시작 예정 시각이 지났는데 담당자가 없는(배정완료·완료가 아닌) 실제 청소를 청소 1건에 1번 기록한다.
 * 발생 시각 = 청소 시작 예정 시각 + (같은 숙소·같은 시작 시각 청소 중 순번)ms — 퇴실 없는 청소처럼 시작 시각이 같은 두 청소가
 * DB 중복 방지(숙소·종류·발생 시각)에 걸리지 않게. 같은 청소는 시작 시각이 바뀌어도 다시 기록하지 않는다(출처 번호로 확인).
 * 손님 예약이 취소돼 퇴실이 없어진 청소는 뺀다. 청소 취소(CANCELLED)는 다시 배정해야 하는 상태라(D-017) 담당자 없음으로 센다 —
 * 손님 예약 취소로 청소를 먼저 취소했는데 예약 동기화 전에 시작 시각이 지나면 기록된다(달력의 지금 상태 항목도 같다).
 * 한계: 상태 이력이 없어 "시작 시각의 상태"가 아니라 점검할 때의 상태로 판단한다 — 점검(아침·저녁, 청소 목록을 열어 두면 1분마다)
 * 전에 배정되면 기록되지 않고, 시작 뒤 배정됐다 취소된 청소는 기록된다.
 * @returns {Promise<number>} 새로 기록한 건수
 */
export async function recordUnassignedAtStart(db, now = new Date()) {
  const { rows } = await db.query(
    `SELECT j.id, j.property_id, j.status, j.checkout_at, j.cleaning_start_at, j.reservation_uid,
            (SELECT COUNT(*) FROM cleaning_jobs k
              WHERE k.property_id = j.property_id AND k.cleaning_start_at = j.cleaning_start_at AND k.id < j.id) AS start_rank
       FROM cleaning_jobs j
      WHERE j.data_origin = 'REAL'
        AND j.status NOT IN ('ASSIGNED','COMPLETED')
        AND j.cleaning_start_at <= $1::timestamptz
        AND j.cleaning_start_at > $1::timestamptz - INTERVAL '${UNASSIGNED_LOOKBACK}'
        AND NOT EXISTS (SELECT 1 FROM events e
                         WHERE e.property_id = j.property_id AND e.type = '${CLEANING_UNASSIGNED_AT_START}'
                           AND e.source_ref = 'cleaning_job:' || j.id || ':unassigned_at_start')
      ORDER BY j.cleaning_start_at ASC`,
    [new Date(now).toISOString()],
  );
  let recorded = 0;
  for (const job of rows) {
    if (await isCheckoutCancelled(db, job)) continue;
    const result = await recordCleaningProblem(db, {
      propertyId: job.property_id, type: CLEANING_UNASSIGNED_AT_START,
      deviceTime: new Date(job.cleaning_start_at).getTime() + (Number(job.start_rank) || 0),
      data: { jobId: job.id, status: job.status, checkoutAt: job.checkout_at ? new Date(job.checkout_at).toISOString() : null },
      sourceRef: `cleaning_job:${job.id}:unassigned_at_start`,
    });
    if (result.inserted) recorded++;
  }
  return recorded;
}
