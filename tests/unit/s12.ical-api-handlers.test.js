import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  handleNodeIcalRequest,
  handleVercelIcal,
} from "../../server/icalApiHandlers.js";

function createTextResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}

function createNodeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function createVercelResponse() {
  return createNodeResponse();
}

let originalFetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("icalApiHandlers", () => {
  test("handleNodeIcalRequest: GET /api/ical 이 원격 iCal을 프록시한다", async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      return createTextResponse(200, "BEGIN:VCALENDAR\nEND:VCALENDAR");
    };

    const req = {
      method: "GET",
      url: "/api/ical?url=https%3A%2F%2Fexample.com%2Fcalendar.ics",
    };
    const res = createNodeResponse();

    await handleNodeIcalRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /BEGIN:VCALENDAR/);
    assert.equal(res.headers["Content-Type"], "text/calendar; charset=utf-8");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(calls[0].url, "https://example.com/calendar.ics");
    assert.equal(calls[0].options.redirect, "follow");
  });

  test("handleNodeIcalRequest: 허용되지 않은 프로토콜은 500 에러를 반환한다", async () => {
    global.fetch = async () => {
      throw new Error("should not be called");
    };

    const req = {
      method: "GET",
      url: "/api/ical?url=ftp%3A%2F%2Fexample.com%2Fcalendar.ics",
    };
    const res = createNodeResponse();

    await handleNodeIcalRequest(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "Only http/https URLs are allowed" });
  });

  test("handleVercelIcal: 상류 오류를 그대로 전달한다", async () => {
    global.fetch = async () => createTextResponse(502, "bad gateway");

    const req = {
      method: "GET",
      query: { url: "https://example.com/calendar.ics" },
    };
    const res = createVercelResponse();

    await handleVercelIcal(req, res);

    assert.equal(res.statusCode, 502);
    assert.deepEqual(JSON.parse(res.body), { error: "iCal upstream 502: bad gateway" });
    assert.equal(res.headers["Cache-Control"], "no-store");
  });

  test("handleNodeIcalRequest: GET 외 메서드는 405를 반환한다", async () => {
    global.fetch = async () => {
      throw new Error("should not be called");
    };

    const req = {
      method: "POST",
      url: "/api/ical?url=https%3A%2F%2Fexample.com%2Fcalendar.ics",
    };
    const res = createNodeResponse();

    await handleNodeIcalRequest(req, res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
    assert.deepEqual(JSON.parse(res.body), { error: "Method not allowed" });
  });
});
