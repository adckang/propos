import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { parse } from '@babel/parser';
import { validateEvent } from '../../src/domain/eventValidation.js';
import { insertEvent } from '../../src/infrastructure/eventRepository.js';
import { processEvent } from '../../src/application/eventService.js';
import { DATA_PROFILE } from '../../src/config/dataProfile.js';

const event = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  property_id: 'property-1',
  type: 'checkin_prep_time_reached',
  device_time: '2026-11-04T05:00:00.000Z',
  data: { reason: 'scheduled preparation', reservation_uid: 'reservation-1' },
};

function database({ duplicate = false } = {}) {
  return {
    calls: [], ended: false,
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: sql.includes('INSERT INTO events') && !duplicate ? [{ id: params[0] }] : [] };
    },
    async end() { this.ended = true; },
  };
}

// Inspect the real INSERT's bindings, without reproducing the storage rules.
function storedColumn(db, column) {
  const call = db.calls.find(({ sql }) => sql.includes('INSERT INTO events'));
  assert.ok(call, 'The actual repository must execute INSERT');
  const match = call.sql.match(/INSERT INTO events\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*ON CONFLICT/);
  assert.ok(match, 'Expected parameterized INSERT');
  const columns = match[1].split(',').map(value => value.trim());
  const values = match[2].split(/,(?![^()]*\))/).map(value => value.trim());
  const index = columns.indexOf(column);
  assert.notEqual(index, -1, `${column} must be persisted`);
  const binding = values[index];
  assert.match(binding, /^\$\d+$/, `${column} must use a bound parameter`);
  return call.params[Number(binding.slice(1)) - 1];
}

// Execute the real API handler and helpers, replacing only I/O dependencies.
// No server, environment changes, DB connection, KV write or notification is used.
const source = readFileSync(new URL('../../api/events/[...slug].js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module' });
function load(name, dependencies = {}) {
  const declarations = ast.program.body.map(node => node.declaration ?? node);
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
  assert.ok(node, `Actual API function ${name} must exist`);
  return new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)});`)(...Object.values(dependencies));
}

async function request(action, body, { duplicate = false, authorized = true } = {}) {
  const db = database({ duplicate });
  const notices = [];
  const handler = load('handler', {
    Pool: class { constructor() { return db; } },
    process: { env: { PROPOS_PI_SECRET: 'test-secret' } },
    DATA_PROFILE, resolveServerDataProfile: () => DATA_PROFILE.HYBRID,
    readBody: load('readBody'), sendJson: load('sendJson'), ensureTable: load('ensureTable'),
    randomUUID, validateEvent, processEvent, insertEvent, kv: {},
    notifyEvent: async (...args) => { notices.push(args); return { sent: false }; },
    requireScope: () => { throw new Error('POST must retain its existing Pi authentication path'); },
  });
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', url: `/api/events${action ? `/${action}` : ''}`,
    headers: { 'x-pi-secret': authorized ? 'test-secret' : 'wrong-secret' }, query: {} });
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler(req, res);
  assert.equal(db.ended, true);
  return { db, res, notices };
}

describe('Event provenance — validation and actual INSERT', () => {
  test('validation retains explicit source fields without treating source_ref as a reservation key', () => {
    const result = validateEvent({ ...event, source_system: 'HA_WATCHER', source_ref: 'ha:context:abc', data_origin: 'SIMULATED' });
    assert.equal(result.success, true);
    assert.equal(result.data.source_system, 'HA_WATCHER');
    assert.equal(result.data.source_ref, 'ha:context:abc');
    assert.equal(result.data.data.reservation_uid, 'reservation-1');
    assert.equal(result.data.data_origin, undefined, 'Origin belongs to the property, not the request');
  });

  test('repository persists the supplied source independently of event data', async () => {
    const db = database();
    await insertEvent(db, { ...event, source_system: 'SENSOR_GATEWAY', source_ref: 'sensor:context:abc' }, false);
    assert.equal(storedColumn(db, 'source_system'), 'SENSOR_GATEWAY');
    assert.equal(storedColumn(db, 'source_ref'), 'sensor:context:abc');
    assert.deepEqual(storedColumn(db, 'data'), event.data);
  });

  test('legacy event uses its actual receipt UUID as trace, never a reservation guess', async () => {
    const db = database();
    await insertEvent(db, event, false);
    assert.equal(storedColumn(db, 'source_system'), 'HA_WATCHER');
    assert.equal(storedColumn(db, 'source_ref'), `ingest:event:${event.id}`);
  });

  test('origin is read from the same property in the INSERT, with legacy REAL default', async () => {
    const db = database();
    await insertEvent(db, { ...event, data_origin: 'SIMULATED' }, false);
    const { sql, params } = db.calls[0];
    assert.match(sql, /\bdata_origin\b/);
    assert.match(sql, /SELECT data_origin FROM property_cleaning_config WHERE property_id\s*=\s*\$2/);
    assert.match(sql, /COALESCE\(\(SELECT data_origin[^)]+\), 'REAL'\)/);
    assert.equal(params[1], event.property_id);
    assert.ok(!params.includes('SIMULATED'), 'Caller cannot override the property origin');
  });
});

describe('Event provenance — both actual Pi API paths', () => {
  for (const action of ['', 'write']) {
    test(`${action || 'root'} preserves explicit trace fields`, async () => {
      const { db, res, notices } = await request(action, { ...event, source_system: 'HA_WATCHER', source_ref: 'ha:context:source-1' });
      assert.equal(res.code, action ? 200 : 201);
      assert.equal(storedColumn(db, 'source_ref'), 'ha:context:source-1');
      assert.equal(storedColumn(db, 'source_system'), 'HA_WATCHER');
      assert.deepEqual(notices, []);
    });

    test(`${action || 'root'} still accepts the legacy Pi payload without source fields`, async () => {
      const body = { ...event, ...(action ? { device_time: Date.parse(event.device_time), is_soft: false } : {}) };
      const { db, res } = await request(action, body);
      assert.equal(res.code, action ? 200 : 201);
      const id = storedColumn(db, 'id');
      if (!action) assert.equal(id, event.id);
      assert.equal(storedColumn(db, 'source_ref'), `ingest:event:${id}`);
      assert.equal(new Date(storedColumn(db, 'device_time')).toISOString(), event.device_time);
      assert.equal(storedColumn(db, 'is_soft'), false);
    });

    test(`${action || 'root'} duplicate keeps the original response and suppresses side effects`, async () => {
      const { db, res, notices } = await request(action, event, { duplicate: true });
      assert.equal(res.code, action ? 200 : 409);
      assert.deepEqual(res.body, action ? { inserted: false, id: null } : { status: 'duplicate' });
      const insert = db.calls.find(({ sql }) => sql.includes('INSERT INTO events'));
      assert.match(insert.sql, /ON CONFLICT \(property_id, type, device_time\) DO NOTHING/);
      assert.ok(!db.calls.some(({ sql }) => sql.includes('UPDATE events')));
      assert.deepEqual(notices, []);
    });

    test(`${action || 'root'} null or blank source metadata remains compatible with legacy defaults`, async () => {
      for (const value of [null, '', '   ']) {
        const { db, res } = await request(action, { ...event, source_system: value, source_ref: value });
        assert.equal(res.code, action ? 200 : 201);
        assert.equal(storedColumn(db, 'source_system'), 'HA_WATCHER');
        assert.equal(storedColumn(db, 'source_ref'), `ingest:event:${storedColumn(db, 'id')}`);
      }
    });
  }

  test('write continues to reject an incorrect Pi secret before any DB query', async () => {
    const { db, res } = await request('write', event, { authorized: false });
    assert.equal(res.code, 401);
    assert.deepEqual(db.calls, []);
  });
});
