import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { event, request } from '../helpers/eventApiFixture.js';

describe('RF-06.1: both actual machine-ingestion branches require the existing Pi secret', () => {
  for (const action of ['', 'write']) {
    for (const [label, options] of [
      ['missing request secret', { secret: null }],
      ['wrong request secret', { secret: 'wrong-fixture-key' }],
      ['unconfigured server secret', { serverSecret: null }],
    ]) {
      test(`${action || 'root'} rejects ${label} before SQL or side effects`, async () => {
        const result = await request(action, event, options);
        assert.equal(result.res.code, 401);
        assert.deepEqual(result.calls, []);
        assert.deepEqual(result.notices, []);
        assert.deepEqual(result.cache, []);
      });
    }
    test(`${action || 'root'} rejects unauthenticated malformed input before validation`, async () => {
      const result = await request(action, null, { secret: null });
      assert.equal(result.res.code, 401);
      assert.deepEqual(result.calls, []);
    });
    test(`${action || 'root'} keeps authenticated processing and DEMO behavior`, async () => {
      const valid = await request(action, event);
      assert.equal(valid.res.code, action ? 200 : 201);
      assert.equal(valid.notices.length, action ? 0 : 1);
      const invalid = await request(action, {});
      assert.equal(invalid.res.code, 400);
      assert.deepEqual(invalid.calls, []);
      const demo = await request(action, event, { demo: true });
      assert.equal(demo.res.code, 403);
      assert.equal(demo.allocations, 0);
    });
  }
});
