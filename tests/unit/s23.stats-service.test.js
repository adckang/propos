import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getStatsForPeriod } from "../../src/application/reportingService.js";

// Mock KV — 3개 숙소 상태
const mockKvMulti = {
  keys: async () => ["state:paju201", "state:paju202", "state:paju203"],
  get: async (key) => {
    const data = {
      "state:paju201": { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
      "state:paju202": { mainStatus: "VACANT", subStatus: "CLEANING_FINISHED" },
      "state:paju203": { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
    };
    return data[key] ?? null;
  },
};

// Mock DB — 체크인 1건, 체크아웃 2건
const mockDb = {
  query: async () => ({
    rows: [
      { type: "check_in_detected", property_id: "paju201" },
      { type: "check_out_detected", property_id: "paju201" },
      { type: "check_out_detected", property_id: "paju202" },
    ],
  }),
};

describe("getStatsForPeriod — now (실시간)", () => {
  test("전체 숙소 집계 — occupied/vacant/cleaning 카운트", async () => {
    const result = await getStatsForPeriod("now", { db: mockDb, kv: mockKvMulti });
    assert.equal(result.period, "now");
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.vacant, 1);
    assert.equal(result.stats.cleaning, 1);
    assert.equal(result.stats.total, 3);
    assert.ok(result.summary.length > 0);
  });

  test("단일 숙소 (propertyId 지정) — 해당 숙소 상태만 반환", async () => {
    const singleKv = {
      get: async () => ({ mainStatus: "OCCUPIED", subStatus: "ISSUE_COMPLAINT" }),
    };
    const result = await getStatsForPeriod("now", {
      db: mockDb,
      kv: singleKv,
      propertyId: "paju201",
    });
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.anomalyCount, 1);
    assert.equal(result.stats.total, 1);
  });

  test("KV에 상태 없는 숙소 → 빈 집계 (에러 없음)", async () => {
    const emptyKv = {
      keys: async () => [],
      get: async () => null,
    };
    const result = await getStatsForPeriod("now", { db: mockDb, kv: emptyKv });
    assert.equal(result.stats.total, 0);
    assert.ok(result.summary.length > 0);
  });

  test("period 필드가 결과에 포함됨", async () => {
    const result = await getStatsForPeriod("now", { db: mockDb, kv: mockKvMulti });
    assert.equal(result.period, "now");
    assert.ok(!result.range, "now 는 range 없어야 함");
  });
});

describe("getStatsForPeriod — 기간 이벤트", () => {
  test("last_week → checkIns/checkOuts + range 반환", async () => {
    const result = await getStatsForPeriod("last_week", { db: mockDb, kv: mockKvMulti });
    assert.equal(result.period, "last_week");
    assert.equal(result.stats.checkIns, 1);
    assert.equal(result.stats.checkOuts, 2);
    assert.ok(result.range?.from, "range.from 없음");
    assert.ok(result.range?.to, "range.to 없음");
    assert.ok(result.summary.length > 0);
  });

  test("this_week → stats + summary 반환", async () => {
    const result = await getStatsForPeriod("this_week", { db: mockDb, kv: mockKvMulti });
    assert.equal(result.period, "this_week");
    assert.equal(typeof result.stats.checkIns, "number");
    assert.ok(result.summary.length > 0);
  });

  test("next_month → stats + summary 반환", async () => {
    const result = await getStatsForPeriod("next_month", { db: mockDb, kv: mockKvMulti });
    assert.equal(result.period, "next_month");
    assert.ok(result.range?.from);
    assert.ok(result.summary.length > 0);
  });

  test("KV 미스 단일 숙소 → DB 폴백으로 상태 복원", async () => {
    let setCalled = false;
    const missKv = {
      get: async () => null,
      set: async () => { setCalled = true; },
    };
    const stateDb = {
      // getLastKnownStateFromDB: check_in_detected 반환
      query: async () => ({ rows: [{ type: "check_in_detected" }] }),
    };
    const result = await getStatsForPeriod("now", {
      db: stateDb,
      kv: missKv,
      propertyId: "paju201",
    });
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.total, 1);
    assert.ok(setCalled, "KV 재캐시 set 호출 확인");
  });

  test("KV 미스 + DB에도 없는 숙소 → total 0 (에러 없음)", async () => {
    const missKv = { get: async () => null, set: async () => {} };
    const emptyDb = { query: async () => ({ rows: [] }) };
    const result = await getStatsForPeriod("now", {
      db: emptyDb,
      kv: missKv,
      propertyId: "unknown999",
    });
    assert.equal(result.stats.total, 0);
  });

  test("property_id 지정 시 DB 쿼리 호출됨", async () => {
    let queriedPropertyId = null;
    const capturingDb = {
      query: async (sql, params) => {
        queriedPropertyId = params?.[0];
        return { rows: [] };
      },
    };
    await getStatsForPeriod("last_week", {
      db: capturingDb,
      kv: mockKvMulti,
      propertyId: "paju201",
    });
    assert.equal(queriedPropertyId, "paju201");
  });
});
