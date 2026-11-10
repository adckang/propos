import {
  ANCHOR_EVENT_STATES,
  FOLLOW_EVENT_TYPES,
} from './roomStateFromEventsDomain.js';
import { getNextRoomState, isValidTransition } from './room-state/roomStateDomain.js';
import {
  detectCleaningTimeFailures,
  detectPreStayOptimizationFailures,
} from './metricDrilldownDomain.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ISSUE_CATEGORY_META = Object.freeze({
  PRE_STAY_READY: { label: '입실전 문제' },
  OCCUPIED:       { label: '체류중 문제' },
  CLEANING:       { label: '청소 문제' },
  VACANT:         { label: '공실중 문제' },
});

const DIRECT_ISSUES = Object.freeze({
  no_show_suspected:                       { category: 'PRE_STAY_READY', label: '노쇼 의심' },
  early_checkin_suspected:                  { category: 'PRE_STAY_READY', label: '이른 체크인 의심' },
  complaint_detected:                       { category: 'OCCUPIED',       label: '민원 발생' },
  energy_waste_detected:                    { category: 'OCCUPIED',       label: '체류 중 에너지 낭비' },
  checkout_confirmation_needed:             { category: 'CLEANING',       label: '체크아웃 확인 필요' },
  post_checkout_energy_waste_detected:       { category: 'CLEANING',       label: '퇴실 후 청소 전 에너지 낭비' },
  post_checkout_security_breach_detected:    { category: 'CLEANING',       label: '퇴실 후 청소 전 보안 문제' },
  vacant_energy_waste_detected:              { category: 'VACANT',         label: '공실 중 에너지 낭비' },
  post_cleaning_security_breach_detected:    { category: 'VACANT',         label: '청소 후 공실 보안 문제' },
  maintenance_required:                     { category: 'VACANT',         label: '정비 필요' },
});

const RESOLUTION_OF = Object.freeze({
  energy_waste_detected:        'energy_waste_resolved',
  complaint_detected:           'complaint_resolved',
  vacant_energy_waste_detected: 'vacant_energy_waste_resolved',
});

function asDate(raw) {
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 퇴실(또는 청소 작업의 퇴실) 시각이 [from, to) 안인지 — 캘린더 칸·레포트 청소 집계가 같은 기준을 쓴다 */
function isCheckOutInRange(checkOut, from, to) {
  return !!checkOut && checkOut >= from && checkOut < to;
}

function kstDayIndex(raw) {
  const date = asDate(raw);
  return date ? Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS) : null;
}

function dateKeyFromKstDay(dayIndex) {
  const date = new Date(dayIndex * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** KST 달력 날짜 키(YYYY-MM-DD). */
export function toKstDateKey(raw) {
  const d = asDate(raw);
  if (!d) return '';
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, '0');
  const day = String(k.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 날짜 키(YYYY-MM-DD)가 오늘(KST)로부터 며칠 뒤인지. 캘린더 칸에서 "그 날짜로 이동" 할 때 쓴다
 * (ListView의 windowOffset과 같은 단위 — 일 수).
 */
export function kstDayOffsetFromToday(dateKey, now = new Date()) {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const targetDay = kstDayIndex(new Date(Date.UTC(y, m - 1, d)));
  const todayDay = kstDayIndex(now);
  return targetDay - todayDay;
}

function findResolution(eventsAsc, event, resolutionType) {
  const detectedAt = asDate(event.device_time)?.getTime();
  if (detectedAt == null) return null;
  const resolved = eventsAsc.find(candidate =>
    candidate.property_id === event.property_id
    && candidate.type === resolutionType
    && (asDate(candidate.device_time)?.getTime() ?? -Infinity) > detectedAt
  );
  return resolved?.device_time ?? null;
}

function normalizeItem(item) {
  return {
    property_id: item.property_id,
    occurred_at: asDate(item.occurred_at)?.toISOString() ?? item.occurred_at,
    category: item.category,
    type: item.type,
    label: item.label,
    resolved_at: item.resolved_at ? (asDate(item.resolved_at)?.toISOString() ?? item.resolved_at) : null,
    detail: item.detail ?? {},
  };
}

/**
 * 이벤트와 청소 잡 문제를 캘린더/DetailView가 함께 쓰는 문제 아이템으로 변환한다.
 * 감지 1회를 1건으로 세고 해결 이벤트는 건수에 더하지 않는다.
 */
export function buildIssueItems(events = [], cleaningIssues = [], preStayContext = []) {
  const eventsAsc = [...events].sort((a, b) =>
    (asDate(a.device_time)?.getTime() ?? 0) - (asDate(b.device_time)?.getTime() ?? 0)
  );
  const items = [];

  for (const event of eventsAsc) {
    const meta = DIRECT_ISSUES[event.type];
    if (!meta) continue;
    items.push(normalizeItem({
      property_id: event.property_id,
      occurred_at: event.device_time,
      category: meta.category,
      type: event.type,
      label: meta.label,
      resolved_at: RESOLUTION_OF[event.type]
        ? findResolution(eventsAsc, event, RESOLUTION_OF[event.type])
        : null,
      detail: event.data ?? {},
    }));
  }

  for (const failure of detectPreStayOptimizationFailures(eventsAsc, preStayContext)) {
    items.push(normalizeItem({
      ...failure,
      category: 'PRE_STAY_READY',
      type: 'pre_stay_optimization_failed',
      label: '입실전 숙소 최적화 미완료',
    }));
  }

  for (const failure of detectCleaningTimeFailures(eventsAsc)) {
    items.push(normalizeItem({
      ...failure,
      category: 'CLEANING',
      type: 'cleaning_time_exceeded',
      label: '청소 시간 3시간 초과',
    }));
  }

  for (const issue of cleaningIssues) items.push(normalizeItem(issue));

  return items.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
}

/** 날짜별 총 문제 수와 분류별 수, 상세 아이템. */
export function groupIssueItemsByKstDate(items = []) {
  const days = {};
  for (const item of items) {
    const date = toKstDateKey(item.occurred_at);
    if (!date) continue;
    if (!days[date]) days[date] = { total: 0, categories: {}, items: [] };
    days[date].total += 1;
    days[date].categories[item.category] = (days[date].categories[item.category] ?? 0) + 1;
    days[date].items.push(item);
  }
  return days;
}

/**
 * 다음달 예약·점유·청소 예정값을 날짜별로 묶는다.
 *
 * 각 날짜에는 숙소 ID 목록도 함께 담는다 — 캘린더 칸에서 "체류 N"·"입실 N" 등을 눌렀을 때
 * 어느 숙소들인지 보여주려면 개수만으로는 부족하다. 숙소 순서(원래 properties 순서)는 유지한다.
 */
export function buildFutureCalendarDays(properties = [], range, cleaningItems = []) {
  if (!range?.from || !range?.to) return {};
  const from = asDate(range.from);
  const to = asDate(range.to);
  const fromDay = kstDayIndex(from);
  const toDay = kstDayIndex(to);
  if (fromDay == null || toDay == null || toDay <= fromDay) return {};

  const allIds = properties.map(p => p.id);
  const days = {};
  for (let day = fromDay; day < toDay; day++) {
    days[dateKeyFromKstDay(day)] = {
      checkIns: 0,
      checkOuts: 0,
      checkInPropertyIds: [],
      checkOutPropertyIds: [],
      occupiedPropertyIds: new Set(), // 최종적으로 배열로 바뀜 (아래 마무리 루프)
      occupiedRooms: 0,
      vacantRooms: properties.length,
      vacantPropertyIds: [],
      cleaningItems: [],
    };
  }

  for (const property of properties) {
    for (const reservation of (property.reservations ?? [])) {
      const checkIn = asDate(reservation.checkIn);
      const checkOut = asDate(reservation.checkOut);
      // 퇴실은 퇴실 시각만 있으면 센다 — 레포트 퇴실예정(countWeekCheckOuts)·청소 집계(summarizeFutureCleaning)와 같은 기준
      // 같은 숙소·같은 날의 예약 여러 건(중복)은 입실·퇴실 1건 — 레포트(countWeekCheckIns/Outs)와 같은 기준(DEC-05)
      if (isCheckOutInRange(checkOut, from, to)) {
        const day = days[toKstDateKey(checkOut)];
        if (day && !day.checkOutPropertyIds.includes(property.id)) { day.checkOuts += 1; day.checkOutPropertyIds.push(property.id); }
      }
      if (!checkIn || !checkOut) continue;

      if (checkIn >= from && checkIn < to) {
        const day = days[toKstDateKey(checkIn)];
        if (day && !day.checkInPropertyIds.includes(property.id)) { day.checkIns += 1; day.checkInPropertyIds.push(property.id); }
      }

      const occupiedFrom = Math.max(fromDay, kstDayIndex(checkIn));
      const occupiedTo = Math.min(toDay, kstDayIndex(checkOut));
      for (let day = occupiedFrom; day < occupiedTo; day++) {
        days[dateKeyFromKstDay(day)]?.occupiedPropertyIds.add(property.id);
      }
    }
  }

  // 청소 작업도 퇴실과 같은 구간만 — 이번달은 구간이 "지금"부터라, 오늘 이미 지난 퇴실의 작업이 오늘 칸에 남으면
  // 퇴실 수는 줄었는데 배정완료만 남는다
  for (const item of cleaningItems) {
    if (!isCheckOutInRange(asDate(item.checkout_at), from, to)) continue;
    const key = toKstDateKey(item.checkout_at);
    if (days[key]) days[key].cleaningItems.push(item);
  }

  for (const day of Object.values(days)) {
    const occupiedSet = day.occupiedPropertyIds;
    day.occupiedRooms = occupiedSet.size;
    day.vacantRooms = Math.max(0, properties.length - occupiedSet.size);
    // Set → 배열, properties 원래 순서로 (표시 순서를 ListView와 맞춘다)
    day.occupiedPropertyIds = allIds.filter(id => occupiedSet.has(id));
    day.vacantPropertyIds   = allIds.filter(id => !occupiedSet.has(id));
  }
  return days;
}

// 서버 SQL(api/cleaning/[...slug].js)과 같은 분류 — "아직 자동으로 진행 중"인 상태들
const REQUESTING_CLEANING_STATUSES = new Set([
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED',
]);

// 같은 숙소·같은 날 청소 작업이 여럿이면 퇴실과 맞추는 하나 — 배정완료 > 요청중 > 배정 실패 > 취소
function cleaningRank(item) {
  if (item.status === 'ASSIGNED' || item.status === 'COMPLETED') return 0;
  if (REQUESTING_CLEANING_STATUSES.has(item.status)) return 1;
  if (item.status === 'ESCALATED') return 2;
  if (item.status === 'CANCELLED') return 3;
  return 4;
}

// 퇴실과 맞지 않는 작업 중 아직 살아 있는 것 — 담당자에게 요청이 나가거나(요청중·배정 실패 후 재시도) 담당자가 올 수
// 있다(배정완료). 발송은 예약이 남아 있는지 확인하지 않는다(RF-16). 취소·완료된 작업은 더 일어날 일이 없어 뺀다.
function isLiveCleaningJob(item) {
  return item.status === 'ASSIGNED' || item.status === 'ESCALATED' || REQUESTING_CLEANING_STATUSES.has(item.status);
}

/**
 * 하루치 청소 아이템을 배정완료/배정요청중/수동배정필요/청소계획없음/퇴실없는청소로 나눈다.
 * FutureMatrixPanel(D-019)과 같은 규칙 — 수동배정 필요 = 배정 실패(ESCALATED) + 배정 요청 필요(CANCELLED).
 *
 * "청소계획없음"(noJob) — 그날 체크아웃하는 숙소(checkOutPropertyIds)인데 청소 잡 자체가 없는 것.
 * 이걸 빼면 "퇴실 6건인데 배정완료 1건"처럼 나머지 5건이 어디에도 안 잡히는 문제가 생긴다(사용자 지적).
 *
 * 퇴실 하나에 청소 작업 하나를 맞춘다(DEC-05) — 그래서 배정완료 + 배정요청중 + 수동배정필요 + 청소계획없음 = 그날 퇴실 수.
 * "퇴실없는청소"(orphan) — 손님이 날짜를 바꾸거나 취소해도 동기화가 옛 작업을 지우지 않아 남은 작업(RF-16), 또는 같은 날
 * 이미 맞춘 작업 외에 하나 더 있는 작업. 배정 숫자에 섞으면 "준비됐다"로 잘못 보이고, 숨기면 엉뚱한 날의 요청·출동이
 * 안 보인다 — 살아 있는 것만 따로 담는다(orphanReason: 'noCheckout' | 'sameDay').
 *
 * @param {object[]} cleaningItems       하루치 cleaningItems (status, property_id 포함)
 * @param {string[]|null} [checkOutPropertyIds]  그날 체크아웃하는 숙소 ID. 주지 않으면(과거 호출) 상태로만 나눈다
 * @returns {{ assigned: object[], requesting: object[], manual: object[], noJob: string[], orphan: object[] }}
 */
export function classifyDayCleaningItems(cleaningItems = [], checkOutPropertyIds = null) {
  const assigned = [];
  const requesting = [];
  const manual = [];
  const put = item => {
    const rank = cleaningRank(item);
    if (rank === 0) assigned.push(item);
    else if (rank === 1) requesting.push(item);
    else if (rank === 2 || rank === 3) manual.push(item);
  };
  if (checkOutPropertyIds == null) {
    cleaningItems.forEach(put);
    return { assigned, requesting, manual, noJob: [], orphan: [] };
  }

  const jobsByProperty = new Map();
  for (const item of cleaningItems) {
    if (!jobsByProperty.has(item.property_id)) jobsByProperty.set(item.property_id, []);
    jobsByProperty.get(item.property_id).push(item);
  }
  const checkOutIds = [...new Set(checkOutPropertyIds)];
  const noJob = [];
  const orphan = [];
  for (const propertyId of checkOutIds) {
    const jobs = jobsByProperty.get(propertyId);
    if (!jobs?.length) { noJob.push(propertyId); continue; }
    const [matched, ...extra] = [...jobs].sort((a, b) => cleaningRank(a) - cleaningRank(b));
    // 알 수 없는 상태뿐이면 쓸 수 있는 청소 계획이 없는 것 — 어느 칸에도 안 들어가 퇴실이 사라지지 않게 청소 계획 없음으로
    if (cleaningRank(matched) > 3) noJob.push(propertyId);
    else put(matched);
    orphan.push(...extra.filter(isLiveCleaningJob).map(item => ({ ...item, orphanReason: 'sameDay' })));
  }
  const checkingOut = new Set(checkOutIds);
  for (const [propertyId, jobs] of jobsByProperty) {
    if (checkingOut.has(propertyId)) continue;
    orphan.push(...jobs.filter(isLiveCleaningJob).map(item => ({ ...item, orphanReason: 'noCheckout' })));
  }
  return { assigned, requesting, manual, noJob, orphan };
}

/**
 * 기간 전체의 청소 배정 현황 — 레포트 [예정](FutureMatrixPanel)이 캘린더 날짜 칸과 같은 규칙을 쓰도록,
 * 퇴실 날짜(KST)마다 classifyDayCleaningItems 로 나눈 결과를 더한다(ACT-14). 그래서 레포트 숫자가 같은 기간의
 * 캘린더 칸 합계와 같고, 퇴실마다 청소 작업이 하나씩 있으면 배정완료 + 미배정 = 퇴실예정이 된다.
 *
 * 퇴실과 청소 작업은 숙소 + 퇴실 날짜로 맞춘다 — 숙소만으로 기간 전체를 맞추면 같은 숙소의 다른 날 작업이
 * 청소 계획 없는 퇴실을 가린다. 날짜 칸을 미리 만들지 않으므로 "다음 1시간"처럼 하루 안에서 끝나는 기간도 센다.
 * 퇴실과 청소 작업 모두 퇴실 시각이 [from, to) 안인 것만 센다(캘린더 칸·퇴실예정과 같은 기준) — 서버가 작업을 받은
 * 시각과 화면의 "지금"이 달라도, 이미 지난 퇴실의 작업이 배정완료에 남지 않는다.
 * 같은 숙소·같은 날의 퇴실은 1건(DEC-05, 레포트 퇴실예정·캘린더 칸과 같은 기준)이고, 퇴실과 맞지 않는 살아 있는 작업은
 * orphan 으로 따로 돌려준다 — 그래서 배정완료 + 미배정(요청중 + 수동배정 필요 + 청소 계획 없음) = 퇴실예정.
 *
 * @param {Array<{ id: string, reservations?: object[] }>} properties  범위 안 숙소
 * @param {{ from: Date|string, to: Date|string }} range  [from, to) — 퇴실예정과 같은 구간
 * @param {object[]} cleaningItems  같은 구간의 청소 작업(/api/cleaning/stats items)
 * @returns {{ assigned: object[], requesting: object[], manual: object[],
 *             noJob: Array<{ property_id: string, checkout_at: string }>, orphan: object[] } | null}
 */
export function summarizeFutureCleaning(properties = [], range, cleaningItems = []) {
  const from = asDate(range?.from);
  const to = asDate(range?.to);
  if (!from || !to || to <= from) return null;

  const days = new Map();
  const dayOf = key => {
    if (!days.has(key)) days.set(key, { items: [], checkOutAt: new Map() });
    return days.get(key);
  };
  for (const property of properties) {
    for (const reservation of (property.reservations ?? [])) {
      const checkOut = asDate(reservation.checkOut);
      if (!isCheckOutInRange(checkOut, from, to)) continue;
      const day = dayOf(toKstDateKey(checkOut));
      if (!day.checkOutAt.has(property.id)) day.checkOutAt.set(property.id, checkOut.toISOString());
    }
  }
  for (const item of cleaningItems) {
    const checkOut = asDate(item.checkout_at);
    if (isCheckOutInRange(checkOut, from, to)) dayOf(toKstDateKey(checkOut)).items.push(item);
  }

  const summary = { assigned: [], requesting: [], manual: [], noJob: [], orphan: [] };
  for (const key of [...days.keys()].sort((a, b) => a.localeCompare(b))) {
    const day = days.get(key);
    const classified = classifyDayCleaningItems(day.items, [...day.checkOutAt.keys()]);
    summary.assigned.push(...classified.assigned);
    summary.requesting.push(...classified.requesting);
    summary.manual.push(...classified.manual);
    summary.orphan.push(...classified.orphan);
    // noJob 은 숙소 id 목록 — 그날 그 숙소의 퇴실 시각을 붙여 목록에 날짜를 보여줄 수 있게 한다
    summary.noJob.push(...classified.noJob.map(propertyId => ({ property_id: propertyId, checkout_at: day.checkOutAt.get(propertyId) })));
  }
  return summary;
}

/** 단일 숙소의 다음달 예약을 달력 막대로 그릴 구간. */
export function buildFutureReservationSegments(property, range) {
  if (!property || !range?.from || !range?.to) return [];
  const from = asDate(range.from);
  const to = asDate(range.to);
  return (property.reservations ?? []).flatMap((reservation) => {
    const checkIn = asDate(reservation.checkIn);
    const checkOut = asDate(reservation.checkOut);
    if (!checkIn || !checkOut) return [];
    const start = new Date(Math.max(from.getTime(), checkIn.getTime()));
    const end = new Date(Math.min(to.getTime(), checkOut.getTime()));
    if (end <= start) return [];
    return [{ mainStatus: 'OCCUPIED', start, end, isFuture: true }];
  });
}

function nextStateForEvent(state, type) {
  if (ANCHOR_EVENT_STATES[type]) return { ...ANCHOR_EVENT_STATES[type] };
  if (state && FOLLOW_EVENT_TYPES.includes(type) && isValidTransition(state, type)) {
    return getNextRoomState(state, type);
  }
  return state;
}

/**
 * 월 시작 전 마지막 anchor부터 월 안의 상태 이벤트를 재생해 실제 상태 구간을 만든다.
 * events는 시간 오름차순/내림차순 어느 쪽이든 허용한다.
 */
export function buildStateSegmentsFromEvents(events = [], range, now = new Date()) {
  if (!range?.from || !range?.to) return [];
  const from = asDate(range.from);
  const rangeTo = asDate(range.to);
  const capTo = new Date(Math.min(rangeTo.getTime(), asDate(now).getTime()));
  if (capTo <= from) return [];

  const sorted = [...events]
    .map(event => ({ ...event, at: asDate(event.device_time) }))
    .filter(event => event.at)
    .sort((a, b) => a.at - b.at);

  let state = null;
  let cursor = from;
  const segments = [];

  for (const event of sorted) {
    if (event.at > capTo) break;
    if (event.at < from) {
      state = nextStateForEvent(state, event.type);
      continue;
    }

    const next = nextStateForEvent(state, event.type);
    const changed = next !== state
      && (!state || next.mainStatus !== state.mainStatus || next.subStatus !== state.subStatus);
    if (!changed) continue;

    if (state && event.at > cursor) {
      segments.push({ ...state, start: new Date(cursor), end: new Date(event.at), isFuture: false });
    }
    state = next;
    cursor = event.at > from ? event.at : from;
  }

  if (state && capTo > cursor) {
    segments.push({ ...state, start: new Date(cursor), end: capTo, isFuture: false });
  }
  return segments;
}
