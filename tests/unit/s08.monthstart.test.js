/**
 * S08 단위 테스트 — S05 월말 정산 자동 트리거 유틸
 * node --test tests/unit/s08.monthstart.test.js
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getSettlementPeriod, isSettlementDay } from "../../src/utils/settlementSchedule.js";

// ============================================================
// TC-MS-001 ~ TC-MS-007
// ============================================================

describe('settlementSchedule — TC-MS-001 ~ TC-MS-007', () => {

  test('TC-MS-001: 1일이면 isSettlementDay() === true', () => {
    assert.ok(isSettlementDay(new Date('2026-04-01T00:00:00')));
    assert.ok(isSettlementDay(new Date('2026-01-01T23:59:59')));
    assert.ok(isSettlementDay(new Date('2026-12-01T12:00:00')));
  });

  test('TC-MS-002: 1일이 아니면 isSettlementDay() === false', () => {
    assert.ok(!isSettlementDay(new Date('2026-04-02T00:00:00')));
    assert.ok(!isSettlementDay(new Date('2026-04-15T00:00:00')));
    assert.ok(!isSettlementDay(new Date('2026-04-30T23:59:59')));
  });

  test('TC-MS-003: getSettlementPeriod() — 1월이면 전년도 12월 반환', () => {
    const p = getSettlementPeriod(new Date('2026-01-01'));
    assert.equal(p.year,  2025);
    assert.equal(p.month, 12);
    assert.equal(p.label, '2025년 12월');
  });

  test('TC-MS-004: getSettlementPeriod() — 4월이면 3월 반환', () => {
    const p = getSettlementPeriod(new Date('2026-04-01'));
    assert.equal(p.year,  2026);
    assert.equal(p.month, 3);
    assert.equal(p.label, '2026년 3월');
  });

  test('TC-MS-005: getSettlementPeriod() — 12월이면 11월 반환', () => {
    const p = getSettlementPeriod(new Date('2026-12-01'));
    assert.equal(p.year,  2026);
    assert.equal(p.month, 11);
    assert.equal(p.label, '2026년 11월');
  });

  test('TC-MS-006: isSettlementDay(undefined) — 현재 날짜로 처리 (에러 없음)', () => {
    assert.doesNotThrow(() => isSettlementDay());
  });

  test('TC-MS-007: getSettlementPeriod(undefined) — 현재 날짜 기준 전월 반환 (에러 없음)', () => {
    assert.doesNotThrow(() => {
      const p = getSettlementPeriod();
      assert.ok(p.year > 0);
      assert.ok(p.month >= 1 && p.month <= 12);
      assert.ok(typeof p.label === 'string');
    });
  });

});
