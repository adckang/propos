/**
 * Google Calendar Webhook + Gmail Watch 일괄 등록.
 * 실행: node scripts/setup-google-apis.mjs
 * 전제: .env.local에 POSTGRES_URL + GOOGLE_* + GOOGLE_WEBHOOK_SECRET
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
const { Pool } = pg;

// ── .env.local 로드 ──────────────────────────────────────────
try {
  const lines = readFileSync(".env.local", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch { /* 기존 환경변수 사용 */ }

const required = [
  "POSTGRES_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("❌ 환경변수 없음:", missing.join(", "));
  console.error("   npx vercel env pull .env.local 후 재실행");
  process.exit(1);
}

const BASE_URL =
  process.env.PROPOS_BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  "https://www.proposonline.com";

const WEBHOOK_SECRET = process.env.GOOGLE_WEBHOOK_SECRET ?? "";

// ── Google OAuth access token ─────────────────────────────────
async function getAccessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });
  const data = await r.json();
  if (!data.access_token) {
    throw new Error(`Google OAuth 실패: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ── Calendar Webhook 등록 ─────────────────────────────────────
// Google Calendar push notification watch.
// token 필드에 GOOGLE_WEBHOOK_SECRET을 넣으면
// 이후 모든 알림에 X-Goog-Channel-Token 헤더로 echo됨.
async function watchCalendar(calendarId, accessToken) {
  const channelId = randomUUID();
  const expiration = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30일

  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id:         channelId,
        type:       "web_hook",
        address:    `${BASE_URL}/api/calendar/webhook`,
        token:      WEBHOOK_SECRET,
        expiration: String(expiration),
      }),
    }
  );
  const data = await r.json();
  if (data.error) throw new Error(`watch 등록 실패: ${JSON.stringify(data.error)}`);
  return { channelId, resourceId: data.resourceId, expiration: new Date(expiration) };
}

// ── Gmail Watch 등록 ──────────────────────────────────────────
// Pub/Sub 구독 URL에 ?secret= 포함 → 핸들러에서 검증.
// 전제: Google Cloud Console에서 Pub/Sub API 활성화 + 토픽 생성 완료.
async function watchGmail(topicName, accessToken) {
  const r = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName,
        labelIds:  ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      }),
    }
  );
  const data = await r.json();
  if (data.error) throw new Error(`Gmail watch 실패: ${JSON.stringify(data.error)}`);
  return { historyId: data.historyId, expiration: new Date(Number(data.expiration)) };
}

// ── Pub/Sub push 구독 생성/업데이트 ──────────────────────────
async function ensurePubSubSubscription(topicName, accessToken) {
  const projectId = topicName.split("/")[1];
  const subName = `projects/${projectId}/subscriptions/propos-gmail-push`;
  const pushEndpoint = WEBHOOK_SECRET
    ? `${BASE_URL}/api/gmail/webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`
    : `${BASE_URL}/api/gmail/webhook`;

  // 구독 생성 시도 (이미 있으면 409 → 업데이트)
  const createRes = await fetch(
    `https://pubsub.googleapis.com/v1/${subName}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: topicName,
        pushConfig: { pushEndpoint },
        ackDeadlineSeconds: 60,
      }),
    }
  );
  const data = await createRes.json();
  if (data.error && data.error.code !== 409) {
    throw new Error(`Pub/Sub 구독 생성 실패: ${JSON.stringify(data.error)}`);
  }
  console.log("  📡 Pub/Sub 구독:", subName);
  console.log("  🔗 Push 엔드포인트:", pushEndpoint);
}

// ── 메인 ─────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

try {
  const accessToken = await getAccessToken();
  console.log("✅ Google OAuth 토큰 발급 완료\n");

  // ─ Calendar Webhook ─
  const { rows: properties } = await pool.query(
    `SELECT property_id, name, google_calendar_id
     FROM property_cleaning_config
     WHERE google_calendar_id IS NOT NULL`
  );

  if (!properties.length) {
    console.warn("⚠️  google_calendar_id가 설정된 숙소 없음");
    console.warn("   PROPOS UI → 청소 관리 → 숙소 설정 탭에서 먼저 Calendar ID를 등록하세요.\n");
  } else {
    console.log(`📅 Calendar Webhook 등록 (숙소 ${properties.length}개):`);
    for (const prop of properties) {
      try {
        const result = await watchCalendar(prop.google_calendar_id, accessToken);
        console.log(`  ✅ ${prop.name} (${prop.property_id})`);
        console.log(`     Channel: ${result.channelId}`);
        console.log(`     만료: ${result.expiration.toLocaleDateString("ko-KR")}`);
      } catch (e) {
        console.error(`  ❌ ${prop.name}: ${e.message}`);
      }
    }
    console.log();
  }

  // ─ Gmail Watch ─
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) {
    console.warn("⚠️  GOOGLE_PUBSUB_TOPIC 환경변수 없음");
    console.warn("   형식: projects/{PROJECT_ID}/topics/{TOPIC_NAME}");
    console.warn("   Google Cloud Console → Pub/Sub → 토픽 생성 후 환경변수에 추가하세요.");
    console.warn("   ※ Gmail Watch는 건너뜁니다.\n");
  } else {
    console.log("📬 Gmail Watch 등록:");
    try {
      await ensurePubSubSubscription(topicName, accessToken);
      const result = await watchGmail(topicName, accessToken);
      console.log(`  ✅ Gmail Watch 등록 완료`);
      console.log(`     historyId: ${result.historyId}`);
      console.log(`     만료: ${result.expiration.toLocaleDateString("ko-KR")}\n`);
    } catch (e) {
      console.error(`  ❌ Gmail Watch 실패: ${e.message}`);
      console.error("     Pub/Sub API 활성화 여부와 토픽 이름을 확인하세요.\n");
    }
  }

  console.log("🎉 완료!");
  console.log("   ⚠️  Calendar Webhook은 30일 후 만료됩니다. 매달 이 스크립트를 재실행하세요.");
} catch (e) {
  console.error("❌ 오류:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
