import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "@babel/parser";
import { attendeeEmailsForCleaner, matchCleanerAttendee, calendarCleaningTimes } from "../../src/domain/calendarAssignmentDomain.js";
import { toKstDateKey } from "../../server/cleaning/_dispatch.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(path.join(ROOT, "api/cleaning/[...slug].js"), "utf8");

// 비공개 함수도 실제 구현을 실행한다. DB·Google·화면 효과만 메모리 가짜로 주입한다.
// 소스 문자열 존재 검사나 별도로 복제한 알고리즘으로 성공을 판정하지 않는다.
function loadFunction(relativePath, name, dependencies) {
  const text = readFileSync(path.join(ROOT, relativePath), "utf8");
  const ast = parse(text, { sourceType: "module", plugins: ["jsx"] });
  let found;
  function visit(node) {
    if (!node || typeof node !== "object" || found) return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) found = node;
    if (node.type === "VariableDeclarator" && node.id?.name === name && node.init?.callee?.name === "useCallback") {
      found = node.init.arguments[0];
    }
    if (found) return;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  assert.ok(found, `${name} 함수를 찾지 못함`);
  return new Function(...Object.keys(dependencies), `return (${text.slice(found.start, found.end)});`)(...Object.values(dependencies));
}

function functionBlock(name, nextName) {
  const match = source.match(new RegExp(`async function ${name}[\\s\\S]*?(?=\\nasync function ${nextName}|\\nconst |\\nexport default)`));
  assert.ok(match, `${name} 블록을 찾지 못함`);
  return match[0];
}

describe("iCal 수동 동기화 — 기존 Calendar 담당자 복구 연결", () => {
  test("서버 직접 동기화가 담당자 복구 루틴을 호출한다", () => {
    const block = functionBlock("handleIcalSync", "bootstrapBlockers");
    assert.match(block, /repairCalendarAssignments/);
  });

  test("복구 대상은 REAL의 ASSIGNED이며 기존 연결은 같은 담당자·이벤트만 갱신한다", () => {
    const block = functionBlock("repairCalendarAssignments", "handleIcalSync");
    assert.match(block, /data_origin='REAL'/);
    assert.match(block, /status='ASSIGNED'/);
    assert.match(block, /assigned_cleaner_id IS NULL/);
    assert.match(block, /assigned_cleaner_id=\$1 AND google_event_id=\$2/);
  });

  test("담당자 복구 실패가 iCal 예약 동기화 전체를 실패시키지 않는다", () => {
    const block = functionBlock("handleIcalSync", "bootstrapBlockers");
    assert.match(block, /try \{[\s\S]*repairCalendarAssignments/);
    assert.match(block, /catch \(e\)[\s\S]*assignmentRepair/);
  });
});

describe("실제 복구 함수 — Google 이벤트와 DB 담당자 연결", () => {
  async function runRepair(cleaners) {
    const writes = [];
    const repair = loadFunction("api/cleaning/[...slug].js", "repairCalendarAssignments", {
      db: { query: async (sql, params) => {
        if (sql.includes("FROM property_cleaning_config")) return { rows: [{ property_id: "fixture-property", google_calendar_id: "fixture-calendar" }] };
        if (sql.includes("FROM cleaning_jobs")) return { rows: [{ id: "fixture-job", checkout_at: new Date("2026-10-30T02:00:00Z") }] };
        if (sql.includes("FROM cleaners")) return { rows: cleaners };
        if (sql.includes("UPDATE cleaning_jobs")) { writes.push(params); return { rowCount: 1 }; }
        throw new Error("예상하지 못한 DB 호출");
      } },
      getGoogleToken: async () => "fixture-token", kv: {}, CALENDAR_API: "https://example.invalid",
      fetch: async () => ({ ok: true, json: async () => ({ items: [{
        id: "fixture-event", start: { dateTime: "2026-10-30T11:00:00+09:00" },
        end: { dateTime: "2026-10-30T14:00:00+09:00" },
        summary: "검증숙소 청소일정 (검증담당자)",
        organizer: { email: "host@example.invalid" },
        attendees: [{ email: "host@example.invalid" }, { email: "cleaner@example.invalid" }],
      }] }) }),
      attendeeEmailsForCleaner, matchCleanerAttendee, calendarCleaningTimes, toKstDateKey,
    });
    return { result: await repair("fixture-property"), writes };
  }

  test("주최자 다음에 있는 등록 담당자를 실제 UPDATE 인자로 전달한다", async () => {
    const { result, writes } = await runRepair([{ id: "fixture-cleaner", name: "검증담당자", email: "cleaner@example.invalid" }]);
    assert.deepEqual(result, { scanned: 1, repaired: 1 });
    assert.deepEqual(writes, [["fixture-cleaner", "fixture-event", "fixture-job", "2026-10-30T02:00:00.000Z", "2026-10-30T05:00:00.000Z"]]);
  });

  test("실제 누락 사례: 제목의 이름이 같아도 등록 이메일이 다르면 복구되지 않는다", async () => {
    const { result, writes } = await runRepair([{ id: "fixture-cleaner", name: "검증담당자", email: "other@example.invalid" }]);
    assert.deepEqual(result, { scanned: 1, repaired: 0 });
    assert.deepEqual(writes, []);
  });

  test("담당자 복구 오류를 HTTP 200 응답 안에서도 잃지 않는다", async () => {
    let status, body;
    const handler = loadFunction("api/cleaning/[...slug].js", "handleIcalSync", {
      readBody: async () => ({ property_id: "fixture-property" }),
      isAdminScope: () => true, canAccessProperty: () => true,
      db: { query: async () => ({ rows: [{ ical_url: "https://example.invalid/calendar.ics" }] }) },
      syncAllPropertiesIcal: async () => {}, kv: {},
      repairCalendarAssignments: async () => { throw new Error("fixture OAuth failure"); },
      sendJson: (_res, code, value) => { status = code; body = value; },
      console: { error() {} },
    });
    await handler({ method: "POST" }, {}, {});
    assert.equal(status, 200);
    assert.equal(body.created, 0);
    assert.equal(body.assignmentRepair.error, "fixture OAuth failure");
  });
});

describe("동기화 화면 — HTTP 성공과 담당자 복구 성공 구분", () => {
  const failedRepair = { ok: true, created: 0, assignmentRepair: { scanned: 0, repaired: 0, error: "fixture OAuth failure" } };
  const successfulRepair = { ok: true, created: 0, assignmentRepair: { scanned: 3, repaired: 2 } };

  async function runSettingsSync(result) {
    const toasts = [], syncing = [];
    let refreshes = 0;
    const sync = loadFunction("src/components/v2/CleaningManager.jsx", "handleServerSync", {
      setSyncing: value => syncing.push(value),
      apiFetch: async () => result, propertyId: "fixture-property",
      onDataChanged: async () => { refreshes++; },
      Toast: { show: (...args) => toasts.push(args) },
    });
    await sync();
    return { toasts, syncing, refreshes };
  }

  async function runDashboardSync(result) {
    const statuses = [], toasts = [], liveUpdates = [], monitoringConfigs = [];
    let refreshes = 0, successTimestamps = 0;
    const sync = loadFunction("src/components/v2/RoomStateApp.jsx", "runSync", {
      USE_DEMO_DATA: false,
      setSyncStatus: value => statuses.push(value),
      fetch: async () => ({ ok: true, json: async () => result }),
      canonicalPropertyId: cfg => cfg.id,
      errorMessageOf: async () => "unexpected HTTP failure",
      refreshDbProperties: async () => { refreshes++; return [{ property_id: "fixture-property", data_origin: "REAL" }]; },
      cloudRowToLiveProperty: row => ({ id: row.property_id, reservation: null }),
      setLiveProperty: value => liveUpdates.push(value),
      setLastSynced: () => { successTimestamps++; },
      postMonitoringConfig: value => monitoringConfigs.push(value),
      Toast: { show: (...args) => toasts.push(args) },
    });
    await sync({ id: "fixture-property", name: "검증숙소", icalConfigured: true });
    return { statuses, toasts, refreshes, liveUpdates, successTimestamps, monitoringConfigs };
  }

  test("설정 화면: 복구 오류는 완료 대신 기존 실패 알림으로 전달한다", async () => {
    const state = await runSettingsSync(failedRepair);
    assert.equal(state.toasts.length, 1);
    assert.equal(state.toasts[0][1], "e");
    assert.match(state.toasts[0][0], /fixture OAuth failure/);
    assert.equal(state.refreshes, 1, "이미 반영된 예약은 갱신해야 한다");
    assert.deepEqual(state.syncing, [true, false]);
  });

  test("설정 화면: 정상 동기화는 기존 완료 동작을 유지한다", async () => {
    const state = await runSettingsSync(successfulRepair);
    assert.equal(state.toasts[0][1], "s");
    assert.equal(state.refreshes, 1);
    assert.deepEqual(state.syncing, [true, false]);
  });

  test("대시보드: 복구 오류 시 최신 예약은 유지하되 동기화 성공으로 기록하지 않는다", async () => {
    const state = await runDashboardSync(failedRepair);
    assert.deepEqual(state.statuses, ["syncing", "error"]);
    assert.equal(state.toasts[0][1], "e");
    assert.match(state.toasts[0][0], /fixture OAuth failure/);
    assert.equal(state.refreshes, 1);
    assert.equal(state.liveUpdates.length, 1);
    assert.equal(state.successTimestamps, 0);
    assert.equal(state.monitoringConfigs.length, 1, "예약 동기화의 Pi 전달은 담당자 복구 오류와 독립적이다");
  });

  test("대시보드: 정상 동기화는 성공 상태와 마지막 동기화 시각을 갱신한다", async () => {
    const state = await runDashboardSync(successfulRepair);
    assert.deepEqual(state.statuses, ["syncing", "ok"]);
    assert.deepEqual(state.toasts, []);
    assert.equal(state.successTimestamps, 1);
  });
});
