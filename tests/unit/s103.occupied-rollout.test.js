import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-secret';

test('occupied Pi restart preserves the stay without preparation, device commands or notifications', async () => {
  const previousFetch = global.fetch, previousWs = global.WebSocket;
  const calls = [];
  class FixtureWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; }
    addEventListener() {}
    close() { this.readyState = 3; }
  }
  global.WebSocket = FixtureWebSocket;
  const ids = ['sensor.fixture_temperature', 'sensor.fixture_humidity', 'binary_sensor.fixture_motion', 'binary_sensor.fixture_door', 'climate.fixture'];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' });
    if (url.includes('/api/template')) return { ok: true, text: async () => JSON.stringify(ids) };
    const entity = String(url).split('/api/states/')[1];
    const data = entity === ids[0] ? { state: '24', attributes: { device_class: 'temperature', unit_of_measurement: '°C' } }
      : entity === ids[1] ? { state: '48', attributes: { device_class: 'humidity', unit_of_measurement: '%' } }
        : entity === ids[2] ? { state: 'on', attributes: { device_class: 'motion' } }
          : entity === ids[3] ? { state: 'off', attributes: { device_class: 'door' } }
            : { state: 'cool', attributes: { temperature: 24, hvac_modes: ['off', 'cool', 'heat'], temperature_unit: '°C' } };
    return { ok: true, json: async () => ({ ...data, last_updated: new Date().toISOString() }) };
  };
  try {
    for (const [index, arrivalOffset] of [-60, 20].entries()) {
      const now = Date.now();
      writeFileSync(join(TEST_DATA_DIR, 'monitoring-state.json'), JSON.stringify({ roomState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' }, updatedAt: now }));
      writeFileSync(join(TEST_DATA_DIR, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-occupied-property', dataOrigin: 'REAL',
        reservation: { uid: `fixture-booking-${index}`, checkIn: new Date(now + arrivalOffset * 60_000).toISOString(), checkOut: new Date(now + 48 * 60 * 60_000).toISOString() },
        devices: { AC_MAIN: 'climate.fixture' } }));
      const watcher = await import(`../../server/occupancyWatcher.js?occupied-rollout=${index}`);
      try {
        watcher.startWatcher();
        for (let attempt = 0; attempt < 30 && !watcher.getMonitoringState().wsConnected; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
        const state = watcher.getMonitoringState();
        assert.equal(state.wsConnected, true);
        assert.deepEqual(state.roomState, { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' });
        assert.equal(state.preparation.run, null);
        assert.equal(state.eventLog.length, 0);
        assert.equal(state.softEventLog.length, 0);
        await watcher.shutdownPreparation();
      } finally { watcher.stopWatcher(); }
    }
    assert.ok(calls.some(call => call.url.includes('/api/states/')), 'actual startup must have read the fake sensors');
    assert.ok(!calls.some(call => call.url.includes('/api/services/') || call.url.includes('/api/events/')), 'startup and shutdown must not control occupied equipment or publish events');
  } finally { global.fetch = previousFetch; global.WebSocket = previousWs; }
});
