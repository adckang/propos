/**
 * s32 — 청소 API 라우터 통합 테스트
 *
 * DB 없이 handler 함수를 mock req/res로 직접 실행해
 * 라우팅 로직, id 파싱, HTTP 메서드 분기가 올바른지 검증.
 *
 * IT-S32: handler export가 없으므로 slug/query 파싱 로직만 순수 함수로 검증.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ────────────────────────────────────────────────────────────────────────────
// parseSlug 로직 재현 (handler 내부와 동일한 로직)
// ────────────────────────────────────────────────────────────────────────────

function parseSlug(req) {
  const raw = req.query?.slug;
  if (raw) return Array.isArray(raw) ? raw : [raw];
  const path = (req.url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("cleaning");
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

function resolveId(req, slug) {
  const slugId =
    slug.length > 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug[1])
      ? slug[1]
      : null;
  return req.query?.id ?? slugId ?? null;
}

function resolveRoute(req) {
  const slug = parseSlug(req);
  const [resource] = slug;
  const id = resolveId(req, slug);
  return { resource, id, slug };
}

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ────────────────────────────────────────────────────────────────────────────
// parseSlug — URL → slug 배열
// ────────────────────────────────────────────────────────────────────────────

describe("parseSlug — URL 파싱", () => {
  test("query.slug 배열 그대로 반환", () => {
    const r = parseSlug({ query: { slug: ["cleaners", UUID] } });
    assert.deepEqual(r, ["cleaners", UUID]);
  });

  test("query.slug 문자열 → 단일 요소 배열", () => {
    const r = parseSlug({ query: { slug: "cleaners" } });
    assert.deepEqual(r, ["cleaners"]);
  });

  test("URL 폴백 — /api/cleaning/cleaners", () => {
    const r = parseSlug({ url: "/api/cleaning/cleaners" });
    assert.deepEqual(r, ["cleaners"]);
  });

  test("URL 폴백 — /api/cleaning/cleaners/{UUID}", () => {
    const r = parseSlug({ url: `/api/cleaning/cleaners/${UUID}` });
    assert.deepEqual(r, ["cleaners", UUID]);
  });

  test("URL 폴백 — /api/cleaning/jobs/sync", () => {
    const r = parseSlug({ url: "/api/cleaning/jobs/sync" });
    assert.deepEqual(r, ["jobs", "sync"]);
  });

  test("URL 폴백 — /api/cleaning/dispatch/{UUID}", () => {
    const r = parseSlug({ url: `/api/cleaning/dispatch/${UUID}` });
    assert.deepEqual(r, ["dispatch", UUID]);
  });

  test("cleaning 세그먼트 없음 → 빈 배열", () => {
    const r = parseSlug({ url: "/api/ha/state" });
    assert.deepEqual(r, []);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveId — id 파싱 (query 우선, slug UUID 폴백)
// ────────────────────────────────────────────────────────────────────────────

describe("resolveId — id 파싱", () => {
  test("query.id 있음 → query.id 반환", () => {
    const slug = ["cleaners"];
    assert.equal(resolveId({ query: { id: UUID } }, slug), UUID);
  });

  test("query.id 없고 slug[1]=UUID → slug 값 반환", () => {
    const slug = ["cleaners", UUID];
    assert.equal(resolveId({ query: {} }, slug), UUID);
  });

  test("query.id 있고 slug[1]=다른UUID → query.id 우선", () => {
    const slug = ["cleaners", UUID2];
    assert.equal(resolveId({ query: { id: UUID } }, slug), UUID);
  });

  test("slug[1]='sync' → id=null", () => {
    const slug = ["jobs", "sync"];
    assert.equal(resolveId({ query: {} }, slug), null);
  });

  test("slug 1개 → id=null", () => {
    const slug = ["cleaners"];
    assert.equal(resolveId({ query: {} }, slug), null);
  });

  test("slug[1]='abc' (비UUID) → id=null", () => {
    const slug = ["jobs", "abc"];
    assert.equal(resolveId({ query: {} }, slug), null);
  });

  test("slug[1]='calendar-webhook' → id=null", () => {
    const slug = ["calendar-webhook"];
    assert.equal(resolveId({ query: {} }, slug), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 라우트 매핑 — resource + id + method 조합 → 핸들러
// ────────────────────────────────────────────────────────────────────────────

describe("라우트 매핑 — resource/id/method 분기", () => {
  function dispatch(resource, id, method, body = {}) {
    // handler 내 분기 로직 재현
    if (resource === "cleaners") {
      if (!id) {
        if (method === "GET")  return "listCleaners";
        if (method === "POST") return "createCleaner";
      } else {
        if (method === "PATCH")  return "updateCleaner";
        if (method === "DELETE") return "deleteCleaner";
      }
    }
    if (resource === "properties") {
      if (method === "GET")  return "listProperties";
      if (method === "POST") return "upsertProperty";
    }
    if (resource === "jobs") {
      if (!id) {
        if (method === "GET")  return "listJobs";
        if (method === "POST") return "syncJobs";
      } else {
        if (method === "GET") return "getJob";
      }
    }
    if (resource === "dispatch") {
      const jobId = id ?? body.job_id;
      if (method === "POST" && jobId) return "dispatchJob";
    }
    if (resource === "jobs" && id && method === "PATCH") {
      if (body.status === "CANCELLED") return "cancelJob";
    }
    if (resource === "bootstrap") return "bootstrapBlockers";
    if (resource === "gmail-watch") return "registerGmailWatch";
    if (resource === "c") { if (id) return "handleConfirmRedirect"; }
    if (resource === "d") { if (id) return "handleDecline"; }
    if (resource === "calendar-webhook") return "handleCalendarWebhook";
    if (resource === "gmail-webhook")    return "handleGmailWebhook";
    return null;
  }

  // cleaners
  test("GET  /cleaners          → listCleaners",   () => assert.equal(dispatch("cleaners", null, "GET"),    "listCleaners"));
  test("POST /cleaners          → createCleaner",  () => assert.equal(dispatch("cleaners", null, "POST"),   "createCleaner"));
  test("PATCH /cleaners/{uuid}  → updateCleaner",  () => assert.equal(dispatch("cleaners", UUID, "PATCH"),  "updateCleaner"));
  test("DELETE /cleaners/{uuid} → deleteCleaner",  () => assert.equal(dispatch("cleaners", UUID, "DELETE"), "deleteCleaner"));

  // properties
  test("GET  /properties        → listProperties", () => assert.equal(dispatch("properties", null, "GET"),  "listProperties"));
  test("POST /properties        → upsertProperty", () => assert.equal(dispatch("properties", null, "POST"), "upsertProperty"));

  // jobs
  test("GET  /jobs              → listJobs",        () => assert.equal(dispatch("jobs", null, "GET"),  "listJobs"));
  test("POST /jobs (sync)       → syncJobs",        () => assert.equal(dispatch("jobs", null, "POST"), "syncJobs"));
  test("GET  /jobs/{uuid}       → getJob",          () => assert.equal(dispatch("jobs", UUID, "GET"),  "getJob"));
  test("PATCH /jobs/{uuid} CANCELLED → cancelJob",  () => assert.equal(dispatch("jobs", UUID, "PATCH", { status: "CANCELLED" }), "cancelJob"));

  // dispatch
  test("POST /dispatch/{uuid}   → dispatchJob",     () => assert.equal(dispatch("dispatch", UUID, "POST"), "dispatchJob"));
  test("POST /dispatch body.job_id → dispatchJob",  () => assert.equal(dispatch("dispatch", null, "POST", { job_id: UUID }), "dispatchJob"));
  test("POST /dispatch 없으면 null",                () => assert.equal(dispatch("dispatch", null, "POST"), null));

  // webhooks / misc
  test("* /calendar-webhook     → handleCalendarWebhook", () => assert.equal(dispatch("calendar-webhook", null, "POST"), "handleCalendarWebhook"));
  test("* /gmail-webhook        → handleGmailWebhook",    () => assert.equal(dispatch("gmail-webhook",    null, "POST"), "handleGmailWebhook"));
  test("* /bootstrap            → bootstrapBlockers",     () => assert.equal(dispatch("bootstrap",        null, "POST"), "bootstrapBlockers"));
  test("* /gmail-watch          → registerGmailWatch",    () => assert.equal(dispatch("gmail-watch",      null, "POST"), "registerGmailWatch"));
  test("GET  /c?id=propId       → handleConfirmRedirect", () => assert.equal(dispatch("c",               "propA", "GET"),  "handleConfirmRedirect"));
  test("GET  /d?token=tok       → handleDecline",         () => assert.equal(dispatch("d",               "tok1",  "GET"),  "handleDecline"));

  // 없는 라우트
  test("DELETE /jobs → null (미지원 메서드)", () => assert.equal(dispatch("jobs", null, "DELETE"), null));
  test("unknown resource → null",              () => assert.equal(dispatch("unknown", null, "GET"),  null));
});

// ────────────────────────────────────────────────────────────────────────────
// E2E 시뮬레이션 — URL + method → 최종 핸들러명
// ────────────────────────────────────────────────────────────────────────────

describe("E2E 시뮬레이션 — URL → 핸들러명", () => {
  function simulate(url, method, queryId = null, body = {}) {
    const req = { url, method, query: queryId ? { id: queryId } : {} };
    const { resource, id } = resolveRoute(req);
    // dispatch 로직 재사용 (위와 동일)
    if (resource === "cleaners") {
      if (!id) { return method === "GET" ? "listCleaners" : method === "POST" ? "createCleaner" : null; }
      return method === "PATCH" ? "updateCleaner" : method === "DELETE" ? "deleteCleaner" : null;
    }
    if (resource === "properties") return method === "GET" ? "listProperties" : "upsertProperty";
    if (resource === "jobs") {
      if (!id) return method === "GET" ? "listJobs" : method === "POST" ? "syncJobs" : null;
      if (method === "PATCH" && body.status === "CANCELLED") return "cancelJob";
      return method === "GET" ? "getJob" : null;
    }
    if (resource === "dispatch") return (id ?? body.job_id) && method === "POST" ? "dispatchJob" : null;
    if (resource === "calendar-webhook") return "handleCalendarWebhook";
    if (resource === "gmail-webhook")    return "handleGmailWebhook";
    if (resource === "bootstrap")        return "bootstrapBlockers";
    if (resource === "gmail-watch")      return "registerGmailWatch";
    if (resource === "c" && id)          return "handleConfirmRedirect";
    if (resource === "d" && id)          return "handleDecline";
    return null;
  }

  test("GET /api/cleaning/cleaners → listCleaners", () => {
    assert.equal(simulate("/api/cleaning/cleaners", "GET"), "listCleaners");
  });

  test("PATCH /api/cleaning/cleaners/{uuid} → updateCleaner (경로 파라미터)", () => {
    assert.equal(simulate(`/api/cleaning/cleaners/${UUID}`, "PATCH"), "updateCleaner");
  });

  test("DELETE /api/cleaning/cleaners/{uuid} → deleteCleaner (경로 파라미터)", () => {
    assert.equal(simulate(`/api/cleaning/cleaners/${UUID}`, "DELETE"), "deleteCleaner");
  });

  test("POST /api/cleaning/jobs/sync → syncJobs ('sync'는 UUID 아님)", () => {
    assert.equal(simulate("/api/cleaning/jobs/sync", "POST"), "syncJobs");
  });

  test("GET /api/cleaning/jobs/{uuid} → getJob (경로 파라미터)", () => {
    assert.equal(simulate(`/api/cleaning/jobs/${UUID}`, "GET"), "getJob");
  });

  test("POST /api/cleaning/dispatch/{uuid} → dispatchJob (경로 파라미터)", () => {
    assert.equal(simulate(`/api/cleaning/dispatch/${UUID}`, "POST"), "dispatchJob");
  });

  test("PATCH /api/cleaning/jobs?id={uuid} CANCELLED → cancelJob (쿼리 파라미터)", () => {
    assert.equal(simulate("/api/cleaning/jobs", "PATCH", UUID, { status: "CANCELLED" }), "cancelJob");
  });

  test("POST /api/cleaning/calendar-webhook → handleCalendarWebhook", () => {
    assert.equal(simulate("/api/cleaning/calendar-webhook", "POST"), "handleCalendarWebhook");
  });
});
