/**
 * calendarSyncService.js — iCal 싱크 + 숙소 상태 파생
 * 브라우저 전용. same-origin /api/ical 프록시를 1순위로 사용한다.
 */

import {
  parseVEvents,
  airbnbEventsToReservations,
  gcalEventsToCleaningSlots,
} from '../domain/room-state/icalParser.js';

const PROXIES = [
  url => `/api/ical?url=${encodeURIComponent(url)}`,
];

async function fetchIcal(url) {
  let lastErr;
  for (const makeProxy of PROXIES) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      const proxiedUrl = makeProxy(url);
      const res = await fetch(proxiedUrl, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.includes("BEGIN:VCALENDAR")) return text;

      if (proxiedUrl.startsWith("/api/ical")) {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("iCal proxy returned non-calendar response");
        }
        throw new Error(json.error || "iCal proxy error");
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Airbnb iCal URL → 예약 배열 (checkIn 오름차순).
 */
export async function syncAirbnbReservations(icalUrl, { checkInHour = 15, checkOutHour = 11 } = {}) {
  const text   = await fetchIcal(icalUrl);
  const events = parseVEvents(text);
  return airbnbEventsToReservations(events, checkInHour, checkOutHour);
}

/**
 * Google Calendar 공개 iCal URL → 청소 슬롯 배열.
 */
export async function syncGoogleCalendarSlots(icalUrl) {
  const text   = await fetchIcal(icalUrl);
  const events = parseVEvents(text);
  return gcalEventsToCleaningSlots(events);
}

function getCleaningEndFromReservation(reservation, cleanDurationHours) {
  if (!reservation?.checkOut) return null;
  return new Date(reservation.checkOut.getTime() + cleanDurationHours * 3600000);
}

function getPrepStart(checkIn) {
  const prepStart = new Date(checkIn);
  prepStart.setHours(11, 0, 0, 0);
  return prepStart;
}

function getPreStaySubStatus(checkIn, now) {
  const optStart = new Date(checkIn.getTime() - 2 * 3600000);
  const optEnd   = new Date(checkIn.getTime() - 0.5 * 3600000);

  if (now < optStart) return 'CHECKIN_INQUIRY';
  if (now < optEnd) return 'OPTIMIZING';
  return 'OPTIMIZED';
}

/**
 * 예약 배열 + 현재 시각 → 현재 상태 파생.
 * 청소 윈도우: 체크아웃 후 cleanDurationHours 시간 이내.
 */
export function deriveCurrentState(reservations, now = new Date(), cleanDurationHours = 2.5) {
  const activeRes = reservations.find(r => r.checkIn <= now && r.checkOut > now);
  if (activeRes) return { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };

  const pastRes = reservations.filter(r => r.checkOut <= now);
  const lastRes = pastRes[pastRes.length - 1];
  if (lastRes) {
    const cleanEnd = getCleaningEndFromReservation(lastRes, cleanDurationHours);
    if (cleanEnd > now) return { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' };
  }

  const nextRes = reservations
    .filter(r => r.checkIn > now)
    .sort((a, b) => a.checkIn - b.checkIn)[0];
  if (nextRes) {
    const prepStart = getPrepStart(nextRes.checkIn);
    if (now >= prepStart) {
      return {
        mainStatus: 'PRE_STAY_READY',
        subStatus: getPreStaySubStatus(nextRes.checkIn, now),
      };
    }
  }

  return { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' };
}

/**
 * 예약 배열 → 타임라인 세그먼트 (말단 세그먼트는 end: null).
 * buildFutureSegments가 end===null인 세그먼트를 현재 상태로 사용함.
 */
export function deriveTimeline(reservations, cleanDurationHours = 2.5) {
  const now    = new Date();
  const active = reservations.find(r => r.checkIn <= now && r.checkOut > now);

  if (active) {
    return [{
      mainStatus: 'OCCUPIED',
      subStatus: 'GOOD_CONDITION',
      start: active.checkIn,
      end: null,
    }];
  }

  const past    = reservations.filter(r => r.checkOut <= now);
  const lastRes = past[past.length - 1];
  const nextRes = reservations
    .filter(r => r.checkIn > now)
    .sort((a, b) => a.checkIn - b.checkIn)[0];

  if (lastRes) {
    const cleanEnd = getCleaningEndFromReservation(lastRes, cleanDurationHours);
    if (cleanEnd > now) {
      return [
        { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION', start: lastRes.checkIn, end: lastRes.checkOut },
        { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: lastRes.checkOut, end: null },
      ];
    }

    if (nextRes) {
      const prepStart = getPrepStart(nextRes.checkIn);
      if (now >= prepStart) {
        const subStatus = getPreStaySubStatus(nextRes.checkIn, now);
        return [
          { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION', start: lastRes.checkIn, end: lastRes.checkOut },
          { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: lastRes.checkOut, end: cleanEnd },
          { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED', start: cleanEnd, end: prepStart },
          { mainStatus: 'PRE_STAY_READY', subStatus, start: prepStart, end: null },
        ].filter(seg => seg.end === null || seg.end > seg.start);
      }
    }

    return [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION', start: lastRes.checkIn, end: lastRes.checkOut },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: lastRes.checkOut, end: cleanEnd },
      { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED', start: cleanEnd, end: null },
    ];
  }

  if (nextRes) {
    const prepStart = getPrepStart(nextRes.checkIn);
    if (now >= prepStart) {
      return [{
        mainStatus: 'PRE_STAY_READY',
        subStatus: getPreStaySubStatus(nextRes.checkIn, now),
        start: prepStart,
        end: null,
      }];
    }
  }

  // 과거 체크아웃 없음 → 공실
  return [{
    mainStatus: 'VACANT',
    subStatus: 'CLEANING_FINISHED',
    start: new Date(now.getTime() - 24 * 3600000),
    end: null,
  }];
}

/**
 * iCal 싱크 결과 + 템플릿 → Room State Machine 호환 숙소 객체.
 *
 * @param {object}   template      id, name, district, sensors, checkInHour, checkOutHour, cleaningDurationHours
 * @param {object[]} reservations  syncAirbnbReservations() 반환값
 * @param {object[]} cleaningSlots syncGoogleCalendarSlots() 반환값 (옵션)
 */
export function buildLiveProperty(template, reservations, cleaningSlots = []) {
  const now     = new Date();
  const cleanH  = template.cleaningDurationHours ?? 2.5;

  const currentState = deriveCurrentState(reservations, now, cleanH);
  const timeline     = deriveTimeline(reservations, cleanH);

  const activeRes = reservations.find(r => r.checkIn <= now && r.checkOut > now);
  const futureRes = reservations.filter(r => r.checkIn > now).sort((a, b) => a.checkIn - b.checkIn);

  // 모든 미래 예약에 청소 슬롯 정보 매핑
  const enrichedFutureRes = futureRes.map((r, i) => {
    if (!cleaningSlots.length) return r;
    const prevCheckout = i === 0
      ? (activeRes?.checkOut ?? reservations.filter(rv => rv.checkOut <= now).at(-1)?.checkOut)
      : futureRes[i - 1].checkOut;
    const slot = cleaningSlots.find(s =>
      (!prevCheckout || s.start >= prevCheckout) && s.end <= r.checkIn
    );
    return slot
      ? { ...r, cleanerName: slot.cleanerName, cleanerEmail: slot.cleanerEmail, cleaningAt: slot.start, cleaningEnd: slot.end, cleaningStatus: 'ASSIGNED' }
      : { ...r, cleaningStatus: 'UNASSIGNED' };
  });

  const enrichedReservations = [
    ...reservations.filter(r => r.checkIn <= now),
    ...enrichedFutureRes,
  ].sort((a, b) => a.checkIn - b.checkIn);

  return {
    ...template,
    isLive:           true,
    currentState,
    timeline,
    reservation:      activeRes ?? enrichedFutureRes[0] ?? null,
    nextReservation:  enrichedFutureRes[0] ?? null,
    reservations:     enrichedReservations,
    cleaningSlots,
    lastSynced:       now,
  };
}
