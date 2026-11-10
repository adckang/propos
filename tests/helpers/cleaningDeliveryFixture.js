import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = new URL('../../', import.meta.url).pathname;
const modules = new Map();
export async function actualCleaningModule(name) {
  if (!modules.has(name)) modules.set(name, (async () => {
    const stubs = {
      'firebase-admin/app': 'export const getApps=()=>[{}]; export const cert=()=>({}); export const initializeApp=()=>({});',
      'firebase-admin/messaging': 'export const getMessaging=()=>({send:(m)=>globalThis.__cleaningDeliveryIO.push(m)});',
      './_slack.js': 'export const postSlack=(...a)=>globalThis.__cleaningDeliveryIO.slack(...a);',
    };
    const result = await build({ entryPoints: [resolve(root, name)], bundle: true, write: false,
      platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'fixture-io', setup(b) {
        b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture-io' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  })());
  return modules.get(name);
}

export function installDeliveryIO({ sms, push } = {}) {
  const previous = { fetch: globalThis.fetch, io: globalThis.__cleaningDeliveryIO,
    id: process.env.PROPOS_SMS_GW_ID, pwd: process.env.PROPOS_SMS_GW_PWD };
  const calls = { sms: [], push: [], slack: [] };
  process.env.PROPOS_SMS_GW_ID = 'fixture'; process.env.PROPOS_SMS_GW_PWD = 'fixture';
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.sms-gate.app/3rdparty/v1/message') throw new Error('Unexpected external request blocked');
    calls.sms.push({ body: JSON.parse(options.body), signal: options.signal });
    return sms ? sms(calls.sms.length, options) : { ok: true, status: 200, json: async () => ({ id: 'fixture-provider-id' }) };
  };
  globalThis.__cleaningDeliveryIO = {
    push: async message => { calls.push.push(message); return push ? push(message) : 'projects/fixture/messages/message-id'; },
    slack: async (...args) => { calls.slack.push(args); },
  };
  return { calls, restore() {
    globalThis.fetch = previous.fetch; globalThis.__cleaningDeliveryIO = previous.io;
    for (const [key, value] of [['PROPOS_SMS_GW_ID', previous.id], ['PROPOS_SMS_GW_PWD', previous.pwd]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  } };
}

export async function createCleaningSqlFixture({ propertyOrigin = 'REAL', jobOrigin = 'REAL', fcm = false } = {}) {
  // Explicit loopback-only test database or an optional isolated WASM engine.
  // Never reads POSTGRES_URL or the application's environment files.
  let engine, pool;
  if (process.env.CLEANING_TEST_DATABASE_URL) {
    const target = new URL(process.env.CLEANING_TEST_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1' || target.pathname !== '/propos_delivery_test') {
      throw new Error('Only the isolated loopback propos_delivery_test database is allowed');
    }
    const admin = new pg.Client({ connectionString: target.href });
    await admin.connect();
    const schema = 'delivery_test_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const native = new pg.Pool({ connectionString: target.href, max: 6, options: `-c search_path=${schema},public` });
    // Keep fault injection on this promise interface; pg.Pool.query internally
    // uses its own callback-style connect, which must remain untouched.
    pool = { query: native.query.bind(native), connect: native.connect.bind(native) };
    engine = { exec: sql => pool.query(sql), async close() {
      await native.end();
      try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
    } };
  } else {
    const entry = resolve(process.env.PGLITE_TEST_ROOT, 'node_modules/@electric-sql/pglite/dist/index.js');
    const { PGlite } = await import(pathToFileURL(entry));
    engine = await PGlite.create();
    let tail = Promise.resolve();
    async function acquire() {
      const before = tail; let release; tail = new Promise(r => { release = r; }); await before; return release;
    }
    const execute = async (sql, params) => {
      const result = await engine.query(sql, params);
      return { rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
    };
    pool = {
      async query(sql, params) { const release = await acquire(); try { return await execute(sql, params); } finally { release(); } },
      async connect() { const release = await acquire(); return { query: execute, release }; },
    };
  }
  try {
  await engine.exec(await readFile(new URL('../../data/schema-cleaning.sql', import.meta.url), 'utf8'));
  await engine.exec(await readFile(new URL('../../data/migrate-cleaning-v2.sql', import.meta.url), 'utf8'));
  await engine.exec(await readFile(new URL('../../data/migrate-cleaning-initial-delivery.sql', import.meta.url), 'utf8'));
  const jobId = randomUUID(), cleanerId = randomUUID();
  await pool.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin) VALUES('fixture-property','Fixture Property',$1)`, [propertyOrigin]);
  await pool.query(`INSERT INTO cleaners(id,name,phone,email,tier,active,fcm_status,fcm_token)
    VALUES($1,'Fixture Cleaner','01000000000','fixture@example.invalid','VIP_1',true,$2,$3)`,
  [cleanerId, fcm ? 'active' : 'uninstalled', fcm ? 'fixture-token' : null]);
  await pool.query(`INSERT INTO cleaning_jobs(id,property_id,checkout_at,cleaning_start_at,source,data_origin)
    VALUES($1,'fixture-property','2026-11-10T02:00:00Z','2026-11-10T02:00:00Z','SHORT_NOTICE',$2)`, [jobId, jobOrigin]);
  const currentJob = async () => (await pool.query('SELECT * FROM cleaning_jobs WHERE id=$1', [jobId])).rows[0];
  return { pool, engine, jobId, cleanerId, currentJob,
    notifications: async () => (await pool.query('SELECT * FROM cleaning_notifs WHERE job_id=$1', [jobId])).rows,
    close: () => engine.close() };
  } catch (error) { await engine.close(); throw error; }
}
