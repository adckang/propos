/**
 * s64 — "발견된 패턴"(insightDomain) 상세 팝업 + 디테일뷰 연결 (D-028)
 *
 * 사용자 요청: "화살표 누르면 아래팝업창뜨는기능 있자나 그런식으로 구체적인 문제 내역과
 * 해야할일을 상세하게 띄워주는게좋겠어" + "그 팝업의 상세데이터를 누르면 디테일뷰로
 * 자연스럽게 연결가능할지도 검토하자".
 *
 * 팝업은 인사이트 모양에 따라 3가지: property_items(REPEAT/CONCENTRATION, 건별 드릴다운 가능한
 * 6개 지표) / property_no_history(REPEAT/CONCENTRATION, cleaning_assign — 건별 기록 자체가 없음)
 * / scope_comparison(MONTH_OVER_MONTH/CONSECUTIVE, 숙소가 특정 안 됨 — 기간별 비교 수치).
 *
 * 레이어: L1(insightActionGuideDomain 순수 함수 + insightDomain evidence 확장) /
 * L2(DrilldownSheet·PropertyDetailView·RoomStateApp·SelectedPropertyReport·SummaryBanner·
 * InsightDrilldownSheet의 소스 계약).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  insightDrilldownShape,
  describeInsightAction,
  buildScopeComparisonRows,
} from '../../src/domain/insightActionGuideDomain.js';
import {
  detectMonthOverMonthInsights,
  detectConsecutiveInsights,
} from '../../src/domain/insightDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── L1: insightActionGuideDomain ─────────────────────────────────────────────
describe('insightDrilldownShape — 인사이트 모양 판정', () => {
  test('숙소가 특정된(propertyId 있음) + 건별 드릴다운 가능한 지표 → property_items', () => {
    for (const metricKey of ['pre_stay_optimization', 'post_checkout_energy', 'post_checkout_security', 'vacant_energy', 'post_cleaning_security', 'cleaning_time']) {
      assert.equal(insightDrilldownShape({ propertyId: 'p1', metricKey }), 'property_items', metricKey);
    }
  });

  test('숙소가 특정됐지만 cleaning_assign은 건별 기록이 없어 property_no_history', () => {
    assert.equal(insightDrilldownShape({ propertyId: 'p1', metricKey: 'cleaning_assign' }), 'property_no_history');
  });

  test('propertyId가 null이면(스코프 전체) 지표와 무관하게 scope_comparison', () => {
    assert.equal(insightDrilldownShape({ propertyId: null, metricKey: 'cleaning_time' }), 'scope_comparison');
    assert.equal(insightDrilldownShape({ propertyId: null, metricKey: 'cleaning_assign' }), 'scope_comparison');
  });
});

describe('describeInsightAction — 타입 힌트 + 지표 체크리스트 조합', () => {
  test('REPEAT + cleaning_time → 반복 힌트 + 청소시간 체크리스트가 한 문단으로', () => {
    const text = describeInsightAction({ type: 'REPEAT', metricKey: 'cleaning_time' });
    assert.match(text, /계속되고 있어요/);
    assert.match(text, /담당 청소자와 소통/);
  });

  test('타입 4종·지표 7종 전부 빈 문자열 없이 텍스트가 나온다(체크리스트 누락 없음 확인)', () => {
    const types = ['REPEAT', 'CONCENTRATION', 'MONTH_OVER_MONTH', 'CONSECUTIVE'];
    const metrics = ['pre_stay_optimization', 'post_checkout_energy', 'post_checkout_security', 'vacant_energy', 'post_cleaning_security', 'cleaning_time', 'cleaning_assign'];
    for (const type of types) {
      for (const metricKey of metrics) {
        const text = describeInsightAction({ type, metricKey });
        assert.ok(text.length > 10, `${type}/${metricKey} 가이드 문구가 비어있음`);
      }
    }
  });
});

describe('buildScopeComparisonRows — MONTH_OVER_MONTH(2행)/CONSECUTIVE(N행)', () => {
  test('MONTH_OVER_MONTH → 지난달/이번달 두 행, 원본 건수 그대로 노출', () => {
    const insight = {
      type: 'MONTH_OVER_MONTH',
      evidence: { previousNumerator: 17, previousDenominator: 18, currentNumerator: 12, currentDenominator: 20 },
    };
    const rows = buildScopeComparisonRows(insight);
    assert.deepEqual(rows, [
      { label: '지난달', text: '18건 중 1건 실패 (6%)' },
      { label: '이번 달', text: '20건 중 8건 실패 (40%)' },
    ]);
  });

  test('CONSECUTIVE → 월별 건수를 과거→최근 순으로', () => {
    const insight = {
      type: 'CONSECUTIVE',
      evidence: { periodCounts: [{ period: '2026-07', failCount: 2 }, { period: '2026-08', failCount: 1 }, { period: '2026-09', failCount: 3 }] },
    };
    assert.deepEqual(buildScopeComparisonRows(insight), [
      { label: '7월', text: '2건 실패' },
      { label: '8월', text: '1건 실패' },
      { label: '9월', text: '3건 실패' },
    ]);
  });

  test('그 외 타입은 빈 배열', () => {
    assert.deepEqual(buildScopeComparisonRows({ type: 'REPEAT', evidence: {} }), []);
  });
});

// ── L1: insightDomain evidence 확장 (팝업 상세용 원본 수치) ──────────────────────
describe('detectMonthOverMonthInsights — evidence에 원본 numerator/denominator도 담긴다', () => {
  test('팝업 비교 행을 만들 수 있도록 현재·직전 달의 원본 건수를 그대로 보존', () => {
    const current = [{ metricKey: 'm', metricLabel: 'M', numerator: 12, denominator: 20 }];
    const previous = [{ metricKey: 'm', metricLabel: 'M', numerator: 17, denominator: 18 }];
    const [insight] = detectMonthOverMonthInsights(current, previous, '2026-09');
    assert.equal(insight.evidence.currentNumerator, 12);
    assert.equal(insight.evidence.currentDenominator, 20);
    assert.equal(insight.evidence.previousNumerator, 17);
    assert.equal(insight.evidence.previousDenominator, 18);
  });
});

describe('detectConsecutiveInsights — evidence에 기간별 건수(periodCounts)도 담긴다', () => {
  test('과거→최근 순, periods와 같은 개수·순서', () => {
    const history = [
      { period: '2026-09', metricKey: 'm', metricLabel: 'M', failCount: 2 },
      { period: '2026-08', metricKey: 'm', metricLabel: 'M', failCount: 1 },
      { period: '2026-07', metricKey: 'm', metricLabel: 'M', failCount: 5 },
    ];
    const [insight] = detectConsecutiveInsights(history, '2026-09');
    assert.deepEqual(insight.evidence.periodCounts, [
      { period: '2026-07', failCount: 5 },
      { period: '2026-08', failCount: 1 },
      { period: '2026-09', failCount: 2 },
    ]);
    assert.deepEqual(insight.evidence.periodCounts.map(m => m.period), insight.evidence.periods);
  });
});

// ── L2: 소스 계약 ─────────────────────────────────────────────────────────────
describe('DrilldownSheet.jsx — onSelectRoom이 occurred_at도 함께 넘긴다', () => {
  const src = read('src/components/v2/reporting/DrilldownSheet.jsx');
  test('행 클릭 시 property_id와 occurred_at을 둘 다 콜백에 전달', () => {
    assert.match(src, /onSelectRoom\?\.\(item\.property_id, item\.occurred_at\)/);
  });
});

describe('PropertyDetailView.jsx — initialDayOffset prop으로 특정 날짜에 진입 가능 (D-028)', () => {
  const src = read('src/components/v2/PropertyDetailView.jsx');
  test('initialDayOffset prop을 받아 dayOffset 초기값으로 사용', () => {
    assert.match(src, /initialDayOffset\s*=\s*null/);
    assert.match(src, /useState\(initialDayOffset \?\? 0\)/);
  });
});

describe('RoomStateApp.jsx — 발견된 패턴 팝업에서 날짜 지정 디테일뷰 진입 (D-028)', () => {
  const src = read('src/components/v2/RoomStateApp.jsx');
  test('detailDayOffset state가 있고 PropertyDetailView에 initialDayOffset으로 전달된다', () => {
    assert.match(src, /const \[detailDayOffset, setDetailDayOffset\] = useState\(null\)/);
    assert.match(src, /initialDayOffset=\{detailDayOffset\}/);
  });
  test('두 onSelectProperty 핸들러(ListView·MonthlyView) 모두 dayOffset 인자를 받아 detailDayOffset을 채운다', () => {
    const matches = [...src.matchAll(/onSelectProperty=\{\(p, dayOffset\) => \{ setSelectedPropertyId\(p\.id\); setDetailDayOffset\(dayOffset \?\? null\); setView\('detail'\); \}\}/g)];
    assert.equal(matches.length, 2, 'ListView·MonthlyView 두 곳 모두 widening 되어야 함');
  });
});

describe('SelectedPropertyReport.jsx — handleSelectRoom이 occurredAt으로 day offset을 계산해 넘긴다 (D-028)', () => {
  const src = read('src/components/v2/reporting/SelectedPropertyReport.jsx');
  test('kstDayOffsetFromToday/toKstDateKey를 이용해 dayOffset을 계산한다', () => {
    assert.match(src, /import \{ toKstDateKey, kstDayOffsetFromToday \} from '\.\.\/\.\.\/\.\.\/domain\/monthlyCalendarDomain\.js'/);
    assert.match(src, /const dayOffset = occurredAt != null \? kstDayOffsetFromToday\(toKstDateKey\(occurredAt\)\) : null;/);
    assert.match(src, /onSelectProperty\?\.\(property, dayOffset\)/);
  });
  test('ReportPanel과 SummaryBanner 둘 다 같은 handleSelectRoom을 쓴다(중복 로직 없음)', () => {
    assert.match(src, /onSelectRoom=\{handleSelectRoom\}/);
    const occurrences = [...src.matchAll(/onSelectRoom=\{handleSelectRoom\}/g)];
    assert.equal(occurrences.length, 2);
  });
});

describe('SummaryBanner.jsx — 인사이트 한 줄을 누르면 상세 팝업이 뜬다 (D-028)', () => {
  const src = read('src/components/v2/reporting/SummaryBanner.jsx');
  test('openInsight state로 클릭한 인사이트를 추적하고, 있으면 InsightDrilldownSheet를 렌더링', () => {
    assert.match(src, /import InsightDrilldownSheet from '\.\/InsightDrilldownSheet\.jsx'/);
    assert.match(src, /const \[openInsight, setOpenInsight\] = useState\(null\)/);
    assert.match(src, /onClick=\{\(\) => setOpenInsight\(insight\)\}/);
    assert.match(src, /\{openInsight && \(/);
    assert.match(src, /<InsightDrilldownSheet/);
  });
  test('insights 배열 렌더링이 문자열이 아니라 insight.sentence를 쓴다(D-028에서 객체 배열로 바뀜)', () => {
    assert.match(src, /\{insight\.sentence\}/);
    assert.ok(!/insights\.map\(\(sentence, i\)/.test(src), '아직 옛 문자열 배열 방식이 남아있음');
  });
});

describe('InsightDrilldownSheet.jsx — 3가지 모양 분기', () => {
  const src = read('src/components/v2/reporting/InsightDrilldownSheet.jsx');
  test('insightDrilldownShape로 분기해서 property_items/property_no_history/scope_comparison 셋 다 처리', () => {
    assert.match(src, /insightDrilldownShape\(insight\)/);
    assert.match(src, /shape === 'property_items'/);
    assert.match(src, /shape === 'property_no_history'/);
    assert.match(src, /buildScopeComparisonRows\(insight\)/);
  });
  test('모든 분기에 "해야 할 일" footer(ActionFooter)가 붙는다', () => {
    const footerCount = [...src.matchAll(/footer=\{<ActionFooter/g)].length;
    assert.equal(footerCount, 3, '세 분기 모두 ActionFooter가 있어야 함');
  });

  // 실사용 버그(2026-09-28): property_items 팝업이 reportPeriod("YYYY-MM")를 그대로 /api/stats/drilldown의
  // period로 넘겨서 늘 "실패 0건"으로 보였다 — 그 API는 "this_month"/"last_month" 같은 이름만 안다.
  // periodKey(호출부 원래 기간 키)를 따로 안 담고 reportPeriod와 헷갈리면 같은 버그가 재발할 수 있어 고정.
  test('property_items 팝업은 reportPeriod가 아니라 periodKey를 /api/stats/drilldown 기간으로 쓴다', () => {
    assert.match(src, /period=\{insight\.periodKey\}/);
    assert.ok(!/period=\{insight\.reportPeriod\}/.test(src), 'reportPeriod를 드릴다운 기간으로 잘못 쓰고 있음');
  });
});
