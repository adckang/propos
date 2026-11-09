import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerFcmFixture, TOKEN_KEY, PENDING_KEY, WORKER_ID, response } from '../helpers/workerFcmFixture.js';

async function run(options, fn) { const f = await workerFcmFixture(options); try { await fn(f); } finally { f.restore(); } }

test('Worker token API rejects an HTTP failure instead of confirming a local rotation', () => run({ answer: async () => response(500, {}) }, async f => {
  await assert.rejects(() => f.loadApi().then(api => api.updateFcmToken('fixture-old', 'fixture-new')));
}));
test('Worker token API rejects a successful HTTP response without a successful receipt', () => run({ answer: async () => response(200, { ok: false }) }, async f => {
  await assert.rejects(() => f.loadApi().then(api => api.updateFcmToken('fixture-old', 'fixture-new')));
}));
test('Worker token API keeps the legacy two-token request format', () => run({}, async f => {
  await (await f.loadApi()).updateFcmToken('fixture-old', 'fixture-new');
  assert.deepEqual(f.calls[0].body, { fcm_token: 'fixture-old', new_token: 'fixture-new' });
}));

test('Worker token rotation persists its owner and intent before sending, then confirms locally', () => {
  let fixture;
  return run({ answer: async call => {
    if (call.method === 'GET') return response(200, { ok: true, worker_id: WORKER_ID });
    assert.equal(fixture.values.get(TOKEN_KEY), 'fixture-old');
    assert.deepEqual(JSON.parse(fixture.values.get(PENDING_KEY)), { oldToken: 'fixture-old', newToken: 'fixture-new', workerId: WORKER_ID });
    return response(200, { ok: true });
  } }, async f => {
    fixture = f;
    assert.equal(await (await f.loadClient()).initFcm(), 'fixture-new');
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-new'); assert.equal(f.values.has(PENDING_KEY), false);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].method, 'GET');
    assert.equal(f.calls[0].headers.Authorization, 'Bearer fixture-old');
    assert.equal(f.calls[1].body.worker_id, WORKER_ID);
  });
});

for (const failure of ['HTTP', 'NETWORK']) test(`Worker token ${failure} failure retains the old token and retries after restart`, () => {
  let fail = true;
  return run({ answer: async call => {
    if (call.method === 'GET') return response(200, { ok: true, worker_id: WORKER_ID });
    if (fail) { if (failure === 'NETWORK') throw new Error('Fixture offline'); return response(500, {}); }
    return response(200, { ok: true });
  } }, async f => {
    await (await f.loadClient()).initFcm();
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(f.values.get(PENDING_KEY));
    fail = false; await (await f.loadClient()).initFcm();
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-new'); assert.equal(f.values.has(PENDING_KEY), false);
    assert.deepEqual(f.calls.map(c => c.method), ['GET', 'POST', 'POST']);
  });
});

test('Worker token pending persistence failure prevents the server mutation', () => run({ storageFailure: (op, key) => {
  if (op === 'set' && key === PENDING_KEY) throw new Error('Fixture storage unavailable');
} }, async f => {
  await (await f.loadClient()).initFcm();
  assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
}));

test('Worker token confirmed receipt survives a failed local save and resumes after restart', () => {
  let fail = true;
  return run({ storageFailure: (op, key) => { if (fail && op === 'set' && key === TOKEN_KEY) throw new Error('Fixture local save failure'); } }, async f => {
    await (await f.loadClient()).initFcm();
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(f.values.get(PENDING_KEY));
    fail = false; await (await f.loadClient()).initFcm();
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-new'); assert.equal(f.values.has(PENDING_KEY), false);
  });
});

test('Worker token restart clears an already-confirmed pending intent without another mutation', () => run({ storage: new Map([
  [TOKEN_KEY, 'fixture-new'], [PENDING_KEY, JSON.stringify({ oldToken: 'fixture-old', newToken: 'fixture-new', workerId: WORKER_ID })],
]) }, async f => {
  await (await f.loadClient()).initFcm(); assert.equal(f.values.has(PENDING_KEY), false); assert.equal(f.calls.length, 0);
}));

test('Worker token refresh listener retains failures for startup recovery', () => run({ token: 'fixture-old', answer: async call => call.method === 'GET'
  ? response(200, { ok: true, worker_id: WORKER_ID }) : response(429, {}) }, async f => {
  const client = await f.loadClient(); const unsub = client.watchTokenRefresh();
  await f.emitToken('fixture-new'); unsub();
  assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(f.values.get(PENDING_KEY));
}));

for (const pending of ['{broken', JSON.stringify({ oldToken: 'unrelated', newToken: 'other', workerId: WORKER_ID })]) test('Worker token corrupt or conflicting pending data cannot overwrite the confirmed token', () => run({ storage: new Map([
  [TOKEN_KEY, 'fixture-old'], [PENDING_KEY, pending],
]) }, async f => {
  await (await f.loadClient()).initFcm(); assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.equal(f.calls.length, 0);
}));

test('Worker token rejected owner lookup does not mutate tokens on an older server', () => run({ answer: async () => response(405, {}) }, async f => {
  await (await f.loadClient()).initFcm(); assert.equal(f.values.get(TOKEN_KEY), 'fixture-old');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
}));

test('Worker token first registration and unchanged token keep the existing local contract', () => run({ stored: null }, async f => {
  const client = await f.loadClient(); await client.initFcm(); await client.initFcm();
  assert.equal(f.values.get(TOKEN_KEY), 'fixture-new'); assert.equal(f.calls.length, 0);
}));
test('Worker token permission denial leaves pending intent untouched', () => run({ storage: new Map([
  [TOKEN_KEY, 'fixture-old'], [PENDING_KEY, 'preserved'],
]) }, async f => {
  f.io.permission = 0;
  assert.equal(await (await f.loadClient()).initFcm(), null); assert.equal(f.values.get(PENDING_KEY), 'preserved'); assert.equal(f.calls.length, 0);
}));

test('Worker token duplicate refresh listeners and startup serialize the latest SDK token', async () => {
  let enter, release;
  const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
  let inFlight = 0, peak = 0;
  await run({ token: 'fixture-old', answer: async call => {
    if (call.method === 'GET') return response(200, { ok: true, worker_id: WORKER_ID });
    peak = Math.max(peak, ++inFlight);
    if (call.body.new_token === 'fixture-middle') { enter(); await gate; }
    inFlight--; return response(200, { ok: true });
  } }, async f => {
    const client = await f.loadClient(), unsub1 = client.watchTokenRefresh(), unsub2 = client.watchTokenRefresh();
    const first = f.emitToken('fixture-middle'); await entered;
    const second = f.emitToken('fixture-latest'); const startup = client.initFcm();
    release(); await Promise.all([first, second, startup]); unsub1(); unsub2();
    assert.equal(peak, 1); assert.equal(f.values.get(TOKEN_KEY), 'fixture-latest');
    assert.deepEqual(f.calls.filter(c => c.method === 'POST').map(c => [c.body.fcm_token, c.body.new_token]),
      [['fixture-old','fixture-middle'],['fixture-middle','fixture-latest']]);
  });
});

test('Worker token a newer SDK token cannot replace an unresolved older rotation', async () => {
  let fail = true;
  await run({ answer: async call => call.method === 'GET' ? response(200, { ok: true, worker_id: WORKER_ID }) : response(fail ? 503 : 200, { ok: !fail }) }, async f => {
    await (await f.loadClient()).initFcm(); assert.ok(f.values.get(PENDING_KEY));
    f.io.token = 'fixture-latest'; fail = false; await (await f.loadClient()).initFcm();
    assert.equal(f.values.get(TOKEN_KEY), 'fixture-latest');
    assert.deepEqual(f.calls.filter(c => c.method === 'POST').map(c => [c.body.fcm_token, c.body.new_token]),
      [['fixture-old','fixture-new'],['fixture-old','fixture-new'],['fixture-new','fixture-latest']]);
  });
});

test('Worker token malformed success JSON cannot confirm a rotation', () => run({ answer: async call => call.method === 'GET'
  ? response(200, { ok: true, worker_id: WORKER_ID }) : { ok: true, status: 200, json: async () => { throw new Error('Fixture truncated response'); } } }, async f => {
  await (await f.loadClient()).initFcm(); assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(f.values.get(PENDING_KEY));
}));

test('Worker token timeout keeps its pending intent for recovery', async t => {
  await run({ answer: async call => {
    if (call.method === 'GET') return response(200, { ok: true, worker_id: WORKER_ID });
    return new Promise((resolve, reject) => call.signal.addEventListener('abort', () => reject(new Error('Fixture timeout')), { once: true }));
  } }, async f => {
    const client = await f.loadClient(); t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = client.initFcm();
      while (!f.calls.some(c => c.method === 'POST')) await new Promise(setImmediate);
      t.mock.timers.tick(10_000); await pending;
      assert.equal(f.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(f.values.get(PENDING_KEY));
    } finally { t.mock.timers.reset(); }
  });
});

// 코드 리뷰(2026-11-09)에서 발견 — 실제 서버 핸들러를 호출한다. DB·Slack 만 가짜.
function failingDb({ rollbackFails }) {
  const released = [];
  const client = {
    async query(sql) {
      if (sql === 'ROLLBACK' && rollbackFails) throw new Error('rollback failed');
      if (sql.includes('FOR UPDATE')) throw new Error('storage failed');
      return { rows: [] };
    },
    release(error) { released.push(error); },
  };
  return { db: { connect: async () => client, query: async () => ({ rows: [] }) }, released };
}

async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

test('Worker token API answers 400 for a JSON null body instead of crashing', async () => {
  const f = await workerFcmFixture({ db: failingDb({}).db });
  try {
    const res = await quietly(() => f.invoke('POST', undefined, {}, { rawBody: 'null' }));
    assert.equal(res.code, 400);
    assert.equal(res.body.error, 'fcm_token, new_token 필수');
  } finally { f.restore(); }
});

test('Worker token API returns a healthy connection to the pool after a clean rollback', async () => {
  const { db, released } = failingDb({ rollbackFails: false });
  const f = await workerFcmFixture({ db });
  try {
    const res = await quietly(() => f.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new' }));
    assert.equal(res.code, 500);
    assert.deepEqual(released, [undefined]);
  } finally { f.restore(); }
});

test('Worker token API discards the connection when ROLLBACK itself fails', async () => {
  const { db, released } = failingDb({ rollbackFails: true });
  const f = await workerFcmFixture({ db });
  try {
    const res = await quietly(() => f.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new' }));
    assert.equal(res.code, 500);
    assert.equal(released.length, 1);
    assert.ok(released[0], '실패한 트랜잭션이 남은 연결은 풀에 돌려주지 않고 폐기한다');
  } finally { f.restore(); }
});
