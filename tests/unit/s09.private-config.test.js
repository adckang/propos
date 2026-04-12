import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadPrivateConfig } from "../../src/config/privateConfig.js";

const ORIGINAL_ENV = {
  PROPOS_HA_BASE_URL: process.env.PROPOS_HA_BASE_URL,
  PROPOS_HA_WS_URL: process.env.PROPOS_HA_WS_URL,
  PROPOS_HA_TOKEN: process.env.PROPOS_HA_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv();
});

describe("privateConfig", () => {
  test("환경변수가 있으면 HA 설정을 우선 오버라이드한다", () => {
    process.env.PROPOS_HA_BASE_URL = "https://ha.example.com";
    process.env.PROPOS_HA_WS_URL = "wss://ha.example.com/api/websocket";
    process.env.PROPOS_HA_TOKEN = "token-from-env";

    const config = loadPrivateConfig();

    assert.equal(config.ha.baseUrl, "https://ha.example.com");
    assert.equal(config.ha.wsUrl, "wss://ha.example.com/api/websocket");
    assert.equal(config.ha.token, "token-from-env");
  });

  test("환경변수가 비어 있으면 파일 설정을 유지한다", () => {
    const baseline = loadPrivateConfig();

    process.env.PROPOS_HA_BASE_URL = "   ";
    delete process.env.PROPOS_HA_WS_URL;
    delete process.env.PROPOS_HA_TOKEN;

    const config = loadPrivateConfig();

    assert.equal(config.ha.baseUrl, baseline.ha.baseUrl);
    assert.equal(config.ha.wsUrl, baseline.ha.wsUrl);
    assert.equal(config.ha.token, baseline.ha.token);
  });
});
