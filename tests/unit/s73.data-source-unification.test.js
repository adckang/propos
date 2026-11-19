/**
 * s73 — Pi/로컬/Vercel 데이터 경계 (2026-10-12): 예약·청소 일정의 정본은 Postgres 하나다.
 *   - Pi(집의 워처)는 숙소마다 "어느 워처·어느 기기"라는 메타데이터만 파일로 들고, 예약·iCal·청소 일정은 들지 않는다.
 *   - Pi가 꺼져 있어도 Vercel의 숙소 메타데이터 API는 빈 목록으로 답해 DB 화면을 실패시키지 않는다.
 *   - 로컬 Vite는 같은 운영 API로 중계한다(자기 DB·토큰·워처 없음).
 *
 * ACT-08 ⑦-4: 예전엔 소스 파일 글자만 검사했다. 이제 실제 코드를 실행한다.
 *   - 실제 Pi 워처 서버(scripts/occupancy-watcher-standalone.mjs)를 그대로 묶어 실행 — 감시 프로그램(집 HA 연결)과
 *     HTTP 소켓만 가짜, 숙소 저장소·공유키 검사는 실제 코드, 저장 폴더는 임시 폴더
 *   - 실제 /api/properties 핸들러를 워처 주소 없이 실행
 *   - 로컬 Vite 중계는 s100이 실제 설정·실제 Vite 서버로 확인한다(운영 API 중계, 로컬 워처 없음, 운영 API가 죽어도
 *     로컬이 대신 처리하지 않음) — 여기서 다시 쓰지 않는다.
 */

import '../helpers/isolateDataDir.js'; // 반드시 먼저 — 숙소 저장소가 실제 data/ 대신 임시 폴더를 쓰게

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { WATCHER_SECRET_HEADER } from '../../server/watcherAuth.js';
import { LOG_METHODS } from '../../server/logTimestamps.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const PI_KEY = 'fixture-pi-secret';
const PROPERTIES_FILE = join(TEST_DATA_DIR, 'properties-config.json');

// 화면이 보내는 모양에 예약·iCal·청소 칸이 섞여 와도 Pi에는 메타데이터만 남아야 한다
const INCOMING = [{
  id: '파주201', name: '파주201', district: ' 파주 ', watcherId: 'watcher1',
  devices: { light: 'light.rgbcct_8002' }, optimization: { targetTemp: 24 },
  airbnbIcalUrl: 'https://fixture.invalid/ical.ics', ical_url: 'https://fixture.invalid/ical.ics',
  reservations: [{ checkIn: '2026-11-20T06:00:00Z', checkOut: '2026-11-23T02:00:00Z' }],
  cleaning_jobs: [{ id: 'job' }], checkOutHour: 11, hostPhone: '010-0000-0000',
}, null, { name: '' }, 'not-an-object'];
const STORED = [{ id: '파주201', name: '파주201', district: '파주', watcherId: 'watcher1',
  devices: { light: 'light.rgbcct_8002' }, optimization: { targetTemp: 24 } }];

describe('actual Pi watcher server keeps watcher metadata only', () => {
  const key = '__piWatcherFixture_' + randomUUID().replaceAll('-', '');
  const io = { handler: null, started: 0, fetches: [] };
  let savedFetch, savedKey, savedConsole;

  before(async () => {
    globalThis[key] = io;
    savedFetch = globalThis.fetch; savedKey = process.env.PROPOS_PI_SECRET;
    // 워처가 console 메서드를 시각 붙이는 함수로 감싸므로(RF-30) 다섯 개 모두 돌려놓는다
    savedConsole = Object.fromEntries(LOG_METHODS.map(m => [m, console[m]]));
    globalThis.fetch = async (url) => { io.fetches.push(String(url)); throw new Error('Pi watcher fixture: network blocked'); };
    process.env.PROPOS_PI_SECRET = PI_KEY;
    console.log = () => {};
    const g = `globalThis[${JSON.stringify(key)}]`;
    const stubs = {
      'node:http': `export default { createServer(fn) { ${g}.handler = fn; return { listen(_port, cb) { cb?.(); }, close() {} }; } };`,
      '../server/occupancyWatcher.js': `export const startWatcher = () => { ${g}.started++; };
        export const stopWatcher = () => {}; export const shutdownPreparation = async () => {};
        export const getMonitoringState = () => ({}); export const setMonitoringConfig = () => {}; export const setRoomState = () => {};`,
      '../server/haProxy.js': `export const getHaBaseUrl = () => { throw new Error('no HA in fixture'); }; export const getHaToken = getHaBaseUrl;`,
      '../server/monitoringEventHandler.js': `export async function handleMonitoringEventRequest() { throw new Error('not in this test'); }`,
    };
    const entry = fileURLToPath(new URL('../../scripts/occupancy-watcher-standalone.mjs', import.meta.url));
    const bundle = await build({
      entryPoints: [entry],
      bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
      // 묶은 코드는 data: 주소로 불러오므로 모듈 위치를 실제 파일 주소로 고정한다(저장 폴더는 PROPOS_DATA_DIR = 임시 폴더)
      define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) },
      plugins: [{ name: 'pi-watcher-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'pi-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'pi-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${key}`).toString('base64'));
  });
  after(() => {
    globalThis.fetch = savedFetch; Object.assign(console, savedConsole);
    if (savedKey === undefined) delete process.env.PROPOS_PI_SECRET; else process.env.PROPOS_PI_SECRET = savedKey;
    delete globalThis[key];
  });

  async function request(method, url, body, { withKey = true } = {}) {
    const content = body === undefined ? '' : JSON.stringify(body);
    const req = { method, url, headers: withKey ? { [WATCHER_SECRET_HEADER]: PI_KEY } : {},
      async *[Symbol.asyncIterator]() { if (content) yield Buffer.from(content); } };
    const res = { status: 0, body: '', writeHead(status) { this.status = status; }, end(chunk = '') { this.body = String(chunk); } };
    await io.handler(req, res);
    return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
  }

  test('saving through the Pi drops reservation, iCal and cleaning fields; reading back returns only metadata', async () => {
    assert.deepEqual(await request('PUT', '/api/properties', INCOMING), { status: 200, body: { ok: true } });
    assert.deepEqual((await request('GET', '/api/properties')).body, STORED);
    assert.deepEqual(JSON.parse(readFileSync(PROPERTIES_FILE, 'utf8')), STORED, 'the file on the Pi holds no reservation data either');
  });

  test('an old Pi file that still carries reservation data is read back as metadata only', async () => {
    writeFileSync(PROPERTIES_FILE, JSON.stringify(INCOMING));
    assert.deepEqual((await request('GET', '/api/properties')).body, STORED);
    writeFileSync(PROPERTIES_FILE, '{"not":"a list"}');
    assert.deepEqual((await request('GET', '/api/properties')).body, []);
  });

  test('without the shared key the properties endpoint is refused and nothing is saved (RF-21)', async () => {
    writeFileSync(PROPERTIES_FILE, JSON.stringify(STORED));
    assert.equal((await request('PUT', '/api/properties', [{ id: 'X', name: 'X' }], { withKey: false })).status, 401);
    assert.equal((await request('GET', '/api/properties', undefined, { withKey: false })).status, 401);
    assert.deepEqual(JSON.parse(readFileSync(PROPERTIES_FILE, 'utf8')), STORED);
  });

  test('starting the Pi server only starts the watcher; it makes no outbound request (no iCal or reservation sync of its own)', () => {
    assert.equal(io.started, 1);
    assert.deepEqual(io.fetches, []);
  });
});

describe('actual /api/properties when the Pi address is not configured', () => {
  const ENV = { PROPOS_AUTH_MODE: 'enforce', PROPOS_ADMIN_PASSWORD: 'fixture-admin-password',
    PROPOS_SESSION_SECRET: 'fixture-session-secret-not-a-real-key', PROPOS_WATCHER_URL: undefined, PROPOS_WATCHER_URLS: undefined,
    PROPOS_DATA_PROFILE: 'hybrid' };
  let saved, savedFetch, fetches;
  before(() => {
    saved = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    savedFetch = globalThis.fetch; fetches = [];
    globalThis.fetch = async (url) => { fetches.push(String(url)); throw new Error('network blocked'); };
  });
  after(() => {
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  async function call(method, body) {
    const { default: handler } = await import('../../api/properties.js');
    const content = body === undefined ? '' : JSON.stringify(body);
    const req = { method, url: '/api/properties', query: {},
      headers: { cookie: 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' }) },
      async *[Symbol.asyncIterator]() { if (content) yield Buffer.from(content); } };
    const res = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(chunk = '') { this.body = String(chunk); } };
    await handler(req, res);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  test('GET answers an empty list (200) so screens that read the DB keep working; no request goes out', async () => {
    assert.deepEqual(await call('GET'), { status: 200, body: [] });
    assert.deepEqual(fetches, []);
  });

  test('PUT is refused with 503 instead of pretending to save', async () => {
    assert.deepEqual(await call('PUT', STORED), { status: 503, body: { error: 'PROPOS_WATCHER_URL not configured' } });
    assert.deepEqual(fetches, []);
  });
});
