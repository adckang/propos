import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../../src/domain/eventValidation.js";

const validEvent = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  property_id: "paju201",
  type: "check_out_detected",
  device_time: "2026-08-04T10:12:00.000Z",
  data: { noise_db: 42 },
};

describe("validateEvent — 유효 케이스", () => {
  test("유효한 이벤트 → success: true, 파싱된 data 반환", () => {
    const result = validateEvent(validEvent);
    assert.equal(result.success, true);
    assert.equal(result.data.type, "check_out_detected");
    assert.equal(result.data.property_id, "paju201");
  });

  test("data 없어도 유효 (optional)", () => {
    const { data, ...noData } = validEvent;
    const result = validateEvent(noData);
    assert.equal(result.success, true);
  });

  test("soft 이벤트 타입도 유효", () => {
    const result = validateEvent({
      ...validEvent,
      type: "checkout_confirmation_needed",
    });
    assert.equal(result.success, true);
  });

  test("미구현 이벤트 타입도 유효 (파이프라인 건너뜀 용)", () => {
    const result = validateEvent({
      ...validEvent,
      type: "maintenance_required",
    });
    assert.equal(result.success, true);
  });
});

describe("validateEvent — 무효 케이스", () => {
  test("id가 UUID 형식이 아니면 실패", () => {
    const result = validateEvent({ ...validEvent, id: "not-a-uuid" });
    assert.equal(result.success, false);
  });

  test("property_id가 빈 문자열이면 실패", () => {
    const result = validateEvent({ ...validEvent, property_id: "" });
    assert.equal(result.success, false);
  });

  test("property_id가 65자 이상이면 실패", () => {
    const result = validateEvent({
      ...validEvent,
      property_id: "a".repeat(65),
    });
    assert.equal(result.success, false);
  });

  test("type이 EVENT_TYPES에 없는 값이면 실패", () => {
    const result = validateEvent({ ...validEvent, type: "unknown_event" });
    assert.equal(result.success, false);
  });

  test("device_time이 ISO 8601 전체 타임스탬프가 아니면 실패 (날짜만)", () => {
    const result = validateEvent({ ...validEvent, device_time: "2026-08-04" });
    assert.equal(result.success, false);
  });

  test("device_time이 유효하지 않은 문자열이면 실패", () => {
    const result = validateEvent({
      ...validEvent,
      device_time: "not-a-date",
    });
    assert.equal(result.success, false);
  });

  test("id 누락 시 실패", () => {
    const { id, ...noId } = validEvent;
    const result = validateEvent(noId);
    assert.equal(result.success, false);
  });

  test("property_id 누락 시 실패", () => {
    const { property_id, ...noPropertyId } = validEvent;
    const result = validateEvent(noPropertyId);
    assert.equal(result.success, false);
  });

  test("type 누락 시 실패", () => {
    const { type, ...noType } = validEvent;
    const result = validateEvent(noType);
    assert.equal(result.success, false);
  });

  test("device_time 누락 시 실패", () => {
    const { device_time, ...noTime } = validEvent;
    const result = validateEvent(noTime);
    assert.equal(result.success, false);
  });
});
