import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStatsForPeriod, getDrilldownForMetric, getMonthlyCalendarData } from '../../src/application/reportingService.js';
import { getPreStayPreparationRounds } from '../../src/domain/metricDrilldownDomain.js';

const now = new Date('2026-11-05T00:00:00Z');
const event = (type, time, id = 'run-A', property = 'A') => ({ type, device_time: new Date(time), property_id: property,
  data: { preparationPolicy: 'sensor-v1', optimizationRunId: id, reason: 'fixture-reason' } });
const start = () => event('checkin_prep_time_reached', '2026-10-31T23:50:00+09:00');
async function report(events, context = []) {
  const db = { query: async sql => {
    if (sql.includes('jsonb_to_recordset') || sql.includes('MIN(device_time)')) return { rows: context };
    if (sql.includes('FROM events')) return { rows: events };
    if (sql.includes('FROM cleaning_jobs')) return { rows: [{ created: 0, assigned: 0 }] };
    throw new Error('Unexpected SQL');
  } };
  const stats = await getStatsForPeriod('last_month', { db, now });
  const detail = await getDrilldownForMetric('pre_stay_optimization', 'last_month', { db, now });
  const calendar = await getMonthlyCalendarData('last_month', { db, now });
  return { stats: stats.stats, detail, calendar };
}

test('sensor-v1: early arrival does not close a preparation; completion can cross month end', async () => {
  const { stats, detail, calendar } = await report([start()], [
    event('check_in_detected', '2026-11-01T00:00:00+09:00'),
    event('optimization_finished', '2026-11-01T00:10:00+09:00'),
  ]);
  assert.equal(stats.preStayAttempts, 1); assert.equal(stats.preStayOptimized, 1);
  assert.equal(detail.failCount, 0);
  assert.ok(!calendar.items.some(i => i.type === 'pre_stay_optimization_failed'));
});

test('sensor-v1: explicit failure is counted consistently with its cause', async () => {
  const { stats, detail } = await report([start()], [event('optimization_failed', '2026-11-01T00:10:00+09:00')]);
  assert.equal(stats.preStayAttempts, 1); assert.equal(stats.preStayOptimized, 0);
  assert.equal(detail.failCount, 1); assert.equal(detail.items[0].detail.reason, 'fixture-reason');
});

test('sensor-v1: cancellation and skip are excluded from success/failure denominators', async () => {
  const { stats, detail } = await report([start(), event('optimization_skipped', '2026-10-20T15:00:00+09:00', 'skip-A')], [event('optimization_cancelled', '2026-11-01T00:10:00+09:00')]);
  assert.equal(stats.preStayAttempts, 0); assert.equal(stats.preStayOptimized, 0);
  assert.equal(stats.preStaySkipped, 1); assert.equal(stats.preStayCancelled, 1); assert.equal(detail.failCount, 0);
});

test('sensor-v1: missing outcome is unconfirmed, never a made-up equipment failure', async () => {
  const { stats, detail } = await report([start()]);
  assert.equal(stats.preStayAttempts, 0); assert.equal(stats.preStayUnconfirmed, 1); assert.equal(detail.failCount, 0);
});

test('sensor-v1: a completion on another run or property cannot hide a failure', async () => {
  const { stats, detail } = await report([start()], [
    event('optimization_finished', '2026-11-01T00:10:00+09:00', 'other-run'),
    event('optimization_finished', '2026-11-01T00:10:00+09:00', 'run-A', 'other-property'),
    event('optimization_failed', '2026-11-01T00:15:00+09:00'),
  ]);
  assert.equal(stats.preStayOptimized, 0); assert.equal(detail.failCount, 1);
});

test('legacy A still closes at check-in; the new policy cannot retroactively reclassify it', () => {
  const events = [start(), event('check_in_detected', '2026-10-31T23:55:00+09:00'), event('optimization_finished', '2026-10-31T23:56:00+09:00')]
    .map(({ data, ...e }) => e);
  assert.equal(getPreStayPreparationRounds(events)[0].completedAt, null);
});

test('sensor-v1: cancellation after a previously measured completion excludes the cancelled reservation', async () => {
  const { stats, detail } = await report([start(), event('optimization_finished', '2026-10-31T23:55:00+09:00')],
    [event('optimization_cancelled', '2026-11-01T00:10:00+09:00')]);
  assert.equal(stats.preStayAttempts, 0); assert.equal(stats.preStayCancelled, 1); assert.equal(detail.failCount, 0);
});
