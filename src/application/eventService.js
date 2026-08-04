/**
 * 이벤트 수신 파이프라인 오케스트레이션.
 * 쓰기 순서: Postgres → KV → Slack (data-storage-design.md D-014)
 *
 * db, kv, notifier는 인자로 주입 → 테스트에서 mock 교체 가능.
 */

import { SOFT_EVENT_TYPES, UNIMPLEMENTED_EVENT_TYPES } from "../config/eventTypes.js";
import { insertEvent, updateEventStatus } from "../infrastructure/eventRepository.js";
import { setRoomState } from "../infrastructure/kvStore.js";

/**
 * @param {object} event - validateEvent 통과한 이벤트
 * @param {object} deps
 * @param {object} deps.db        - Postgres pool ({ query })
 * @param {object} deps.kv        - Vercel KV ({ set, get })
 * @param {Function} deps.notify  - slackNotifier.notifyEvent
 * @returns {Promise<{ status: 'inserted'|'duplicate'|'skipped', id: string|null }>}
 */
export async function processEvent(event, { db, kv, notify }) {
  const isSoft = SOFT_EVENT_TYPES.has(event.type);
  const isUnimplemented = UNIMPLEMENTED_EVENT_TYPES.has(event.type);

  // 1. Postgres 저장 (중복이면 duplicate 반환)
  const { inserted, id } = await insertEvent(db, event, isSoft);
  if (!inserted) return { status: "duplicate", id: null };

  // 미구현 이벤트는 저장 + status 종결 후 반환 (pending 고착 방지)
  if (isUnimplemented) {
    await updateEventStatus(db, id, "complete", null);
    return { status: "skipped", id };
  }

  // 2. KV 상태 캐시 업데이트 (soft 이벤트는 상태 변경 없음)
  if (!isSoft) {
    try {
      await _updateRoomStateCache(kv, event);
    } catch {
      // KV 실패는 파이프라인을 막지 않음 (Slack과 동일 정책)
    }
  }

  // 3. Slack 알림
  let notifiedAt = null;
  try {
    const { sent } = await notify(id, event.property_id, event.type);
    if (sent) notifiedAt = new Date().toISOString();
  } catch {
    // Slack 실패는 전체 파이프라인을 막지 않음
  }

  // 4. 상태 complete로 업데이트
  await updateEventStatus(db, id, "complete", notifiedAt);

  return { status: "inserted", id };
}

// 이벤트 타입에 따라 KV 룸 상태 캐시를 갱신한다.
// 상태 기계 전이는 room-state-machine.md 기준이지만
// 여기서는 캐시만 갱신 — 정확한 전이 로직은 occupancyWatcher에 있음.
async function _updateRoomStateCache(kv, event) {
  const STATE_MAP = {
    check_in_detected: { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
    check_out_detected: { mainStatus: "CLEANING", subStatus: "CLEANING_PENDING" },
    cleaning_started: { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
    cleaning_finished: { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
    energy_waste_detected: null,   // subStatus만 변경 → 현재 상태 읽기 필요, 캐시 무효화만
    energy_waste_resolved: null,
    complaint_detected: null,
    complaint_resolved: null,
  };

  const next = STATE_MAP[event.type];
  if (next) {
    await setRoomState(kv, event.property_id, next);
  } else {
    // subStatus 변경이 필요한 이벤트는 TTL 만료로 자연 캐시 무효화
    // (다음 조회 시 DB에서 재계산)
  }
}
