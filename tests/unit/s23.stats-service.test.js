import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getStatsForPeriod } from "../../src/application/reportingService.js";
import { makeStateDb } from "../helpers/stateEventsFixtures.js";

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

// 현재 상태는 이벤트 기록(DB)에서 계산한다 — 임시 저장소(KV)는 호출되면 실패하는 가짜로 넘겨 "안 쓴다"를 증명
const forbiddenKv = new Proxy({}, { get: () => () => { throw new Error("현재 상태 계산이 임시 저장소(KV)를 건드림"); } });

describe("getStatsForPeriod — now (실시간)", () => {
  const HISTORIES = {
    paju201: ["check_in_detected"],                       // 체류중
    paju202: ["cleaning_finished"],                       // 공실
    paju203: ["check_out_detected", "cleaning_started"],  // 청소 중
  };

  test("전체 숙소 집계 — occupied/vacant/cleaning 카운트", async () => {
    const result = await getStatsForPeriod("now", { db: makeStateDb(HISTORIES), kv: forbiddenKv });
    assert.equal(result.period, "now");
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.vacant, 1);
    assert.equal(result.stats.cleaning, 1);
    assert.equal(result.stats.total, 3);
    assert.ok(result.summary.length > 0);
  });

  test("단일 숙소 (propertyIds 지정) — 해당 숙소 상태만 반환", async () => {
    const db = makeStateDb({ paju201: ["check_in_detected", "complaint_detected"], paju202: ["cleaning_finished"] });
    const result = await getStatsForPeriod("now", { db, kv: forbiddenKv, propertyIds: ["paju201"] });
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.anomalyCount, 1);
    assert.equal(result.stats.total, 1);
  });

  test("기록이 없는 숙소들 → 빈 집계 (에러 없음)", async () => {
    const result = await getStatsForPeriod("now", { db: makeStateDb({}), kv: forbiddenKv });
    assert.equal(result.stats.total, 0);
    assert.ok(result.summary.length > 0);
  });

  test("period 필드가 결과에 포함됨", async () => {
    const result = await getStatsForPeriod("now", { db: makeStateDb(HISTORIES), kv: forbiddenKv });
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

  test("체크인한 손님이 계속 머무는 숙소 — 임시 저장소가 비어 있어도 체류중으로 복원", async () => {
    const result = await getStatsForPeriod("now", {
      db: makeStateDb({ paju201: ["check_in_detected"] }),
      kv: forbiddenKv,
      propertyIds: ["paju201"],
    });
    assert.equal(result.stats.occupied, 1);
    assert.equal(result.stats.total, 1);
  });

  test("기록에 없는 숙소 → total 0 (에러 없음)", async () => {
    const result = await getStatsForPeriod("now", {
      db: makeStateDb({ paju201: ["check_in_detected"] }),
      kv: forbiddenKv,
      propertyIds: ["unknown999"],
    });
    assert.equal(result.stats.total, 0);
  });

  test("propertyIds 지정 시 DB 쿼리 ANY 배열로 호출됨 (이벤트·청소 잡 모두)", async () => {
    const calls = [];
    const capturingDb = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    await getStatsForPeriod("last_week", {
      db: capturingDb,
      kv: mockKvMulti,
      propertyIds: ["paju201"],
    });
    const eventsCall = calls.find(c => /FROM events/.test(c.sql));
    const jobsCall   = calls.find(c => /FROM cleaning_jobs/.test(c.sql));
    assert.deepEqual(eventsCall.params[0], ["paju201"]);
    assert.deepEqual(jobsCall.params[2], ["paju201"]);
  });
});
