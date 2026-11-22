/**
 * ACT-08 단계 ① — Worker App API 실제 핸들러 계약.
 * register / heartbeat / profile 요청·응답과 DB 호출을 실행한다.
 * DB·Slack·HTTP I/O만 격리하며 업무 로직 복사본은 두지 않는다.
 * token 갱신/복구는 기존 s110 실제 구현 회귀가 담당한다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// ACT-08 단계 ①: 실제 핸들러를 실행하고 DB·Slack I/O만 가짜로 바꾼다.
import { workerFcmFixture, WORKER_ID } from '../helpers/workerFcmFixture.js';

const FIXTURE_TOKEN = 'fixture-worker-token';
const REGISTER_BODY = { phone: '01012345678', email: '  WORKER@Example.INVALID  ', fcm_token: FIXTURE_TOKEN };
const WORKER_ROW = { id: WORKER_ID, name: 'Fixture Worker', phone: '010-1234-5678',
  email: 'worker@example.invalid', tier: 'BULK', active: false, fcm_status: 'active' };

async function actualWorker(t, { rows = [WORKER_ROW], query, slack, probe, profile = 'hybrid' } = {}) {
  const queries = [];
  const f = await workerFcmFixture({
    db: { async query(sql, params) {
      queries.push({ sql, params });
      return query ? query(sql, params) : { rows };
    } },
    slack: slack ?? (async () => {}),
    probe,
  });
  process.env.PROPOS_DATA_PROFILE = profile;
  t.after(() => {
    try {
      assert.equal(f.calls.length, 0, 'direct handler tests must not call any HTTP API');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production network attempts');
    } finally { f.restore(); }
  });
  return { ...f, queries,
    send(resource, method, body, options = {}) { return f.invoke(method, body, {}, { resource, ...options }); },
  };
}
function assertWorkerReply(res, code, body) {
  assert.equal(res.code, code);
  assert.deepEqual(res.body, body);
}

// The SQL checks below verify the actual DB call contract, never execute a
// second copy of normalization, routing, upsert or heartbeat business logic.
// 등록은 질의마다 다른 답을 준다: 이 기기 토큰을 다른 번호가 쓰는지 → 번호 등록(upsert) → (막히면) 지금 토큰 → 표시 → 다시 upsert
function registerDb({ holders = [], upserts = [[WORKER_ROW]], current = [], upsertError, storedPhones = [] } = {}) {
  const queue = [...upserts];
  return (sql, params) => {
    if (/SELECT 1 FROM cleaners WHERE phone = \$1 LIMIT 1/.test(sql)) return { rows: storedPhones.includes(params[0]) ? [{ '?column?': 1 }] : [] };
    if (/SELECT id FROM cleaners WHERE fcm_token = \$1 AND phone <> \$2/.test(sql)) return { rows: holders };
    if (/INSERT INTO cleaners/.test(sql)) { if (upsertError) throw upsertError; return { rows: queue.shift() ?? [] }; }
    if (/SELECT id, fcm_token FROM cleaners WHERE phone = \$1/.test(sql)) return { rows: current };
    if (/UPDATE cleaners SET fcm_status = 'unregistered' WHERE id = \$1 AND fcm_token = \$2/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected register SQL: ${sql}`);
  };
}
const upsertOf = f => f.queries.filter(q => /INSERT INTO cleaners/.test(q.sql));
const PUBLIC_ROW = ({ name, email, ...rest }) => rest; // 응답에는 이름·저장된 이메일을 싣지 않는다

describe('actual worker handler — register', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) test(`${method} is rejected before DB/Slack`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('register', method, REGISTER_BODY), 405, { error: 'POST only' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.slackCalls, []);
  });
  const invalid = [
    ['phone missing', { email: REGISTER_BODY.email, fcm_token: FIXTURE_TOKEN }],
    ['email missing', { phone: REGISTER_BODY.phone, fcm_token: FIXTURE_TOKEN }],
    ['token missing', { phone: REGISTER_BODY.phone, email: REGISTER_BODY.email }],
    ['empty body', undefined], ['phone empty', { ...REGISTER_BODY, phone: '' }],
    ['email empty', { ...REGISTER_BODY, email: '' }], ['token empty', { ...REGISTER_BODY, fcm_token: '' }],
  ];
  for (const [label, body] of invalid) test(`${label} returns the existing required-field error`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('register', 'POST', body), 400, { error: 'phone, email, fcm_token 필수' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.slackCalls, []);
  });
  for (const rawBody of ['null', '{broken']) test(`${rawBody} request body is treated as an empty request`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('register', 'POST', undefined, { rawBody }), 400, { error: 'phone, email, fcm_token 필수' });
    assert.deepEqual(f.queries, []);
  });
  for (const [phone, expected] of [
    ['010-1234-5678', '010-1234-5678'], ['01012345678', '010-1234-5678'],
    ['+821012345678', '010-1234-5678'], ['821012345678', '010-1234-5678'],
    ['010 1234 5678', '010-1234-5678'],
  ]) test(`phone ${phone} and email are normalized in the actual INSERT arguments`, async t => {
    const f = await actualWorker(t, { query: registerDb() });
    const res = await f.send('register', 'POST', { ...REGISTER_BODY, phone });
    assert.equal(res.code, 200);
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN, expected]);
    assert.deepEqual(upsertOf(f).map(q => q.params), [[expected, 'worker@example.invalid', FIXTURE_TOKEN]]);
  });
  for (const phone of ['12345', '0111234567', '010-123-45678-9']) test(`phone ${phone} that is not a mobile number does not create a worker (DEC-08 unique numbers)`, async t => {
    const f = await actualWorker(t, { query: registerDb() });
    assertWorkerReply(await f.send('register', 'POST', { ...REGISTER_BODY, phone }), 400, { error: '전화번호 형식이 올바르지 않습니다' });
    assert.equal(upsertOf(f).length, 0);
  });
  test('a non-mobile number the host stored with exactly that spelling still links the app to that worker', async t => {
    const f = await actualWorker(t, { query: registerDb({ storedPhones: ['0111234567'] }) });
    assert.equal((await f.send('register', 'POST', { ...REGISTER_BODY, phone: '0111234567' })).code, 200);
    assert.deepEqual(upsertOf(f).map(q => q.params[0]), ['0111234567']);
  });
  test('INSERT defaults; an existing number only takes a token when it has no usable one, never a new email (D-033, DEC-08)', async t => {
    const f = await actualWorker(t, { query: registerDb() });
    await f.send('register', 'POST', REGISTER_BODY);
    const [{ sql, params }] = upsertOf(f);
    assert.match(sql, /INSERT INTO cleaners\s*\(phone,\s*email,\s*tier,\s*active,\s*fcm_token,/i);
    assert.match(sql, /VALUES\s*\(\$1,\s*\$2,\s*'BULK',\s*false,\s*\$3,\s*NOW\(\),\s*NOW\(\),\s*NOW\(\),\s*'active'\)/i);
    const [update, guard] = sql.split(/ON CONFLICT\s*\(phone\)\s*DO UPDATE SET/i)[1]?.split(/RETURNING/i)[0].split(/\bWHERE\b/i) ?? [];
    assert.ok(update && guard, 'phone conflicts update only under a guard');
    assert.match(update, /\bfcm_token\s*=\s*EXCLUDED\.fcm_token\b/i);
    assert.match(update, /\blast_seen_at\s*=\s*NOW\(\)/i);
    assert.match(update, /fcm_token_at\s*=\s*CASE WHEN cleaners\.fcm_token = EXCLUDED\.fcm_token THEN cleaners\.fcm_token_at ELSE NOW\(\) END/i);
    assert.match(update, /fcm_status\s*=\s*CASE WHEN cleaners\.fcm_token = EXCLUDED\.fcm_token THEN cleaners\.fcm_status ELSE 'active' END/i,
      '같은 토큰의 재시도는 죽은 표시를 되살리지 않는다');
    assert.doesNotMatch(update, /\b(?:name|email|tier|active|app_installed_at)\s*=/i, '이메일(캘린더 배정 기준)·승인·등급은 등록으로 바꾸지 않는다');
    assert.match(guard, /cleaners\.fcm_token IS NULL/i);
    assert.match(guard, /cleaners\.fcm_token = EXCLUDED\.fcm_token/i);
    assert.match(guard, /cleaners\.fcm_status = 'unregistered'/i);
    assert.doesNotMatch(guard, /'active'|'inactive'|'invalid'/i, '살아 있는 토큰·발송 내용 오류일 수 있는 invalid는 상태만으로 덮어쓰지 않는다');
    assert.doesNotMatch(sql.split(/RETURNING/i)[1], /\bemail\b/i, '저장된 이메일을 돌려주지 않는다');
    assert.deepEqual(params, ['010-1234-5678', 'worker@example.invalid', FIXTURE_TOKEN]);
    assert.deepEqual(f.probeCalls, [], '막히지 않으면 알림 서버에 묻지 않는다');
  });
  test('a number held by another live device answers 409 and changes nothing else', async t => {
    const f = await actualWorker(t, { query: registerDb({ upserts: [[]], current: [{ id: WORKER_ID, fcm_token: 'old-live' }] }), probe: async () => 'alive' });
    assertWorkerReply(await f.send('register', 'POST', REGISTER_BODY), 409, { error: '이미 다른 기기에 등록된 번호입니다. 호스트에게 문의해 주세요' });
    assert.deepEqual(f.probeCalls.map(([token]) => token), ['old-live']);
    assert.equal(upsertOf(f).length, 1);
    assert.equal(f.queries.filter(q => /UPDATE cleaners/.test(q.sql)).length, 0);
    assert.deepEqual(f.slackCalls, []);
  });
  test('when the probe cannot tell (no reply, no setting) the number stays blocked', async t => {
    const f = await actualWorker(t, { query: registerDb({ upserts: [[]], current: [{ id: WORKER_ID, fcm_token: 'old-live' }] }), probe: async () => 'unknown' });
    assert.equal((await f.send('register', 'POST', REGISTER_BODY)).code, 409);
    assert.equal(f.queries.filter(q => /UPDATE cleaners/.test(q.sql)).length, 0);
  });
  test('reinstall: the old token is gone at the push server → marked unregistered and the same rule takes the new token (DEC-09)', async t => {
    const f = await actualWorker(t, { query: registerDb({ upserts: [[], [WORKER_ROW]], current: [{ id: WORKER_ID, fcm_token: 'old-gone' }] }), probe: async () => 'dead' });
    const res = await f.send('register', 'POST', REGISTER_BODY);
    assert.equal(res.code, 200);
    const mark = f.queries.find(q => /UPDATE cleaners SET fcm_status = 'unregistered'/.test(q.sql));
    assert.deepEqual(mark.params, [WORKER_ID, 'old-gone'], '그 토큰일 때만 표시 — 그사이 바뀌었으면 건드리지 않는다');
    assert.equal(upsertOf(f).length, 2);
  });
  test('this device token already sits on another number → 409 before any write', async t => {
    const f = await actualWorker(t, { query: registerDb({ holders: [{ id: 'another-worker' }] }) });
    assertWorkerReply(await f.send('register', 'POST', REGISTER_BODY), 409, { error: '이 기기는 다른 번호로 이미 등록돼 있습니다' });
    assert.equal(upsertOf(f).length, 0);
  });
  test('an email another worker already uses answers 409 instead of 500', async t => {
    const f = await actualWorker(t, { query: registerDb({ upsertError: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'cleaners_email_key' }) }) });
    assertWorkerReply(await f.send('register', 'POST', REGISTER_BODY), 409, { error: '이미 다른 담당자가 쓰는 이메일입니다' });
  });
  test('another unique conflict (a concurrent insert of the same new number) is not reported as an email problem', async t => {
    const f = await actualWorker(t, { query: registerDb({ upsertError: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'cleaners_phone_key' }) }) });
    const res = await f.send('register', 'POST', REGISTER_BODY);
    assert.equal(res.code, 500);
    assert.notEqual(res.body.error, '이미 다른 담당자가 쓰는 이메일입니다');
  });
  test('an old token marked "invalid" (may be a payload error) is re-checked with the push server, not trusted', async t => {
    const f = await actualWorker(t, { query: registerDb({ upserts: [[]], current: [{ id: WORKER_ID, fcm_token: 'old-invalid' }] }), probe: async () => 'alive' });
    assert.equal((await f.send('register', 'POST', REGISTER_BODY)).code, 409);
    assert.deepEqual(f.probeCalls.map(([token]) => token), ['old-invalid']);
  });
  for (const active of [false, true]) test(`active=${active} returns the DB worker (without email) and correct approval message`, async t => {
    const worker = { ...WORKER_ROW, active, tier: active ? 'VIP_2' : 'BULK' };
    const f = await actualWorker(t, { query: registerDb({ upserts: [[{ ...worker, app_installed_at: '2026-01-01T00:00:00Z' }]] }) });
    assertWorkerReply(await f.send('register', 'POST', REGISTER_BODY), 200, {
      ok: true, worker: PUBLIC_ROW(worker), message: active ? '등록 완료' : '등록 완료. 호스트 승인 대기 중',
    });
    assert.deepEqual(f.slackCalls, []);
  });
  const now = Date.parse('2026-11-17T06:00:00Z');
  for (const [label, installedAt, shouldNotify] of [
    ['just installed', now, true], ['4999ms ago', now - 4999, true],
    ['exactly 5000ms ago', now - 5000, false], ['older installation', now - 10000, false],
    ['null timestamp', null, false], ['missing timestamp', undefined, false],
  ]) test(`new-install Slack: ${label}`, async t => {
    t.mock.method(Date, 'now', () => now);
    const f = await actualWorker(t, { query: registerDb({ upserts: [[{ ...WORKER_ROW, app_installed_at: installedAt == null ? installedAt : new Date(installedAt).toISOString() }]] }) });
    const res = await f.send('register', 'POST', REGISTER_BODY);
    assert.equal(res.code, 200);
    assert.equal(f.slackCalls.length, shouldNotify ? 1 : 0);
    if (shouldNotify) {
      assert.equal(f.slackCalls[0].length, 1);
      assert.match(f.slackCalls[0][0], /신규 직원 앱 설치/);
      assert.ok(f.slackCalls[0][0].includes('010-1234-5678'));
      assert.ok(f.slackCalls[0][0].includes('worker@example.invalid'));
    }
  });
  test('Slack failure cannot turn a saved registration into an API error', async t => {
    t.mock.method(Date, 'now', () => now);
    const f = await actualWorker(t, { query: registerDb({ upserts: [[{ ...WORKER_ROW, app_installed_at: new Date(now).toISOString() }]] }),
      slack: async () => { throw new Error('fixture Slack unavailable'); } });
    const res = await f.send('register', 'POST', REGISTER_BODY);
    assert.equal(res.code, 200); assert.equal(res.body.ok, true); assert.equal(f.slackCalls.length, 1);
  });
});

describe('actual worker handler — heartbeat', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) test(`${method} is rejected before DB`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('heartbeat', method, { fcm_token: FIXTURE_TOKEN }), 405, { error: 'POST only' });
    assert.deepEqual(f.queries, []);
  });
  for (const fcm_token of [undefined, '', null]) test(`missing/empty token (${String(fcm_token)}) returns 400`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('heartbeat', 'POST', { fcm_token }), 400, { error: 'fcm_token 필수' });
    assert.deepEqual(f.queries, []);
  });
  test('an unregistered token returns 404', async t => {
    const f = await actualWorker(t, { rows: [] });
    assertWorkerReply(await f.send('heartbeat', 'POST', { fcm_token: FIXTURE_TOKEN }), 404, { error: '등록되지 않은 토큰' });
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN]);
  });
  for (const [before, returned] of [['inactive', 'active'], ['active', 'active'], ['invalid', 'invalid'], ['unregistered', 'unregistered'], ['uninstalled', 'uninstalled']]) {
    test(`DB update contract recovers only inactive; response returns ${returned} (${before})`, async t => {
      const f = await actualWorker(t, { rows: [{ id: WORKER_ID, fcm_status: returned }] });
      assertWorkerReply(await f.send('heartbeat', 'POST', { fcm_token: FIXTURE_TOKEN }), 200, { ok: true, fcm_status: returned });
      assert.equal(f.queries.length, 1);
      assert.match(f.queries[0].sql, /UPDATE cleaners\s+SET last_seen_at\s*=\s*NOW\(\)/i);
      assert.match(f.queries[0].sql, /CASE WHEN fcm_status\s*=\s*'inactive' THEN 'active' ELSE fcm_status END/i);
      assert.match(f.queries[0].sql, /WHERE fcm_token\s*=\s*\$1\s+RETURNING id,\s*fcm_status/i);
      assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN]);
    });
  }
});

describe('actual worker handler — profile', () => {
  for (const fcm_token of [undefined, '']) test(`GET requires the query token (${String(fcm_token)})`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('profile', 'GET', { fcm_token: FIXTURE_TOKEN }, { query: { slug: 'profile', fcm_token } }), 400, { error: 'fcm_token 필수' });
    assert.deepEqual(f.queries, []);
  });
  test('GET returns the selected worker directly, using the query token', async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('profile', 'GET', undefined, { query: { slug: 'profile', fcm_token: FIXTURE_TOKEN } }), 200, WORKER_ROW);
    assert.equal(f.queries.length, 1);
    assert.match(f.queries[0].sql, /SELECT id,\s*name,\s*phone,\s*email,\s*tier,\s*active,\s*fcm_status FROM cleaners WHERE fcm_token\s*=\s*\$1/i);
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN]);
  });
  test('GET returns 404 for an unregistered token', async t => {
    const f = await actualWorker(t, { rows: [] });
    assertWorkerReply(await f.send('profile', 'GET', undefined, { query: { slug: 'profile', fcm_token: FIXTURE_TOKEN } }), 404, { error: '등록되지 않은 토큰' });
  });
  for (const fcm_token of [undefined, '', null]) test(`PATCH requires body token (${String(fcm_token)})`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('profile', 'PATCH', { fcm_token, name: 'Fixture' }), 400, { error: 'fcm_token 필수' });
    assert.deepEqual(f.queries, []);
  });
  for (const [phone, expected] of [
    ['010-1234-5678', '010-1234-5678'], ['01012345678', '010-1234-5678'],
    ['+821012345678', '010-1234-5678'], ['821012345678', '010-1234-5678'],
    ['010 1234 5678', '010-1234-5678'], ['12345', '12345'],
  ]) test(`PATCH forwards the current name/email/phone contract (${phone})`, async t => {
    const { fcm_status, ...updated } = WORKER_ROW;
    const f = await actualWorker(t, { rows: [updated] });
    assertWorkerReply(await f.send('profile', 'PATCH', {
      fcm_token: FIXTURE_TOKEN, name: '  Fixture Worker  ', email: '  WORKER@Example.INVALID  ', phone,
    }), 200, { ok: true, worker: updated });
    assert.equal(f.queries.length, 1);
    // Name whitespace is currently preserved by the API; do not silently add trimming.
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN, '  Fixture Worker  ', 'worker@example.invalid', expected]);
  });
  for (const [label, fields, expected] of [
    ['omitted fields', {}, [null, null, null]],
    ['null fields', { name: null, email: null, phone: null }, [null, null, null]],
    ['empty fields', { name: '', email: '', phone: '' }, ['', null, null]],
  ]) test(`PATCH ${label} preserves optional update semantics`, async t => {
    const f = await actualWorker(t);
    assert.equal((await f.send('profile', 'PATCH', { fcm_token: FIXTURE_TOKEN, ...fields })).code, 200);
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN, ...expected]);
    for (const [field, parameter] of [['name', 2], ['email', 3], ['phone', 4]]) {
      assert.match(f.queries[0].sql, new RegExp(`\\b${field}\\s*=\\s*COALESCE\\(\\$${parameter},\\s*${field}\\)`, 'i'));
    }
    assert.match(f.queries[0].sql, /WHERE fcm_token\s*=\s*\$1/i);
  });
  test('PATCH returns 404 for an unregistered token', async t => {
    const f = await actualWorker(t, { rows: [] });
    assertWorkerReply(await f.send('profile', 'PATCH', { fcm_token: FIXTURE_TOKEN, name: 'Fixture' }), 404, { error: '등록되지 않은 토큰' });
  });
  test('PATCH translates the DB phone uniqueness error to the existing 409 response', async t => {
    const f = await actualWorker(t, { query: async () => { throw Object.assign(new Error('fixture duplicate phone'), { code: '23505', constraint: 'cleaners_phone_key' }); } });
    assertWorkerReply(await f.send('profile', 'PATCH', { fcm_token: FIXTURE_TOKEN, phone: '01012345678' }), 409, { error: '이미 사용 중인 전화번호입니다' });
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN, null, null, '010-1234-5678']);
  });
  for (const method of ['POST', 'PUT', 'DELETE']) test(`profile ${method} is rejected before DB`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('profile', method, { fcm_token: FIXTURE_TOKEN }), 405, { error: 'GET or PATCH only' });
    assert.deepEqual(f.queries, []);
  });
});

describe('actual worker handler — routing and DEMO', () => {
  for (const [label, query, url, expected] of [
    ['slug array precedes URL', { slug: ['register'] }, '/api/workers/heartbeat', { error: 'phone, email, fcm_token 필수' }],
    ['slug string precedes URL', { slug: 'heartbeat' }, '/api/workers/register', { error: 'fcm_token 필수' }],
    ['URL route strips query string', {}, '/api/workers/register?ignored=heartbeat', { error: 'phone, email, fcm_token 필수' }],
  ]) test(label, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('ignored', 'POST', undefined, { query, url }), 400, expected);
    assert.deepEqual(f.queries, []);
  });
  test('profile URL routing preserves query token without query.slug', async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('ignored', 'GET', undefined, { query: { fcm_token: FIXTURE_TOKEN }, url: '/api/workers/profile?fcm_token=ignored' }), 200, WORKER_ROW);
    assert.deepEqual(f.queries[0].params, [FIXTURE_TOKEN]);
  });
  for (const [label, query, url] of [
    ['unknown resource', { slug: ['unknown'] }, '/api/workers/unknown'],
    ['empty slug', { slug: [] }, '/api/workers/register'],
    ['no workers segment', {}, '/api/ha/state'], ['empty URL', {}, ''],
  ]) test(`${label} returns the existing 404`, async t => {
    const f = await actualWorker(t);
    assertWorkerReply(await f.send('ignored', 'GET', undefined, { query, url }), 404, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });
  for (const [resource, method, body] of [
    ['register', 'POST', REGISTER_BODY], ['heartbeat', 'POST', { fcm_token: FIXTURE_TOKEN }],
    ['profile', 'PATCH', { fcm_token: FIXTURE_TOKEN, name: 'Fixture' }],
    ['profile', 'GET', undefined],
  ]) test(`DEMO rejects ${method} ${resource} before all DB/Slack I/O`, async t => {
    const f = await actualWorker(t, { profile: 'demo' });
    assertWorkerReply(await f.send(resource, method, body, { query: { slug: resource, fcm_token: FIXTURE_TOKEN } }), 403, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(f.queries, []); assert.deepEqual(f.slackCalls, []);
  });
});
