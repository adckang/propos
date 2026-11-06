import '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_TOKEN = 'test-token';
process.env.PROPOS_PI_SECRET = 'fixture-pi-secret';
const { setRoomState, setMonitoringConfig, getMonitoringState, stopWatcher } = await import('../../server/occupancyWatcher.js');

test('DEC-01 regression: reaching T−20 minutes with no sensor/configuration cannot emit completion', async () => {
  const previous = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => '[]', json: async () => ({}) });
  try {
    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig({ areaName: 'test-property', reservation: { checkIn: new Date(Date.now() + 20 * 60_000).toISOString() } });
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = getMonitoringState();
    assert.notEqual(state.roomState.subStatus, 'OPTIMIZED');
    assert.ok(!state.eventLog.some(e => e.type === 'optimization_finished'));
  } finally { stopWatcher(); global.fetch = previous; }
});

test('actual watcher wiring: fresh sensor samples finish preparation after arrival and never replay fixed cooling', async () => {
  const previous = global.fetch, previousNow = Date.now;
  const base = Date.now(); let time = base, temperature = 29, climateState = 'off', doorOpen = false, motion = false;
  const calls = [];
  const ids = ['sensor.fixture_temp', 'sensor.fixture_hum', 'climate.fixture', 'binary_sensor.fixture_door', 'binary_sensor.fixture_motion'];
  Date.now = () => time;
  global.fetch = async (url, options = {}) => {
    const data = options.body ? JSON.parse(options.body) : null;
    if (url.includes('/api/template')) return { ok: true, text: async () => JSON.stringify(ids) };
    if (url.endsWith('/api/services')) return { ok: true, json: async () => [{ domain: 'notify', services: { mobile_app_operator: {} } }] };
    if (url.includes('/api/states/')) {
      const entity = url.split('/api/states/')[1];
      const result = entity === ids[0]
        ? { state: String(temperature), attributes: { device_class: 'temperature', unit_of_measurement: '°C' } }
        : entity === ids[1] ? { state: '48', attributes: { device_class: 'humidity', unit_of_measurement: '%' } }
          : entity === ids[3] ? { state: doorOpen ? 'on' : 'off', attributes: { device_class: 'door' } }
            : entity === ids[4] ? { state: motion ? 'on' : 'off', attributes: { device_class: 'motion' } }
              : { state: climateState, attributes: { hvac_modes: ['off', 'cool', 'heat'], temperature_unit: '°C' } };
      return { ok: true, json: async () => ({ ...result, last_reported: new Date(time).toISOString() }) };
    }
    if (url.includes('/api/services/')) {
      calls.push({ url, data });
      if (url.endsWith('/climate/set_temperature')) climateState = data.hvac_mode;
      if (url.endsWith('/climate/turn_off')) climateState = 'off';
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const cfg = { areaName: 'fixture-healthy-property', devices: { AC_MAIN: 'climate.fixture' },
      reservation: { uid: 'fixture-reservation', checkIn: new Date(base + 3 * 60_000).toISOString(), checkOut: new Date(base + 25 * 60 * 60_000).toISOString() },
      optimization: { operatorNotifyService: 'notify.mobile_app_operator', rooms: [{ id: 'living', temperatureEntity: ids[0], humidityEntity: ids[1], climateEntity: ids[2] }] } };
    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig(cfg);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(getMonitoringState().preparation.run.status, 'PREPARING');
    const starts = calls.filter(c => c.url.endsWith('/climate/set_temperature'));
    assert.equal(starts.length, 1); assert.equal(starts[0].data.temperature, 23);
    // Arrival changes occupancy; it must not send the old fixed 24°C command.
    temperature = 23;
    for (let minute = 1; minute <= 6; minute++) {
      time = base + minute * 60_000;
      doorOpen = minute === 1; motion = minute >= 3;
      setMonitoringConfig(cfg);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const state = getMonitoringState();
    assert.equal(state.preparation.run.status, 'COMPLETED');
    assert.equal(state.roomState.mainStatus, 'OCCUPIED');
    assert.ok(state.eventLog.some(e => e.type === 'check_in_detected'));
    assert.equal(state.eventLog.filter(e => e.type === 'optimization_finished' && e.data.optimizationRunId === state.preparation.run.id).length, 1);
    assert.equal(calls.filter(c => c.url.endsWith('/climate/set_temperature')).length, 1);
    assert.ok(!calls.some(c => c.url.endsWith('/homeassistant/turn_on')));
    assert.equal(climateState, 'off');
  } finally { stopWatcher(); Date.now = previousNow; global.fetch = previous; }
});

test('sensor preparation delivery retries preserve occurrence timestamps and provenance', async () => {
  const previous = global.fetch;
  const bodies = []; let acceptsWrites = false;
  global.fetch = async (url, options = {}) => {
    if (url.includes('/api/events/write')) {
      bodies.push(JSON.parse(options.body));
      return { ok: acceptsWrites, json: async () => ({ inserted: acceptsWrites }) };
    }
    return { ok: true, text: async () => '[]', json: async () => ({}) };
  };
  try {
    const cfg = { areaName: 'fixture-delivery-property', optimization: {}, reservation: { uid: 'delivery-reservation', checkIn: new Date(Date.now() + 20 * 60_000).toISOString() } };
    setRoomState({ mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' });
    setMonitoringConfig(cfg); await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(getMonitoringState().preparationDeliveryPending > 0);
    const first = bodies[0];
    acceptsWrites = true;
    setMonitoringConfig(cfg); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(getMonitoringState().preparationDeliveryPending, 0);
    const retries = bodies.filter(body => body.source_ref === first.source_ref);
    assert.ok(retries.length >= 2);
    assert.ok(retries.every(body => body.device_time === first.device_time));
    assert.ok(retries.every(body => body.property_id === first.property_id));
  } finally { stopWatcher(); global.fetch = previous; }
});
