/**
 * calendarSyncService.js — iCal 파서 + 숙소 상태 파생
 *
 * 예약 원본을 운영 DB에 반영하는 책임은 server `/api/cleaning/ical-sync`에 있다.
 * 아래 iCal 파서 함수는 도메인 테스트와 오프라인 도구에서 재사용할 수 있는 순수
 * 변환 유틸리티로 유지하며, 운영 화면(RoomStateApp)은 직접 호출하지 않는다.
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

// 스펙: 체크인 정확히 1시간 전에 checkin_prep_time_reached 발생
function getPrepStart(checkIn) {
  return new Date(checkIn.getTime() - 3600000);
}

function getPreStaySubStatus(checkIn, now) {
  const optEnd = new Date(checkIn.getTime() - 0.5 * 3600000); // 체크인 30분 전
  return now < optEnd ? 'OPTIMIZING' : 'OPTIMIZED';
}

/**
 * 체크인 순서로 정렬된 예약 배열에서 "체크아웃이 지난 것 중 가장 최근(배열상 마지막)" 것을 고른다.
 * deriveCurrentState·deriveTimeline이 "지금 무슨 상태인지"를 판단하는 기준점과, PropertyDetailView의
 * cleaningInfoMap이 "지금 청소 중인 세그먼트는 누구 예약인지" 되짚는 기준점이 반드시 같아야 한다
 * (따로 구현하면, 예약이 겹쳐 있을 때 — D-031에서도 확인된 실제 현상 — 서로 다른 예약을
 * "지금"으로 가리켜 틀린 상태/담당자가 뜰 수 있다) — 그래서 한 곳에만 둔다.
 */
export function lastPastReservation(reservations, now) {
  const pastRes = reservations.filter(r => r.checkOut <= now);
  return pastRes[pastRes.length - 1] ?? null;
}

/**
 * 예약 배열 + 현재 시각 → 현재 상태 파생.
 * 청소 윈도우: 체크아웃 후 cleanDurationHours 시간 이내.
 */
export function deriveCurrentState(reservations, now = new Date(), cleanDurationHours = 2.5) {
  const activeRes = reservations.find(r => r.checkIn <= now && r.checkOut > now);
  if (activeRes) return { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };

  const lastRes = lastPastReservation(reservations, now);
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

  const lastRes = lastPastReservation(reservations, now);
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
    // 예약 자신이 이미 cleaningStatus를 들고 있으면(Postgres 정본에서 체크아웃 날짜로 매칭된
    // 값) 그대로 쓴다 — cleaningSlots 겹침으로 다시 계산하면, 슬롯 시각(cleaning_jobs가
    // 체크아웃시각 설정 기준으로 계산한 시각)과 예약의 실제(raw iCal) 체크아웃 시각이 서로
    // 달라(실데이터 확인, 최대 9시간 차이 나는 경우 있음) 거의 항상 안 겹쳐서, 이미 맞게
    // 채워진 배정 상태를 "미배정"으로 잘못 덮어썼다 — 실사용 중 발견, 2026-10-30.
    if (r.cleaningStatus) return r;
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
