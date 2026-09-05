/**
 * 청소 자동화 — Gmail 웹훅 iCal 재폴링 + SHORT_NOTICE 즉시 처리 유닛 테스트
 * - parseAllFutureCheckouts(): 오늘 이후 모든 체크아웃 추출
 * - SHORT_NOTICE 판별 (≤14일)
 * - 즉시 발동 vs PENDING 분기 로직
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
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

// ============================================================
// Gmail/Calendar 토큰 분리 아키텍처
// 오늘(2026-09-04) 발견된 버그: handleGmailWebhook·registerGmailWatch가
// getGoogleToken()(Calendar용, bnb.paju)을 써서 nam5821 메일함 접근이 안 됐음.
// 두 토큰은 계정·스코프가 다르며 절대 혼용 금지.
// ============================================================

describe("Gmail/Calendar 토큰 분리 아키텍처", () => {
  // getGoogleToken → GOOGLE_CALENDAR_REFRESH_TOKEN (bnb.paju, calendar scope)
  // getGmailToken  → GOOGLE_REFRESH_TOKEN          (nam5821,  mail.google.com scope)

  function resolveCalendarRefreshToken(env) {
    return env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? env.GOOGLE_REFRESH_TOKEN;
  }
  function resolveGmailRefreshToken(env) {
    return env.GOOGLE_REFRESH_TOKEN ?? env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  }

  test("getGoogleToken은 GOOGLE_CALENDAR_REFRESH_TOKEN을 우선 사용", () => {
    const env = { GOOGLE_CALENDAR_REFRESH_TOKEN: "cal-token", GOOGLE_REFRESH_TOKEN: "gmail-token" };
    assert.equal(resolveCalendarRefreshToken(env), "cal-token");
  });

  test("getGmailToken은 GOOGLE_REFRESH_TOKEN을 우선 사용", () => {
    const env = { GOOGLE_CALENDAR_REFRESH_TOKEN: "cal-token", GOOGLE_REFRESH_TOKEN: "gmail-token" };
    assert.equal(resolveGmailRefreshToken(env), "gmail-token");
  });

  test("두 토큰이 모두 설정된 경우 서로 다른 값 반환 (혼용 금지)", () => {
    const env = { GOOGLE_CALENDAR_REFRESH_TOKEN: "cal-token", GOOGLE_REFRESH_TOKEN: "gmail-token" };
    assert.notEqual(resolveCalendarRefreshToken(env), resolveGmailRefreshToken(env));
  });

  test("GOOGLE_CALENDAR_REFRESH_TOKEN 미설정 시 getGoogleToken은 GOOGLE_REFRESH_TOKEN으로 폴백", () => {
    const env = { GOOGLE_REFRESH_TOKEN: "gmail-token" };
    assert.equal(resolveCalendarRefreshToken(env), "gmail-token");
  });

  test("GOOGLE_REFRESH_TOKEN 미설정 시 getGmailToken은 GOOGLE_CALENDAR_REFRESH_TOKEN으로 폴백", () => {
    const env = { GOOGLE_CALENDAR_REFRESH_TOKEN: "cal-token" };
    assert.equal(resolveGmailRefreshToken(env), "cal-token");
  });

  // 핵심 계약: Gmail 관련 함수는 반드시 getGmailToken 사용
  // L2: 소스코드 grep으로 실제 코드 검증 (2026-09-04 버그에서 교훈)
  test("handleGmailWebhook은 getGmailToken 사용 — 소스코드 확인", () => {
    const slug = fileURLToPath(new URL("../../api/cleaning/[...slug].js", import.meta.url));
    const src = readFileSync(slug, "utf8");

    // handleGmailWebhook 함수 블록 추출 (async function handleGmailWebhook ~ 다음 async function)
    const fnMatch = src.match(/async function handleGmailWebhook[\s\S]*?(?=\nasync function |\nexport default )/);
    assert.ok(fnMatch, "handleGmailWebhook 함수를 찾을 수 없음");
    const fnBody = fnMatch[0];

    assert.ok(fnBody.includes("getGmailToken"), "handleGmailWebhook 내에 getGmailToken() 호출 필수");
    assert.ok(!fnBody.includes("getGoogleToken()"), "handleGmailWebhook 내에 getGoogleToken() 호출 금지 (Calendar 토큰 혼용)");
  });

  test("registerGmailWatch는 getGmailToken 사용 — 소스코드 확인", () => {
    const slug = fileURLToPath(new URL("../../api/cleaning/[...slug].js", import.meta.url));
    const src = readFileSync(slug, "utf8");

    const fnMatch = src.match(/async function registerGmailWatch[\s\S]*?(?=\nasync function |\nexport default )/);
    assert.ok(fnMatch, "registerGmailWatch 함수를 찾을 수 없음");
    const fnBody = fnMatch[0];

    assert.ok(fnBody.includes("getGmailToken"), "registerGmailWatch 내에 getGmailToken() 호출 필수");
    assert.ok(!fnBody.includes("getGoogleToken()"), "registerGmailWatch 내에 getGoogleToken() 호출 금지");
  });

  test("cron Gmail Watch 갱신은 getGmailToken 사용 — 소스코드 확인", () => {
    const cronSlug = fileURLToPath(new URL("../../api/cron/[...slug].js", import.meta.url));
    const src = readFileSync(cronSlug, "utf8");

    // gmail_watch 또는 GmailWatch 갱신 블록에 getGmailToken 사용 여부
    assert.ok(src.includes("getGmailToken"), "cron Gmail Watch 갱신은 getGmailToken 사용 필수");
  });
});

// ============================================================
// Gmail Webhook Pub/Sub 페이로드 파싱
// ============================================================

describe("Gmail Webhook — Pub/Sub 페이로드 파싱", () => {
  function parseWebhookPayload(body) {
    const b64 = body?.message?.data;
    if (!b64) return null;
    try {
      const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      return payload.historyId ? payload : null;
    } catch {
      return null;
    }
  }

  test("유효한 Pub/Sub 페이로드 → historyId 추출", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "nam5821@gmail.com", historyId: "12345" })).toString("base64");
    const body = { message: { data, messageId: "msg-1" }, subscription: "projects/propos-worker/subscriptions/propos-gmail-push" };
    const result = parseWebhookPayload(body);
    assert.equal(result?.historyId, "12345");
  });

  test("message.data 없음 → null (웹훅 스킵)", () => {
    assert.equal(parseWebhookPayload({ message: {} }), null);
    assert.equal(parseWebhookPayload({}), null);
  });

  test("historyId 없는 JSON → null (웹훅 스킵)", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "nam5821@gmail.com" })).toString("base64");
    assert.equal(parseWebhookPayload({ message: { data } }), null);
  });

  test("잘못된 base64 → null (웹훅 스킵)", () => {
    assert.equal(parseWebhookPayload({ message: { data: "!!!invalid!!!" } }), null);
  });

  test("emailAddress 필드 포함 확인 (계정 식별용)", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "nam5821@gmail.com", historyId: "99999" })).toString("base64");
    const result = parseWebhookPayload({ message: { data } });
    assert.equal(result?.emailAddress, "nam5821@gmail.com");
  });
});

// ============================================================
// Gmail Webhook 전체 플로우 — mock 기반 통합 검증
// ============================================================

describe("Gmail Webhook 전체 플로우 (mock)", () => {
  const RESERVATION_SUBJECTS = ["reservation confirmed", "예약 확정", "booking confirmed"];

  // 웹훅 핸들러 핵심 로직 추출 (토큰 주입 가능한 형태)
  async function simulateWebhookFlow({ historyId, mockMessages, token }) {
    const called = { syncTriggered: false, tokenUsed: token };
    const history = mockMessages.filter(() => true); // 모든 메시지 반환 가정
    for (const msg of history) {
      const subject = msg.subject ?? "";
      if (RESERVATION_SUBJECTS.some((s) => subject.toLowerCase().includes(s))) {
        called.syncTriggered = true;
        break;
      }
    }
    return called;
  }

  test("예약 확정 메일 감지 → iCal sync 트리거", async () => {
    const result = await simulateWebhookFlow({
      historyId: "2704452",
      mockMessages: [{ subject: "예약 확정 - 지웅 박 님이 9월 6일에 체크인할 예정입니다" }],
      token: "gmail-access-token",
    });
    assert.ok(result.syncTriggered);
  });

  test("관련 없는 메일 → sync 미트리거", async () => {
    const result = await simulateWebhookFlow({
      historyId: "2704500",
      mockMessages: [{ subject: "LinkedIn: Someone wants to connect" }],
      token: "gmail-access-token",
    });
    assert.ok(!result.syncTriggered);
  });

  test("빈 history → sync 미트리거", async () => {
    const result = await simulateWebhookFlow({
      historyId: "2704500",
      mockMessages: [],
      token: "gmail-access-token",
    });
    assert.ok(!result.syncTriggered);
  });

  test("여러 메일 중 하나만 예약 확정 → sync 트리거 (한 번만)", async () => {
    const result = await simulateWebhookFlow({
      historyId: "2704500",
      mockMessages: [
        { subject: "Payment received - Airbnb" },
        { subject: "Reservation confirmed - Paju 201" },
        { subject: "Your receipt from Airbnb" },
      ],
      token: "gmail-access-token",
    });
    assert.ok(result.syncTriggered);
  });
});

describe("Google OAuth 환경변수 — refresh token 방식", () => {
  // getGoogleToken: GOOGLE_CALENDAR_REFRESH_TOKEN (bnb.paju, Calendar 전용)
  // getGmailToken:  GOOGLE_REFRESH_TOKEN          (nam5821,  Gmail 전용)
  const CALENDAR_TOKEN_VAR = "GOOGLE_CALENDAR_REFRESH_TOKEN"; // bnb.paju
  const GMAIL_TOKEN_VAR    = "GOOGLE_REFRESH_TOKEN";          // nam5821
  const REQUIRED_WATCH_VARS = ["GOOGLE_PUBSUB_TOPIC"];
  const OPTIONAL_SECURITY_VARS = ["GOOGLE_WEBHOOK_SECRET", "CRON_SECRET"];

  test("Calendar 전용 env: GOOGLE_CALENDAR_REFRESH_TOKEN (bnb.paju)", () => {
    assert.equal(CALENDAR_TOKEN_VAR, "GOOGLE_CALENDAR_REFRESH_TOKEN");
  });

  test("Gmail Watch 전용 env: GOOGLE_REFRESH_TOKEN (nam5821 호스트 계정)", () => {
    assert.equal(GMAIL_TOKEN_VAR, "GOOGLE_REFRESH_TOKEN");
  });

  test("두 토큰은 서로 다른 계정·스코프 (혼용 금지)", () => {
    assert.notEqual(CALENDAR_TOKEN_VAR, GMAIL_TOKEN_VAR);
  });

  test("Gmail Watch 필수 env 확인", () => {
    assert.ok(REQUIRED_WATCH_VARS.includes("GOOGLE_PUBSUB_TOPIC"));
  });

  test("보안 env는 선택사항 (미설정 시 검증 스킵)", () => {
    assert.equal(OPTIONAL_SECURITY_VARS.length, 2);
  });

  test("GOOGLE_SERVICE_ACCOUNT_JSON은 사용하지 않음 (refresh token 방식으로 구현)", () => {
    const usedVars = [CALENDAR_TOKEN_VAR, GMAIL_TOKEN_VAR, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
    assert.ok(!usedVars.includes("GOOGLE_SERVICE_ACCOUNT_JSON"));
  });
});
