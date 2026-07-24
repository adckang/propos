/**
 * s22 — 모바일 UI 로직 단위 테스트
 *
 * React 컴포넌트 렌더링 없이 테스트 가능한 순수 함수들을 검증:
 * - 이상 감지 (anomaly detection)
 * - miniDays 배열 생성
 * - miniNowLeft 계산
 * - 오늘 세그먼트 필터링 (todaySegs)
 * - 대시보드 counts 집계
 * - 서브상태 urgency 감지
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── 이상 감지 로직 (PropertyDetailView에서 추출) ─────────────────────────────

const SENSOR_WARN = {
  temp:     [27, 99],
  humidity: [70, 99],
  noise:    [75, 99],
  power:    [2000, 99999],
  co2:      [1000, 9999],
};

function isWarn(key, val) {
  const [lo] = SENSOR_WARN[key] || [Infinity];
  return val >= lo;
}

function getAnomalies(sensorRows) {
  return sensorRows.filter(r => isWarn(r.key, r.val));
}

describe('TC-M-001: 이상 감지 (anomaly detection)', () => {
  test('정상 범위 값은 이상 없음', () => {
    const rows = [
      { key: 'temp', val: 24.5 },
      { key: 'humidity', val: 60 },
      { key: 'noise', val: 50 },
      { key: 'power', val: 800 },
      { key: 'co2', val: 700 },
    ];
    assert.equal(getAnomalies(rows).length, 0);
  });

  test('임계값 경계: val === lo 이면 이상 감지', () => {
    assert.ok(isWarn('temp', 27));
    assert.ok(isWarn('humidity', 70));
    assert.ok(isWarn('noise', 75));
    assert.ok(isWarn('power', 2000));
    assert.ok(isWarn('co2', 1000));
  });

  test('임계값 바로 아래는 정상', () => {
    assert.ok(!isWarn('temp', 26.9));
    assert.ok(!isWarn('humidity', 69));
    assert.ok(!isWarn('noise', 74));
    assert.ok(!isWarn('power', 1999));
    assert.ok(!isWarn('co2', 999));
  });

  test('여러 이상값 감지', () => {
    const rows = [
      { key: 'temp', val: 30 },
      { key: 'co2', val: 1500 },
      { key: 'noise', val: 60 },
    ];
    const anomalies = getAnomalies(rows);
    assert.equal(anomalies.length, 2);
    assert.ok(anomalies.some(r => r.key === 'temp'));
    assert.ok(anomalies.some(r => r.key === 'co2'));
  });

  test('energy 키는 warn 기준 없음 → 항상 정상', () => {
    assert.ok(!isWarn('energy', 99999));
  });

  test('알 수 없는 센서 키 → 항상 정상', () => {
    assert.ok(!isWarn('unknown_sensor', 999999));
  });
});

// ── miniDays 배열 생성 (PropertyListView 모바일) ─────────────────────────────

function buildMiniDays(referenceDate) {
  const todayMid = new Date(referenceDate);
  todayMid.setHours(0, 0, 0, 0);
  const miniStart = new Date(todayMid);
  miniStart.setDate(miniStart.getDate() - 2);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(miniStart);
    d.setDate(d.getDate() + i);
    return { date: d.getDate(), isToday: i === 2 };
  });
}

describe('TC-M-002: miniDays 배열 생성', () => {
  test('항상 7개 요소 생성', () => {
    const days = buildMiniDays(new Date());
    assert.equal(days.length, 7);
  });

  test('인덱스 2만 isToday === true', () => {
    const days = buildMiniDays(new Date());
    assert.ok(days[2].isToday);
    assert.ok(!days[0].isToday);
    assert.ok(!days[1].isToday);
    assert.ok(!days[3].isToday);
    assert.ok(!days[6].isToday);
  });

  test('인덱스 2의 date가 오늘 날짜와 일치', () => {
    const now = new Date('2026-07-24T14:00:00');
    const days = buildMiniDays(now);
    assert.equal(days[2].date, 24);
  });

  test('날짜 시퀀스가 연속적이어야 함', () => {
    const now = new Date('2026-07-24T00:00:00');
    const days = buildMiniDays(now);
    // 인덱스 0 = 7/22, 1 = 7/23, 2 = 7/24(today), 3 = 7/25, ...
    assert.equal(days[0].date, 22);
    assert.equal(days[1].date, 23);
    assert.equal(days[2].date, 24);
    assert.equal(days[3].date, 25);
    assert.equal(days[6].date, 28);
  });

  test('월말 경계: 7/30 기준 (7/28~8/3)', () => {
    const now = new Date('2026-07-30T12:00:00');
    const days = buildMiniDays(now);
    assert.equal(days[2].date, 30); // today
    assert.equal(days[3].date, 31);
    assert.equal(days[4].date, 1);  // 8/1 — 날짜가 1로 리셋됨
    assert.equal(days[5].date, 2);
  });
});

// ── miniNowLeft 계산 ──────────────────────────────────────────────────────────

function calcMiniNowLeft(nowMs, miniStartMs, miniEndMs) {
  const miniMs = miniEndMs - miniStartMs;
  return ((nowMs - miniStartMs) / miniMs * 100);
}

describe('TC-M-003: miniNowLeft 위치 계산', () => {
  test('now === miniStart → 0%', () => {
    const base = new Date('2026-07-24T00:00:00').getTime();
    const end  = base + 7 * 86400000;
    assert.equal(calcMiniNowLeft(base, base, end), 0);
  });

  test('now === miniEnd → 100%', () => {
    const base = new Date('2026-07-24T00:00:00').getTime();
    const end  = base + 7 * 86400000;
    assert.equal(calcMiniNowLeft(end, base, end), 100);
  });

  test('now = 오늘 정오 (인덱스 2, day 2/7 + 0.5/7 = 약 35.7%)', () => {
    // miniStart = today - 2days, now = today 12:00
    // 위치 = (2.5 / 7) * 100 = 35.714...%
    const todayMid = new Date('2026-07-24T00:00:00').getTime();
    const miniStart = todayMid - 2 * 86400000;
    const miniEnd   = miniStart + 7 * 86400000;
    const noon      = todayMid + 12 * 3600000;
    const left = calcMiniNowLeft(noon, miniStart, miniEnd);
    assert.ok(Math.abs(left - 35.714) < 0.01, `Expected ~35.71, got ${left}`);
  });

  test('now가 윈도우 밖이어도 계산은 동작함 (클리핑은 렌더러 책임)', () => {
    const base = new Date('2026-07-24T00:00:00').getTime();
    const end  = base + 7 * 86400000;
    const future = end + 86400000; // 1일 뒤
    const left = calcMiniNowLeft(future, base, end);
    assert.ok(left > 100); // >100%지만 계산 자체는 오류 없음
  });
});

// ── 오늘 세그먼트 필터링 (PropertyDetailView 모바일) ─────────────────────────

function filterTodaySegs(recentSegs, referenceDate) {
  const todayMid = new Date(referenceDate);
  todayMid.setHours(0, 0, 0, 0);
  const tomorrowMid = new Date(todayMid.getTime() + 86400000);
  return recentSegs.filter(s => s.start < tomorrowMid && s.end > todayMid);
}

describe('TC-M-004: 오늘 세그먼트 필터링', () => {
  const refDate = new Date('2026-07-24T14:00:00');
  const todayMid = new Date('2026-07-24T00:00:00');
  const tomorrowMid = new Date('2026-07-25T00:00:00');

  const makeSegs = () => [
    // 어제 전체 (오늘과 겹치지 않음)
    { mainStatus: 'VACANT', subStatus: 'NO_RESERVATION', start: new Date('2026-07-23T00:00:00'), end: new Date('2026-07-24T00:00:00') },
    // 자정 전 시작 → 오늘 일부 포함 (겹침)
    { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING', start: new Date('2026-07-23T22:00:00'), end: new Date('2026-07-24T10:00:00') },
    // 오늘 완전히 포함
    { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION', start: new Date('2026-07-24T10:00:00'), end: new Date('2026-07-24T22:00:00') },
    // 오늘 시작 → 내일 끝 (겹침)
    { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING', start: new Date('2026-07-24T22:00:00'), end: new Date('2026-07-25T02:00:00') },
    // 내일 전체 (겹치지 않음)
    { mainStatus: 'VACANT', subStatus: 'NO_RESERVATION', start: new Date('2026-07-25T02:00:00'), end: new Date('2026-07-26T00:00:00') },
  ];

  test('어제만 해당하는 세그는 제외', () => {
    const segs = filterTodaySegs(makeSegs(), refDate);
    const hasYesterday = segs.some(s => s.end.getTime() === todayMid.getTime());
    assert.ok(!hasYesterday, '어제 세그가 포함되지 않아야 함');
  });

  test('내일만 해당하는 세그는 제외', () => {
    const segs = filterTodaySegs(makeSegs(), refDate);
    const hasTomorrow = segs.some(s => s.start.getTime() >= tomorrowMid.getTime());
    assert.ok(!hasTomorrow, '내일 세그가 포함되지 않아야 함');
  });

  test('오늘과 겹치는 세그 3개 반환', () => {
    const segs = filterTodaySegs(makeSegs(), refDate);
    assert.equal(segs.length, 3);
  });

  test('자정에 정확히 끝나는 세그는 오늘에 미포함', () => {
    const seg = { mainStatus: 'VACANT', subStatus: 'NO_RESERVATION',
      start: new Date('2026-07-23T00:00:00'), end: todayMid };
    const segs = filterTodaySegs([seg], refDate);
    assert.equal(segs.length, 0, '자정에 끝나면 오늘 세그가 아님 (end > todayMid 조건)');
  });

  test('자정에 시작하는 세그는 오늘 포함', () => {
    const seg = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',
      start: todayMid, end: new Date('2026-07-24T12:00:00') };
    const segs = filterTodaySegs([seg], refDate);
    assert.equal(segs.length, 1);
  });

  test('recentSegs가 비어있으면 빈 배열', () => {
    assert.deepEqual(filterTodaySegs([], refDate), []);
  });
});

// ── 대시보드 counts 집계 (DashboardView) ─────────────────────────────────────

function buildCounts(properties) {
  const counts = {};
  for (const p of properties) {
    const { mainStatus, subStatus } = p.currentState;
    if (!counts[mainStatus]) counts[mainStatus] = { total: 0, subs: {} };
    counts[mainStatus].total++;
    counts[mainStatus].subs[subStatus] = (counts[mainStatus].subs[subStatus] || 0) + 1;
  }
  return counts;
}

function calcUrgentCount(counts) {
  return (counts['OCCUPIED']?.subs['ISSUE_AND_ENERGY'] || 0)
    + (counts['OCCUPIED']?.subs['ISSUE_COMPLAINT'] || 0)
    + (counts['OCCUPIED']?.subs['ENERGY_WASTE'] || 0);
}

describe('TC-M-005: 대시보드 counts 집계', () => {
  const PROPS = [
    { currentState: { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION'   } },
    { currentState: { mainStatus: 'OCCUPIED',      subStatus: 'ISSUE_COMPLAINT'  } },
    { currentState: { mainStatus: 'OCCUPIED',      subStatus: 'ENERGY_WASTE'     } },
    { currentState: { mainStatus: 'PRE_STAY_READY',subStatus: 'READY'            } },
    { currentState: { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING' } },
    { currentState: { mainStatus: 'VACANT',        subStatus: 'NO_RESERVATION'   } },
    { currentState: { mainStatus: 'VACANT',        subStatus: 'NO_RESERVATION'   } },
  ];

  test('총 카운트가 숙소 수와 일치', () => {
    const counts = buildCounts(PROPS);
    const total = Object.values(counts).reduce((s, v) => s + v.total, 0);
    assert.equal(total, PROPS.length);
  });

  test('OCCUPIED 총계 3, 서브상태 분리', () => {
    const counts = buildCounts(PROPS);
    assert.equal(counts['OCCUPIED'].total, 3);
    assert.equal(counts['OCCUPIED'].subs['GOOD_CONDITION'], 1);
    assert.equal(counts['OCCUPIED'].subs['ISSUE_COMPLAINT'], 1);
    assert.equal(counts['OCCUPIED'].subs['ENERGY_WASTE'], 1);
  });

  test('VACANT 총계 2', () => {
    const counts = buildCounts(PROPS);
    assert.equal(counts['VACANT'].total, 2);
  });

  test('urgentCount: ISSUE_AND_ENERGY + ISSUE_COMPLAINT + ENERGY_WASTE 합산', () => {
    const counts = buildCounts(PROPS);
    // ISSUE_COMPLAINT(1) + ENERGY_WASTE(1) = 2
    assert.equal(calcUrgentCount(counts), 2);
  });

  test('urgentCount: OCCUPIED 없으면 0', () => {
    const counts = buildCounts([
      { currentState: { mainStatus: 'VACANT', subStatus: 'NO_RESERVATION' } },
    ]);
    assert.equal(calcUrgentCount(counts), 0);
  });

  test('urgentCount: ISSUE_AND_ENERGY까지 포함', () => {
    const counts = buildCounts([
      { currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_AND_ENERGY' } },
      { currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_COMPLAINT'  } },
      { currentState: { mainStatus: 'OCCUPIED', subStatus: 'ENERGY_WASTE'     } },
    ]);
    assert.equal(calcUrgentCount(counts), 3);
  });
});

// ── useMobile 훅 — window.innerWidth 로직 추출 ───────────────────────────────

function isMobileWidth(innerWidth, breakpoint = 768) {
  return innerWidth < breakpoint;
}

describe('TC-M-006: useMobile 분기 기준', () => {
  test('767px → 모바일', () => {
    assert.ok(isMobileWidth(767));
  });

  test('768px → 데스크탑 (breakpoint 미만이어야 모바일)', () => {
    assert.ok(!isMobileWidth(768));
  });

  test('375px → 모바일 (iPhone SE)', () => {
    assert.ok(isMobileWidth(375));
  });

  test('1280px → 데스크탑', () => {
    assert.ok(!isMobileWidth(1280));
  });

  test('custom breakpoint 1024px', () => {
    assert.ok(isMobileWidth(1023, 1024));
    assert.ok(!isMobileWidth(1024, 1024));
  });
});
