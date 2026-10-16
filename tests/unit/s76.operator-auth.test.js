import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authMode, authConfigured, checkPassword, createSessionToken, verifySessionToken, parseCookies,
  sessionCookie, clearedCookie, isAuthenticated, guardAdmin, requireAdminSession, requireScope, getSession, parseSessionToken, handleAuthRoute, loginThrottled,
  recordLoginResult, _resetLoginAttempts, COOKIE_NAME, SESSION_TTL_SEC, LOGIN_MAX_FAILS, LOGIN_MAX_FAILS_PER_IP,
} from '../../server/auth/operatorAuth.js';
import { passwordFingerprint } from '../../server/auth/operatorAccounts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const SECRET = 'x'.repeat(32);
const env = (extra = {}) => ({ PROPOS_AUTH_MODE: 'enforce', PROPOS_ADMIN_PASSWORD: 'correct horse', PROPOS_SESSION_SECRET: SECRET, ...extra });
const fakeRes = () => { const r = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b ? JSON.parse(b) : null; } }; return r; };
const reqWith = (token, extra = {}) => ({ method: 'GET', url: '/api/x?y=1', headers: token ? { cookie: `${COOKIE_NAME}=${token}` } : {}, ...extra });

describe('모드·설정', () => {
  test('미설정/알 수 없는 값은 off — 배포해도 동작이 안 바뀐다', () => {
    assert.equal(authMode({}), 'off');
    assert.equal(authMode({ PROPOS_AUTH_MODE: 'whatever' }), 'off');
    assert.equal(authMode({ PROPOS_AUTH_MODE: ' ENFORCE ' }), 'enforce');
    assert.equal(authMode({ PROPOS_AUTH_MODE: 'log' }), 'log');
  });
  test('비밀번호와 16자 이상 서명키가 모두 있어야 설정 완료', () => {
    assert.equal(authConfigured(env()), true);
    assert.equal(authConfigured(env({ PROPOS_SESSION_SECRET: 'short' })), false);
    assert.equal(authConfigured(env({ PROPOS_ADMIN_PASSWORD: '' })), false);
  });
});

describe('세션 토큰', () => {
  test('발급한 토큰은 검증을 통과한다', () => assert.equal(verifySessionToken(createSessionToken(env()), env()), true));
  test('만료되면 거절', () => {
    const t = createSessionToken(env(), 1_000_000);
    assert.equal(verifySessionToken(t, env(), 1_000_000 + (SESSION_TTL_SEC - 1) * 1000), true);
    assert.equal(verifySessionToken(t, env(), 1_000_000 + (SESSION_TTL_SEC + 1) * 1000), false);
  });
  test('내용을 바꾸거나 다른 키로 서명하면 거절', () => {
    const [payload, sig] = createSessionToken(env()).split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'operator', exp: 9999999999 })).toString('base64url');
    assert.equal(verifySessionToken(`${forged}.${sig}`, env()), false);
    assert.equal(verifySessionToken(`${payload}.${sig}`, env({ PROPOS_SESSION_SECRET: 'y'.repeat(32) })), false);
    assert.equal(verifySessionToken(`${payload}.${sig}.extra`, env()), false);
  });
  test('쓰레기 입력은 예외 없이 거절', () => {
    for (const t of [undefined, null, '', 'abc', '.', 'a.b', 123]) assert.equal(verifySessionToken(t, env()), false);
  });
  test('서명키가 없으면 항상 거절', () => assert.equal(verifySessionToken(createSessionToken(env()), {}), false));
  test('역할이 담긴다: admin(기본) / operator+sub, sub 없는 operator·모르는 역할은 거절', () => {
    assert.deepEqual(parseSessionToken(createSessionToken(env()), env()).role, 'admin');
    const op = parseSessionToken(createSessionToken(env(), Date.now(), { role: 'operator', sub: 'op-1', ph: 'fp' }), env());
    assert.deepEqual([op.role, op.sub, op.ph], ['operator', 'op-1', 'fp']);
    assert.equal(parseSessionToken(createSessionToken(env(), Date.now(), { role: 'operator', sub: null, ph: 'fp' }), env()), null);
    assert.equal(parseSessionToken(createSessionToken(env(), Date.now(), { role: 'operator', sub: 'op-1' }), env()), null); // 비밀번호 지문 없는 운영자 토큰은 거절
    assert.equal(parseSessionToken(createSessionToken(env(), Date.now(), { role: 'root', sub: 'x', ph: 'fp' }), env()), null);
  });
  test('운영자 토큰의 sub 를 바꿔치기하면 서명이 깨져 거절', () => {
    const t = createSessionToken(env(), Date.now(), { role: 'operator', sub: 'op-1', ph: 'fp' });
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'operator', sub: 'op-2', ph: 'fp', exp: 9999999999 })).toString('base64url');
    assert.equal(parseSessionToken(`${forged}.${sig}`, env()), null);
  });
});

describe('비밀번호·쿠키', () => {
  test('비밀번호 비교', () => {
    assert.equal(checkPassword('correct horse', env()), true);
    assert.equal(checkPassword('wrong', env()), false);
    assert.equal(checkPassword('', env()), false);
    assert.equal(checkPassword(undefined, env()), false);
    assert.equal(checkPassword('anything', {}), false);
  });
  test('쿠키는 HttpOnly·SameSite=Strict·Secure, 로컬 http 에서는 Secure 생략', () => {
    const c = sessionCookie('tok');
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Secure', `Max-Age=${SESSION_TTL_SEC}`, 'Path=/']) assert.ok(c.includes(part), part);
    assert.ok(!sessionCookie('tok', { secure: false }).includes('Secure'));
    assert.ok(clearedCookie().includes('Max-Age=0'));
  });
  test('쿠키 파싱', () => assert.deepEqual(parseCookies('a=1; propos_session=abc%3D; b=2'), { a: '1', propos_session: 'abc=', b: '2' }));
});

const HASH = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const PH = passwordFingerprint(HASH);
const opToken = (sub = 'op-1', e = env(), ph = PH) => createSessionToken(e, Date.now(), { role: 'operator', sub, ph });
// 운영자 계정을 흉내 내는 가짜 DB: 상태·배정을 한 번에 읽는 쿼리(1회 왕복)만 지원
const fakeDb = ({ operators = { 'op-1': { active: true, props: ['A', 'B'], hash: HASH } } } = {}) => ({
  calls: 0,
  async query(sql, params) {
    this.calls += 1;
    if (sql.includes('FROM operators o LEFT JOIN operator_properties')) {
      const o = operators[params[0]];
      return { rows: o ? [{ active: o.active, password_hash: o.hash ?? HASH, property_ids: o.props }] : [] };
    }
    if (sql.includes('FROM operators WHERE email')) return { rows: [] }; // 가입된 이메일 없음
    throw new Error(`예상 못 한 SQL: ${sql}`);
  },
});

describe('guardAdmin — 관리자 전용 문지기', () => {
  test('off: 누구나 통과, 응답을 건드리지 않는다', () => {
    const res = fakeRes();
    assert.equal(guardAdmin(reqWith(null), res, env({ PROPOS_AUTH_MODE: 'off' })), true);
    assert.equal(res.body, null);
  });
  test('log: 통과시키되 로그인 없는 호출은 경고(쿼리스트링은 안 남김)', () => {
    const logs = [];
    assert.equal(guardAdmin(reqWith(null), fakeRes(), env({ PROPOS_AUTH_MODE: 'log' }), Date.now(), (m) => logs.push(m)), true);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('/api/x') && !logs[0].includes('y=1'));
  });
  test('enforce: 로그인 없으면 401, 관리자는 통과, 운영자(숙소 제한 계정)는 403', () => {
    let res = fakeRes();
    assert.equal(guardAdmin(reqWith(null), res, env()), false);
    assert.equal(res.statusCode, 401);
    assert.equal(guardAdmin(reqWith(createSessionToken(env())), fakeRes(), env()), true);
    res = fakeRes();
    assert.equal(guardAdmin(reqWith(opToken()), res, env()), false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });
  test('enforce: 위조·만료 토큰은 401', () => {
    const res = fakeRes();
    assert.equal(guardAdmin(reqWith('forged.token'), res, env()), false);
    assert.equal(res.statusCode, 401);
    assert.equal(guardAdmin(reqWith(createSessionToken(env(), 1)), fakeRes(), env()), false);
  });
  test('enforce 인데 비밀번호·키 미설정이면 전부 거절 (설정 실수로 열리지 않는다)', () => {
    const res = fakeRes();
    assert.equal(guardAdmin(reqWith(null), res, { PROPOS_AUTH_MODE: 'enforce' }), false);
    assert.equal(res.statusCode, 500);
  });
});

describe('requireAdminSession — 계정 관리는 어떤 모드에서도 진짜 관리자 세션만', () => {
  test('off·log 모드에서도 익명은 401 (로그인을 켜기 전에 누구나 계정을 만드는 일을 막는다)', () => {
    for (const mode of ['off', 'log', 'enforce']) {
      const res = fakeRes();
      assert.equal(requireAdminSession(reqWith(null), res, env({ PROPOS_AUTH_MODE: mode })), false, mode);
      assert.equal(res.statusCode, 401, mode);
    }
  });
  test('관리자 세션은 통과, 운영자 세션은 403', () => {
    for (const mode of ['off', 'log', 'enforce']) {
      assert.equal(requireAdminSession(reqWith(createSessionToken(env())), fakeRes(), env({ PROPOS_AUTH_MODE: mode })), true, mode);
      const res = fakeRes();
      assert.equal(requireAdminSession(reqWith(opToken()), res, env({ PROPOS_AUTH_MODE: mode })), false, mode);
      assert.equal(res.statusCode, 403, mode);
    }
  });
  test('로그인 설정이 없으면 503 — 계정 관리 자체를 쓸 수 없다', () => {
    const res = fakeRes();
    assert.equal(requireAdminSession(reqWith(null), res, { PROPOS_AUTH_MODE: 'off' }), false);
    assert.equal(res.statusCode, 503);
  });
});

describe('requireScope — 먼저 누구인지 확인하고 볼 수 있는 숙소 범위를 돌려준다', () => {
  test('off: 제한 없음(관리자 범위) — 켜기 전엔 동작이 안 바뀐다', async () => {
    assert.deepEqual(await requireScope(reqWith(null), fakeRes(), fakeDb(), env({ PROPOS_AUTH_MODE: 'off' })), { all: true });
  });
  test('log: 로그인 없으면 경고 후 제한 없이 통과', async () => {
    const logs = [];
    const scope = await requireScope(reqWith(null), fakeRes(), fakeDb(), env({ PROPOS_AUTH_MODE: 'log' }), Date.now(), (m) => logs.push(m));
    assert.equal(scope.all, true);
    assert.equal(logs.length, 1);
  });
  test('enforce: 로그인 없으면 401 + null', async () => {
    const res = fakeRes();
    assert.equal(await requireScope(reqWith(null), res, fakeDb(), env()), null);
    assert.equal(res.statusCode, 401);
  });
  test('enforce: 관리자 → 전부, 운영자 → 배정된 숙소만', async () => {
    assert.deepEqual(await requireScope(reqWith(createSessionToken(env())), fakeRes(), fakeDb(), env()), { all: true });
    assert.deepEqual(await requireScope(reqWith(opToken()), fakeRes(), fakeDb(), env()), { all: false, propertyIds: ['A', 'B'] });
  });
  test('enforce: 배정이 하나도 없는 운영자는 빈 범위(아무것도 안 보임)', async () => {
    const db = fakeDb({ operators: { 'op-1': { active: true, props: [], hash: HASH } } });
    assert.deepEqual(await requireScope(reqWith(opToken()), fakeRes(), db, env()), { all: false, propertyIds: [] });
  });
  test('enforce: 정지된 계정·삭제된 계정의 기존 세션은 즉시 401', async () => {
    for (const operators of [{ 'op-1': { active: false, props: ['A'], hash: HASH } }, {}]) {
      const res = fakeRes();
      assert.equal(await requireScope(reqWith(opToken()), res, fakeDb({ operators }), env()), null);
      assert.equal(res.statusCode, 401);
    }
  });
  test('enforce 인데 설정 미완료면 500 + null', async () => {
    const res = fakeRes();
    assert.equal(await requireScope(reqWith(null), res, fakeDb(), { PROPOS_AUTH_MODE: 'enforce' }), null);
    assert.equal(res.statusCode, 500);
  });
  test('비밀번호를 재설정하면 이미 발급된 세션이 즉시 무효 (정지만이 유일한 차단 수단이 아니다)', async () => {
    const reset = fakeDb({ operators: { 'op-1': { active: true, props: ['A'], hash: `scrypt$${'c'.repeat(32)}$${'d'.repeat(64)}` } } });
    const res = fakeRes();
    assert.equal(await requireScope(reqWith(opToken()), res, reset, env()), null); // 옛 해시 지문으로 발급된 토큰
    assert.equal(res.statusCode, 401);
  });
  test('★ DB 연결 팩토리는 운영자 세션일 때만 호출된다 (관리자·off·로그인 없음에서는 연결을 만들지 않는다)', async () => {
    let made = 0;
    const factory = () => { made += 1; return fakeDb(); };
    await requireScope(reqWith(createSessionToken(env())), fakeRes(), factory, env());                      // 관리자
    await requireScope(reqWith(null), fakeRes(), factory, env({ PROPOS_AUTH_MODE: 'off' }));                 // off
    await requireScope(reqWith(null), fakeRes(), factory, env());                                           // 로그인 없음(401)
    await requireScope(reqWith(null), fakeRes(), factory, env({ PROPOS_AUTH_MODE: 'log' }), Date.now(), () => {}); // log
    assert.equal(made, 0);
    await requireScope(reqWith(opToken()), fakeRes(), factory, env());                                      // 운영자
    assert.equal(made, 1);
  });
  test('왕복 1회: 상태와 배정을 한 쿼리로 읽는다 (두 번 읽는 틈이 없다)', async () => {
    const db = fakeDb();
    await requireScope(reqWith(opToken()), fakeRes(), db, env());
    assert.equal(db.calls, 1);
  });
});

describe('로그인 경로 (me/login/logout)', () => {
  beforeEach(() => _resetLoginAttempts());
  const loginReq = (password, ip = '1.1.1.1', email) => {
    const r = reqWith(null, { method: 'POST', headers: { 'x-forwarded-for': ip } });
    r[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(email === undefined ? { password } : { email, password })); };
    return r;
  };

  test('me: enforce 면 required=true, 로그인 여부를 알려준다', async () => {
    let res = fakeRes();
    await handleAuthRoute('me', reqWith(null), res, env());
    assert.deepEqual([res.body.required, res.body.authenticated, res.body.role], [true, false, null]);
    res = fakeRes();
    await handleAuthRoute('me', reqWith(createSessionToken(env())), res, env());
    assert.deepEqual([res.body.authenticated, res.body.role], [true, 'admin']);
    res = fakeRes();
    await handleAuthRoute('me', reqWith(opToken()), res, env(), Date.now(), fakeDb());
    assert.deepEqual([res.body.authenticated, res.body.role], [true, 'operator']);
    res = fakeRes();
    await handleAuthRoute('me', reqWith(opToken()), res, env(), Date.now(), fakeDb({ operators: { 'op-1': { active: false, props: [], hash: HASH } } }));
    assert.equal(res.body.authenticated, false); // 정지된 계정은 로그인 상태로 보이지 않는다
    res = fakeRes();
    await handleAuthRoute('me', reqWith(null), res, env({ PROPOS_AUTH_MODE: 'off' }));
    assert.equal(res.body.required, false);
  });
  test('login 성공: 쿠키 발급, 그 쿠키로 인증된다', async () => {
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('correct horse'), res, env());
    assert.equal(res.statusCode, 200);
    const cookie = res.headers['Set-Cookie'];
    assert.ok(cookie.startsWith(`${COOKIE_NAME}=`) && cookie.includes('HttpOnly'));
    const token = cookie.split(';')[0].split('=').slice(1).join('=');
    assert.equal(isAuthenticated(reqWith(token), env()), true);
  });
  test('login 실패: 401, 쿠키 없음', async () => {
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('nope'), res, env());
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });
  test('이메일을 입력하면 환경변수 비밀번호로는 로그인되지 않는다 (운영자는 DB 계정으로만)', async () => {
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('correct horse', '2.2.2.2', 'someone@example.com'), res, env(), Date.now(), fakeDb());
    assert.equal(res.statusCode, 401);
  });
  test('login: 설정 미완료면 503', async () => {
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('x'), res, { PROPOS_AUTH_MODE: 'enforce' });
    assert.equal(res.statusCode, 503);
  });
  test('시도 제한(계정별): 한 계정에 연속 실패가 한도에 이르면 429, 그 계정이 성공하면 초기화, 창이 지나면 해제', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginResult('acct:x@y.com', false, 1000);
    assert.equal(loginThrottled('acct:x@y.com', 2000), true);
    assert.equal(loginThrottled('acct:x@y.com', 1000 + 11 * 60 * 1000), false);
    recordLoginResult('acct:x@y.com', true, 2000);
    assert.equal(loginThrottled('acct:x@y.com', 2000), false);
  });
  test('시도 제한(관리자 로그인): 틀린 비밀번호가 한도에 이르면 맞는 비밀번호도 429', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginResult('acct:(admin)', false);
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('correct horse', '8.8.8.8'), res, env());
    assert.equal(res.statusCode, 429);
  });
  test('자기 계정으로 로그인에 성공해도 IP 실패 카운터는 지워지지 않는다 (남의 계정 추측 우회 방지)', async () => {
    const ip = '7.7.7.7';
    for (let i = 0; i < LOGIN_MAX_FAILS_PER_IP - 1; i++) recordLoginResult(`ip:${ip}`, false);
    recordLoginResult('acct:mine@x.com', true); // 자기 계정 성공 — 계정 키만 지운다
    recordLoginResult(`ip:${ip}`, false);        // 한도 도달
    assert.equal(loginThrottled(`ip:${ip}`, Date.now(), LOGIN_MAX_FAILS_PER_IP), true);
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('anything', ip, 'victim@x.com'), res, env(), Date.now(), fakeDb());
    assert.equal(res.statusCode, 429);
  });
  test('같은 사무실(IP)의 다른 사람은 계정별 한도 안에서 서로를 잠그지 않는다', () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginResult('acct:a@x.com', false);
    assert.equal(loginThrottled('acct:b@x.com'), false);
    assert.equal(loginThrottled('ip:1.1.1.1', Date.now(), LOGIN_MAX_FAILS_PER_IP), false);
  });
  test('logout: 쿠키를 지운다 / POST 아니면 405 / 모르는 action 은 404', async () => {
    let res = fakeRes();
    await handleAuthRoute('logout', reqWith(null, { method: 'POST' }), res, env());
    assert.ok(res.headers['Set-Cookie'].includes('Max-Age=0'));
    res = fakeRes();
    await handleAuthRoute('login', reqWith(null, { method: 'GET' }), res, env());
    assert.equal(res.statusCode, 405);
    res = fakeRes();
    await handleAuthRoute('nope', reqWith(null, { method: 'POST' }), res, env());
    assert.equal(res.statusCode, 404);
  });
});

describe('적용 범위 계약 (소스)', () => {
  // D-035: 스마트홈·CCTV·모니터링·숙소 메타데이터는 운영자에게 "자기 숙소 범위" 안에서 열렸다(아래 별도 계약). 여기는 여전히 관리자 전용.
  const ADMIN_ONLY = ['api/ical.js', 'api/config.js'];
  for (const f of ADMIN_ONLY) {
    test(`${f} 는 관리자 전용 문지기를 쓴다`, () => {
      const s = read(f);
      assert.match(s, /import \{[^}]*guardAdmin[^}]*\} from ['"][./]+server\/auth\/operatorAuth\.js['"]/);
      assert.match(s, /guardAdmin\(req, res\)/);
      assert.ok(!/guardOperator/.test(s), '옛 이름 잔존');
    });
  }
  test('저장(PUT)·설정 전송 같은 쓰기는 여전히 관리자 전용: 숙소 메타데이터 PUT', () => {
    const p = read('api/properties.js');
    assert.match(p, /if \(req\.method === 'PUT'\) \{\s*if \(!guardAdmin\(req, res\)\) return;/);
  });
  for (const f of ['api/ha/[...slug].js', 'api/camera/snapshot.js', 'api/monitoring/[...slug].js', 'api/properties.js']) {
    test(`${f} 는 먼저 신원을 확인하고 운영자는 자기 숙소 범위로 제한한다 (D-035)`, () => {
      const s = read(f);
      assert.match(s, /import \{[^}]*requireScope[^}]*\} from ['"][./]+server\/auth\/operatorAuth\.js['"]/);
      // DB 연결은 함수로 넘긴다 — 운영자 세션일 때만 만들어진다(관리자·인증 꺼짐 상태에서는 연결을 만들지 않는다)
      assert.match(s, /await requireScope\(req, res, getAuthDb\)/);
      assert.ok(!/requireScope\(req, res, getAuthDb\(\)\)/.test(s), '함수를 넘겨야 한다 — getAuthDb() 로 즉시 호출하면 매 요청마다 연결을 만든다');
      assert.ok(!/new Pool\(/.test(s), '연결 생성 코드를 파일마다 복사하지 않고 공용 authDb 를 쓴다');
      assert.ok(!/guardOperator/.test(s));
    });
  }
  for (const f of ['api/stats.js', 'api/events/[...slug].js', 'api/cleaning/[...slug].js']) {
    test(`${f} 는 먼저 신원을 확인하고 숙소 범위(requireScope)를 받는다`, () => {
      const s = read(f);
      assert.match(s, /import \{[^}]*requireScope[^}]*\} from ['"][./]+server\/auth\/operatorAuth\.js['"]/);
      assert.match(s, /await requireScope\(req, res, db\)/);
      assert.match(s, /if \(!scope\) return;/);
    });
  }
  test('통계: 요청한 property_ids 를 허용 숙소와 교집합한 뒤에 조회한다', () => {
    const s = read('api/stats.js');
    assert.ok(s.indexOf('requireScope(') < s.indexOf('scopeQueryIds(scope, propertyIds)'));
    assert.ok(s.indexOf('scopeQueryIds(scope, propertyIds)') < s.indexOf('getMonthlyCalendarData(period'));
  });
  test('이벤트: 조회는 범위를 적용하고, 단건은 허용 밖이면 없는 것과 같은 404', () => {
    const s = read('api/events/[...slug].js');
    assert.match(s, /scopeQueryIds\(scope, property_id \? \[property_id\] : null\)/);
    assert.match(s, /!canAccessProperty\(scope, result\.rows\[0\]\.property_id\)/);
    assert.ok(s.indexOf("action === \"write\"") < s.indexOf('requireScope('), 'Pi 쓰기는 문지기 앞(기존 시크릿 방식)');
  });
  test('청소 API: 공개 허용은 문자 링크(c,d)와 구글 웹훅 둘뿐', () => {
    const s = read('api/cleaning/[...slug].js');
    assert.match(s, /PUBLIC_CLEANING_RESOURCES = new Set\(\["c", "d", "calendar-webhook", "gmail-webhook"\]\)/);
    assert.match(s, /if \(!PUBLIC_CLEANING_RESOURCES\.has\(resource\)\) \{/);
  });
  test('청소 API: 운영자 허용 목록이 정확히 이것뿐이다 (새 경로는 자동으로 관리자 전용)', async () => {
    const m = await import('../../api/cleaning/[...slug].js');
    assert.deepEqual([...m.OPERATOR_ALLOWED].sort(), [
      'GET cleaners', 'GET jobs', 'GET properties', 'GET stats', 'PATCH jobs', 'POST dispatch', 'POST ical-sync',
    ]);
    const s = read('api/cleaning/[...slug].js');
    assert.match(s, /!isAdminScope\(scope\) && !OPERATOR_ALLOWED\.has\(`\$\{req\.method\} \$\{resource\}`\)/);
  });
  test('청소 API: 운영자 쓰기는 취소만 — 수동 배정·테스트 초기화는 관리자', () => {
    const s = read('api/cleaning/[...slug].js');
    // 본문 상태를 읽은 직후 "운영자는 CANCELLED 가 아니면 403" 을 먼저 걸고, 그 뒤에 분기가 온다(뒤에 분기를 추가해도 안 샌다)
    const deny = s.indexOf('!isAdminScope(scope) && b.status !== "CANCELLED"');
    const cancel = s.indexOf('cancelJob(req, res, id, scope)');
    const assigned = s.indexOf('if (b.status === "ASSIGNED")');
    assert.ok(deny > 0 && deny < cancel && cancel < assigned);
  });
  test('청소 API: 단건 조회·발송·취소는 허용 밖 숙소면 404(없는 것과 같다)', () => {
    const s = read('api/cleaning/[...slug].js');
    assert.equal((s.match(/!canAccessProperty\(scope, job\.property_id\)/g) || []).length, 3); // getJob, dispatchJob, cancelJob
  });
  test('청소 API: 숙소 응답에서 운영자에게는 설정값(전화·캘린더 주소)을 뺀다', () => {
    const s = read('api/cleaning/[...slug].js');
    assert.match(s, /\{ host_phone, ical_url, google_calendar_id, google_calendar_booking_url, \.\.\.safe \}/);
    assert.match(s, /SELECT id, name, phone, tier, active FROM cleaners/); // 담당자도 푸시 토큰·이메일·관리자 메모 제외
  });
  test('청소 API: ical-sync 는 운영자에게 숙소 지정을 강제(전체 동기화는 관리자)', () => {
    assert.match(read('api/cleaning/[...slug].js'), /!isAdminScope\(scope\) && \(!property_id \|\| !canAccessProperty\(scope, property_id\)\)/);
  });
  test('설정 API: 로그인 경로(action)는 문지기 앞에서 처리, 설정 응답은 관리자 전용', () => {
    const s = read('api/config.js');
    assert.ok(s.indexOf('handleAuthRoute(action') < s.indexOf('guardAdmin(req, res)'));
  });
  test('Vercel 함수는 12개 한도 — api/auth 같은 새 함수 파일을 만들지 않고 rewrite 로 처리', () => {
    const v = JSON.parse(read('vercel.json'));
    assert.ok(v.rewrites.some((r) => r.source === '/api/auth/:action' && r.destination === '/api/config?action=:action'));
  });
  test('프런트: 앱 전체를 AuthGate 로 감싸고, 401 이면 로그인 화면, 인증은 쿠키(코드에 비밀 없음)', () => {
    assert.match(read('src/main.jsx'), /<AuthGate>\s*<App \/>\s*<\/AuthGate>/);
    const g = read('src/components/AuthGate.jsx');
    assert.match(g, /status === 401/);
    assert.match(g, /credentials: "same-origin"/);
    assert.ok(!/alert\(|innerHTML|localStorage/.test(g), 'alert/innerHTML/localStorage 금지');
  });
});

describe('운영자 관리 (D-034) — 소스 계약', () => {
  test('계정 관리 API: 허용 목록에 없다(관리자 전용), 목록은 password_hash 를 내려주지 않는다', () => {
    const s = read('api/cleaning/[...slug].js');
    assert.ok(!/"[A-Z]+ operators"/.test(s.slice(s.indexOf('OPERATOR_ALLOWED = new Set'), s.indexOf(']);', s.indexOf('OPERATOR_ALLOWED = new Set')))));
    assert.match(s, /if \(!requireAdminSession\(req, res\)\) return;/); // 모드와 무관한 엄격 검사
    const admin = read('server/auth/operatorAdmin.js');
    const list = admin.slice(admin.indexOf('export async function listOperators'), admin.indexOf('/** 배정 숙소 목록')).replace(/\/\/.*$/gm, ''); // 주석 제외
    assert.ok(!/password_hash/.test(list));
    assert.ok(!/SELECT \*/.test(list));
  });
  test('계정 생성·수정은 트랜잭션, 이메일 중복 409·없는 숙소 400, 비밀번호는 해시로만 저장', () => {
    const s = read('server/auth/operatorAdmin.js');
    assert.match(s, /EMAIL_TAKEN/);
    assert.match(s, /UNKNOWN_PROPERTY/);
    assert.match(s, /hashPassword\(b\.password\)/);
    assert.ok(!/INSERT INTO operators[^;]*\$\d[^;]*b\.password/.test(s), '평문 저장 금지');
    assert.match(s, /DELETE FROM operator_properties WHERE operator_id = \$1/);
    assert.ok(!/async function (createOperator|updateOperator|listOperators)/.test(read('api/cleaning/[...slug].js')), '계정 관리 코드는 별도 모듈에');
  });
  test('vercel rewrite: /api/cleaning/operators/:id', () => {
    const v = JSON.parse(read('vercel.json'));
    assert.ok(v.rewrites.some((r) => r.source === '/api/cleaning/operators/:id'));
  });
  test('화면: 운영자 관리 버튼은 로그인이 필수이고 관리자일 때만 보인다 (off/log 에서는 화면이 안 바뀐다)', () => {
    const g = read('src/components/AuthGate.jsx');
    assert.match(g, /required && role === "admin" \? <button[\s\S]*?운영자 관리/);
    assert.match(g, /import OperatorManager/);
  });
  test('화면: 로그인 폼은 이메일을 보낸다(비면 관리자) / 관리 창은 alert·innerHTML 없이 Toast', () => {
    assert.match(read('src/components/AuthGate.jsx'), /JSON\.stringify\(\{ email, password \}\)/);
    const m = read('src/components/OperatorManager.jsx');
    assert.ok(!/alert\(|confirm\(|innerHTML/.test(m));
    assert.match(m, /credentials: "same-origin"/);
  });
});

describe('독립 코드 리뷰 반영 (D-034) — 회귀 방지', () => {
  test('AuthGate: 앱을 div 로 감싸지 않는다(레이아웃 보존), 쓰이지 않는 컨텍스트 없음, 로그아웃·401 에 관리 창을 닫는다', () => {
    const g = read('src/components/AuthGate.jsx');
    assert.match(g, /<Fragment key=\{epoch\}>/);
    assert.ok(!/<div key=\{epoch\}>/.test(g));
    assert.ok(!/AuthContext|useAuth/.test(g), '아무도 쓰지 않는 컨텍스트는 false 안심을 준다');
    assert.match(g, /setManaging\(false\);\s*setState\("login"\)/);              // 401/세션 만료
    assert.match(g, /setManaging\(false\);\s*setState\("login"\);\s*\}, \[\]\);/); // 로그아웃
    assert.match(g, /managing && required && role === "admin"/);                   // 관리 창은 관리자일 때만
  });
  test('AuthGate: 로그인 직후 권한 확인이 실패하면 관리자로 가정하지 않는다(최소 권한)', () => {
    assert.match(read('src/components/AuthGate.jsx'), /setRole\(s\.role === "admin" \? "admin" : "operator"\)/);
  });
  test('운영자도 iCal 동기화가 돈다: 서버는 주소 대신 ical_configured 만 주고, 화면은 그걸로 동기화를 허용한다', () => {
    const r = read('src/components/v2/RoomStateApp.jsx');
    assert.match(r, /icalConfigured: !!\(row\.ical_url \|\| row\.ical_configured\)/);
    assert.match(r, /!\(cfg\?\.airbnbIcalUrl \|\| cfg\?\.icalConfigured\)/);
    assert.match(read('api/cleaning/[...slug].js'), /\(p\.ical_url IS NOT NULL AND p\.ical_url <> ''\) AS ical_configured/);
  });
  test('계정 관리 화면은 가벼운 이름 목록만 받는다 (예약·게스트·캘린더 주소를 내려받지 않는다)', () => {
    assert.match(read('src/components/OperatorManager.jsx'), /\/api\/cleaning\/properties\?view=names/);
  });
  test('비밀번호 지문이 세션 토큰·로그인에 연결돼 있다', () => {
    const a = read('server/auth/operatorAuth.js');
    assert.match(a, /ph: op\.ph/);
    assert.match(read('server/auth/operatorAccounts.js'), /session\.ph !== passwordFingerprint\(access\.passwordHash\)/);
  });
});
