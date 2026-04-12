/**
 * S07 단위 테스트 — HA 센서 클라이언트 (haClient.getSensorStates)
 * node --test tests/unit/s07.sensor.test.js
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getSensorStates } from "../../src/infrastructure/haClient.js";

// ============================================================
// fetch 모킹 유틸리티
// ============================================================
function makeFetch(responses) {
  // responses: { [entityId]: { state: '24.5' } | null (→ 404) }
  return async (url) => {
    const entityId = url.split('/api/states/')[1];
    const data = responses[entityId];
    if (!data) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    }
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
}

// ============================================================
// TC-SN-001 ~ TC-SN-006
// ============================================================

describe('haClient.getSensorStates — TC-SN-001 ~ TC-SN-006', () => {

  test('TC-SN-001: 온도+습도 센서 모두 정상 → 두 값 모두 반환', async () => {
    const fetch = makeFetch({
      'sensor.temperature_humidity_sensor_temperature': { state: '24.5' },
      'sensor.temperature_humidity_sensor_humidity':    { state: '62.3' },
    });
    const result = await getSensorStates('P-042', fetch);

    assert.equal(result.propId,   'P-042');
    assert.ok(Math.abs(result.temp - 24.5) < 0.01,     `temp 기대 24.5, 실제 ${result.temp}`);
    assert.ok(Math.abs(result.humidity - 62.3) < 0.01, `humidity 기대 62.3, 실제 ${result.humidity}`);
  });

  test('TC-SN-002: 습도 센서 404 → humidity: null, 온도는 정상 반환', async () => {
    const fetch = makeFetch({
      'sensor.temperature_humidity_sensor_temperature': { state: '26.0' },
      // humidity entity 없음
    });
    const result = await getSensorStates('P-042', fetch);

    assert.ok(Math.abs(result.temp - 26.0) < 0.01, `temp 기대 26.0, 실제 ${result.temp}`);
    assert.equal(result.humidity, null, 'humidity가 null이어야 한다');
  });

  test('TC-SN-003: 온도 센서 404 → temp: null, 나머지 null', async () => {
    const fetch = makeFetch({});
    const result = await getSensorStates('P-042', fetch);

    assert.equal(result.temp,     null);
    assert.equal(result.humidity, null);
  });

  test('TC-SN-004: 센서값이 "unavailable"이면 null로 처리', async () => {
    const fetch = makeFetch({
      'sensor.temperature_humidity_sensor_temperature': { state: 'unavailable' },
      'sensor.temperature_humidity_sensor_humidity':    { state: 'unavailable' },
    });
    const result = await getSensorStates('P-042', fetch);

    assert.equal(result.temp,     null, 'unavailable → null');
    assert.equal(result.humidity, null, 'unavailable → null');
  });

  test('TC-SN-005: 센서값이 "unknown"이면 null로 처리', async () => {
    const fetch = makeFetch({
      'sensor.temperature_humidity_sensor_temperature': { state: 'unknown' },
    });
    const result = await getSensorStates('P-042', fetch);

    assert.equal(result.temp, null);
  });

  test('TC-SN-006: noise/power는 현재 null 반환 (미연동 확인)', async () => {
    const fetch = makeFetch({
      'sensor.temperature_humidity_sensor_temperature': { state: '25.0' },
      'sensor.temperature_humidity_sensor_humidity':    { state: '60.0' },
    });
    const result = await getSensorStates('P-042', fetch);

    assert.equal(result.noise, null, 'noise는 null (센서 미연동)');
    assert.equal(result.power, null, 'power는 null (센서 미연동)');
  });

});
