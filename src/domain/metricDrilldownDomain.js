/**
 * 지표 드릴다운 — 실패 건 감지 순수 함수 모음
 * 모든 함수는 events 배열만 받음 (DB 의존 없음)
 *
 * 반환 형태 (공통):
 *   [{ property_id, occurred_at, detail }]
 */

export const CLEANING_LIMIT_HOURS = 3;

/**
 * 청소 시작~완료 시간이 기준(3시간)을 초과한 건 반환.
 * cleaning_started + cleaning_finished를 property_id 기준으로 페어링.
 * started 없는 finished, 또는 finished 없는 started는 무시.
 */
export function detectCleaningTimeFailures(events) {
  const starts   = new Map(); // property_id → [device_time, ...]
  const finishes = new Map();

  for (const { type, property_id, device_time } of events) {
    if (type === "cleaning_started") {
      if (!starts.has(property_id)) starts.set(property_id, []);
      starts.get(property_id).push(device_time);
    } else if (type === "cleaning_finished") {
      if (!finishes.has(property_id)) finishes.set(property_id, []);
      finishes.get(property_id).push(device_time);
    }
  }

  const failures = [];

  for (const [property_id, startTimes] of starts) {
    const finishTimes = finishes.get(property_id);
    if (!finishTimes) continue;

    // 시간순 정렬 후 순서대로 페어링
    const sortedStarts   = [...startTimes].sort((a, b) => a - b);
    const sortedFinishes = [...finishTimes].sort((a, b) => a - b);
    const pairCount = Math.min(sortedStarts.length, sortedFinishes.length);

    for (let i = 0; i < pairCount; i++) {
      const started_at  = sortedStarts[i];
      const finished_at = sortedFinishes[i];
      const duration_hours = (finished_at - started_at) / (1000 * 60 * 60);

      if (duration_hours > CLEANING_LIMIT_HOURS) {
        failures.push({
          property_id,
          occurred_at: finished_at,
          detail: { duration_hours, started_at, finished_at, limit_hours: CLEANING_LIMIT_HOURS },
        });
      }
    }
  }

  return failures;
}

/**
 * 특정 이벤트 타입이 존재하는 건이 곧 실패인 지표.
 * post_checkout_energy_waste_detected 등.
 */
export function detectEventTypeFailures(events, eventType) {
  return events
    .filter(e => e.type === eventType)
    .map(({ property_id, device_time }) => ({
      property_id,
      occurred_at: device_time,
      detail: {},
    }));
}

/**
 * checkin_prep_time_reached 중 같은 property_id의 optimization_finished가 없는 건 반환.
 */
export function detectPreStayOptimizationFailures(events) {
  const preps     = events.filter(e => e.type === "checkin_prep_time_reached");
  const optimized = new Set(
    events
      .filter(e => e.type === "optimization_finished")
      .map(e => e.property_id)
  );

  return preps
    .filter(e => !optimized.has(e.property_id))
    .map(({ property_id, device_time }) => ({
      property_id,
      occurred_at: device_time,
      detail: {},
    }));
}

// ── 위반 건의 "정도"를 알 수 있게 앞뒤 이벤트를 짝지어 준다 ────────────────────────────────
// 화면(violationDetailDomain)이 "퇴실 12분 뒤 감지", "2시간 10분 켜져 있음"처럼 숫자를 보여주려면
// 그 건이 무엇 뒤에 일어났는지, 언제 해소됐는지가 필요하다. 짝을 못 찾으면 해당 키를 넣지 않는다
// (detail 이 비어 있으면 화면은 "정도를 모르는 건"으로 그린다).

function toMs(raw) {
  if (raw == null) return null;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * detectEventTypeFailures 결과에 앞뒤 이벤트 정보를 붙인다.
 *
 * @param {object[]} events
 * @param {string} eventType                감지 이벤트 (예: vacant_energy_waste_detected)
 * @param {{ anchorType?: string, resolutionType?: string }} [opts]
 *   anchorType     — 이 건 "직전"의 기준 이벤트 (예: check_out_detected). 있으면 detail.anchor_at
 *   resolutionType — 이 건 "직후"의 해소 이벤트 (예: vacant_energy_waste_resolved). 있으면 detail.resolved_at
 * 그 밖에 이벤트 data.reason 이 문자열이면 detail.reason 으로 옮긴다.
 */
export function detectEventFailuresWithContext(events, eventType, { anchorType, resolutionType } = {}) {
  const byProperty = (type) => {
    const map = new Map();
    for (const e of events) {
      if (e.type !== type) continue;
      const ms = toMs(e.device_time);
      if (ms == null) continue;
      if (!map.has(e.property_id)) map.set(e.property_id, []);
      map.get(e.property_id).push(ms);
    }
    return map;
  };
  const anchors     = anchorType     ? byProperty(anchorType)     : null;
  const resolutions = resolutionType ? byProperty(resolutionType) : null;

  return events
    .filter(e => e.type === eventType)
    .map(e => {
      const at = toMs(e.device_time);
      const detail = {};
      if (at != null && anchors) {
        // 이 건과 같거나 그 전에 있었던 가장 가까운 기준 이벤트
        const before = (anchors.get(e.property_id) ?? []).filter(ms => ms <= at);
        if (before.length > 0) detail.anchor_at = toIso(Math.max(...before));
      }
      if (at != null && resolutions) {
        // 이 건 뒤에 처음 나온 해소 이벤트
        const after = (resolutions.get(e.property_id) ?? []).filter(ms => ms > at);
        if (after.length > 0) detail.resolved_at = toIso(Math.min(...after));
      }
      const reason = e.data?.reason;
      if (typeof reason === "string" && reason.trim()) detail.reason = reason.trim();
      return { property_id: e.property_id, occurred_at: e.device_time, detail };
    });
}

/** 공실 에너지 낭비 — 감지 → 꺼짐(해소)까지 얼마나 켜져 있었는지 */
export function detectVacantEnergyFailures(events) {
  return detectEventFailuresWithContext(events, "vacant_energy_waste_detected", {
    resolutionType: "vacant_energy_waste_resolved",
  });
}

/** 퇴실 후 청소 전 절전·보안 위반 — 퇴실 감지로부터 몇 분 뒤였는지 */
export function detectPostCheckoutFailures(events, eventType) {
  return detectEventFailuresWithContext(events, eventType, { anchorType: "check_out_detected" });
}

/** 청소 완료 후 보안 위반 — 청소 완료로부터 몇 분 뒤였는지 */
export function detectPostCleaningFailures(events, eventType) {
  return detectEventFailuresWithContext(events, eventType, { anchorType: "cleaning_finished" });
}
