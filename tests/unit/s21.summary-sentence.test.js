import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateSummary } from "../../src/application/reportingService.js";

// content-guide.md 규칙:
// - 한 문장에 숫자 최대 2개
// - 내부 상태명 노출 금지 (OCCUPIED, CLEANING_PENDING 등)
// - 이상 없을 때: 짧고 긍정적
// - 이상 있을 때: 명확하게 행동 촉구

const INTERNAL_TERMS = [
  "OCCUPIED",
  "VACANT",
  "CLEANING",
  "PRE_STAY_READY",
  "GOOD_CONDITION",
  "ENERGY_WASTE",
  "ISSUE_COMPLAINT",
  "ISSUE_AND_ENERGY",
  "CLEANING_PENDING",
  "CLEANING_IN_PROGRESS",
  "OPTIMIZING",
  "OPTIMIZED",
];

function countNumbers(str) {
  return (str.match(/\d+/g) || []).length;
}

function hasInternalTerm(str) {
  return INTERNAL_TERMS.some((term) => str.includes(term));
}

describe("generateSummary — 현재 (now)", () => {
  test("이상 없을 때 → 비어 있지 않은 문장 반환", () => {
    const s = generateSummary("now", {
      occupied: 3,
      preStayReady: 1,
      vacant: 10,
      cleaning: 1,
      anomalyCount: 0,
      total: 15,
    });
    assert.ok(s.length > 0, "문장이 비어있음");
  });

  test("이상 있을 때 → 숫자나 '확인' 포함", () => {
    const s = generateSummary("now", {
      occupied: 3,
      preStayReady: 0,
      vacant: 12,
      cleaning: 0,
      anomalyCount: 2,
      total: 15,
    });
    assert.ok(
      s.includes("2") || s.includes("확인"),
      `이상 건수가 없는 문장: "${s}"`
    );
  });

  test("content-guide: 한 문장에 숫자 최대 2개 (now, 이상 있음)", () => {
    const s = generateSummary("now", {
      occupied: 5,
      preStayReady: 2,
      vacant: 8,
      cleaning: 3,
      anomalyCount: 3,
      total: 18,
    });
    assert.ok(countNumbers(s) <= 2, `숫자 ${countNumbers(s)}개 초과: "${s}"`);
  });

  test("content-guide: 내부 상태명 노출 안 함 (now)", () => {
    const s = generateSummary("now", {
      occupied: 3,
      preStayReady: 1,
      vacant: 10,
      cleaning: 1,
      anomalyCount: 0,
      total: 15,
    });
    assert.ok(!hasInternalTerm(s), `내부 용어 노출됨: "${s}"`);
  });
});

describe("generateSummary — 이번 주 / 이번 달", () => {
  test("this_week, 이상 없을 때 → 비어 있지 않은 문장", () => {
    const s = generateSummary("this_week", {
      checkIns: 3,
      checkOuts: 5,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.length > 0);
  });

  test("this_week, 이상 있을 때 → 이상 건수 또는 확인 촉구", () => {
    const s = generateSummary("this_week", {
      checkIns: 3,
      checkOuts: 5,
      anomalies: 1,
      energyWaste: 0,
    });
    assert.ok(
      s.includes("1") || s.includes("이상"),
      `이상 관련 내용 없음: "${s}"`
    );
  });

  test("this_month → 비어 있지 않은 문장", () => {
    const s = generateSummary("this_month", {
      checkIns: 12,
      checkOuts: 10,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.length > 0);
  });

  test("content-guide: 한 문장에 숫자 최대 2개 (this_week)", () => {
    const s = generateSummary("this_week", {
      checkIns: 3,
      checkOuts: 5,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(countNumbers(s) <= 2, `숫자 ${countNumbers(s)}개 초과: "${s}"`);
  });

  test("content-guide: 내부 상태명 노출 안 함 (this_week)", () => {
    const s = generateSummary("this_week", {
      checkIns: 3,
      checkOuts: 5,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(!hasInternalTerm(s), `내부 용어 노출됨: "${s}"`);
  });
});

describe("generateSummary — 지난주 / 지난달", () => {
  test("last_week → 결과 요약 문장 반환", () => {
    const s = generateSummary("last_week", {
      checkIns: 8,
      checkOuts: 8,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.length > 0);
    assert.ok(!hasInternalTerm(s), `내부 용어 노출됨: "${s}"`);
  });

  test("last_month, 이상 있을 때 → 이상 건수 포함", () => {
    const s = generateSummary("last_month", {
      checkIns: 30,
      checkOuts: 29,
      anomalies: 2,
      energyWaste: 1,
    });
    assert.ok(
      s.includes("2") || s.includes("이상"),
      `이상 관련 없음: "${s}"`
    );
    assert.ok(countNumbers(s) <= 2, `숫자 ${countNumbers(s)}개 초과: "${s}"`);
  });
});

describe("generateSummary — 다음 주 / 다음 달", () => {
  test("next_week → checkIns 건수로 예정 문장 (checkOuts 아님)", () => {
    const s = generateSummary("next_week", {
      checkIns: 5,
      checkOuts: 6,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.includes("5"), `체크인 건수(5) 없음: "${s}"`);
    assert.ok(!s.includes("6"), `체크아웃 건수(6)가 잘못 노출됨: "${s}"`);
  });

  test("next_week, checkIns=0 → 예약 없음 문장", () => {
    const s = generateSummary("next_week", {
      checkIns: 0,
      checkOuts: 3,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.includes("없"), `'없음' 문구 없음: "${s}"`);
  });

  test("next_month → 비어 있지 않은 문장", () => {
    const s = generateSummary("next_month", {
      checkIns: 20,
      checkOuts: 18,
      anomalies: 0,
      energyWaste: 0,
    });
    assert.ok(s.length > 0);
    assert.ok(countNumbers(s) <= 2, `숫자 ${countNumbers(s)}개 초과: "${s}"`);
  });
});
