import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import makeConfig from '../../vite.config.mjs';

function config(profile = 'hybrid') {
  const before = process.env.PROPOS_DATA_PROFILE;
  process.env.PROPOS_DATA_PROFILE = profile;
  try { return makeConfig({ mode: 'development' }); }
  finally {
    if (before === undefined) delete process.env.PROPOS_DATA_PROFILE;
    else process.env.PROPOS_DATA_PROFILE = before;
  }
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const close = server => new Promise(resolve => server.close(resolve));

test('local dev and preview use the same production API for every non-DEMO profile', () => {
  for (const profile of ['hybrid', 'real']) {
    const cfg = config(profile);
    assert.equal(cfg.server.proxy?.['/api']?.target, 'https://www.proposonline.com');
    assert.deepEqual(cfg.preview.proxy, cfg.server.proxy);
    assert.equal(cfg.server.proxy['/api'].changeOrigin, true);
  }
  assert.equal(config('demo').server.proxy, undefined, 'explicit fixtures cannot access production');
});

test('explicit DEMO middleware serves fixtures and rejects device operations without any network', async () => {
  const before = process.env.PROPOS_DATA_PROFILE;
  const previousFetch = global.fetch;
  process.env.PROPOS_DATA_PROFILE = 'demo';
  global.fetch = async () => { throw new Error('DEMO must not use network'); };
  try {
    const cfg = makeConfig({ mode: 'development' });
    let middleware;
    cfg.plugins.find(plugin => plugin.name === 'api-proxy-middleware')
      .configureServer({ middlewares: { use: fn => { middleware = fn; } } });
    async function request(url, method = 'GET') {
      const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
      await middleware({ url, method }, res, () => { throw new Error('fixture API fell through'); });
      return res;
    }
    assert.equal((await request('/api/stats?period=now')).body.dataProfile, 'demo');
    assert.equal((await request('/api/properties')).statusCode, 200);
    for (const path of ['/api/ha/service', '/api/monitoring/event?watcherId=watcher1', '/api/cleaning/ical-sync']) {
      assert.equal((await request(path, 'POST')).statusCode, 403);
    }
  } finally {
    global.fetch = previousFetch;
    if (before === undefined) delete process.env.PROPOS_DATA_PROFILE;
    else process.env.PROPOS_DATA_PROFILE = before;
  }
});

test('actual Vite middleware forwards query, auth cookies, status and write body without a local watcher', async () => {
  const cfg = config();
  assert.ok(cfg.server.proxy?.['/api'], 'must not start the old local watcher while reproducing this failure');
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/login') res.setHeader('Set-Cookie', 'propos_session=fixture-session; Path=/; HttpOnly; Secure; SameSite=Strict');
    if (!req.headers.cookie && req.url.startsWith('/api/monitoring/')) res.statusCode = 401;
    res.end(JSON.stringify({ backend: 'shared-production-fixture' }));
  });
  const target = await listen(upstream);
  const root = mkdtempSync(join(tmpdir(), 'propos-shared-ui-'));
  let vite, front;
  try {
    vite = await createServer({ ...cfg, configFile: false, root, cacheDir: join(root, 'cache'), logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...cfg.server, middlewareMode: true, hmr: false, proxy: { '/api': { ...cfg.server.proxy['/api'], target } } } });
    front = http.createServer(vite.middlewares);
    const base = await listen(front);
    const cookie = 'propos_session=fixture-session';
    for (const path of ['/api/monitoring/state', '/api/monitoring/state?watcherId=watcher1', '/api/properties', '/api/cleaning/properties', '/api/stats?period=now', '/api/auth/me']) {
      const response = await fetch(`${base}${path}`, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).backend, 'shared-production-fixture');
      assert.equal(seen.at(-1).url, path);
      assert.equal(seen.at(-1).cookie, cookie);
    }
    assert.equal((await fetch(`${base}/api/monitoring/state?watcherId=watcher1`)).status, 401);
    const body = JSON.stringify({ type: 'cleaning_finished', propertyId: 'fixture-property' });
    await fetch(`${base}/api/monitoring/event?watcherId=watcher1`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body });
    assert.equal(seen.at(-1).body, body);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST' });
    assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    await close(upstream);
    assert.ok((await fetch(`${base}/api/monitoring/state?watcherId=watcher1`)).status >= 500, 'no local takeover when shared API is unavailable');
  } finally {
    if (front) await close(front);
    if (vite) await vite.close();
    if (upstream.listening) await close(upstream);
    rmSync(root, { recursive: true, force: true });
  }
});
