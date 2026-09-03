import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_TYPES,
  SOFT_EVENT_TYPES,
  UNIMPLEMENTED_EVENT_TYPES,
} from "../../src/config/eventTypes.js";

describe("EVENT_TYPES — 값 정확성", () => {
  test("상태 기계 이벤트 값이 올바른 snake_case 문자열이다", () => {
    assert.equal(EVENT_TYPES.CHECK_IN_DETECTED, "check_in_detected");
    assert.equal(EVENT_TYPES.CHECK_OUT_DETECTED, "check_out_detected");
    assert.equal(EVENT_TYPES.CLEANING_STARTED, "cleaning_started");
    assert.equal(EVENT_TYPES.CLEANING_FINISHED, "cleaning_finished");
    assert.equal(EVENT_TYPES.ENERGY_WASTE_DETECTED, "energy_waste_detected");
    assert.equal(EVENT_TYPES.ENERGY_WASTE_RESOLVED, "energy_waste_resolved");
    assert.equal(EVENT_TYPES.COMPLAINT_DETECTED, "complaint_detected");
    assert.equal(EVENT_TYPES.COMPLAINT_RESOLVED, "complaint_resolved");
    assert.equal(
      EVENT_TYPES.CHECKIN_PREP_TIME_REACHED,
      "checkin_prep_time_reached"
    );
    assert.equal(EVENT_TYPES.OPTIMIZATION_FINISHED, "optimization_finished");
    assert.equal(EVENT_TYPES.RESERVATION_CANCELLED, "reservation_cancelled");
  });

  test("soft 이벤트 값이 올바르다", () => {
    assert.equal(
      EVENT_TYPES.CHECKOUT_CONFIRMATION_NEEDED,
      "checkout_confirmation_needed"
    );
    assert.equal(
      EVENT_TYPES.EARLY_CHECKIN_SUSPECTED,
      "early_checkin_suspected"
    );
    assert.equal(EVENT_TYPES.NO_SHOW_SUSPECTED, "no_show_suspected");
  });

  test("미구현 이벤트(maintenance/reservation) 값이 올바르다", () => {
    assert.equal(EVENT_TYPES.MAINTENANCE_REQUIRED, "maintenance_required");
    assert.equal(EVENT_TYPES.MAINTENANCE_STARTED, "maintenance_started");
    assert.equal(EVENT_TYPES.MAINTENANCE_FINISHED, "maintenance_finished");
  });

  test("모든 값이 유일하다 (중복 없음)", () => {
    const values = Object.values(EVENT_TYPES);
    const unique = new Set(values);
    assert.equal(values.length, unique.size, "중복된 이벤트 타입 값이 있음");
  });

  test("Object.freeze 되어 있어 새 프로퍼티 추가 시 TypeError", () => {
    assert.throws(() => {
      "use strict";
      EVENT_TYPES.NEW_KEY = "test";
    }, TypeError);
  });
});

describe("SOFT_EVENT_TYPES — Set 구성", () => {
  test("soft 이벤트 4개를 포함한다 (vacancy_energy_alert 추가)", () => {
    assert.equal(SOFT_EVENT_TYPES.size, 4);
    assert.ok(SOFT_EVENT_TYPES.has("checkout_confirmation_needed"));
    assert.ok(SOFT_EVENT_TYPES.has("early_checkin_suspected"));
    assert.ok(SOFT_EVENT_TYPES.has("no_show_suspected"));
    assert.ok(SOFT_EVENT_TYPES.has("vacancy_energy_alert"));
  });

  test("상태 기계 이벤트는 포함하지 않는다", () => {
    assert.ok(!SOFT_EVENT_TYPES.has("check_in_detected"));
    assert.ok(!SOFT_EVENT_TYPES.has("check_out_detected"));
    assert.ok(!SOFT_EVENT_TYPES.has("cleaning_started"));
  });
});

describe("UNIMPLEMENTED_EVENT_TYPES — Set 구성", () => {
  test("미구현 이벤트 6개를 포함한다", () => {
    assert.equal(UNIMPLEMENTED_EVENT_TYPES.size, 6);
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("maintenance_required"));
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("maintenance_started"));
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("maintenance_finished"));
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("checkin_prep_time_reached"));
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("optimization_finished"));
    assert.ok(UNIMPLEMENTED_EVENT_TYPES.has("reservation_cancelled"));
  });

  test("구현된 이벤트는 포함하지 않는다", () => {
    assert.ok(!UNIMPLEMENTED_EVENT_TYPES.has("check_in_detected"));
    assert.ok(!UNIMPLEMENTED_EVENT_TYPES.has("complaint_detected"));
    assert.ok(!UNIMPLEMENTED_EVENT_TYPES.has("checkout_confirmation_needed"));
  });
});
