import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getPeriodRange } from "../../src/domain/reportingDomain.js";

// 기준일: 2026-08-04 (화요일, UTC) = 2026-08-04 KST (21:00 KST, 같은 날)
const REF = new Date("2026-08-04T12:00:00Z");

// KST 기준 날짜 문자열 반환 (YYYY-MM-DD)
// from/to 는 KST 자정을 UTC로 표현한 값이므로, 검증 시 KST로 역변환해서 확인해야 함
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstDate(d) {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

describe("getPeriodRange — 현재", () => {
  test("'now' → null 반환 (날짜 범위 없음)", () => {
    assert.equal(getPeriodRange("now", REF), null);
  });
});

describe("getPeriodRange — 주 단위", () => {
  test("'this_week' → 이번 주 월요일~일요일 (KST 기준)", () => {
    const { from, to } = getPeriodRange("this_week", REF);
    assert.equal(kstDate(from), "2026-08-03"); // KST 월요일 00:00
    assert.equal(kstDate(to),   "2026-08-09"); // KST 일요일 23:59
  });

  test("'last_week' → 직전 주 월~일 (KST 기준)", () => {
    const { from, to } = getPeriodRange("last_week", REF);
    assert.equal(kstDate(from), "2026-07-27");
    assert.equal(kstDate(to),   "2026-08-02");
  });

  test("'next_week' → 다음 주 월~일 (KST 기준)", () => {
    const { from, to } = getPeriodRange("next_week", REF);
    assert.equal(kstDate(from), "2026-08-10");
    assert.equal(kstDate(to),   "2026-08-16");
  });

  test("기준일이 월요일일 때 this_week", () => {
    const monday = new Date("2026-08-03T00:00:00Z"); // UTC 00:00 = KST 09:00, 같은 날 월요일
    const { from, to } = getPeriodRange("this_week", monday);
    assert.equal(kstDate(from), "2026-08-03");
    assert.equal(kstDate(to),   "2026-08-09");
  });

  test("기준일이 일요일일 때 this_week", () => {
    const sunday = new Date("2026-08-09T12:00:00Z"); // KST 21:00 일요일
    const { from, to } = getPeriodRange("this_week", sunday);
    assert.equal(kstDate(from), "2026-08-03");
    assert.equal(kstDate(to),   "2026-08-09");
  });
});

describe("getPeriodRange — 월 단위", () => {
  test("'this_month' → 이번 달 1일~말일 (KST 기준)", () => {
    const { from, to } = getPeriodRange("this_month", REF);
    assert.equal(kstDate(from), "2026-08-01");
    assert.equal(kstDate(to),   "2026-08-31");
  });

  test("'last_month' → 직전 달 (KST 기준)", () => {
    const { from, to } = getPeriodRange("last_month", REF);
    assert.equal(kstDate(from), "2026-07-01");
    assert.equal(kstDate(to),   "2026-07-31");
  });

  test("'next_month' → 다음 달 (KST 기준)", () => {
    const { from, to } = getPeriodRange("next_month", REF);
    assert.equal(kstDate(from), "2026-09-01");
    assert.equal(kstDate(to),   "2026-09-30");
  });

  test("1월 last_month → 직전 해 12월 (연도 경계)", () => {
    const jan = new Date("2026-01-15T12:00:00Z");
    const { from, to } = getPeriodRange("last_month", jan);
    assert.equal(kstDate(from), "2025-12-01");
    assert.equal(kstDate(to),   "2025-12-31");
  });

  test("12월 next_month → 다음 해 1월 (연도 경계)", () => {
    const dec = new Date("2026-12-10T12:00:00Z");
    const { from, to } = getPeriodRange("next_month", dec);
    assert.equal(kstDate(from), "2027-01-01");
    assert.equal(kstDate(to),   "2027-01-31");
  });

  test("윤년 2월 this_month", () => {
    const feb = new Date("2028-02-10T12:00:00Z"); // 2028은 윤년
    const { from, to } = getPeriodRange("this_month", feb);
    assert.equal(kstDate(from), "2028-02-01");
    assert.equal(kstDate(to),   "2028-02-29");
  });
});

describe("getPeriodRange — 오류 처리", () => {
  test("알 수 없는 period → Error throw", () => {
    assert.throws(
      () => getPeriodRange("unknown_period", REF),
      /unknown period/i
    );
  });
});
