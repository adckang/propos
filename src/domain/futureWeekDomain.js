/**
 * 다음주 레포트 도메인 — 예약 기반 순수 함수
 *
 * 입력 데이터:
 *   properties[].reservations[] — 타임라인 gantt와 동일 소스 (checkIn/checkOut: Date)
 *   weekStart / weekEnd         — KST 월요일 00:00 / 다음 월요일 00:00 (exclusive), periodDomain 이 계산
 */

import { periodToRemainingRange, describePeriod } from './periodDomain.js';

const DAY = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** KST 기준 일(day) 인덱스 — 박수·청소 일정 매칭은 한국 달력 날짜 기준 (periodDomain 경계와 동일) */
function dayOf(date) {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / DAY);
}

/**
 * 주간 체크인 건수 — checkIn ∈ [weekStart, weekEnd)
 */
export function countWeekCheckIns(properties, weekStart, weekEnd) {
  const ws = weekStart.getTime();
  const we = weekEnd.getTime();
  let count = 0;
  for (const p of properties) {
    for (const r of (p.reservations ?? [])) {
      const ci = r.checkIn.getTime();
      if (ci >= ws && ci < we) count++;
    }
  }
  return count;
}

/**
 * 주간 체크아웃 건수 — checkOut ∈ [weekStart, weekEnd)
 */
export function countWeekCheckOuts(properties, weekStart, weekEnd) {
  const ws = weekStart.getTime();
  const we = weekEnd.getTime();
  let count = 0;
  for (const p of properties) {
    for (const r of (p.reservations ?? [])) {
      const co = r.checkOut.getTime();
      if (co >= ws && co < we) count++;
    }
  }
  return count;
}

/** 숙소 하나의 구간 내 체류 박수 (예약-구간 겹치는 일수, 구간 전체 박수를 넘지 않게 자름) */
function roomNightsOf(property, wsDay, weDay, weekDays) {
  let roomNights = 0;
  for (const r of (property.reservations ?? [])) {
    const ciDay = dayOf(r.checkIn);
    const coDay = dayOf(r.checkOut);
    roomNights += Math.max(0, Math.min(coDay, weDay) - Math.max(ciDay, wsDay));
  }
  return Math.min(roomNights, weekDays); // 주 최대 박수 초과 방지
}

/**
 * 주간 공실/체류 예측
 *
 * - occupiedNights: 전체 숙소의 체류 박수 합산 (예약-주간 겹치는 일수)
 * - vacantNights:   totalNights - occupiedNights
 * - occupiedRooms:  occupiedNights > 0인 숙소 수
 * - vacantRooms:    occupiedNights === 0인 숙소 수 (주 전체 공실)
 * - occupancyRate:  occupiedNights / totalNights (0~1)
 */
export function getOccupancyForecast(properties, weekStart, weekEnd) {
  const wsDay = dayOf(weekStart);
  const weDay = dayOf(weekEnd);
  const weekDays = weDay - wsDay;

  let occupiedRooms = 0;
  let vacantRooms   = 0;
  let occupiedNights = 0;

  for (const p of properties) {
    const roomNights = roomNightsOf(p, wsDay, weDay, weekDays);
    if (roomNights > 0) occupiedRooms++;
    else vacantRooms++;
    occupiedNights += roomNights;
  }

  const totalNights  = properties.length * weekDays;
  const vacantNights = totalNights - occupiedNights;
  const occupancyRate = totalNights > 0 ? occupiedNights / totalNights : 0;
  const vacancyRate   = totalNights > 0 ? vacantNights  / totalNights : 0;

  return { occupiedRooms, vacantRooms, occupiedNights, vacantNights, totalNights, occupancyRate, vacancyRate };
}

/**
 * 숙소별 공실률 — "공실률 높은 숙소 순" 목록에 쓴다. 정렬은 하지 않고 그대로 반환(화면에서 정렬).
 *
 * @returns {{ property_id, property_name, occupiedNights, vacantNights, totalNights, vacancyRate }[]}
 */
export function getPropertyVacancyRates(properties, weekStart, weekEnd) {
  const wsDay = dayOf(weekStart);
  const weDay = dayOf(weekEnd);
  const weekDays = weDay - wsDay;

  return properties.map(p => {
    const occupiedNights = roomNightsOf(p, wsDay, weDay, weekDays);
    const vacantNights = Math.max(0, weekDays - occupiedNights);
    const vacancyRate = weekDays > 0 ? vacantNights / weekDays : 0;
    return {
      property_id: p.id,
      property_name: p.name,
      occupiedNights,
      vacantNights,
      totalNights: weekDays,
      vacancyRate,
    };
  });
}

// 청소 배정 완료 상태 (캘린더 우선, DB 보조)
const ASSIGNED_STATUSES  = new Set(['ASSIGNED', 'COMPLETED']);
// 자동 배정 진행 중 상태
const REQUESTING_STATUSES = new Set([
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED',
]);

/**
 * 청소 배정 4분류
 *
 * 우선순위:
 *   1. 캘린더 청소 일정 있음 (날짜 일치, 1:1 소모) → assigned
 *   2. DB ASSIGNED/COMPLETED                        → assigned
 *   3. DB ESCALATED                                 → failed
 *   4. DB PENDING ~ BULK_REMINDED                   → requesting
 *   5. 해당 없음                                    → needsRequest
 *
 * @param {Array<{propertyId: string, checkoutDate: Date}>} weekCheckouts
 * @param {Array<{date: Date}>} calendarEvents - iCal 청소 일정
 * @param {Array<{propertyId: string, checkoutDate: Date, status: string}>} dbJobs
 * @returns {{ assigned: number, needsRequest: number, requesting: number, failed: number }}
 */
export function classifyCleaningAssignments(weekCheckouts, calendarEvents, dbJobs) {
  // 캘린더 이벤트 풀 — dayIndex → 남은 이벤트 수 (1:1 소모)
  const calPool = {};
  for (const ev of calendarEvents) {
    const d = dayOf(ev.date);
    calPool[d] = (calPool[d] ?? 0) + 1;
  }

  // DB 잡 — propertyId → job (중복 시 마지막 우선, 실운영에서 1개 가정)
  const dbByProp = new Map();
  for (const job of dbJobs) {
    dbByProp.set(job.propertyId, job);
  }

  let assigned = 0, needsRequest = 0, requesting = 0, failed = 0;

  for (const checkout of weekCheckouts) {
    const dayIdx = dayOf(checkout.checkoutDate);

    // 1. 캘린더 이벤트 매칭 (날짜 일치, 소모)
    if ((calPool[dayIdx] ?? 0) > 0) {
      calPool[dayIdx]--;
      assigned++;
      continue;
    }

    // 2. DB 매칭 (propertyId 기준)
    const job = dbByProp.get(checkout.propertyId);
    if (job) {
      if (ASSIGNED_STATUSES.has(job.status)) {
        assigned++;
      } else if (job.status === 'ESCALATED') {
        failed++;
      } else if (REQUESTING_STATUSES.has(job.status)) {
        requesting++;
      } else {
        // CANCELLED 또는 알 수 없는 상태 → 다시 배정 필요
        needsRequest++;
      }
      continue;
    }

    // 3. 아무것도 없음 → 배정 요청 필요
    needsRequest++;
  }

  return { assigned, needsRequest, requesting, failed };
}

// ── 미래 기간 요약 문장 ────────────────────────────────────────────────────────
// 서버(generateSummary)는 이벤트로만 세는데 미래에는 이벤트가 없어 항상 "예약 없음"이 된다.
// 예약(iCal)은 클라이언트에만 있으므로 패널과 같은 계산으로 문장을 만든다.
// 표준 이름은 기존 문구 유지, 그 밖(2주 뒤, 3일 뒤 …)은 describePeriod 의 이름을 쓴다
const FUTURE_LABEL = { tomorrow: '내일', next_week: '다음 주', next_month: '다음 달', next_hour: '1시간 내' };

// 미래 "바쁨" 등급 — 과거 요약(operationalMetricsDomain의 5단계 등급, D-026)과 대칭되는
// 개념을 미래 쪽에 적용한 것. week/month 단위 기간에서만 매긴다 — 하루/1시간 단위는 표본이
// 너무 작아 정규화해도 왜곡된다(예: 내일 체크아웃 1건만 있어도 "아주 바빠요"로 과다 표시될 수
// 있음). 지표: (체크인+체크아웃) ÷ 선택된 숙소 수 ÷ 주 환산 기간 — 숙소 1곳·1주와 숙소 20곳·1달
// 처럼 스코프·기간 길이가 달라도 같은 기준("숙소 1곳이 1주에 겪는 회전 수")으로 비교 가능하게
// 정규화한다. 기준값은 제안값 — 운영해보고 조정 (D-018/D-029와 같은 원칙).
const BUSY_TIER_BY_MIN_RATE = [
  { min: 4, label: '아주 바빠요' },
  { min: 2, label: '바빠요' },
  { min: 1, label: '보통이에요' },
  { min: 0, label: '한산해요' },
];

function busyTierLabel(weeklyRatePerProperty) {
  return BUSY_TIER_BY_MIN_RATE.find(t => weeklyRatePerProperty >= t.min).label;
}

/**
 * 미래 기간이면 예약 기반 요약 문장, 아니면 '' (호출자가 서버 요약으로 대체).
 * week/month 단위 기간은 "바쁨" 등급(한산해요~아주 바빠요)을 붙인다 (day/hour 단위는 표본이
 * 작아 등급을 매기지 않고 기존처럼 사실만 말한다).
 * content-guide: 한 문장에 숫자 최대 2개.
 *
 * @param {string} period
 * @param {object[]} properties  범위(선택 숙소)가 적용된 숙소 목록
 * @param {number} [nowMs]
 * @returns {string}
 */
export function futureSummaryFor(period, properties, nowMs) {
  const desc = describePeriod(period);
  if (desc?.tense !== 'future') return '';
  const label = FUTURE_LABEL[period] ?? desc.label;
  const range = periodToRemainingRange(period, nowMs);
  if (!range) return '';
  const checkIns  = countWeekCheckIns(properties,  range.from, range.to);
  const checkOuts = countWeekCheckOuts(properties, range.from, range.to);
  if (checkIns === 0 && checkOuts === 0) return `${label} 예정된 체크인·체크아웃이 없어요.`;

  if (desc.unit === 'week' || desc.unit === 'month') {
    const periodWeeks = (range.to.getTime() - range.from.getTime()) / DAY / 7;
    const rate = properties.length > 0 && periodWeeks > 0
      ? (checkIns + checkOuts) / properties.length / periodWeeks
      : 0;
    return `${label} ${busyTierLabel(rate)} (체크인 ${checkIns}건 · 체크아웃 ${checkOuts}건)`;
  }

  return `${label} 체크인 ${checkIns}건, 체크아웃 ${checkOuts}건 예정이에요.`;
}
