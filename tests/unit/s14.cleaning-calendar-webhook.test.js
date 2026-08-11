/**
 * 청소 자동화 — Calendar Webhook 배정 로직 유닛 테스트
 * 외부 의존성(Google API, DB) 없이 핵심 로직 검증
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ============================================================
// calendarId 파싱 — x-goog-resource-uri 방식 (수정 후 버전)
// ============================================================

function parseCalendarIdFromUri(resourceUri) {
  const match = resourceUri.match(/\/calendars\/([^/?]+)\//);
  return match ? decodeURIComponent(match[1]) : "";
}

describe("Calendar Webhook — calendarId 파싱", () => {
  test("기본 calendarId 파싱", () => {
    const uri =
      "https://www.googleapis.com/calendar/v3/calendars/abc123%40group.calendar.google.com/events?...";
    assert.equal(
      parseCalendarIdFromUri(uri),
      "abc123@group.calendar.google.com"
    );
  });

  test("숫자 포함 calendarId 파싱 (이전 regex 방식의 버그 케이스)", () => {
    const uri =
      "https://www.googleapis.com/calendar/v3/calendars/prop001%40group.calendar.google.com/events";
    assert.equal(
      parseCalendarIdFromUri(uri),
      "prop001@group.calendar.google.com"
    );
  });

  test("@와 점을 포함한 복잡한 calendarId", () => {
    const uri =
      "https://www.googleapis.com/calendar/v3/calendars/xyz.abc-123%40group.calendar.google.com/events";
    assert.equal(
      parseCalendarIdFromUri(uri),
      "xyz.abc-123@group.calendar.google.com"
    );
  });

  test("빈 URI → 빈 문자열 반환", () => {
    assert.equal(parseCalendarIdFromUri(""), "");
  });

  test("유효하지 않은 URI 형식 → 빈 문자열", () => {
    assert.equal(parseCalendarIdFromUri("https://example.com/"), "");
  });

  // 이전 방식의 버그 재현: channelId regex로 파싱
  test("[회귀] 이전 channelId regex 방식 — 숫자 포함 시 오파싱", () => {
    const channelId = "cleaning-prop001-1234567890";
    // 이전 방식: 앞의 'cleaning-' 제거, 뒤의 '-숫자+' 제거
    const buggyParse = channelId.replace(/^cleaning-/, "").replace(/-\d+$/, "");
    // 'prop001'이 되어야 하지만 실제 calendarId는 'prop001@group.calendar.google.com'
    // → @가 없어 DB 조회 실패
    assert.equal(buggyParse, "prop001");
    assert.ok(!buggyParse.includes("@"), "이전 방식은 @ 포함 불가 → 조회 실패");
  });
});

// ============================================================
// 배정 로직 — 이메일 → cleaner 매핑
// ============================================================

describe("Calendar Webhook — attendee 이메일 처리", () => {
  function findCleanerByEmail(cleaners, email) {
    return cleaners.find((c) => c.email === email.toLowerCase().trim()) ?? null;
  }

  const cleaners = [
    { id: "c-1", email: "cleaner1@gmail.com", name: "김청소" },
    { id: "c-2", email: "cleaner2@naver.com", name: "이청소" },
  ];

  test("등록된 이메일 → cleaner 반환", () => {
    const c = findCleanerByEmail(cleaners, "cleaner1@gmail.com");
    assert.equal(c?.id, "c-1");
  });

  test("대문자 이메일도 소문자로 정규화하여 매칭", () => {
    const c = findCleanerByEmail(cleaners, "CLEANER1@GMAIL.COM");
    assert.equal(c?.id, "c-1");
  });

  test("미등록 이메일 → null (미등록 배정 흐름으로 처리)", () => {
    const c = findCleanerByEmail(cleaners, "unknown@example.com");
    assert.equal(c, null);
  });
});

// ============================================================
// 조건부 UPDATE 로직 검증 (race condition 방어)
// ============================================================

describe("Calendar Webhook — 조건부 배정 UPDATE", () => {
  // 실제 DB 없이 로직 시뮬레이션
  function simulateConditionalAssign(job, newCleanerId) {
    if (job.status === "ASSIGNED") return { assigned: false, reason: "already_assigned" };
    job.status = "ASSIGNED";
    job.assigned_cleaner_id = newCleanerId;
    return { assigned: true };
  }

  test("NOTIFYING_BULK 상태 → 배정 성공", () => {
    const job = { id: "j1", status: "NOTIFYING_BULK", assigned_cleaner_id: null };
    const result = simulateConditionalAssign(job, "c-1");
    assert.ok(result.assigned);
    assert.equal(job.status, "ASSIGNED");
    assert.equal(job.assigned_cleaner_id, "c-1");
  });

  test("이미 ASSIGNED 상태 → 배정 실패 (race condition 방어)", () => {
    const job = { id: "j2", status: "ASSIGNED", assigned_cleaner_id: "c-1" };
    const result = simulateConditionalAssign(job, "c-2");
    assert.ok(!result.assigned);
    assert.equal(result.reason, "already_assigned");
    assert.equal(job.assigned_cleaner_id, "c-1"); // 기존 배정 유지
  });

  test("NOTIFYING_VIP_1 상태 → 배정 성공", () => {
    const job = { id: "j3", status: "NOTIFYING_VIP_1", assigned_cleaner_id: null };
    const result = simulateConditionalAssign(job, "c-1");
    assert.ok(result.assigned);
  });
});

// ============================================================
// Google resource state 처리
// ============================================================

describe("Calendar Webhook — resource state 처리", () => {
  function shouldProcess(resourceState) {
    return resourceState !== "sync" && !!resourceState;
  }

  test("'sync' state → skip (초기 등록 ping)", () => {
    assert.ok(!shouldProcess("sync"));
  });

  test("'exists' state → 처리 대상", () => {
    assert.ok(shouldProcess("exists"));
  });

  test("'not_exists' state → 처리 대상", () => {
    assert.ok(shouldProcess("not_exists"));
  });

  test("빈 state → skip", () => {
    assert.ok(!shouldProcess(""));
  });
});
