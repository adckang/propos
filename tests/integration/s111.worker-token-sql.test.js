import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { workerFcmFixture, TOKEN_KEY, PENDING_KEY } from '../helpers/workerFcmFixture.js';

const enabled = !!(process.env.CLEANING_TEST_DATABASE_URL || process.env.PGLITE_TEST_ROOT);
async function run(fn) {
  const db = await createCleaningSqlFixture({ fcm: true }); let app;
  try {
    await db.pool.query("UPDATE cleaners SET fcm_token='fixture-old', fcm_status='inactive' WHERE id=$1", [db.cleanerId]);
    app = await workerFcmFixture({ db: db.pool }); await fn(db, app);
  } finally { try { app?.restore(); } finally { await db.close(); } }
}

test('Worker SQL: owner confirmation is read-only and does not expose tokens', { skip: !enabled }, () => run(async (db, app) => {
  const before = (await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows;
  const res = await app.invoke('GET', undefined, { authorization: 'Bearer fixture-old' });
  assert.equal(res.code, 200); assert.deepEqual(res.body, { ok: true, worker_id: db.cleanerId });
  assert.match(res.headers['Cache-Control'], /no-store/);
  assert.deepEqual((await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows, before);
}));
test('Worker SQL: legacy rotation keeps response and approval/tier unchanged', { skip: !enabled }, () => run(async (db, app) => {
  const before = (await db.pool.query('SELECT active,tier FROM cleaners WHERE id=$1', [db.cleanerId])).rows[0];
  const res = await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new' });
  assert.equal(res.code, 200); assert.deepEqual(res.body, { ok: true });
  const [row] = (await db.pool.query('SELECT active,tier,fcm_token,fcm_status FROM cleaners WHERE id=$1', [db.cleanerId])).rows;
  assert.equal(row.fcm_token, 'fixture-new'); assert.equal(row.fcm_status, 'active');
  assert.deepEqual({ active: row.active, tier: row.tier }, before);
}));
test('Worker SQL: app/server recover a committed rotation whose response was lost', { skip: !enabled }, () => run(async (db, app) => {
  const fetchActual = globalThis.fetch; let lose = true;
  globalThis.fetch = async (url, options) => {
    const res = await fetchActual(url, options);
    if (options.method === 'POST' && lose) { lose = false; throw new Error('Fixture response lost after commit'); }
    return res;
  };
  await (await app.loadClient()).initFcm();
  assert.equal(app.values.get(TOKEN_KEY), 'fixture-old'); assert.ok(app.values.get(PENDING_KEY));
  assert.equal((await db.pool.query('SELECT fcm_token FROM cleaners WHERE id=$1', [db.cleanerId])).rows[0].fcm_token, 'fixture-new');
  await (await app.loadClient()).initFcm();
  assert.equal(app.values.get(TOKEN_KEY), 'fixture-new'); assert.equal(app.values.has(PENDING_KEY), false);
  assert.equal(app.calls.filter(c => c.method === 'POST').length, 2);
}));
test('Worker SQL: already-stored retry only confirms its known owner and preserves lifecycle dates', { skip: !enabled }, () => run(async (db, app) => {
  const payload = { fcm_token: 'fixture-old', new_token: 'fixture-new', worker_id: db.cleanerId };
  assert.equal((await app.invoke('POST', payload)).code, 200);
  await db.pool.query("UPDATE cleaners SET fcm_status='inactive',last_seen_at='2000-01-01' WHERE id=$1", [db.cleanerId]);
  const before = (await db.pool.query('SELECT * FROM cleaners WHERE id=$1', [db.cleanerId])).rows[0];
  assert.equal((await app.invoke('POST', payload)).code, 200);
  assert.deepEqual((await db.pool.query('SELECT * FROM cleaners WHERE id=$1', [db.cleanerId])).rows[0], before);
}));
test('Worker SQL: an unknown old token cannot infer a successful rotation from another owner', { skip: !enabled }, () => run(async (db, app) => {
  await db.pool.query("UPDATE cleaners SET fcm_token='fixture-new' WHERE id=$1", [db.cleanerId]);
  assert.equal((await app.invoke('POST', { fcm_token: 'unknown', new_token: 'fixture-new' })).code, 404);
  assert.equal((await app.invoke('POST', { fcm_token: 'unknown', new_token: 'fixture-new', worker_id: randomUUID() })).code, 404);
}));
test('Worker SQL: another worker token cannot be taken over during rotation', { skip: !enabled }, () => run(async (db, app) => {
  const other = randomUUID();
  await db.pool.query("INSERT INTO cleaners(id,name,phone,email,tier,fcm_token) VALUES($1,'Fixture Other','01000000001','other@example.invalid','BULK','fixture-other')", [other]);
  const res = await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-other', worker_id: db.cleanerId });
  assert.equal(res.code, 409);
  assert.deepEqual((await db.pool.query('SELECT fcm_token FROM cleaners ORDER BY fcm_token')).rows.map(x => x.fcm_token), ['fixture-old','fixture-other']);
}));
test('Worker SQL: missing or malformed identity cannot trigger a stored retry confirmation', { skip: !enabled }, () => run(async (db, app) => {
  assert.equal((await app.invoke('GET')).code, 401);
  assert.equal((await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new', worker_id: 'invalid' })).code, 400);
  assert.equal((await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new', worker_id: randomUUID() })).code, 404);
  assert.equal((await db.pool.query('SELECT fcm_token FROM cleaners WHERE id=$1', [db.cleanerId])).rows[0].fcm_token, 'fixture-old');
}));

test('Worker SQL: confirmed UUID identity follows PostgreSQL case normalization', { skip: !enabled }, () => run(async (db, app) => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await db.pool.query('UPDATE cleaners SET id=$1 WHERE id=$2', [id, db.cleanerId]);
  const res = await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new', worker_id: id.toUpperCase() });
  assert.equal(res.code, 200);
}));

test('Worker SQL: ambiguous legacy token owners cannot be mutated or guessed', { skip: !enabled }, () => run(async (db, app) => {
  await db.pool.query("INSERT INTO cleaners(id,name,phone,email,tier,fcm_token) VALUES($1,'Fixture Other','01000000001','other@example.invalid','BULK','fixture-old')", [randomUUID()]);
  const before = (await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows;
  assert.equal((await app.invoke('GET', undefined, { authorization: 'Bearer fixture-old' })).code, 409);
  assert.equal((await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new' })).code, 409);
  assert.deepEqual((await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows, before);
}));

test('Worker SQL: concurrent API claims cannot assign one destination token to two workers', { skip: !enabled }, () => run(async (db, app) => {
  const other = randomUUID();
  await db.pool.query("INSERT INTO cleaners(id,name,phone,email,tier,fcm_token) VALUES($1,'Fixture Other','01000000001','other@example.invalid','BULK','fixture-other')", [other]);
  const results = await Promise.all([
    app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-shared', worker_id: db.cleanerId }),
    app.invoke('POST', { fcm_token: 'fixture-other', new_token: 'fixture-shared', worker_id: other }),
  ]);
  assert.deepEqual(results.map(r => r.code).sort(), [200,409]);
  assert.equal((await db.pool.query("SELECT COUNT(*)::int AS count FROM cleaners WHERE fcm_token='fixture-shared'")).rows[0].count, 1);
}));

test('Worker SQL: storage failure rolls back, releases its client and redacts token details', { skip: !enabled }, () => run(async (db, app) => {
  await db.pool.query(`CREATE FUNCTION reject_fixture_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION USING MESSAGE='private-fixture-token',DETAIL='private-fixture-token'; END $$`);
  await db.pool.query('CREATE TRIGGER reject_fixture_rotation BEFORE UPDATE ON cleaners FOR EACH ROW EXECUTE FUNCTION reject_fixture_rotation()');
  const before = (await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows;
  const log = console.error, captured = [];
  try {
    console.error = (...args) => captured.push(args.map(a => typeof a === 'object' ? String(a) : a).join(' '));
    const res = await app.invoke('POST', { fcm_token: 'fixture-old', new_token: 'fixture-new', worker_id: db.cleanerId });
    assert.equal(res.code, 500); assert.equal(res.body.error, 'FCM_TOKEN_STORAGE_FAILED');
    assert.equal(JSON.stringify([res.body, captured]).includes('private-fixture-token'), false);
    assert.deepEqual((await db.pool.query('SELECT * FROM cleaners ORDER BY id')).rows, before);
    const client = await db.pool.connect(); await client.query('SELECT 1'); client.release();
  } finally { console.error = log; }
}));
