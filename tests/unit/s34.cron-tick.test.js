import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';

let handler;
before(async () => { ({ default: handler } = await actualCronModule()); });
after(() => { delete globalThis.__cronHandlerIO; });

async function runCron(t, path, options = {}) {
  const fixture = installCronIO(options);
  t.after(() => fixture.restore());
  const res = cronResponse();
  await handler({
    method: options.method ?? 'GET',
    url: path,
    query: options.query ?? {},
    headers: options.headers ?? { authorization: 'Bearer fixture-cron-secret' },
  }, res);
  return { fixture, res };
}

describe('actual cron handler — routing and guards', () => {
  test('rejects non-GET before constructing the database pool', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/morning', { method: 'POST' });
    assert.equal(res.code, 405);
    assert.equal(res.ended, true);
    assert.deepEqual(fixture.calls, []);
  });

  test('rejects the DEMO profile before cron work or database access', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/morning', { profile: 'demo' });
    assert.equal(res.code, 403);
    assert.deepEqual(res.body, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(fixture.calls, []);
  });

  test('requires the configured bearer secret', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/morning', { headers: { authorization: 'Bearer wrong' } });
    assert.equal(res.code, 401);
    assert.equal(res.ended, true);
    assert.deepEqual(fixture.calls, []);
  });

  test('allows GET when CRON_SECRET is absent', async t => {
    const fixture = installCronIO();
    t.after(() => fixture.restore());
    delete process.env.CRON_SECRET;
    const res = cronResponse();
    await handler({ method: 'GET', url: '/api/cron/unknown', query: {}, headers: {} }, res);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(fixture.names(), ['db.pool', 'db.end']);
  });

  test('uses a string query slug before the URL action', async t => {
    const { res } = await runCron(t, '/api/cron/unknown', { query: { slug: 'evening' } });
    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    assert.ok('stats' in res.body);
  });

  test('uses the first array query slug like a Vercel catch-all route', async t => {
    const { res } = await runCron(t, '/api/cron/unknown', { query: { slug: ['morning', 'ignored'] } });
    assert.equal(res.code, 200);
    assert.ok(Array.isArray(res.body.ran));
  });

  test('falls back to the URL action and returns 404 for an unknown action', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/not-real');
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(fixture.names(), ['db.pool', 'db.end']);
  });
});

describe('actual cron handler — morning branch', () => {
  test('runs the current non-monthly morning pipeline and reports only completed work', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-16T23:00:00.000Z'); // KST 11/17 08:00
    t.after(() => { Date.now = realNow; });
    const { fixture, res } = await runCron(t, '/api/cron/morning');
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, {
      ok: true,
      ran: ['ical-sync', 'watcher-reservation', 'daily-plan', 'worker-health-check', 'cleaning-followup'],
    });
    assert.equal(fixture.names().filter(name => name === 'checkStaleness').length, 2);
    assert.ok(!fixture.names().includes('getNextMonthDates'));
    assert.equal(fixture.names().at(-1), 'db.end');
  });

  test('runs monthly cleaning on the KST 15th before cleaning follow-up', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-14T23:00:00.000Z'); // KST 11/15 08:00
    t.after(() => { Date.now = realNow; });
    const { fixture, res } = await runCron(t, '/api/cron/morning');
    assert.deepEqual(res.body.ran, [
      'ical-sync', 'watcher-reservation', 'daily-plan', 'worker-health-check', 'monthly-cleaning', 'cleaning-followup',
    ]);
    const names = fixture.names();
    assert.ok(names.indexOf('getNextMonthDates') < names.indexOf('recoverInitialDeliveries'));
  });

  test('does not claim watcher delivery when no watcher was sent', async t => {
    const { res } = await runCron(t, '/api/cron/morning', {
      watcherResults: [{ propertyId: 'fixture', result: 'skipped', sent: false }],
    });
    assert.ok(!res.body.ran.includes('watcher-reservation'));
    assert.ok(res.body.ran.includes('ical-sync'));
  });

  test('isolates reservation sync and watcher failures from later morning work', async t => {
    const behavior = {
      syncAllPropertiesIcal: new Error('fixture sync failure'),
      pushCurrentReservationsToWatchers: new Error('fixture watcher failure'),
    };
    const { fixture, res } = await runCron(t, '/api/cron/morning', { behavior });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.ran, ['daily-plan', 'worker-health-check', 'cleaning-followup']);
    assert.equal(fixture.names().filter(name => name === 'checkStaleness').length, 2);
  });

  test('isolates daily-plan and cleaning-followup failures and still checks Watch staleness', async t => {
    const behavior = {
      getStatsForPeriod: new Error('fixture stats failure'),
      recoverInitialDeliveries: new Error('fixture followup failure'),
    };
    const { fixture, res } = await runCron(t, '/api/cron/morning', { behavior });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.ran, ['ical-sync', 'watcher-reservation', 'worker-health-check']);
    assert.equal(fixture.names().filter(name => name === 'checkStaleness').length, 2);
  });
});

describe('actual cron handler — evening branch', () => {
  test('syncs reservations, pushes watchers, follows up, then returns the actual daily result response', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/evening');
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, {
      ok: true,
      date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
      stats: { checkIns: 0, checkOuts: 0, anomalies: 0, energyWaste: 0 },
    });
    const names = fixture.names();
    assert.ok(names.indexOf('syncAllPropertiesIcal') < names.indexOf('pushCurrentReservationsToWatchers'));
    assert.ok(names.indexOf('recoverInitialDeliveries') < names.indexOf('queryEvents'));
    assert.equal(names.at(-1), 'db.end');
  });

  test('continues evening follow-up and result after sync and watcher failures', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/evening', { behavior: {
      syncAllPropertiesIcal: new Error('fixture sync failure'),
      pushCurrentReservationsToWatchers: new Error('fixture watcher failure'),
    } });
    assert.equal(res.code, 200);
    assert.ok(fixture.names().includes('recoverInitialDeliveries'));
    assert.ok(fixture.names().includes('queryEvents'));
  });

  test('returns 500 when the non-isolated evening follow-up fails and still closes the pool', async t => {
    const { fixture, res } = await runCron(t, '/api/cron/evening', { behavior: {
      recoverInitialDeliveries: new Error('fixture followup failure'),
    } });
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'fixture followup failure' });
    assert.equal(fixture.names().at(-1), 'db.end');
    assert.ok(!fixture.names().includes('queryEvents'));
  });
});

describe('vercel.json — deployed cron entry points', () => {
  test('declares only the actual morning and evening handler paths', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.deepEqual(config.crons.map(cron => cron.path), ['/api/cron/morning', '/api/cron/evening']);
  });

  test('schedules morning at UTC 23:00 and evening at UTC 13:00', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.deepEqual(config.crons, [
      { path: '/api/cron/morning', schedule: '0 23 * * *' },
      { path: '/api/cron/evening', schedule: '0 13 * * *' },
    ]);
  });

  test('contains no obsolete hourly tick endpoint', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.ok(config.crons.every(cron => !cron.path.includes('tick')));
  });
});
