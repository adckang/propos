/**
 * icalParser.js — iCal 텍스트 파싱 순수 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * iCal 줄 접기(line folding) 해제 후 VEVENT 배열 반환.
 * CRLF+공백/탭으로 이어진 줄을 하나로 합친다.
 */
// 동일 키가 여러 번 나올 수 있는 필드 (ATTENDEE 등)
const MULTI_VALUE_KEYS = new Set(['ATTENDEE']);

export function parseVEvents(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      if (current) { events.push(current); current = null; }
    } else if (current) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      // 키에 파라미터가 붙은 경우 (DTSTART;VALUE=DATE) → 기본 키만 추출
      const baseKey = line.slice(0, colonIdx).split(';')[0].toUpperCase();
      const value   = line.slice(colonIdx + 1);
      if (MULTI_VALUE_KEYS.has(baseKey)) {
        // 배열로 누적
        if (!current[baseKey]) current[baseKey] = [];
        current[baseKey].push(value);
      } else {
        current[baseKey] = value;
      }
    }
  }
  return events;
}

/**
 * iCal 날짜 문자열 → Date 객체.
 * DATE (YYYYMMDD): 로컬 자정으로 해석.
 * DATETIME (YYYYMMDDTHHMMSSZ): UTC로 해석.
 */
export function parseIcalDate(str) {
  if (!str) return null;
  const s = str.trim();
  if (s.length === 8) {
    return new Date(
      parseInt(s.slice(0, 4)),
      parseInt(s.slice(4, 6)) - 1,
      parseInt(s.slice(6, 8)),
    );
  }
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  }
  return new Date(
    parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
    parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
  );
}

/**
 * Airbnb VEVENT 배열 → 예약 객체 배열 (checkIn 오름차순 정렬).
 *
 * Airbnb 규칙:
 *  - DTSTART = 체크인 날짜 (시각 없음)
 *  - DTEND   = 체크아웃 날짜 (시각 없음)
 *  - SUMMARY = "Reserved" (예약됨) / "Airbnb (Not available)" (차단)
 *
 * @param {object[]} events       parseVEvents() 반환값
 * @param {number}   checkInHour  기본 체크인 시각 (0-23, 기본 15)
 * @param {number}   checkOutHour 기본 체크아웃 시각 (0-23, 기본 11)
 */
export function airbnbEventsToReservations(events, checkInHour = 15, checkOutHour = 11) {
  const results = [];

  for (const e of events) {
    if (!e.DTSTART || !e.DTEND) continue;
    if (e.SUMMARY === 'Airbnb (Not available)') continue;  // 차단 날짜 무시

    const startDay = parseIcalDate(e.DTSTART);
    const endDay   = parseIcalDate(e.DTEND);
    if (!startDay || !endDay) continue;

    const checkIn  = new Date(startDay); checkIn.setHours(checkInHour, 0, 0, 0);
    const checkOut = new Date(endDay);   checkOut.setHours(checkOutHour, 0, 0, 0);

    // DESCRIPTION에서 예약 코드 및 전화번호 뒷자리 추출
    const desc         = (e.DESCRIPTION || '').replace(/\\n/g, '\n');
    const codeMatch    = desc.match(/reservations\/details\/([A-Z0-9]+)/);
    const phoneMatch   = desc.match(/Phone Number \(Last 4 Digits\):\s*(\d+)/);

    results.push({
      uid:             e.UID || '',
      reservationCode: codeMatch  ? codeMatch[1]  : '',
      guestPhone4:     phoneMatch ? phoneMatch[1] : null,
      guestName:       null,   // iCal에 게스트 이름 없음
      platform:        'Airbnb',
      checkIn,
      checkOut,
    });
  }

  return results.sort((a, b) => a.checkIn - b.checkIn);
}

/**
 * Google Calendar VEVENT 배열 → 청소 슬롯 객체 배열.
 *
 * 실제 캘린더 이벤트 형식:
 *   SUMMARY:  "동패동.아보쉘 청소일정 (최유정)"
 *   DESCRIPTION: "<b>예약자:</b>\n최유정\ndbwjddk0901@gmail.com\n<br>12시~3시 청소 입니다."
 *   ATTENDEE: 배열 — 청소 담당자 + 주최자(bnb.paju@gmail.com)
 *   DTSTART/DTEND: UTC (KST = UTC+9)
 *
 * @param {object[]} events
 * @param {string}   organizerEmail  주최자 이메일 (제외용, 기본 'bnb.paju@gmail.com')
 */
export function gcalEventsToCleaningSlots(events, organizerEmail = 'bnb.paju@gmail.com') {
  const results = [];

  for (const e of events) {
    if (!e.DTSTART || !e.DTEND) continue;
    const start = parseIcalDate(e.DTSTART);
    const end   = parseIcalDate(e.DTEND);
    if (!start || !end) continue;

    const summary = e.SUMMARY || '';

    // SUMMARY: "동패동.아보쉘 청소일정 (최유정)" → propertyName, cleanerName
    const summaryMatch = summary.match(/^(.+?)\s+청소일정\s*\((.+?)\)/);
    const propertyName = summaryMatch ? summaryMatch[1].trim() : null;
    const nameFromSummary = summaryMatch ? summaryMatch[2].trim() : null;

    // DESCRIPTION: HTML + iCal 이스케이프 제거 후 이메일 추출
    const desc = (e.DESCRIPTION || '')
      .replace(/\\n/g, '\n')
      .replace(/<[^>]+>/g, '');
    const descLines   = desc.split('\n').map(l => l.trim()).filter(Boolean);
    const emailFromDesc = descLines.find(l => l.includes('@') && !l.includes('예약자'));

    // ATTENDEE 배열에서 주최자 제외한 청소 담당자 이메일 추출
    const attendees = Array.isArray(e.ATTENDEE) ? e.ATTENDEE : (e.ATTENDEE ? [e.ATTENDEE] : []);
    const cleanerAttendee = attendees.find(a => !a.toLowerCase().includes(organizerEmail.toLowerCase()));
    const emailFromAttendee = cleanerAttendee?.match(/mailto:(.+)/i)?.[1]?.trim() ?? null;

    results.push({
      uid:          e.UID || '',
      summary,
      start,
      end,
      propertyName,
      cleanerName:  nameFromSummary,
      cleanerEmail: emailFromDesc || emailFromAttendee || null,
    });
  }

  return results.sort((a, b) => a.start - b.start);
}
