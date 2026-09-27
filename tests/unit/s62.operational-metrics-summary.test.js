/**
 * s62 — 7개 운영 지표("완료" 섹션) 요약 문장 + 표를 "담당자가 보고하는 느낌"으로 (D-026)
 *
 * 1차 (2026-09-25): "지난주 레포트의 이 부분이 참 말이 이해하기 어렵고 와닿지가 않네.
 *   진짜 담당자가 보고하는 느낌으로 워딩을 만들어보는건 어떨까?" → 서술형 "다만 ~" 문장으로
 *   구현, "그리고 대시보드에서도 지난달, 이번달 과거부분에도 적용필요하고."로 범위 확정.
 * 2차 후속 (같은 날): "요약부분에 맨트가 상당히 장황하게 느껴진다... 완벽해요/양호해요/
 *   보통이에요/조금불안정해요/아주불안정해요 5개정도의 수준지표로 간단히 알려주고 (실패00건)
 *   이렇게 표현하는게 어떨까?" → 서술형 문장을 5단계 등급 + 실패 총건수로 단순화(현재 구현).
 *   등급은 표 하단 "안심지수"와 같은 평균 점수 기준이라 요약·표가 항상 같은 숫자를 말한다.
 *
 * 표: 지표(짧은 라벨) | 성공/전체 | 성공율 | 실패(90% 미만일 때만 빨간 배지) — 이 부분은
 * 1차 그대로 유지, 이번 후속 수정은 요약 "문장"만 바꿨다.
 *
 * 레이어: L1 = 실제 함수 import(operationalMetricsDomain, generateSummary) / L2 = 소스 계약.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  computeOperationalMetrics,
  computeMeasurableMetrics,
  summarizeOperationalMetrics,
} from '../../src/domain/operationalMetricsDomain.js';
import { generateSummary } from '../../src/application/reportingService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// 사용자가 처음 제시한 실제 예시 숫자 (지표 순서대로 92/83/92/75/92/83/100%)
const EXAMPLE_STATS = {
  preStayOptimized: 11, preStayAttempts: 12,
  checkOuts: 12, postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1,
  cleaningFinished: 12, vacantEnergyWaste: 3, postCleaningSecurityBreach: 1,
  cleaningOnTime: 10,
  cleaningAssigned: 12, cleaningCreated: 12,
};

// ══════════════════════════════════════════════════════════════════════════
// A. computeOperationalMetrics — 7개 지표 라벨·분자/분모 (L1)
// ══════════════════════════════════════════════════════════════════════════
describe('computeOperationalMetrics — 7개 지표, 짧은 라벨', () => {
  test('라벨 7개가 정확히 이 순서·이 문구다 (D-026 짧은 라벨)', () => {
    const labels = computeOperationalMetrics(EXAMPLE_STATS).map(m => m.label);
    assert.deepEqual(labels, [
      '게스트 맞이 준비', '퇴실 후 절전', '퇴실 후 보안',
      '빈방 절전 유지', '빈방 보안 유지', '청소시간 준수', '청소 담당자 배정',
    ]);
  });

  test('예시 숫자대로 분자/분모가 92/83/92/75/92/83/100%를 만든다', () => {
    const metrics = computeMeasurableMetrics(EXAMPLE_STATS);
    const pctByKey = Object.fromEntries(metrics.map(m => [m.key, m.pct]));
    assert.equal(pctByKey.pre_stay_optimization, 92);
    assert.equal(pctByKey.post_checkout_energy, 83);
    assert.equal(pctByKey.post_checkout_security, 92);
    assert.equal(pctByKey.vacant_energy, 75);
    assert.equal(pctByKey.post_cleaning_security, 92);
    assert.equal(pctByKey.cleaning_time, 83);
    assert.equal(pctByKey.cleaning_assign, 100);
  });

  test('실패 건수 = 분모 - 분자 (표의 빨간 배지 기준)', () => {
    const metrics = computeMeasurableMetrics(EXAMPLE_STATS);
    const failByKey = Object.fromEntries(metrics.map(m => [m.key, m.failCount]));
    assert.equal(failByKey.vacant_energy, 3);
    assert.equal(failByKey.cleaning_time, 2);
    assert.equal(failByKey.cleaning_assign, 0);
  });

  test('청소 담당자 배정 조회 실패(null)는 측정 불가로 제외한다 — 0건으로 세지 않는다', () => {
    const metrics = computeMeasurableMetrics({ ...EXAMPLE_STATS, cleaningAssigned: null, cleaningCreated: null });
    assert.ok(!metrics.some(m => m.key === 'cleaning_assign'));
  });

  test('cleaningFinished가 stats에 아예 없으면(undefined) checkOuts로 대신 채우지 않는다 — 0으로 둔다', () => {
    // countPeriodEvents는 항상 cleaningFinished를 명시적으로 채우므로(0건이어도 undefined 아님),
    // undefined인 건 "이 지표 자체가 없는 얕은 stats"라는 뜻 — checkOuts로 대신 채우면
    // "데이터가 없을 뿐"인 걸 "기준 미달"로 잘못 세게 된다.
    const metrics = computeMeasurableMetrics({ checkOuts: 5, postCheckoutEnergyWaste: 0 });
    assert.ok(!metrics.some(m => m.key === 'vacant_energy'));
    assert.ok(!metrics.some(m => m.key === 'cleaning_time'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. summarizeOperationalMetrics — 5단계 등급 + 실패 총건수 요약 (L1)
//
// 2026-09-25 후속 수정: 사용자가 "다만 ~" 서술형 문장이 장황하게 느껴진다며, "완벽해요/
// 양호해요/보통이에요/조금 불안정해요/아주 불안정해요" 5단계 등급 + "(실패 00건)" 형태로
// 단순화해 달라고 요청. 등급 기준은 표 하단 "안심지수"와 같은 평균 점수를 그대로 재사용한다.
// ══════════════════════════════════════════════════════════════════════════
describe('summarizeOperationalMetrics — 5단계 등급 + 실패 총건수', () => {
  test('사용자 예시 숫자(평균 88점) → "보통이에요 (실패 10건)" (지난주=past)', () => {
    // 92,83,92,75,92,83,100의 raw 평균은 88.09... → round 88 → 75~89 구간 "보통이에요"
    // 실패 총건수 = 1+2+1+3+1+2+0 = 10
    assert.equal(summarizeOperationalMetrics('last_week', EXAMPLE_STATS), '지난주 보통이에요 (실패 10건)');
  });

  test('진행중 기간(이번 주)은 "지금까지"를 붙인다', () => {
    const s = summarizeOperationalMetrics('this_week', EXAMPLE_STATS);
    assert.equal(s, '이번 주 지금까지 보통이에요 (실패 10건)');
  });

  test('대시보드 월 기간(지난달/이번달)에도 같은 함수가 적용된다', () => {
    assert.equal(summarizeOperationalMetrics('last_month', EXAMPLE_STATS), '지난달 보통이에요 (실패 10건)');
    assert.equal(summarizeOperationalMetrics('this_month', EXAMPLE_STATS), '이번 달 지금까지 보통이에요 (실패 10건)');
  });

  test('실패 총건수 0 → 평균 점수와 무관하게 "완벽해요" (반올림으로 100 되는 것과 별개 판정)', () => {
    const allGood = { ...EXAMPLE_STATS, postCheckoutEnergyWaste: 0, postCheckoutSecurityBreach: 0, vacantEnergyWaste: 0, postCleaningSecurityBreach: 0, cleaningOnTime: 12, preStayOptimized: 12 };
    assert.equal(summarizeOperationalMetrics('last_week', allGood), '지난주 완벽해요 (실패 0건)');
  });

  test('평균 90점 이상(실패는 있음) → "양호해요"', () => {
    // 7개 중 1개만 11/12(91.67%), 나머지 6개는 100% → 평균 (91.67+600)/7 ≈ 98.8 → round 99 ≥90
    const s = summarizeOperationalMetrics('last_week', {
      preStayOptimized: 11, preStayAttempts: 12,
      checkOuts: 12, postCheckoutEnergyWaste: 0, postCheckoutSecurityBreach: 0,
      cleaningFinished: 12, vacantEnergyWaste: 0, postCleaningSecurityBreach: 0,
      cleaningOnTime: 12,
      cleaningAssigned: 12, cleaningCreated: 12,
    });
    assert.equal(s, '지난주 양호해요 (실패 1건)');
  });

  test('평균 50점 미만 → "아주 불안정해요"', () => {
    const mostlyBad = {
      preStayOptimized: 1, preStayAttempts: 12,
      checkOuts: 12, postCheckoutEnergyWaste: 10, postCheckoutSecurityBreach: 10,
      cleaningFinished: 12, vacantEnergyWaste: 10, postCleaningSecurityBreach: 10,
      cleaningOnTime: 1,
      cleaningAssigned: 12, cleaningCreated: 12,
    };
    const s = summarizeOperationalMetrics('last_week', mostlyBad);
    assert.match(s, /^지난주 아주 불안정해요 \(실패 \d+건\)$/);
  });

  test('측정 가능한 지표가 하나도 없으면 null (호출부가 기존 문장으로 대체)', () => {
    assert.equal(summarizeOperationalMetrics('last_week', { checkIns: 3 }), null);
  });

  test('미래 기간(다음 주)이나 now는 null — 이 요약은 완료된 구간(past/active)에만 적용', () => {
    assert.equal(summarizeOperationalMetrics('next_week', EXAMPLE_STATS), null);
    assert.equal(summarizeOperationalMetrics('now', EXAMPLE_STATS), null);
  });

  test('등급 경계값 — 90/75/50점에서 등급이 바뀐다', () => {
    // 분모 100, 분자만 바꿔 원하는 pct를 정확히 맞춘다 (지표 1개만 측정 가능하게 나머지는 0/0)
    const at = (pct) => summarizeOperationalMetrics('last_week', {
      preStayOptimized: pct, preStayAttempts: 100,
    });
    assert.match(at(90), /양호해요/);
    assert.match(at(89), /보통이에요/);
    assert.match(at(75), /보통이에요/);
    assert.match(at(74), /조금 불안정해요/);
    assert.match(at(50), /조금 불안정해요/);
    assert.match(at(49), /아주 불안정해요/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. generateSummary와의 통합 — 실제 stats가 있으면 새 문장, 없으면 기존 문장 (L1)
// ══════════════════════════════════════════════════════════════════════════
describe('generateSummary — 운영 지표 데이터가 있으면 새 요약을, 없으면 기존 문장을 쓴다', () => {
  test('완전한 stats(EXAMPLE_STATS + checkIns)를 주면 운영 지표 요약을 쓴다', () => {
    const s = generateSummary('last_week', { ...EXAMPLE_STATS, checkIns: 5, anomalies: 0 });
    assert.equal(s, '지난주 보통이에요 (실패 10건)');
  });

  test('checkIns만 있는 얕은 stats는 기존 "체크인 N건" 문장으로 그대로 대체(fallback)된다', () => {
    assert.equal(generateSummary('last_week', { checkIns: 3, anomalies: 0 }), '지난주 체크인 3건 완료, 이상 없었어요.');
  });

  test('노쇼 의심 접미사는 새 요약에도 그대로 덧붙는다', () => {
    const s = generateSummary('last_week', { ...EXAMPLE_STATS, checkIns: 5, noShowSuspected: 2 });
    assert.match(s, /노쇼 의심 2건/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. 표 배선 — EventMatrixPanel / SharedMetricRow (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('EventMatrixPanel — computeOperationalMetrics를 표 정의의 단일 출처로 쓴다', () => {
  const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');

  test('자체 METRICS 배열을 인라인으로 다시 정의하지 않고 도메인 함수를 쓴다', () => {
    assert.match(src, /import \{ computeOperationalMetrics \} from '\.\.\/\.\.\/\.\.\/domain\/operationalMetricsDomain\.js';/);
    assert.match(src, /const METRICS = computeOperationalMetrics\(stats\);/);
    assert.ok(!src.includes("label:       '입실전 숙소 최적화율'"), '옛 인라인 라벨이 아직 남아 있음');
  });

  test('테이블 헤더가 "달성률"에서 "성공률"로 바뀌었다', () => {
    assert.match(src, />\s*성공률\s*</);
    assert.ok(!src.includes('달성률'));
  });

  test('행 key는 배열 인덱스가 아니라 지표 key를 쓴다', () => {
    assert.match(src, /key=\{metricKey\}/);
  });
});

// 2026-09-26 후속: 실사용 중 "11/12건(92%)인데 왜 실패 배지가 없냐" 지적으로 배지 기준을
// failCount > 0으로 되돌림. 요약 문장의 "완벽해요"가 이제 pct 평균이 아니라 실패 총건수 0을
// 직접 판정하므로(위 섹션 B), failCount > 0 배지와 절대 어긋나지 않는다 — 배지가 하나라도
// 뜨면 요약은 이미 "완벽해요"가 아니다. 같은 날 두 번째 지적: 표 세로선이 안 맞음 — 배지·
// 드릴다운 화살표가 있는 행만 뒤로 붙어서 행마다 건수·성공률 칼럼 시작 위치가 밀렸다.
// SharedMetricRow를 flex → CSS Grid(고정 칼럼 템플릿)로 바꿔 항상 정렬되게 했다.
describe('SharedMetricRow — 실패가 하나라도 있으면 빨간 "실패 N건" 배지, 고정 그리드로 항상 정렬', () => {
  const src = read('src/components/v2/reporting/SharedMetricRow.jsx');

  test('failCount > 0이면 배지를 그린다(92%/실패 1건도 포함)', () => {
    assert.match(src, /const showBadge = failCount > 0;/);
    assert.match(src, /\{showBadge && \(/);
    assert.match(src, /실패 \{failCount\}건/);
  });

  test('드릴다운(›)은 배지와 같은 조건(failCount > 0)이지만, onDrilldown이 없으면 화살표만 안 뜬다', () => {
    assert.match(src, /const tappable\s*= failCount > 0 && !!onDrilldown;/);
  });

  test('배지는 빨간 배경 + 흰 글자다', () => {
    const start = src.indexOf('showBadge && (');
    const end = src.indexOf(')}', start);
    const block = src.slice(start, end);
    assert.match(block, /background: '#dc2626'/);
    assert.match(block, /color: '#fff'/);
  });

  test('고정 그리드 템플릿을 쓴다 — 라벨(가변)+건수+성공률+배지+화살표 5칼럼, 항상 같은 위치', () => {
    assert.match(src, /export const ROW_GRID_TEMPLATE = '1fr 64px 50px 76px 16px';/);
    assert.match(src, /display: 'grid', gridTemplateColumns: ROW_GRID_TEMPLATE/);
    // 각 칸이 gridColumn으로 명시적 위치를 가져야 — 배지가 없는 행에서 화살표 칸이 앞으로
    // 당겨오지 않는다(명시 안 하면 grid auto-placement가 빈 칸을 건너뛰어 버린다)
    for (let col = 1; col <= 5; col++) {
      assert.ok(src.includes(`gridColumn: ${col}`), `gridColumn: ${col} 없음`);
    }
  });
});

describe('EventMatrixPanel — 헤더가 행과 같은 그리드 템플릿을 공유한다', () => {
  const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');

  test('SharedMetricRow에서 ROW_GRID_TEMPLATE을 가져와 헤더에 그대로 쓴다', () => {
    assert.match(src, /import SharedMetricRow, \{ ROW_GRID_TEMPLATE \} from '\.\/SharedMetricRow';/);
    assert.match(src, /gridTemplateColumns: ROW_GRID_TEMPLATE/);
  });
});

describe('SummaryBanner — isUrgent가 5단계 등급의 하위 두 단계를 인식하고, "이상감지 0건"엔 안 걸린다', () => {
  const src = read('src/components/v2/reporting/SummaryBanner.jsx');

  test('"이상감지"는 반드시 1 이상 숫자가 붙어야 매칭한다 (0건에 안 걸리는 버그 수정, 2026-09-26)', () => {
    // 실사용 중 "체크인 0건 완료, 이상감지 0건이 있었어요"라는 정상 문장이 빨간 배너로 뜨는
    // 버그가 실제로 발견됨 — 옛 코드는 '이상감지' 부분 문자열만 봤다.
    assert.match(src, /\/이상감지 \[1-9\]\\d\*건\//);
    assert.ok(!src.includes("'이상감지'"), '아직 단순 문자열 매칭을 쓰고 있음');
  });

  test('"불안정해요" 패턴이 urgent 목록에 있다 (조금/아주 불안정해요 둘 다 매칭)', () => {
    assert.match(src, /\/불안정해요\//);
  });

  test('이제 사라진 "운영 문제 N건"/"신경 쓸 부분이" 문구는 없다', () => {
    assert.ok(!src.includes('운영 문제'));
    assert.ok(!src.includes('신경 쓸 부분이'));
  });
});
