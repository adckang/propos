/**
 * RUN_LIVE_DB=1 node --test tests/integration/s95.pre-stay-context.test.js
 * Actual PostgreSQL SELECTs run against JSON CTE fixtures inside BEGIN READ ONLY.
 * No real event rows, temporary tables, schema changes or external notifications.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getStatsForPeriod, getDrilldownForMetric, getMonthlyInsights, getWeeklyInsights } from '../../src/application/reportingService.js';
import { computeMeasurableMetrics } from '../../src/domain/operationalMetricsDomain.js';
import { queryNextPreStayEvents } from '../../src/infrastructure/eventRepository.js';

const now = new Date('2026-11-05T00:00:00Z');
const event = (type, device_time, property_id = 'property-A') => ({ type, device_time, property_id });
const prep = (time, property) => event('checkin_prep_time_reached', time, property);
const done = (time, property) => event('optimization_finished', time, property);
const checkin = time => event('check_in_detected', time);

test('Pre-stay context — actual SELECTs in read-only PostgreSQL', { skip: process.env.RUN_LIVE_DB !== '1' }, async t => {
  const env = { ...process.env };
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  } catch {}
  assert.ok(env.POSTGRES_URL, 'POSTGRES_URL is required for the explicit live DB test');
  const client = new pg.Client({ connectionString: env.POSTGRES_URL, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  let fixtures = [], queries = 0, queue = Promise.resolve();
  const db = { query: async (sql, params) => {
    if (sql.includes('FROM cleaning_jobs')) return { rows: [{ created: 0, assigned: 0 }] };
    assert.match(sql, /^\s*(SELECT|WITH)\b/, 'Only actual event SELECTs may run');
    assert.match(sql, /\bFROM events\b/);
    queries++;
    // Shadow the table with input rows; all filtering, MIN and joins remain the
    // repository's real SQL, rather than a test implementation of those rules.
    const fixtureCte = `events AS (SELECT * FROM jsonb_to_recordset($${params.length + 1}::jsonb)
      AS x(property_id text, type text, device_time timestamptz, data jsonb))`;
    const query = /^\s*WITH\b/i.test(sql)
      ? sql.replace(/^\s*WITH\b/i, `WITH ${fixtureCte},`)
      : `WITH ${fixtureCte} ${sql}`;
    const values = [...params, JSON.stringify(fixtures)];
    const pending = queue.then(() => client.query(query, values));
    queue = pending.catch(() => {});
    return pending;
  } };
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');

    const start = prep('2026-10-31T23:50:00+09:00');
    const finish = done('2026-11-01T00:20:00+09:00');
    for (const [label, rows, failures, attempts, period, asOf] of [
      ['completion crosses month end', [start, finish], 0, 1, 'last_month', now],
      ['next preparation ends previous round', [start, prep('2026-11-01T00:10:00+09:00'), finish], 1, 1, 'last_month', now],
      ['preparation exactly at next month start is context only', [start, prep('2026-11-01T00:00:00+09:00'), finish], 1, 1, 'last_month', now],
      ['check-in ends previous round', [start, checkin('2026-11-01T00:10:00+09:00'), finish], 1, 1, 'last_month', now],
      ['check-in and completion at first context timestamp', [start, checkin('2026-11-01T00:20:00+09:00'), finish], 1, 1, 'last_month', now],
      ['other property completion is excluded', [start, done(finish.device_time, 'property-B')], 1, 1, 'last_month', now],
      ['future completion is not visible before it happens', [start, finish], 1, 1, 'last_month', new Date('2026-11-01T00:05:00+09:00')],
      ['orphan completion in new month is not an attempt', [start, finish], 0, 0, 'this_month', now],
      ['same property two reservations', [prep('2026-10-01T14:00:00+09:00'), done('2026-10-01T14:30:00+09:00'), prep('2026-10-03T14:00:00+09:00')], 1, 2, 'last_month', now],
      ['completion crosses Sunday to Monday', [prep('2026-11-01T23:50:00+09:00'), done('2026-11-02T00:20:00+09:00')], 0, 1, 'last_week', now],
      ['new week orphan completion is not an attempt', [prep('2026-11-01T23:50:00+09:00'), done('2026-11-02T00:20:00+09:00')], 0, 0, 'this_week', now],
    ]) await t.test(label, async () => {
      fixtures = rows;
      const stats = await getStatsForPeriod(period, { db, propertyIds: ['property-A'], now: asOf });
      const metric = computeMeasurableMetrics(stats.stats).find(row => row.key === 'pre_stay_optimization');
      const detail = await getDrilldownForMetric('pre_stay_optimization', period, { db, propertyIds: ['property-A'], now: asOf });
      assert.equal(stats.stats.preStayAttempts, attempts);
      assert.equal(metric?.failCount ?? 0, failures);
      assert.equal(detail.failCount, failures);
      assert.equal(detail.items.length, failures);
      assert.ok(detail.items.every(item => item.property_id === 'property-A'));
    });

    for (const [label, period, getInsights, starts, nextStart] of [
      ['monthly', 'last_month', getMonthlyInsights, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], '2026-11-01'],
      ['weekly', 'last_week', getWeeklyInsights, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], '2026-11-02'],
    ]) await t.test(`${label} insights count the same preparation failures as KPI and detail at exact period boundaries`, async () => {
      fixtures = [
        ...starts.map(day => prep(`${day}T14:00:00+09:00`)),
        ...starts.map(day => checkin(`${day}T15:00:00+09:00`)),
        prep(`${nextStart}T00:00:00+09:00`),
      ];
      const stats = await getStatsForPeriod(period, { db, propertyIds: ['property-A'], now });
      const metric = computeMeasurableMetrics(stats.stats).find(row => row.key === 'pre_stay_optimization');
      const detail = await getDrilldownForMetric('pre_stay_optimization', period, { db, propertyIds: ['property-A'], now });
      const insights = await getInsights(period, { db, propertyIds: ['property-A'], now });
      const repeat = insights.find(row => row.type === 'REPEAT' && row.metricKey === 'pre_stay_optimization');
      assert.equal(metric.failCount, 4);
      assert.equal(detail.failCount, metric.failCount);
      assert.ok(repeat, 'Repeated preparation failures must be reported');
      assert.equal(repeat.evidence.count, metric.failCount);
    });

    await t.test('first timestamp returns both tied event types, allowing the domain to reject simultaneous check-in completion', async () => {
      fixtures = [start, checkin(finish.device_time), finish, done('2026-11-01T01:00:00+09:00')];
      const rows = await queryNextPreStayEvents(db, new Date('2026-11-01T00:00:00+09:00'), now, ['property-A']);
      assert.deepEqual(rows.map(row => row.type).sort(), ['check_in_detected', 'optimization_finished']);
    });

    await t.test('empty property selection issues no event SQL', async () => {
      const before = queries;
      const stats = await getStatsForPeriod('last_month', { db, propertyIds: [], now });
      const detail = await getDrilldownForMetric('pre_stay_optimization', 'last_month', { db, propertyIds: [], now });
      assert.equal(stats.stats.preStayAttempts, 0);
      assert.deepEqual(detail.items, []);
      assert.equal(queries, before);
    });

    const sensor = (event, id = 'sensor-run-A') => ({ ...event, data: { preparationPolicy: 'sensor-v1', optimizationRunId: id } });
    for (const [label, outcome, attempts, successes, failures] of [
      ['completion after early arrival', 'optimization_finished', 1, 1, 0],
      ['explicit hardware failure', 'optimization_failed', 1, 0, 1],
      ['reservation cancellation', 'optimization_cancelled', 0, 0, 0],
    ]) await t.test(`sensor-v1 actual SQL: ${label} across a month boundary`, async () => {
      fixtures = [sensor(start), checkin('2026-11-01T00:05:00+09:00'), sensor(event(outcome, '2026-11-01T00:10:00+09:00')),
        sensor(done('2026-11-01T00:07:00+09:00'), 'another-run'), sensor(done('2026-11-01T00:08:00+09:00', 'property-B'))];
      const stats = await getStatsForPeriod('last_month', { db, propertyIds: ['property-A'], now });
      const detail = await getDrilldownForMetric('pre_stay_optimization', 'last_month', { db, propertyIds: ['property-A'], now });
      assert.equal(stats.stats.preStayAttempts, attempts); assert.equal(stats.stats.preStayOptimized, successes);
      assert.equal(detail.failCount, failures);
    });

    await t.test('sensor-v1 actual SQL: a cancellation after an in-period completion still excludes the cancelled booking', async () => {
      fixtures = [sensor(prep('2026-10-31T23:40:00+09:00')), sensor(done('2026-10-31T23:50:00+09:00')), sensor(event('optimization_cancelled', '2026-11-01T00:05:00+09:00'))];
      const stats = await getStatsForPeriod('last_month', { db, propertyIds: ['property-A'], now });
      assert.equal(stats.stats.preStayAttempts, 0); assert.equal(stats.stats.preStayCancelled, 1);
    });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
});
