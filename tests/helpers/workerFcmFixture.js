// Loads actual mobile TypeScript/API code. Only SDK, storage, HTTP, Pool and
// Slack are replaced; no token rotation business logic is copied here.
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
export const TOKEN_KEY = '@propos/fcm_token';
export const PENDING_KEY = '@propos/fcm_token_pending';
export const WORKER_ID = '11111111-1111-4111-8111-111111111111';
export const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

export async function workerFcmFixture({ stored = 'fixture-old', token = 'fixture-new', storage, answer, db, storageFailure } = {}) {
  const saved = { fetch: globalThis.fetch, profile: process.env.PROPOS_DATA_PROFILE };
  const key = '__workerFcmFixture_' + randomUUID().replaceAll('-', '');
  const values = storage ?? new Map(stored ? [[TOKEN_KEY, stored]] : []);
  const listeners = new Set(), calls = [], writes = [];
  const io = {
    db, permission: 1, token,
    storage: {
      async getItem(k) { return values.get(k) ?? null; },
      async setItem(k, v) { storageFailure?.('set', k, v); writes.push({ key: k, value: v }); values.set(k, v); },
      async removeItem(k) { storageFailure?.('remove', k); writes.push({ key: k }); values.delete(k); },
    },
    sdk: {
      async requestPermission() { return io.permission; }, async getToken() { return io.token; },
      onTokenRefresh(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      onMessage() { return () => {}; }, async getInitialNotification() { return null; },
    },
  };
  globalThis[key] = io;
  process.env.PROPOS_DATA_PROFILE = 'hybrid';
  const stubs = {
    '@react-native-firebase/messaging': `const m=()=>globalThis[${JSON.stringify(key)}].sdk; m.AuthorizationStatus={AUTHORIZED:1,PROVISIONAL:2}; export default m;`,
    '@react-native-async-storage/async-storage': `export default globalThis[${JSON.stringify(key)}].storage;`,
    pg: `export class Pool { constructor(){return globalThis[${JSON.stringify(key)}].db;} }`,
    '../../server/cleaning/_dispatch.js': 'export const postSlack=async()=>{throw new Error("Unexpected Slack request blocked");};',
  };
  async function load(relative) {
    const bundle = await build({ entryPoints: [resolve(root, relative)], bundle: true, write: false, platform: 'node', format: 'esm',
      logLevel: 'silent', plugins: [{ name: 'worker-fixture-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }] });
    return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${randomUUID()}`).toString('base64'));
  }
  let server;
  async function invoke(method, body, headers = {}, { rawBody } = {}) {
    server ??= (await load('api/workers/[...slug].js')).default;
    const req = { method, query: { slug: 'token' }, url: '/api/workers/token', headers,
      async *[Symbol.asyncIterator]() {
        if (rawBody !== undefined) yield Buffer.from(rawBody);
        else if (body) yield Buffer.from(JSON.stringify(body));
      } };
    const res = { code: 200, body: null, headers: {}, status(n) { this.code = n; return this; },
      json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await server(req, res); return res;
  }
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) !== 'https://www.proposonline.com/api/workers/token') throw new Error('Unexpected external request blocked');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { method: options.method ?? 'GET', body, headers: options.headers ?? {}, signal: options.signal };
    calls.push(call);
    if (answer) return answer(call, calls.length);
    if (db) {
      const headers = Object.fromEntries(Object.entries(call.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const res = await invoke(call.method, body, headers); return response(res.code, res.body);
    }
    return response(200, call.method === 'GET' ? { ok: true, worker_id: WORKER_ID } : { ok: true });
  };
  return { values, calls, writes, io, invoke, loadApi: () => load('worker-app/src/services/api.ts'),
    loadClient: () => load('worker-app/src/services/fcm.ts'),
    async emitToken(value) { io.token = value; return Promise.all([...listeners].map(fn => fn(value))); },
    restore() {
      globalThis.fetch = saved.fetch; delete globalThis[key];
      if (saved.profile === undefined) delete process.env.PROPOS_DATA_PROFILE; else process.env.PROPOS_DATA_PROFILE = saved.profile;
    } };
}
