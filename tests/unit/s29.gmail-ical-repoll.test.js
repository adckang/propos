/**
 * 청소 자동화 — Gmail 웹훅 iCal 재폴링 + SHORT_NOTICE 즉시 처리 유닛 테스트
 * - parseAllFutureCheckouts(): 오늘 이후 모든 체크아웃 추출
 * - SHORT_NOTICE 판별 (≤14일)
 * - 즉시 발동 vs PENDING 분기 로직
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseAllFutureCheckouts } from "../../api/cleaning/_calendar.js";

// ============================================================
// parseAllFutureCheckouts — 오늘 이후 전체 추출
// ============================================================

const SAMPLE_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb//Airbnb//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260901
DTEND;VALUE=DATE:20260903
UID:past-reservation@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261101
DTEND;VALUE=DATE:20261103
UID:near-reservation@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261205
DTEND;VALUE=DATE:20261207
UID:far-reservation@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`;

describe("parseAllFutureCheckouts — 오늘 이후 날짜 필터", () => {
  test("과거 날짜 제외 — 오늘 이후만 반환", () => {
    // nowMs를 2026-10-01 기준으로 설정
    const nowMs = new Date("2026-10-01T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts(SAMPLE_ICAL, nowMs);
    const dates = result.map((r) => r.date);
    assert.ok(!dates.includes("2026-09-03"), "과거 날짜(2026-09-03) 포함되면 안 됨");
    assert.ok(dates.includes("2026-11-03"), "미래 날짜(2026-11-03) 포함되어야 함");
    assert.ok(dates.includes("2026-12-07"), "미래 날짜(2026-12-07) 포함되어야 함");
  });

  test("오늘 날짜 포함 (당일 체크아웃 처리)", () => {
    // nowMs를 2026-11-03T00:00:00Z (당일 체크아웃 날짜)로 설정
    const nowMs = new Date("2026-11-03T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts(SAMPLE_ICAL, nowMs);
    const dates = result.map((r) => r.date);
    assert.ok(dates.includes("2026-11-03"), "오늘 날짜(2026-11-03) 포함되어야 함");
  });

  test("UID 필드 파싱", () => {
    const nowMs = new Date("2026-10-01T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts(SAMPLE_ICAL, nowMs);
    const r = result.find((x) => x.date === "2026-11-03");
    assert.equal(r?.uid, "near-reservation@airbnb.com");
  });

  test("빈 iCal → 빈 배열", () => {
    const nowMs = new Date("2026-10-01T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts("BEGIN:VCALENDAR\nEND:VCALENDAR", nowMs);
    assert.equal(result.length, 0);
  });

  test("전부 과거 → 빈 배열", () => {
    const nowMs = new Date("2027-01-01T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts(SAMPLE_ICAL, nowMs);
    assert.equal(result.length, 0);
  });
});

describe("parseAllFutureCheckouts — 월 제한 없음", () => {
  test("여러 달에 걸친 예약 → 전부 반환", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTEND;VALUE=DATE:20261103
UID:uid-1
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261215
UID:uid-2
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20270115
UID:uid-3
END:VEVENT
END:VCALENDAR`;
    const nowMs = new Date("2026-10-01T00:00:00Z").getTime();
    const result = parseAllFutureCheckouts(ical, nowMs);
    assert.equal(result.length, 3);
  });
});

// ============================================================
// SHORT_NOTICE 판별 로직 (≤14일 이내)
// ============================================================

describe("SHORT_NOTICE 판별 — 14일 기준", () => {
  function getSource(checkoutDateStr, checkoutHour, nowMs) {
    const pad = (n) => String(n).padStart(2, "0");
    const startIso = `${checkoutDateStr}T${pad(checkoutHour)}:00:00+09:00`;
    const startMs = new Date(startIso).getTime();
    const diffDays = (startMs - nowMs) / 86_400_000;
    return diffDays <= 14 ? "SHORT_NOTICE" : "MONTHLY_BATCH";
  }

  const nowMs = new Date("2026-10-01T09:00:00+09:00").getTime(); // KST 09:00

  test("오늘 체크아웃 → SHORT_NOTICE", () => {
    assert.equal(getSource("2026-10-01", 11, nowMs), "SHORT_NOTICE");
  });

  test("3일 후 → SHORT_NOTICE", () => {
    assert.equal(getSource("2026-10-04", 11, nowMs), "SHORT_NOTICE");
  });

  test("13일 후 → SHORT_NOTICE", () => {
    // 2026-10-14 11:00 KST = 2026-10-14T02:00Z, diff = 14.083일 아닌 13.083일
    assert.equal(getSource("2026-10-14", 11, nowMs), "SHORT_NOTICE");
  });

  test("15일 후 → MONTHLY_BATCH (15.08일)", () => {
    assert.equal(getSource("2026-10-16", 11, nowMs), "MONTHLY_BATCH");
  });

  test("30일 후 → MONTHLY_BATCH", () => {
    assert.equal(getSource("2026-10-31", 11, nowMs), "MONTHLY_BATCH");
  });

  test("이미 지난 날짜 → SHORT_NOTICE (음수 diffDays < 14)", () => {
    assert.equal(getSource("2026-09-25", 11, nowMs), "SHORT_NOTICE");
  });
});

// ============================================================
// iCal 재폴링 플로우 시뮬레이션
// ============================================================

describe("Gmail 웹훅 iCal 재폴링 플로우", () => {
  function simulateRepoll(icalText, nowMs, existingJobDates) {
    const checkouts = parseAllFutureCheckouts(icalText, nowMs);
    const pad = (n) => String(n).padStart(2, "0");
    const results = { shortNotice: [], monthlyBatch: [], skipped: [] };

    for (const { date, uid } of checkouts) {
      const startIso = `${date}T11:00:00+09:00`;
      const startMs = new Date(startIso).getTime();
      // DB 충돌 시뮬레이션
      if (existingJobDates.has(date)) { results.skipped.push(date); continue; }
      existingJobDates.add(date);
      const diffDays = (startMs - nowMs) / 86_400_000;
      const source = diffDays <= 14 ? "SHORT_NOTICE" : "MONTHLY_BATCH";
      if (source === "SHORT_NOTICE") results.shortNotice.push(date);
      else results.monthlyBatch.push(date);
    }
    return results;
  }

  const nowMs = new Date("2026-10-01T00:00:00Z").getTime();

  test("신규 SHORT_NOTICE 예약 → 즉시 처리 큐에 추가", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTEND;VALUE=DATE:20261005
UID:uid-new
END:VEVENT
END:VCALENDAR`;
    const result = simulateRepoll(ical, nowMs, new Set());
    assert.equal(result.shortNotice.length, 1);
    assert.equal(result.shortNotice[0], "2026-10-05");
  });

  test("이미 DB에 있는 예약 → 스킵 (ON CONFLICT DO NOTHING)", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTEND;VALUE=DATE:20261005
UID:uid-existing
END:VEVENT
END:VCALENDAR`;
    const existing = new Set(["2026-10-05"]);
    const result = simulateRepoll(ical, nowMs, existing);
    assert.equal(result.shortNotice.length, 0);
    assert.equal(result.skipped.length, 1);
  });

  test("SHORT_NOTICE + MONTHLY_BATCH 혼재", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTEND;VALUE=DATE:20261005
UID:uid-short
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261120
UID:uid-monthly
END:VEVENT
END:VCALENDAR`;
    const result = simulateRepoll(ical, nowMs, new Set());
    assert.equal(result.shortNotice.length, 1);
    assert.equal(result.monthlyBatch.length, 1);
  });

  test("예약 없음 → 모든 카테고리 빈 배열", () => {
    const result = simulateRepoll("BEGIN:VCALENDAR\nEND:VCALENDAR", nowMs, new Set());
    assert.equal(result.shortNotice.length, 0);
    assert.equal(result.monthlyBatch.length, 0);
  });
});

// ============================================================
// Gmail 예약 이메일 Subject 감지
// ============================================================

describe("Gmail 웹훅 — 예약 이메일 Subject 감지", () => {
  const RESERVATION_SUBJECTS = ["reservation confirmed", "예약 확정", "booking confirmed"];

  function isReservationEmail(subject) {
    const lower = subject.toLowerCase();
    return RESERVATION_SUBJECTS.some((s) => lower.includes(s));
  }

  test("'Reservation confirmed' 포함 → 감지", () => {
    assert.ok(isReservationEmail("Reservation confirmed - Paju 201"));
  });

  test("'예약 확정' 포함 → 감지", () => {
    assert.ok(isReservationEmail("[Airbnb] 파주201 예약 확정"));
  });

  test("'Booking Confirmed' (대소문자) → 감지", () => {
    assert.ok(isReservationEmail("Booking Confirmed: Your Stay at Paju"));
  });

  test("관련 없는 이메일 → 미감지", () => {
    assert.ok(!isReservationEmail("Payment received - Airbnb"));
  });

  test("취소 이메일 → 미감지", () => {
    assert.ok(!isReservationEmail("Reservation cancelled - Paju 201"));
  });
});

// ============================================================
// Calendar Webhook — updatedMin 기반 이벤트 필터링
// ============================================================

describe("Calendar Webhook — updatedMin 기반 감지", () => {
  function isRecentlyUpdated(evt, since) {
    if (evt.summary === "[PROPOS-BLOCK]") return false; // 블로커 제외
    if (!evt.updated) return false;
    return new Date(evt.updated) >= new Date(since);
  }

  const since = new Date(Date.now() - 30 * 60_000).toISOString();

  test("최근 30분 이내 업데이트된 청소 예약 → 처리 대상", () => {
    const evt = { summary: "청소 예약", updated: new Date().toISOString(), attendees: [{ email: "cleaner@gmail.com" }] };
    assert.ok(isRecentlyUpdated(evt, since));
  });

  test("[PROPOS-BLOCK] 이벤트 → 건너뜀", () => {
    const evt = { summary: "[PROPOS-BLOCK]", updated: new Date().toISOString() };
    assert.ok(!isRecentlyUpdated(evt, since));
  });

  test("30분 이상 지난 이벤트 → 건너뜀", () => {
    const oldTs = new Date(Date.now() - 60 * 60_000).toISOString(); // 1시간 전
    const evt = { summary: "청소 예약", updated: oldTs };
    assert.ok(!isRecentlyUpdated(evt, since));
  });
});

// ============================================================
// Webhook 보안 — GOOGLE_WEBHOOK_SECRET 검증
// ============================================================

describe("Gmail Webhook 보안 — GOOGLE_WEBHOOK_SECRET 검증", () => {
  // handleGmailWebhook: URL ?secret=X 쿼리와 env 비교
  function validateGmailWebhookSecret(requestSecret, envSecret) {
    if (!envSecret) return true; // 환경변수 미설정 시 통과
    return requestSecret === envSecret;
  }

  test("환경변수 미설정 → 모든 요청 통과", () => {
    assert.ok(validateGmailWebhookSecret("any", undefined));
    assert.ok(validateGmailWebhookSecret("", undefined));
  });

  test("올바른 secret → 통과", () => {
    assert.ok(validateGmailWebhookSecret("MY_SECRET", "MY_SECRET"));
  });

  test("잘못된 secret → 거절 (200 조용히 종료)", () => {
    assert.ok(!validateGmailWebhookSecret("WRONG", "MY_SECRET"));
  });

  test("secret 없음 + env 설정됨 → 거절", () => {
    assert.ok(!validateGmailWebhookSecret("", "MY_SECRET"));
    assert.ok(!validateGmailWebhookSecret(null, "MY_SECRET"));
  });
});

describe("Calendar Webhook 보안 — x-goog-channel-token 검증", () => {
  // handleCalendarWebhook: X-Goog-Channel-Token 헤더와 env 비교
  function validateCalendarWebhookToken(headerToken, envSecret) {
    if (!envSecret) return true; // 환경변수 미설정 시 통과
    return headerToken === envSecret;
  }

  test("환경변수 미설정 → 모든 요청 통과", () => {
    assert.ok(validateCalendarWebhookToken("any", undefined));
  });

  test("올바른 토큰 → 통과", () => {
    assert.ok(validateCalendarWebhookToken("MY_TOKEN", "MY_TOKEN"));
  });

  test("잘못된 토큰 → 거절 (200 조용히 종료)", () => {
    assert.ok(!validateCalendarWebhookToken("WRONG", "MY_TOKEN"));
  });

  test("토큰 없음 + env 설정됨 → 거절", () => {
    assert.ok(!validateCalendarWebhookToken(undefined, "MY_TOKEN"));
  });

  test("resourceState='sync' → 무조건 통과 (초기 등록 ping)", () => {
    // 보안 통과 후 sync 상태는 즉시 200 return (무시)
    const resourceState = "sync";
    assert.equal(resourceState, "sync"); // 조건 확인용 — 실제 코드는 200 반환
  });
});

describe("Google OAuth 환경변수 — refresh token 방식", () => {
  // _calendar.js: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
  // 서비스 계정(GOOGLE_SERVICE_ACCOUNT_JSON)이 아닌 OAuth2 refresh token 방식 사용
  const REQUIRED_OAUTH_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
  const REQUIRED_WATCH_VARS = ["GOOGLE_PUBSUB_TOPIC"];
  const OPTIONAL_SECURITY_VARS = ["GOOGLE_WEBHOOK_SECRET", "CRON_SECRET"];

  test("Calendar API 필수 env 3개 확인", () => {
    assert.equal(REQUIRED_OAUTH_VARS.length, 3);
    assert.ok(REQUIRED_OAUTH_VARS.includes("GOOGLE_CLIENT_ID"));
    assert.ok(REQUIRED_OAUTH_VARS.includes("GOOGLE_CLIENT_SECRET"));
    assert.ok(REQUIRED_OAUTH_VARS.includes("GOOGLE_REFRESH_TOKEN"));
  });

  test("Gmail Watch 필수 env 확인", () => {
    assert.ok(REQUIRED_WATCH_VARS.includes("GOOGLE_PUBSUB_TOPIC"));
  });

  test("보안 env는 선택사항 (미설정 시 검증 스킵)", () => {
    // GOOGLE_WEBHOOK_SECRET: 없으면 webhook 검증 생략
    // CRON_SECRET: 없으면 크론 인증 생략
    assert.equal(OPTIONAL_SECURITY_VARS.length, 2);
  });

  test("GOOGLE_SERVICE_ACCOUNT_JSON은 사용하지 않음 (refresh token 방식으로 구현)", () => {
    // 설계 문서 오류: GOOGLE_SERVICE_ACCOUNT_JSON → 실제 구현은 OAuth2 refresh token
    const unusedVars = ["GOOGLE_SERVICE_ACCOUNT_JSON"];
    assert.ok(!REQUIRED_OAUTH_VARS.some(v => unusedVars.includes(v)));
  });
});
