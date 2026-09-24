/**
 * s37 — 외부 서비스 실제 연결 스모크 테스트
 *
 * 환경변수가 설정된 환경에서만 실행됨. 미설정 시 해당 suite는 skip.
 * 모두 읽기 전용 / 비파괴 작업 (실제 SMS 발송, FCM 전송, 캘린더 수정 없음).
 *
 * 실행 방법:
 *   로컬:   node --test --env-file .env.local tests/e2e/s37.live-connectivity.test.js
 *   Vercel: vercel env pull .env.local && 위와 동일
 *
 * 검증 항목:
 *   IT-S37-01 Postgres 연결 + 스키마 검증
 *   IT-S37-02 Google OAuth 토큰 발급 (Gmail용 refresh token)
 *   IT-S37-03 Google OAuth 토큰 발급 (Calendar용 refresh token)
 *   IT-S37-04 Gmail 사용자 프로필 조회 (읽기 전용)
 *   IT-S37-05 Gmail Watch 현황 조회 (읽기 전용)
 *   IT-S37-06 Upstash KV 읽기/쓰기 연결
 *   IT-S37-07 SMS 게이트웨이 인증 확인 (발송 없음)
 *   IT-S37-08 FCM 초기화 확인 (발송 없음)
 *   IT-S37-09 Slack Webhook 연결 확인
 *   IT-S37-10 Vercel 프로덕션 API 엔드포인트 응답 확인
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function skipUnless(envVar) {
  if (!process.env[envVar]) {
    console.log(`[skip] ${envVar} 미설정 — 이 suite 건너뜀`);
    return true;
  }
  return false;
}

function skipUnlessAll(...envVars) {
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
  const BASE = "https://www.proposonline.com";

  test("GET /api/cleaning/cleaners — 200 + JSON 배열", async () => {
    const r = await fetch(`${BASE}/api/cleaning/cleaners`);
    assert.ok(r.ok, `HTTP ${r.status}`);
    const data = await r.json();
    assert.ok(Array.isArray(data), `배열 아님: ${JSON.stringify(data).slice(0, 100)}`);
    console.log(`[IT-S37-09] cleaners ${data.length}명 조회됨`);
  });

  test("GET /api/cleaning/jobs — 200 + JSON 배열", async () => {
    const r = await fetch(`${BASE}/api/cleaning/jobs`);
    assert.ok(r.ok, `HTTP ${r.status}`);
    const data = await r.json();
    assert.ok(Array.isArray(data));
    console.log(`[IT-S37-09] jobs ${data.length}건 조회됨`);
  });

  test("POST /api/calendar/webhook — sync 이벤트 처리 (200 반환)", async () => {
    // x-goog-resource-state: sync → 즉시 200 종료 (실제 처리 없음)
    const r = await fetch(`${BASE}/api/calendar/webhook`, {
      method: "POST",
      headers: {
        "x-goog-resource-state": "sync",
        "x-goog-channel-id": "smoke-test",
        "x-goog-resource-id": "smoke",
      },
    });
    assert.equal(r.status, 200, `예상 200 아님: HTTP ${r.status}`);
  });

  test("POST /api/gmail/webhook — data 없는 페이로드 → 200 반환", async () => {
    // message.data 없으면 조기 200 종료 (실제 Gmail 처리 없음)
    const r = await fetch(`${BASE}/api/gmail/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: {} }), // data 없음 → early return 200
    });
    assert.equal(r.status, 200, `예상 200 아님: HTTP ${r.status}`);
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
