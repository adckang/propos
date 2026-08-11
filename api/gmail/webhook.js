/**
 * POST /api/gmail/webhook
 * Gmail Pub/Sub Push Notification — 에어비앤비 예약 확정 이메일 감지.
 *
 * Pub/Sub 메시지 구조:
 * { message: { data: base64(JSON({ historyId, emailAddress })) }, subscription: "..." }
 *
 * 처리 흐름:
 * 1. historyId로 Gmail History API 조회 → 새 이메일 subject 확인
 * 2. "Reservation confirmed" / "예약 확정" 포함 여부 체크
 * 3. iCal 재폴링 → 14일 이내 신규 체크아웃 → SHORT_NOTICE 즉시 발동
 */

import { Pool } from "pg";
import { advanceJob, calcCleaningTimes, getPropertyConfig, postSlack } from "../cleaning/_dispatch.js";

const db = new Pool({ connectionString: process.env.POSTGRES_URL });

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

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
  if (!data.access_token) throw new Error(`OAuth 실패: ${JSON.stringify(data)}`);
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _accessToken;
}

const RESERVATION_SUBJECTS = [
  "reservation confirmed",
  "예약 확정",
  "booking confirmed",
];

function isReservationEmail(subject) {
  const lower = (subject ?? "").toLowerCase();
  return RESERVATION_SUBJECTS.some((s) => lower.includes(s));
}

async function fetchHistory(historyId, token) {
  const url = `${GMAIL_API}/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  return data.history ?? [];
}

async function fetchMessageSubject(messageId, token) {
  const url = `${GMAIL_API}/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  const subjectHeader = (data.payload?.headers ?? []).find((h) => h.name === "Subject");
  return subjectHeader?.value ?? "";
}

// iCal 재폴링 및 SHORT_NOTICE 처리
async function triggerShortNotice() {
  // localStorage에 저장된 iCal URL은 브라우저 전용 → Pi watcher에서 관리
  // 여기서는 Slack으로 알림 발송 후 Pi에서 자동 폴링되도록 신호만 보냄
  // (Pi watcher가 /api/gmail/trigger를 구독하거나, 30분 cron으로 커버)
  await postSlack(
    "[PROPOS] 📬 에어비앤비 신규 예약 이메일 감지. iCal 재폴링 트리거."
  );

  // 14일 이내 PENDING job 즉시 발동
  const { rows: pendingJobs } = await db.query(
    `SELECT * FROM cleaning_jobs
     WHERE status = 'PENDING'
       AND cleaning_start_at <= NOW() + INTERVAL '14 days'
     ORDER BY cleaning_start_at ASC`
  );

  for (const job of pendingJobs) {
    try {
      await advanceJob(db, job);
    } catch (e) {
      console.error(`[gmail/webhook] job(${job.id}) 발동 실패:`, e.message);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // ?secret= 쿼리 파라미터 검증 (Pub/Sub 구독 URL에 포함된 secret)
  const webhookSecret = process.env.GOOGLE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const qs = new URL(req.url, "http://localhost").searchParams;
    if (qs.get("secret") !== webhookSecret) {
      console.warn("[gmail/webhook] secret 불일치 — 무시");
      return res.status(200).end(); // Pub/Sub 재시도 방지
    }
  }

  // Pub/Sub 메시지 파싱
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return res.status(400).end(); }

  const b64 = body?.message?.data;
  if (!b64) return res.status(200).end(); // ack

  let payload;
  try { payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { return res.status(200).end(); }

  const { historyId } = payload;
  if (!historyId) return res.status(200).end();

  try {
    const token = await getAccessToken();
    const histories = await fetchHistory(historyId, token);

    for (const h of histories) {
      for (const added of (h.messagesAdded ?? [])) {
        const subject = await fetchMessageSubject(added.message.id, token);
        if (isReservationEmail(subject)) {
          await triggerShortNotice();
          return res.status(200).end(); // 한 건만 감지해도 트리거
        }
      }
    }
  } catch (e) {
    console.error("[gmail/webhook]", e.message);
    // Pub/Sub는 200이 아니면 재시도 — 오류여도 200 반환
  }

  return res.status(200).end();
}
