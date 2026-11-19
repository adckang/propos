/**
 * s124 — RF-26 (사용자 승인 2026-11-17): 판정 기록이 없는 4개 지표는 안심지수 점수·요약 등급·성공률·
 * 전월(전주) 대비에서만 뺀다. 실제로 감지된 실패는 실패 배지·"실패 N건"·반복·쏠림·연속 패턴·상세 목록·
 * 달력에 그대로 남긴다.
 *
 * 4개 지표(퇴실 후 절전·퇴실 후 보안·빈방 절전 유지·빈방 보안 유지)는 "대상 수 − 실패 기록 수"로 성공을
 * 거꾸로 세는데, 실패 이벤트를 만드는 코드가 DEMO 데이터뿐이라 실패를 놓치면 그만큼 성공으로 센다.
 * 그래서 지표마다 두 값을 나눈다 — rateEligibility(성공률을 계산해도 되는지)와 observedFailCount
 * (실제로 감지된 실패 건수). 계약 정본: docs/report-architecture.md#safety-index-exclusions.
 *
 * 레이어: L1 = 도메인 함수 실제 실행 / L2 = reportingService 오케스트레이션을 가짜 DB로 실행 + 소스 계약.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  RATE_ELIGIBILITY,
  RATE_EXCLUDED_METRIC_KEYS,
  computeOperationalMetrics,
  computeMeasurableMetrics,
  computeObservedFailures,
  computeSafetyIndex,
  describeSafetyIndexBasis,
  summarizeOperationalMetrics,
} from '../../src/domain/operationalMetricsDomain.js';
import { computeMetricRowDisplay } from '../../src/domain/metricRowDomain.js';
import { isUrgentSummary } from '../../src/domain/reportSummaryDomain.js';
import { generateSummary, getMonthlyInsights, getWeeklyInsights } from '../../src/application/reportingService.js';
import { getDemoStats } from '../../src/application/demoReportingService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const EXCLUDED = ['post_checkout_energy', 'post_checkout_security', 'vacant_energy', 'post_cleaning_security'];

// s62와 같은 예시 숫자 (지표 순서대로 92/83/92/75/92/83/100%)
const EXAMPLE_STATS = {
  preStayOptimized: 11, preStayAttempts: 12,
  checkOuts: 12, postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1,
  cleaningFinished: 12, vacantEnergyWaste: 3, postCleaningSecurityBreach: 1,
  cleaningOnTime: 10,
  cleaningAssigned: 12, cleaningCreated: 12,
};

const NOW_FIXED = new Date('2026-11-17T03:00:00Z');
const NO_RATE_SUMMARY_FIXTURE = { checkOuts: 2, postCheckoutEnergyWaste: 1, cleaningCreated: 0, cleaningAssigned: 0 };
const byKey = (rows) => Object.fromEntries(rows.map(r => [r.key, r]));

describe('RF-26 · rateEligibility — 성공률을 계산해도 되는지', () => {
  test('측정 제외 목록은 4개 지표 한 곳에만 있다', () => {
    assert.deepEqual([...RATE_EXCLUDED_METRIC_KEYS].sort(), [...EXCLUDED].sort());
  });

  test('4개 지표는 데이터와 상관없이 excluded, 나머지는 eligible', () => {
    const m = byKey(computeOperationalMetrics(EXAMPLE_STATS));
    for (const key of EXCLUDED) assert.equal(m[key].rateEligibility, RATE_ELIGIBILITY.EXCLUDED, key);
    for (const key of ['pre_stay_optimization', 'cleaning_time', 'cleaning_assign']) {
      assert.equal(m[key].rateEligibility, RATE_ELIGIBILITY.ELIGIBLE, key);
    }
  });

  test('대상 없음(분모 0)과 데이터 없음(값을 못 불러옴)을 나눈다', () => {
    const none = byKey(computeOperationalMetrics({ ...EXAMPLE_STATS, cleaningCreated: 0, cleaningAssigned: 0 }));
    assert.equal(none.cleaning_assign.rateEligibility, RATE_ELIGIBILITY.NO_TARGET);
    const failed = byKey(computeOperationalMetrics({ ...EXAMPLE_STATS, cleaningCreated: null, cleaningAssigned: null }));
    assert.equal(failed.cleaning_assign.rateEligibility, RATE_ELIGIBILITY.NO_DATA, '청소 데이터 조회 실패는 "대상 없음"이 아니다');
    const partial = byKey(computeOperationalMetrics({ ...EXAMPLE_STATS, cleaningCreated: 4, cleaningAssigned: null }));
    assert.equal(partial.cleaning_assign.rateEligibility, RATE_ELIGIBILITY.NO_DATA);
    const noPrep = byKey(computeOperationalMetrics({ ...EXAMPLE_STATS, preStayAttempts: 0, preStayOptimized: 0 }));
    assert.equal(noPrep.pre_stay_optimization.rateEligibility, RATE_ELIGIBILITY.NO_TARGET);
  });

  test('측정 제외 지표는 대상이 0이어도 excluded가 먼저다', () => {
    const m = byKey(computeOperationalMetrics({ checkOuts: 0, cleaningFinished: 0 }));
    for (const key of EXCLUDED) assert.equal(m[key].rateEligibility, RATE_ELIGIBILITY.EXCLUDED, key);
  });
});

describe('RF-26 · observedFailCount — 실제로 감지된 실패', () => {
  test('4개 지표는 실패 이벤트 수 그대로 — 퇴실 수보다 많거나 퇴실이 0이어도 숨기지 않는다', () => {
    const m = byKey(computeOperationalMetrics({ checkOuts: 1, postCheckoutEnergyWaste: 3, postCheckoutSecurityBreach: 2, cleaningFinished: 0, vacantEnergyWaste: 1 }));
    assert.equal(m.post_checkout_energy.observedFailCount, 3, '상세 목록은 실패 이벤트를 하나씩 센다 — 배지도 같은 수');
    assert.equal(m.post_checkout_security.observedFailCount, 2);
    assert.equal(m.vacant_energy.observedFailCount, 1, '청소 완료가 0이어도 감지된 실패는 남긴다');
    assert.equal(m.post_cleaning_security.observedFailCount, 0);
  });

  test('성공률 대상 지표는 분모 − 분자, 대상 없음은 0, 데이터 없음은 알 수 없음(null)', () => {
    const m = byKey(computeOperationalMetrics({ ...EXAMPLE_STATS, cleaningCreated: null, cleaningAssigned: null, preStayAttempts: 0, preStayOptimized: 0 }));
    assert.equal(m.cleaning_time.observedFailCount, 2);
    assert.equal(m.pre_stay_optimization.observedFailCount, 0);
    assert.equal(m.cleaning_assign.observedFailCount, null);
  });

  test('computeObservedFailures는 4개 지표를 포함하고 데이터 없음만 뺀다', () => {
    const rows = byKey(computeObservedFailures({ ...EXAMPLE_STATS, cleaningAssigned: null }));
    for (const key of EXCLUDED) assert.ok(rows[key], key);
    assert.equal(rows.vacant_energy.failCount, 3);
    assert.ok(!rows.cleaning_assign, '데이터 없음은 실패 0건으로 세지 않는다');
  });
});

describe('RF-26 · 점수·등급·성공률은 비율 대상만, 실패 합계는 실제 실패 전부', () => {
  test('computeMeasurableMetrics(성공률 목록)에는 4개 지표가 없다', () => {
    const keys = computeMeasurableMetrics(EXAMPLE_STATS).map(m => m.key);
    assert.deepEqual(keys, ['pre_stay_optimization', 'cleaning_time', 'cleaning_assign']);
  });

  test('안심지수는 비율 대상 3개 평균이고 빠진 이유를 나눠 센다', () => {
    const safety = computeSafetyIndex(EXAMPLE_STATS);
    assert.equal(safety.score, 92, '(91.67 + 83.33 + 100) / 3 = 91.67 → 92');
    assert.equal(safety.excluded, 4);
    assert.equal(safety.noTarget, 0);
    assert.equal(safety.noData, 0);
  });

  test('표 아래 설명은 측정 제외·대상 없음·데이터 없음을 나눠 적는다', () => {
    assert.equal(describeSafetyIndexBasis(computeSafetyIndex(EXAMPLE_STATS)),
      '측정가능 3개 지표 평균 · 4개는 판정 기록이 없어 측정 제외');
    assert.equal(describeSafetyIndexBasis(computeSafetyIndex({ ...EXAMPLE_STATS, cleaningAssigned: null, preStayAttempts: 0, preStayOptimized: 0 })),
      '측정가능 1개 지표 평균 · 4개는 판정 기록이 없어 측정 제외 · 1개는 이 기간 대상 없음 · 1개는 데이터를 못 불러와 제외');
  });

  test('요약 등급은 비율 대상 점수로, "(실패 N건)"은 4개 지표의 실제 실패까지 센다', () => {
    // 점수 92 → 양호해요 (예전엔 7개 평균 88 → 보통이에요). 실패 = 1+2+1+3+1+2+0 = 10
    assert.equal(summarizeOperationalMetrics('last_week', EXAMPLE_STATS), '지난주 양호해요 (실패 10건)');
  });

  test('비율 대상이 모두 100%여도 4개 지표에 실제 실패가 있으면 "완벽해요"가 아니다', () => {
    const s = summarizeOperationalMetrics('last_week', {
      preStayOptimized: 5, preStayAttempts: 5, cleaningCreated: 0, cleaningAssigned: 0,
      checkOuts: 5, postCheckoutEnergyWaste: 2,
    });
    assert.equal(s, '지난주 양호해요 (실패 2건)');
  });

  test('계산 가능한 지표가 0개면 점수 없음 — 실제 실패가 있어도 "완벽해요"는 나오지 않는다', () => {
    const stats = { checkOuts: 2, postCheckoutEnergyWaste: 1, cleaningCreated: 0, cleaningAssigned: 0 };
    assert.equal(computeSafetyIndex(stats).score, null);
    const s = summarizeOperationalMetrics('last_week', stats);
    assert.ok(s == null || !s.includes('완벽해요'), `완벽해요가 나오면 안 된다: ${s}`);
  });

  // 사용자 결정(2026-11-17): 계산 가능한 지표 0개 + 실제 실패 → "지난주 실패 1건이 있었어요"(진행 중 기간은 "있어요")
  const NO_RATE_WITH_FAILURE = { checkOuts: 2, postCheckoutEnergyWaste: 1, cleaningCreated: 0, cleaningAssigned: 0 };

  test('계산 가능한 지표가 0개인데 실제 실패가 있으면 실패를 말한다 — 지난 기간은 "있었어요"', () => {
    assert.equal(summarizeOperationalMetrics('last_week', NO_RATE_WITH_FAILURE), '지난주 실패 1건이 있었어요.');
    assert.equal(summarizeOperationalMetrics('yesterday', NO_RATE_WITH_FAILURE), '어제 실패 1건이 있었어요.');
    assert.equal(summarizeOperationalMetrics('last_month', NO_RATE_WITH_FAILURE), '지난달 실패 1건이 있었어요.');
  });

  test('진행 중 기간은 "있어요"', () => {
    assert.equal(summarizeOperationalMetrics('this_week', NO_RATE_WITH_FAILURE), '이번 주 실패 1건이 있어요.');
    assert.equal(summarizeOperationalMetrics('this_month', NO_RATE_WITH_FAILURE), '이번 달 실패 1건이 있어요.');
  });

  test('요약 전체에서도 실패를 숨기지 않는다 — "이상 없었어요"로 대체되지 않는다', () => {
    const s = generateSummary('last_week', { checkIns: 1, anomalies: 0, ...NO_RATE_WITH_FAILURE });
    assert.equal(s, '지난주 실패 1건이 있었어요.');
    assert.ok(!s.includes('이상 없었어요'));
  });

  test('계산 가능한 지표도 실제 실패도 없으면 기존 문장 그대로(새 문장 없음)', () => {
    assert.equal(summarizeOperationalMetrics('last_week', { checkOuts: 2, cleaningCreated: 0, cleaningAssigned: 0 }), null);
  });
});

describe('RF-26 · 요약 배너 색 — 새 문장에만 경고색, 기존 등급 색 규칙은 그대로', () => {
  test('계산 가능한 지표 0개 + 실제 실패 문장은 빨간 경고', () => {
    assert.equal(isUrgentSummary('지난주 실패 1건이 있었어요.'), true);
    assert.equal(isUrgentSummary('이번 주 실패 3건이 있어요.'), true);
    assert.equal(isUrgentSummary('지난주 실패 1건이 있었어요. 노쇼 의심 1건 확인이 필요해요.'), true);
  });

  test('"양호해요·보통이에요·완벽해요 (실패 N건)"은 경고가 아니다 — 괄호 안 실패 건수로 색을 바꾸지 않는다', () => {
    assert.equal(isUrgentSummary('지난주 양호해요 (실패 3건)'), false);
    assert.equal(isUrgentSummary('지난주 보통이에요 (실패 8건)'), false);
    assert.equal(isUrgentSummary('지난주 완벽해요 (실패 0건)'), false);
  });

  test('기존 경고 규칙은 그대로 — 불안정해요·이상감지 1건 이상은 경고, 이상감지 0건·이상 없었어요는 아님', () => {
    assert.equal(isUrgentSummary('지난주 조금 불안정해요 (실패 5건)'), true);
    assert.equal(isUrgentSummary('지난주 아주 불안정해요 (실패 9건)'), true);
    assert.equal(isUrgentSummary('지난주 체크인 3건 완료, 이상감지 2건이 있었어요.'), true);
    assert.equal(isUrgentSummary('지난주 체크인 3건 완료, 이상감지 0건이 있었어요.'), false);
    assert.equal(isUrgentSummary('지난주 체크인 3건 완료, 이상 없었어요.'), false);
  });

  test('요약 문장이 실제로 만든 결과로 확인 — 새 문장은 경고, 같은 기간의 등급 문장은 아님', () => {
    assert.equal(isUrgentSummary(summarizeOperationalMetrics('last_week', NO_RATE_SUMMARY_FIXTURE)), true);
    assert.equal(isUrgentSummary(summarizeOperationalMetrics('last_week', EXAMPLE_STATS)), false, '양호해요 (실패 10건)');
  });
});

describe('RF-26 · 표 행 — 4개 행은 숨기지 않고 성공률만 "측정 제외"', () => {
  test('측정 제외 행: 대상 건수와 실제 실패 배지는 그대로, 성공률 칸만 "측정 제외"', () => {
    const d = computeMetricRowDisplay({ numerator: 10, denominator: 12, rateExcluded: true, observedFailCount: 2 });
    assert.equal(d.ratioText, '측정 제외');
    assert.equal(d.countText, '12건');
    assert.equal(d.failCount, 2);
  });

  test('측정 제외 행은 대상이 0이어도 대상 건수 "0건"과 감지된 실패 배지를 숨기지 않는다', () => {
    const d = computeMetricRowDisplay({ numerator: 0, denominator: 0, rateExcluded: true, observedFailCount: 1 });
    assert.equal(d.countText, '0건', '대상 건수를 유지한다는 계약 — "—"가 아니다');
    assert.equal(d.ratioText, '측정 제외');
    assert.equal(d.failCount, 1);
  });

  test('값을 못 불러온 행은 "데이터 없음", 대상이 없는 행은 "해당 없음", 로딩은 "준비 중" — 세 상태를 나눈다', () => {
    assert.equal(computeMetricRowDisplay({ numerator: null, denominator: null, dataUnavailable: true }).ratioText, '데이터 없음');
    assert.equal(computeMetricRowDisplay({ numerator: 0, denominator: 0 }).ratioText, '해당 없음');
    assert.equal(computeMetricRowDisplay({ numerator: null, denominator: null, noData: true }).ratioText, '준비 중');
    assert.equal(computeMetricRowDisplay({ numerator: null, denominator: null, dataUnavailable: true }).failCount, 0);
  });

  test('표에 그려지는 행 결과로 확인 — 청소 데이터 조회 실패는 "데이터 없음", 청소 일정 0건은 "해당 없음"', () => {
    const display = (stats, key) => {
      const m = computeOperationalMetrics(stats).find(r => r.key === key);
      return computeMetricRowDisplay({
        numerator: m.numerator, denominator: m.denominator,
        rateExcluded: m.rateEligibility === RATE_ELIGIBILITY.EXCLUDED,
        dataUnavailable: m.rateEligibility === RATE_ELIGIBILITY.NO_DATA,
        observedFailCount: m.observedFailCount,
      });
    };
    assert.equal(display({ ...EXAMPLE_STATS, cleaningCreated: null, cleaningAssigned: null }, 'cleaning_assign').ratioText, '데이터 없음');
    assert.equal(display({ ...EXAMPLE_STATS, cleaningCreated: 0, cleaningAssigned: 0 }, 'cleaning_assign').ratioText, '해당 없음');
    assert.equal(display({ checkOuts: 0, postCheckoutEnergyWaste: 2 }, 'post_checkout_energy').countText, '0건');
    assert.equal(display({ checkOuts: 0, postCheckoutEnergyWaste: 2 }, 'post_checkout_energy').failCount, 2);
  });

  test('비율 대상 행도 도메인이 넘긴 실제 실패 수를 배지에 쓴다(요약·패턴과 같은 출처)', () => {
    const d = computeMetricRowDisplay({ numerator: 10, denominator: 12, observedFailCount: 3 });
    assert.equal(d.failCount, 3);
    assert.equal(d.ratioText, '83%');
  });

  test('비율 대상 행은 예전과 같다', () => {
    const d = computeMetricRowDisplay({ numerator: 11, denominator: 12 });
    assert.equal(d.ratioText, '92%');
    assert.equal(d.countText, '11/12건');
    assert.equal(d.failCount, 1);
  });

  test('표(EventMatrixPanel)는 rateEligibility·observedFailCount를 행에 넘긴다', () => {
    const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');
    assert.match(src, /rateExcluded=\{rateEligibility === RATE_ELIGIBILITY\.EXCLUDED\}/);
    assert.match(src, /dataUnavailable=\{rateEligibility === RATE_ELIGIBILITY\.NO_DATA\}/);
    assert.match(src, /observedFailCount=\{observedFailCount\}/);
    const row = read('src/components/v2/reporting/SharedMetricRow.jsx');
    assert.match(row, /computeMetricRowDisplay\(\{[^}]*rateExcluded[^}]*observedFailCount[^}]*\}\)/);
  });
});

describe('RF-26 · 발견된 패턴 — 전월 대비만 비율 대상, 반복·쏠림·연속은 실제 실패', () => {
  // getMonthlyInsights 를 가짜 DB 로 실행한다(s63 과 같은 방식). 이번 달(2026-09)과 그 전 달들을 날짜로 가른다.
  const CURRENT_MONTH_FROM = Date.parse('2026-08-31T15:00:00Z'); // 2026-09-01 00:00 KST
  const NOW = new Date('2026-09-28T00:00:00Z');

  function makeDb(eventsFor) {
    return {
      query: async (sql, params) => {
        if (/FROM events/.test(sql)) {
          const from = params.find(value => value instanceof Date);
          const isCurrent = from.getTime() >= CURRENT_MONTH_FROM;
          return { rows: eventsFor(isCurrent).map(({ hour, ...e }) => ({ ...e, device_time: new Date(from.getTime() + hour * 3_600_000) })) };
        }
        return { rows: [] };
      },
    };
  }
  const checkouts = (property, n) => Array.from({ length: n }, (_, i) => ({ property_id: property, type: 'check_out_detected', hour: 1 + i * 2 }));
  const failures = (property, n) => Array.from({ length: n }, (_, i) => ({ property_id: property, type: 'post_checkout_energy_waste_detected', hour: 1.5 + i * 2 }));

  test('실패율이 크게 바뀌어도 4개 지표는 전월 대비 패턴을 만들지 않는다', async () => {
    // 이번 달 퇴실 6건 모두 실패, 지난달 퇴실 6건 실패 0 — 예전엔 "지난달 대비 +100%p"가 나왔다
    const db = makeDb(isCurrent => [...checkouts('p1', 6), ...(isCurrent ? failures('p1', 6) : [])]);
    const out = await getMonthlyInsights('this_month', { db, now: NOW });
    assert.ok(!out.some(i => i.type === 'MONTH_OVER_MONTH' && i.metricKey === 'post_checkout_energy'), JSON.stringify(out));
  });

  test('실제 실패는 반복·쏠림·연속 패턴에 그대로 남는다', async () => {
    const db = makeDb(() => [...checkouts('p1', 3), ...failures('p1', 3), ...checkouts('p2', 1)]);
    const out = await getMonthlyInsights('this_month', { db, now: NOW });
    const types = out.filter(i => i.metricKey === 'post_checkout_energy').map(i => i.type).sort();
    assert.deepEqual(types, ['CONCENTRATION', 'CONSECUTIVE', 'REPEAT'], JSON.stringify(out));
  });

  test('성공률 대상 지표는 전월 대비 패턴이 그대로 나온다(분리가 비율 패턴을 지우지 않는다)', async () => {
    // 게스트 맞이 준비: 이번 달 준비 6건 모두 미완료(입실로 닫힘), 지난달까지 6건 모두 완료
    const prep = (isCurrent) => [1, 3, 5, 7, 9, 11].flatMap(h => [
      { property_id: 'p1', type: 'checkin_prep_time_reached', hour: h },
      isCurrent ? { property_id: 'p1', type: 'check_in_detected', hour: h + 1 } : { property_id: 'p1', type: 'optimization_finished', hour: h + 0.5 },
    ]);
    const out = await getMonthlyInsights('this_month', { db: makeDb(prep), now: NOW });
    assert.ok(out.some(i => i.type === 'MONTH_OVER_MONTH' && i.metricKey === 'pre_stay_optimization'), JSON.stringify(out));
  });

  test('reportingService는 비율 목록과 실패 목록을 따로 넘긴다', () => {
    const src = read('src/application/reportingService.js');
    const inputs = src.slice(src.indexOf('async function buildInsightDetectorInputs'), src.indexOf('return { propertyMetricRows, currentAgg, previousAgg, periodHistory };'));
    assert.match(inputs, /const currentAgg\s*= current\.metrics\.map\(toAggRow\)/);
    assert.match(inputs, /const previousAgg = previous\.metrics\.map\(toAggRow\)/);
    assert.match(inputs, /periodDataList\.flatMap\(\(\{ period, failures \}\) =>\s*failures\.map\(/);
    assert.match(inputs, /for \(const m of computeObservedFailures\(stats\)\) \{\s*propertyMetricRows\.push/);
    assert.match(src, /metrics: computeMeasurableMetrics\(stats\), failures: computeObservedFailures\(stats\)/);
  });
});

describe('RF-26 · 주간 발견된 패턴도 같은 규칙', () => {
  // getWeeklyInsights('last_week') — 지난주(2026-09-21 월 00:00 KST 시작)와 그 전 주들을 날짜로 가른다
  const LAST_WEEK_FROM = Date.parse('2026-09-20T15:00:00Z');
  const NOW_W = new Date('2026-09-28T03:00:00Z');
  function makeWeekDb(eventsFor) {
    return {
      query: async (sql, params) => {
        if (/FROM events/.test(sql)) {
          const from = params.find(value => value instanceof Date);
          const isCurrent = from.getTime() === LAST_WEEK_FROM;
          return { rows: eventsFor(isCurrent).map(({ hour, ...e }) => ({ ...e, device_time: new Date(from.getTime() + hour * 3_600_000) })) };
        }
        return { rows: [] };
      },
    };
  }
  const co = (property, n) => Array.from({ length: n }, (_, i) => ({ property_id: property, type: 'check_out_detected', hour: 1 + i * 2 }));
  const fail = (property, n) => Array.from({ length: n }, (_, i) => ({ property_id: property, type: 'post_checkout_energy_waste_detected', hour: 1.5 + i * 2 }));

  test('주간: 4개 지표는 전주 대비 패턴을 만들지 않는다', async () => {
    const out = await getWeeklyInsights('last_week', { db: makeWeekDb(isCurrent => [...co('p1', 4), ...(isCurrent ? fail('p1', 4) : [])]), now: NOW_W });
    assert.ok(!out.some(i => i.type === 'MONTH_OVER_MONTH' && i.metricKey === 'post_checkout_energy'), JSON.stringify(out));
  });

  test('주간: 실제 실패는 반복·쏠림·연속 패턴에 남는다', async () => {
    const out = await getWeeklyInsights('last_week', { db: makeWeekDb(() => [...co('p1', 3), ...fail('p1', 3), ...co('p2', 1)]), now: NOW_W });
    const types = out.filter(i => i.metricKey === 'post_checkout_energy').map(i => i.type).sort();
    assert.deepEqual(types, ['CONCENTRATION', 'CONSECUTIVE', 'REPEAT'], JSON.stringify(out));
  });
});

describe('RF-26 · DEMO·개발 스텁도 같은 계산 계약', () => {
  test('DEMO 지난주 요약은 도메인 함수 결과 그대로이고 4개 지표가 점수에서 빠진다', () => {
    const { stats, summary } = getDemoStats('last_week', { now: NOW_FIXED });
    assert.ok(summary.startsWith(summarizeOperationalMetrics('last_week', stats)), summary);
    assert.equal(computeSafetyIndex(stats).excluded, 4);
  });

  test('개발 스텁은 자체 계산 없이 실제 레포트 API(DEMO 분기 → DEMO 서비스)를 부른다', () => {
    const src = read('vite.config.mjs');
    assert.match(src, /runDemoApiHandler\(req, res, '\.\/api\/stats\.js'\)/);
    assert.ok(!/summarizeOperationalMetrics|computeSafetyIndex/.test(src));
  });
});
