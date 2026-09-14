/**
 * s38 — 지표 드릴다운: 실패 건 목록 조회
 *
 * 대상 함수:
 *   - detectCleaningTimeFailures(events)          — src/domain/metricDrilldownDomain.js
 *   - detectEventTypeFailures(events, eventType)   — src/domain/metricDrilldownDomain.js
 *   - detectPreStayOptimizationFailures(events)    — src/domain/metricDrilldownDomain.js
 *   - getDrilldownForMetric(metric, period, deps)  — src/application/reportingService.js
 *
 * 설계 원칙:
 *   - 도메인 함수는 순수함수 — events 배열만 받음 (DB 의존 없음)
 *   - 각 실패 건은 { property_id, occurred_at, detail } 형태
 *   - cleaning_time: cleaning_started + cleaning_finished 페어링, duration > 3h인 건만
 *   - event_type 계열: 해당 이벤트 존재 자체가 실패
 *   - pre_stay_optimization: checkin_prep_time_reached에 매칭 optimization_finished 없는 건
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  detectCleaningTimeFailures,
  detectEventTypeFailures,
  detectPreStayOptimizationFailures,
} from "../../src/domain/metricDrilldownDomain.js";
import { getDrilldownForMetric } from "../../src/application/reportingService.js";

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
const t = (iso) => new Date(iso);
const event = (type, property_id, device_time, data = {}) => ({ type, property_id, device_time, data });

// ─────────────────────────────────────────────
// detectCleaningTimeFailures
// ─────────────────────────────────────────────
describe("detectCleaningTimeFailures — 청소 3시간 초과 건 감지", () => {
  test("2건 시작+완료, 1건만 3시간 초과 → 초과 건만 반환", () => {
    const events = [
      event("cleaning_started",  "room-101", t("2026-09-08T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-08T13:50:00Z")), // 3h50m 초과
      event("cleaning_started",  "room-202", t("2026-09-08T11:00:00Z")),
      event("cleaning_finished", "room-202", t("2026-09-08T13:30:00Z")), // 2h30m 정상
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].property_id, "room-101");
    assert.ok(failures[0].detail.duration_hours > 3);
    assert.ok(failures[0].detail.started_at);
    assert.ok(failures[0].detail.finished_at);
  });

  test("정확히 3시간(180분)은 통과 — 초과 아님", () => {
    const events = [
      event("cleaning_started",  "room-101", t("2026-09-08T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-08T13:00:00Z")), // 정확히 3h
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 0);
  });

  test("3시간 1초 초과는 실패", () => {
    const events = [
      event("cleaning_started",  "room-101", t("2026-09-08T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-08T13:00:01Z")), // 1초 초과
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 1);
  });

  test("cleaning_started 없이 cleaning_finished만 있으면 페어링 안 됨 → 포함 안 됨", () => {
    const events = [
      event("cleaning_finished", "room-101", t("2026-09-08T13:00:00Z")),
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 0);
  });

  test("cleaning_started만 있고 finished 없으면 포함 안 됨 (청소 중)", () => {
    const events = [
      event("cleaning_started", "room-101", t("2026-09-08T10:00:00Z")),
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 0);
  });

  test("같은 숙소 청소 2회 — 각각 독립 페어링", () => {
    const events = [
      event("cleaning_started",  "room-101", t("2026-09-07T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-07T11:00:00Z")), // 1h 정상
      event("cleaning_started",  "room-101", t("2026-09-08T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-08T14:00:00Z")), // 4h 초과
    ];
    const failures = detectCleaningTimeFailures(events);
    assert.equal(failures.length, 1);
    assert.ok(failures[0].detail.duration_hours > 3);
  });

  test("빈 배열 → 빈 배열 반환", () => {
    assert.deepEqual(detectCleaningTimeFailures([]), []);
  });

  test("반환 객체 형태 확인 — property_id, occurred_at, detail 필드 존재", () => {
    const events = [
      event("cleaning_started",  "room-101", t("2026-09-08T10:00:00Z")),
      event("cleaning_finished", "room-101", t("2026-09-08T14:30:00Z")),
    ];
    const [item] = detectCleaningTimeFailures(events);
    assert.ok("property_id"  in item, "property_id 없음");
    assert.ok("occurred_at"  in item, "occurred_at 없음");
    assert.ok("detail"       in item, "detail 없음");
    assert.ok("duration_hours" in item.detail, "detail.duration_hours 없음");
    assert.ok("started_at"    in item.detail, "detail.started_at 없음");
    assert.ok("finished_at"   in item.detail, "detail.finished_at 없음");
  });
});

// ─────────────────────────────────────────────
// detectEventTypeFailures
// ─────────────────────────────────────────────
describe("detectEventTypeFailures — 이벤트 존재 자체가 실패인 지표", () => {
  test("해당 이벤트 있으면 모두 실패 건으로 반환", () => {
    const events = [
      event("post_checkout_energy_waste_detected",    "room-101", t("2026-09-08T10:00:00Z")),
      event("post_checkout_energy_waste_detected",    "room-202", t("2026-09-08T11:00:00Z")),
      event("post_checkout_security_breach_detected", "room-303", t("2026-09-08T12:00:00Z")),
    ];
    const failures = detectEventTypeFailures(events, "post_checkout_energy_waste_detected");
    assert.equal(failures.length, 2);
    assert.equal(failures[0].property_id, "room-101");
    assert.equal(failures[1].property_id, "room-202");
  });

  test("해당 이벤트 없으면 빈 배열", () => {
    const events = [
      event("check_out_detected", "room-101", t("2026-09-08T10:00:00Z")),
    ];
    const failures = detectEventTypeFailures(events, "post_checkout_energy_waste_detected");
    assert.equal(failures.length, 0);
  });

  test("같은 숙소에서 동일 이벤트 여러 번 → 건별로 모두 포함", () => {
    const events = [
      event("vacant_energy_waste_detected", "room-101", t("2026-09-08T10:00:00Z")),
      event("vacant_energy_waste_detected", "room-101", t("2026-09-09T15:00:00Z")),
    ];
    const failures = detectEventTypeFailures(events, "vacant_energy_waste_detected");
    assert.equal(failures.length, 2);
  });

  test("반환 객체 형태 — property_id, occurred_at, detail 필드 존재", () => {
    const events = [
      event("post_cleaning_security_breach_detected", "room-101", t("2026-09-08T10:00:00Z")),
    ];
    const [item] = detectEventTypeFailures(events, "post_cleaning_security_breach_detected");
    assert.ok("property_id" in item);
    assert.ok("occurred_at" in item);
    assert.ok("detail"      in item);
  });

  test("occurred_at이 이벤트 device_time과 일치", () => {
    const ts = t("2026-09-08T10:00:00Z");
    const events = [event("post_checkout_energy_waste_detected", "room-101", ts)];
    const [item] = detectEventTypeFailures(events, "post_checkout_energy_waste_detected");
    assert.deepEqual(item.occurred_at, ts);
  });

  test("빈 배열 → 빈 배열", () => {
    assert.deepEqual(detectEventTypeFailures([], "any_event"), []);
  });
});

// ─────────────────────────────────────────────
// detectPreStayOptimizationFailures
// ─────────────────────────────────────────────
describe("detectPreStayOptimizationFailures — 입실전 최적화 실패 건", () => {
  test("prep 2건 중 optimization 1건만 → 미완료 1건 반환", () => {
    const events = [
      event("checkin_prep_time_reached", "room-101", t("2026-09-08T10:00:00Z")),
      event("checkin_prep_time_reached", "room-202", t("2026-09-08T11:00:00Z")),
      event("optimization_finished",     "room-101", t("2026-09-08T10:30:00Z")), // 101호만 완료
    ];
    const failures = detectPreStayOptimizationFailures(events);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].property_id, "room-202");
  });

  test("모두 optimization_finished 있으면 빈 배열", () => {
    const events = [
      event("checkin_prep_time_reached", "room-101", t("2026-09-08T10:00:00Z")),
      event("optimization_finished",     "room-101", t("2026-09-08T10:30:00Z")),
    ];
    const failures = detectPreStayOptimizationFailures(events);
    assert.equal(failures.length, 0);
  });

  test("checkin_prep_time_reached 없으면 빈 배열", () => {
    const events = [
      event("optimization_finished", "room-101", t("2026-09-08T10:30:00Z")),
    ];
    const failures = detectPreStayOptimizationFailures(events);
    assert.equal(failures.length, 0);
  });

  test("빈 배열 → 빈 배열", () => {
    assert.deepEqual(detectPreStayOptimizationFailures([]), []);
  });

  test("반환 객체 — property_id, occurred_at, detail 필드 존재", () => {
    const events = [
      event("checkin_prep_time_reached", "room-101", t("2026-09-08T10:00:00Z")),
    ];
    const [item] = detectPreStayOptimizationFailures(events);
    assert.ok("property_id" in item);
    assert.ok("occurred_at" in item);
    assert.ok("detail"      in item);
  });
});

// ─────────────────────────────────────────────
// getDrilldownForMetric — 애플리케이션 서비스
// ─────────────────────────────────────────────
describe("getDrilldownForMetric — 지표별 실패 건 조회 서비스", () => {
  // Mock DB: cleaning_time 초과 1건
  const mockDbCleaning = {
    query: async () => ({
      rows: [
        { type: "cleaning_started",  property_id: "room-101", device_time: t("2026-09-08T10:00:00Z"), data: null },
        { type: "cleaning_finished", property_id: "room-101", device_time: t("2026-09-08T14:30:00Z"), data: null },
        { type: "cleaning_started",  property_id: "room-202", device_time: t("2026-09-08T11:00:00Z"), data: null },
        { type: "cleaning_finished", property_id: "room-202", device_time: t("2026-09-08T12:30:00Z"), data: null },
      ],
    }),
  };

  // Mock DB: 에너지 위반 2건
  const mockDbEnergy = {
    query: async () => ({
      rows: [
        { type: "post_checkout_energy_waste_detected", property_id: "room-101", device_time: t("2026-09-08T10:00:00Z"), data: null },
        { type: "post_checkout_energy_waste_detected", property_id: "room-303", device_time: t("2026-09-08T12:00:00Z"), data: null },
      ],
    }),
  };

  test("metric=cleaning_time → 3시간 초과 건만 반환", async () => {
    const result = await getDrilldownForMetric("cleaning_time", "last_week", { db: mockDbCleaning });
    assert.equal(result.metric, "cleaning_time");
    assert.equal(result.failCount, 1);
    assert.equal(result.items[0].property_id, "room-101");
    assert.ok(result.items[0].detail.duration_hours > 3);
  });

  test("metric=post_checkout_energy → 에너지 위반 건 반환", async () => {
    const result = await getDrilldownForMetric("post_checkout_energy", "last_week", { db: mockDbEnergy });
    assert.equal(result.metric, "post_checkout_energy");
    assert.equal(result.failCount, 2);
  });

  test("metric=post_checkout_security → post_checkout_security_breach_detected 조회", async () => {
    const mockDb = {
      query: async () => ({
        rows: [{ type: "post_checkout_security_breach_detected", property_id: "room-101", device_time: t("2026-09-08T10:00:00Z"), data: null }],
      }),
    };
    const result = await getDrilldownForMetric("post_checkout_security", "last_week", { db: mockDb });
    assert.equal(result.failCount, 1);
  });

  test("metric=vacant_energy → vacant_energy_waste_detected 조회", async () => {
    const mockDb = {
      query: async () => ({
        rows: [{ type: "vacant_energy_waste_detected", property_id: "room-202", device_time: t("2026-09-08T10:00:00Z"), data: null }],
      }),
    };
    const result = await getDrilldownForMetric("vacant_energy", "last_week", { db: mockDb });
    assert.equal(result.metric, "vacant_energy");
    assert.equal(result.failCount, 1);
  });

  test("metric=post_cleaning_security → post_cleaning_security_breach_detected 조회", async () => {
    const mockDb = {
      query: async () => ({ rows: [] }),
    };
    const result = await getDrilldownForMetric("post_cleaning_security", "last_week", { db: mockDb });
    assert.equal(result.failCount, 0);
    assert.deepEqual(result.items, []);
  });

  test("metric=pre_stay_optimization → checkin_prep 미완료 건 반환", async () => {
    const mockDb = {
      query: async () => ({
        rows: [
          { type: "checkin_prep_time_reached", property_id: "room-101", device_time: t("2026-09-08T10:00:00Z"), data: null },
          { type: "checkin_prep_time_reached", property_id: "room-202", device_time: t("2026-09-08T11:00:00Z"), data: null },
          { type: "optimization_finished",     property_id: "room-101", device_time: t("2026-09-08T10:30:00Z"), data: null },
        ],
      }),
    };
    const result = await getDrilldownForMetric("pre_stay_optimization", "last_week", { db: mockDb });
    assert.equal(result.failCount, 1);
    assert.equal(result.items[0].property_id, "room-202");
  });

  test("알 수 없는 metric → 에러 throw", async () => {
    await assert.rejects(
      () => getDrilldownForMetric("unknown_metric", "last_week", { db: mockDbCleaning }),
      { message: /unknown metric/i }
    );
  });

  test("실패 건 없으면 failCount=0, items=[] 반환", async () => {
    const emptyDb = { query: async () => ({ rows: [] }) };
    const result = await getDrilldownForMetric("cleaning_time", "last_week", { db: emptyDb });
    assert.equal(result.failCount, 0);
    assert.deepEqual(result.items, []);
  });

  test("반환 객체 형태 — metric, period, failCount, items 필드 존재", async () => {
    const emptyDb = { query: async () => ({ rows: [] }) };
    const result = await getDrilldownForMetric("vacant_energy", "last_week", { db: emptyDb });
    assert.ok("metric"    in result);
    assert.ok("period"    in result);
    assert.ok("failCount" in result);
    assert.ok("items"     in result);
    assert.equal(result.period, "last_week");
  });
});
