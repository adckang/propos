// 운영자 숙소 격리를 "실제 핸들러"로 검증한다 (가짜 DB 주입). 소스 정규식이 아니라 실행 결과를 본다.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, COOKIE_NAME } from '../../server/auth/operatorAuth.js';
import { passwordFingerprint } from '../../server/auth/operatorAccounts.js';
import handler, { _setDbForTest } from '../../api/cleaning/[...slug].js';

const SECRET = 's'.repeat(32);
const HASH = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const PH = passwordFingerprint(HASH);
const ENV_KEYS = ['PROPOS_AUTH_MODE', 'PROPOS_ADMIN_PASSWORD', 'PROPOS_SESSION_SECRET', 'PROPOS_DATA_PROFILE'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); process.env.PROPOS_DATA_PROFILE = 'hybrid'; });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _setDbForTest(null); });
const setAuth = (mode) => { process.env.PROPOS_AUTH_MODE = mode; process.env.PROPOS_ADMIN_PASSWORD = 'admin-pass-123'; process.env.PROPOS_SESSION_SECRET = SECRET; };
const env = () => ({ PROPOS_SESSION_SECRET: SECRET });

const adminCookie = () => `${COOKIE_NAME}=${createSessionToken(env())}`;
const opCookie = (sub = 'op-1', ph = PH) => `${COOKIE_NAME}=${createSessionToken(env(), Date.now(), { role: 'operator', sub, ph })}`;

/** 가짜 DB: 모든 쿼리를 기록하고, 계정 조회는 운영자 목록에서, 나머지는 주어진 응답 함수로 답한다 */
function fakeDb({ operators = { 'op-1': { active: true, props: ['A', 'B'] } }, answer = () => ({ rows: [] }) } = {}) {
  const log = [];
  const query = async (sql, params = []) => {
    if (sql.includes('FROM operators o LEFT JOIN operator_properties')) {
      const o = operators[params[0]];
      return { rows: o ? [{ active: o.active, password_hash: HASH, property_ids: o.props }] : [] };
    }
    log.push({ sql, params });
    return answer(sql, params) ?? { rows: [] };
  };
  return { log, query, connect: async () => ({ query, release() {} }) };
}

function call({ method = 'GET', resource, id, query = {}, body, cookie }) {
  const req = {
    method, url: `/api/cleaning/${resource}`, query: { slug: resource, ...(id ? { id } : {}), ...query },
    headers: cookie ? { cookie } : {},
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
  };
  const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(b) { if (b) this.body = JSON.parse(b); }, };
  return handler(req, res).then(() => res);
}

const isJobList = (l) => l.sql.includes('ORDER BY j.cleaning_start_at DESC'); // 목록 쿼리(후속 점검 쿼리와 구분)
const JOB_A = { id: 'job-a', property_id: 'A', data_origin: 'REAL', status: 'PENDING' };
const JOB_Z = { id: 'job-z', property_id: 'Z', data_origin: 'REAL', status: 'PENDING' };

describe('숙소 목록: 운영자는 배정된 숙소만, 설정값은 빠진다', () => {
  test('WHERE 로 허용 숙소만 조회하고, 응답에서 호스트 전화·캘린더 주소가 제거되며, 설정 여부(ical_configured)만 남는다', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: (sql) => sql.includes('FROM property_cleaning_config p') ? { rows: [
      { property_id: 'A', name: 'A', host_phone: '010-1111-2222', ical_url: 'https://secret/ical', google_calendar_id: 'g', google_calendar_booking_url: 'u', ical_configured: true, reservations: [] },
    ] } : null });
    _setDbForTest(db);
    const res = await call({ resource: 'properties', cookie: opCookie() });
    assert.equal(res.statusCode, 200);
    const q = db.log.find((l) => l.sql.includes('FROM property_cleaning_config p'));
    assert.match(q.sql, /WHERE p\.property_id = ANY\(\$1::text\[\]\)/);
    assert.deepEqual(q.params, [['A', 'B']]);
    assert.deepEqual(Object.keys(res.body[0]).sort(), ['ical_configured', 'name', 'property_id', 'reservations']);
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  });
  test('관리자는 제한 없이 전부, 설정값도 그대로', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: () => ({ rows: [{ property_id: 'A', host_phone: '010', ical_url: 'https://x', reservations: [] }] }) });
    _setDbForTest(db);
    const res = await call({ resource: 'properties', cookie: adminCookie() });
    assert.equal(res.body[0].ical_url, 'https://x');
    assert.ok(!/ANY\(\$1/.test(db.log[0].sql));
  });
  test('?view=names: 이름 목록만(예약·캘린더 주소를 싣지 않는다) — 운영자는 여기서도 허용 숙소만', async () => {
    setAuth('enforce');
    const db = fakeDb();
    _setDbForTest(db);
    await call({ resource: 'properties', query: { view: 'names' }, cookie: opCookie() });
    assert.match(db.log[0].sql, /SELECT property_id, name, data_origin FROM property_cleaning_config WHERE property_id = ANY/);
    assert.ok(!db.log[0].sql.includes('reservations'));
    assert.deepEqual(db.log[0].params, [['A', 'B']]);
  });
  test('배정이 하나도 없는 운영자는 일치하는 숙소가 없는 id 로 조회된다 (전체로 오해되지 않는다)', async () => {
    setAuth('enforce');
    const db = fakeDb({ operators: { 'op-1': { active: true, props: [] } } });
    _setDbForTest(db);
    await call({ resource: 'properties', cookie: opCookie() });
    assert.deepEqual(db.log[0].params, [['__no_access__']]);
  });
});

describe('일정: 목록·단건·발송·취소', () => {
  test('목록: 상태 필터와 숙소 범위의 $n 바인딩이 어긋나지 않는다', async () => {
    setAuth('enforce');
    const db = fakeDb();
    _setDbForTest(db);
    await call({ resource: 'jobs', query: { status: 'PENDING' }, cookie: opCookie() });
    const q = db.log.find(isJobList);
    assert.match(q.sql, /WHERE j\.status=\$1 AND j\.property_id = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(q.params, ['PENDING', ['A', 'B']]);
  });
  test('목록: 상태 없이도 범위가 걸린다 / 관리자는 범위 없음', async () => {
    setAuth('enforce');
    let db = fakeDb(); _setDbForTest(db);
    await call({ resource: 'jobs', cookie: opCookie() });
    const q = db.log.find(isJobList);
    assert.match(q.sql, /WHERE j\.property_id = ANY\(\$1::text\[\]\)/);
    db = fakeDb(); _setDbForTest(db);
    await call({ resource: 'jobs', cookie: adminCookie() });
    assert.ok(!/WHERE/.test(db.log.find(isJobList).sql));
  });
  test('단건: 허용 밖 숙소의 일정은 없는 것과 똑같이 404, 자기 숙소 일정은 200', async () => {
    setAuth('enforce');
    const answer = (sql, params) => sql.includes('FROM cleaning_jobs j') ? { rows: [params[0] === 'job-a' ? JOB_A : JOB_Z] } : { rows: [] };
    _setDbForTest(fakeDb({ answer }));
    assert.equal((await call({ resource: 'jobs', id: 'job-z', cookie: opCookie() })).statusCode, 404);
    assert.equal((await call({ resource: 'jobs', id: 'job-a', cookie: opCookie() })).statusCode, 200);
    assert.equal((await call({ resource: 'jobs', id: 'job-z', cookie: adminCookie() })).statusCode, 200); // 관리자는 전부
  });
  test('단건: 운영자에게는 알림의 거절 토큰(token)을 내려주지 않는다 / 관리자에게는 그대로', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: (sql) => sql.includes('FROM cleaning_jobs j') ? { rows: [JOB_A] } : { rows: [] } });
    _setDbForTest(db);
    await call({ resource: 'jobs', id: 'job-a', cookie: opCookie() });
    const opSql = db.log.find((l) => l.sql.includes('FROM cleaning_notifs n')).sql;
    assert.ok(!/n\.\*/.test(opSql) && !/\btoken\b/.test(opSql), opSql);
    db.log.length = 0;
    await call({ resource: 'jobs', id: 'job-a', cookie: adminCookie() });
    assert.match(db.log.find((l) => l.sql.includes('FROM cleaning_notifs n')).sql, /n\.\*/);
  });
  test('문자 발송(dispatch): 허용 밖 숙소의 일정은 404 이고 발송 로직에 닿지 않는다', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: (sql) => sql.includes('SELECT * FROM cleaning_jobs WHERE id') ? { rows: [JOB_Z] } : { rows: [] } });
    _setDbForTest(db);
    const res = await call({ method: 'POST', resource: 'dispatch', id: 'job-z', cookie: opCookie() });
    assert.equal(res.statusCode, 404);
    assert.ok(!db.log.some((l) => /UPDATE cleaning_jobs|INSERT INTO cleaning_notifs/.test(l.sql)));
  });
  test('취소: 허용 밖 숙소 404 / 운영자의 수동 배정(ASSIGNED)·초기화·알 수 없는 상태는 403', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: (sql) => sql.includes('FROM cleaning_jobs j') ? { rows: [JOB_Z] } : { rows: [] } });
    _setDbForTest(db);
    assert.equal((await call({ method: 'PATCH', resource: 'jobs', id: 'job-z', body: { status: 'CANCELLED' }, cookie: opCookie() })).statusCode, 404);
    for (const status of ['ASSIGNED', 'PENDING', 'COMPLETED', undefined]) {
      const res = await call({ method: 'PATCH', resource: 'jobs', id: 'job-a', body: { status, assigned_cleaner_id: 'x', _test_reset: true }, cookie: opCookie() });
      assert.equal(res.statusCode, 403, String(status));
    }
    assert.ok(!db.log.some((l) => /UPDATE cleaning_jobs SET status='ASSIGNED'/.test(l.sql)));
  });
});

describe('담당자·통계·동기화', () => {
  test('담당자: 운영자는 내 숙소 일정에 연결된 담당자만, 이메일·푸시 토큰·관리자 메모 제외', async () => {
    setAuth('enforce');
    const db = fakeDb();
    _setDbForTest(db);
    await call({ resource: 'cleaners', cookie: opCookie() });
    const q = db.log[0];
    assert.match(q.sql, /SELECT id, name, phone, tier, active FROM cleaners/);
    for (const forbidden of ['email', 'fcm_token', 'notes']) assert.ok(!q.sql.includes(forbidden), forbidden);
    assert.deepEqual(q.params, [['A', 'B']]);
  });
  test('담당자: 관리자는 전체', async () => {
    setAuth('enforce');
    const db = fakeDb();
    _setDbForTest(db);
    await call({ resource: 'cleaners', cookie: adminCookie() });
    assert.match(db.log[0].sql, /SELECT \* FROM cleaners/);
  });
  test('통계: 허용 밖 숙소만 요청하면 일치하는 숙소가 없는 id 로 조회된다 (남의 숙소 통계를 못 본다)', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: () => ({ rows: [{ total: 0, assigned: 0, requesting: 0, failed: 0, needs_request: 0 }] }) });
    _setDbForTest(db);
    await call({ resource: 'stats', query: { period: 'next_week', property_ids: 'Z' }, cookie: opCookie() });
    const q = db.log.find((l) => l.params.some((p) => Array.isArray(p)));
    assert.deepEqual(q.params.find(Array.isArray), ['__no_access__']);
    db.log.length = 0;
    await call({ resource: 'stats', query: { period: 'next_week', property_ids: 'A,Z' }, cookie: opCookie() });
    assert.deepEqual(db.log.find((l) => l.params.some(Array.isArray)).params.find(Array.isArray), ['A']);
  });
  test('iCal 동기화: 운영자는 숙소를 지정해야 하고 허용 밖 숙소는 404 (전체 동기화는 관리자)', async () => {
    setAuth('enforce');
    const db = fakeDb();
    _setDbForTest(db);
    assert.equal((await call({ method: 'POST', resource: 'ical-sync', body: {}, cookie: opCookie() })).statusCode, 404);
    assert.equal((await call({ method: 'POST', resource: 'ical-sync', body: { property_id: 'Z' }, cookie: opCookie() })).statusCode, 404);
    assert.equal(db.log.length, 0, '허용 밖이면 DB 에 닿지도 않는다');
  });
});

describe('기본 거부와 계정 관리', () => {
  test('운영자에게 열리지 않은 경로는 전부 403 (숙소 설정·담당자 추가·계정 관리·전체 동기화 등)', async () => {
    setAuth('enforce');
    _setDbForTest(fakeDb());
    const cases = [
      ['POST', 'properties'], ['POST', 'cleaners'], ['PATCH', 'cleaners', 'x'], ['DELETE', 'cleaners', 'x'], ['POST', 'jobs'],
      ['GET', 'operators'], ['POST', 'operators'], ['PATCH', 'operators', 'x'], ['POST', 'bootstrap'], ['POST', 'gmail-watch'],
      ['POST', 'calendar-watch'], ['POST', 'blocker-cleanup'], ['POST', 'calendar-scan'], ['GET', 'brand-new-route'],
    ];
    for (const [method, resource, id] of cases) {
      const res = await call({ method, resource, id, body: {}, cookie: opCookie() });
      assert.equal(res.statusCode, 403, `${method} ${resource}`);
    }
  });
  test('로그인 없으면 401 — enforce', async () => {
    setAuth('enforce');
    _setDbForTest(fakeDb());
    assert.equal((await call({ resource: 'properties' })).statusCode, 401);
  });
  test('★ 계정 관리는 off·log 모드에서도 익명 401 (로그인을 켜기 전에 누구나 영구 계정을 만드는 일 차단)', async () => {
    for (const mode of ['off', 'log']) {
      setAuth(mode);
      const db = fakeDb();
      _setDbForTest(db);
      for (const [method, id] of [['GET'], ['POST'], ['PATCH', 'op-1']]) {
        const res = await call({ method, resource: 'operators', id, body: { email: 'evil@x.com', password: 'long-enough-pw', property_ids: ['A'] } });
        assert.equal(res.statusCode, 401, `${mode} ${method}`);
      }
      assert.equal(db.log.length, 0, `${mode}: DB 에 아무것도 쓰지 않는다`);
    }
  });
  test('관리자는 계정 목록을 본다 / 생성 시 property_ids 가 목록이 아니면 400 (조용히 빈 목록 금지)', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: () => ({ rows: [{ id: 'op-1', email: 'a@x.com', property_ids: ['A'] }] }) });
    _setDbForTest(db);
    const list = await call({ resource: 'operators', cookie: adminCookie() });
    assert.equal(list.statusCode, 200);
    assert.ok(!JSON.stringify(list.body).includes('password_hash'));
    const bad = await call({ method: 'POST', resource: 'operators', body: { email: 'n@x.com', password: 'long-enough-pw', property_ids: 'A,B' }, cookie: adminCookie() });
    assert.equal(bad.statusCode, 400);
    const badPatch = await call({ method: 'PATCH', resource: 'operators', id: 'op-1', body: { property_ids: 'A,B' }, cookie: adminCookie() });
    assert.equal(badPatch.statusCode, 400);
  });
  test('공개 경로(문자 링크 d)는 신원 확인 없이 지나가고, 신원 조회 쿼리를 실행하지 않는다', async () => {
    setAuth('enforce');
    const db = fakeDb({ answer: () => ({ rows: [] }) });
    _setDbForTest(db);
    await call({ resource: 'd', query: { token: 'ABCDEF' } });
    assert.ok(db.log.some((l) => /cleaning_notifs/.test(l.sql)), '거절 토큰 조회까지 도달');
  });
  test('off 모드: 기존 동작 그대로 — 로그인 없이 숙소·일정이 제한 없이 조회된다', async () => {
    setAuth('off');
    const db = fakeDb();
    _setDbForTest(db);
    assert.equal((await call({ resource: 'jobs' })).statusCode, 200);
    assert.ok(!/WHERE/.test(db.log.find(isJobList).sql));
  });
  test('정지된 운영자·비밀번호가 바뀐 뒤의 옛 세션은 모든 보호 경로에서 401', async () => {
    setAuth('enforce');
    _setDbForTest(fakeDb({ operators: { 'op-1': { active: false, props: ['A'] } } }));
    assert.equal((await call({ resource: 'jobs', cookie: opCookie() })).statusCode, 401);
    _setDbForTest(fakeDb());
    assert.equal((await call({ resource: 'jobs', cookie: opCookie('op-1', 'stale-fingerprint') })).statusCode, 401);
  });
});
