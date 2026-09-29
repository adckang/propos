/**
 * s63 — 월간 레포트 "발견된 패턴" (Insight, D-027)
 *
 * 사용자 요청: "최종 산출물은 월간 리포트패널 Summary 영역에 표시할 최대 3개의 짧은 문장이다.
 * 기존 지표를 요약하지 말고, 지표 간/숙소 간/기간 간 비교를 통해 새롭게 발견되는 패턴만
 * 출력한다." V1 범위는 REPEAT/CONCENTRATION/MONTH_OVER_MONTH/CONSECUTIVE 4종만
 * (CO_OCCURRENCE·WORKER_CONCENTRATION은 사용자 결정으로 보류). 서머리 문장 자체는 그대로 두고,
 * 결과는 서머리 하부의 독립적인 펼침 항목("🔍 발견된 패턴 N건")으로 표시한다.
 *
 * 레이어: L1(insightDomain 4개 detector + rankInsights + formatInsightSentence + monthsAgoRange
 * — 순수 함수) / L2(getMonthlyInsights 오케스트레이션 배선 + API·훅·UI 컴포넌트 소스 계약).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INSIGHT_THRESHOLDS,
  detectRepeatInsights,
  detectConcentrationInsights,
  detectMonthOverMonthInsights,
  detectConsecutiveInsights,
  rankInsights,
  formatInsightSentence,
  buildMonthlyInsightSentences,
} from '../../src/domain/insightDomain.js';
import { monthsAgoRange } from '../../src/domain/periodDomain.js';
import { getMonthlyInsights } from '../../src/application/reportingService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── L1: periodDomain.monthsAgoRange ─────────────────────────────────────────
describe('monthsAgoRange — KST 기준 n개월 전 달력 월 범위', () => {
  const NOW = new Date('2026-09-28T05:00:00Z').getTime(); // KST 9/28 14:00

  test('n=0 → 이번 달(9월), n=1 → 지난달(8월) … 순차적으로', () => {
    assert.equal(monthsAgoRange(0, NOW).monthKey, '2026-09');
    assert.equal(monthsAgoRange(1, NOW).monthKey, '2026-08');
    assert.equal(monthsAgoRange(2, NOW).monthKey, '2026-07');
  });

  test('연도 경계를 넘어가도 정확하다 (9개월 전 → 작년 12월)', () => {
    assert.equal(monthsAgoRange(9, NOW).monthKey, '2025-12');
  });

  test('from/to는 그 달의 KST 자정~다음달 KST 자정', () => {
    const { from, to } = monthsAgoRange(1, NOW); // 8월
    assert.equal(from.toISOString(), new Date('2026-07-31T15:00:00Z').toISOString());
    assert.equal(to.toISOString(), new Date('2026-08-31T15:00:00Z').toISOString());
  });
});

// ── L1: insightDomain 4개 detector ───────────────────────────────────────────
describe('detectRepeatInsights — 같은 숙소·같은 지표 실패가 임계값 이상 반복', () => {
  test(`failCount >= MIN_COUNT(${INSIGHT_THRESHOLDS.REPEAT.MIN_COUNT})만 통과`, () => {
    const rows = [
      { propertyId: 'p1', propertyName: '파주201', metricKey: 'cleaning_time', metricLabel: '청소시간 준수', failCount: 2 },
      { propertyId: 'p2', propertyName: '역삼', metricKey: 'cleaning_time', metricLabel: '청소시간 준수', failCount: 1 },
    ];
    const out = detectRepeatInsights(rows, '2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'REPEAT');
    assert.equal(out[0].propertyId, 'p1');
    assert.equal(out[0].evidence.count, 2);
  });
});

describe('detectConcentrationInsights — 한 지표의 실패가 한 숙소에 몰림', () => {
  const { MIN_TOTAL_FAILURES, MIN_PROPERTY_FAILURES, MIN_RATIO } = INSIGHT_THRESHOLDS.CONCENTRATION;

  test('총합·최다숙소건수·비율 세 조건을 모두 만족해야 통과', () => {
    const rows = [
      { propertyId: 'p1', propertyName: 'A', metricKey: 'm', metricLabel: 'M', failCount: 3 },
      { propertyId: 'p2', propertyName: 'B', metricKey: 'm', metricLabel: 'M', failCount: 1 },
    ];
    const out = detectConcentrationInsights(rows, '2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'CONCENTRATION');
    assert.equal(out[0].propertyId, 'p1');
    assert.equal(out[0].evidence.totalFailures, 4);
    assert.equal(out[0].evidence.propertyFailures, 3);
  });

  test(`총합이 MIN_TOTAL_FAILURES(${MIN_TOTAL_FAILURES}) 미만이면 제외`, () => {
    const rows = [{ propertyId: 'p1', propertyName: 'A', metricKey: 'm', metricLabel: 'M', failCount: 2 }];
    assert.equal(detectConcentrationInsights(rows, '2026-09').length, 0);
  });

  test(`비율이 MIN_RATIO(${MIN_RATIO}) 미만이면 제외 (실패가 여러 숙소에 고르게 분산)`, () => {
    const rows = [
      { propertyId: 'p1', propertyName: 'A', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { propertyId: 'p2', propertyName: 'B', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { propertyId: 'p3', propertyName: 'C', metricKey: 'm', metricLabel: 'M', failCount: 2 },
    ];
    assert.equal(detectConcentrationInsights(rows, '2026-09').length, 0);
  });

  test(`최다숙소 건수가 MIN_PROPERTY_FAILURES(${MIN_PROPERTY_FAILURES}) 미만이면 제외`, () => {
    const rows = [
      { propertyId: 'p1', propertyName: 'A', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { propertyId: 'p2', propertyName: 'B', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { propertyId: 'p3', propertyName: 'C', metricKey: 'm', metricLabel: 'M', failCount: 1 },
    ];
    assert.equal(detectConcentrationInsights(rows, '2026-09').length, 0);
  });
});

describe('detectMonthOverMonthInsights — 실패율이 전달 대비 임계값 이상 변함', () => {
  const { MIN_CURRENT_TOTAL, MIN_PREVIOUS_TOTAL, MIN_DELTA_PP } = INSIGHT_THRESHOLDS.MONTH_OVER_MONTH;

  test(`실패율 변화가 MIN_DELTA_PP(${MIN_DELTA_PP}) 이상이면 통과, propertyId는 null(스코프 전체)`, () => {
    const current = [{ metricKey: 'm', metricLabel: 'M', numerator: 12, denominator: 20 }]; // 실패율 40%
    const previous = [{ metricKey: 'm', metricLabel: 'M', numerator: 17, denominator: 18 }]; // 실패율 5.6%
    const out = detectMonthOverMonthInsights(current, previous, '2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'MONTH_OVER_MONTH');
    assert.equal(out[0].propertyId, null);
    assert.ok(out[0].evidence.deltaPp >= MIN_DELTA_PP);
  });

  test(`분모가 MIN_CURRENT_TOTAL(${MIN_CURRENT_TOTAL})/MIN_PREVIOUS_TOTAL(${MIN_PREVIOUS_TOTAL}) 미만이면 제외 (표본 부족)`, () => {
    const current = [{ metricKey: 'm', metricLabel: 'M', numerator: 1, denominator: 2 }];
    const previous = [{ metricKey: 'm', metricLabel: 'M', numerator: 10, denominator: 10 }];
    assert.equal(detectMonthOverMonthInsights(current, previous, '2026-09').length, 0);
  });

  test('변화폭이 임계값 미만이면 제외', () => {
    const current = [{ metricKey: 'm', metricLabel: 'M', numerator: 18, denominator: 20 }];
    const previous = [{ metricKey: 'm', metricLabel: 'M', numerator: 18, denominator: 20 }];
    assert.equal(detectMonthOverMonthInsights(current, previous, '2026-09').length, 0);
  });

  test('직전 달 데이터가 없는 지표는 비교 불가로 제외', () => {
    const current = [{ metricKey: 'only_this_month', metricLabel: 'M', numerator: 1, denominator: 20 }];
    assert.equal(detectMonthOverMonthInsights(current, [], '2026-09').length, 0);
  });
});

describe('detectConsecutiveInsights — 같은 지표가 최근 달부터 연속 실패', () => {
  test(`연속 개월수가 MIN_STREAK(${INSIGHT_THRESHOLDS.CONSECUTIVE.MIN_STREAK}) 이상이면 통과, 과거→최근 순으로 evidence.periods 반환`, () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2026-08', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { period: '2026-07', metricKey: 'm', metricLabel: 'M', failCount: 3 },
      { period: '2026-06', metricKey: 'm', metricLabel: 'M', failCount: 0 },
    ];
    const out = detectConsecutiveInsights(history, '2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].evidence.consecutivePeriods, 3);
    assert.deepEqual(out[0].evidence.periods, ['2026-07', '2026-08', '2026-09']);
  });

  test('가장 최근 달이 실패 0건이면 연속 자체가 성립하지 않음', () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 0 },
      { period: '2026-08', metricKey: 'm', metricLabel: 'M', failCount: 5 },
    ];
    assert.equal(detectConsecutiveInsights(history, '2026-09').length, 0);
  });

  test('중간에 실패 0건이 끼면 그 이전 연속만 인정 (가장 최근 달부터 이어진 연속만 봄)', () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { period: '2026-08', metricKey: 'm', metricLabel: 'M', failCount: 0 },
      { period: '2026-07', metricKey: 'm', metricLabel: 'M', failCount: 5 },
    ];
    assert.equal(detectConsecutiveInsights(history, '2026-09').length, 0);
  });

  // 코드 리뷰에서 발견(실사용 버그 전 사전 확인) — 그 달에 지표가 아예 측정 불가(분모 0)였던
  // 달은 monthlyHistory에서 행 자체가 빠질 수 있다(reportingService.computeMeasurableMetrics가
  // denominator>0인 지표만 담기 때문). 그 "빠진 달"을 실패 0건으로 착각해 건너뛰고 이어붙이면
  // 실제로는 8월 데이터가 아예 없는데도 "7월,9월 2개월 연속 실패"라는 과다 주장이 나온다.
  test('중간 달이 통째로 빠지면(측정 불가) 연속으로 이어붙이지 않고 끊긴 것으로 본다', () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      // 2026-08 행 자체가 없음 (그 달엔 분모 0이라 측정 불가)
      { period: '2026-07', metricKey: 'm', metricLabel: 'M', failCount: 5 },
    ];
    assert.equal(detectConsecutiveInsights(history, '2026-09').length, 0,
      '8월 데이터가 없는데 7월·9월을 이어붙여 연속으로 판정하면 안 됨');
  });

  test('달력상 진짜로 연속인 3개월(빠진 달 없음)은 정상적으로 인정된다', () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2026-08', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { period: '2026-07', metricKey: 'm', metricLabel: 'M', failCount: 5 },
    ];
    const out = detectConsecutiveInsights(history, '2026-09');
    assert.equal(out.length, 1);
    assert.equal(out[0].evidence.consecutivePeriods, 3);
  });

  test('연도 경계(2026-01 → 2025-12)를 넘어가도 정확히 연속으로 인정한다', () => {
    const history = [
      { period: '2026-01', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2025-12', metricKey: 'm', metricLabel: 'M', failCount: 1 },
    ];
    const out = detectConsecutiveInsights(history, '2026-01');
    assert.equal(out.length, 1);
    assert.equal(out[0].evidence.consecutivePeriods, 2);
  });
});

// ── L1: rankInsights / formatInsightSentence ─────────────────────────────────
describe('rankInsights — dedupe → 타입 우선순위 → 상위 3개', () => {
  test('같은 (type, propertyId, metricKey) 조합은 dedupe된다', () => {
    const a = { type: 'REPEAT', propertyId: 'p1', metricKey: 'm', internalPriority: 5 };
    const b = { type: 'REPEAT', propertyId: 'p1', metricKey: 'm', internalPriority: 1 };
    const out = rankInsights([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0].internalPriority, 5, '먼저 온 것을 유지');
  });

  test('타입 우선순위: CONCENTRATION > CONSECUTIVE > MONTH_OVER_MONTH > REPEAT (내부 수치 크기와 무관)', () => {
    const insights = [
      { type: 'REPEAT', propertyId: 'p1', metricKey: 'm1', internalPriority: 999 },
      { type: 'CONCENTRATION', propertyId: 'p2', metricKey: 'm2', internalPriority: 0.5 },
    ];
    const out = rankInsights(insights);
    assert.equal(out[0].type, 'CONCENTRATION', 'REPEAT의 internalPriority가 훨씬 커도 타입 우선순위가 이긴다');
  });

  test('limit(기본 3)을 넘는 후보는 잘린다', () => {
    const insights = ['REPEAT', 'CONSECUTIVE', 'CONCENTRATION', 'MONTH_OVER_MONTH'].map((type, i) => ({
      type, propertyId: `p${i}`, metricKey: `m${i}`, internalPriority: 1,
    }));
    assert.equal(rankInsights(insights).length, 3);
  });
});

describe('formatInsightSentence — reportPeriod을 그대로 써서 "이번달/지난달" 하드코딩 없음', () => {
  test('REPEAT 문장', () => {
    const s = formatInsightSentence({
      type: 'REPEAT', reportPeriod: '2026-09', propertyName: '파주201',
      metricLabel: '청소시간 준수', evidence: { count: 3 },
    });
    assert.equal(s, '파주201에서 청소시간 준수 실패가 9월에 3번 반복됐어요.');
  });

  test('CONCENTRATION 문장', () => {
    const s = formatInsightSentence({
      type: 'CONCENTRATION', reportPeriod: '2026-09', propertyName: '역삼 G호',
      metricLabel: '퇴실 후 절전', evidence: { propertyFailures: 3, totalFailures: 5 },
    });
    assert.equal(s, '9월 퇴실 후 절전 실패 5건 중 3건이 역삼 G호에서 나왔어요.');
  });

  test('MONTH_OVER_MONTH 문장 — 올랐어요/내려갔어요 분기', () => {
    const up = formatInsightSentence({
      type: 'MONTH_OVER_MONTH', reportPeriod: '2026-09', metricLabel: '빈방 절전 유지',
      evidence: { deltaPp: 34, previousFailRate: 6, currentFailRate: 40 },
    });
    assert.equal(up, '빈방 절전 유지 실패율이 지난달보다 34%p 올랐어요 (지난달 6% → 이번 달 40%).');
    const down = formatInsightSentence({
      type: 'MONTH_OVER_MONTH', reportPeriod: '2026-09', metricLabel: '빈방 절전 유지',
      evidence: { deltaPp: -20, previousFailRate: 40, currentFailRate: 20 },
    });
    assert.match(down, /내려갔어요/);
  });

  test('CONSECUTIVE 문장', () => {
    const s = formatInsightSentence({
      type: 'CONSECUTIVE', reportPeriod: '2026-09', metricLabel: '청소 담당자 배정',
      evidence: { consecutivePeriods: 3, periods: ['2026-07', '2026-08', '2026-09'] },
    });
    assert.equal(s, '청소 담당자 배정 실패가 3개월 연속 발생했어요 (7월, 8월, 9월).');
  });
});

describe('buildMonthlyInsightSentences — 4개 detect + rank + format 통합', () => {
  test('입력이 전부 비어있으면 빈 배열', () => {
    assert.deepEqual(buildMonthlyInsightSentences({}, '2026-09'), []);
  });

  test('감지된 패턴이 있으면 문장 배열(최대 3개)을 반환', () => {
    // failCount=2 → REPEAT(MIN_COUNT 2)만 통과, CONCENTRATION은 총합 조건(MIN_TOTAL_FAILURES 3)
    // 미달이라 함께 안 뜬다 — 결과가 정확히 1개임을 단순하게 검증하기 위한 값.
    const data = {
      propertyMetricRows: [
        { propertyId: 'p1', propertyName: '파주201', metricKey: 'cleaning_time', metricLabel: '청소시간 준수', failCount: 2 },
      ],
      currentAgg: [], previousAgg: [], periodHistory: [],
    };
    const out = buildMonthlyInsightSentences(data, '2026-09');
    assert.equal(out.length, 1);
    assert.match(out[0], /파주201/);
  });
});

// ── L2: reportingService.getMonthlyInsights 오케스트레이션 배선 ─────────────────
describe('getMonthlyInsights — period 게이트 + 숙소 스코프 파생 + DB 조합', () => {
  test('this_month/last_month가 아니면 DB를 전혀 건드리지 않고 빈 배열', async () => {
    const forbiddenDb = { query: async () => { throw new Error('월간이 아닌데 DB를 호출함'); } };
    const out = await getMonthlyInsights('this_week', { db: forbiddenDb });
    assert.deepEqual(out, []);
  });

  // 이 통합 테스트는 날짜 범위와 무관하게 "매달 똑같은 이벤트가 반복된다"는 고정 목업을 준다 —
  // 그러면 REPEAT/CONCENTRATION(이번 달, 숙소별)·MONTH_OVER_MONTH(변화 없음 → 미발생)·
  // CONSECUTIVE(매달 동일 실패 → 발생)가 전부 결정적으로 계산되어, 오케스트레이션이 각 조각
  // (숙소별 분해, 스코프 합산, 여러 달 이력)을 올바른 입력으로 insightDomain에 넘기는지 검증할 수 있다.
  // pre_stay_optimization만 분모>0이 되도록 이벤트 종류를 한정해(체크아웃·청소 이벤트 없음) 다른
  // 6개 지표는 computeMeasurableMetrics에서 자동 제외되게 함 — 기대값 계산을 단순하게 유지.
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
        return { rows: [] }; // cleaning_jobs (집계·숙소별) — 항상 0건
      },
    };
  }

  test('숙소 스코프를 이번 달 이벤트에 등장한 property_id로 파생시켜 숙소별 cleaning_jobs 조회에 넘긴다', async () => {
    const calls = [];
    await getMonthlyInsights('this_month', { db: makeDb(calls), propertyIds: null, now: new Date('2026-09-28T00:00:00Z') });
    const byPropertyCall = calls.find(c => /GROUP BY property_id/.test(c.sql));
    assert.ok(byPropertyCall, '숙소별 cleaning_jobs 조회가 호출되지 않음');
    assert.deepEqual([...byPropertyCall.params[2]].sort(), ['p1', 'p2']);
  });

  test('이벤트 조회를 조회 기간(오프셋)만큼 반복 호출한다 (MONTH_OVER_MONTH/CONSECUTIVE용 과거 이력)', async () => {
    const calls = [];
    await getMonthlyInsights('this_month', { db: makeDb(calls), now: new Date('2026-09-28T00:00:00Z') });
    const eventsCalls = calls.filter(c => /FROM events/.test(c.sql));
    assert.equal(eventsCalls.length, 4, 'INSIGHT_LOOKBACK_MONTHS(4)만큼 조회해야 함');
  });

  test('매달 같은 실패가 반복되는 목업 → CONCENTRATION(p1 쏠림) + CONSECUTIVE(연속) + REPEAT(p1 반복) 문장이 나오고, 변화가 없으니 MONTH_OVER_MONTH는 안 나온다', async () => {
    // D-028: getMonthlyInsights는 이제 문장뿐 아니라 type/metricKey/propertyId 등이 담긴 구조화된
    // 객체 배열을 반환한다(팝업이 이 메타데이터로 어떤 상세를 보여줄지 결정) — sentence 필드로 검사.
    const out = await getMonthlyInsights('this_month', { db: makeDb([]), now: new Date('2026-09-28T00:00:00Z') });
    const sentences = out.map(i => i.sentence);
    assert.ok(sentences.some(s => /게스트 맞이 준비/.test(s) && /나왔어요/.test(s) && /p1/.test(s)),
      `CONCENTRATION 문장을 찾지 못함: ${JSON.stringify(out)}`);
    assert.ok(sentences.some(s => /연속 발생했어요/.test(s)), `CONSECUTIVE 문장을 찾지 못함: ${JSON.stringify(out)}`);
    assert.ok(sentences.some(s => /p1에서.*반복됐어요/.test(s)), `REPEAT 문장을 찾지 못함: ${JSON.stringify(out)}`);
    assert.ok(!sentences.some(s => /%p/.test(s)), `변화가 없는데 MONTH_OVER_MONTH 문장이 나옴: ${JSON.stringify(out)}`);
    assert.equal(out.length, 3);
    // 팝업 배선에 필요한 메타데이터도 있는지 확인 (D-028)
    const concentration = out.find(i => i.type === 'CONCENTRATION');
    assert.equal(concentration.propertyId, 'p1');
    assert.equal(concentration.metricKey, 'pre_stay_optimization');
    // periodKey — 팝업이 /api/stats/drilldown을 다시 부를 때 쓰는 원래 기간 키. reportPeriod("YYYY-MM")와
    // 달리 이 API가 실제로 아는 이름("this_month" 등)이어야 한다 — 혼동하면 팝업이 빈 목록을 보여준다
    // (실제로 겪은 버그, 2026-09-28: reportPeriod를 그대로 넘겼다가 드릴다운이 늘 "실패 0건"으로 보임).
    assert.ok(out.every(i => i.periodKey === 'this_month'));
  });

  test('last_month는 조회 기준월이 한 달 밀린다 (reportPeriod가 이번 달이 아니라 지난달 라벨로 문장에 반영)', async () => {
    const out = await getMonthlyInsights('last_month', { db: makeDb([]), now: new Date('2026-09-28T00:00:00Z') });
    assert.ok(out.some(i => /8월/.test(i.sentence)), `지난달(8월) 라벨이 문장에 없음: ${JSON.stringify(out)}`);
    assert.ok(out.every(i => i.reportPeriod === '2026-08'), 'reportPeriod가 지난달로 안 밀림');
    assert.ok(out.every(i => i.periodKey === 'last_month'), 'periodKey는 reportPeriod와 달리 호출부 period 그대로');
  });
});

// ── L2: API·훅·UI 배선 계약 ───────────────────────────────────────────────────
describe('api/stats.js — insights는 월간 기간에서만 추가된다', () => {
  const src = read('api/stats.js');
  test('getMonthlyInsights를 import하고 this_month/last_month에서만 호출한다', () => {
    assert.match(src, /import\s*\{[^}]*getMonthlyInsights[^}]*\}\s*from\s*"\.\.\/src\/application\/reportingService\.js"/);
    assert.match(src, /if \(period === "this_month" \|\| period === "last_month"\) \{/);
  });

  // 코드 리뷰에서 발견 — getMonthlyInsights는 그 자체로 추가 DB 조회를 여러 번 더 하는
  // 부가 기능이라, 여기서 실패해도 이미 계산된 stats/summary까지 500으로 날려버리면 안 된다.
  test('getMonthlyInsights 호출은 자체 try/catch로 감싸 실패해도 stats 응답 자체는 살린다', () => {
    assert.match(src, /try \{\s*\n\s*result\.insights = await getMonthlyInsights/);
    assert.match(src, /catch \(err\) \{\s*\n\s*console\.error\("\[api\/stats\] getMonthlyInsights/);
    assert.match(src, /result\.insights = \[\];/);
  });
});

describe('useReportingStats — insights를 API 응답에서 그대로 노출한다', () => {
  const src = read('src/hooks/useReportingStats.js');
  test('초기·에러·성공 상태 모두 insights 필드를 갖는다', () => {
    assert.match(src, /insights:\s*\[\]/);
    assert.match(src, /insights:\s*data\.insights\s*\?\?\s*\[\]/);
  });
});

describe('SummaryBanner — insights를 서머리 하부의 독립 펼침 항목으로 표시', () => {
  const src = read('src/components/v2/reporting/SummaryBanner.jsx');
  test('insights prop을 받고 기본값은 빈 배열(기존 호출부는 영향 없음)', () => {
    assert.match(src, /insights\s*=\s*\[\]/);
  });
  test('발견된 패턴 N건 토글이 기존 "자세히"(children expanded) 토글과 별개의 state다', () => {
    assert.match(src, /const \[insightsExpanded, setInsightsExpanded\] = useState\(false\)/);
    assert.match(src, /발견된 패턴 \{insights\.length\}건/);
  });
  test('insights가 비어있으면 아무것도 렌더링하지 않는다 (hasInsights 가드)', () => {
    assert.match(src, /const hasInsights = insights\.length > 0/);
  });
});

describe('SelectedPropertyReport — useReportingStats의 insights를 SummaryBanner로 그대로 전달', () => {
  const src = read('src/components/v2/reporting/SelectedPropertyReport.jsx');
  test('insights를 구조분해하고 SummaryBanner에 prop으로 넘긴다', () => {
    assert.match(src, /const \{ stats: periodStats, summary, insights, loading: periodLoading \} = useReportingStats/);
    assert.match(src, /<SummaryBanner[^>]*insights=\{insights\}/);
  });
});
