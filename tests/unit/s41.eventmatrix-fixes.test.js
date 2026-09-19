/**
 * s41 — EventMatrixPanel 버그 픽스 TC
 *
 * 검증 항목:
 *   A. pctColor / pctBg named export
 *      — metricRowDomain.js 내부 함수로만 존재 → EventMatrixPanel.jsx:95 에서
 *        pctColor(avgScore) 호출 시 ReferenceError (안심지수 렌더 크래시)
 *      — 목표: export 후 EventMatrixPanel이 import해 사용
 *
 *   B. 로딩 상태 계약 — noData vs null/null 구분
 *      — FutureMatrixPanel 기기 준비율: deviceLoading=true 시
 *        noData 없이 numerator=null, denominator=null 전달 → isEmpty → '해당 없음'
 *      — 동일 패턴의 청소 할당율: noData={cleaningLoading} 정상 전달 → '준비 중'
 *      — 계약: 로딩 중 표시는 반드시 noData=true로만 실현 가능함을 명시
 *
 * 시작 시 A 그룹은 전부 FAIL (pctColor/pctBg not exported).
 * B 그룹은 이미 PASS (computeMetricRowDisplay 동작 확인용 regression guard).
 * 구현 후 전부 PASS.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetricRowDisplay, pctColor, pctBg } from '../../src/domain/metricRowDomain.js';

// ══════════════════════════════════════════════════════════════════════════
// A. pctColor named export
//    경계값: 90 (green 하한), 70 (amber 하한), 69 (red 상한)
// ══════════════════════════════════════════════════════════════════════════

describe('pctColor — named export', () => {

  test('pct=100 → green (#059669)', () => {
    assert.equal(pctColor(100), '#059669');
  });

  test('pct=90 → green (경계 포함)', () => {
    assert.equal(pctColor(90), '#059669');
  });

  test('pct=89 → amber (#d97706)', () => {
    assert.equal(pctColor(89), '#d97706');
  });

  test('pct=70 → amber (경계 포함)', () => {
    assert.equal(pctColor(70), '#d97706');
  });

  test('pct=69 → red (#dc2626)', () => {
    assert.equal(pctColor(69), '#dc2626');
  });

  test('pct=0 → red', () => {
    assert.equal(pctColor(0), '#dc2626');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A. pctBg named export
//    pctColor와 동일 경계 — 배경색 반환
// ══════════════════════════════════════════════════════════════════════════

describe('pctBg — named export', () => {

  test('pct=90 → green bg (#dcfce7)', () => {
    assert.equal(pctBg(90), '#dcfce7');
  });

  test('pct=89 → amber bg (#fef9c3)', () => {
    assert.equal(pctBg(89), '#fef9c3');
  });

  test('pct=70 → amber bg (경계 포함)', () => {
    assert.equal(pctBg(70), '#fef9c3');
  });

  test('pct=69 → red bg (#fee2e2)', () => {
    assert.equal(pctBg(69), '#fee2e2');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. 로딩 상태 계약 — noData=true vs null/null 구분
//    이 그룹은 구현 전에도 PASS.
//    목적: FutureMatrixPanel 기기 준비율 픽스 후 동작 계약을 regression-guard.
//
//    계약:
//      로딩 중 → noData=true 전달 필수 → '준비 중'
//      데이터 없음(isEmpty) → noData 없음, null/null 전달 → '해당 없음'
//      두 상태의 ratioText는 반드시 달라야 한다.
// ══════════════════════════════════════════════════════════════════════════

describe('로딩 상태 계약 — noData vs isEmpty 구분', () => {

  test('noData=true → ratioText 준비 중 (로딩 의도 명시)', () => {
    const r = computeMetricRowDisplay({ numerator: null, denominator: null, noData: true });
    assert.equal(r.ratioText, '준비 중');
  });

  test('noData 없음 + null/null → ratioText 해당 없음 (isEmpty 케이스)', () => {
    const r = computeMetricRowDisplay({ numerator: null, denominator: null });
    assert.equal(r.ratioText, '해당 없음');
    // 기기 준비율이 deviceLoading=true 상태에서 noData 없이 null/null을 전달하면
    // 이 경로로 빠져 '해당 없음'이 표시된다 — 잘못된 동작.
  });

  test('noData=true와 null/null 의 ratioText는 달라야 한다', () => {
    const loading = computeMetricRowDisplay({ numerator: null, denominator: null, noData: true });
    const empty   = computeMetricRowDisplay({ numerator: null, denominator: null });
    assert.notEqual(loading.ratioText, empty.ratioText,
      'noData(준비 중)와 isEmpty(해당 없음)는 반드시 다른 문자열이어야 한다');
  });

  test('noData=true → failCount=0 (로딩 중에는 드릴다운 없음)', () => {
    const r = computeMetricRowDisplay({ numerator: 5, denominator: 10, noData: true });
    assert.equal(r.failCount, 0);
  });
});
