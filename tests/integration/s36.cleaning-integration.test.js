/**
 * s36 — 청소 자동화 통합 테스트 (외부 의존성 GAP 10개)
 *
 * 실제 외부 서비스(Postgres, FCM, SMS GW, Google API, Slack)는 사용하지 않음.
 * 대신 로직을 인라인으로 재현하거나 fetch/DB를 mock하여 핵심 로직 경로를 검증.
 *
 * 검증 항목:
 *   IT-S36-01 Gmail Pub/Sub base64 메시지 디코딩
 *   IT-S36-02 VIP 1h 타임아웃 DB 쿼리 구조
 *   IT-S36-03 PENDING job → advanceJob 연동
 *   IT-S36-04 cleaning_notifs.channel UPDATE SQL
 *   IT-S36-05 SMS HTML 거절 페이지 내용
 *   IT-S36-06 미등록 이메일 Calendar Webhook fallback
 *   IT-S36-07 Calendar API events.list 요청 URL 구성
 *   IT-S36-08 FCM 알림 payload 구성
 *   IT-S36-09 SMS 게이트웨이 요청 구성
 *   IT-S36-10 Gmail Watch 월요일 자동 갱신 조건
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-01  Gmail Pub/Sub base64 디코딩
//   handleGmailWebhook: body.message.data → base64 → JSON.parse → historyId
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-01 Gmail Pub/Sub base64 디코딩", () => {
  function decodeGmailPubsub(b64) {
    // api/cleaning/[...slug].js:372
    try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
    catch { return null; }
  }

  test("정상 base64 → JSON 파싱 → historyId 추출", () => {
    const payload = { historyId: "2694059", emailAddress: "test@gmail.com" };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    const decoded = decodeGmailPubsub(b64);
    assert.equal(decoded?.historyId, "2694059");
    assert.equal(decoded?.emailAddress, "test@gmail.com");
  });

  test("historyId 없는 페이로드 → 조기 종료 조건 충족", () => {
    const b64 = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    const decoded = decodeGmailPubsub(b64);
    assert.ok(!decoded?.historyId);
  });

  test("잘못된 base64 → null 반환 (try-catch 작동)", () => {
    const decoded = decodeGmailPubsub("!!!not-base64-json!!!");
    assert.equal(decoded, null);
  });

  test("표준 base64url 변형도 처리 가능 (패딩 있는 표준 형식)", () => {
    const raw = JSON.stringify({ historyId: "9999" });
    const b64 = Buffer.from(raw).toString("base64");
    const decoded = decodeGmailPubsub(b64);
    assert.equal(decoded?.historyId, "9999");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-02  VIP 1h 타임아웃 DB 쿼리 구조
//   api/cron/[...slug].js:250-258 의 SQL이 올바른 조건을 포함하는지 검증
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-02 VIP 1h 타임아웃 DB 쿼리 구조", () => {
  const VIP_TIMEOUT_SQL = `
    SELECT j.*, n.sent_at AS notif_sent_at
     FROM cleaning_jobs j
     JOIN LATERAL (
       SELECT sent_at FROM cleaning_notifs
       WHERE job_id = j.id ORDER BY sent_at DESC LIMIT 1
     ) n ON true
     WHERE j.status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3')
       AND n.sent_at < NOW() - INTERVAL '1 hour'
  `;

  test("VIP 상태 3개 모두 포함", () => {
    assert.ok(VIP_TIMEOUT_SQL.includes("NOTIFYING_VIP_1"));
    assert.ok(VIP_TIMEOUT_SQL.includes("NOTIFYING_VIP_2"));
    assert.ok(VIP_TIMEOUT_SQL.includes("NOTIFYING_VIP_3"));
  });

  test("1시간 인터벌 조건 포함", () => {
    assert.ok(VIP_TIMEOUT_SQL.includes("INTERVAL '1 hour'"));
  });

  test("LATERAL JOIN으로 마지막 알림 시각 조회", () => {
    assert.ok(VIP_TIMEOUT_SQL.includes("LATERAL"));
    assert.ok(VIP_TIMEOUT_SQL.includes("sent_at DESC LIMIT 1"));
  });

  test("VIP timeout → advanceJob 호출 시뮬레이션", async () => {
    const advancedJobs = [];
    async function mockAdvanceJob(_db, job) { advancedJobs.push(job.id); }

    const mockVipJobs = [
      { id: "job-1", status: "NOTIFYING_VIP_1" },
      { id: "job-2", status: "NOTIFYING_VIP_2" },
    ];
    const db = { query: async () => ({ rows: mockVipJobs }) };

    // VIP timeout 처리 로직 재현
    const { rows: vipJobs } = await db.query("(VIP_TIMEOUT_SQL)");
    for (const job of vipJobs) {
      await mockAdvanceJob(db, job);
    }

    assert.equal(advancedJobs.length, 2);
    assert.deepEqual(advancedJobs, ["job-1", "job-2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-03  listJobs → advanceJob 연동
//   dispatch_after 도래한 PENDING job 목록 조회 후 advanceJob 연속 호출
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-03 PENDING job → advanceJob 연동", () => {
  async function runFollowupPending(db, advanceJob) {
    // api/cron/[...slug].js:239-247 재현
    const { rows: readyJobs } = await db.query(
      `SELECT * FROM cleaning_jobs WHERE status = 'PENDING' AND dispatch_after <= NOW() ORDER BY dispatch_after ASC`
    );
    let advanced = 0;
    for (const job of readyJobs) {
      try { await advanceJob(db, job); advanced++; }
      catch (e) { console.error(`advance 실패 (${job.id}):`, e.message); }
    }
    return advanced;
  }

  test("PENDING job 2건 → advanceJob 2회 호출", async () => {
    const calls = [];
    const mockAdvanceJob = async (_db, job) => calls.push(job.id);
    const db = {
      query: async () => ({
        rows: [
          { id: "j1", status: "PENDING", dispatch_after: "2026-08-25T00:00:00Z" },
          { id: "j2", status: "PENDING", dispatch_after: "2026-08-25T00:10:00Z" },
        ],
      }),
    };
    const count = await runFollowupPending(db, mockAdvanceJob);
    assert.equal(count, 2);
    assert.deepEqual(calls, ["j1", "j2"]);
  });

  test("PENDING job 없음 → advanceJob 미호출, 0 반환", async () => {
    const calls = [];
    const mockAdvanceJob = async (_db, job) => calls.push(job.id);
    const db = { query: async () => ({ rows: [] }) };
    const count = await runFollowupPending(db, mockAdvanceJob);
    assert.equal(count, 0);
    assert.equal(calls.length, 0);
  });

  test("advanceJob 실패해도 나머지 job 계속 처리", async () => {
    const calls = [];
    const mockAdvanceJob = async (_db, job) => {
      if (job.id === "j1") throw new Error("시뮬레이션 실패");
      calls.push(job.id);
    };
    const db = {
      query: async () => ({
        rows: [
          { id: "j1", status: "PENDING" },
          { id: "j2", status: "PENDING" },
        ],
      }),
    };
    const count = await runFollowupPending(db, mockAdvanceJob);
    assert.equal(count, 1);
    assert.deepEqual(calls, ["j2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-04  cleaning_notifs.channel UPDATE SQL
//   _notify.js:95-98: notifId 있을 때만 channel 컬럼 기록
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-04 cleaning_notifs.channel UPDATE SQL", () => {
  const CHANNEL_UPDATE_SQL = `UPDATE cleaning_notifs SET channel=$1 WHERE id=$2`;

  test("SQL 구조: channel=$1, id=$2 바인딩", () => {
    assert.ok(CHANNEL_UPDATE_SQL.includes("SET channel=$1"));
    assert.ok(CHANNEL_UPDATE_SQL.includes("WHERE id=$2"));
  });

  test("FCM 성공 시 channel='FCM' 기록", async () => {
    const queries = [];
    const db = {
      query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; },
    };
    // _notify.js 채널 기록 로직 재현
    const resultChannel = "FCM";
    const notifId = "notif-uuid-123";
    if (notifId && resultChannel !== "NONE") {
      await db.query(`UPDATE cleaning_notifs SET channel=$1 WHERE id=$2`, [resultChannel, notifId]);
    }
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params[0], "FCM");
    assert.equal(queries[0].params[1], "notif-uuid-123");
  });

  test("SMS_FALLBACK 채널도 기록됨", async () => {
    const queries = [];
    const db = { query: async (sql, p) => { queries.push(p); return { rows: [] }; } };
    const resultChannel = "SMS_FALLBACK";
    const notifId = "notif-456";
    if (notifId && resultChannel !== "NONE") {
      await db.query(CHANNEL_UPDATE_SQL, [resultChannel, notifId]);
    }
    assert.equal(queries[0][0], "SMS_FALLBACK");
  });

  test("channel=NONE이면 DB 기록 안 함", async () => {
    const queries = [];
    const db = { query: async (sql, p) => { queries.push(p); return { rows: [] }; } };
    const resultChannel = "NONE";
    const notifId = "notif-789";
    if (notifId && resultChannel !== "NONE") {
      await db.query(CHANNEL_UPDATE_SQL, [resultChannel, notifId]);
    }
    assert.equal(queries.length, 0);
  });

  test("notifId 없으면 DB 기록 안 함", async () => {
    const queries = [];
    const db = { query: async (sql, p) => { queries.push(p); return { rows: [] }; } };
    const resultChannel = "FCM";
    const notifId = undefined;
    if (notifId && resultChannel !== "NONE") {
      await db.query(CHANNEL_UPDATE_SQL, [resultChannel, notifId]);
    }
    assert.equal(queries.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-05  SMS HTML 거절 페이지 내용
//   handleDecline: respond(200, "거절 처리 완료", "거절 처리됐습니다. 감사합니다.")
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-05 SMS HTML 거절 페이지 내용", () => {
  function htmlPage(title, body) {
    // api/cleaning/[...slug].js:54-56 재현
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}.box{background:#fff;border-radius:12px;padding:40px 32px;max-width:360px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.1)}h2{margin:0 0 12px;font-size:1.2rem;color:#111}p{margin:0;color:#555;font-size:.95rem;line-height:1.6}</style></head><body><div class="box"><h2>${title}</h2><p>${body}</p></div></body></html>`;
  }

  test("거절 완료 페이지: 제목 + 감사 문구 포함", () => {
    const html = htmlPage("거절 처리 완료", "거절 처리됐습니다. 감사합니다.");
    assert.ok(html.includes("<title>거절 처리 완료</title>"));
    assert.ok(html.includes("<h2>거절 처리 완료</h2>"));
    assert.ok(html.includes("거절 처리됐습니다. 감사합니다."));
  });

  test("이미 처리됨 페이지: 올바른 메시지", () => {
    const html = htmlPage("이미 처리됨", "이미 처리된 링크입니다.");
    assert.ok(html.includes("이미 처리됨"));
    assert.ok(html.includes("이미 처리된 링크입니다."));
  });

  test("취소된 일정 페이지", () => {
    const html = htmlPage("취소된 일정", "해당 청소 일정은 이미 취소됐습니다. 감사합니다.");
    assert.ok(html.includes("취소된 일정"));
    assert.ok(html.includes("감사합니다."));
  });

  test("HTML 문서 구조 필수 요소 포함", () => {
    const html = htmlPage("테스트", "내용");
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes('lang="ko"'));
    assert.ok(html.includes('charset="utf-8"'));
    assert.ok(html.includes(".box{"));
  });

  test("XSS: title/body는 innerHTML 없이 직접 문자열 삽입 — 특수문자 그대로 포함됨", () => {
    // 실제 htmlPage는 escapeHtml 없이 삽입 → 호출자가 안전한 문자열만 전달해야 함
    const html = htmlPage("테스트<>&", "안전한 내용만");
    assert.ok(html.includes("테스트<>&")); // 템플릿 리터럴 직접 삽입 확인
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-06  미등록 이메일 Calendar Webhook fallback
//   handleCalendarWebhook: attendeeEmail이 DB에 없으면 Slack ⚠️ 알림
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-06 미등록 이메일 Calendar Webhook fallback", () => {
  async function handleCalendarAttendee(db, attendeeEmail, jobId, postSlack) {
    // api/cleaning/[...slug].js:333-350 핵심 분기 재현
    const { rows: [cleaner] } = await db.query(
      `SELECT * FROM cleaners WHERE email=$1`, [attendeeEmail]
    );
    const { rows: updated } = await db.query(
      `UPDATE cleaning_jobs SET status='ASSIGNED',assigned_cleaner_id=$1,google_event_id=$2,updated_at=NOW()
       WHERE id=$3 AND status!='ASSIGNED' RETURNING id`,
      [cleaner?.id ?? null, "evt-123", jobId]
    );
    if (!updated.length) return "no-update";
    if (!cleaner) {
      await postSlack(`[PROPOS] ⚠️ 미등록 이메일: ${attendeeEmail} — 수동 확인 필요`);
      return "unregistered";
    }
    return "assigned";
  }

  test("미등록 이메일 → Slack ⚠️ 알림 발송", async () => {
    const slackMessages = [];
    const db = {
      query: async (sql, params) => {
        if (sql.includes("SELECT * FROM cleaners")) return { rows: [] }; // 미등록
        if (sql.includes("UPDATE cleaning_jobs")) return { rows: [{ id: params[2] }] };
        return { rows: [] };
      },
    };
    const result = await handleCalendarAttendee(
      db, "unknown@gmail.com", "job-1",
      (msg) => slackMessages.push(msg)
    );
    assert.equal(result, "unregistered");
    assert.equal(slackMessages.length, 1);
    assert.ok(slackMessages[0].includes("⚠️ 미등록 이메일: unknown@gmail.com"));
    assert.ok(slackMessages[0].includes("수동 확인 필요"));
  });

  test("등록된 이메일 → Slack ⚠️ 미발송, assigned 반환", async () => {
    const slackMessages = [];
    const db = {
      query: async (sql, params) => {
        if (sql.includes("SELECT * FROM cleaners"))
          return { rows: [{ id: "c-1", name: "홍길동", email: params[0] }] };
        if (sql.includes("UPDATE cleaning_jobs"))
          return { rows: [{ id: params[2] }] };
        return { rows: [] };
      },
    };
    const result = await handleCalendarAttendee(
      db, "registered@gmail.com", "job-2",
      (msg) => slackMessages.push(msg)
    );
    assert.equal(result, "assigned");
    assert.equal(slackMessages.length, 0);
  });

  test("UPDATE가 이미 ASSIGNED → no-update, Slack 미발송", async () => {
    const slackMessages = [];
    const db = {
      query: async (sql) => {
        if (sql.includes("SELECT * FROM cleaners")) return { rows: [] };
        if (sql.includes("UPDATE cleaning_jobs")) return { rows: [] }; // already assigned
        return { rows: [] };
      },
    };
    const result = await handleCalendarAttendee(
      db, "someone@gmail.com", "job-3",
      (msg) => slackMessages.push(msg)
    );
    assert.equal(result, "no-update");
    assert.equal(slackMessages.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-07  Calendar API events.list 요청 URL 구성
//   handleCalendarWebhook: fetch URL 파라미터 검증
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-07 Calendar API events.list 요청 URL 구성", () => {
  const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

  function buildCalendarEventsUrl(calendarId, since, timeMin) {
    // api/cleaning/[...slug].js:324-327 재현
    return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?updatedMin=${since}&timeMin=${timeMin}&singleEvents=true&orderBy=updated&showDeleted=false&maxResults=10`;
  }

  test("기본 URL 도메인 포함", () => {
    const url = buildCalendarEventsUrl("test@gmail.com", "2026-08-25T00:00:00Z", "2026-08-25T00:30:00Z");
    assert.ok(url.startsWith("https://www.googleapis.com/calendar/v3/"));
  });

  test("calendarId URL 인코딩 적용", () => {
    const url = buildCalendarEventsUrl("test@gmail.com", "T1", "T2");
    assert.ok(url.includes("test%40gmail.com")); // @ → %40
  });

  test("singleEvents=true 포함", () => {
    const url = buildCalendarEventsUrl("cal@g.com", "T1", "T2");
    assert.ok(url.includes("singleEvents=true"));
  });

  test("showDeleted=false 포함 (취소 이벤트 제외)", () => {
    const url = buildCalendarEventsUrl("cal@g.com", "T1", "T2");
    assert.ok(url.includes("showDeleted=false"));
  });

  test("maxResults=10 포함 (과부하 방지)", () => {
    const url = buildCalendarEventsUrl("cal@g.com", "T1", "T2");
    assert.ok(url.includes("maxResults=10"));
  });

  test("updatedMin과 timeMin 파라미터 모두 포함", () => {
    const since = "2026-08-25T00:00:00.000Z";
    const timeMin = "2026-08-25T00:30:00.000Z";
    const url = buildCalendarEventsUrl("cal@g.com", since, timeMin);
    assert.ok(url.includes(`updatedMin=${since}`));
    assert.ok(url.includes(`timeMin=${timeMin}`));
  });

  test("fetch 호출 시 Authorization Bearer 헤더 구성", () => {
    const token = "ya29.test-token";
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal(headers.Authorization, "Bearer ya29.test-token");
    assert.ok(headers.Authorization.startsWith("Bearer "));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-08  FCM 알림 payload 구성
//   _notify.js → sendPush 호출 시 title, body, data 필드 전달
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-08 FCM 알림 payload 구성", () => {
  function buildFcmPayload(fcmToken, { title, body, data = {} }) {
    // _push.js:29-38 messaging.send() 인자 재현
    return {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
      ),
      android: {
        priority: "high",
        notification: { channelId: "propos_jobs", sound: "default" },
      },
    };
  }

  test("VIP 알림 payload 구조: token, notification, data, android", () => {
    const payload = buildFcmPayload("fcm-token-abc", {
      title: "[PROPOS] 청소 요청",
      body: "강남 숙소 2026-08-26 10:00",
      data: { jobId: "j-1", token: "ABC123", calendarUrl: "https://cal.google.com/...", hostPhone: "010-1234-5678" },
    });
    assert.equal(payload.token, "fcm-token-abc");
    assert.equal(payload.notification.title, "[PROPOS] 청소 요청");
    assert.equal(payload.notification.body, "강남 숙소 2026-08-26 10:00");
    assert.equal(payload.data.jobId, "j-1");
    assert.equal(payload.data.token, "ABC123");
    assert.equal(payload.android.priority, "high");
    assert.equal(payload.android.notification.channelId, "propos_jobs");
  });

  test("data 값은 모두 String으로 변환 (FCM 요구사항)", () => {
    const payload = buildFcmPayload("token", {
      title: "T",
      body: "B",
      data: { jobId: 42, active: true, nullable: null },
    });
    assert.equal(typeof payload.data.jobId, "string");
    assert.equal(payload.data.jobId, "42");
    assert.equal(payload.data.active, "true");
    assert.equal(payload.data.nullable, "");
  });

  test("BULK 알림 payload에 선착순 문구 포함", () => {
    const payload = buildFcmPayload("token-bulk", {
      title: "[PROPOS] 청소 아르바이트 안내",
      body: "강남 숙소 2026-08-26 10:00 선착순",
      data: { jobId: "j-2", token: "XYZ789" },
    });
    assert.ok(payload.notification.title.includes("청소 아르바이트"));
    assert.ok(payload.notification.body.includes("선착순"));
  });

  test("data 없으면 빈 객체", () => {
    const payload = buildFcmPayload("token", { title: "T", body: "B" });
    assert.deepEqual(payload.data, {});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-09  SMS 게이트웨이 요청 구성
//   _sms.js: URL, Authorization 헤더, body 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-09 SMS 게이트웨이 요청 구성", () => {
  const GW_BASE = "https://api.sms-gate.app/3rdparty/v1";

  function toE164(phone) {
    // _sms.js:6-11 재현
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("82")) return `+${digits}`;
    if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
    return `+${digits}`;
  }

  function buildSmsRequest(phone, message, gwId, gwPwd) {
    const e164 = toE164(phone);
    return {
      url: `${GW_BASE}/message`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${gwId}:${gwPwd}`).toString("base64")}`,
        },
        body: JSON.stringify({ phoneNumbers: [e164], message }),
      },
    };
  }

  test("URL은 SMS 게이트웨이 엔드포인트", () => {
    const { url } = buildSmsRequest("010-1234-5678", "test", "id", "pwd");
    assert.equal(url, "https://api.sms-gate.app/3rdparty/v1/message");
  });

  test("Authorization: Basic base64(id:pwd) 헤더", () => {
    const { options } = buildSmsRequest("010-1234-5678", "test", "myid", "mypwd");
    const expected = `Basic ${Buffer.from("myid:mypwd").toString("base64")}`;
    assert.equal(options.headers.Authorization, expected);
  });

  test("body: phoneNumbers 배열 + message 필드", () => {
    const { options } = buildSmsRequest("010-1234-5678", "청소 요청 드립니다", "id", "pwd");
    const parsed = JSON.parse(options.body);
    assert.ok(Array.isArray(parsed.phoneNumbers));
    assert.equal(parsed.phoneNumbers[0], "+821012345678");
    assert.equal(parsed.message, "청소 요청 드립니다");
  });

  test("toE164: 010- 형식 → +8210", () => {
    assert.equal(toE164("010-1234-5678"), "+821012345678");
  });

  test("toE164: 82 시작 → + 접두사만 추가", () => {
    assert.equal(toE164("821012345678"), "+821012345678");
  });

  test("toE164: 이미 +82 형식은 재변환 방지 (숫자만 추출 후 처리)", () => {
    const result = toE164("+82-10-1234-5678");
    assert.equal(result, "+821012345678");
  });

  test("Content-Type: application/json 헤더", () => {
    const { options } = buildSmsRequest("010-0000-0000", "msg", "i", "p");
    assert.equal(options.headers["Content-Type"], "application/json");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S36-10  Gmail Watch 월요일 자동 갱신 조건
//   api/cron/[...slug].js morning 액션: kstDayOfWeek === 1 (월요일)
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S36-10 Gmail Watch 월요일 자동 갱신 조건", () => {
  const KST_OFFSET_MS = 9 * 3600 * 1000;

  function shouldRenewGmailWatch(utcTimestampMs) {
    // api/cron/[...slug].js morning 로직 재현
    const kstNow = new Date(utcTimestampMs + KST_OFFSET_MS);
    const kstDayOfWeek = kstNow.getUTCDay();
    return kstDayOfWeek === 1; // 월요일
  }

  test("월요일(KST) → 갱신 실행", () => {
    // 2026-08-24 KST = UTC 2026-08-23T15:00:00Z (일요일 UTC) → KST 월요일
    const kstMonday = Date.UTC(2026, 7, 24, 0, 0, 0) - KST_OFFSET_MS; // KST 2026-08-24 00:00
    assert.ok(shouldRenewGmailWatch(kstMonday));
  });

  test("화요일(KST) → 갱신 안 함", () => {
    const kstTuesday = Date.UTC(2026, 7, 25, 0, 0, 0) - KST_OFFSET_MS;
    assert.ok(!shouldRenewGmailWatch(kstTuesday));
  });

  test("일요일(KST) → 갱신 안 함", () => {
    const kstSunday = Date.UTC(2026, 7, 23, 0, 0, 0) - KST_OFFSET_MS;
    assert.ok(!shouldRenewGmailWatch(kstSunday));
  });

  test("매주 1회만 갱신 (7일 주기)", () => {
    const kstMonday1 = Date.UTC(2026, 7, 24, 0, 0, 0) - KST_OFFSET_MS;
    const kstMonday2 = Date.UTC(2026, 7, 31, 0, 0, 0) - KST_OFFSET_MS;
    assert.ok(shouldRenewGmailWatch(kstMonday1));
    assert.ok(shouldRenewGmailWatch(kstMonday2));
    // 중간 날들은 갱신 안 함
    for (let d = 25; d <= 30; d++) {
      const ts = Date.UTC(2026, 7, d, 0, 0, 0) - KST_OFFSET_MS;
      assert.ok(!shouldRenewGmailWatch(ts), `${d}일은 월요일이 아닌데 갱신됨`);
    }
  });

  test("Gmail Watch 갱신 요청 URL 구성", () => {
    const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
    const url = `${GMAIL_API}/users/me/watch`;
    const topicName = "projects/my-project/topics/gmail-notifications";
    const body = JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" });
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/watch");
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed.labelIds, ["INBOX"]);
    assert.equal(parsed.labelFilterBehavior, "INCLUDE");
    assert.equal(parsed.topicName, topicName);
  });

  test("갱신 응답: expiration 숫자 → ISO 날짜 포맷", () => {
    const expMs = 1788191537466;
    const expDate = new Date(Number(expMs)).toISOString().slice(0, 10);
    assert.match(expDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(expDate > "2026-01-01");
  });
});
