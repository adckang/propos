/**
 * s37 — 외부 서비스 실제 연결 스모크 테스트
 *
 * RUN_LIVE_CONNECTIVITY=1을 명시하고 필요한 환경변수가 설정된 항목만 실행한다.
 * DB·Google·SMS·FCM 조회 외에 KV 테스트 키 SET/DEL, Slack 테스트 메시지 전송,
 * 프로덕션 웹훅 요청도 포함하므로 일반 E2E/전체 검증에는 넣지 않는다.
 *
 * 실행 방법:
 *   로컬:   RUN_LIVE_CONNECTIVITY=1 node --test --env-file .env.local tests/e2e/s37.live-connectivity.test.js
 *   Vercel: vercel env pull .env.local && 위와 동일
 *
 * 검증 항목:
 *   IT-S37-01 Postgres 연결 + 스키마 검증
 *   IT-S37-02 Google OAuth 토큰 발급 (Gmail용 refresh token) + Gmail 프로필 조회
 *   IT-S37-03 Google OAuth 토큰 발급 (Calendar용 refresh token) + 캘린더 목록 조회
 *   IT-S37-04 Gmail history API 조회 (읽기 전용)
 *   IT-S37-05 Upstash KV 테스트 키 SET/GET/DEL
 *   IT-S37-06 SMS 게이트웨이 인증 확인 (발송 없음)
 *   IT-S37-07 FCM 초기화 확인 (발송 없음)
 *   IT-S37-08 Slack Webhook 테스트 메시지 전송
 *   IT-S37-09 운영 API 응답 — 청소 API 로그인 단계, 웹훅 비밀값 검사, 잘못된 거절 링크
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const RUN_LIVE_CONNECTIVITY = process.env.RUN_LIVE_CONNECTIVITY === "1";
if (!RUN_LIVE_CONNECTIVITY) {
  console.log("[skip] RUN_LIVE_CONNECTIVITY=1 미설정 — 외부 연결 시험 전체를 건너뜀");
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function skipUnless(envVar) {
  if (!RUN_LIVE_CONNECTIVITY) return true;
  if (!process.env[envVar]) {
    console.log(`[skip] ${envVar} 미설정 — 이 suite 건너뜀`);
    return true;
  }
  return false;
}

function skipUnlessAll(...envVars) {
  if (!RUN_LIVE_CONNECTIVITY) return true;
  const missing = envVars.filter((v) => !process.env[v]);
  if (missing.length) {
    console.log(`[skip] 환경변수 미설정 (${missing.join(", ")}) — 이 suite 건너뜀`);
    return true;
  }
  return false;
}

async function fetchGoogleToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-01  Postgres 연결 + 스키마 검증
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-01 Postgres 연결 + 스키마", async () => {
  if (skipUnless("POSTGRES_URL")) return;

  let db;
  before(async () => {
    const { Pool } = await import("pg");
    db = new Pool({ connectionString: process.env.POSTGRES_URL });
  });
  after(async () => { if (db) await db.end(); });

  test("SELECT 1 — 연결 정상", async () => {
    const { rows } = await db.query("SELECT 1 AS ping");
    assert.equal(rows[0].ping, 1);
  });

  test("cleaners 테이블 존재 + 필수 컬럼 확인", async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cleaners'
      ORDER BY column_name
    `);
    const cols = rows.map((r) => r.column_name);
    for (const col of ["id", "name", "phone", "email", "tier", "active", "fcm_token", "fcm_status"]) {
      assert.ok(cols.includes(col), `cleaners.${col} 컬럼 없음`);
    }
  });

  test("cleaning_jobs 테이블 존재 + 필수 컬럼 확인", async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cleaning_jobs'
      ORDER BY column_name
    `);
    const cols = rows.map((r) => r.column_name);
    for (const col of ["id", "property_id", "status", "cleaning_start_at", "checkout_at", "source"]) {
      assert.ok(cols.includes(col), `cleaning_jobs.${col} 컬럼 없음`);
    }
  });

  test("cleaning_notifs 테이블 존재 + channel 컬럼 확인", async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cleaning_notifs'
      ORDER BY column_name
    `);
    const cols = rows.map((r) => r.column_name);
    for (const col of ["id", "job_id", "cleaner_id", "token", "tier", "channel", "sent_at"]) {
      assert.ok(cols.includes(col), `cleaning_notifs.${col} 컬럼 없음`);
    }
  });

  test("property_cleaning_config 테이블 존재", async () => {
    const { rows } = await db.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'property_cleaning_config'
    `);
    assert.ok(Number(rows[0].cnt) >= 1);
  });

  test("property_calendar_blockers 테이블 존재", async () => {
    const { rows } = await db.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'property_calendar_blockers'
    `);
    assert.ok(Number(rows[0].cnt) >= 1);
  });

  test("active 청소자 쿼리 응답 형식 확인 (읽기 전용)", async () => {
    const { rows } = await db.query(
      `SELECT id, name, tier, active, fcm_status FROM cleaners WHERE active=true LIMIT 3`
    );
    for (const r of rows) {
      assert.ok("id" in r && "name" in r && "tier" in r, `응답 컬럼 누락: ${JSON.stringify(r)}`);
      assert.equal(r.active, true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-02  Google OAuth 토큰 발급 (Gmail용)
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-02 Google OAuth — Gmail 토큰", async () => {
  if (skipUnlessAll("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")) return;

  let accessToken;

  test("refresh_token → access_token 발급", async () => {
    const data = await fetchGoogleToken(process.env.GOOGLE_REFRESH_TOKEN);
    assert.ok(data.access_token, `access_token 없음: ${JSON.stringify(data)}`);
    assert.equal(data.token_type, "Bearer");
    assert.ok(data.expires_in > 0);
    accessToken = data.access_token;
  });

  test("발급된 토큰으로 Gmail 프로필 조회 (IT-S37-04 선행 가능)", async () => {
    if (!accessToken) return; // 이전 테스트 실패 시 skip
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.ok(r.ok, `Gmail 프로필 조회 실패: HTTP ${r.status}`);
    const data = await r.json();
    assert.ok(data.emailAddress, `emailAddress 없음: ${JSON.stringify(data)}`);
    assert.ok(data.emailAddress.includes("@"));
    console.log(`[IT-S37-02] Gmail 계정: ${data.emailAddress}, historyId: ${data.historyId}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-03  Google OAuth 토큰 발급 (Calendar용)
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-03 Google OAuth — Calendar 토큰", async () => {
  if (skipUnlessAll("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN")) return;

  let calToken;

  test("calendar refresh_token → access_token 발급", async () => {
    const data = await fetchGoogleToken(process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
    assert.ok(data.access_token, `Calendar access_token 없음: ${JSON.stringify(data)}`);
    calToken = data.access_token;
  });

  test("발급된 Calendar 토큰으로 캘린더 목록 조회 (읽기 전용)", async () => {
    if (!calToken) return;
    const r = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5", {
      headers: { Authorization: `Bearer ${calToken}` },
    });
    assert.ok(r.ok, `Calendar 목록 조회 실패: HTTP ${r.status}`);
    const data = await r.json();
    assert.ok(Array.isArray(data.items), `items 없음: ${JSON.stringify(data)}`);
    console.log(`[IT-S37-03] 캘린더 ${data.items.length}개 조회됨`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-04  Gmail Watch 현황 조회
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-04 Gmail Watch 현황", async () => {
  if (skipUnlessAll("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")) return;

  test("Gmail history API 연결 가능 여부 (읽기 전용, historyId 조회)", async () => {
    const tokenData = await fetchGoogleToken(process.env.GOOGLE_REFRESH_TOKEN);
    assert.ok(tokenData.access_token, "토큰 발급 실패");

    // 프로필에서 현재 historyId 확인 (watch 만료 여부 간접 파악)
    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.ok(profileRes.ok, `프로필 조회 실패: HTTP ${profileRes.status}`);
    const profile = await profileRes.json();
    assert.ok(profile.historyId, "historyId 없음");
    const historyId = profile.historyId;

    // history 1건 조회 (가장 가벼운 읽기 전용 호출)
    const histRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&maxResults=1`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    // 200(히스토리 있음) 또는 404(historyId 만료) 모두 API 연결은 성공
    assert.ok([200, 404].includes(histRes.status), `예상외 HTTP: ${histRes.status}`);
    console.log(`[IT-S37-04] Gmail history API: HTTP ${histRes.status}, historyId: ${historyId}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-05  Upstash KV 연결
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-05 Upstash KV 읽기/쓰기", async () => {
  if (skipUnlessAll("KV_REST_API_URL", "KV_REST_API_TOKEN")) return;

  const TEST_KEY = "propos:smoke-test";
  const TEST_VAL = `smoke-${Date.now()}`;

  test("KV SET 성공", async () => {
    const url = `${process.env.KV_REST_API_URL}/set/${TEST_KEY}/${encodeURIComponent(TEST_VAL)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    assert.ok(r.ok, `KV SET 실패: HTTP ${r.status}`);
    const data = await r.json();
    assert.equal(data.result, "OK");
  });

  test("KV GET — SET한 값 반환", async () => {
    const url = `${process.env.KV_REST_API_URL}/get/${TEST_KEY}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    assert.ok(r.ok, `KV GET 실패: HTTP ${r.status}`);
    const data = await r.json();
    assert.equal(data.result, TEST_VAL);
  });

  test("KV DEL — 테스트 키 정리", async () => {
    const url = `${process.env.KV_REST_API_URL}/del/${TEST_KEY}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    });
    assert.ok(r.ok, `KV DEL 실패: HTTP ${r.status}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-06  SMS 게이트웨이 인증 확인 (발송 없음)
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-06 SMS 게이트웨이 인증", async () => {
  if (skipUnlessAll("PROPOS_SMS_GW_ID", "PROPOS_SMS_GW_PWD")) return;

  test("인증 헤더로 GET /health 또는 GET / 호출 — 401이 아니면 인증 성공", async () => {
    const gwId  = process.env.PROPOS_SMS_GW_ID;
    const gwPwd = process.env.PROPOS_SMS_GW_PWD;
    const auth  = Buffer.from(`${gwId}:${gwPwd}`).toString("base64");
    // android-sms-gateway GET /health endpoint
    const r = await fetch("https://api.sms-gate.app/3rdparty/v1/health", {
      headers: { Authorization: `Basic ${auth}` },
    });
    // 200=정상, 404=경로 없음(그래도 인증 통과), 503=게이트웨이 오프라인 — 모두 401이 아니면 인증 성공
    assert.notEqual(r.status, 401, `SMS GW 인증 실패 (401 Unauthorized)`);
    console.log(`[IT-S37-06] SMS GW 응답: HTTP ${r.status}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-07  FCM 초기화 확인 (발송 없음)
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-07 FCM 초기화", async () => {
  if (skipUnless("FIREBASE_SERVICE_ACCOUNT_JSON")) return;

  test("서비스 계정 JSON 파싱 성공", () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); });
    assert.ok(parsed.project_id,   "project_id 없음");
    assert.ok(parsed.private_key,  "private_key 없음");
    assert.ok(parsed.client_email, "client_email 없음");
    assert.equal(parsed.type, "service_account");
    console.log(`[IT-S37-07] Firebase project: ${parsed.project_id}`);
  });

  test("firebase-admin 초기화 성공 (실제 앱 등록)", async () => {
    const { initializeApp, getApps, cert, deleteApp } = await import("firebase-admin/app");
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const sa  = JSON.parse(raw);

    let app;
    try {
      app = initializeApp({ credential: cert(sa) }, `smoke-test-${Date.now()}`);
      assert.ok(app, "앱 초기화 실패");
      console.log(`[IT-S37-07] Firebase Admin 초기화 성공: ${app.name}`);
    } finally {
      if (app) await deleteApp(app).catch(() => {});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-08  Slack Webhook 연결 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-08 Slack Webhook 연결", async () => {
  if (skipUnless("PROPOS_SLACK_WEBHOOK")) return;

  test("Slack webhook POST 성공 (스모크 메시지)", async () => {
    const r = await fetch(process.env.PROPOS_SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[PROPOS] 🔧 Connectivity smoke test — ${new Date().toISOString()}`,
      }),
    });
    assert.ok(r.ok, `Slack webhook 실패: HTTP ${r.status}`);
    const text = await r.text();
    assert.equal(text, "ok", `Slack 응답 예상값 불일치: ${text}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IT-S37-09  Vercel 프로덕션 API 엔드포인트 응답 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("IT-S37-09 Vercel 프로덕션 API 응답", async () => {
  // 환경변수 없이도 실행될 수 있는 묶음이라 skipUnless 를 거치지 않는다 — 공통 허락 검사를 직접 건다.
  if (!RUN_LIVE_CONNECTIVITY) return;
  const BASE = "https://www.proposonline.com";

  // D-033: 청소 API는 로그인 단계(PROPOS_AUTH_MODE)에 따라 답이 다르다. 운영 단계를 가정하지 않고
  // 서버가 알려주는 /api/auth/me 의 required 로 기대값을 고른다 — enforce 면 로그인 없는 조회는 401.
  let authRequired;
  before(async () => {
    const r = await fetch(`${BASE}/api/auth/me`);
    assert.equal(r.status, 200, `/api/auth/me 예상 200 아님: HTTP ${r.status}`);
    const me = await r.json();
    assert.equal(typeof me.required, "boolean", `required 없음: ${JSON.stringify(me)}`);
    authRequired = me.required;
    console.log(`[IT-S37-09] 로그인 단계: ${me.mode} (required=${me.required})`);
  });

  for (const resource of ["cleaners", "jobs"]) {
    test(`GET /api/cleaning/${resource} — 로그인 필수면 401, 아니면 200 + JSON 배열`, async () => {
      const r = await fetch(`${BASE}/api/cleaning/${resource}`);
      const data = await r.json();
      if (authRequired) {
        assert.equal(r.status, 401, `로그인 없이 열림: HTTP ${r.status}`);
        assert.equal(data.code, "AUTH_REQUIRED");
        return;
      }
      assert.ok(r.ok, `HTTP ${r.status}`);
      assert.ok(Array.isArray(data), `배열 아님: ${JSON.stringify(data).slice(0, 100)}`);
      console.log(`[IT-S37-09] ${resource} ${data.length}건 조회됨`);
    });
  }

  // RF-38: 운영 웹훅은 비밀값(GOOGLE_WEBHOOK_SECRET)이 맞지 않는 알림을 처리하지 않고 200으로 끝낸다.
  // 아래 두 요청은 비밀값 검사가 꺼져 있으면 본문 검사에서 400이 나는 모양이라, 200이면 검사가 켜져 있다는 뜻이다.
  // (어느 쪽이든 Google·DB를 읽거나 쓰지 않는다. 대신 운영 로그에 RF-38 확인용 경고
  //  "비밀값이 맞지 않는 알림 — 무시"가 웹훅마다 1줄 남는다 — 이 시험이 보낸 것이다.)
  test("POST /api/calendar/webhook — 비밀값 없는 알림은 처리하지 않고 200", async () => {
    const r = await fetch(`${BASE}/api/calendar/webhook`, {
      method: "POST",
      headers: {
        "x-goog-resource-state": "exists", // sync 가 아니라 처리 대상 — 비밀값 검사가 없으면 calendarId 없음 400
        "x-goog-channel-id": "smoke-test",
        "x-goog-resource-id": "smoke",
      },
    });
    assert.equal(r.status, 200, `비밀값 검사가 꺼져 있을 수 있음: HTTP ${r.status}`);
  });

  test("POST /api/gmail/webhook — 비밀값 없는 알림은 본문을 읽지 않고 200", async () => {
    const r = await fetch(`${BASE}/api/gmail/webhook`, {
      method: "POST",
      // JSON 으로 보내지 않는다 — 플랫폼이 본문을 먼저 해석해 400을 내는 경우와 섞이지 않게.
      headers: { "Content-Type": "text/plain" },
      body: "not-json", // 비밀값 검사가 없으면 핸들러의 JSON 해석 실패 400
    });
    assert.equal(r.status, 200, `비밀값 검사가 꺼져 있을 수 있음: HTTP ${r.status}`);
  });

  test("GET /api/d/XXXXXX — 잘못된 토큰 → 404 HTML 페이지", async () => {
    const r = await fetch(`${BASE}/api/d/XXXXXX`);
    assert.equal(r.status, 404);
    const ct = r.headers.get("content-type") ?? "";
    assert.ok(ct.includes("text/html"), `Content-Type HTML 아님: ${ct}`);
    const html = await r.text();
    assert.ok(html.includes("링크 오류") || html.includes("유효하지 않은"), `예상 문구 없음: ${html.slice(0, 200)}`);
  });
});
