// RF-21(2026-11-14): 집 Pi 워처가 로그인 없이 외부에서 열려 있었다. 서버(Vercel)는 워처를 부를 때 기존 공유키를 붙이고,
// 워처는 키가 맞는 요청만 처리한다(기록 모드 → 차단 모드). 실제 확인 함수와 워처 서버 소스의 순서를 검증한다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUnauthenticatedLogger, decideWatcherRequest, hasWatcherSecret, watcherAuthMode, WATCHER_SECRET_HEADER } from '../../server/watcherAuth.js';
import { watcherRequestHeaders } from '../../server/auth/watcherScope.js';

const KEY = 'k'.repeat(40);
const withKey = (value = KEY) => ({ [WATCHER_SECRET_HEADER]: value });

describe('워처가 받는 요청 확인', () => {
  test('서버가 같은 공유키를 붙인 요청은 두 모드 모두 처리한다', () => {
    for (const mode of [undefined, 'log', 'enforce']) {
      assert.equal(decideWatcherRequest(withKey(), { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: mode }), 'allow', String(mode));
    }
  });

  test('키 없는 요청: 기록 모드(기본)는 처리하되 기록, 차단 모드는 거절', () => {
    assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: KEY }), 'log', '기본은 기록 모드 — 모르는 호출자가 갑자기 막히지 않게');
    assert.equal(decideWatcherRequest({}, { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'enforce' }), 'reject');
  });

  test('틀린 키·길이가 다른 키·빈 키는 맞는 키가 아니다(예외 없이)', () => {
    const env = { PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'enforce' };
    for (const value of ['x'.repeat(KEY.length), 'short', '', `${KEY}x`]) {
      assert.equal(decideWatcherRequest(withKey(value), env), 'reject', JSON.stringify(value));
    }
    assert.equal(decideWatcherRequest(withKey(['a', 'b']), env), 'reject', '문자열이 아닌 헤더 값');
  });

  test('차단 모드에서 Pi 에 키가 없으면 키를 보내도 전부 거절한다(설정 실수로 열리지 않게)', () => {
    for (const secret of [undefined, '']) {
      assert.equal(hasWatcherSecret(withKey(''), { PROPOS_PI_SECRET: secret }), false);
      assert.equal(decideWatcherRequest(withKey(), { PROPOS_PI_SECRET: secret, PROPOS_WATCHER_AUTH_MODE: 'enforce' }), 'reject');
    }
  });

  test('차단은 정확히 "enforce" 일 때만 — 나머지 값은 기록 모드', () => {
    for (const value of [undefined, '', 'off', 'ENFORCE', 'log']) assert.equal(watcherAuthMode({ PROPOS_WATCHER_AUTH_MODE: value }), 'log', String(value));
    assert.equal(watcherAuthMode({ PROPOS_WATCHER_AUTH_MODE: 'enforce' }), 'enforce');
  });
});

describe('기록 모드의 키 없는 요청 기록', () => {
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
    assert.deepEqual(lines, ['[watcher-auth] 키 없는 요청 GET /api/properties', '[watcher-auth] 키 없는 요청 PUT /api/properties', '[watcher-auth] 키 없는 요청 GET (기타 경로)']);
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
    assert.match(handler.slice(check, firstRoute), /if \(access === 'reject'\) \{ sendJson\(res, 401, \{ error: 'Unauthorized' \}\); return; \}/);
    assert.match(src, /import \{[^}]*\bdecideWatcherRequest\b[^}]*\} from '\.\.\/server\/watcherAuth\.js';/);
  });

  test('키 없는 요청은 줄인 기록으로 남기고, 시작할 때마다 모드를 남긴다(설정이 빠져 기록 모드로 돌아가면 보이게)', () => {
    assert.match(handler, /if \(access === 'log'\) logUnauthenticated\(req\.method, url\.pathname\);/);
    assert.doesNotMatch(handler, /console\.warn\(`\[watcher-auth\]/, '요청마다 바로 쓰는 기록이 남아 있으면 안 된다');
    const listen = src.slice(src.indexOf('server.listen('));
    assert.match(listen, /watcherAuthMode\(\) === 'enforce'/);
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
