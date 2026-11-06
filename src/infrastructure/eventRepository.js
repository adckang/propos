/**
 * Postgres 이벤트 저장소.
 * @vercel/postgres는 api/ 폴더에서만 import — 이 파일은 src/에 있으므로
 * 함수 인자로 db를 주입받아 테스트에서 mock 교체가 가능하다.
 *
 * 실제 사용: api/events.js에서 createPool()로 만든 db를 주입.
 * 테스트 사용: 테스트에서 mock db 객체를 주입.
 */

import { ANCHOR_EVENT_TYPES, FOLLOW_EVENT_TYPES, deriveRoomState } from "../domain/roomStateFromEventsDomain.js";
import { PRE_STAY_EVENT_TYPES } from "../domain/metricDrilldownDomain.js";

/**
 * 이벤트를 Postgres에 삽입한다.
 * UNIQUE(property_id, type, device_time) 중복이면 무시 (ON CONFLICT DO NOTHING).
 * @param {object} db - { query: Function } 인터페이스
 * @param {object} event - validateEvent 통과한 이벤트 객체
 * @param {boolean} isSoft
 * @returns {Promise<{ inserted: boolean, id: string|null }>}
 */
export async function insertEvent(db, event, isSoft) {
  // 구형 Pi 요청에는 출처 필드가 없다. HA_WATCHER는 기존 스키마의 기본값이며,
  // fallback 참조는 실제 수신 이벤트 UUID만 가리킨다 (예약·센서 원본 ID를 추측하지 않는다).
  const sourceSystem = typeof event.source_system === 'string' && event.source_system.trim()
    ? event.source_system : 'HA_WATCHER';
  const sourceRef = typeof event.source_ref === 'string' && event.source_ref.trim()
    ? event.source_ref : `ingest:event:${event.id}`;
  const result = await db.query(
    `INSERT INTO events (id, property_id, type, is_soft, device_time, data, source_system, source_ref, data_origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       COALESCE((SELECT data_origin FROM property_cleaning_config WHERE property_id = $2), 'REAL'))
     ON CONFLICT (property_id, type, device_time) DO NOTHING
     RETURNING id`,
    [
      event.id,
      event.property_id,
      event.type,
      isSoft,
      event.device_time,
      event.data ?? null,
      sourceSystem,
      sourceRef,
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

/**
 * 이벤트 기록으로 숙소들의 "지금 상태"를 계산한다 (현재 상태 레포트의 원천).
 *
 * 숙소마다 마지막 "큰 상태 변화"(체크인·체크아웃·청소 시작·청소 완료)를 찾고, 그 뒤의 세부 이벤트
 * (민원·에너지 낭비·입실 준비)를 상태 규칙에 순서대로 적용한다 — roomStateFromEventsDomain.
 * 임시 저장소(KV)와 달리 시간이 지나도 사라지지 않으며 체류 중 이상·입실 준비 같은 세부 상태도 담는다.
 * 기록이 하나도 없는 숙소는 결과에 없다 (상태를 알 수 없음).
 *
 * @param {object} db
 * @param {string[]|null} propertyIds - null=기록이 있는 모든 숙소, []=DB 호출 없이 빈 결과, [...]=그 숙소들만
 * @returns {Promise<Map<string, { mainStatus: string, subStatus: string }>>}
 */
export async function getLastKnownStatesFromDB(db, propertyIds = null) {
  if (Array.isArray(propertyIds) && propertyIds.length === 0) return new Map();

  const { rows } = await db.query(
    `WITH last_anchor AS (
       SELECT DISTINCT ON (property_id)
              property_id, type AS anchor_type, device_time AS anchor_time
         FROM events
        WHERE type = ANY($1::text[])
          AND ($2::text[] IS NULL OR property_id = ANY($2::text[]))
        ORDER BY property_id, device_time DESC
     )
     SELECT a.property_id, a.anchor_type, f.type AS follow_type
       FROM last_anchor a
       LEFT JOIN events f
         ON f.property_id = a.property_id
        AND f.type = ANY($3::text[])
        AND f.device_time > a.anchor_time
      ORDER BY a.property_id, f.device_time, f.server_time`,
    [ANCHOR_EVENT_TYPES, Array.isArray(propertyIds) ? propertyIds : null, FOLLOW_EVENT_TYPES]
  );

  const byProperty = new Map();
  for (const { property_id, anchor_type, follow_type } of rows) {
    if (!byProperty.has(property_id)) byProperty.set(property_id, { anchor: anchor_type, follows: [] });
    if (follow_type) byProperty.get(property_id).follows.push(follow_type);
  }

  const states = new Map();
  for (const [id, { anchor, follows }] of byProperty) {
    const state = deriveRoomState(anchor, follows);
    if (state) states.set(id, state);
  }
  return states;
}

/**
 * 기간 내 특정 숙소(들) 또는 전체의 이벤트를 조회한다.
 * @param {object} db
 * @param {{ from: Date, to: Date }} range
 * @param {string[]|null} propertyIds - null=전체, []=빈 결과(DB 호출 없음), [...]= ANY 필터
 * @returns {Promise<object[]>}
 */
export async function queryEvents(db, range, propertyIds = null) {
  // 빈 배열 = 선택된 숙소 없음 → DB 호출 없이 빈 결과
  if (Array.isArray(propertyIds) && propertyIds.length === 0) {
    return [];
  }

  if (Array.isArray(propertyIds) && propertyIds.length > 0) {
    const result = await db.query(
      `SELECT * FROM events
       WHERE property_id = ANY($1::text[])
         AND device_time >= $2
         AND device_time <= $3
       ORDER BY device_time DESC`,
      [propertyIds, range.from, range.to]
    );
    return result.rows;
  }

  // null = 전체 조회
  const result = await db.query(
    `SELECT * FROM events
     WHERE device_time >= $1
       AND device_time <= $2
     ORDER BY device_time DESC`,
    [range.from, range.to]
  );
  return result.rows;
}

/**
 * 기간 끝에 열린 준비 회차의 다음 관련 기록을 조회한다. 첫 시각의 모든 이벤트를 반환해
 * 동시 입실/완료의 판정도 공통 도메인이 담당한다. 기간 밖 준비는 분모에 넣지 않는다.
 */
export async function queryNextPreStayEvents(db, after, through, propertyIds) {
  if (!propertyIds.length || new Date(after).getTime() >= new Date(through).getTime()) return [];
  const { rows } = await db.query(
    `WITH next_pre_stay_times AS (
       SELECT property_id, MIN(device_time) AS device_time
         FROM events
        WHERE property_id = ANY($1::text[]) AND type = ANY($2::text[])
          AND device_time > $3 AND device_time <= $4
        GROUP BY property_id
     )
     SELECT e.* FROM events e
       JOIN next_pre_stay_times n ON n.property_id = e.property_id AND n.device_time = e.device_time
      WHERE e.type = ANY($2::text[])
      ORDER BY e.device_time`,
    [propertyIds, PRE_STAY_EVENT_TYPES, after, through]
  );
  return rows;
}

/** Versioned sensor runs may finish after early entry; query only exact run IDs. */
export async function queryPreStayRunOutcomes(db, after, through, runs) {
  if (!runs.length || new Date(after).getTime() >= new Date(through).getTime()) return [];
  const { rows } = await db.query(
    `SELECT e.* FROM events e
       JOIN jsonb_to_recordset($1::jsonb) AS r(property_id text, run_id text)
         ON r.property_id = e.property_id AND r.run_id = e.data->>'optimizationRunId'
      WHERE e.data->>'preparationPolicy' = 'sensor-v1'
        AND e.type = ANY($2::text[]) AND e.device_time > $3 AND e.device_time <= $4
      ORDER BY e.device_time`,
    [JSON.stringify(runs), ['checkin_prep_time_reached', 'optimization_finished', 'optimization_failed', 'optimization_cancelled'], after, through]
  );
  return rows;
}

/**
 * 단일 숙소의 월간 상태 구간 계산용 이벤트를 조회한다.
 * 월 시작 전 마지막 anchor 1건과 월 범위 안의 anchor/follow 이벤트를 시간순으로 반환한다.
 */
export async function queryStateEventsForProperty(db, range, propertyId) {
  if (!propertyId) return [];

  const eventTypes = [...new Set([...ANCHOR_EVENT_TYPES, ...FOLLOW_EVENT_TYPES])];
  const { rows } = await db.query(
    `WITH previous_anchor AS (
       SELECT *
         FROM events
        WHERE property_id = $1
          AND type = ANY($2::text[])
          AND device_time < $3
        ORDER BY device_time DESC
        LIMIT 1
     ), range_events AS (
       SELECT *
         FROM events
        WHERE property_id = $1
          AND type = ANY($4::text[])
          AND device_time >= $3
          AND device_time <= $5
     )
     SELECT * FROM previous_anchor
     UNION ALL
     SELECT * FROM range_events
     ORDER BY device_time ASC`,
    [propertyId, ANCHOR_EVENT_TYPES, range.from, eventTypes, range.to]
  );
  return rows;
}
