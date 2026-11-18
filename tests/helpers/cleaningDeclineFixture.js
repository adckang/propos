// ACT-08: execute the complete cleaning API handler. Only DB, delivery
// boundaries and external I/O are replaced; no business policy is copied here.
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url).pathname;
export async function cleaningDeclineFixture({ responses = [], advance, slack, notify, profile = 'hybrid', calendar, environment = {} } = {}) {
  const key = '__declineFixture_' + randomUUID().replaceAll('-', '');
  const pending = [...responses];
  const queries = [], advances = [], slackCalls = [], blocked = [], errors = [], unexpectedQueries = [];
  const tokenCalls = [], calendarRequests = [], completionCalls = [], kvCalls = [], notifyCalls = [];
  const previousFetch = globalThis.fetch;
  const env = { PROPOS_DATA_PROFILE: profile, PROPOS_AUTH_MODE: 'enforce',
    PROPOS_ADMIN_PASSWORD: 'fixture-admin-password', PROPOS_SESSION_SECRET: 'fixture-session-secret-not-a-real-key',
    ...(calendar && { GOOGLE_WEBHOOK_SECRET: calendar.secret ?? 'fixture-webhook-secret' }), ...environment };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  const fail = (kind) => { blocked.push(kind); throw new Error(`Unexpected external I/O blocked: ${kind}`); };
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (!pending.length) { unexpectedQueries.push({ sql, params }); throw new Error('Unexpected DB query in decline fixture'); }
    const next = pending.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(sql, params) : { rows: next };
  } };
  const io = { db, fail,
    async advance(...args) { advances.push(args); return advance?.(...args); },
    async slack(...args) { slackCalls.push(args); return slack ? slack(...args) : true; },
    async googleToken(...args) { tokenCalls.push(args); return calendar.getToken ? calendar.getToken(...args) : 'fixture-google-token'; },
    async gmailToken(...args) { tokenCalls.push(args); return calendar.getGmailToken ? calendar.getGmailToken(...args) : 'fixture-gmail-token'; },
    async complete(...args) { completionCalls.push(args); return calendar.complete?.(...args); },
    async notify(...args) { notifyCalls.push(args); return notify(...args); },
    kv: new Proxy({}, { get: (_target, name) => async (...args) => {
      if (calendar?.kv?.[name]) {
        kvCalls.push({ method: name, args });
        return calendar.kv[name](...args);
      }
      return fail(`KV:${String(name)}`);
    } }),
  };
  globalThis[key] = io;
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options = {}) => {
    let target;
    try { target = new URL(url); } catch { return fail('HTTP'); }
    const method = options.method ?? 'GET';
    const allowedCalendarPath = target.hostname === 'www.googleapis.com' && (method === 'DELETE'
      ? /^\/calendar\/v3\/calendars\/.+\/events\/[^/]+$/.test(target.pathname)
      : /^\/calendar\/v3\/calendars\/.+\/events$/.test(target.pathname));
    const allowedGmailPath = target.hostname === 'gmail.googleapis.com'
      && target.pathname === '/gmail/v1/users/me/watch' && method === 'POST';
    if (!calendar?.fetch || target.protocol !== 'https:' || (!allowedCalendarPath && !allowedGmailPath)
      || !(calendar.methods ?? ['GET']).includes(method)) return fail('HTTP');
    calendarRequests.push({ url: String(url), options });
    return calendar.fetch(url, options);
  };
  function restore() {
    globalThis.fetch = previousFetch; delete globalThis[key];
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  const stubs = {
    pg: `export class Pool {constructor(){return globalThis.${key}.db;}} export default {Pool};`,
    '@vercel/kv': `export const kv=globalThis.${key}.kv;`,
    '../../server/cleaning/_dispatch.js': `export * from ${JSON.stringify(pathToFileURL(resolve(root, 'server/cleaning/_dispatch.js')).href)};
      export const advanceJob=(...args)=>globalThis.${key}.advance(...args);
      export const postSlack=(...args)=>globalThis.${key}.slack(...args);
      ${calendar ? `export const sendCompletionSmsToRest=(...args)=>globalThis.${key}.complete(...args);` : ''}`,
    ...(calendar && { '../../server/cleaning/_calendar.js': `export * from ${JSON.stringify(pathToFileURL(resolve(root, 'server/cleaning/_calendar.js')).href)};
      export const getGoogleToken=(...args)=>globalThis.${key}.googleToken(...args);
      export const getGmailToken=(...args)=>globalThis.${key}.gmailToken(...args);` }),
    ...(notify && { '../../server/cleaning/_notify.js': `export const notify=(...args)=>globalThis.${key}.notify(...args);` }),
    'firebase-admin/app': `export const getApps=()=>[{}]; export const cert=()=>globalThis.${key}.fail('FCM'); export const initializeApp=()=>globalThis.${key}.fail('FCM');`,
    'firebase-admin/messaging': `export const getMessaging=()=>globalThis.${key}.fail('FCM');`,
  };
  try {
    const bundle = await build({ entryPoints: [resolve(root, 'api/cleaning/[...slug].js')], bundle: true,
      write: false, platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{ name: 'decline-fixture-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => {
          if (Object.hasOwn(stubs, args.path)) return { path: args.path, namespace: 'decline-io' };
          if (args.path.startsWith('file:')) return { path: new URL(args.path).pathname };
        });
        b.onLoad({ filter: /.*/, namespace: 'decline-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + `\n// ${key}`).toString('base64'));
    async function invoke({ method = 'GET', url = '/api/cleaning/d?token=ABC123&format=api', query, headers = {}, body, rawBody } = {}) {
      const parsed = query ?? [...new URLSearchParams(url.split('?')[1] ?? '')].reduce((acc, [k, v]) => {
        acc[k] = k in acc ? [].concat(acc[k], v) : v; return acc;
      }, {});
      const req = { method, url, query: parsed, headers,
        async *[Symbol.asyncIterator]() {
          const content = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
          if (content) yield Buffer.from(content);
        },
      };
      const res = { code: null, body: undefined, kind: null, headers: {},
        status(n) { this.code = n; return this; },
        json(value) { this.body = value; this.kind = 'json'; return this; },
        send(value) { this.body = value; this.kind = 'html'; return this; },
        redirect(code, location) { this.code = code; this.headers.location = location; this.kind = 'redirect'; return this; },
        end(value) {
          if (this.statusCode !== undefined) this.code = this.statusCode;
          if (value !== undefined && this.headers['content-type']?.includes('application/json')) {
            this.body = JSON.parse(value); this.kind = 'json';
          } else { this.body = value; this.kind = 'empty'; }
          return this;
        },
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      };
      const previousError = console.error;
      console.error = (...args) => errors.push(args);
      try { await handler(req, res); } finally { console.error = previousError; }
      return res;
    }
    return { invoke, db, queries, advances, slackCalls, blocked, errors, unexpectedQueries,
      tokenCalls, calendarRequests, completionCalls, kvCalls, notifyCalls, kv: io.kv,
      get pendingResponses() { return pending.length; }, restore };
  } catch (error) { restore(); throw error; }
}
