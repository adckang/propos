/**
 * 지표 드릴다운 — 실패 건 감지 순수 함수 모음
 * 모든 함수는 events 배열만 받음 (DB 의존 없음)
 *
 * 반환 형태 (공통):
 *   [{ property_id, occurred_at, detail }]
 */

const CLEANING_LIMIT_HOURS = 3;

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
          detail: { duration_hours, started_at, finished_at },
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
