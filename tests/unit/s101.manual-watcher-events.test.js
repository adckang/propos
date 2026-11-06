import '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-secret';
const watcher = await import('../../server/occupancyWatcher.js');
const { handleMonitoringEventRequest } = await import('../../server/monitoringEventHandler.js');

test('actual Pi event endpoint rejects invalid JSON and cannot accept invented completion events', async () => {
  for (const raw of ['not-json', 'null', '[]', JSON.stringify({ type: 'optimization_finished', propertyId: 'fixture-property' })]) {
    const req = Readable.from([Buffer.from(raw)]);
    const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await handleMonitoringEventRequest(req, res);
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, undefined);
  }
});

test('manual cleaning is processed by the actual Pi watcher, with one sensor-based run and no calendar state overwrite', async () => {
  assert.equal(typeof watcher.dispatchMonitoringEvent, 'function');
  const previous = global.fetch;
  const calls = [];
  const ids = ['sensor.fixture_temp', 'sensor.fixture_hum', 'climate.fixture'];
  global.fetch = async (url, options = {}) => {
    const data = options.body ? JSON.parse(options.body) : null;
    if (url.includes('/api/template')) return { ok: true, text: async () => JSON.stringify(ids) };
    if (url.endsWith('/api/services')) return { ok: true, json: async () => [{ domain: 'notify', services: { mobile_app_operator: {} } }] };
    if (url.includes('/api/states/')) {
      const entity = url.split('/api/states/')[1];
      const state = entity === ids[0] ? { state: '29', attributes: { unit_of_measurement: '°C' } }
        : entity === ids[1] ? { state: '48', attributes: { unit_of_measurement: '%' } }
          : { state: 'off', attributes: { hvac_modes: ['off', 'cool', 'heat'], temperature_unit: '°C' } };
      return { ok: true, json: async () => ({ ...state, last_reported: new Date().toISOString() }) };
    }
    calls.push({ url, data });
    return { ok: true, json: async () => ({}) };
  };
  try {
    watcher.setRoomState({ mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' });
    watcher.setMonitoringConfig({ areaName: 'fixture-property', dataOrigin: 'REAL',
      reservation: { uid: 'fixture-booking', checkIn: new Date(Date.now() + 20 * 60_000).toISOString() },
      optimization: { operatorNotifyService: 'notify.mobile_app_operator', rooms: [{ id: 'living', temperatureEntity: ids[0], humidityEntity: ids[1], climateEntity: ids[2] }] } });
    await new Promise(resolve => setTimeout(resolve, 30));
    const first = watcher.dispatchMonitoringEvent({ type: 'cleaning_finished', propertyId: 'fixture-property' });
    const duplicate = watcher.dispatchMonitoringEvent({ type: 'cleaning_finished', propertyId: 'fixture-property' });
    const results = await Promise.allSettled([first, duplicate]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.status, 409);
    const state = watcher.getMonitoringState();
    assert.equal(state.preparation.run.status, 'PREPARING');
    assert.equal(state.roomState.subStatus, 'OPTIMIZING');
    assert.equal(state.eventLog.filter(event => event.type === 'cleaning_finished').length, 1);
    assert.equal(state.eventLog.filter(event => event.type === 'checkin_prep_time_reached').length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/climate/set_temperature')).length, 1);
    assert.ok(!state.eventLog.some(event => event.type === 'optimization_finished'));
    const prior = JSON.stringify(state.roomState);
    await assert.rejects(watcher.dispatchMonitoringEvent({ type: 'maintenance_started', propertyId: 'other-property' }), { status: 409 });
    await assert.rejects(watcher.dispatchMonitoringEvent({ type: 'optimization_finished', propertyId: 'fixture-property' }), { status: 400 });
    await assert.rejects(watcher.dispatchMonitoringEvent({ type: 'cleaning_started' }), { status: 400 });
    assert.equal(JSON.stringify(watcher.getMonitoringState().roomState), prior);
    for (const [type, expectedSub] of [['maintenance_started', 'MAINTENANCE'], ['maintenance_finished', 'CLEANING_FINISHED']]) {
      const req = Readable.from([Buffer.from(JSON.stringify({ type, propertyId: 'fixture-property' }))]);
      const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
      await handleMonitoringEventRequest(req, res);
      assert.equal(res.status, 200);
      assert.equal(res.body.roomState.subStatus, expectedSub);
      const eventsBeforeRetry = watcher.getMonitoringState().eventLog.length;
      await assert.rejects(watcher.dispatchMonitoringEvent({ type, propertyId: 'fixture-property' }), { status: 409 });
      assert.equal(watcher.getMonitoringState().eventLog.length, eventsBeforeRetry);
    }
  } finally { watcher.stopWatcher(); global.fetch = previous; }
});

test('shutdown during a manual transition rejects queued work and cannot start preparation afterwards', async () => {
  const isolated = await import('../../server/occupancyWatcher.js?manual-shutdown');
  const previous = global.fetch;
  let entered, release;
  const enteredNotification = new Promise(resolve => { entered = resolve; });
  const blockedNotification = new Promise(resolve => { release = resolve; });
  global.fetch = async url => {
    if (url.includes('/persistent_notification/create')) { entered(); await blockedNotification; }
    return { ok: true, text: async () => '[]', json: async () => ({}) };
  };
  try {
    isolated.setRoomState({ mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' });
    isolated.setMonitoringConfig({ areaName: 'shutdown-property', reservation: { uid: 'shutdown-booking', checkIn: new Date(Date.now() + 20 * 60_000).toISOString() } });
    await new Promise(resolve => setTimeout(resolve, 20));
    const first = isolated.dispatchMonitoringEvent({ type: 'cleaning_finished', propertyId: 'shutdown-property' });
    const queued = isolated.dispatchMonitoringEvent({ type: 'maintenance_started', propertyId: 'shutdown-property' });
    const completed = Promise.allSettled([first, queued]);
    await enteredNotification;
    await isolated.shutdownPreparation();
    release();
    const results = await completed;
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.status, 503);
    assert.equal(isolated.getMonitoringState().preparation.run, null);
  } finally { release(); isolated.stopWatcher(); global.fetch = previous; }
});
