import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { event, request } from '../helpers/eventApiFixture.js';

describe('RF-06: write validates invalid input before any SQL', () => {
  const invalid = [
    ['unknown event type', { ...event, type: 'fixture_unknown_event' }],
    ['invalid time string', { ...event, device_time: 'invalid-time' }],
    ['date without time', { ...event, device_time: '2026-11-09' }],
    ['boolean time', { ...event, device_time: true }],
    ['time outside Date range', { ...event, device_time: 9e15 }],
    ['non-string property', { ...event, property_id: 123 }],
    ['property exceeding supported length', { ...event, property_id: 'x'.repeat(65) }],
    ['non-boolean soft flag', { ...event, is_soft: 'false' }],
    ['invalid source metadata', { ...event, source_ref: { uid: 'not-a-reference-string' } }],
    ['array data', { ...event, data: [] }],
    ['null body', null],
  ];
  for (const [label, payload] of invalid) {
    test(label, async () => {
      const result = await request('write', payload);
      assert.equal(result.res.code, 400);
      assert.deepEqual(result.calls, []);
      assert.deepEqual(result.notices, []);
    });
  }
});

describe('RF-06: existing Pi contracts and per-path effects stay distinct', () => {
  for (const deviceTime of [Date.parse(event.device_time), '2026-11-09T12:00:00+09:00']) {
    test(`write accepts UUID-less legacy input with time ${typeof deviceTime}`, async () => {
      const { id, ...legacy } = event;
      const result = await request('write', { ...legacy, device_time: deviceTime, data: null, is_soft: false });
      assert.equal(result.res.code, 200);
      const insert = result.calls.find(call => call.sql.includes('INSERT INTO events'));
      assert.match(insert.params[0], /^[0-9a-f-]{36}$/);
      assert.equal(insert.params[4].toISOString(), event.device_time);
      assert.deepEqual(result.notices, []);
      assert.deepEqual(result.cache, []);
      assert.ok(!result.calls.some(call => call.sql.includes('UPDATE events')));
    });
  }
  test('omitted/null soft flag retains false; explicit flags are preserved', async () => {
    for (const flag of [undefined, null, false, true]) {
      const result = await request('write', { ...event, is_soft: flag });
      assert.equal(result.res.code, 200);
      assert.equal(result.calls.find(call => call.sql.includes('INSERT INTO events')).params[3], flag ?? false);
    }
  });
  test('ordinary root event still runs its cache, notification and completion exactly once', async () => {
    const result = await request('', event);
    assert.equal(result.res.code, 201);
    assert.equal(result.notices.length, 1);
    assert.equal(result.cache.length, 1);
    const updates = result.calls.filter(call => call.sql.includes('UPDATE events'));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].params[0], 'complete');
  });
  for (const action of ['', 'write']) {
    test(`${action || 'root'} retains its duplicate acknowledgement and suppresses downstream effects`, async () => {
      const result = await request(action, event, { duplicate: true });
      assert.equal(result.res.code, action ? 200 : 409);
      assert.deepEqual(result.res.body, action ? { inserted: false, id: null } : { status: 'duplicate' });
      assert.deepEqual(result.notices, []);
      assert.deepEqual(result.cache, []);
      assert.ok(!result.calls.some(call => call.sql.includes('UPDATE events')));
    });
    test(`${action || 'root'} rejects malformed JSON without SQL and blocks DEMO before Pool creation`, async () => {
      const malformed = await request(action, {}, { raw: '{' });
      assert.equal(malformed.res.code, 400);
      assert.deepEqual(malformed.calls, []);
      const demo = await request(action, event, { demo: true });
      assert.equal(demo.res.code, 403);
      assert.equal(demo.allocations, 0);
    });
  }
  test('write secret is checked before input validation and SQL', async () => {
    const result = await request('write', null, { secret: 'wrong-fixture-key' });
    assert.equal(result.res.code, 401);
    assert.deepEqual(result.calls, []);
  });
});
