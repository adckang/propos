/**
 * s65 — "발견된 패턴"을 ListView(주간)에도 적용 (D-029)
 *
 * 사용자 요청: "데시보드... 월단위 레포트에 패턴 명시한부분, 동일하게 리스트뷰(주단위)에도
 * 똑같이 적용해줘. 대신 주단위 레포트내용이어야겠지? 그렇게 적용하는데 문제가 있을지 먼저
 * 검토해보고. 이부분 충분히 개선가능하면 적용해줘"
 *
 * 검토 결과: 4개 detect 함수(REPEAT/CONCENTRATION/MONTH_OVER_MONTH/CONSECUTIVE)는 원래도
 * reportPeriod를 불투명한 문자열로만 다뤄서 월/주에 종속되지 않았다. 실제로 월 전용이었던
 * 부분(CONSECUTIVE의 "바로 전 기간" 계산, 문장의 단위 표현, 임계값)만 periodUnit 옵션으로
 * 분리해 재사용했다. UI 레이어(SummaryBanner/InsightDrilldownSheet/DrilldownSheet/
 * PropertyDetailView/RoomStateApp)는 이미 기간에 무관하게 동작해서 변경이 필요 없었다.
 *
 * 이 파일은 D-029로 "새로 생긴" 부분만 검증한다 — REPEAT/CONCENTRATION/MONTH_OVER_MONTH의
 * 핵심 로직 자체(임계값 경계 등)는 이미 s63가 충분히 덮고 있고 월/주 공용이라 다시 안 씀.
 *
 * 레이어: L1(WEEKLY_INSIGHT_THRESHOLDS, periodUnit='week' 분기, weekLabel/periodLabel,
 * CONSECUTIVE의 prevWeekKey 인접성 가드) / L2(getWeeklyInsights 오케스트레이션,
 * api/stats.js·PropertyListView.jsx 소스 계약).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  WEEKLY_INSIGHT_THRESHOLDS,
  detectRepeatInsights,
  detectConcentrationInsights,
  detectMonthOverMonthInsights,
  detectConsecutiveInsights,
  formatInsightSentence,
  periodLabel,
  buildWeeklyInsights,
} from '../../src/domain/insightDomain.js';
import { buildScopeComparisonRows, describeInsightAction } from '../../src/domain/insightActionGuideDomain.js';
import { getWeeklyInsights } from '../../src/application/reportingService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── L1: periodUnit='week' 분기 ────────────────────────────────────────────────
describe('periodLabel — 월은 "9월", 주는 월요일 기준 "9/22~9/28"', () => {
  test('week 단위는 월요일부터 일요일까지 날짜 범위로 표시 (D-017 ReportPanel 제목과 같은 표기 관례)', () => {
    assert.equal(periodLabel('2026-09-22', 'week'), '9/22~9/28');
  });
  test('month 단위는 기존과 동일하게 "N월"', () => {
    assert.equal(periodLabel('2026-09', 'month'), '9월');
  });
});

describe('4개 detector가 periodUnit을 결과 insight에 그대로 태그한다', () => {
  test('명시하지 않으면 기본값 month (기존 호출부 100% 하위 호환)', () => {
    const [r] = detectRepeatInsights([{ propertyId: 'p1', propertyName: 'P1', metricKey: 'm', metricLabel: 'M', failCount: 2 }], '2026-09');
    assert.equal(r.periodUnit, 'month');
  });
  test('opts.periodUnit="week"를 넘기면 그대로 붙는다 (REPEAT/CONCENTRATION/MONTH_OVER_MONTH/CONSECUTIVE 전부)', () => {
    const [repeat] = detectRepeatInsights([{ propertyId: 'p1', propertyName: 'P1', metricKey: 'm', metricLabel: 'M', failCount: 2 }], '2026-09-22', { periodUnit: 'week' });
    const [conc] = detectConcentrationInsights([
      { propertyId: 'p1', propertyName: 'P1', metricKey: 'm', metricLabel: 'M', failCount: 3 },
    ], '2026-09-22', { periodUnit: 'week' });
    const [mom] = detectMonthOverMonthInsights(
      [{ metricKey: 'm', metricLabel: 'M', numerator: 1, denominator: 4 }],
      [{ metricKey: 'm', metricLabel: 'M', numerator: 4, denominator: 4 }],
      '2026-09-22', { periodUnit: 'week', thresholds: WEEKLY_INSIGHT_THRESHOLDS.MONTH_OVER_MONTH },
    );
    const [cons] = detectConsecutiveInsights([
      { period: '2026-09-22', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2026-09-15', metricKey: 'm', metricLabel: 'M', failCount: 1 },
    ], '2026-09-22', { periodUnit: 'week' });
    assert.equal(repeat.periodUnit, 'week');
    assert.equal(conc.periodUnit, 'week');
    assert.equal(mom.periodUnit, 'week');
    assert.equal(cons.periodUnit, 'week');
  });
});

describe('detectConsecutiveInsights — week 단위도 달력상 진짜 연속(바로 전 주)인지 확인한다', () => {
  test('중간 주가 통째로 빠지면(측정 불가) 연속으로 이어붙이지 않는다 — 월 단위와 같은 과다 주장 방지 가드', () => {
    const history = [
      { period: '2026-09-22', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      // 2026-09-15(그 전주)가 아예 없음
      { period: '2026-09-08', metricKey: 'm', metricLabel: 'M', failCount: 3 },
    ];
    const out = detectConsecutiveInsights(history, '2026-09-22', { periodUnit: 'week' });
    assert.equal(out.length, 0, '중간 주 데이터가 없는데 이어붙여 연속으로 판정하면 안 됨');
  });

  test('진짜로 연속인 3주(빠진 주 없음)는 정상 인정, evidence.periods가 월요일 키로 정확히 쌓인다', () => {
    const history = [
      { period: '2026-09-22', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2026-09-15', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { period: '2026-09-08', metricKey: 'm', metricLabel: 'M', failCount: 3 },
    ];
    const out = detectConsecutiveInsights(history, '2026-09-22', { periodUnit: 'week' });
    assert.equal(out.length, 1);
    assert.equal(out[0].evidence.consecutivePeriods, 3);
    assert.deepEqual(out[0].evidence.periods, ['2026-09-08', '2026-09-15', '2026-09-22']);
  });

  test('연도 경계를 넘는 주(12월 마지막 주 → 1월 첫 주)도 정확히 연속으로 인정한다', () => {
    // 2025-12-29(월)의 바로 다음 주 월요일은 2026-01-05
    const history = [
      { period: '2026-01-05', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2025-12-29', metricKey: 'm', metricLabel: 'M', failCount: 1 },
    ];
    const out = detectConsecutiveInsights(history, '2026-01-05', { periodUnit: 'week' });
    assert.equal(out.length, 1);
    assert.equal(out[0].evidence.consecutivePeriods, 2);
  });
});

describe('WEEKLY_INSIGHT_THRESHOLDS — 월간과 의도적으로 다른 값', () => {
  test('물량 기준(표본 수)은 월간보다 낮고, %p 변화 기준은 오히려 높다(적은 표본일수록 우연 변동폭이 큼)', () => {
    assert.ok(WEEKLY_INSIGHT_THRESHOLDS.MONTH_OVER_MONTH.MIN_CURRENT_TOTAL < 5);
    assert.ok(WEEKLY_INSIGHT_THRESHOLDS.MONTH_OVER_MONTH.MIN_DELTA_PP > 10);
  });
  test('연속 판정 최소 개수(MIN_STREAK)는 월/주 동일 — "한 번이 아니라 최소 두 번 이상"이라는 질적 기준이라 물량과 무관', () => {
    assert.equal(WEEKLY_INSIGHT_THRESHOLDS.CONSECUTIVE.MIN_STREAK, 2);
  });
});

describe('formatInsightSentence — periodUnit="week"이면 "이번 주"/"지난주"/"주 연속" 문구를 쓴다', () => {
  test('MONTH_OVER_MONTH가 "지난달" 대신 "지난주"를 쓴다', () => {
    const s = formatInsightSentence({
      type: 'MONTH_OVER_MONTH', reportPeriod: '2026-09-22', periodUnit: 'week', metricLabel: '빈방 절전 유지',
      evidence: { deltaPp: 40, previousFailRate: 0, currentFailRate: 40 },
    });
    assert.match(s, /지난주보다/);
    assert.match(s, /이번 주 40%/);
    assert.ok(!s.includes('지난달'));
  });
  test('CONSECUTIVE가 "개월" 대신 "주"를 쓴다', () => {
    const s = formatInsightSentence({
      type: 'CONSECUTIVE', reportPeriod: '2026-09-22', periodUnit: 'week', metricLabel: '청소시간 준수',
      evidence: { consecutivePeriods: 3, periods: ['2026-09-08', '2026-09-15', '2026-09-22'] },
    });
    assert.match(s, /3주 연속/);
    assert.ok(!s.includes('개월'));
  });
});

describe('describeInsightAction — week 단위는 "지난달"/"몇 달째" 대신 "지난주"/"몇 주째"', () => {
  test('MONTH_OVER_MONTH 힌트', () => {
    assert.match(describeInsightAction({ type: 'MONTH_OVER_MONTH', periodUnit: 'week', metricKey: 'cleaning_time' }), /지난주/);
  });
  test('CONSECUTIVE 힌트', () => {
    assert.match(describeInsightAction({ type: 'CONSECUTIVE', periodUnit: 'week', metricKey: 'cleaning_time' }), /몇 주째/);
  });
});

describe('buildScopeComparisonRows — week 단위는 라벨이 "지난주"/"이번 주"·주 단위 날짜 범위', () => {
  test('MONTH_OVER_MONTH', () => {
    const rows = buildScopeComparisonRows({
      type: 'MONTH_OVER_MONTH', periodUnit: 'week',
      evidence: { previousNumerator: 4, previousDenominator: 4, currentNumerator: 1, currentDenominator: 4 },
    });
    assert.deepEqual(rows.map(r => r.label), ['지난주', '이번 주']);
  });
  test('CONSECUTIVE', () => {
    const rows = buildScopeComparisonRows({
      type: 'CONSECUTIVE', periodUnit: 'week',
      evidence: { periodCounts: [{ period: '2026-09-15', failCount: 1 }, { period: '2026-09-22', failCount: 2 }] },
    });
    assert.deepEqual(rows, [{ label: '9/15~9/21', text: '1건 실패' }, { label: '9/22~9/28', text: '2건 실패' }]);
  });
});

describe('buildWeeklyInsights — WEEKLY_INSIGHT_THRESHOLDS를 쓰고 전부 periodUnit=week', () => {
  test('월간 기준으론 안 걸릴 만큼 적은 표본도 주간 기준으로는 걸린다', () => {
    // 총 실패 2건(월간 CONCENTRATION 기준 MIN_TOTAL_FAILURES=3 미달, 주간 기준=2는 통과)
    const propertyMetricRows = [
      { propertyId: 'p1', propertyName: 'P1', metricKey: 'm', metricLabel: 'M', failCount: 2 },
    ];
    const out = buildWeeklyInsights({ propertyMetricRows, currentAgg: [], previousAgg: [], periodHistory: [] }, '2026-09-22');
    assert.ok(out.some(i => i.type === 'CONCENTRATION'), 'CONCENTRATION이 주간 완화 기준으로 감지돼야 함');
    assert.ok(out.every(i => i.periodUnit === 'week'));
  });
});

// ── L2: getWeeklyInsights 오케스트레이션 ─────────────────────────────────────────
describe('getWeeklyInsights — period 게이트 + 숙소 스코프 파생 + DB 조합', () => {
  test('this_week/last_week가 아니면 DB를 전혀 건드리지 않고 빈 배열', async () => {
    const forbiddenDb = { query: async () => { throw new Error('주간이 아닌데 DB를 호출함'); } };
    assert.deepEqual(await getWeeklyInsights('this_month', { db: forbiddenDb }), []);
    assert.deepEqual(await getWeeklyInsights('weeks_ago_2', { db: forbiddenDb }), []);
  });

  const FIXED_EVENTS = [
    ...Array(4).fill({ property_id: 'p1', type: 'checkin_prep_time_reached' }),
    ...Array(2).fill({ property_id: 'p1', type: 'optimization_finished' }),
    { property_id: 'p2', type: 'checkin_prep_time_reached' },
  ];
  function makeDb(calls) {
    return {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM events/.test(sql)) return { rows: FIXED_EVENTS };
        return { rows: [] };
      },
    };
  }

  test('이벤트 조회를 INSIGHT_LOOKBACK_WEEKS(4)만큼 반복 호출한다', async () => {
    const calls = [];
    await getWeeklyInsights('this_week', { db: makeDb(calls), now: new Date('2026-09-28T00:00:00Z') });
    assert.equal(calls.filter(c => /FROM events/.test(c.sql)).length, 4);
  });

  test('this_week — 매주 같은 실패가 반복되는 목업 → CONCENTRATION+CONSECUTIVE+REPEAT, periodKey는 "this_week" 그대로', async () => {
    const out = await getWeeklyInsights('this_week', { db: makeDb([]), now: new Date('2026-09-28T00:00:00Z') });
    assert.equal(out.length, 3);
    assert.ok(out.every(i => i.periodKey === 'this_week'));
    assert.ok(out.every(i => i.periodUnit === 'week'));
    assert.ok(out.some(i => i.type === 'CONCENTRATION'));
    assert.ok(out.some(i => i.type === 'CONSECUTIVE'));
    assert.ok(out.some(i => i.type === 'REPEAT'));
  });

  test('last_week는 reportPeriod가 지난주 월요일로 밀리고 periodKey도 "last_week"', async () => {
    const out = await getWeeklyInsights('last_week', { db: makeDb([]), now: new Date('2026-09-28T00:00:00Z') }); // 2026-09-28은 월요일
    assert.ok(out.every(i => i.periodKey === 'last_week'));
    assert.ok(out.every(i => i.reportPeriod === '2026-09-21'));
  });
});

// ── L2: 소스 계약 ─────────────────────────────────────────────────────────────
describe('api/stats.js — this_week/last_week도 insights를 자체 try/catch로 붙인다', () => {
  const src = read('api/stats.js');
  test('getWeeklyInsights를 import하고 this_week/last_week 분기에서 호출, 실패해도 stats는 살린다', () => {
    assert.match(src, /import\s*\{[^}]*getWeeklyInsights[^}]*\}\s*from\s*"\.\.\/src\/application\/reportingService\.js"/);
    assert.match(src, /else if \(period === "this_week" \|\| period === "last_week"\) \{/);
    assert.match(src, /result\.insights = await getWeeklyInsights\(period, \{ db, propertyIds \}\);/);
    assert.match(src, /getWeeklyInsights 실패 — insights 없이 응답/);
  });
});

describe('PropertyListView.jsx — insights를 SummaryBanner로 전달하고 handleSelectRoom을 공유한다 (D-029)', () => {
  const src = read('src/components/v2/PropertyListView.jsx');
  test('useReportingStats에서 insights를 구조분해한다', () => {
    assert.match(src, /const \{ stats: periodStats, summary, insights, loading: periodLoading \} = useReportingStats/);
  });
  test('handleSelectRoom이 day offset을 계산해 onSelectProperty(prop, dayOffset)로 넘긴다', () => {
    assert.match(src, /const dayOffset = occurredAt != null \? kstDayOffsetFromToday\(toKstDateKey\(occurredAt\)\) : null;/);
    assert.match(src, /onSelectProperty\?\.\(prop, dayOffset\)/);
  });
  test('SummaryBanner와 ReportPanel 둘 다 같은 handleSelectRoom·insights를 쓴다', () => {
    assert.match(src, /<SummaryBanner[\s\S]{0,120}insights=\{insights\}[\s\S]{0,120}onSelectRoom=\{handleSelectRoom\}/);
    assert.match(src, /onSelectRoom=\{handleSelectRoom\}/);
    const occurrences = [...src.matchAll(/handleSelectRoom/g)];
    assert.ok(occurrences.length >= 3, '정의부 + SummaryBanner + ReportPanel 최소 3번 등장해야 함');
  });
});
