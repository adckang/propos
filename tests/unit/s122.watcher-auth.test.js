// RF-21(2026-11-14): 집 Pi 워처가 로그인 없이 외부에서 열려 있었다. 서버(Vercel)는 워처를 부를 때 기존 공유키를 붙이고,
// 워처는 키가 맞는 요청만 처리한다(기록 모드 관찰 → 2026-11-16 기본값 차단). 실제 확인 함수와 실제 워처 서버를 검증한다.
import '../helpers/isolateDataDir.js'; // 반드시 먼저(s50) — 워처 서버를 묶을 때 감시 프로그램·숙소 저장소는 가짜로 바꾸지만 이름이 나온다

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createUnauthenticatedLogger, decideWatcherRequest, hasWatcherSecret, watcherAuthMode, watcherAuthStartupMessage, WATCHER_SECRET_HEADER } from '../../server/watcherAuth.js';
import { watcherRequestHeaders } from '../../server/auth/watcherScope.js';
import { LOG_METHODS } from '../../server/logTimestamps.js';

const KEY = 'k'.repeat(40);
// 워처 기록은 줄마다 한국 시각으로 시작한다(RF-30, s131). 내용을 비교할 때는 시각을 떼고 본다.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00 /;
const untimed = lines => lines.map(line => line.replace(TIMESTAMP, ''));
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

// 실제 Pi 워처 서버(scripts/occupancy-watcher-standalone.mjs)를 묶어 띄운다 — 키 확인(watcherAuth)은 실제 코드,
// 그 뒤의 기능(감시 프로그램·숙소 파일·이벤트 처리·집 HA)은 불렸는지만 기록하는 가짜, HTTP 소켓은 처리 함수만 받는다.
// 예전엔 이 서버 소스의 글자 순서만 검사했다(ACT-08 후보). 서버마다 기록의 "10분에 한 번" 상태가 따로 있도록 매번 새로 묶는다.
const WATCHER_ENTRY = fileURLToPath(new URL('../../scripts/occupancy-watcher-standalone.mjs', import.meta.url));
const ROUTES = [
  ['POST', '/api/monitoring/event', 'handleMonitoringEventRequest'],
  ['GET', '/api/monitoring/state', 'getMonitoringState'],
  ['POST', '/api/monitoring/config', 'setMonitoringConfig'],
  ['PUT', '/api/monitoring/state', 'setRoomState', { roomState: { mainStatus: 'VACANT' } }],
  ['GET', '/api/properties', 'loadProperties'],
  ['PUT', '/api/properties', 'saveProperties', []],
  ['GET', '/api/camera/snapshot?path=/local/snapshots/fixture.jpg', 'getHaBaseUrl'],
];

async function startActualWatcherServer(env) {
  const key = '__watcherAuthServer_' + randomUUID().replaceAll('-', '');
  const io = { handler: null, calls: [], fetches: [], logs: [], warns: [] };
  // 워처가 console 메서드를 시각 붙이는 함수로 감싸므로 다섯 개 모두 저장했다가 돌려놓는다
  const saved = { fetch: globalThis.fetch, console: Object.fromEntries(LOG_METHODS.map(m => [m, console[m]])),
    env: Object.fromEntries(['PROPOS_PI_SECRET', 'PROPOS_WATCHER_AUTH_MODE'].map(name => [name, process.env[name]])) };
  const setEnv = values => { for (const [name, value] of Object.entries(values)) { if (value == null) delete process.env[name]; else process.env[name] = value; } };
  globalThis[key] = io;
  globalThis.fetch = async url => { io.fetches.push(String(url)); throw new Error('watcher fixture: network blocked'); };
  console.log = (...args) => io.logs.push(args.join(' '));
  console.warn = (...args) => io.warns.push(args.join(' '));
  setEnv(env);
  const g = `globalThis[${JSON.stringify(key)}]`;
  const rec = name => `(...args) => { ${g}.calls.push(${JSON.stringify(name)}); }`;
  const stubs = {
    'node:http': `export default { createServer(fn) { ${g}.handler = fn; return { listen(_port, cb) { cb?.(); }, close() {} }; } };`,
    '../server/occupancyWatcher.js': `export const startWatcher = ${rec('startWatcher')}; export const stopWatcher = () => {};
      export const shutdownPreparation = async () => {};
      export const getMonitoringState = () => { ${g}.calls.push('getMonitoringState'); return {}; };
      export const setMonitoringConfig = ${rec('setMonitoringConfig')}; export const setRoomState = ${rec('setRoomState')};`,
    '../server/propertiesStore.js': `export const loadProperties = () => { ${g}.calls.push('loadProperties'); return []; };
      export const saveProperties = ${rec('saveProperties')};`,
    '../server/haProxy.js': `export const getHaBaseUrl = () => { ${g}.calls.push('getHaBaseUrl'); throw new Error('no HA in fixture'); };
      export const getHaToken = () => { ${g}.calls.push('getHaToken'); throw new Error('no HA in fixture'); };`,
    '../server/monitoringEventHandler.js': `export async function handleMonitoringEventRequest(_req, res) {
      ${g}.calls.push('handleMonitoringEventRequest'); res.writeHead(200); res.end('{}'); }`,
  };
  try {
    const bundle = await build({
      entryPoints: [WATCHER_ENTRY], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
      define: { 'import.meta.url': JSON.stringify(pathToFileURL(WATCHER_ENTRY).href) },
      plugins: [{ name: 'watcher-auth-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'watcher-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'watcher-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${key}`).toString('base64'));
  } finally { console.log = saved.console.log; }

  async function request(method, url, headers = {}, body) {
    const content = body === undefined ? '' : JSON.stringify(body);
    const req = { method, url, headers, async *[Symbol.asyncIterator]() { if (content) yield Buffer.from(content); } };
    const res = { status: 0, body: '', writeHead(status) { this.status = status; }, end(chunk = '') { this.body = String(chunk); } };
    await io.handler(req, res);
    return res;
  }
  return {
    io, request, setEnv,
    stop() {
      globalThis.fetch = saved.fetch; Object.assign(console, saved.console);
      setEnv(saved.env);
      delete globalThis[key];
    },
  };
}

describe('실제 워처 서버 — 키 확인', () => {
  test('키가 없거나 틀리면 모든 경로가 401 이고, 그 뒤의 기능(감시·숙소 파일·이벤트·집 HA)에 하나도 닿지 않는다', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    for (const [method, url, , body] of ROUTES) {
      for (const headers of [{}, withKey('wrong'), withKey(KEY.slice(1))]) {
        const res = await w.request(method, url, headers, body);
        assert.equal(res.status, 401, `${method} ${url}`);
        assert.deepEqual(JSON.parse(res.body), { error: 'Unauthorized' });
      }
    }
    assert.deepEqual(w.io.calls, ['startWatcher'], '시작 외에는 아무 기능도 불리지 않았다');
    assert.deepEqual(w.io.fetches, []);
  });

  test('(대조) 맞는 키는 같은 경로들이 실제 기능까지 간다 — 위 401 이 "무엇이든 실패"가 아님', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    for (const [method, url, reached, body] of ROUTES) {
      w.io.calls.length = 0;
      const res = await w.request(method, url, withKey(), body);
      assert.notEqual(res.status, 401, `${method} ${url}`);
      assert.ok(w.io.calls.includes(reached), `${method} ${url} → ${reached}`);
    }
    assert.equal((await w.request('GET', '/api/unknown', withKey())).status, 404);
  });

  test('확인을 건너뛰는 입구가 없다 — OPTIONS 만 키 없이 빈 응답, 다른 방식·모르는 경로도 키 없으면 401', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    assert.equal((await w.request('OPTIONS', '/api/monitoring/config')).status, 204);
    const paths = [...new Set(ROUTES.map(([, url]) => url)), '/', '/api/unknown', '/api/monitoring/state/', '/API/properties'];
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      for (const url of paths) assert.equal((await w.request(method, url)).status, 401, `${method} ${url}`);
    }
    assert.deepEqual(w.io.calls, ['startWatcher']);
  });

  test('Pi 에 키가 없으면 키를 보내도 전부 401 (설정 실수로 열리지 않게)', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: null, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    for (const [method, url, , body] of ROUTES) assert.equal((await w.request(method, url, withKey(), body)).status, 401, `${method} ${url}`);
    assert.deepEqual(w.io.calls, ['startWatcher']);
  });
});

describe('실제 워처 서버 — 기록', () => {
  test('시작할 때마다 모드를 남긴다 — 차단·기록, 차단인데 키가 없으면 경고', async t => {
    for (const [env, expected] of [
      [{ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null }, '[watcher-auth] 모드: 차단(키 없는 요청 401)'],
      [{ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'log' }, '[watcher-auth] 모드: 기록(키 없는 요청도 처리하고 기록)'],
      [{ PROPOS_PI_SECRET: null, PROPOS_WATCHER_AUTH_MODE: null }, '[watcher-auth] 모드: 차단 — 경고: 공유키(PROPOS_PI_SECRET)가 없어 서버 요청까지 모두 401 로 거절합니다'],
    ]) {
      const w = await startActualWatcherServer(env);
      try { assert.ok(untimed(w.io.logs).includes(expected), `${JSON.stringify(env)}: ${w.io.logs.join(' / ')}`); } finally { w.stop(); }
    }
  });

  test('거절한 요청은 경로별로 10분에 한 번만, "→ 401 거절"과 함께 남긴다 — 모르는 경로는 하나로 묶는다', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    for (let i = 0; i < 3; i++) {
      for (const [method, url] of ROUTES) await w.request(method, url);
      await w.request('GET', '/scanner-probe-' + i);
    }
    const expected = ROUTES.map(([method, url]) => `[watcher-auth] 키가 없거나 틀린 요청 ${method} ${url.split('?')[0]} → 401 거절`);
    expected.push('[watcher-auth] 키가 없거나 틀린 요청 GET (기타 경로) → 401 거절');
    assert.deepEqual(untimed(w.io.warns).sort(), expected.sort());
  });

  test('기록 모드는 키 없는 요청도 처리하되(→ 401 표시 없이) 남긴다', async t => {
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: 'log' });
    t.after(() => w.stop());
    const res = await w.request('GET', '/api/monitoring/state');
    assert.equal(res.status, 200);
    assert.ok(w.io.calls.includes('getMonitoringState'));
    assert.deepEqual(untimed(w.io.warns), ['[watcher-auth] 키가 없거나 틀린 요청 GET /api/monitoring/state']);
  });

  test('워처가 남기는 줄은 시작 기록부터 거절 기록까지 모두 지금 한국 시각으로 시작한다 (RF-30)', async t => {
    const before = Date.now();
    const w = await startActualWatcherServer({ PROPOS_PI_SECRET: KEY, PROPOS_WATCHER_AUTH_MODE: null });
    t.after(() => w.stop());
    await w.request('GET', '/api/monitoring/state');
    const after = Date.now();
    const lines = [...w.io.logs, ...w.io.warns];
    assert.ok(w.io.logs.length >= 2 && w.io.warns.length === 1, lines.join(' / '));
    for (const line of lines) {
      assert.match(line, TIMESTAMP, line);
      const at = new Date(line.slice(0, 29)).getTime();
      assert.ok(at >= before && at <= after, `${line} — 지금 시각이어야 한다`);
    }
  });
});
