// RF-21(2026-11-14): 집 Pi 워처가 로그인 없이 외부에서 열려 있었다. 서버(Vercel)는 워처를 부를 때 기존 공유키를 붙이고,
// 워처는 키가 맞는 요청만 처리한다(기록 모드 관찰 → 2026-11-16 기본값 차단). 실제 확인 함수와 워처 서버 소스의 순서를 검증한다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUnauthenticatedLogger, decideWatcherRequest, hasWatcherSecret, watcherAuthMode, watcherAuthStartupMessage, WATCHER_SECRET_HEADER } from '../../server/watcherAuth.js';
import { watcherRequestHeaders } from '../../server/auth/watcherScope.js';

const KEY = 'k'.repeat(40);
const withKey = (value = KEY) => ({ [WATCHER_SECRET_HEADER]: value });

describe('워처가 받는 요청 확인', () => {
  test('서버가 같은 공유키를 붙인 요청은 두 모드 모두 처리한다', () => {
    for (const mode of [undefined, 'log', 'enforce']) {
      assert.equal(decideWatcherRequest(withKey(), { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: mode }), 'allow', String(mode));
    }
  });

  test('키 없는 요청: 기본·차단 모드는 거절, 기록 모드만 처리하되 기록', () => {
    assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: KEY }), 'reject', '기본은 차단 — 재시작 때 설정이 빠져도 다시 열리지 않게');
    assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'enforce' }), 'reject');
    assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'log' }), 'log');
  });

  test('틀린 키·길이가 다른 키·빈 키는 맞는 키가 아니다(예외 없이)', () => {
    const env = { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'enforce' };
    for (const value of ['x'.repeat(KEY.length), 'short', '', `${KEY}x`]) {
      assert.equal(decideWatcherRequest(withKey(value), env), 'reject', JSON.stringify(value));
    }
    assert.equal(decideWatcherRequest(withKey(['a', 'b']), env), 'reject', '문자열이 아닌 헤더 값');
  });

  test('Pi 에 키가 없으면 키를 보내도 전부 거절한다 — 기본값·차단 모드 모두(설정 실수로 열리지 않게)', () => {
    for (const secret of [undefined, '']) {
      assert.equal(hasWatcherSecret(withKey(''), { PROPOS_PI_SECRET: secret }), false);
      assert.equal(decideWatcherRequest(withKey(), { PROPOS_PI_SECRET: secret, PROPOS_WATCHER_AUTH_MODE: 'enforce' }), 'reject');
      assert.equal(decideWatcherRequest(withKey(), { PROPOS_PI_SECRET: secret }), 'reject', '모드 설정 없음(기본) + 키 없음');
      assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: secret }), 'reject');
    }
  });

  test('기록 모드는 정확히 "log" 일 때만 — 값 없음·빈 값·오타·다른 값은 차단', () => {
    for (const value of [undefined, '', 'off', 'LOG', 'log ', 'enforce', 'ENFORCE']) assert.equal(watcherAuthMode({ PROPOS_WATCHER_AUTH_MODE: value }), 'enforce', JSON.stringify(value));
    assert.equal(watcherAuthMode({ PROPOS_WATCHER_AUTH_MODE: 'log' }), 'log');
  });

  test('시작 기록: 모드를 남기고, 차단 모드인데 Pi 에 키가 없으면 경고한다', () => {
    assert.equal(watcherAuthStartupMessage({ PROPOS_PI_SECRET: KEY }), '[watcher-auth] 모드: 차단(키 없는 요청 401)');
    assert.match(watcherAuthStartupMessage({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'log' }), /모드: 기록/);
    for (const secret of [undefined, '']) assert.match(watcherAuthStartupMessage({ PROPOS_PI_SECRET: secret }), /차단 — 경고: 공유키\(PROPOS_PI_SECRET\)가 없어/);
  });
});

describe('키가 없거나 틀린 요청 기록', () => {
  const knownPaths = new Set(['/api/monitoring/state', '/api/properties']);
  test('같은 경로는 10분에 한 번만 남기고, 그 사이 건수를 다음 기록에 적는다', () => {
    let t = 0; const lines = [];
    const log = createUnauthenticatedLogger({ knownPaths, now: () => t, log: (m) => lines.push(m) });
    log('GET', '/api/monitoring/state');
    for (let i = 0; i < 50; i++) { t += 1000; log('GET', '/api/monitoring/state'); }
    assert.equal(lines.length, 1, '봇이 50번 두드려도 한 줄');
    t = 10 * 60_000 + 1;
    log('GET', '/api/monitoring/state');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /직전 기록 뒤 50건 더/);
  });
  test('경로·방식이 다르면 따로 남기고, 모르는 경로는 하나로 묶는다(기억이 늘지 않게)', () => {
    const lines = [];
    const log = createUnauthenticatedLogger({ knownPaths, now: () => 0, log: (m) => lines.push(m) });
    log('GET', '/api/properties'); log('PUT', '/api/properties');
    for (let i = 0; i < 20; i++) log('GET', `/random-${i}`);
    assert.deepEqual(lines, ['[watcher-auth] 키가 없거나 틀린 요청 GET /api/properties', '[watcher-auth] 키가 없거나 틀린 요청 PUT /api/properties', '[watcher-auth] 키가 없거나 틀린 요청 GET (기타 경로)']);
  });
  test('거절한 요청은 → 401 거절 로 남긴다(서버 키가 틀렸거나 모르는 호출자가 막힌 것을 Pi 에서 보게)', () => {
    const lines = [];
    const log = createUnauthenticatedLogger({ knownPaths, now: () => 0, log: (m) => lines.push(m) });
    log('GET', '/api/monitoring/state', { rejected: true });
    log('GET', '/api/monitoring/state', { rejected: true });
    assert.deepEqual(lines, ['[watcher-auth] 키가 없거나 틀린 요청 GET /api/monitoring/state → 401 거절']);
  });
});

describe('서버가 워처를 부를 때 붙이는 헤더', () => {
  test('공유키가 있으면 x-pi-secret 을 붙이고 다른 헤더는 그대로 둔다', () => {
    const extra = { 'Content-Type': 'application/json' };
    assert.deepEqual(watcherRequestHeaders(extra, { PROPOS_PI_SECRET: KEY }), { 'Content-Type': 'application/json', 'x-pi-secret': KEY });
    assert.deepEqual(extra, { 'Content-Type': 'application/json' }, '넘긴 객체를 바꾸지 않는다');
  });

  test('공유키가 없으면 아무것도 붙이지 않는다', () => {
    assert.deepEqual(watcherRequestHeaders({}, {}), {});
    assert.deepEqual(watcherRequestHeaders({ a: '1' }, { PROPOS_PI_SECRET: '' }), { a: '1' });
  });

  test('서버가 붙인 헤더를 워처가 맞는 키로 받아들인다(양쪽 헤더 이름 일치)', () => {
    const env = { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'enforce' };
    // node 는 받은 헤더 이름을 소문자로 준다
    const received = Object.fromEntries(Object.entries(watcherRequestHeaders({}, env)).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(decideWatcherRequest(received, env), 'allow');
  });
});

describe('워처 서버 소스 계약', () => {
  const src = readFileSync(new URL('../../scripts/occupancy-watcher-standalone.mjs', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('http.createServer('), src.indexOf('server.listen('));

  test('모든 경로보다 먼저 요청을 확인하고, 거절이면 401 로 끝낸다', () => {
    const check = handler.indexOf('decideWatcherRequest(req.headers)');
    assert.ok(check > 0, '요청 확인이 있다');
    const firstRoute = handler.indexOf('url.pathname ===');
    assert.ok(firstRoute > check, '첫 경로(청소·정비 요청 포함)보다 앞');
    const gate = handler.slice(check, firstRoute);
    assert.match(gate, /if \(access === 'reject'\) \{ sendJson\(res, 401, \{ error: 'Unauthorized' \}\); return; \}/);
    const logCall = gate.indexOf("if (access !== 'allow') logUnauthenticated(req.method, url.pathname, { rejected: access === 'reject' });");
    assert.ok(logCall >= 0 && logCall < gate.indexOf("if (access === 'reject')"), '거절하기 전에 기록한다(처리·거절 모두)');
    assert.match(src, /import \{[^}]*\bdecideWatcherRequest\b[^}]*\} from '\.\.\/server\/watcherAuth\.js';/);
  });

  test('키가 없거나 틀린 요청은 줄인 기록으로 남기고, 시작할 때마다 모드를 남긴다(기록 모드를 잊고 두거나 키가 안 읽혔으면 보이게)', () => {
    assert.doesNotMatch(handler, /console\.warn\(`\[watcher-auth\]/, '요청마다 바로 쓰는 기록이 남아 있으면 안 된다');
    const listen = src.slice(src.indexOf('server.listen('));
    assert.match(listen, /console\.log\(watcherAuthStartupMessage\(\)\);/);
    for (const route of ['/api/monitoring/event', '/api/monitoring/state', '/api/monitoring/config', '/api/properties', '/api/camera/snapshot']) {
      assert.ok(src.includes(`url.pathname === '${route}'`), route);
      assert.match(src.slice(0, src.indexOf('http.createServer(')), new RegExp(`'${route.replaceAll('/', '\\/')}'`), `기록의 아는 경로 목록에 ${route}`);
    }
  });

  test('경로 확인을 건너뛰는 별도 입구가 없다(OPTIONS 만 앞에서 빈 응답)', () => {
    const beforeCheck = handler.slice(0, handler.indexOf('decideWatcherRequest(req.headers)'));
    assert.equal((beforeCheck.match(/sendJson\(res, /g) ?? []).length, 1);
    assert.match(beforeCheck, /if \(req\.method === 'OPTIONS'\) \{ sendJson\(res, 204, \{\}\); return; \}/);
    assert.doesNotMatch(beforeCheck, /handleMonitoringEventRequest|getMonitoringState|loadProperties|saveProperties|setMonitoringConfig|setRoomState|getHaToken/);
  });
});
