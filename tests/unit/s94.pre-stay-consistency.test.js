import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getStatsForPeriod, getDrilldownForMetric, getMonthlyCalendarData } from '../../src/application/reportingService.js';
import { computeMeasurableMetrics } from '../../src/domain/operationalMetricsDomain.js';
import { getPeriodRange } from '../../src/domain/reportingDomain.js';

const period = 'last_month';
const { from, to } = getPeriodRange(period);
const at = hours => new Date(from.getTime() + hours * 3_600_000);
const prep = (hours, property_id = 'property-A') => ({ property_id, type: 'checkin_prep_time_reached', device_time: at(hours) });
const done = (hours, property_id = 'property-A') => ({ property_id, type: 'optimization_finished', device_time: at(hours) });

async function reports(events, { context = [], now = new Date() } = {}) {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('MIN(device_time)')) return { rows: context };
    if (sql.includes('FROM events')) return { rows: events };
    if (sql.includes('FROM cleaning_jobs')) return { rows: [{ created: 0, assigned: 0 }] };
    throw new Error('Unexpected query');
  } };
  const stats = await getStatsForPeriod(period, { db, now });
  const metric = computeMeasurableMetrics(stats.stats).find(row => row.key === 'pre_stay_optimization');
  const detail = await getDrilldownForMetric('pre_stay_optimization', period, { db, now });
  return { metric, detail, db, calls };
}

describe('Pre-stay consistency — actual KPI and drilldown services', () => {
  // Approved policy A: one preparation round ends at the next preparation or
  // check-in. Its first completion belongs to that round, across date/period edges.
  test('same property, two preparation rounds and one completion: both report one failure', async () => {
    const { metric, detail } = await reports([prep(14), done(14.5), prep(62)]);
    assert.equal(metric.failCount, 1);
    assert.equal(detail.failCount, metric.failCount);
    assert.equal(detail.items.length, metric.failCount);
    assert.equal(new Date(detail.items[0].occurred_at).getTime(), at(62).getTime());
  });

  test('completion without a preparation on another property cannot hide a failure', async () => {
    const { metric, detail } = await reports([prep(14), done(14.5, 'property-B')]);
    assert.equal(detail.failCount, 1);
    assert.equal(metric.failCount, detail.failCount);
  });

  test('preparation and completion can cross KST midnight within a reporting period', async () => {
    const { metric, detail } = await reports([prep(23.75), done(24.25)]);
    assert.equal(metric.failCount, 0);
    assert.equal(detail.failCount, 0);
    assert.deepEqual(detail.items, []);
  });

  test('missing completions remain visible for every preparation on the same property', async () => {
    const { metric, detail } = await reports([prep(14), prep(62), prep(110)]);
    assert.equal(metric.failCount, 3);
    assert.equal(detail.failCount, 3);
    assert.equal(detail.items.length, 3);
  });

  test('no preparation or completion produces no measurable KPI and an empty list', async () => {
    const { metric, detail } = await reports([]);
    assert.equal(metric, undefined);
    assert.equal(detail.failCount, 0);
    assert.deepEqual(detail.items, []);
  });

  for (const [label, events, expectedFailures, expectedAttempts] of [
    ['completion before preparation', [done(13), prep(14)], 1, 1],
    ['next preparation closes the earlier unfinished round', [prep(14), prep(38), done(38.5)], 1, 2],
    ['completion after check-in', [prep(14), { ...done(15), type: 'check_in_detected' }, done(16)], 1, 1],
    ['completion exactly at check-in', [prep(14), done(15), { ...done(15), type: 'check_in_detected' }], 1, 1],
    ['completion at preparation timestamp', [done(14), prep(14)], 0, 1],
    ['duplicate semantic event keys', [prep(14), prep(14), done(14.5), done(14.5)], 0, 1],
    ['extra completion cannot complete the next round', [prep(14), done(14.5), done(15), prep(38)], 1, 2],
    ['reverse arrival order', [prep(62), done(14.5), prep(14)], 1, 2],
  ]) test(label, async () => {
    const before = structuredClone(events);
    const { metric, detail } = await reports(events);
    assert.equal(metric.denominator, expectedAttempts);
    assert.equal(metric.failCount, expectedFailures);
    assert.equal(detail.failCount, expectedFailures);
    assert.equal(detail.items.length, expectedFailures);
    assert.deepEqual(events, before, 'Report calculation must not mutate event input');
  });

  test('source_ref values are provenance, not the preparation matching key', async () => {
    const { metric, detail } = await reports([
      { ...prep(14), source_ref: 'ingest:event:start-1' },
      { ...done(14.5), source_ref: 'ha:context:finished-1' },
      { ...prep(38), source_ref: 'ha:context:finished-1' },
    ]);
    assert.equal(metric.failCount, 1);
    assert.equal(detail.failCount, 1);
    assert.equal(new Date(detail.items[0].occurred_at).getTime(), at(38).getTime());
  });

  test('completion after report end belongs to the preparation period', async () => {
    const start = { ...prep(0), device_time: new Date(to.getTime() - 10 * 60_000) };
    const finish = { ...done(0), device_time: new Date(to.getTime() + 20 * 60_000) };
    const { metric, detail, db } = await reports([start], { context: [finish] });
    assert.equal(metric.numerator, 1);
    assert.equal(metric.denominator, 1);
    assert.equal(detail.failCount, 0);
    const calendar = await getMonthlyCalendarData(period, { db });
    assert.ok(!calendar.items.some(item => item.type === 'pre_stay_optimization_failed'));
  });

  test('next preparation or check-in after report end blocks a later completion', async () => {
    const start = { ...prep(0), device_time: new Date(to.getTime() - 10 * 60_000) };
    for (const type of ['checkin_prep_time_reached', 'check_in_detected']) {
      const boundary = { ...prep(0), type, device_time: new Date(to.getTime() + 10 * 60_000) };
      const { metric, detail } = await reports([start], { context: [boundary] });
      assert.equal(metric.failCount, 1);
      assert.equal(detail.failCount, 1);
      assert.equal(detail.items.length, 1, 'Context preparation is not a new attempt in this report');
    }
  });
});
