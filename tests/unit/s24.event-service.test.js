import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { processEvent } from "../../src/application/eventService.js";

// 공통 mock 빌더
function makeDb({ returnId = "aaaa-1111" } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.trim().slice(0, 30), params });
      if (sql.includes("INSERT")) return { rows: [{ id: returnId }] };
      return { rows: [] };
    },
  };
}

describe("processEvent — KV 실패 격리", () => {
  test("KV set 실패해도 이벤트는 complete로 종결", async () => {
    const db = makeDb();
    const kv = {
      set: async () => { throw new Error("KV unavailable"); },
    };
    const event = {
      id: "44444444-4444-4444-4444-444444444444",
      property_id: "paju201",
      type: "check_in_detected",
      device_time: "2026-08-04T10:00:00Z",
    };

    const result = await processEvent(event, {
      db,
      kv,
      notify: async () => ({ sent: false }),
    });

    assert.equal(result.status, "inserted");
    const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE events"));
    assert.ok(updateCall, "UPDATE events 호출 있어야 함");
    assert.equal(updateCall.params[0], "complete");
  });
});

describe("processEvent — UNIMPLEMENTED 이벤트", () => {
  test("저장 후 status='complete' 업데이트, skipped 반환", async () => {
    const db = makeDb();
    const event = {
      id: "11111111-1111-1111-1111-111111111111",
      property_id: "paju201",
      type: "maintenance_required",
      device_time: "2026-08-04T10:00:00Z",
    };

    const result = await processEvent(event, {
      db,
      kv: {},
      notify: async () => ({ sent: false }),
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.id, "aaaa-1111");

    const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE events"));
    assert.ok(updateCall, "UPDATE events 호출 있어야 함");
    assert.equal(updateCall.params[0], "complete");
  });

  test("SOFT 이벤트는 KV 업데이트 없이 inserted 반환", async () => {
    const db = makeDb();
    let kvSetCalled = false;
    const kv = { set: async () => { kvSetCalled = true; } };

    const event = {
      id: "22222222-2222-2222-2222-222222222222",
      property_id: "paju201",
      type: "checkout_confirmation_needed",
      device_time: "2026-08-04T10:00:00Z",
    };

    const result = await processEvent(event, {
      db,
      kv,
      notify: async () => ({ sent: false }),
    });

    assert.equal(result.status, "inserted");
    assert.equal(kvSetCalled, false, "soft 이벤트는 KV set 안 함");
  });

  test("duplicate 이벤트 → status/kv/notify 미호출", async () => {
    const db = {
      calls: [],
      query: async (sql) => {
        db.calls.push(sql.trim().slice(0, 30));
        if (sql.includes("INSERT")) return { rows: [] }; // ON CONFLICT → 빈 결과
        return { rows: [] };
      },
    };
    let notifyCalled = false;
    const event = {
      id: "33333333-3333-3333-3333-333333333333",
      property_id: "paju201",
      type: "check_in_detected",
      device_time: "2026-08-04T10:00:00Z",
    };

    const result = await processEvent(event, {
      db,
      kv: {},
      notify: async () => { notifyCalled = true; return { sent: false }; },
    });

    assert.equal(result.status, "duplicate");
    assert.equal(notifyCalled, false);
    const updateCall = db.calls.find((c) => c.startsWith("UPDATE events"));
    assert.equal(updateCall, undefined, "duplicate는 UPDATE 없어야 함");
  });
});
