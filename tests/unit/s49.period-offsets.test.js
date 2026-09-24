/**
 * s49 — 레포트 기간이 타임라인 위치를 그대로 따른다 (몇 주·며칠 뒤/전)
 *
 * 사용자 결정 (2026-09-19): 타임라인을 2주 뒤로 넘기면 "다음 주" 레포트가 아니라 2주 뒤 주의 정보를 보여준다.
 *   - 주 모드: 가장 가까운 주 (…, 3주 전, 2주 전, 지난주, 이번 주, 다음 주, 2주 뒤, 3주 뒤, …)
 *   - 일 모드: 그 날 (…, 그제, 어제, 오늘, 내일, 모레, …)
 *   - 지금까지 쓰던 이름(last_week, next_week, tomorrow …)은 그대로 — 그 밖의 오프셋만 weeks_ahead_2 등으로 표기
 *
 * 청소 취소 규칙 (사용자 결정 2026-09-19): 청소가 취소되면 다시 배정을 요청해야 하므로 "배정 요청 필요"로 센다.
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync). 로직 재구현(L0) 금지.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseOffsetPeriod, periodForOffset, describePeriod,
  periodToDateRange, periodToRemainingRange, periodRangeLabel,
} from '../../src/domain/periodDomain.js';
import { getPeriodRange } from '../../src/domain/reportingDomain.js';
import { getStatsForPeriod, generateSummary, getDrilldownForMetric } from '../../src/application/reportingService.js';
import { futureSummaryFor } from '../../src/domain/futureWeekDomain.js';
import { classifyCleaningAssignments } from '../../src/domain/futureWeekDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const HOUR = 3_600_000;
const DAY  = 24 * HOUR;
const WED_NOON_KST = new Date('2026-09-16T03:00:00Z').getTime(); // 수 12:00 KST
const SUN_LATE_KST = new Date('2026-09-13T14:30:00Z').getTime(); // 일 23:30 KST
const MON_EARLY_KST = new Date('2026-09-13T15:30:00Z').getTime(); // 월 00:30 KST
const REFS = [WED_NOON_KST, SUN_LATE_KST, MON_EARLY_KST];

// ══════════════════════════════════════════════════════════════════════════
// A. 기간 이름 ↔ 오프셋
// ══════════════════════════════════════════════════════════════════════════
describe('parseOffsetPeriod — 표준 이름', () => {
  test('기존 이름은 그대로 (주 -1/0/+1, 일 -1/0/+1)', () => {
    assert.deepEqual(parseOffsetPeriod('last_week'), { unit: 'week', offset: -1 });
    assert.deepEqual(parseOffsetPeriod('this_week'), { unit: 'week', offset: 0 });
    assert.deepEqual(parseOffsetPeriod('next_week'), { unit: 'week', offset: 1 });
    assert.deepEqual(parseOffsetPeriod('yesterday'), { unit: 'day', offset: -1 });
    assert.deepEqual(parseOffsetPeriod('today'),     { unit: 'day', offset: 0 });
    assert.deepEqual(parseOffsetPeriod('tomorrow'),  { unit: 'day', offset: 1 });
  });
});

describe('parseOffsetPeriod — 몇 주·며칠 뒤/전', () => {
  test('weeks_ahead_2 → 주 +2, weeks_ago_3 → 주 -3', () => {
    assert.deepEqual(parseOffsetPeriod('weeks_ahead_2'), { unit: 'week', offset: 2 });
    assert.deepEqual(parseOffsetPeriod('weeks_ago_3'),   { unit: 'week', offset: -3 });
  });

  test('days_ahead_5 → 일 +5, days_ago_2 → 일 -2', () => {
    assert.deepEqual(parseOffsetPeriod('days_ahead_5'), { unit: 'day', offset: 5 });
    assert.deepEqual(parseOffsetPeriod('days_ago_2'),   { unit: 'day', offset: -2 });
  });

  test('잘못된 이름은 null', () => {
    for (const bad of ['', 'weeks_ahead_0', 'weeks_ahead_-1', 'weeks_ahead_02', 'weeks_ahead_x',
      'weeks_next_2', 'week_ahead_2', 'this_month', 'now', 'last_hour', 'weeks_ahead_2;drop', null, undefined, 3]) {
      assert.equal(parseOffsetPeriod(bad), null, String(bad));
    }
  });

  test('터무니없이 먼 기간은 거부 (주 520, 일 3650 초과)', () => {
    assert.notEqual(parseOffsetPeriod('weeks_ahead_520'), null);
    assert.equal(parseOffsetPeriod('weeks_ahead_521'), null);
    assert.notEqual(parseOffsetPeriod('days_ago_3650'), null);
    assert.equal(parseOffsetPeriod('days_ago_3651'), null);
  });
});

describe('periodForOffset — 오프셋 → 기간 이름', () => {
  test('0·±1 은 기존 이름, 그 밖은 weeks_ahead_N 등', () => {
    assert.equal(periodForOffset('week', -1), 'last_week');
    assert.equal(periodForOffset('week', 0),  'this_week');
    assert.equal(periodForOffset('week', 1),  'next_week');
    assert.equal(periodForOffset('week', 2),  'weeks_ahead_2');
    assert.equal(periodForOffset('week', -3), 'weeks_ago_3');
    assert.equal(periodForOffset('day', -1), 'yesterday');
    assert.equal(periodForOffset('day', 0),  'today');
    assert.equal(periodForOffset('day', 1),  'tomorrow');
    assert.equal(periodForOffset('day', 4),  'days_ahead_4');
    assert.equal(periodForOffset('day', -6), 'days_ago_6');
  });

  test('-0 은 0(이번)으로 취급', () => {
    assert.equal(periodForOffset('week', -0), 'this_week');
    assert.equal(periodForOffset('day', Math.round(-0.4)), 'today');
  });

  test('왕복: 어떤 오프셋이든 이름 → 파싱하면 원래 오프셋', () => {
    for (const unit of ['week', 'day']) {
      for (let n = -30; n <= 30; n++) {
        assert.deepEqual(parseOffsetPeriod(periodForOffset(unit, n)), { unit, offset: n }, `${unit} ${n}`);
      }
    }
  });

  test('허용 범위를 넘으면 최대치로 맞춰 항상 유효한 이름을 돌려준다', () => {
    assert.notEqual(parseOffsetPeriod(periodForOffset('week', 99999)), null);
    assert.notEqual(parseOffsetPeriod(periodForOffset('day', -99999)), null);
  });

  test('알 수 없는 단위는 오류', () => {
    assert.throws(() => periodForOffset('month', 1));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. 기간 설명 (시제 + 표시 이름)
// ══════════════════════════════════════════════════════════════════════════
describe('describePeriod — 기존 이름 (표시 문구·시제 회귀 가드)', () => {
  const EXPECT = {
    now: ['now', '지금'],
    today: ['active', '오늘'], this_week: ['active', '이번 주'], this_month: ['active', '이번 달'],
    yesterday: ['past', '어제'], last_week: ['past', '지난주'], last_hour: ['past', '지난 1시간'], last_month: ['past', '지난달'],
    tomorrow: ['future', '내일'], next_week: ['future', '다음 주'], next_hour: ['future', '다음 예정'], next_month: ['future', '다음 달'],
  };
  for (const [period, [tense, label]] of Object.entries(EXPECT)) {
    test(`${period} → ${tense} / "${label}"`, () => {
      const d = describePeriod(period);
      assert.equal(d.tense, tense);
      assert.equal(d.label, label);
    });
  }
});

describe('describePeriod — 몇 주·며칠 뒤/전', () => {
  test('2주 뒤: 미래 / "2주 뒤"', () => {
    const d = describePeriod('weeks_ahead_2');
    assert.equal(d.tense, 'future');
    assert.equal(d.unit, 'week');
    assert.equal(d.label, '2주 뒤');
  });
  test('3주 전: 과거 / "3주 전"', () => {
    const d = describePeriod('weeks_ago_3');
    assert.equal(d.tense, 'past');
    assert.equal(d.label, '3주 전');
  });
  test('4일 뒤 / 2일 전', () => {
    assert.equal(describePeriod('days_ahead_4').label, '4일 뒤');
    assert.equal(describePeriod('days_ago_2').label, '2일 전');
    assert.equal(describePeriod('days_ago_2').tense, 'past');
  });
  test('알 수 없는 기간은 null', () => {
    assert.equal(describePeriod('foo'), null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. 기간 → 날짜 범위 (KST 자정 경계)
// ══════════════════════════════════════════════════════════════════════════
describe('periodToDateRange — 몇 주 뒤/전', () => {
  test('수요일(9/16) 기준 2주 뒤 = 9/28(월) ~ 10/5(월) KST 자정', () => {
    const r = periodToDateRange('weeks_ahead_2', WED_NOON_KST);
    assert.equal(r.from.toISOString(), '2026-09-27T15:00:00.000Z'); // 9/28 00:00 KST
    assert.equal(r.to.toISOString(),   '2026-10-04T15:00:00.000Z'); // 10/5 00:00 KST
  });

  test('3주 전 = 8/24(월) ~ 8/31(월) KST 자정', () => {
    const r = periodToDateRange('weeks_ago_3', WED_NOON_KST);
    assert.equal(r.from.toISOString(), '2026-08-23T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-08-30T15:00:00.000Z');
  });

  test('모든 주 기간은 정확히 7일, 이웃 주와 빈틈·겹침 없이 이어진다', () => {
    for (const now of REFS) {
      for (let k = -6; k <= 6; k++) {
        const cur  = periodToDateRange(periodForOffset('week', k), now);
        const next = periodToDateRange(periodForOffset('week', k + 1), now);
        assert.equal(cur.to.getTime() - cur.from.getTime(), 7 * DAY, `주 ${k} 길이`);
        assert.equal(cur.to.getTime(), next.from.getTime(), `주 ${k} → ${k + 1} 연속`);
      }
    }
  });

  test('일요일 밤·월요일 새벽에도 "이번 주"는 KST 달력 기준', () => {
    const sun = periodToDateRange('this_week', SUN_LATE_KST);   // 9/13(일) 23:30 → 9/7 주
    const mon = periodToDateRange('this_week', MON_EARLY_KST);  // 9/14(월) 00:30 → 9/14 주
    assert.equal(sun.from.toISOString(), '2026-09-06T15:00:00.000Z');
    assert.equal(mon.from.toISOString(), '2026-09-13T15:00:00.000Z');
  });

  test('표준 이름과 같은 오프셋은 같은 범위 (next_week == 주 +1)', () => {
    for (const now of REFS) {
      assert.deepEqual(periodToDateRange('next_week', now), periodToDateRange(periodForOffset('week', 1), now));
    }
  });
});

describe('periodToDateRange — 며칠 뒤/전', () => {
  test('수요일 기준 3일 뒤 = 9/19(토) KST 하루', () => {
    const r = periodToDateRange('days_ahead_3', WED_NOON_KST);
    assert.equal(r.from.toISOString(), '2026-09-18T15:00:00.000Z');
    assert.equal(r.to.toISOString(),   '2026-09-19T15:00:00.000Z');
  });

  test('모든 일 기간은 정확히 24시간, 이웃 날과 이어진다', () => {
    for (const now of REFS) {
      for (let k = -10; k <= 10; k++) {
        const cur  = periodToDateRange(periodForOffset('day', k), now);
        const next = periodToDateRange(periodForOffset('day', k + 1), now);
        assert.equal(cur.to.getTime() - cur.from.getTime(), DAY, `일 ${k}`);
        assert.equal(cur.to.getTime(), next.from.getTime(), `일 ${k} → ${k + 1}`);
      }
    }
  });

  test('어제·오늘도 범위를 계산한다 (이전에는 null)', () => {
    assert.notEqual(periodToDateRange('yesterday', WED_NOON_KST), null);
    assert.notEqual(periodToDateRange('today', WED_NOON_KST), null);
  });
});

describe('getPeriodRange(이벤트 집계) ↔ periodToDateRange 경계 일치', () => {
  const PERIODS = ['weeks_ahead_2', 'weeks_ahead_5', 'weeks_ago_2', 'weeks_ago_4', 'days_ahead_2', 'days_ahead_9', 'days_ago_2', 'days_ago_7'];
  for (const period of PERIODS) {
    test(`${period}: 시작 같음, 끝은 [to) 보다 1ms 앞`, () => {
      for (const now of REFS) {
        const a = getPeriodRange(period, new Date(now));
        const b = periodToDateRange(period, now);
        assert.equal(a.from.getTime(), b.from.getTime());
        assert.equal(a.to.getTime(), b.to.getTime() - 1);
      }
    });
  }

  test('2주 전 끝 + 1ms == 지난주 시작 (이름 있는 기간과 이어짐)', () => {
    const ref = new Date(WED_NOON_KST);
    assert.equal(getPeriodRange('weeks_ago_2', ref).to.getTime() + 1, getPeriodRange('last_week', ref).from.getTime());
  });

  test('다음 주 끝 + 1ms == 2주 뒤 시작', () => {
    const ref = new Date(WED_NOON_KST);
    assert.equal(getPeriodRange('next_week', ref).to.getTime() + 1, getPeriodRange('weeks_ahead_2', ref).from.getTime());
  });

  test('알 수 없는 기간은 여전히 오류', () => {
    assert.throws(() => getPeriodRange('weeks_ahead_x'));
  });
});

describe('periodToRemainingRange — 예정 구간', () => {
  test('2주 뒤(미래)는 그 주 전체', () => {
    assert.deepEqual(periodToRemainingRange('weeks_ahead_2', WED_NOON_KST), periodToDateRange('weeks_ahead_2', WED_NOON_KST));
  });
  test('2주 전(과거)은 그 주 전체', () => {
    assert.deepEqual(periodToRemainingRange('weeks_ago_2', WED_NOON_KST), periodToDateRange('weeks_ago_2', WED_NOON_KST));
  });
  test('이번 주는 지금부터 일요일 끝까지', () => {
    const r = periodToRemainingRange('this_week', WED_NOON_KST);
    assert.equal(r.from.getTime(), WED_NOON_KST);
    assert.equal(r.to.getTime(), periodToDateRange('this_week', WED_NOON_KST).to.getTime());
  });
  test('오늘은 지금부터 오늘 끝까지', () => {
    const r = periodToRemainingRange('today', WED_NOON_KST);
    assert.equal(r.from.getTime(), WED_NOON_KST);
    assert.equal(r.to.toISOString(), '2026-09-16T15:00:00.000Z');
  });
});

describe('periodRangeLabel — 사람이 읽는 날짜 범위', () => {
  test('2주 뒤: "9/28~10/4"', () => {
    assert.equal(periodRangeLabel('weeks_ahead_2', WED_NOON_KST), '9/28~10/4');
  });
  test('3일 뒤: 하루라 "9/19"', () => {
    assert.equal(periodRangeLabel('days_ahead_3', WED_NOON_KST), '9/19');
  });
  test('주·일 기간이 아니면 빈 문자열', () => {
    assert.equal(periodRangeLabel('this_month', WED_NOON_KST), '');
    assert.equal(periodRangeLabel('now', WED_NOON_KST), '');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. 요약 문장
// ══════════════════════════════════════════════════════════════════════════
describe('generateSummary — 몇 주·며칠 뒤/전', () => {
  test('2주 전, 이상 없음', () => {
    assert.equal(generateSummary('weeks_ago_2', { checkIns: 5, anomalies: 0 }), '2주 전 체크인 5건 완료, 이상 없었어요.');
  });
  test('3일 전, 이상 있음', () => {
    assert.equal(generateSummary('days_ago_3', { checkIns: 2, anomalies: 1 }), '3일 전 체크인 2건 완료, 이상감지 1건이 있었어요.');
  });
  test('2주 전, 노쇼 의심은 덧붙는다', () => {
    assert.match(generateSummary('weeks_ago_2', { checkIns: 1, anomalies: 0, noShowSuspected: 2 }), /노쇼 의심 2건/);
  });
  test('2주 뒤: 예약 있음/없음', () => {
    assert.equal(generateSummary('weeks_ahead_2', { checkIns: 4 }), '2주 뒤 체크인 4건 예정이에요.');
    assert.equal(generateSummary('weeks_ahead_2', { checkIns: 0 }), '2주 뒤 예약이 없어요.');
  });
  test('기존 이름의 문장은 그대로 (회귀 가드)', () => {
    assert.equal(generateSummary('next_week', { checkIns: 3 }), '다음 주 체크인 3건 예정이에요.');
    assert.equal(generateSummary('last_week', { checkIns: 3, anomalies: 0 }), '지난주 체크인 3건 완료, 이상 없었어요.');
  });
});

describe('futureSummaryFor — 예약 기준 요약 (미래 기간)', () => {
  const stay = (ci, co) => ({ checkIn: new Date(ci), checkOut: new Date(co) });
  // 2주 뒤 주(9/28~10/4)에 체크인 1건·체크아웃 1건
  const PROPS = [{ reservations: [stay('2026-09-29T06:00:00Z', '2026-10-02T02:00:00Z'), stay('2026-10-20T06:00:00Z', '2026-10-22T02:00:00Z')] }];

  test('2주 뒤 주의 예약으로 문장을 만든다', () => {
    assert.equal(futureSummaryFor('weeks_ahead_2', PROPS, WED_NOON_KST), '2주 뒤 체크인 1건, 체크아웃 1건 예정이에요.');
  });
  test('그 주에 예약이 없으면 없다고 말한다', () => {
    assert.equal(futureSummaryFor('weeks_ahead_3', PROPS, WED_NOON_KST), '3주 뒤 예정된 체크인·체크아웃이 없어요.');
  });
  test('과거 기간은 ""(서버 요약을 쓰라는 뜻)', () => {
    assert.equal(futureSummaryFor('weeks_ago_2', PROPS, WED_NOON_KST), '');
  });
  test('기존 이름의 문구는 그대로', () => {
    assert.match(futureSummaryFor('next_week', [], WED_NOON_KST), /^다음 주 /);
    assert.match(futureSummaryFor('tomorrow', [], WED_NOON_KST), /^내일 /);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. 서버: 새 기간으로 집계
// ══════════════════════════════════════════════════════════════════════════
describe('getStatsForPeriod — 몇 주·며칠 뒤/전', () => {
  function makeDb() {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
    };
  }

  test('2주 전: 그 주 범위로 이벤트를 조회하고 범위를 돌려준다', async () => {
    const db = makeDb();
    const now = new Date(WED_NOON_KST);
    const res = await getStatsForPeriod('weeks_ago_2', { db, propertyIds: null, now });
    const expected = getPeriodRange('weeks_ago_2', now);
    const eventsCall = db.calls[0];
    assert.equal(eventsCall.params[0].getTime(), expected.from.getTime());
    assert.equal(eventsCall.params[1].getTime(), expected.to.getTime());
    assert.equal(res.range.from, expected.from.toISOString());
    assert.match(res.summary, /^2주 전 /);
  });

  test('2주 뒤(미래): 청소 잡 집계는 건너뛴다 (이벤트가 없는 기간)', async () => {
    const db = makeDb();
    await getStatsForPeriod('weeks_ahead_2', { db, propertyIds: null, now: new Date(WED_NOON_KST) });
    assert.ok(!db.calls.some(c => /cleaning_jobs/.test(c.sql)), 'cleaning_jobs 조회가 있으면 안 됨');
  });

  test('2주 전(과거): 청소 잡 집계도 수행', async () => {
    const db = makeDb();
    await getStatsForPeriod('weeks_ago_2', { db, propertyIds: null, now: new Date(WED_NOON_KST) });
    assert.ok(db.calls.some(c => /cleaning_jobs/.test(c.sql)));
  });

  test('선택 숙소가 있으면 새 기간에도 그대로 필터', async () => {
    const db = makeDb();
    await getStatsForPeriod('weeks_ago_2', { db, propertyIds: ['A', 'B'], now: new Date(WED_NOON_KST) });
    assert.deepEqual(db.calls[0].params[0], ['A', 'B']);
  });

  test('실패 지표 상세(드릴다운)도 새 과거 기간으로 조회', async () => {
    const db = makeDb();
    const r = await getDrilldownForMetric('cleaning_time', 'weeks_ago_2', { db });
    assert.equal(r.period, 'weeks_ago_2');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F. 화면·API 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('타임라인 위치 → 레포트 기간 배선', () => {
  const list = read('src/components/v2/PropertyListView.jsx');
  const detail = read('src/components/v2/PropertyDetailView.jsx');

  test('리스트: 몇 주를 넘겨도 지난주/다음주로 뭉개지 않는다', () => {
    assert.match(list, /periodForOffset\('week',\s*Math\.round\(windowOffset \/ 7\)\)/);
    assert.match(list, /periodForOffset\('day',\s*windowOffset\)/);
    assert.ok(!/windowOffset\s*(<=|>=)\s*-?4/.test(list), '±4일 임계값으로 뭉개는 옛 로직이 남아 있음');
  });

  test('상세: 일 모드는 그 날 그대로 (며칠 뒤를 "다음 주"로 바꾸지 않는다)', () => {
    assert.match(detail, /periodForOffset\('day',\s*dayOffset\)/);
    assert.ok(!/dayOffset\s*<\s*0\s*\?\s*'last_week'/.test(detail));
  });

  test('레포트 패널: 시제·이름을 기간 규칙(describePeriod)에서 가져온다', () => {
    const panel = read('src/components/v2/reporting/ReportPanel.jsx');
    assert.match(panel, /describePeriod\(period\)/);
    assert.ok(!/PERIOD_TENSE\s*=/.test(panel) && !/PERIOD_NAV_LABEL\s*=/.test(panel), '하드코딩 표가 남아 있음');
  });

  test('통계 API: 새 기간 이름을 받아들인다', () => {
    assert.match(read('api/stats.js'), /parseOffsetPeriod\(period\)/);
  });

  test('실패 상세 API: 과거 주/일 기간을 받아들인다', () => {
    assert.match(read('api/stats/drilldown.js'), /describePeriod\(period\)/);
  });

  test('서버 청소 지표: 미래 판정은 하드코딩 목록이 아니라 기간 시제', () => {
    const svc = read('src/application/reportingService.js');
    assert.ok(!/FUTURE_PERIODS\s*=/.test(svc));
    assert.match(svc, /describePeriod\(period\)\?\.tense === "future"/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// G. 청소가 취소되면 다시 배정 요청이 필요하다 (사용자 결정)
// ══════════════════════════════════════════════════════════════════════════
describe('청소 취소 → "배정 요청 필요"', () => {
  const CHECKOUT = { propertyId: 'A', checkoutDate: new Date('2026-09-29T02:00:00Z') };

  test('취소된 청소가 있는 체크아웃은 배정 요청 필요로 분류', () => {
    const r = classifyCleaningAssignments([CHECKOUT], [], [{ propertyId: 'A', checkoutDate: CHECKOUT.checkoutDate, status: 'CANCELLED' }]);
    assert.deepEqual(r, { assigned: 0, needsRequest: 1, requesting: 0, failed: 0 });
  });

  test('통계 API는 CANCELLED 건수를 "배정 요청 필요"(needsRequest)로 내려준다', () => {
    const src = read('api/cleaning/[...slug].js');
    assert.match(src, /COUNT\(\*\) FILTER \(WHERE status = 'CANCELLED'\)\s+AS needs_request/);
    assert.match(src, /needsRequest\s*=\s*parseInt\(rows\[0\]\.needs_request/);
  });

  test('취소된 건은 "배정 요청 필요" 상세 목록에도 나온다', () => {
    const src = read('api/cleaning/[...slug].js');
    // [failedResult, needsRequestResult, itemResult] = Promise.all([쿼리1, 쿼리2, 쿼리3]) — 두 번째 쿼리가 취소 건
    const start = src.indexOf('const [failedResult, needsRequestResult, itemResult] = await Promise.all([');
    assert.ok(start > 0, 'Promise.all 구조를 찾지 못함');
    const queries = src.slice(start).split('db.query(').slice(1, 4);
    assert.equal(queries.length, 3);
    assert.match(queries[0], /j\.status = 'ESCALATED'/, '첫 번째(failedResult)는 배정 실패');
    assert.match(queries[1], /j\.status = 'CANCELLED'/, '두 번째(needsRequestResult)는 취소 = 배정 요청 필요');
  });

  test('진행 상태(배정 요청중)에는 취소 건을 섞지 않는다', () => {
    const src = read('api/cleaning/[...slug].js');
    const m = src.match(/status IN \('PENDING'[^)]*\)\)\s+AS requesting/);
    assert.ok(m, 'requesting 집계 SQL을 찾지 못함');
    assert.ok(!m[0].includes('CANCELLED'));
  });
});
