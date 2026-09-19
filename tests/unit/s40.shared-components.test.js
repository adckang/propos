/**
 * s40 — 공유 컴포넌트 도메인 로직 TC
 *
 * 다루는 단위:
 *   A. computeMetricRowDisplay  — src/domain/metricRowDomain.js
 *   B. computeCleaningStats     — src/domain/cleaningStatsDomain.js
 *
 * 설계 원칙:
 *   - 순수함수만 테스트 (React 없음)
 *   - 경계값 중심: 0/null/undefined, threshold 정확히 70/90
 *   - isCount / noData / ratio 세 모드 완전 분리
 *   - CANCELLED 제외 여부, COMPLETED 포함 여부 명시
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetricRowDisplay } from '../../src/domain/metricRowDomain.js';
import { computeCleaningStats }    from '../../src/domain/cleaningStatsDomain.js';

// ══════════════════════════════════════════════════════════════════════════════
// A. computeMetricRowDisplay
//    반환: { countText, ratioText, ratioColor, ratioBg, failCount }
//    tappable = failCount > 0 && !!onDrilldown  (컴포넌트 책임)
// ══════════════════════════════════════════════════════════════════════════════

describe('computeMetricRowDisplay — ratio 모드', () => {

  test('정상 케이스: 11/12 → 92% (Math.round(91.67)), green', () => {
    const r = computeMetricRowDisplay({ numerator: 11, denominator: 12 });
    assert.equal(r.countText,  '11/12건');
    assert.equal(r.ratioText,  '92%');
    assert.equal(r.ratioColor, '#059669');
    assert.equal(r.ratioBg,    '#dcfce7');
    assert.equal(r.failCount,  1);
  });

  test('threshold 경계: 90% — green', () => {
    const r = computeMetricRowDisplay({ numerator: 9, denominator: 10 });
    assert.equal(r.ratioText,  '90%');
    assert.equal(r.ratioColor, '#059669');
  });

  test('threshold 경계: 89% — amber', () => {
    const r = computeMetricRowDisplay({ numerator: 89, denominator: 100 });
    assert.equal(r.ratioText,  '89%');
    assert.equal(r.ratioColor, '#d97706');
    assert.equal(r.ratioBg,    '#fef9c3');
  });

  test('threshold 경계: 70% — amber', () => {
    const r = computeMetricRowDisplay({ numerator: 7, denominator: 10 });
    assert.equal(r.ratioText,  '70%');
    assert.equal(r.ratioColor, '#d97706');
  });

  test('threshold 경계: 69% — red', () => {
    const r = computeMetricRowDisplay({ numerator: 69, denominator: 100 });
    assert.equal(r.ratioText,  '69%');
    assert.equal(r.ratioColor, '#dc2626');
    assert.equal(r.ratioBg,    '#fee2e2');
  });

  test('0% — red (numerator=0)', () => {
    const r = computeMetricRowDisplay({ numerator: 0, denominator: 5 });
    assert.equal(r.ratioText,  '0%');
    assert.equal(r.ratioColor, '#dc2626');
    assert.equal(r.failCount,  5);
  });

  test('100% — green, failCount=0', () => {
    const r = computeMetricRowDisplay({ numerator: 8, denominator: 8 });
    assert.equal(r.ratioText,  '100%');
    assert.equal(r.ratioColor, '#059669');
    assert.equal(r.failCount,  0);
  });

  test('denominator=0 → 해당 없음, failCount=0', () => {
    const r = computeMetricRowDisplay({ numerator: 0, denominator: 0 });
    assert.equal(r.countText,  '—');
    assert.equal(r.ratioText,  '해당 없음');
    assert.equal(r.ratioColor, '#94a3b8');
    assert.equal(r.failCount,  0);
  });

  test('denominator=null → 해당 없음', () => {
    const r = computeMetricRowDisplay({ numerator: null, denominator: null });
    assert.equal(r.ratioText,  '해당 없음');
    assert.equal(r.failCount,  0);
  });

  test('pct는 Math.round 적용: 10/3 → 333%가 아니라 100% cap 없음 (소수 반올림)', () => {
    // 4/7 = 57.14... → 57%
    const r = computeMetricRowDisplay({ numerator: 4, denominator: 7 });
    assert.equal(r.ratioText, '57%');
  });

  test('numerator > denominator → failCount=0 (초과 달성, 드릴다운 불필요)', () => {
    // 110/100 = 110% — 실패 건 없음, failCount 음수여서는 안 됨
    const r = computeMetricRowDisplay({ numerator: 110, denominator: 100 });
    assert.equal(r.ratioText,  '110%');
    assert.equal(r.failCount,  0);   // clamp to 0
  });

  test('numerator=null, ratio 모드 → 해당 없음 (isEmpty로 처리)', () => {
    // denominator가 있어도 numerator가 null이면 isEmpty 처리
    const r = computeMetricRowDisplay({ numerator: null, denominator: 5 });
    assert.equal(r.countText,  '—');
    assert.equal(r.ratioText,  '해당 없음');
    assert.equal(r.failCount,  0);
  });
});

describe('computeMetricRowDisplay — noData 모드', () => {

  test('noData=true → countText=—, ratioText=준비 중, failCount=0', () => {
    const r = computeMetricRowDisplay({ numerator: null, denominator: null, noData: true });
    assert.equal(r.countText,  '—');
    assert.equal(r.ratioText,  '준비 중');
    assert.equal(r.ratioColor, '#94a3b8');
    assert.equal(r.failCount,  0);
  });

  test('noData=true — denominator가 있어도 무시', () => {
    const r = computeMetricRowDisplay({ numerator: 5, denominator: 10, noData: true });
    assert.equal(r.ratioText, '준비 중');
    assert.equal(r.failCount, 0);
  });
});

describe('computeMetricRowDisplay — isCount 모드', () => {

  test('isCount=true, numerator=5 → "5건", ratioText="—", failCount=5', () => {
    const r = computeMetricRowDisplay({ numerator: 5, isCount: true });
    assert.equal(r.countText,  '5건');
    assert.equal(r.ratioText,  '—');
    assert.equal(r.failCount,  5);   // count 자체가 드릴다운 트리거
  });

  test('isCount=true, numerator=0 → "0건", failCount=0 (드릴다운 불필요)', () => {
    const r = computeMetricRowDisplay({ numerator: 0, isCount: true });
    assert.equal(r.countText,  '0건');
    assert.equal(r.failCount,  0);
  });

  test('isCount=true, numerator=null → "—", failCount=0', () => {
    const r = computeMetricRowDisplay({ numerator: null, isCount: true });
    assert.equal(r.countText,  '—');
    assert.equal(r.failCount,  0);
  });

  test('isCount=true — denominator 무시', () => {
    // isCount 행은 분모가 의미 없음
    const r = computeMetricRowDisplay({ numerator: 3, denominator: 10, isCount: true });
    assert.equal(r.countText,  '3건');
    assert.equal(r.ratioText,  '—');
  });
});

describe('computeMetricRowDisplay — 모드 우선순위', () => {

  test('isCount + noData 동시: isCount 우선', () => {
    // 로딩 중인 isCount 행 (numerator=null) → "—" + failCount=0
    const r = computeMetricRowDisplay({ numerator: null, isCount: true, noData: true });
    assert.equal(r.countText, '—');
    assert.equal(r.ratioText, '—');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B. computeCleaningStats
//    입력: cleaning_jobs 배열 (status 필드 필수)
//    반환: { total, assigned, unassigned }
//    - CANCELLED 제외
//    - ASSIGNED + COMPLETED = 배정 완료
//    - PENDING / NOTIFYING_* / ESCALATED = 미배정
// ══════════════════════════════════════════════════════════════════════════════

describe('computeCleaningStats — 기본', () => {

  test('빈 배열 → { total:0, assigned:0, unassigned:0 }', () => {
    const r = computeCleaningStats([]);
    assert.deepEqual(r, { total: 0, assigned: 0, unassigned: 0 });
  });

  test('전부 ASSIGNED', () => {
    const jobs = [
      { status: 'ASSIGNED' },
      { status: 'ASSIGNED' },
      { status: 'ASSIGNED' },
    ];
    const r = computeCleaningStats(jobs);
    assert.deepEqual(r, { total: 3, assigned: 3, unassigned: 0 });
  });

  test('전부 PENDING', () => {
    const jobs = [
      { status: 'PENDING' },
      { status: 'PENDING' },
    ];
    const r = computeCleaningStats(jobs);
    assert.deepEqual(r, { total: 2, assigned: 0, unassigned: 2 });
  });

  test('혼합: ASSIGNED + PENDING + COMPLETED', () => {
    const jobs = [
      { status: 'ASSIGNED' },
      { status: 'PENDING' },
      { status: 'COMPLETED' },
      { status: 'PENDING' },
    ];
    const r = computeCleaningStats(jobs);
    // ASSIGNED + COMPLETED = 2 배정 완료
    assert.equal(r.total,      4);
    assert.equal(r.assigned,   2);
    assert.equal(r.unassigned, 2);
  });
});

describe('computeCleaningStats — CANCELLED 제외', () => {

  test('CANCELLED만 있으면 total=0', () => {
    const jobs = [
      { status: 'CANCELLED' },
      { status: 'CANCELLED' },
    ];
    const r = computeCleaningStats(jobs);
    assert.deepEqual(r, { total: 0, assigned: 0, unassigned: 0 });
  });

  test('CANCELLED는 total에서 제외, 나머지 집계 정상', () => {
    const jobs = [
      { status: 'ASSIGNED' },
      { status: 'CANCELLED' },
      { status: 'PENDING' },
      { status: 'CANCELLED' },
    ];
    const r = computeCleaningStats(jobs);
    assert.equal(r.total,      2);  // CANCELLED 2개 제외
    assert.equal(r.assigned,   1);
    assert.equal(r.unassigned, 1);
  });
});

describe('computeCleaningStats — 미배정 상태 분류', () => {

  test('NOTIFYING_VIP_1 → 미배정', () => {
    const r = computeCleaningStats([{ status: 'NOTIFYING_VIP_1' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('NOTIFYING_VIP_2 → 미배정', () => {
    const r = computeCleaningStats([{ status: 'NOTIFYING_VIP_2' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('NOTIFYING_VIP_3 → 미배정', () => {
    const r = computeCleaningStats([{ status: 'NOTIFYING_VIP_3' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('NOTIFYING_BULK → 미배정', () => {
    const r = computeCleaningStats([{ status: 'NOTIFYING_BULK' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('BULK_REMINDED → 미배정', () => {
    const r = computeCleaningStats([{ status: 'BULK_REMINDED' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('ESCALATED → 미배정 (배정 시도 실패 상태)', () => {
    const r = computeCleaningStats([{ status: 'ESCALATED' }]);
    assert.equal(r.assigned,   0);
    assert.equal(r.unassigned, 1);
  });

  test('COMPLETED → 배정 완료 (청소 완료 = 배정됨)', () => {
    const r = computeCleaningStats([{ status: 'COMPLETED' }]);
    assert.equal(r.assigned,   1);
    assert.equal(r.unassigned, 0);
  });
});

describe('computeCleaningStats — 불변성', () => {

  test('원본 배열 변경 없음', () => {
    const jobs = [{ status: 'ASSIGNED' }, { status: 'PENDING' }];
    const before = JSON.stringify(jobs);
    computeCleaningStats(jobs);
    assert.equal(JSON.stringify(jobs), before);
  });

  test('total === assigned + unassigned 항등식', () => {
    const jobs = [
      { status: 'ASSIGNED' }, { status: 'COMPLETED' },
      { status: 'PENDING' }, { status: 'ESCALATED' },
      { status: 'CANCELLED' },
    ];
    const r = computeCleaningStats(jobs);
    assert.equal(r.total, r.assigned + r.unassigned);
  });
});
