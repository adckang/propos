import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let sequence = 0;
async function fixture({ blocked = false } = {}) {
  const originalFetch = global.fetch, originalWs = global.WebSocket;
  const sockets = [];
  let release;
  const gate = blocked ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.handlers = {}; sockets.push(this); }
    addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
    close() { this.readyState = 3; }
    send() {}
    lateClose() { for (const fn of this.handlers.close ?? []) fn({ code: 1000 }); }
  }
  global.WebSocket = FakeSocket;
  global.fetch = async () => { await gate; return { ok: true, text: async () => '[]', json: async () => ({}) }; };
  writeFileSync(join(TEST_DATA_DIR, 'monitoring-config.json'), JSON.stringify({ areaName: 'fixture-property', reservation: null }));
  writeFileSync(join(TEST_DATA_DIR, 'monitoring-state.json'), JSON.stringify({ roomState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' } }));
  const watcher = await import(`../../server/occupancyWatcher.js?shutdown-regression=${++sequence}`);
  return { watcher, sockets, release: () => release?.(), cleanup: () => { watcher.stopWatcher(); global.fetch = originalFetch; global.WebSocket = originalWs; } };
}

test('actual watcher cannot reconnect when the close event arrives after stop', async () => {
  const f = await fixture();
  try {
    f.watcher.startWatcher(); await wait(20);
    assert.equal(f.sockets.length, 1);
    f.watcher.stopWatcher();
    f.sockets[0].lateClose();
    await wait(1150);
    assert.equal(f.sockets.length, 1, 'late close must not schedule a new connection');
  } finally { f.cleanup(); }
});

test('a closed previous socket cannot clear the replacement socket after restart', async () => {
  const f = await fixture();
  try {
    f.watcher.startWatcher(); await wait(20);
    const previous = f.sockets[0];
    f.watcher.stopWatcher(); f.watcher.startWatcher(); await wait(20);
    assert.equal(f.sockets.length, 2);
    previous.lateClose();
    assert.equal(f.watcher.getMonitoringState().wsConnected, true);
  } finally { f.cleanup(); }
});

test('stopping during initial REST loading prevents a late WebSocket connection', async () => {
  const f = await fixture({ blocked: true });
  try {
    f.watcher.startWatcher(); await wait(5);
    f.watcher.stopWatcher(); f.release(); await wait(30);
    assert.equal(f.sockets.length, 0);
  } finally { f.release(); f.cleanup(); }
});

test('an old reconnect already loading REST cannot connect after a stop and fresh start', async () => {
  const f = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    f.watcher.startWatcher(); await wait(20);
    global.fetch = async () => { await gate; return { ok: true, text: async () => '[]', json: async () => ({}) }; };
    f.sockets[0].lateClose(); await wait(1100);
    f.watcher.stopWatcher(); f.watcher.startWatcher(); release(); await wait(40);
    assert.equal(f.sockets.length, 2, 'only the fresh start may create the replacement');
  } finally { release(); f.cleanup(); }
});
