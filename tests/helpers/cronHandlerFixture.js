import { build } from 'esbuild';
import { resolve } from 'node:path';
import { toKstDateKey } from '../../server/cleaning/_dispatch.js';

const root = new URL('../../', import.meta.url).pathname;
let modulePromise;

export async function actualCronModule() {
  if (!modulePromise) modulePromise = (async () => {
    const stubs = {
      pg: `export class Pool { constructor() { return globalThis.__cronHandlerIO.pool(); } } export default { Pool };`,
      '@vercel/kv': `export const kv = new Proxy({}, { get: (_, key) => (...args) => globalThis.__cronHandlerIO.invoke('kv.' + String(key), args) });`,
      '../../server/cleaning/_dispatch.js': `
        const call = (name, args) => globalThis.__cronHandlerIO.invoke(name, args);
        export const advanceJob = (...args) => call('advanceJob', args);
        export const getVipFollowupJobs = (...args) => call('getVipFollowupJobs', args);
        export const recoverInitialDeliveries = (...args) => call('recoverInitialDeliveries', args);
        export const buildSmsRemind = (...args) => call('buildSmsRemind', args);
        export const calcCleaningTimes = (...args) => call('calcCleaningTimes', args);
        export const planJobDispatch = (...args) => call('planJobDispatch', args);
        export const toKstDateKey = (...args) => call('toKstDateKey', args);
        export const postSlack = (...args) => call('postSlack', args);
        export const getPropertyConfig = (...args) => call('getPropertyConfig', args);`,
      '../../server/cleaning/_notify.js': `export const notify = (...args) => globalThis.__cronHandlerIO.invoke('notify', args);`,
      '../../server/cleaning/_icalSync.js': `export const syncAllPropertiesIcal = (...args) => globalThis.__cronHandlerIO.invoke('syncAllPropertiesIcal', args);`,
      '../../server/watcherReservationSync.js': `export const pushCurrentReservationsToWatchers = (...args) => globalThis.__cronHandlerIO.invoke('pushCurrentReservationsToWatchers', args);`,
      '../../server/cleaning/_reservationSync.js': `
        export const isCheckoutCancelled = (...args) => globalThis.__cronHandlerIO.invoke('isCheckoutCancelled', args);
        export const reservationUidOf = (...args) => globalThis.__cronHandlerIO.invoke('reservationUidOf', args);`,
      '../../server/cleaning/_calendar.js': `
        const call = (name, args) => globalThis.__cronHandlerIO.invoke(name, args);
        export const getGoogleToken = (...args) => call('getGoogleToken', args);
        export const getGmailToken = (...args) => call('getGmailToken', args);
        export const createBlockerEvent = (...args) => call('createBlockerEvent', args);
        export const getNextMonthDates = (...args) => call('getNextMonthDates', args);
        export const openCleaningSlot = (...args) => call('openCleaningSlot', args);
        export const requestedCleaningDays = (...args) => call('requestedCleaningDays', args);
        export const saveCalendarWatchExpiration = (...args) => call('saveCalendarWatchExpiration', args);`,
      '../../server/cleaning/_problems.js': `export const recordUnassignedAtStart = (...args) => globalThis.__cronHandlerIO.invoke('recordUnassignedAtStart', args);`,
      '../../src/application/reportingService.js': `export const getStatsForPeriod = (...args) => globalThis.__cronHandlerIO.invoke('getStatsForPeriod', args);`,
      '../../src/domain/reportingDomain.js': `export const countPeriodEvents = (...args) => globalThis.__cronHandlerIO.invoke('countPeriodEvents', args);`,
      '../../src/infrastructure/eventRepository.js': `export const queryEvents = (...args) => globalThis.__cronHandlerIO.invoke('queryEvents', args);`,
      '../../server/cleaning/_tokenHealth.js': `
        const call = (name, args) => globalThis.__cronHandlerIO.invoke(name, args);
        export const reportTokenFailure = (...args) => call('reportTokenFailure', args);
        export const reportTokenSuccess = (...args) => call('reportTokenSuccess', args);
        export const markRenewed = (...args) => call('markRenewed', args);
        export const checkStaleness = (...args) => call('checkStaleness', args);
        export const isRenewalDue = (...args) => call('isRenewalDue', args);`,
    };
    const result = await build({
      entryPoints: [resolve(root, 'api/cron/[...slug].js')], bundle: true, write: false,
      platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{ name: 'cron-fixture-io', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
          ? { path: args.path, namespace: 'cron-fixture-io' }
          : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'cron-fixture-io' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  })();
  return modulePromise;
}

const EMPTY_STATS = Object.freeze({
  occupied: 0, preStayReady: 0, vacant: 0, cleaning: 0, anomalyCount: 0,
  checkIns: 0, checkOuts: 0, anomalies: 0,
});

export function installCronIO({ behavior = {}, profile = 'hybrid', silent = true, watcherResults = [{ propertyId: 'fixture', result: 'sent', sent: true }] } = {}) {
  const previous = {
    io: globalThis.__cronHandlerIO,
    profile: process.env.PROPOS_DATA_PROFILE,
    secret: process.env.CRON_SECRET,
    log: console.log,
    error: console.error,
  };
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ name: 'db.query', args: [sql, params] });
      const custom = behavior['db.query'];
      if (custom instanceof Error) throw custom;
      if (custom) return custom(sql, params, calls);
      return { rows: [], rowCount: 0 };
    },
    async end() { calls.push({ name: 'db.end', args: [] }); },
  };
  const defaults = {
    syncAllPropertiesIcal: async () => ({}),
    pushCurrentReservationsToWatchers: async () => watcherResults,
    getStatsForPeriod: async () => ({ stats: { ...EMPTY_STATS } }),
    postSlack: async () => true,
    recoverInitialDeliveries: async () => 0,
    getVipFollowupJobs: async () => ({ rows: [] }),
    getGoogleToken: async () => null,
    getNextMonthDates: () => ['2026-12-01'],
    isRenewalDue: async () => false,
    checkStaleness: async () => {},
    queryEvents: async () => [],
    countPeriodEvents: () => ({ checkIns: 0, checkOuts: 0, anomalies: 0, energyWaste: 0 }),
    isCheckoutCancelled: async () => false,
    recordUnassignedAtStart: async () => 0,
    getPropertyConfig: async () => null,
    buildSmsRemind: () => 'fixture reminder',
    notify: async () => ({ ok: true }),
    openCleaningSlot: async () => {},
    requestedCleaningDays: async () => new Set(),
    toKstDateKey, // 실제 함수 — 따로 흉내 내면 한국 날짜 규칙과 어긋난다(예전 흉내는 UTC 날짜였다, RF-49)
    reservationUidOf: () => 'fixture-reservation',
    reportTokenFailure: async () => {},
    reportTokenSuccess: async () => {},
    markRenewed: async () => {},
    saveCalendarWatchExpiration: async () => {},
    'kv.get': async () => null,
    'kv.set': async () => 'OK',
  };
  const invoke = (name, args) => {
    calls.push({ name, args });
    const implementation = Object.hasOwn(behavior, name) ? behavior[name] : defaults[name];
    if (implementation instanceof Error) throw implementation;
    if (!implementation) throw new Error(`Unexpected cron dependency call: ${name}`);
    return implementation(...args);
  };
  const pool = () => {
    calls.push({ name: 'db.pool', args: [] });
    return db;
  };
  globalThis.__cronHandlerIO = { db, invoke, pool };
  process.env.PROPOS_DATA_PROFILE = profile;
  process.env.CRON_SECRET = 'fixture-cron-secret';
  if (silent) {
    console.log = () => {};
    console.error = () => {};
  }
  return {
    calls,
    names: () => calls.map(call => call.name),
    restore() {
      globalThis.__cronHandlerIO = previous.io;
      console.log = previous.log;
      console.error = previous.error;
      for (const [key, value] of [['PROPOS_DATA_PROFILE', previous.profile], ['CRON_SECRET', previous.secret]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}

export function cronResponse() {
  return {
    code: 200,
    body: null,
    ended: false,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}
