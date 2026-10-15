import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authMode, authConfigured, checkPassword, createSessionToken, verifySessionToken, parseCookies,
  sessionCookie, clearedCookie, isAuthenticated, guardOperator, handleAuthRoute, loginThrottled,
  recordLoginResult, _resetLoginAttempts, COOKIE_NAME, SESSION_TTL_SEC, LOGIN_MAX_FAILS,
} from '../../server/auth/operatorAuth.js';

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

describe('guardOperator 문지기', () => {
  test('off: 로그인 없어도 통과, 응답을 건드리지 않는다', () => {
    const res = fakeRes();
    assert.equal(guardOperator(reqWith(null), res, env({ PROPOS_AUTH_MODE: 'off' })), true);
    assert.equal(res.body, null);
  });
  test('log: 통과시키되 로그인 없는 호출은 경고로 남긴다 (쿼리스트링은 로그에 안 남김)', () => {
    const logs = []; const res = fakeRes();
    assert.equal(guardOperator(reqWith(null), res, env({ PROPOS_AUTH_MODE: 'log' }), Date.now(), (m) => logs.push(m)), true);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('/api/x') && !logs[0].includes('y=1'));
  });
  test('log: 로그인된 호출은 경고 없이 통과', () => {
    const logs = [];
    assert.equal(guardOperator(reqWith(createSessionToken(env())), fakeRes(), env({ PROPOS_AUTH_MODE: 'log' }), Date.now(), (m) => logs.push(m)), true);
    assert.equal(logs.length, 0);
  });
  test('enforce: 로그인 없으면 401, 있으면 통과', () => {
    const res = fakeRes();
    assert.equal(guardOperator(reqWith(null), res, env()), false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'AUTH_REQUIRED');
    assert.equal(guardOperator(reqWith(createSessionToken(env())), fakeRes(), env()), true);
  });
  test('enforce: 위조·만료 토큰은 401', () => {
    const res = fakeRes();
    assert.equal(guardOperator(reqWith('forged.token'), res, env()), false);
    assert.equal(res.statusCode, 401);
    assert.equal(guardOperator(reqWith(createSessionToken(env(), 1)), fakeRes(), env()), false);
  });
  test('enforce 인데 비밀번호·키 미설정이면 전부 거절 (설정 실수로 열리지 않는다)', () => {
    const res = fakeRes();
    assert.equal(guardOperator(reqWith(null), res, { PROPOS_AUTH_MODE: 'enforce' }), false);
    assert.equal(res.statusCode, 500);
  });
});

describe('로그인 경로 (me/login/logout)', () => {
  beforeEach(() => _resetLoginAttempts());
  const loginReq = (password, ip = '1.1.1.1') => {
    const r = reqWith(null, { method: 'POST', headers: { 'x-forwarded-for': ip } });
    r[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify({ password })); };
    return r;
  };

  test('me: enforce 면 required=true, 로그인 여부를 알려준다', async () => {
    let res = fakeRes();
    await handleAuthRoute('me', reqWith(null), res, env());
    assert.deepEqual([res.body.required, res.body.authenticated], [true, false]);
    res = fakeRes();
    await handleAuthRoute('me', reqWith(createSessionToken(env())), res, env());
    assert.equal(res.body.authenticated, true);
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
  test('login: 설정 미완료면 503', async () => {
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('x'), res, { PROPOS_AUTH_MODE: 'enforce' });
    assert.equal(res.statusCode, 503);
  });
  test('login 시도 제한: 연속 실패가 한도에 이르면 429, 성공하면 초기화, 창이 지나면 해제', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginResult('9.9.9.9', false, 1000);
    assert.equal(loginThrottled('9.9.9.9', 2000), true);
    assert.equal(loginThrottled('9.9.9.9', 1000 + 11 * 60 * 1000), false);
    recordLoginResult('9.9.9.9', true, 2000);
    assert.equal(loginThrottled('9.9.9.9', 2000), false);
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginResult('8.8.8.8', false);
    const res = fakeRes();
    await handleAuthRoute('login', loginReq('correct horse', '8.8.8.8'), res, env());
    assert.equal(res.statusCode, 429); // 맞는 비밀번호여도 제한 중이면 거절
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
  const GUARDED = ['api/ha/[...slug].js', 'api/stats.js', 'api/events/[...slug].js', 'api/monitoring/[...slug].js',
    'api/camera/snapshot.js', 'api/properties.js', 'api/ical.js', 'api/cleaning/[...slug].js', 'api/config.js'];
  for (const f of GUARDED) {
    test(`${f} 는 문지기를 쓴다`, () => {
      const s = read(f);
      assert.match(s, /import \{[^}]*guardOperator[^}]*\} from ['"][./]+server\/auth\/operatorAuth\.js['"]/);
      assert.match(s, /guardOperator\(req, res\)/);
    });
  }
  test('청소 API: 공개 허용은 문자 링크(c,d)와 구글 웹훅 둘뿐이고 나머지는 보호', () => {
    const s = read('api/cleaning/[...slug].js');
    assert.match(s, /PUBLIC_CLEANING_RESOURCES = new Set\(\["c", "d", "calendar-webhook", "gmail-webhook"\]\)/);
    assert.match(s, /!PUBLIC_CLEANING_RESOURCES\.has\(resource\) && !guardOperator\(req, res\)/);
  });
  test('이벤트 API: 조회(GET)만 보호하고 Pi 수신(POST)·write 는 기존 방식 유지', () => {
    assert.match(read('api/events/[...slug].js'), /req\.method === "GET" && !guardOperator\(req, res\)/);
  });
  test('설정 API: 로그인 경로(action)는 문지기 앞에서 처리, 설정 응답은 보호', () => {
    const s = read('api/config.js');
    assert.ok(s.indexOf('handleAuthRoute(action') < s.indexOf('guardOperator(req, res)'));
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
