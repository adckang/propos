import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { request } from '../helpers/eventApiFixture.js';

process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-key';
let sequence = 0;
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), 'Expected delivery condition within 500ms');
}
async function fixture() {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  const folder = mkdtempSync(join(TEST_DATA_DIR, 'delivery-'));
  process.env.PROPOS_DATA_DIR = folder;
  const stateFile = join(folder, 'monitoring-state.json');
  const calls = [], modules = [];
  let respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; }
    addEventListener() {}
    close() { this.readyState = 3; }
  }
  global.WebSocket = FakeSocket;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/events/write')) {
      const call = { url: String(url), options, body: JSON.parse(options.body) };
      calls.push(call);
      return respond(call);
    }
    assert.ok(String(url).startsWith('http://ha.test/'), 'Tests must never call external services');
    return { ok: true, text: async () => '[]', json: async () => ({}) };
  };
  async function load() {
    const watcher = await import(`../../server/occupancyWatcher.js?event-delivery=${++sequence}`);
    modules.push(watcher); return watcher;
  }
  const watcher = await load();
  const config = { areaName: 'fixture-delivery-property', reservation: null };
  watcher.setRoomState({ mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' });
  watcher.setMonitoringConfig(config); await settle();
  return {
    watcher, calls, folder, stateFile, load, config,
    stored: () => JSON.parse(readFileSync(stateFile, 'utf8')),
    respond(fn) { respond = fn; },
    async emit() {
      await watcher.dispatchMonitoringEvent({ type: 'cleaning_finished', propertyId: config.areaName });
      await settle();
    },
    async tick(module = watcher) { module.setMonitoringConfig(config); await settle(); },
    cleanup() { for (const module of modules) module.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}

for (const status of [401, 500]) {
  test(`ordinary event survives HTTP ${status}, retries unchanged, and accepts duplicate acknowledgement`, async () => {
    const f = await fixture();
    try {
      f.respond(async () => ({ ok: false, status }));
      await f.emit();
      assert.equal(f.stored().preparationOutbox.length, 1);
      const first = structuredClone(f.calls[0].body);
      assert.ok(first.source_ref, 'Occurrence needs its own stable trace');
      assert.equal(first.source_system, 'HA_WATCHER');
      f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: false, id: null }) }));
      await f.tick();
      await until(() => f.stored().preparationOutbox.length === 0);
      assert.deepEqual(f.calls[1].body, first);
      assert.equal(f.calls[1].options.headers['x-pi-secret'], 'fixture-key');
      assert.ok(f.calls[1].options.signal instanceof AbortSignal);
    } finally { f.cleanup(); }
  });
}

test('ordinary network failures remain durable and retry after Pi module restart', async () => {
  const f = await fixture();
  try {
    f.respond(async () => { throw new Error('fixture offline'); });
    await f.emit();
    assert.equal(f.stored().preparationOutbox.length, 1);
    const first = structuredClone(f.calls[0].body);
    f.watcher.stopWatcher();
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }));
    const restored = await f.load(); restored.startWatcher();
    await until(() => f.calls.length >= 2 && f.stored().preparationOutbox.length === 0);
    assert.deepEqual(f.calls[1].body, first);
    assert.equal(restored.getMonitoringState().roomState.subStatus, 'CLEANING_FINISHED');
  } finally { f.cleanup(); }
});

test('events persist while credentials are missing and send once credentials are available on restart', async () => {
  const previousSecret = process.env.PROPOS_PI_SECRET;
  delete process.env.PROPOS_PI_SECRET;
  const f = await fixture();
  try {
    await f.emit();
    assert.equal(f.calls.length, 0);
    assert.equal(f.stored().preparationOutbox.length, 1);
    f.watcher.stopWatcher(); process.env.PROPOS_PI_SECRET = previousSecret;
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }));
    const restored = await f.load(); restored.startWatcher();
    await until(() => f.calls.length === 1 && f.stored().preparationOutbox.length === 0);
  } finally { process.env.PROPOS_PI_SECRET = previousSecret; f.cleanup(); }
});

test('concurrent ordinary events use one sender and preserve FIFO occurrence payloads', async () => {
  const f = await fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    f.respond(async () => { await gate; return { ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }; });
    await f.emit();
    await f.watcher.dispatchMonitoringEvent({ type: 'maintenance_started', propertyId: f.config.areaName });
    assert.equal(f.calls.length, 1);
    assert.equal(f.stored().preparationOutbox.length, 2);
    release();
    await until(() => f.stored().preparationOutbox.length === 0);
    assert.deepEqual(f.calls.map(call => call.body.type), ['cleaning_finished', 'maintenance_started']);
  } finally { release(); await settle(); f.cleanup(); }
});

test('pre-existing preparation queue format is restored without changing its timestamp or source', async () => {
  const f = await fixture();
  const payload = { type: 'optimization_failed', is_soft: false, device_time: 1794193200000,
    property_id: f.config.areaName, source_system: 'HA_WATCHER', source_ref: 'optimization:fixture-run:optimization_failed',
    data: { preparationPolicy: 'sensor-v1', optimizationRunId: 'fixture-run', status: 'FAILED' } };
  try {
    f.watcher.stopWatcher();
    writeFileSync(f.stateFile, JSON.stringify({ roomState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' }, preparationOutbox: [payload] }));
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: false, id: null }) }));
    const restored = await f.load(); restored.startWatcher();
    await until(() => f.calls.length === 1 && f.stored().preparationOutbox.length === 0);
    assert.deepEqual(f.calls[0].body, payload);
  } finally { f.cleanup(); }
});

test('unacknowledged 200 responses do not erase a queued event', async () => {
  const f = await fixture();
  try {
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await f.emit();
    assert.equal(f.stored().preparationOutbox.length, 1);
  } finally { f.cleanup(); }
});

test('permanent validation rejection is retained separately and does not block the next valid event', async () => {
  const f = await fixture();
  try {
    f.respond(async () => ({ ok: false, status: 400 }));
    await f.emit();
    assert.equal(f.stored().eventDeliveryRejected.length, 1);
    assert.equal(f.stored().eventDeliveryRejected[0].httpStatus, 400);
    assert.equal(f.stored().eventDeliveryRejected[0].payload.type, 'cleaning_finished');
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }));
    await f.watcher.dispatchMonitoringEvent({ type: 'maintenance_started', propertyId: f.config.areaName });
    await until(() => f.stored().preparationOutbox.length === 0);
    assert.equal(f.stored().eventDeliveryRejected.length, 1);
    assert.equal(f.watcher.getMonitoringState().preparationDeliveryPending, 0);
    assert.equal(f.watcher.getMonitoringState().eventDeliveryRejectedCount, 1);
    f.watcher.stopWatcher();
    const restored = await f.load(); restored.startWatcher(); await settle();
    assert.equal(restored.getMonitoringState().eventDeliveryRejectedCount, 1);
    assert.deepEqual(f.stored().eventDeliveryRejected[0].payload, f.calls[0].body);
  } finally { f.cleanup(); }
});

test('no network send occurs before durable enqueue succeeds', async () => {
  const f = await fixture();
  try {
    mkdirSync(`${f.stateFile}.tmp`);
    await f.emit();
    assert.equal(f.calls.length, 0);
    assert.equal(f.watcher.getMonitoringState().statePersistenceFailed, true);
    rmdirSync(`${f.stateFile}.tmp`);
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }));
    await f.tick();
    await until(() => f.calls.length === 1 && f.stored().preparationOutbox.length === 0);
  } finally { f.cleanup(); }
});

test('failure to persist an acknowledgement keeps the event for a duplicate-safe retry', async () => {
  const f = await fixture();
  try {
    f.respond(async () => { mkdirSync(`${f.stateFile}.tmp`); return { ok: true, status: 200, json: async () => ({ inserted: true, id: 'fixture-receipt' }) }; });
    await f.emit();
    assert.equal(f.watcher.getMonitoringState().eventDeliveryPending, 1);
    const first = structuredClone(f.calls[0].body);
    rmdirSync(`${f.stateFile}.tmp`);
    f.respond(async () => ({ ok: true, status: 200, json: async () => ({ inserted: false, id: null }) }));
    await f.tick(); await until(() => f.stored().preparationOutbox.length === 0);
    assert.deepEqual(f.calls[1].body, first);
  } finally { f.cleanup(); }
});

test('actual watcher payload passes the actual API validator/INSERT and adds no server Slack or cache effects', async () => {
  const f = await fixture(); const apiCalls = [];
  try {
    f.respond(async call => {
      const result = await request('write', call.body, { duplicate: apiCalls.length > 0 });
      apiCalls.push(result);
      return { ok: result.res.code === 200, status: result.res.code, json: async () => result.res.body };
    });
    await f.emit(); await until(() => f.stored().preparationOutbox.length === 0);
    assert.equal(apiCalls[0].res.code, 200);
    assert.equal(apiCalls[0].calls.filter(call => call.sql.includes('INSERT INTO events')).length, 1);
    assert.deepEqual(apiCalls[0].notices, []);
    assert.deepEqual(apiCalls[0].cache, []);
    assert.ok(!apiCalls[0].calls.some(call => call.sql.includes('UPDATE events')));
  } finally { f.cleanup(); }
});
