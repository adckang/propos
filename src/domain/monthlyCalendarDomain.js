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
export function buildIssueItems(events = [], cleaningIssues = []) {
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

  for (const failure of detectPreStayOptimizationFailures(eventsAsc)) {
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
      if (!checkIn || !checkOut) continue;

      if (checkIn >= from && checkIn < to) {
        const key = toKstDateKey(checkIn);
        if (days[key]) { days[key].checkIns += 1; days[key].checkInPropertyIds.push(property.id); }
      }
      if (checkOut >= from && checkOut < to) {
        const key = toKstDateKey(checkOut);
        if (days[key]) { days[key].checkOuts += 1; days[key].checkOutPropertyIds.push(property.id); }
      }

      const occupiedFrom = Math.max(fromDay, kstDayIndex(checkIn));
      const occupiedTo = Math.min(toDay, kstDayIndex(checkOut));
      for (let day = occupiedFrom; day < occupiedTo; day++) {
        days[dateKeyFromKstDay(day)]?.occupiedPropertyIds.add(property.id);
      }
    }
  }

  for (const item of cleaningItems) {
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

/**
 * 하루치 청소 아이템을 배정완료/배정요청중/수동배정필요/청소계획없음으로 나눈다.
 * FutureMatrixPanel(D-019)과 같은 규칙 — 수동배정 필요 = 배정 실패(ESCALATED) + 배정 요청 필요(CANCELLED).
 *
 * "청소계획없음"(noJob) — 그날 체크아웃하는 숙소(checkOutPropertyIds)인데 청소 잡 자체가 없는 것.
 * 이걸 빼면 "퇴실 6건인데 배정완료 1건"처럼 나머지 5건이 어디에도 안 잡히는 문제가 생긴다(사용자 지적).
 * 잡이 아직 하나도 안 만들어졌을 수 있어서(예: MONTHLY_BATCH 발동 전) 배지 숫자(퇴실 수)와
 * 항상 맞아떨어지게 하려면 이 셋째 분류가 반드시 필요하다.
 *
 * @param {object[]} cleaningItems       하루치 cleaningItems (status, property_id 포함)
 * @param {string[]} [checkOutPropertyIds]  그날 체크아웃하는 숙소 ID (buildFutureCalendarDays 결과)
 * @returns {{ assigned: object[], requesting: object[], manual: object[], noJob: string[] }}
 */
export function classifyDayCleaningItems(cleaningItems = [], checkOutPropertyIds = []) {
  const assigned = [];
  const requesting = [];
  const manual = [];
  const coveredIds = new Set();
  for (const item of cleaningItems) {
    coveredIds.add(item.property_id);
    if (item.status === 'ASSIGNED' || item.status === 'COMPLETED') assigned.push(item);
    else if (REQUESTING_CLEANING_STATUSES.has(item.status)) requesting.push(item);
    else if (item.status === 'ESCALATED' || item.status === 'CANCELLED') manual.push(item);
  }
  const noJob = checkOutPropertyIds.filter(id => !coveredIds.has(id));
  return { assigned, requesting, manual, noJob };
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
