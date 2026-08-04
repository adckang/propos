/**
 * Postgres 이벤트 저장소.
 * @vercel/postgres는 api/ 폴더에서만 import — 이 파일은 src/에 있으므로
 * 함수 인자로 db를 주입받아 테스트에서 mock 교체가 가능하다.
 *
 * 실제 사용: api/events.js에서 createPool()로 만든 db를 주입.
 * 테스트 사용: 테스트에서 mock db 객체를 주입.
 */

/**
 * 이벤트를 Postgres에 삽입한다.
 * UNIQUE(property_id, type, device_time) 중복이면 무시 (ON CONFLICT DO NOTHING).
 * @param {object} db - { query: Function } 인터페이스
 * @param {object} event - validateEvent 통과한 이벤트 객체
 * @param {boolean} isSoft
 * @returns {Promise<{ inserted: boolean, id: string|null }>}
 */
export async function insertEvent(db, event, isSoft) {
  const result = await db.query(
    `INSERT INTO events (id, property_id, type, is_soft, device_time, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (property_id, type, device_time) DO NOTHING
     RETURNING id`,
    [
      event.id,
      event.property_id,
      event.type,
      isSoft,
      event.device_time,
      event.data ?? null,
    ]
  );

  const inserted = result.rows.length > 0;
  return { inserted, id: inserted ? result.rows[0].id : null };
}

/**
 * 이벤트 상태를 업데이트한다 (pending → complete | failed).
 * @param {object} db
 * @param {string} id - event UUID
 * @param {'complete'|'failed'} status
 * @param {string|null} notifiedAt - ISO 타임스탬프 (Slack 발송 완료 시)
 */
export async function updateEventStatus(db, id, status, notifiedAt = null) {
  await db.query(
    `UPDATE events
     SET status = $1, notified_at = $2
     WHERE id = $3`,
    [status, notifiedAt, id]
  );
}

// KV 미스 폴백에서 사용하는 상태 전이 이벤트 목록
const _ROOM_STATE_EVENTS = [
  "check_in_detected",
  "check_out_detected",
  "cleaning_started",
  "cleaning_finished",
];
const _ROOM_STATE_MAP = {
  check_in_detected: { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
  check_out_detected: { mainStatus: "CLEANING", subStatus: "CLEANING_PENDING" },
  cleaning_started: { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
  cleaning_finished: { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
};

/**
 * KV 캐시 미스 시 DB에서 마지막 알려진 룸 상태를 읽는다.
 * subStatus 전용 이벤트(energy_waste_*, complaint_*)는 제외 — 메인 상태만 복원.
 * @param {object} db
 * @param {string} propertyId
 * @returns {Promise<{ mainStatus: string, subStatus: string }|null>}
 */
export async function getLastKnownStateFromDB(db, propertyId) {
  const result = await db.query(
    `SELECT type FROM events
     WHERE property_id = $1
       AND type = ANY($2)
     ORDER BY device_time DESC LIMIT 1`,
    [propertyId, _ROOM_STATE_EVENTS]
  );
  if (result.rows.length === 0) return null;
  return _ROOM_STATE_MAP[result.rows[0].type] ?? null;
}

/**
 * 기간 내 특정 숙소(또는 전체)의 이벤트를 조회한다.
 * @param {object} db
 * @param {{ from: Date, to: Date }} range
 * @param {string|null} propertyId - null이면 전체
 * @returns {Promise<object[]>}
 */
export async function queryEvents(db, range, propertyId = null) {
  if (propertyId) {
    const result = await db.query(
      `SELECT * FROM events
       WHERE property_id = $1
         AND device_time >= $2
         AND device_time <= $3
       ORDER BY device_time DESC`,
      [propertyId, range.from, range.to]
    );
    return result.rows;
  }

  const result = await db.query(
    `SELECT * FROM events
     WHERE device_time >= $1
       AND device_time <= $2
     ORDER BY device_time DESC`,
    [range.from, range.to]
  );
  return result.rows;
}
