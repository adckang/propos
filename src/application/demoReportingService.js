/**
 * 데모 레포트의 단일 정본.
 *
 * Vite 로컬 전용 스텁에 흩어져 있던 데이터를 순수 함수로 모았다. 로컬과 demo 배포는
 * 이 모듈을 똑같이 호출한다. 이 데이터는 Postgres/Google Calendar/알림 시스템에 쓰지 않는다.
 */

import { PROPERTIES as DEMO_PROPERTIES } from '../data/roomStateMockData.js';
import { countCurrentStats } from '../domain/reportingDomain.js';
import {
  describePeriod,
  monthsAgoRange,
  periodForOffset,
  periodToDateRange,
  periodToRemainingRange,
} from '../domain/periodDomain.js';
import { summarizeOperationalMetrics } from '../domain/operationalMetricsDomain.js';
import { buildMonthlyInsights, buildWeeklyInsights } from '../domain/insightDomain.js';
import { toKstDateKey } from '../domain/monthlyCalendarDomain.js';

export const DEMO_PROPERTY_IDS = Object.freeze(DEMO_PROPERTIES.map(property => property.id));

function makeDemoScope(selectedIds) {
  const totalProperties = DEMO_PROPERTIES.length;
  const rooms = DEMO_PROPERTIES
    .map((property, index) => ({ property, index }))
    .filter(({ property }) => !selectedIds || selectedIds.includes(property.id));
  const keyOffset = key => [...String(key)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % totalProperties;
  const share = (value, index, offset) => Math.floor((value + (totalProperties - 1 - ((index + offset) % totalProperties))) / totalProperties);
  const scale = (value, offset = 0) => rooms.reduce((sum, { index }) => sum + share(value, index, offset), 0);
  const scaleAll = base => Object.fromEntries(Object.entries(base).map(([key, value]) => [key, scale(value, keyOffset(key))]));
  return { rooms, scale, scaleAll };
}

const MONTHLY_DEMO_ISSUE_TEMPLATES = [
  { propertyIndex: 0,  day: 3,  hour: 11, category: 'OCCUPIED',       type: 'complaint_detected',                     label: '민원 발생' },
  { propertyIndex: 2,  day: 7,  hour: 15, category: 'CLEANING',       type: 'cleaning_time_exceeded',                 label: '청소 시간 3시간 초과' },
  { propertyIndex: 2,  day: 14, hour: 16, category: 'CLEANING',       type: 'cleaning_time_exceeded',                 label: '청소 시간 3시간 초과' },
  { propertyIndex: 6,  day: 7,  hour: 18, category: 'VACANT',         type: 'vacant_energy_waste_detected',           label: '공실 중 에너지 낭비' },
  { propertyIndex: 11, day: 12, hour: 9,  category: 'PRE_STAY_READY', type: 'pre_stay_optimization_failed',            label: '입실전 숙소 최적화 미완료' },
  { propertyIndex: 17, day: 18, hour: 22, category: 'OCCUPIED',       type: 'energy_waste_detected',                  label: '체류 중 에너지 낭비' },
  { propertyIndex: 4,  day: 20, hour: 12, category: 'CLEANING',       type: 'post_checkout_energy_waste_detected',    label: '퇴실 후 청소 전 에너지 낭비' },
  { propertyIndex: 5,  day: 20, hour: 13, category: 'CLEANING',       type: 'post_checkout_security_breach_detected', label: '퇴실 후 청소 전 보안 문제' },
  { propertyIndex: 7,  day: 24, hour: 16, category: 'VACANT',         type: 'post_cleaning_security_breach_detected', label: '청소 후 공실 보안 문제' },
  { propertyIndex: 8,  day: 26, hour: 11, category: 'CLEANING',       type: 'cleaning_assignment_issue',              label: '청소 미배정' },
];

function demoMonthRange(period, now = new Date()) {
  const monthOffset = period === 'last_month' ? 1 : period === 'this_month' ? 0 : period === 'next_month' ? -1 : null;
  if (monthOffset === null) {
    throw new Error(`지원하지 않는 월간 period: ${period}`);
  }
  const { from, to } = monthsAgoRange(monthOffset, now.getTime());
  return { from, to };
}

function monthlyDemoIssues(period, selectedIds = null, now = new Date()) {
  if (period === 'next_month') return [];
  const { from } = demoMonthRange(period, now);
  return MONTHLY_DEMO_ISSUE_TEMPLATES
    .map(template => {
      const property = DEMO_PROPERTIES[template.propertyIndex];
      return {
        property_id: property.id,
        occurred_at: new Date(from.getTime() + ((template.day - 1) * 24 + template.hour) * 3_600_000).toISOString(),
        category: template.category,
        type: template.type,
        label: template.label,
        resolved_at: null,
        detail: {},
        data_origin: 'DEMO',
      };
    })
    .filter(item => (!selectedIds || selectedIds.includes(item.property_id))
      && (period !== 'this_month' || new Date(item.occurred_at) <= now));
}

function alignMonthlyStatsWithIssues(stats, issues) {
  const count = type => issues.filter(item => item.type === type).length;
  const anomalies = count('complaint_detected') + count('energy_waste_detected');
  const preStayFailures = count('pre_stay_optimization_failed');
  const cleaningTimeFailures = count('cleaning_time_exceeded');
  const assignmentFailures = count('cleaning_assignment_issue');
  const preStayAttempts = Math.max(stats.preStayAttempts ?? 0, preStayFailures);
  const cleaningFinished = Math.max(stats.cleaningFinished ?? 0, cleaningTimeFailures);
  const cleaningCreated = Math.max(stats.cleaningCreated ?? 0, assignmentFailures);
  return {
    ...stats,
    anomalies,
    energyWaste: count('energy_waste_detected'),
    noShowSuspected: count('no_show_suspected'),
    earlyCheckinSuspected: count('early_checkin_suspected'),
    checkoutConfirmationNeeded: count('checkout_confirmation_needed'),
    vacantEnergyWaste: count('vacant_energy_waste_detected'),
    postCheckoutEnergyWaste: count('post_checkout_energy_waste_detected'),
    postCheckoutSecurityBreach: count('post_checkout_security_breach_detected'),
    postCleaningSecurityBreach: count('post_cleaning_security_breach_detected'),
    preStayAttempts,
    preStayOptimized: Math.max(0, preStayAttempts - preStayFailures),
    cleaningFinished,
    cleaningOnTime: Math.max(0, cleaningFinished - cleaningTimeFailures),
    cleaningCreated,
    cleaningAssigned: Math.max(0, cleaningCreated - assignmentFailures),
  };
}

const DEMO_METRIC_META = Object.freeze({
  cleaning_time: { label: '청소시간 준수', eventType: 'cleaning_time_exceeded' },
  post_checkout_energy: { label: '퇴실 후 절전', eventType: 'post_checkout_energy_waste_detected' },
  post_checkout_security: { label: '퇴실 후 보안', eventType: 'post_checkout_security_breach_detected' },
  vacant_energy: { label: '빈방 절전 유지', eventType: 'vacant_energy_waste_detected' },
  post_cleaning_security: { label: '청소 후 보안', eventType: 'post_cleaning_security_breach_detected' },
  pre_stay_optimization: { label: '게스트 맞이 준비', eventType: 'pre_stay_optimization_failed' },
});

function demoPropertyMetricRows(metricItems) {
  const counts = new Map();
  for (const { property_id: propertyId, metricKey } of metricItems) {
    const key = `${propertyId}|${metricKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, failCount]) => {
    const [propertyId, metricKey] = key.split('|');
    return {
      propertyId,
      propertyName: DEMO_PROPERTIES.find(property => property.id === propertyId)?.name ?? propertyId,
      metricKey,
      metricLabel: DEMO_METRIC_META[metricKey].label,
      failCount,
    };
  });
}

function demoMonthlyInsights(period, nowMs, selectedIds) {
  const baseOffset = period === 'last_month' ? 1 : 0;
  const reportPeriod = monthsAgoRange(baseOffset, nowMs).monthKey;
  const issues = monthlyDemoIssues(period, selectedIds, new Date(nowMs));
  const metricItems = Object.entries(DEMO_METRIC_META).flatMap(([metricKey, meta]) =>
    issues.filter(issue => issue.type === meta.eventType).map(issue => ({ ...issue, metricKey }))
  );
  const propertyMetricRows = demoPropertyMetricRows(metricItems);
  return buildMonthlyInsights({ propertyMetricRows, currentAgg: [], previousAgg: [], periodHistory: [] }, reportPeriod)
    .map(insight => ({ ...insight, periodKey: period, dataOrigin: 'DEMO' }));
}

function demoWeeklyInsights(period, nowMs, selectedIds) {
  const baseOffset = period === 'last_week' ? 1 : 0;
  const reportPeriod = toKstDateKey(periodToDateRange(periodForOffset('week', -baseOffset), nowMs).from);
  const drilldowns = demoDrilldownItems(period, new Date(nowMs));
  const metricItems = Object.keys(DEMO_METRIC_META).flatMap(metricKey =>
    (drilldowns[metricKey] ?? [])
      .filter(item => !selectedIds || selectedIds.includes(item.property_id))
      .map(item => ({ ...item, metricKey }))
  );
  const propertyMetricRows = demoPropertyMetricRows(metricItems);
  return buildWeeklyInsights({ propertyMetricRows, currentAgg: [], previousAgg: [], periodHistory: [] }, reportPeriod)
    .map(insight => ({ ...insight, periodKey: period, dataOrigin: 'DEMO' }));
}

export function getDemoStats(period, { propertyIds = null, now = new Date() } = {}) {
  const { rooms, scale, scaleAll } = makeDemoScope(propertyIds);
  const currentStats = countCurrentStats(rooms.map(({ property }) => property.currentState));
  const pastStats = scaleAll({
    checkIns: 14, checkOuts: 12, anomalies: 3, energyWaste: 1,
    noShowSuspected: 1, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0,
    vacantEnergyWaste: 3, vacantEnergyResolved: 3,
    preStayAttempts: 12, preStayOptimized: 11,
    cleaningFinished: 12, cleaningOnTime: 10,
    cleaningAssigned: 12, cleaningCreated: 12,
    postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1, postCleaningSecurityBreach: 1,
  });
  const futureStats = scaleAll({
    checkIns: 8, checkOuts: 6, anomalies: 0, energyWaste: 0,
    noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0,
  });
  const activeStats = scaleAll({
    checkOuts: 6, anomalies: 1, preStayAttempts: 8, preStayOptimized: 7,
    cleaningFinished: 6, cleaningOnTime: 5,
    cleaningAssigned: 5, cleaningCreated: 6,
    vacantEnergyWaste: 1, postCheckoutEnergyWaste: 1,
    postCheckoutSecurityBreach: 0, postCleaningSecurityBreach: 0,
    checkIns: 5,
  });
  const selectionLabel = propertyIds ? `${rooms.length}개 숙소` : '전체 숙소';
  const summaries = {
    now: `현재 ${selectionLabel} 중 ${currentStats.anomalyCount}개 이상 징후가 확인됐어요.`,
    today: `현재 ${selectionLabel} 중 ${currentStats.anomalyCount}개 이상 징후가 확인됐어요.`,
    next_week: `다음 주 ${selectionLabel} 체크인 ${scale(8)}건 예정이에요.`,
    tomorrow: `내일 ${selectionLabel} 체크인 ${scale(8)}건 예정이에요.`,
    next_hour: `1시간 내 ${selectionLabel} 체크인 ${scale(1)}건 예정이에요.`,
  };
  const descriptor = describePeriod(period);
  const isLive = ['now', 'today'].includes(period);
  const isActive = descriptor?.tense === 'active' && !isLive;
  const isFuture = descriptor?.tense === 'future';
  const baseStats = isLive ? currentStats : isActive ? activeStats : isFuture ? futureStats : pastStats;
  const monthIssues = descriptor?.unit === 'month' ? monthlyDemoIssues(period, propertyIds, now) : [];
  const stats = descriptor?.unit === 'month' && !isFuture
    ? alignMonthlyStatsWithIssues(baseStats, monthIssues)
    : baseStats;
  let summary = !isLive && !isFuture ? summarizeOperationalMetrics(period, stats) : null;
  if (summary == null) summary = summaries[period];
  if (summary === undefined && descriptor) {
    summary = isFuture
      ? `${descriptor.label} ${selectionLabel} 체크인 ${stats.checkIns}건 예정이에요.`
      : stats.anomalies > 0
        ? `${descriptor.label} ${selectionLabel} 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`
        : `${descriptor.label} ${selectionLabel} 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
  }
  const insights = period === 'this_month' || period === 'last_month'
    ? demoMonthlyInsights(period, now.getTime(), propertyIds)
    : period === 'this_week' || period === 'last_week'
      ? demoWeeklyInsights(period, now.getTime(), propertyIds)
      : undefined;
  return { period, stats, summary: summary ?? '', ...(insights ? { insights } : {}), dataProfile: 'demo' };
}

export function getDemoMonthlyCalendar(period, { propertyIds = null, now = new Date() } = {}) {
  const { from, to } = demoMonthRange(period, now);
  const items = monthlyDemoIssues(period, propertyIds, now);
  const days = {};
  for (const item of items) {
    const key = toKstDateKey(item.occurred_at);
    if (!days[key]) days[key] = { total: 0, categories: {}, items: [] };
    days[key].total += 1;
    days[key].categories[item.category] = (days[key].categories[item.category] ?? 0) + 1;
    days[key].items.push(item);
  }
  return {
    period,
    range: { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() },
    days,
    items,
    stateSegments: [],
    dataProfile: 'demo',
  };
}

const METRIC_TO_MONTHLY_TYPE = Object.freeze({
  cleaning_time: 'cleaning_time_exceeded',
  post_checkout_energy: 'post_checkout_energy_waste_detected',
  post_checkout_security: 'post_checkout_security_breach_detected',
  vacant_energy: 'vacant_energy_waste_detected',
  post_cleaning_security: 'post_cleaning_security_breach_detected',
  pre_stay_optimization: 'pre_stay_optimization_failed',
});

function pointInRange(range, fraction) {
  return new Date(range.from.getTime() + (range.to.getTime() - range.from.getTime()) * fraction);
}

function demoDrilldownItems(period, now) {
  const range = periodToDateRange(period, now.getTime());
  const at = fraction => pointInRange(range, fraction).toISOString();
  const all = {
    cleaning_time: [
      { property_id: 'P012', occurred_at: at(0.35), detail: { duration_hours: 3.8, started_at: at(0.31), finished_at: at(0.35), limit_hours: 3 } },
      { property_id: 'P013', occurred_at: at(0.55), detail: { duration_hours: 4.2, started_at: at(0.50), finished_at: at(0.55), limit_hours: 3 } },
      { property_id: 'P014', occurred_at: at(0.68), detail: { duration_hours: 3.1, started_at: at(0.64), finished_at: at(0.68), limit_hours: 3 } },
      { property_id: 'P009', occurred_at: at(0.82), detail: { duration_hours: 5.5, started_at: at(0.75), finished_at: at(0.82), limit_hours: 3 } },
    ],
    post_checkout_energy: [
      { property_id: 'P014', occurred_at: at(0.42), detail: { anchor_at: at(0.41) } },
      { property_id: 'P008', occurred_at: at(0.72), detail: { anchor_at: at(0.70), reason: '거실 에어컨·조명 켜짐' } },
    ],
    post_checkout_security: [{ property_id: 'P009', occurred_at: at(0.61), detail: { anchor_at: at(0.60) } }],
    vacant_energy: [
      { property_id: 'P010', occurred_at: at(0.30), detail: { resolved_at: at(0.34) } },
      { property_id: 'P011', occurred_at: at(0.48), detail: { resolved_at: at(0.50) } },
      { property_id: 'P015', occurred_at: at(0.66), detail: { resolved_at: at(0.67) } },
      { property_id: 'P016', occurred_at: at(0.86), detail: {} },
    ],
    post_cleaning_security: [{ property_id: 'P016', occurred_at: at(0.58), detail: { anchor_at: at(0.57) } }],
    pre_stay_optimization: [{ property_id: 'P012', occurred_at: at(0.25), detail: {} }],
  };
  const active = describePeriod(period)?.tense === 'active';
  return active ? {
    cleaning_time: all.cleaning_time.slice(0, 1),
    post_checkout_energy: all.post_checkout_energy.slice(0, 1),
    post_checkout_security: [],
    vacant_energy: all.vacant_energy.slice(0, 1),
    post_cleaning_security: [],
    pre_stay_optimization: all.pre_stay_optimization,
  } : {
    ...all,
    cleaning_time: all.cleaning_time.slice(0, 2),
    vacant_energy: all.vacant_energy.slice(0, 3),
  };
}

export function getDemoDrilldown(metric, period, { propertyIds = null, now = new Date() } = {}) {
  const isMonthly = period === 'last_month' || period === 'this_month';
  const items = (isMonthly
    ? monthlyDemoIssues(period, propertyIds, now).filter(item => item.type === METRIC_TO_MONTHLY_TYPE[metric])
    : (demoDrilldownItems(period, now)[metric] ?? []).filter(item => !propertyIds || propertyIds.includes(item.property_id)))
    .map(item => ({ ...item, data_origin: 'DEMO' }));
  return { metric, period, failCount: items.length, items, dataProfile: 'demo' };
}

export function getDemoCleaningStats(period, { propertyIds = null, withItems = false, now = new Date() } = {}) {
  const { rooms } = makeDemoScope(propertyIds);
  const range = periodToRemainingRange(period, now.getTime());
  if (!range) throw new Error(`지원하지 않는 period: ${period}`);
  const cleanerNames = ['김민지', '박서준', '이하은', '최지훈'];
  const statusTable = [
    { upTo: 80, status: 'ASSIGNED' },
    { upTo: 90, status: 'PENDING' },
    { upTo: 95, status: 'ESCALATED' },
    { upTo: 100, status: 'CANCELLED' },
  ];
  const roll100 = value => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    return hash % 100;
  };
  let slot = 0;
  const items = rooms.flatMap(({ property }) => {
    // 운영 DB의 UNIQUE(property_id, checkout_at)와 같은 규칙으로 중복 예약 원본을 한 잡으로 접는다.
    const seenCheckouts = new Set();
    const checkouts = (property.reservations ?? [])
      .map(reservation => reservation.checkOut instanceof Date ? reservation.checkOut : new Date(reservation.checkOut))
      .filter(checkoutAt => checkoutAt >= range.from && checkoutAt < range.to)
      .sort((left, right) => left - right)
      .filter(checkoutAt => {
        const key = checkoutAt.toISOString();
        if (seenCheckouts.has(key)) return false;
        seenCheckouts.add(key);
        return true;
      });
    return checkouts.map(checkoutAt => {
      const roll = roll100(`${property.id}|${checkoutAt.toISOString()}`);
      const status = statusTable.find(({ upTo }) => roll < upTo).status;
      const item = {
        property_id: property.id,
        property_name: property.name,
        status,
        checkout_at: checkoutAt.toISOString(),
        updated_at: new Date(now.getTime() - (slot % 5 + 1) * 3_600_000).toISOString(),
        notified_count: status === 'ESCALATED' ? 3 + (slot % 3) : 0,
        declined_count: status === 'ESCALATED' ? slot % 3 : 0,
        cleaner_name: status === 'ASSIGNED' || status === 'COMPLETED' ? cleanerNames[slot % cleanerNames.length] : null,
        data_origin: 'DEMO',
      };
      slot += 1;
      return item;
    });
  });
  const assigned = items.filter(item => item.status === 'ASSIGNED').length;
  const requesting = items.filter(item => item.status === 'PENDING').length;
  const failed = items.filter(item => item.status === 'ESCALATED').length;
  const needsRequest = items.filter(item => item.status === 'CANCELLED').length;
  const base = {
    total: assigned + requesting + failed,
    assigned,
    requesting,
    failed,
    needsRequest,
    unassigned: requesting + failed,
    dataProfile: 'demo',
  };
  if (!withItems) return base;
  return {
    ...base,
    items,
    failedItems: items.filter(item => item.status === 'ESCALATED'),
    needsRequestItems: items.filter(item => item.status === 'CANCELLED'),
  };
}

export function getDemoPropertyConfigs() {
  return DEMO_PROPERTIES.map(property => ({
    property_id: property.id,
    name: property.name,
    checkout_hour: property.checkOutHour ?? 11,
    cleaning_duration_hours: property.cleaningDurationHours ?? 2.5,
    google_calendar_id: null,
    google_calendar_booking_url: null,
    host_phone: null,
    ical_url: null,
    data_origin: 'DEMO',
  }));
}
