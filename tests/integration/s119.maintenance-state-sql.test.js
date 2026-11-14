/**
 * PGLITE_TEST_ROOT or the isolated CLEANING_TEST_DATABASE_URL enables real SQL.
 * Uses the actual event schema, insertEvent and current-report entry points.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { insertEvent, getLastKnownStatesFromDB, queryStateEventsForProperty } from '../../src/infrastructure/eventRepository.js';
import { getStatsForPeriod, getMonthlyCalendarData } from '../../src/application/reportingService.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const eventSchema = readFileSync(new URL('../../data/schema.sql', import.meta.url), 'utf8');
const vacant = subStatus => ({ mainStatus: 'VACANT', subStatus });

test('정비 상태 — 실제 저장 SQL·현재 보고서 복원', { skip: !enabled }, async t => {
  const fixture = await createCleaningSqlFixture();
  const db = fixture.pool;
  try {
    // Reuse the production table/index DDL. Both engines provide gen_random_uuid.
    await fixture.engine.exec(eventSchema.slice(eventSchema.indexOf('CREATE TABLE IF NOT EXISTS events')));
    await db.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin)
      VALUES('other-property','Other Property','REAL'),('simulated-property','Simulated Property','SIMULATED')`);
    t.beforeEach(() => db.query('TRUNCATE events'));

    async function store(type, time, { propertyId = 'fixture-property', serverTime } = {}) {
      const id = randomUUID();
      const result = await insertEvent(db, {
        id, property_id: propertyId, type, device_time: new Date(time),
        source_system: 'HA_WATCHER', source_ref: `fixture:event:${id}`,
      }, false);
      if (serverTime) await db.query('UPDATE events SET server_time=$2 WHERE id=$1', [result.id, serverTime]);
      return result;
    }
    const states = propertyIds => getLastKnownStatesFromDB(db, propertyIds);

    await t.test('청소 완료 후 정비 시작을 이전 청소 상태로 되돌리지 않는다', async () => {
      await store('cleaning_finished', '2026-11-14T11:00:00+09:00');
      await store('maintenance_started', '2026-11-14T12:00:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('MAINTENANCE'));
    });

    await t.test('첫 정비 시작 기록을 지금·오늘의 공실·전체 숙소 수에 포함한다', async () => {
      await store('maintenance_started', '2026-11-14T12:00:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('MAINTENANCE'));
      for (const period of ['now', 'today']) {
        const { stats } = await getStatsForPeriod(period, { db, propertyIds: ['fixture-property'] });
        assert.equal(stats.total, 1);
        assert.equal(stats.vacant, 1);
        assert.equal(stats.occupied + stats.preStayReady + stats.vacant + stats.cleaning, stats.total);
      }
    });

    await t.test('첫 기록이 정비 완료인 숙소도 복원한다', async () => {
      await store('maintenance_finished', '2026-11-14T13:00:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('CLEANING_FINISHED'));
    });

    await t.test('같은 이벤트 목록을 쓰는 월간 보고서도 월 경계의 정비·완료 구간을 복원한다', async () => {
      await store('maintenance_started', '2026-10-31T23:00:00+09:00');
      await store('maintenance_finished', '2026-11-01T01:00:00+09:00');
      const report = await getMonthlyCalendarData('this_month', {
        db, propertyIds: ['fixture-property'], now: new Date('2026-11-02T00:00:00+09:00'),
      });
      assert.deepEqual(report.stateSegments.map(({ mainStatus, subStatus, start, end }) => ({ mainStatus, subStatus, start, end })), [
        { ...vacant('MAINTENANCE'), start: '2026-10-31T15:00:00.000Z', end: '2026-10-31T16:00:00.000Z' },
        { ...vacant('CLEANING_FINISHED'), start: '2026-10-31T16:00:00.000Z', end: '2026-11-01T15:00:00.000Z' },
      ]);
    });

    await t.test('월초 직전 완료된 준비 상태가 월간 보고서에도 이어진다', async () => {
      await store('maintenance_finished', '2026-10-31T22:00:00+09:00');
      await store('checkin_prep_time_reached', '2026-10-31T23:40:00+09:00');
      await store('optimization_finished', '2026-10-31T23:55:00+09:00');
      await store('check_in_detected', '2026-10-31T23:59:00+09:00', { propertyId: 'other-property' });
      const report = await getMonthlyCalendarData('this_month', {
        db, propertyIds: ['fixture-property'], now: new Date('2026-11-01T00:20:00+09:00'),
      });
      assert.equal(report.stateSegments.length, 1);
      assert.equal(report.stateSegments[0].start, '2026-10-31T15:00:00.000Z');
      assert.equal(report.stateSegments[0].end, '2026-10-31T15:20:00.000Z');
      assert.equal(report.stateSegments[0].subStatus, 'OPTIMIZED');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), {
        mainStatus: report.stateSegments[0].mainStatus, subStatus: report.stateSegments[0].subStatus,
      });
    });

    await t.test('월 시작 전 주요 이벤트의 동시각 순서도 현재 보고서와 일치한다', async () => {
      const inputs = [
        ['maintenance_finished', '2026-10-31T14:59:01Z'],
        ['maintenance_started', '2026-10-31T14:59:02Z'],
      ];
      for (const order of [inputs, [...inputs].reverse()]) {
        await db.query('TRUNCATE events');
        for (const [type, serverTime] of order) await store(type, '2026-10-31T23:59:00+09:00', { serverTime });
        const report = await getMonthlyCalendarData('this_month', {
          db, propertyIds: ['fixture-property'], now: new Date('2026-11-01T00:20:00+09:00'),
        });
        assert.equal(report.stateSegments[0]?.subStatus, 'MAINTENANCE');
      }
    });

    await t.test('월 안의 동시각 이벤트 조회·재생은 서버 기록 순서로 일치한다', async () => {
      const time = '2026-11-01T00:05:00+09:00';
      const inputs = [
        ['optimization_finished', '2026-10-31T15:05:03Z'],
        ['checkin_prep_time_reached', '2026-10-31T15:05:02Z'],
        ['maintenance_started', '2026-10-31T15:05:01Z'],
      ];
      for (const [type, serverTime] of inputs) await store(type, time, { serverTime });
      const report = await getMonthlyCalendarData('this_month', {
        db, propertyIds: ['fixture-property'], now: new Date('2026-11-01T00:20:00+09:00'),
      });
      assert.equal(report.stateSegments[0]?.subStatus, 'OPTIMIZED');
      const rows = await queryStateEventsForProperty(db, {
        from: new Date('2026-11-01T00:00:00+09:00'), to: new Date('2026-11-02T00:00:00+09:00'),
      }, 'fixture-property');
      assert.deepEqual(rows.map(row => row.type), ['maintenance_started', 'checkin_prep_time_reached', 'optimization_finished']);
    });

    await t.test('주요 이벤트가 없는 월 시작 전 세부 기록으로 상태를 만들지 않는다', async () => {
      await store('checkin_prep_time_reached', '2026-10-31T23:40:00+09:00');
      await store('optimization_finished', '2026-10-31T23:55:00+09:00');
      const report = await getMonthlyCalendarData('this_month', {
        db, propertyIds: ['fixture-property'], now: new Date('2026-11-01T00:20:00+09:00'),
      });
      assert.deepEqual(report.stateSegments, []);
    });

    await t.test('정비 후 준비 실패 이력은 다음 정비 완료에서 끝난다', async () => {
      await store('maintenance_started', '2026-11-14T12:00:00+09:00');
      await store('checkin_prep_time_reached', '2026-11-14T12:10:00+09:00');
      await store('optimization_failed', '2026-11-14T12:20:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), {
        mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZATION_FAILED',
      });
      await store('maintenance_finished', '2026-11-14T13:00:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('CLEANING_FINISHED'));
    });

    await t.test('날짜가 바뀐 정비와 늦게 도착한 이전 입실·청소를 발생 시각으로 구분한다', async () => {
      await store('maintenance_started', '2026-11-15T00:01:00+09:00');
      await store('check_in_detected', '2026-11-13T15:00:00+09:00');
      await store('cleaning_finished', '2026-11-14T23:59:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('MAINTENANCE'));
      await store('maintenance_finished', '2026-11-15T00:30:00+09:00');
      await store('check_in_detected', '2026-11-15T15:00:00+09:00');
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), {
        mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',
      });
    });

    await t.test('같은 발생 시각의 청소 완료·정비 시작은 서버 기록 시각으로 순서를 정한다', async () => {
      const events = [
        ['cleaning_finished', '2026-11-14T03:00:01Z'],
        ['maintenance_started', '2026-11-14T03:00:02Z'],
      ];
      for (const order of [events, [...events].reverse()]) {
        await db.query('TRUNCATE events');
        for (const [type, serverTime] of order) await store(type, '2026-11-14T03:00:00Z', { serverTime });
        assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('MAINTENANCE'));
      }
    });

    await t.test('정비와 같은 발생 시각의 후속 준비 이벤트도 서버 기록 순서대로 적용한다', async () => {
      const time = '2026-11-14T03:00:00Z';
      await store('maintenance_started', time, { serverTime: '2026-11-14T03:00:01Z' });
      await store('checkin_prep_time_reached', time, { serverTime: '2026-11-14T03:00:02Z' });
      await store('optimization_finished', time, { serverTime: '2026-11-14T03:00:03Z' });
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), {
        mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',
      });
      await store('maintenance_finished', time, { serverTime: '2026-11-14T03:00:04Z' });
      assert.deepEqual((await states(['fixture-property'])).get('fixture-property'), vacant('CLEANING_FINISHED'));
    });

    await t.test('수신 중복은 기존 이벤트·출처를 보존하고 공실 수를 늘리지 않는다', async () => {
      const time = '2026-11-14T12:00:00+09:00';
      const first = await store('maintenance_started', time);
      const duplicate = await store('maintenance_started', time);
      assert.equal(first.inserted, true);
      assert.deepEqual(duplicate, { inserted: false, id: null });
      const { rows } = await db.query('SELECT id,source_ref,data_origin FROM events');
      assert.deepEqual(rows, [{ id: first.id, source_ref: `fixture:event:${first.id}`, data_origin: 'REAL' }]);
      const { stats } = await getStatsForPeriod('now', { db });
      assert.equal(stats.total, 1);
      assert.equal(stats.vacant, 1);
    });

    await t.test('여러 숙소·혼합 데이터·선택 필터·기록 없는 숙소를 기존 계약대로 처리한다', async () => {
      const time = '2026-11-14T12:00:00+09:00';
      await store('maintenance_started', time);
      await store('check_in_detected', time, { propertyId: 'other-property' });
      await store('maintenance_finished', time, { propertyId: 'simulated-property' });
      const all = await states(null);
      assert.equal(all.size, 3);
      assert.deepEqual(all.get('fixture-property'), vacant('MAINTENANCE'));
      assert.deepEqual(all.get('simulated-property'), vacant('CLEANING_FINISHED'));
      const { stats } = await getStatsForPeriod('today', { db });
      assert.equal(stats.total, 3);
      assert.equal(stats.occupied, 1);
      assert.equal(stats.vacant, 2);
      const selected = await getStatsForPeriod('now', { db, propertyIds: ['fixture-property', 'fixture-property', 'unknown-property'] });
      assert.equal(selected.stats.total, 1);
      assert.equal(selected.stats.vacant, 1);
      assert.deepEqual(await states(['unknown-property']), new Map());
      await getStatsForPeriod('now', { db: { query() { assert.fail('Empty selection must issue no SQL'); } }, propertyIds: [] });
    });
  } finally { await fixture.close(); }
});
