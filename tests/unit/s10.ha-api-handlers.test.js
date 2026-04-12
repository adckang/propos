import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import {
  handleNodeHaRequest,
  handleVercelService,
  handleVercelState,
  handleVercelStates,
} from "../../server/haApiHandlers.js";

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createNodeRequest({ method = "GET", url = "/", body } = {}) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  const stream = Readable.from(chunks);
  stream.method = method;
  stream.url = url;
  return stream;
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

function parseBody(res) {
  return JSON.parse(res.body || "{}");
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

describe("haApiHandlers", () => {
  test("handleNodeHaRequest: POST /api/ha/service 를 HA 서비스 호출로 프록시한다", async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      return createJsonResponse(200, { ok: true });
    };

    const req = createNodeRequest({
      method: "POST",
      url: "/api/ha/service",
      body: {
        domain: "light",
        service: "turn_on",
        data: { entity_id: "light.room_main" },
      },
    });
    const res = createNodeResponse();

    await handleNodeHaRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://192.168.45.76:8123/api/services/light/turn_on");
    assert.match(calls[0].options.headers.Authorization, /^Bearer /);
  });

  test("handleNodeHaRequest: GET /api/ha/state 가 단일 엔티티 상태를 반환한다", async () => {
    global.fetch = async () => createJsonResponse(200, { entity_id: "lock.front_door_p_042", state: "locked" });

    const req = createNodeRequest({
      method: "GET",
      url: "/api/ha/state?entityId=lock.front_door_p_042",
    });
    const res = createNodeResponse();

    await handleNodeHaRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res), {
      state: { entity_id: "lock.front_door_p_042", state: "locked" },
    });
  });

  test("handleNodeHaRequest: POST /api/ha/states 가 복수 엔티티 상태를 반환한다", async () => {
    global.fetch = async url => {
      const entityId = String(url).split("/api/states/")[1];
      return createJsonResponse(200, { entity_id: entityId, state: entityId.includes("p_042") ? "locked" : "off" });
    };

    const req = createNodeRequest({
      method: "POST",
      url: "/api/ha/states",
      body: {
        entityIds: ["lock.front_door_p_042", "switch.tv_smart_plug_socket_1"],
      },
    });
    const res = createNodeResponse();

    await handleNodeHaRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res), {
      states: {
        "lock.front_door_p_042": { entity_id: "lock.front_door_p_042", state: "locked" },
        "switch.tv_smart_plug_socket_1": { entity_id: "switch.tv_smart_plug_socket_1", state: "off" },
      },
    });
  });

  test("handleNodeHaRequest: 알 수 없는 경로는 404를 반환한다", async () => {
    global.fetch = async () => {
      throw new Error("should not be called");
    };

    const req = createNodeRequest({ method: "GET", url: "/api/ha/unknown" });
    const res = createNodeResponse();

    await handleNodeHaRequest(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(parseBody(res), { error: "Not found" });
  });

  test("handleVercelService: 예외가 발생하면 500을 반환한다", async () => {
    global.fetch = async () => {
      throw new Error("network down");
    };

    const req = {
      body: {
        domain: "switch",
        service: "turn_off",
        data: { entity_id: "switch.tv_smart_plug_socket_1" },
      },
    };
    const res = createVercelResponse();

    await handleVercelService(req, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(parseBody(res), { error: "network down" });
  });

  test("handleVercelState / handleVercelStates 가 쿼리와 바디를 각각 처리한다", async () => {
    global.fetch = async url => {
      const entityId = String(url).split("/api/states/")[1];
      return createJsonResponse(200, { entity_id: entityId, state: "ok" });
    };

    const stateReq = { query: { entityId: "sensor.temperature_humidity_sensor_temperature" } };
    const stateRes = createVercelResponse();
    await handleVercelState(stateReq, stateRes);

    const statesReq = {
      body: { entityIds: ["sensor.temperature_humidity_sensor_temperature"] },
    };
    const statesRes = createVercelResponse();
    await handleVercelStates(statesReq, statesRes);

    assert.deepEqual(parseBody(stateRes), {
      state: {
        entity_id: "sensor.temperature_humidity_sensor_temperature",
        state: "ok",
      },
    });
    assert.deepEqual(parseBody(statesRes), {
      states: {
        "sensor.temperature_humidity_sensor_temperature": {
          entity_id: "sensor.temperature_humidity_sensor_temperature",
          state: "ok",
        },
      },
    });
  });
});
