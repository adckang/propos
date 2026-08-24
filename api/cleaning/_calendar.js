/**
 * Google Calendar 블로커 이벤트 관리.
 * Appointment Schedule 슬롯 제어: opaque 이벤트로 예약 불가 표시.
 * Vercel 라우팅에서 제외되는 _ 접두사 파일.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

let _gToken = null, _gExpiry = 0;

export async function getGoogleToken() {
  if (_gToken && Date.now() < _gExpiry - 60_000) return _gToken;
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
  const d = await r.json();
  if (!d.access_token) throw new Error(`Google OAuth 실패: ${JSON.stringify(d)}`);
  _gToken = d.access_token;
  _gExpiry = Date.now() + (d.expires_in ?? 3600) * 1000;
  return _gToken;
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
  const body = {
    summary: "[PROPOS-BLOCK]",
    start: { dateTime: `${date}T${pad(startHour)}:00:00+09:00` },
    end:   { dateTime: `${date}T${pad(endH)}:${pad(endM)}:00+09:00` },
    transparency: "opaque",
    visibility: "private",
    extendedProperties: { private: { propos: "blocker", property_id: propertyId } },
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
