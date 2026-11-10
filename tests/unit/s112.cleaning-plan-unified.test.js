/**
 * s112 — ACT-14 레포트·캘린더 청소 미배정 기준 통일
 *
 * 사용자 상황: 대시보드 "다음달"에서 위 레포트의 "미배정"과 아래 캘린더 칸의 "청소 미배정" 합이 달랐다.
 * 캘린더는 퇴실은 있는데 청소 작업 자체가 없는 건(청소 계획 없음)을 미배정에 넣고, 레포트는 뺐다.
 * 승인(2026-11-05): 레포트도 청소 계획 없는 퇴실을 미배정에 넣는다 → 배정완료 + 미배정 = 퇴실예정,
 * 캘린더 합계와도 같다. 같은 청소 데이터는 한 번만 받아 두 곳이 같이 쓴다.
 *
 * 실제 부품(FutureMatrixPanel·MonthlyCalendar)을 같은 고정 데이터로 렌더링해 화면 숫자를 비교한다.
 * 업무 계산을 테스트 안에 복사하지 않는다 — 기대값은 고정 데이터에서 사람이 센 숫자다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PROBE, renderComponent, visibleText } from '../helpers/renderComponent.js';
import { kst, withFrozenNow } from '../helpers/testTime.js';
import { requestFutureCleaningStats, sharesFutureCleaning, stateForRequest } from '../../src/hooks/useFutureCleaningStats.js';
import { countWeekCheckOuts } from '../../src/domain/futureWeekDomain.js';
import { PROPERTIES as DEMO_PROPERTIES } from '../../src/data/roomStateMockData.js';
import { buildFutureCalendarDays, classifyDayCleaningItems, summarizeFutureCleaning } from '../../src/domain/monthlyCalendarDomain.js';
import { buildManualCleaningRows, buildNoJobRows, buildOrphanCleaningRows, SEVERITY } from '../../src/domain/violationDetailDomain.js';

const HOOK = 'src/hooks/useFutureCleaningStats.js';
const NOW = '2026-11-10T12:00'; // 다음달 = 2026-12

const stay = (checkIn, checkOut) => ({ checkIn: kst(checkIn), checkOut: kst(checkOut) });
const job = (property_id, checkout, status) => ({
  property_id, property_name: property_id, checkout_at: kst(checkout).toISOString(), status, data_origin: 'SIMULATED',
});

// 숙소 3곳, 12월 퇴실 6건 — 사람이 센 기대값: 배정완료 1, 배정 요청중 1, 수동배정 필요 2, 청소 계획 없음 2
//   A: 12/3 배정완료, 12/10 청소 작업 없음 ← 같은 숙소의 다른 날 작업이 이 퇴실을 가리면 안 된다
//   B: 12/5 배정 요청중, 12/7 배정 실패
//   C: 12/8 취소된 청소(다시 요청 필요), 12/12 청소 작업 없음
const PROPERTIES = [
  { id: 'A', name: 'A', reservations: [stay('2026-12-01T15:00', '2026-12-03T11:00'), stay('2026-12-08T15:00', '2026-12-10T11:00')] },
  { id: 'B', name: 'B', reservations: [stay('2026-12-03T15:00', '2026-12-05T11:00'), stay('2026-12-05T15:00', '2026-12-07T11:00')] },
  { id: 'C', name: 'C', reservations: [stay('2026-12-06T15:00', '2026-12-08T11:00'), stay('2026-12-10T15:00', '2026-12-12T11:00')] },
];
const IDS = PROPERTIES.map(property => property.id);
const ITEMS = [
  job('A', '2026-12-03T11:00', 'ASSIGNED'),
  job('B', '2026-12-05T11:00', 'PENDING'),
  job('B', '2026-12-07T11:00', 'ESCALATED'),
  job('C', '2026-12-08T11:00', 'CANCELLED'),
];
// 서버 응답 모양 그대로 — 집계 숫자는 넘긴 작업 목록을 사람이 센 고정값 (서버 SQL 과 같은 모양: total 은 취소 제외)
const response = (items, { assigned = 0, requesting = 0, failed = 0, needsRequest = 0 }) => ({
  total: assigned + requesting + failed, assigned, requesting, failed, needsRequest, unassigned: requesting + failed,
  items,
  failedItems: items.filter(item => item.status === 'ESCALATED'),
  needsRequestItems: items.filter(item => item.status === 'CANCELLED'),
});
const RESPONSE = response(ITEMS, { assigned: 1, requesting: 1, failed: 1, needsRequest: 1 });
const ONLY_A_ASSIGNED = response([ITEMS[0]], { assigned: 1 });

function hookReturning(data, calls = []) {
  return {
    [HOOK]: {
      useFutureCleaningStats: (...args) => { calls.push(args); return { data, loading: false, error: null }; },
    },
  };
}

async function renderReport(period, { properties = PROPERTIES, data = RESPONSE, calls } = {}) {
  const rendered = await renderComponent('src/components/v2/reporting/FutureMatrixPanel.jsx',
    { stats: {}, period, properties, propertyIds: properties.map(property => property.id) },
    { replace: hookReturning(data, calls) });
  const text = visibleText(rendered.html);
  const read = label => {
    const match = new RegExp(`(?:^| )${label} (\\S+)건`).exec(text);
    assert.ok(match, `레포트에 "${label}" 줄이 없음: ${text}`);
    return Number(match[1]);
  };
  return { checkOuts: read('퇴실예정'), assigned: read('배정완료'), unassigned: read('미배정'), text };
}

async function renderCalendarCells(statsPeriod, { properties = PROPERTIES, data = RESPONSE, calls } = {}) {
  const rendered = await renderComponent('src/components/v2/reporting/MonthlyCalendar.jsx', {
    statsPeriod, scopedProperties: properties, noSelection: false, properties,
    onSelectProperty() {}, onNavigateToList() {},
    monthlyCalendarState: { data: null, loading: false, error: null },
  }, { replace: hookReturning(data, calls) });
  const sum = pattern => [...rendered.html.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
  return {
    counts: {
      checkOuts: sum(/data-testid="future-checkout-btn" data-value="(\d+)"/g),
      assigned: sum(/data-testid="future-cleaning-assigned" data-value="(\d+)"/g),
      unassigned: sum(/data-testid="future-cleaning-unassigned"[^>]*>청소 미배정 (?:<!-- -->)?(\d+)</g),
    },
    orphan: sum(/data-testid="future-cleaning-orphan" data-value="(\d+)"/g),
  };
}

async function renderCalendar(statsPeriod, options) {
  return (await renderCalendarCells(statsPeriod, options)).counts;
}

/** 레포트의 "퇴실 없는 청소 N건" — 0건이면 줄 자체가 없다(null) */
const reportOrphan = text => {
  const match = /(?:^| )퇴실 없는 청소 (\d+)건/.exec(text);
  return match ? Number(match[1]) : null;
};

describe('A. 레포트 미배정 = 배정 요청중 + 수동배정 필요 + 청소 계획 없음 (ACT-14)', () => {
  test('다음달 레포트: 배정완료 + 미배정 = 퇴실예정', () => withFrozenNow(NOW, async () => {
    const report = await renderReport('next_month');
    assert.deepEqual(report.checkOuts, 6);
    assert.deepEqual({ assigned: report.assigned, unassigned: report.unassigned }, { assigned: 1, unassigned: 5 });
    assert.equal(report.assigned + report.unassigned, report.checkOuts);
  }));

  test('다음달 레포트 숫자 = 같은 달 캘린더 칸 합계 (같은 데이터·같은 규칙)', () => withFrozenNow(NOW, async () => {
    const report = await renderReport('next_month');
    const calendar = await renderCalendar('next_month');
    assert.deepEqual(calendar, { checkOuts: 6, assigned: 1, unassigned: 5 }, '캘린더 칸 합계');
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned }, calendar);
  }));

  test('같은 숙소의 다른 날 청소 작업이 청소 계획 없는 퇴실을 가리지 않는다 (숙소+퇴실 날짜로 맞춤)', () => withFrozenNow(NOW, async () => {
    const onlyA = [PROPERTIES[0]];
    const report = await renderReport('next_month', { properties: onlyA, data: ONLY_A_ASSIGNED });
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned },
      { checkOuts: 2, assigned: 1, unassigned: 1 });
  }));

  test('다음 1시간처럼 하루 안에서 끝나는 기간도 청소 작업을 센다', () => withFrozenNow('2026-12-03T10:30', async () => {
    const report = await renderReport('next_hour', { data: ONLY_A_ASSIGNED });
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned },
      { checkOuts: 1, assigned: 1, unassigned: 0 });
  }));

  test('오늘 이미 지난 퇴실의 청소 작업은 레포트·캘린더 어디에도 남지 않는다 (서버가 그 전에 받은 목록이어도)', () => withFrozenNow('2026-12-03T12:00', async () => {
    // A 12/3 11:00 배정완료 작업이 목록에 있지만 그 퇴실은 이미 지났다 → 남은 퇴실 5건: B 요청중·B 실패·C 취소·A/C 계획 없음
    const report = await renderReport('this_month');
    const calendar = await renderCalendar('this_month');
    assert.deepEqual(calendar, { checkOuts: 5, assigned: 0, unassigned: 5 }, '캘린더 오늘 칸에 지난 퇴실의 작업이 남음');
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned }, calendar);
  }));

  test('이번달 레포트([예정] = 지금 ~ 월말)도 같은 달 캘린더의 오늘 이후 칸 합계와 같다', () => withFrozenNow('2026-12-06T12:00', async () => {
    // 지금 이후 퇴실: B 12/7 실패, C 12/8 취소, A 12/10 계획 없음, C 12/12 계획 없음 → 배정완료 0, 미배정 4
    const data = response([ITEMS[2], ITEMS[3]], { failed: 1, needsRequest: 1 });
    const report = await renderReport('this_month', { data });
    const calendar = await renderCalendar('this_month', { data });
    assert.deepEqual(calendar, { checkOuts: 4, assigned: 0, unassigned: 4 });
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned }, calendar);
  }));
});

describe('B. 같은 청소 데이터를 한 번만 받는다', () => {
  test('레포트와 캘린더가 같은 기간·숙소로 공용 훅을 부른다', () => withFrozenNow(NOW, async () => {
    const reportCalls = [];
    const calendarCalls = [];
    await renderReport('next_month', { calls: reportCalls });
    await renderCalendar('next_month', { calls: calendarCalls });
    assert.deepEqual(reportCalls.at(-1), ['next_month', IDS]);
    assert.deepEqual(calendarCalls.at(-1), ['next_month', IDS]);
  }));

  test('대시보드가 한 번 받아 나눠 준다 — 공급자·레포트·캘린더가 같은 기간·숙소 (지난달은 받지 않음)', () => withFrozenNow(NOW, async () => {
    // 레포트는 통계를 받은 뒤에야 그려져서, 각자 받으면 다음달에 요청이 두 번 나갔다(브라우저 확인). 그래서 화면이 한 번 받는다.
    const sample = DEMO_PROPERTIES.slice(0, 3);
    const ids = sample.map(property => property.id);
    const providerCalls = [];
    const consumerCalls = [];
    const rendered = await renderComponent('src/components/v2/MonthlyView.jsx', { properties: sample, onSelectProperty() {} }, {
      replace: {
        'src/hooks/useReportingStats.js': { useReportingStats: () => ({ stats: { checkIns: 0 }, summary: '요약', insights: [], loading: false }) },
        'src/hooks/useMonthlyCalendar.js': { useMonthlyCalendar: () => ({ data: null, loading: false, error: null }) },
        // 요약 배너는 처음에 접혀 있어 레포트 패널을 안 그린다 — 펼친 상태처럼 안쪽을 그대로 그리게 한다(s92 와 같은 방식)
        'src/components/v2/reporting/SummaryBanner.jsx': PROBE,
        [HOOK]: {
          FutureCleaningProvider: props => { providerCalls.push({ period: props.period, propertyIds: props.propertyIds }); return props.children; },
          useFutureCleaningStats: (...args) => { consumerCalls.push(args); return { data: { items: [] }, loading: false, error: null }; },
        },
      },
    });
    assert.match(visibleText(rendered.html), /청소배정/, '레포트 [예정]이 그려져야 레포트 쪽 요청도 검증된다');
    assert.deepEqual(providerCalls.at(-1), { period: 'this_month', propertyIds: ids });
    assert.equal(consumerCalls.length, 2, '레포트 [예정] + 캘린더');
    for (const call of consumerCalls) assert.deepEqual(call, ['this_month', ids]);
  }));

  test('공급자와 기간·숙소가 같을 때만 공급자 응답을 쓴다 (다르면 부품이 직접 받는다)', () => {
    assert.equal(sharesFutureCleaning({ period: 'next_month', idsKey: 'A,B' }, 'next_month', ['A', 'B']), true);
    assert.equal(sharesFutureCleaning({ period: 'next_month', idsKey: 'A,B' }, 'next_month', ['A']), false);
    assert.equal(sharesFutureCleaning({ period: 'next_month', idsKey: 'A,B' }, 'this_month', ['A', 'B']), false);
    assert.equal(sharesFutureCleaning({ period: null, idsKey: 'A,B' }, null, ['A', 'B']), false);
    assert.equal(sharesFutureCleaning(null, 'next_month', ['A', 'B']), false);
  });

  test('기간을 바꾼 첫 화면에는 이전 달 응답을 쓰지 않는다 — "받는 중"으로 본다', () => {
    const thisMonth = { key: 'this_month|A,B', data: { items: ITEMS }, loading: false, error: null };
    assert.equal(stateForRequest(thisMonth, 'this_month|A,B'), thisMonth);
    assert.deepEqual(stateForRequest(thisMonth, 'next_month|A,B'), { data: null, loading: true, error: null });
    assert.deepEqual(stateForRequest(thisMonth, 'this_month|A'), { data: null, loading: true, error: null }, '숙소 선택이 바뀐 경우');
    assert.deepEqual(stateForRequest(thisMonth, null), { data: null, loading: false, error: null }, '받지 않는 상태(지난달)');
  });

  test('배정 요청중·수동배정 필요 목록은 개수와 같은 집계에서 만든다 (상태 목록 사본 없음)', () => {
    // 팝업은 눌러야 열려 서버 렌더로 그릴 수 없어 소스 계약으로 확인한다
    const panel = readFileSync(new URL('../../src/components/v2/reporting/FutureMatrixPanel.jsx', import.meta.url), 'utf8');
    assert.match(panel, /buildCleaningIssueRows\('requesting', cleaningPlan\?\.requesting \?\? \[\], Date\.now\(\)\)/);
    assert.match(panel, /buildManualCleaningRows\(cleaningPlan\?\.manual, /);
    assert.match(panel, /buildNoJobRows\(cleaningPlan\?\.noJob\)/);
    assert.ok(!/REQUESTING_STATUSES/.test(panel), '레포트가 진행 중 상태 목록을 따로 들고 있음');
  });

  test('동시에 같은 요청이 오면 서버에는 한 번만 보낸다', async () => {
    const urls = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const fetchImpl = async url => { urls.push(url); await gate; return { ok: true, json: async () => ({ items: [] }) }; };
    const first = requestFutureCleaningStats('next_month', IDS, fetchImpl);
    const second = requestFutureCleaningStats('next_month', IDS, fetchImpl);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b, '두 화면이 같은 응답을 쓴다');
    assert.deepEqual(urls, ['/api/cleaning/stats?period=next_month&items=true&property_ids=A%2CB%2CC']);
  });

  test('끝난 요청은 저장하지 않는다 — 화면을 다시 열면 새로 받는다 (실패도 기억하지 않음)', async () => {
    const urls = [];
    let fail = true;
    const fetchImpl = async url => {
      urls.push(url);
      if (fail) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => ({ items: [] }) };
    };
    await assert.rejects(requestFutureCleaningStats('next_week', ['A'], fetchImpl), /503/);
    fail = false;
    await requestFutureCleaningStats('next_week', ['A'], fetchImpl);
    await requestFutureCleaningStats('next_week', ['A'], fetchImpl);
    assert.equal(urls.length, 3);
  });

  test('기간·숙소가 다르면 따로 받는다', async () => {
    const urls = [];
    const fetchImpl = async url => { urls.push(url); return { ok: true, json: async () => ({}) }; };
    await Promise.all([
      requestFutureCleaningStats('next_month', ['A'], fetchImpl),
      requestFutureCleaningStats('next_month', ['B'], fetchImpl),
      requestFutureCleaningStats('this_month', ['A'], fetchImpl),
      requestFutureCleaningStats('next_month', null, fetchImpl),
    ]);
    assert.deepEqual(urls, [
      '/api/cleaning/stats?period=next_month&items=true&property_ids=A',
      '/api/cleaning/stats?period=next_month&items=true&property_ids=B',
      '/api/cleaning/stats?period=this_month&items=true&property_ids=A',
      '/api/cleaning/stats?period=next_month&items=true',
    ]);
  });
});

describe('C. 공통 집계 함수 summarizeFutureCleaning', () => {
  const DECEMBER = { from: kst('2026-12-01'), to: kst('2027-01-01') };

  test('작업 상태별로 나누고, 작업이 없는 퇴실은 숙소·퇴실 시각과 함께 돌려준다', () => {
    const summary = summarizeFutureCleaning(PROPERTIES, DECEMBER, ITEMS);
    assert.deepEqual(summary.assigned.map(item => item.property_id), ['A']);
    assert.deepEqual(summary.requesting.map(item => item.property_id), ['B']);
    assert.deepEqual(summary.manual.map(item => [item.property_id, item.status]), [['B', 'ESCALATED'], ['C', 'CANCELLED']]);
    assert.deepEqual(summary.noJob, [
      { property_id: 'A', checkout_at: kst('2026-12-10T11:00').toISOString() },
      { property_id: 'C', checkout_at: kst('2026-12-12T11:00').toISOString() },
    ]);
  });

  test('퇴실은 퇴실 시각이 구간 안이면 센다 — 퇴실예정·캘린더 칸·청소 집계가 같은 수 (입실 날짜가 깨져도)', () => {
    const properties = [{ id: 'X', reservations: [
      stay('2026-11-28T15:00', '2026-11-30T11:00'),               // 구간 전
      stay('2026-12-30T15:00', '2027-01-01T00:00'),               // 구간 끝(제외)
      { checkIn: 'not-a-date', checkOut: kst('2026-12-15T11:00') }, // 입실 날짜가 깨져도 퇴실은 퇴실
      { checkIn: kst('2026-12-24T15:00'), checkOut: 'not-a-date' }, // 퇴실 날짜가 깨지면 셀 수 없음
      stay('2026-12-20T15:00', '2026-12-22T11:00'),
    ] }];
    const counted = summarizeFutureCleaning(properties, DECEMBER, []).noJob;
    assert.deepEqual(counted.map(item => item.checkout_at),
      [kst('2026-12-15T11:00').toISOString(), kst('2026-12-22T11:00').toISOString()]);
    const calendarCheckOuts = Object.values(buildFutureCalendarDays(properties, DECEMBER, [])).reduce((sum, day) => sum + day.checkOuts, 0);
    const withDates = [{ id: 'X', reservations: properties[0].reservations.filter(r => r.checkOut instanceof Date) }];
    assert.equal(calendarCheckOuts, 2, '캘린더 칸');
    assert.equal(countWeekCheckOuts(withDates, DECEMBER.from, DECEMBER.to), 2, '레포트 퇴실예정');
  });

  test('청소 작업도 퇴실과 같은 구간만 센다 (구간 밖 작업은 배정완료·미배정에 안 들어간다)', () => {
    const outside = [job('A', '2026-11-30T11:00', 'ASSIGNED'), job('B', '2027-01-01T11:00', 'PENDING')];
    const summary = summarizeFutureCleaning(PROPERTIES, DECEMBER, [...ITEMS, ...outside]);
    assert.deepEqual([summary.assigned.length, summary.requesting.length, summary.manual.length], [1, 1, 2]);
  });

  test('구간이 없거나 거꾸로면 null — 화면은 "—"', () => {
    assert.equal(summarizeFutureCleaning(PROPERTIES, null, ITEMS), null);
    assert.equal(summarizeFutureCleaning(PROPERTIES, { from: DECEMBER.to, to: DECEMBER.from }, ITEMS), null);
  });

  test('수동배정 필요 목록: 개수와 같은 작업에서 만들고, 실패 인원·취소 시각은 서버 실패·취소 목록에서 붙인다', () => withFrozenNow('2026-12-05T12:00', () => {
    const manual = summarizeFutureCleaning(PROPERTIES, DECEMBER, ITEMS).manual; // items 에는 인원·취소 시각이 없다
    const detail = [
      { ...ITEMS[2], notified_count: 5, declined_count: 2 },
      { ...ITEMS[3], updated_at: kst('2026-12-05T10:00').toISOString() },
    ];
    const rows = buildManualCleaningRows(manual, detail, Date.now());
    assert.deepEqual(rows.map(row => row.item.property_id), ['B', 'C'], '퇴실이 가까운 순');
    assert.match(rows[0].view.text, /5명 중 2명 거절, 3명 무응답/);
    assert.match(rows[1].view.text, /취소된 청소를 다시 요청해야 해요 \(2시간 전에 취소됨\)/);
    // 서버 목록에 없으면 상태만으로 문장을 만든다
    assert.match(buildManualCleaningRows(manual, [], Date.now())[0].view.text, /청소할 사람을 아직 못 구했어요/);
  }));

  test('청소 계획 없음 목록 줄: 캘린더와 같은 문구, 중립 색, 퇴실이 가까운 순, 퇴실 시각 표시', () => {
    const rows = buildNoJobRows([
      { property_id: 'C', checkout_at: kst('2026-12-12T11:00').toISOString() },
      { property_id: 'A', checkout_at: kst('2026-12-10T11:00').toISOString() },
    ]);
    assert.deepEqual(rows.map(row => row.item.property_id), ['A', 'C']);
    assert.deepEqual(rows[0].view, { severity: SEVERITY.INFO, text: '청소 잡 미생성', when: '12/10(목) 11:00' });
    assert.deepEqual(buildNoJobRows(undefined), []);
  });
});

// DEC-05 (2026-11-10): 퇴실 하나에 청소 작업 하나를 맞춘다 — 그래서 늘 배정완료 + 미배정 = 퇴실예정이다.
//   ① 퇴실과 맞지 않는 살아 있는 작업(예약이 바뀌거나 취소돼 남은 작업 등)은 배정 숫자에서 빼고 "퇴실 없는 청소"로 따로 보인다
//   ② 같은 숙소·같은 날의 예약 여러 건은 입실·퇴실 1건
describe('D. DEC-05 — 퇴실과 청소 작업을 1:1 로 맞춘다', () => {
  // 손님이 날짜를 바꾸거나 취소해도 동기화는 이미 만든 청소 작업을 지우지 않는다(api/cleaning syncAllIcal, RF-16)
  const ORPHAN = response([...ITEMS, job('A', '2026-12-20T11:00', 'ASSIGNED')], { assigned: 2, requesting: 1, failed: 1, needsRequest: 1 });
  // 같은 숙소·같은 퇴실 시각의 예약 두 건 → 청소 작업은 (숙소, 퇴실 시각)마다 하나(UNIQUE). DEMO 의 P020 11/16 과 같은 모양
  const DUPLICATED = [...PROPERTIES.slice(0, 2), {
    ...PROPERTIES[2], reservations: [...PROPERTIES[2].reservations, stay('2026-12-06T18:00', '2026-12-08T11:00')],
  }];

  test('퇴실 없는 청소 작업은 배정완료·미배정에 넣지 않고 따로 보인다 — 레포트와 캘린더가 같은 수', () => withFrozenNow(NOW, async () => {
    const report = await renderReport('next_month', { data: ORPHAN });
    const calendar = await renderCalendarCells('next_month', { data: ORPHAN });
    assert.deepEqual(calendar.counts, { checkOuts: 6, assigned: 1, unassigned: 5 });
    assert.equal(calendar.orphan, 1, '캘린더 12/20 칸의 퇴실 없는 청소');
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned }, calendar.counts);
    assert.equal(report.assigned + report.unassigned, report.checkOuts);
    assert.equal(reportOrphan(report.text), 1, '레포트의 퇴실 없는 청소');
  }));

  test('퇴실 없는 청소가 없으면 레포트·캘린더 어디에도 그 표시가 없다', () => withFrozenNow(NOW, async () => {
    const report = await renderReport('next_month');
    const calendar = await renderCalendarCells('next_month');
    assert.equal(reportOrphan(report.text), null);
    assert.equal(calendar.orphan, 0);
  }));

  test('같은 날 중복 예약은 퇴실 1건 — 배정완료 + 미배정 = 퇴실예정, 레포트와 캘린더가 같은 수', () => withFrozenNow(NOW, async () => {
    const report = await renderReport('next_month', { properties: DUPLICATED });
    const calendar = await renderCalendar('next_month', { properties: DUPLICATED });
    assert.deepEqual(calendar, { checkOuts: 6, assigned: 1, unassigned: 5 });
    assert.deepEqual({ checkOuts: report.checkOuts, assigned: report.assigned, unassigned: report.unassigned }, calendar);
  }));

  test('하루 분류: 퇴실 하나에 작업 하나 — 남는 살아 있는 작업만 퇴실 없는 청소, 취소·완료된 남은 작업은 뺀다', () => {
    const items = [
      { property_id: 'A', status: 'CANCELLED' },        // A 의 옛 작업(취소됨) — 같은 날 살아 있는 작업이 있으면 그쪽과 맞춘다
      { property_id: 'A', status: 'PENDING' },
      { property_id: 'B', status: 'ASSIGNED', cleaner_name: '김민지' }, // B 는 그날 퇴실이 없다
      { property_id: 'C', status: 'CANCELLED' },        // C 도 퇴실이 없지만 이미 취소됨 → 더 일어날 일 없음
      { property_id: 'D', status: 'ASSIGNED' },
      { property_id: 'D', status: 'NOTIFYING_VIP_1' },  // D 는 이미 배정됐는데 요청이 또 나가는 작업
    ];
    const r = classifyDayCleaningItems(items, ['A', 'D', 'E', 'A']);
    assert.deepEqual(r.requesting.map(item => item.property_id), ['A']);
    assert.deepEqual(r.assigned.map(item => item.property_id), ['D']);
    assert.deepEqual(r.manual, []);
    assert.deepEqual(r.noJob, ['E']);
    assert.equal(r.assigned.length + r.requesting.length + r.manual.length + r.noJob.length, 3, '퇴실 3건(A 중복 1건)');
    assert.deepEqual(r.orphan.map(item => [item.property_id, item.status, item.orphanReason]),
      [['D', 'NOTIFYING_VIP_1', 'sameDay'], ['B', 'ASSIGNED', 'noCheckout']]);
  });

  test('알 수 없는 상태의 작업만 있는 퇴실은 청소 계획 없음 — 퇴실이 어느 칸에서도 사라지지 않는다', () => {
    const r = classifyDayCleaningItems([{ property_id: 'A', status: 'SOMETHING_NEW' }, { property_id: 'B', status: 'ASSIGNED' }], ['A', 'B']);
    assert.deepEqual(r.noJob, ['A']);
    assert.equal(r.assigned.length + r.requesting.length + r.manual.length + r.noJob.length, 2);
  });

  test('퇴실 없는 청소 목록: 담당자가 배정된 건(사람이 올 수 있음)이 빨강으로 위, 사유별 문장', () => {
    const rows = buildOrphanCleaningRows([
      { property_id: 'A', status: 'PENDING', checkout_at: kst('2026-12-10T11:00').toISOString(), orphanReason: 'noCheckout' },
      { property_id: 'B', status: 'ASSIGNED', cleaner_name: '김민지', checkout_at: kst('2026-12-20T11:00').toISOString(), orphanReason: 'noCheckout' },
      { property_id: 'C', status: 'ESCALATED', checkout_at: kst('2026-12-08T11:00').toISOString(), orphanReason: 'sameDay' },
    ]);
    assert.deepEqual(rows.map(row => [row.item.property_id, row.view.severity]),
      [['B', SEVERITY.SEVERE], ['C', SEVERITY.CAUTION], ['A', SEVERITY.CAUTION]]);
    assert.equal(rows[0].view.text, '그날 퇴실 예약이 없는데 김민지님이 배정돼 있어요');
    assert.equal(rows[1].view.text, '같은 날 다른 청소가 이미 잡혀 있는데 배정 실패로 남아 있어요');
    assert.equal(rows[2].view.text, '그날 퇴실 예약이 없는데 청소 요청이 진행 중이에요');
    assert.equal(rows[0].view.when, '12/20(일) 11:00');
    assert.deepEqual(buildOrphanCleaningRows(undefined), []);
  });
});
