/**
 * POST /api/calendar/webhook
 * Google Calendar Push Notification 수신 → 청소 배정 처리.
 *
 * Google이 보내는 헤더:
 *   X-Goog-Channel-Id, X-Goog-Resource-Id, X-Goog-Resource-State
 * Resource State: "sync" (초기 등록), "exists" (변경 발생)
 *
 * 변경 감지 후 Calendar Events API로 최신 이벤트 목록 조회 → attendee 이메일 추출.
 */

import { Pool } from "pg";
import { sendCompletionSmsToRest, postSlack } from "../cleaning/_dispatch.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// ── Google OAuth access token (refresh token 방식) ─────────

let _accessToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;

  const r = await fetch(GOOGLE_TOKEN_URL, {
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
  if (!data.access_token) throw new Error(`Google OAuth 실패: ${JSON.stringify(data)}`);
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _accessToken;
}

// ── 최신 예약 이벤트 조회 ─────────────────────────────────

async function fetchRecentBookings(calendarId, token) {
  const since = new Date(Date.now() - 30 * 60_000).toISOString(); // 최근 30분 (Webhook 재시도 여유분)
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
    + `?timeMin=${since}&singleEvents=true&orderBy=startTime&maxResults=10`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  return data.items ?? [];
}

// ── 메인 핸들러 ───────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // X-Goog-Channel-Token 검증 (watch 등록 시 설정한 secret과 대조)
  const webhookSecret = process.env.GOOGLE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const channelToken = req.headers["x-goog-channel-token"];
    if (channelToken !== webhookSecret) {
      console.warn("[calendar/webhook] token 불일치 — 무시");
      return res.status(200).end(); // Google은 non-2xx면 재시도하므로 200 반환
    }
  }

  const resourceState = req.headers["x-goog-resource-state"];
  if (resourceState === "sync") return res.status(200).end(); // 초기 등록 ping

  // x-goog-resource-uri: "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?..."
  const resourceUri = req.headers["x-goog-resource-uri"] ?? "";
  const uriMatch = resourceUri.match(/\/calendars\/([^/?]+)\//);
  const calendarId = uriMatch ? decodeURIComponent(uriMatch[1]) : "";

  if (!calendarId) return res.status(400).json({ error: "calendarId 없음" });

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    console.error("[calendar/webhook] OAuth 실패:", e.message);
    return res.status(500).json({ error: "OAuth 실패" });
  }

  // property 조회 (calendarId → property_id)
  const { rows: [propCfg] } = await db.query(
    `SELECT * FROM property_cleaning_config WHERE google_calendar_id=$1`,
    [calendarId]
  );
  if (!propCfg) {
    console.warn(`[calendar/webhook] calendarId 미등록: ${calendarId}`);
    return res.status(200).end();
  }

  // 최근 예약 이벤트 조회
  let events;
  try {
    events = await fetchRecentBookings(calendarId, token);
  } catch (e) {
    console.error("[calendar/webhook] 이벤트 조회 실패:", e.message);
    return res.status(500).json({ error: "이벤트 조회 실패" });
  }

  for (const evt of events) {
    const attendeeEmail = evt.attendees?.[0]?.email?.toLowerCase();
    if (!attendeeEmail) continue;

    // cleaner 조회
    const { rows: [cleaner] } = await db.query(
      `SELECT * FROM cleaners WHERE email=$1`,
      [attendeeEmail]
    );

    // 진행 중인 job 조회 (status 기반, 시각 무관)
    const { rows: [job] } = await db.query(
      `SELECT * FROM cleaning_jobs
       WHERE property_id=$1
         AND status IN (
           'NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3',
           'NOTIFYING_BULK','BULK_REMINDED'
         )
       ORDER BY cleaning_start_at ASC
       LIMIT 1`,
      [propCfg.property_id]
    );
    if (!job) continue;

    // 조건부 UPDATE (race condition 방지)
    const { rows: updated } = await db.query(
      `UPDATE cleaning_jobs
       SET status='ASSIGNED', assigned_cleaner_id=$1, google_event_id=$2, updated_at=NOW()
       WHERE id=$3 AND status != 'ASSIGNED'
       RETURNING id`,
      [cleaner?.id ?? null, evt.id, job.id]
    );

    if (!updated.length) continue; // 이미 다른 청소자가 선점

    const cleanerName = cleaner?.name ?? attendeeEmail;
    const date = new Date(job.cleaning_start_at).toISOString().slice(0, 10);

    // 나머지 청소자에게 완료 SMS
    if (cleaner) {
      await sendCompletionSmsToRest(db, job.id, cleaner.id).catch((e) =>
        console.error("[calendar/webhook] 완료 SMS 실패:", e.message)
      );
    }

    // Slack 알림
    await postSlack(
      `[PROPOS] ✅ ${propCfg.name} ${date} 청소 배정 완료 (${cleanerName})`
    );

    if (!cleaner) {
      await postSlack(
        `[PROPOS] ⚠️ 미등록 이메일로 예약: ${attendeeEmail} — 수동 확인 필요`
      );
    }
  }

  return res.status(200).end();
}
