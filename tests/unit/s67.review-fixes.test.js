/**
 * s67 — D-027~D-029 코드 리뷰(/code-review xhigh)로 발견된 버그·개선사항 수정 확인 (2026-09-28)
 *
 * 사용자 요청: "월간. 주간. 오늘 구현한부분 아주 면밀히 테스트하고 엄격하게 검수하고 리뷰해."
 * 5개 병렬 리뷰 에이전트가 서로 다른 각도(diff 라인별/제거된 동작/파일 간 추적/언어 함정/
 * 단순화)로 훑어서 찾은 것 중 실제로 검증된 항목:
 *
 *   1. (실사용 버그) api/stats.js의 VALID_DRILLDOWN_PERIODS에 "this_week"가 빠져 있었다 —
 *      ListView의 기본 화면인 "이번주"에서 REPEAT/CONCENTRATION 인사이트 팝업을 열면 프로덕션
 *      에서 400이 났을 것(로컬 dev 스텁은 기간 검증을 안 해서 안 드러났음).
 *   2. (실사용 버그) InsightDrilldownSheet의 scope_comparison 팝업 제목이 타입·periodUnit과
 *      무관하게 항상 "— 전월 대비"로 고정돼 있었다 — 주간 MONTH_OVER_MONTH는 "전주" 대신
 *      "전월"이라 틀린 말을, CONSECUTIVE는 2점 비교가 아닌 N기간 추이인데 "대비"라고 잘못 표현.
 *   3. cleaning_jobs 숙소별 집계 실패 로그에 호출자 구분(logLabel)이 빠져 있었다.
 *   4. computeAggregateMetricsForRange가 서로 독립적인 이벤트/청소잡 조회를 순차 await하고 있었다.
 *   5. buildMonthlyInsights/buildWeeklyInsights가 4-detector 파이프라인을 각각 따로 갖고 있어
 *      periodUnit 옵션을 만든 원래 취지(월/주 로직 분리 방지)가 이 두 함수 선에서는 안 지켜짐.
 *
 * 레이어: L1(insightActionGuideDomain의 새 함수, insightDomain의 통합 파이프라인 동등성) /
 * L2(api/stats.js 소스 계약, reportingService.js의 병렬화·로그 계약).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describeScopeComparisonTitle } from '../../src/domain/insightActionGuideDomain.js';
import { buildMonthlyInsights, buildWeeklyInsights } from '../../src/domain/insightDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── 버그 1: this_week 드릴다운 검증 ────────────────────────────────────────────
describe('api/stats.js — VALID_DRILLDOWN_PERIODS에 this_week가 있다 (ListView 기본 화면 팝업 400 버그 수정)', () => {
  const src = read('api/stats.js');
  test('배열 리터럴에 "this_week"가 포함된다', () => {
    const m = src.match(/const VALID_DRILLDOWN_PERIODS = \[([\s\S]*?)\];/);
    assert.ok(m, 'VALID_DRILLDOWN_PERIODS 정의를 찾지 못함');
    assert.match(m[1], /"this_week"/);
  });
});

// ── 버그 2: scope_comparison 팝업 제목 ─────────────────────────────────────────
describe('describeScopeComparisonTitle — 타입·periodUnit에 맞는 제목 접미사', () => {
  test('MONTH_OVER_MONTH + month → " — 전월 대비"', () => {
    assert.equal(describeScopeComparisonTitle({ type: 'MONTH_OVER_MONTH', periodUnit: 'month' }), ' — 전월 대비');
  });
  test('MONTH_OVER_MONTH + week → " — 전주 대비" (이전엔 항상 "전월"이라 틀린 말을 했음)', () => {
    assert.equal(describeScopeComparisonTitle({ type: 'MONTH_OVER_MONTH', periodUnit: 'week' }), ' — 전주 대비');
  });
  test('CONSECUTIVE + month → " — 월별 추이" (2점 비교가 아니라 N기간 추이라 "대비"가 아님)', () => {
    assert.equal(describeScopeComparisonTitle({ type: 'CONSECUTIVE', periodUnit: 'month' }), ' — 월별 추이');
  });
  test('CONSECUTIVE + week → " — 주별 추이"', () => {
    assert.equal(describeScopeComparisonTitle({ type: 'CONSECUTIVE', periodUnit: 'week' }), ' — 주별 추이');
  });
  test('periodUnit 생략 시 month로 취급', () => {
    assert.equal(describeScopeComparisonTitle({ type: 'MONTH_OVER_MONTH' }), ' — 전월 대비');
  });
});

describe('InsightDrilldownSheet.jsx — scope_comparison 제목이 하드코딩이 아니라 describeScopeComparisonTitle을 쓴다', () => {
  const src = read('src/components/v2/reporting/InsightDrilldownSheet.jsx');
  test('describeScopeComparisonTitle(insight)를 metricLabel에 이어붙인다', () => {
    assert.match(src, /import\s*DrilldownSheet[\s\S]*?describeScopeComparisonTitle[\s\S]*?from '\.\.\/\.\.\/\.\.\/domain\/insightActionGuideDomain\.js'/);
    assert.match(src, /metricLabel=\{`\$\{insight\.metricLabel\}\$\{describeScopeComparisonTitle\(insight\)\}`\}/);
    assert.ok(!src.includes('전월 대비`'), '하드코딩된 "전월 대비" 문자열이 여전히 남아있음');
  });
});

// ── 개선 3·4: reportingService.js 로그 라벨 + 병렬화 ─────────────────────────────
describe('reportingService.js — cleaning_jobs 실패 로그에 호출자(logLabel)가 항상 찍힌다', () => {
  const src = read('src/application/reportingService.js');
  test('buildInsightDetectorInputs가 logLabel 매개변수를 받고 로그에 쓴다', () => {
    assert.match(src, /async function buildInsightDetectorInputs\(db, periodDataList, propertyIds, logLabel\)/);
    assert.match(src, /console\.error\(`\[reportingService\] \$\{logLabel\} 숙소별 cleaning_jobs 집계 실패:`/);
  });
  test('getMonthlyInsights/getWeeklyInsights 둘 다 자기 이름을 logLabel로 넘긴다', () => {
    assert.match(src, /buildInsightDetectorInputs\(db, monthDataList, propertyIds, "getMonthlyInsights"\)/);
    assert.match(src, /buildInsightDetectorInputs\(db, weekDataList, propertyIds, "getWeeklyInsights"\)/);
  });
});

describe('reportingService.js — computeAggregateMetricsForRange가 이벤트·청소잡 조회를 병렬로 실행한다', () => {
  const src = read('src/application/reportingService.js');
  test('Promise.all로 queryEvents와 queryCleaningJobCounts를 동시에 부른다', () => {
    const start = src.indexOf('async function computeAggregateMetricsForRange');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /Promise\.all\(\[/);
    assert.match(block, /queryEvents\(db, \{ from, to \}, propertyIds\)/);
    assert.match(block, /queryCleaningJobCounts\(db, \{ from, to \}, propertyIds\)/);
  });
  test('청소잡 조회가 실패해도(reject) events 결과는 살아있다 — try/catch 의미가 유지된다', () => {
    const start = src.indexOf('async function computeAggregateMetricsForRange');
    const end = src.indexOf('\n}', start);
    const block = src.slice(start, end);
    assert.match(block, /\.catch\(err => \(\{ ok: false, err \}\)\)/);
    assert.match(block, /if \(jobsResult\.ok\)/);
  });
});

// ── 개선 5: buildMonthlyInsights/buildWeeklyInsights 파이프라인 통합 ──────────────
describe('buildMonthlyInsights/buildWeeklyInsights — 내부 공용 파이프라인을 재사용한다(월/주 별도 구현 아님)', () => {
  const src = read('src/domain/insightDomain.js');
  test('두 export 함수 모두 private buildInsights(data, reportPeriod, opts) 한 줄 호출이다', () => {
    assert.match(src, /function buildInsights\(data, reportPeriod, \{ periodUnit, thresholds \} = \{\}\)/);
    assert.match(src, /export function buildMonthlyInsights\(data, reportPeriod\) \{\s*\n\s*return buildInsights\(data, reportPeriod, \{ periodUnit: 'month', thresholds: INSIGHT_THRESHOLDS \}\);\s*\n\}/);
    assert.match(src, /export function buildWeeklyInsights\(data, reportPeriod\) \{\s*\n\s*return buildInsights\(data, reportPeriod, \{ periodUnit: 'week', thresholds: WEEKLY_INSIGHT_THRESHOLDS \}\);\s*\n\}/);
  });

  test('동작 동등성 — 리팩터 전후로 월간/주간 결과가 그대로다(회귀 없음)', () => {
    const data = {
      propertyMetricRows: [{ propertyId: 'p1', propertyName: 'P1', metricKey: 'cleaning_time', metricLabel: '청소시간 준수', failCount: 2 }],
      currentAgg: [], previousAgg: [], periodHistory: [],
    };
    const monthly = buildMonthlyInsights(data, '2026-09');
    const weekly  = buildWeeklyInsights(data, '2026-09-22');
    assert.equal(monthly.length, 1);
    assert.equal(monthly[0].periodUnit, 'month');
    assert.equal(monthly[0].sentence, 'P1에서 청소시간 준수 실패가 9월에 2번 반복됐어요.');
    // 주간은 CONCENTRATION 임계값(MIN_TOTAL_FAILURES=2)이 낮아 REPEAT 외에 CONCENTRATION도 함께 뜬다
    assert.ok(weekly.some(i => i.type === 'CONCENTRATION' && i.periodUnit === 'week'));
    assert.ok(weekly.some(i => i.type === 'REPEAT' && i.periodUnit === 'week'));
  });
});
