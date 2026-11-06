import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { requestMonitoringEvent } from '../../src/infrastructure/monitoringClient.js';
import { getNextRoomState, isValidTransition } from '../../src/domain/room-state/roomStateDomain.js';

test('actual monitoring client sends operations to the selected watcher without a predicted state', async () => {
  const previous = global.fetch;
  const sent = [];
  global.fetch = async (url, options) => {
    sent.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, roomState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' } }) };
  };
  try {
    for (const type of ['cleaning_started', 'cleaning_finished', 'maintenance_started', 'maintenance_finished']) {
      await requestMonitoringEvent(type, 'fixture-property', 'watcher/2');
      assert.equal(sent.at(-1).url, '/api/monitoring/event?watcherId=watcher%2F2');
      assert.deepEqual(JSON.parse(sent.at(-1).options.body), { type, propertyId: 'fixture-property' });
    }
    await assert.rejects(requestMonitoringEvent('cleaning_finished', 'fixture-property', null));
    assert.equal(sent.length, 4, 'missing target cannot silently operate a default watcher');
  } finally { global.fetch = previous; }
});

test('offline, old Pi (404), forbidden and malformed successes cannot report operation success', async () => {
  const previous = global.fetch;
  try {
    for (const status of [401, 403, 404, 409, 502]) {
      global.fetch = async () => ({ ok: false, status, json: async () => ({ error: 'fixture failure' }) });
      await assert.rejects(requestMonitoringEvent('cleaning_finished', 'fixture-property', 'watcher1'));
    }
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await assert.rejects(requestMonitoringEvent('cleaning_finished', 'fixture-property', 'watcher1'));
    global.fetch = async () => { throw new Error('fixture disconnected'); };
    await assert.rejects(requestMonitoringEvent('cleaning_finished', 'fixture-property', 'watcher1'));
  } finally { global.fetch = previous; }
});

// Execute the component's actual function body; do not copy its business logic.
const source = readFileSync(new URL('../../src/components/v2/RoomStateApp.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'FunctionDeclaration' && node.id?.name === name) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = find(child, name);
      if (found) return found;
    }
  }
  return null;
}

test('actual cleaning button accepts Pi state only and preserves state on request failure', async () => {
  const node = find(ast, 'performRoomOperation');
  assert.ok(node);
  const states = [], toasts = [], calls = [];
  const ctx = { USE_DEMO_DATA: false, monitorState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
    selectedProperty: { id: 'fixture-property', dataOrigin: 'REAL' }, liveProperty: { id: 'fixture-property' },
    syncConfig: { name: 'fixture-property', watcherId: 'watcher1' }, isValidTransition, getNextRoomState,
    requestMonitoringEvent: async (...args) => { calls.push(args); return { roomState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' } }; },
    setMonitorState: state => states.push(state), setLastMonitorEvent: () => {}, Toast: { show: (...args) => toasts.push(args) } };
  vm.createContext(ctx);
  vm.runInContext(`${source.slice(node.start, node.end)}\nthis.run=performRoomOperation;`, ctx);
  await ctx.run('cleaning_finished', 'fixture success');
  assert.deepEqual(calls[0], ['cleaning_finished', 'fixture-property', 'watcher1']);
  assert.equal(states.length, 1);
  assert.equal(states[0].mainStatus, 'VACANT', 'the browser must not advance it to calendar-predicted PRE_STAY_READY');
  ctx.requestMonitoringEvent = async () => { throw new Error('fixture disconnected'); };
  await ctx.run('cleaning_finished', 'fixture success');
  assert.equal(states.length, 1);
  assert.equal(toasts.filter(item => item[0] === 'fixture success').length, 1);
  ctx.requestMonitoringEvent = async () => { throw new Error('must not control this Pi'); };
  ctx.selectedProperty = { id: 'simulated-property', dataOrigin: 'SIMULATED' };
  await ctx.run('cleaning_finished', 'fixture success');
  assert.equal(states.length, 1);
});
