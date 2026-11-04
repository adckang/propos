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
import { buildReservationHistorySegments } from '../domain/reservationHistoryDomain.js';

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

/**
 * 체크인 순서로 정렬된 예약 배열에서 "체크아웃이 지난 것 중 가장 최근(배열상 마지막)" 것을 고른다.
 * PropertyDetailView의 cleaningInfoMap이 체크아웃 키(cleaningCheckoutAt) 없는 청소 세그먼트(목업
 * 타임라인)를 "누구 예약인지" 되짚을 때 쓴다. 예약 기반 타임라인의 청소 세그먼트는 키를 직접 갖는다.
 */
export function lastPastReservation(reservations, now) {
  const pastRes = reservations.filter(r => r.checkOut <= now);
  return pastRes[pastRes.length - 1] ?? null;
}

/**
 * 예약 배열 → 타임라인 세그먼트 (말단 세그먼트는 end: null = 지금 진행 중).
 * buildFutureSegments가 end===null인 세그먼트를 현재 상태로 사용함.
 *
 * 지난 예약 전부를 예약 기록으로 다시 그린다 — 예전엔 가장 최근 숙박 1건만 그려서 그보다 오래된
 * 과거가 숙소 상세·리스트 타임라인에서 텅 비어 보였다(실사용 중 발견, 2026-11-04). 숙박 한 번의
 * 순서(입실준비 → 체류 → 청소 → 공실)는 미래 예측과 같은 함수(appendStayCycle)를 쓴다.
 */
export function deriveTimeline(reservations, cleanDurationHours = 2.5, now = new Date()) {
  const timeline = buildReservationHistorySegments(reservations, now, cleanDurationHours, { openEnded: true });
  if (timeline.length) return timeline;

  // 입실준비가 시작된 예약이 하나도 없음 → 공실
  return [{
    mainStatus: 'VACANT',
    subStatus: 'CLEANING_FINISHED',
    start: new Date(now.getTime() - 24 * 3600000),
    end: null,
  }];
}

/**
 * 예약 배열 + 현재 시각 → 현재 상태 = 타임라인의 "지금 진행 중" 구간.
 * 타임라인과 같은 계산을 쓰므로 상태 칩·필터와 타임라인이 서로 다른 말을 할 수 없다
 * (따로 구현했을 땐 겹친 예약·체크인을 넘긴 청소에서 둘이 어긋났다, 코드 리뷰에서 재현).
 * 예약된 청소 시작 전에는 대기, 예약 종료 전까지는 진행 구간으로 예측한다.
 */
export function deriveCurrentState(reservations, now = new Date(), cleanDurationHours = 2.5) {
  const { mainStatus, subStatus } = deriveTimeline(reservations, cleanDurationHours, now).at(-1);
  return { mainStatus, subStatus };
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

  const timeline     = deriveTimeline(reservations, cleanH, now);
  const { mainStatus, subStatus } = timeline.at(-1);
  const currentState = { mainStatus, subStatus };

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
