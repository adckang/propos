/**
 * 실제 SQL·조건부 UPDATE 검증. 운영 DB·.env.local은 사용하지 않는다.
 * PGLITE_TEST_ROOT 또는 CLEANING_TEST_DATABASE_URL의 격리 저장소만 사용한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as domain from '../../src/domain/calendarAssignmentDomain.js';
import { toKstDateKey } from '../../server/cleaning/_dispatch.js';
import { assignFromCalendarEvents } from '../../server/cleaning/_calendarAssign.js';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const source = readFileSync(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module' });
function load(name, deps) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node);
  return new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
}

test('Calendar 예약 시각 — 실제 SQL, 반복 실행, 완료 상태 경쟁 보호', {
  skip: !(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL), timeout: 120_000,
}, async t => {
  const fixture = await createCleaningSqlFixture();
  const db = fixture.pool;
  const cleanerId = fixture.cleanerId;
  const cleaner = { id: cleanerId, name: '검증담당자', email: 'cleaner@example.invalid' };
  const event = {
    id: 's89-event', status: 'confirmed', organizer: { email: 'host@example.invalid' },
    attendees: [{ email: cleaner.email }],
    start: { dateTime: '2026-10-30T12:00:00+09:00' }, end: { dateTime: '2026-10-30T15:00:00+09:00' },
  };
  let events = [event], notices = 0, writes = 0, completeDuringRead = false, keepPaging = false, readBarrier = null;
  try {
    const { rows: [initial] } = await db.query(`
      UPDATE cleaning_jobs
         SET checkout_at='2026-10-30T02:00:00Z', cleaning_start_at='2026-10-30T02:00:00Z',
             cleaning_end_at='2026-10-30T05:00:00Z', status='ASSIGNED', assigned_cleaner_id=$1, google_event_id=$2
       WHERE id=$3 RETURNING *`, [cleanerId, event.id, fixture.jobId]);
    const deps = {
      ...domain, toKstDateKey, kv: {}, CALENDAR_API: 'https://example.invalid',
      getGoogleToken: async () => 'fixture-token',
      db: { query: async (sql, params) => {
        if (sql.includes('FROM property_cleaning_config')) return { rows: [{ property_id: 'fixture-property', google_calendar_id: 's89-calendar' }] };
        if (sql.includes('FROM cleaners')) return { rows: [cleaner] };
        assert.ok(/^\s*(SELECT|UPDATE)\b/i.test(sql) && /\bcleaning_jobs\b/.test(sql), '예상하지 못한 쿼리');
        // 실제 API의 SQL을 격리 저장소에서 그대로 실행한다.
        const result = await db.query(sql, params);
        if (/^\s*UPDATE/.test(sql)) writes += result.rowCount;
        if (/^\s*SELECT/.test(sql) && readBarrier && result.rows.length) {
          const barrier = readBarrier;
          if (++barrier.reads === 2) { readBarrier = null; barrier.release(); }
          await barrier.ready;
        }
        if (/^\s*SELECT/.test(sql) && completeDuringRead && result.rows.length) {
          completeDuringRead = false;
          await db.query("UPDATE cleaning_jobs SET status='COMPLETED' WHERE id=$1", [initial.id]);
        }
        return result;
      } },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ items: events, ...(keepPaging && { nextPageToken: 'more' }) }) }),
      readBody: async () => ({ calendar_id: 's89-calendar' }),
      sendJson: (res, status, body) => res.status(status).json(body),
      postSlack: async () => { notices++; }, sendCompletionSmsToRest: async () => { notices++; },
    };
    deps.resolveCalendarCleaner = load('resolveCalendarCleaner', deps);
    deps.listCalendarEvents = load('listCalendarEvents', deps);
    deps.assignFromCalendarEvents = assignFromCalendarEvents;
    deps.calendarAssignDeps = {
      calendarCleaningTimes: domain.calendarCleaningTimes, resolveCalendarCleaner: deps.resolveCalendarCleaner,
      sendCompletionSmsToRest: deps.sendCompletionSmsToRest,
      postAssignmentSlack: async () => { notices++; }, alertUnregisteredCleaner: async () => { notices++; }, goneAlertDeps: {},
    };
    const repair = load('repairCalendarAssignments', deps);
    await t.test('연결된 배정은 예약 시각만 정정하고 두 번째 실행은 쓰기 0건', async () => {
      assert.equal((await repair('fixture-property')).repaired, 1);
      const { rows: [after] } = await db.query('SELECT * FROM cleaning_jobs');
      assert.equal(new Date(after.cleaning_start_at).toISOString(), '2026-10-30T03:00:00.000Z');
      assert.equal(new Date(after.cleaning_end_at).toISOString(), '2026-10-30T06:00:00.000Z');
      for (const key of Object.keys(initial)) {
        if (!['cleaning_start_at', 'cleaning_end_at', 'updated_at'].includes(key)) assert.deepEqual(after[key], initial[key]);
      }
      assert.equal((await repair('fixture-property')).repaired, 0);
      assert.equal(notices, 0);
    });
    for (const name of ['handleCalendarWebhook', 'handleCalendarScan']) await t.test(name, async () => {
      events = [event]; notices = 0; writes = 0;
      await db.query("UPDATE cleaning_jobs SET status='PENDING',assigned_cleaner_id=NULL,google_event_id=NULL,cleaning_start_at=checkout_at,cleaning_end_at=checkout_at+interval '3 hours'");
      const handler = load(name, deps);
      const req = { method: 'POST', headers: {
        'x-goog-resource-uri': 'https://example.invalid/calendars/s89-calendar/events',
        'x-goog-channel-token': process.env.GOOGLE_WEBHOOK_SECRET,
      } };
      const res = { status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; return this; } };
      await handler(req, res);
      assert.equal(res.code, 200); assert.equal(writes, 1);
      assert.equal(notices, 2, 'S20·S22: 자동 알림·수동 스캔 모두 다른 담당자 완료 안내 + 운영자 Slack');
      notices = 0; writes = 0;
      await handler(req, res); assert.equal(writes, 0); assert.equal(notices, 0);
      events = [{ ...event, start: { dateTime: '2026-10-30T13:00:00+09:00' }, end: { dateTime: '2026-10-30T16:00:00+09:00' } }];
      await handler(req, res); assert.equal(writes, 1); assert.equal(notices, 0, '시간 변경은 배정 알림을 재발송하지 않음');
      events = [event]; writes = 0; completeDuringRead = true;
      await handler(req, res); assert.equal(writes, 0); assert.equal(notices, 0);
      const { rows: [after] } = await db.query('SELECT status FROM cleaning_jobs');
      assert.equal(after.status, 'COMPLETED', '조회 직후 완료된 작업을 다시 ASSIGNED로 되돌리지 않음');
    });
    await t.test('자동 알림과 수동 스캔이 동시에 와도 배정 저장·완료 안내는 한 번', async () => {
      events = [event]; notices = 0; writes = 0;
      await db.query("UPDATE cleaning_jobs SET status='PENDING',assigned_cleaner_id=NULL,google_event_id=NULL");
      const barrier = { reads: 0 };
      barrier.ready = new Promise(resolve => { barrier.release = resolve; });
      readBarrier = barrier;
      const req = { method: 'POST', headers: { 'x-goog-resource-uri': 'https://example.invalid/calendars/s89-calendar/events',
        'x-goog-channel-token': process.env.GOOGLE_WEBHOOK_SECRET } };
      const responses = ['handleCalendarWebhook', 'handleCalendarScan'].map(() => ({ status(code) { this.code = code; return this; }, end() {}, json() {} }));
      await Promise.all(['handleCalendarWebhook', 'handleCalendarScan'].map((name, i) => load(name, deps)(req, responses[i])));
      assert.equal(barrier.reads, 2, '두 경로 모두 아직 배정 전인 같은 행을 읽은 뒤 저장 경쟁');
      assert.deepEqual(responses.map(r => r.code), [200, 200]);
      assert.equal(writes, 1);
      assert.equal(notices, 2);
      assert.equal((await fixture.currentJob()).assigned_cleaner_id, cleanerId);
    });
    await t.test('취소·완료된 작업과 SIMULATED 작업은 자동 알림·수동 스캔으로 배정하지 않는다', async () => {
      const req = { method: 'POST', headers: { 'x-goog-resource-uri': 'https://example.invalid/calendars/s89-calendar/events',
        'x-goog-channel-token': process.env.GOOGLE_WEBHOOK_SECRET } };
      for (const [status, origin] of [['CANCELLED', 'REAL'], ['COMPLETED', 'REAL'], ['PENDING', 'SIMULATED']]) {
        await db.query('UPDATE cleaning_jobs SET status=$1,data_origin=$2,assigned_cleaner_id=NULL,google_event_id=NULL', [status, origin]);
        writes = 0; notices = 0;
        for (const name of ['handleCalendarWebhook', 'handleCalendarScan']) {
          const res = { status(code) { this.code = code; return this; }, end() {}, json() {} };
          await load(name, deps)(req, res);
          assert.equal(res.code, 200);
        }
        assert.equal(writes, 0);
        assert.equal(notices, 0);
        assert.equal((await fixture.currentJob()).status, status);
      }
      await db.query("UPDATE cleaning_jobs SET status='ASSIGNED',data_origin='REAL',assigned_cleaner_id=$1,google_event_id=$2", [cleanerId, event.id]);
    });
    await t.test('기존 배정 복구도 전체 조회 실패이면 저장하지 않는다', async () => {
      writes = 0; notices = 0; keepPaging = true;
      await assert.rejects(repair('fixture-property'), /Calendar 조회 실패/);
      assert.equal(writes, 0);
      assert.equal(notices, 0);
    });
  } finally {
    await fixture.close();
  }
});
