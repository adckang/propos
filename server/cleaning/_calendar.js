/**
 * Google Calendar 블로커 이벤트 관리.
 * Appointment Schedule 슬롯 제어: opaque 이벤트로 예약 불가 표시.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 */

import { reportTokenFailure, reportTokenSuccess } from "./_tokenHealth.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

let _gToken = null, _gExpiry = 0;
let _gmailToken = null, _gmailExpiry = 0;

async function fetchGoogleToken(refreshToken) {
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Google OAuth 실패: ${JSON.stringify(d)}`);
  return { token: d.access_token, expiry: Date.now() + (d.expires_in ?? 3600) * 1000 };
}

// Calendar 전용 (bnb.paju — GOOGLE_CALENDAR_REFRESH_TOKEN)
// kv: 호출부가 넘겨주는 @vercel/kv 인스턴스(토큰 상태 추적용, _tokenHealth.js로 전달만 함).
export async function getGoogleToken(kv) {
  if (_gToken && Date.now() < _gExpiry - 60_000) return _gToken;
  try {
    const { token, expiry } = await fetchGoogleToken(
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN
    );
    _gToken = token; _gExpiry = expiry;
    await reportTokenSuccess(kv, "google_calendar", "Google Calendar 토큰");
    return _gToken;
  } catch (e) {
    await reportTokenFailure(kv, "google_calendar", "Google Calendar 토큰 발급", e);
    throw e;
  }
}

// Gmail Watch 전용 (nam5821 — GOOGLE_REFRESH_TOKEN)
export async function getGmailToken(kv) {
  if (_gmailToken && Date.now() < _gmailExpiry - 60_000) return _gmailToken;
  try {
    const { token, expiry } = await fetchGoogleToken(
      process.env.GOOGLE_REFRESH_TOKEN ?? process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    );
    _gmailToken = token; _gmailExpiry = expiry;
    await reportTokenSuccess(kv, "google_gmail", "Gmail 토큰");
    return _gmailToken;
  } catch (e) {
    await reportTokenFailure(kv, "google_gmail", "Gmail 토큰 발급", e);
    throw e;
  }
}

/**
 * 블로커 이벤트 생성. 반환값: Google Calendar event.id
 * startHour + durationHours 시간 동안 opaque 이벤트를 삽입해 예약 슬롯 차단.
 */
export async function createBlockerEvent(calendarId, date, startHour, durationHours, propertyId, googleToken) {
  const pad = (n) => String(n).padStart(2, "0");
  const totalMin = Math.round(durationHours * 60);
  const endH = Math.floor((startHour * 60 + totalMin) / 60);
  const endM = (startHour * 60 + totalMin) % 60;
  // goo.createdByAvailId: bnb.paju@gmail.com 계정의 appointment calendar ID.
  // 이 속성이 있어야 Google Appointment Schedule에서 "이미 예약됨"으로 표시됨.
  const AVAIL_ID = "6l42efisiehi77mscb5qoh295f";
  const body = {
    summary: "청소 예약 차단",
    start: { dateTime: `${date}T${pad(startHour)}:00:00+09:00` },
    end:   { dateTime: `${date}T${pad(endH)}:${pad(endM)}:00+09:00` },
    transparency: "opaque",
    visibility: "private",
    extendedProperties: {
      private: { propos: "blocker", property_id: propertyId },
      shared: { "goo.createdByAvailId": AVAIL_ID, "goo.createdBySet": "default_cita" },
    },
  };
  const r = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${googleToken}` },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Blocker 생성 실패 (${date}): ${r.status} ${txt}`);
  }
  const evt = await r.json();
  return evt.id;
}

/**
 * 블로커 이벤트 삭제.
 * 404 / 410: 이미 삭제됨 → 정상 처리 (멱등성).
 */
export async function deleteBlockerEvent(calendarId, eventId, googleToken) {
  const r = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${googleToken}` } }
  );
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    throw new Error(`Blocker 삭제 실패 (${eventId}): ${r.status}`);
  }
}

/**
 * 그날 청소 칸을 연다(블로커 삭제) — 요청을 보내는 곳(매일 요청 작업·수동 발송·2주 안 신규 예약)이 같이 쓴다.
 * 구글 캘린더에서 실제로 지워졌을 때만 기록도 지운다: 구글 연결이 실패하면 기록이 남아 다음 요청 작업이 다시 연다.
 * (예전엔 기록을 먼저 지워, 구글 실패 시 칸은 막힌 채 아무도 다시 열지 않았다 — 요청 받은 담당자가 예약할 수 없음. DEC-07로
 * 칸이 요청 날에만 열리게 되면서 중요해짐, 2026-11-12)
 * 숙소에 구글 캘린더가 설정돼 있지 않으면 열 칸이 없으므로 기록만 지운다. 구글에 없는 칸(404/410)은 이미 열린 것으로 본다.
 *
 * @param {{ query: Function }} db
 * @param {{ propertyId: string, date: string, kv: object }} options  date = 한국 날짜 'YYYY-MM-DD'
 * @returns {Promise<boolean>} 이번에 막힌 기록을 지웠으면 true(막힌 기록이 없었으면 false)
 */
export async function openCleaningSlot(db, { propertyId, date, kv }) {
  const { rows: [blocker] } = await db.query(
    `SELECT event_id FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2`, [propertyId, date]);
  if (!blocker) return false;
  const { rows: [cfg] } = await db.query(
    `SELECT google_calendar_id FROM property_cleaning_config WHERE property_id=$1`, [propertyId]);
  if (cfg?.google_calendar_id) {
    const token = await getGoogleToken(kv);
    await deleteBlockerEvent(cfg.google_calendar_id, blocker.event_id, token);
  }
  await db.query(
    `DELETE FROM property_calendar_blockers WHERE property_id=$1 AND block_date=$2 AND event_id=$3`,
    [propertyId, date, blocker.event_id]);
  return true;
}

/**
 * 캘린더 알림(담당자 예약 → 자동 배정) 구독의 만료 시각을 남긴다 — 수동 등록과 6일마다 아침 자동 갱신이 같이 쓴다.
 * 청소 관리 › 절차 점검이 이 기록으로 "자동 배정이 살아 있는지"를 본다. 만료 뒤에도 2주 동안 남겨 "만료됨"이 보이게 한다
 * (예전엔 만료 1시간 뒤 기록이 사라져 끊긴 구독이 "기록 없음"으로만 보였다).
 */
export async function saveCalendarWatchExpiration(kv, calendarId, expiration) {
  const expiresAt = Number(expiration);
  if (!expiration || !Number.isFinite(expiresAt)) {
    if (expiration) console.error(`[calendar-watch] 만료 시각 형식이 이상해 기록하지 못함 (${calendarId})`);
    return;
  }
  const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) + 14 * 86_400);
  await kv.set(`calendar_watch_expiration:${calendarId}`, expiration, { ex: ttlSec }).catch(() => {});
}

/**
 * 칸을 막으면 안 되는 날 — 그날 청소 요청이 이미 나갔거나 담당자가 배정된 날(한국 날짜). 칸을 일괄로 막는 곳(15일 월간 작업·
 * 수동 일괄 생성)이 같이 쓴다: 막으면 요청 받은 담당자가 예약할 수 없다. 요청 전(PENDING)·취소된 날은 막아도 된다(칸은 요청 날 열림).
 *
 * @returns {Promise<Set<string>>} 'YYYY-MM-DD' 집합
 */
export async function requestedCleaningDays(db, propertyId, dates) {
  const { rows } = await db.query(
    `SELECT DISTINCT to_char(checkout_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day FROM cleaning_jobs
      WHERE property_id=$1 AND status NOT IN ('PENDING','CANCELLED')
        AND to_char(checkout_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = ANY($2::text[])`,
    [propertyId, dates]);
  return new Set(rows.map(row => row.day));
}

/**
 * 다음 달 날짜 전체를 "YYYY-MM-DD" 문자열 배열로 반환.
 * now는 테스트 주입용 (기본값: 현재 시각).
 */
export function getNextMonthDates(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const curYear = kst.getUTCFullYear();
  const curMonthIdx = kst.getUTCMonth(); // 0-11
  const nmIdx = (curMonthIdx + 1) % 12;  // 0-11
  const nmYear = curMonthIdx === 11 ? curYear + 1 : curYear;
  const nmNum = nmIdx + 1;               // 1-12
  const days = new Date(Date.UTC(nmYear, nmIdx + 1, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return Array.from({ length: days }, (_, i) => `${nmYear}-${pad(nmNum)}-${pad(i + 1)}`);
}

// ── iCal 파싱 ─────────────────────────────────────────────

function parseIcalCheckouts(icalText, datePredicate) {
  const results = new Map();
  for (const block of icalText.split("BEGIN:VEVENT").slice(1)) {
    const uidM   = block.match(/UID:([^\r\n]+)/);
    const dtendM = block.match(/DTEND(?:;[^:]*)?:(\d{8})/);
    if (!dtendM) continue;
    const raw  = dtendM[1];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (!datePredicate(date)) continue;
    const uid = uidM?.[1]?.trim() ?? null;
    const key = uid ?? date;
    if (!results.has(key)) results.set(key, { date, uid });
  }
  return [...results.values()];
}

/**
 * Airbnb iCal → 특정 달 체크아웃 날짜 추출.
 * targetYM: "YYYY-MM" (월간 배치용).
 */
export function parseCheckoutsFromIcal(icalText, targetYM) {
  return parseIcalCheckouts(icalText, (d) => d.startsWith(targetYM));
}

/**
 * Airbnb iCal → 오늘 이후 모든 체크아웃 날짜 추출.
 * Gmail 웹훅 즉시 재폴링용 (월 필터 없음).
 */
export function parseAllFutureCheckouts(icalText, nowMs = Date.now()) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return parseIcalCheckouts(icalText, (d) => d >= today);
}
