/**
 * 실제 Postgres 타입·조건부 UPDATE 검증. 운영 행은 읽거나 변경하지 않는다.
 * 공개 스키마와 같은 세션 임시 테이블만 만들며 종료 시 ROLLBACK한다.
 * RUN_LIVE_DB=1 node --test tests/integration/s89.calendar-cleaning-times.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import pg from 'pg';
import * as domain from '../../src/domain/calendarAssignmentDomain.js';
import { toKstDateKey } from '../../server/cleaning/_dispatch.js';

const source = readFileSync(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module' });
function load(name, deps) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node);
  return new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
}

test('Calendar 예약 시각 — 실제 SQL, 반복 실행, 완료 상태 경쟁 보호', {
  skip: process.env.RUN_LIVE_DB !== '1', timeout: 120_000,
}, async t => {
  const env = { ...process.env };
  if (!env.POSTGRES_URL) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  assert.ok(env.POSTGRES_URL);
  const db = new pg.Client({ connectionString: env.POSTGRES_URL, connectionTimeoutMillis: 10_000 });
  const cleanerId = '11111111-1111-4111-8111-111111111111';
  const cleaner = { id: cleanerId, name: '검증담당자', email: 'cleaner@example.invalid' };
  const event = {
    id: 's89-event', status: 'confirmed', organizer: { email: 'host@example.invalid' },
    attendees: [{ email: cleaner.email }],
    start: { dateTime: '2026-10-30T12:00:00+09:00' }, end: { dateTime: '2026-10-30T15:00:00+09:00' },
  };
  let events = [event], notices = 0, writes = 0, completeDuringRead = false;
  try {
    await db.connect(); await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query('CREATE TEMP TABLE propos_s89_jobs (LIKE public.cleaning_jobs INCLUDING ALL) ON COMMIT DROP');
    const { rows: [initial] } = await db.query(`
      INSERT INTO pg_temp.propos_s89_jobs
        (property_id, checkout_at, cleaning_start_at, cleaning_end_at, status, assigned_cleaner_id, google_event_id, source, data_origin)
      VALUES ('s89-property', '2026-10-30T02:00:00Z', '2026-10-30T02:00:00Z', '2026-10-30T05:00:00Z',
              'ASSIGNED', $1, $2, 'SHORT_NOTICE', 'REAL') RETURNING *`, [cleanerId, event.id]);
    const deps = {
      ...domain, toKstDateKey, kv: {}, CALENDAR_API: 'https://example.invalid',
      getGoogleToken: async () => 'fixture-token',
      db: { query: async (sql, params) => {
        if (sql.includes('FROM property_cleaning_config')) return { rows: [{ property_id: 's89-property', google_calendar_id: 's89-calendar' }] };
        if (sql.includes('FROM cleaners')) return { rows: [cleaner] };
        assert.ok(/^\s*(SELECT|UPDATE)\b/i.test(sql) && /\bcleaning_jobs\b/.test(sql), '예상하지 못한 쿼리');
        // 실제 API의 SQL을 실행하되 테이블 이름은 반드시 세션 임시 테이블로 치환한다.
        const result = await db.query(sql.replace(/\bcleaning_jobs\b/g, 'pg_temp.propos_s89_jobs'), params);
        if (/^\s*UPDATE/.test(sql)) writes += result.rowCount;
        if (/^\s*SELECT/.test(sql) && completeDuringRead && result.rows.length) {
          completeDuringRead = false;
          await db.query("UPDATE pg_temp.propos_s89_jobs SET status='COMPLETED' WHERE id=$1", [initial.id]);
        }
        return result;
      } },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ items: events }) }),
      readBody: async () => ({ calendar_id: 's89-calendar' }),
      sendJson: (res, status, body) => res.status(status).json(body),
      postSlack: async () => { notices++; }, sendCompletionSmsToRest: async () => { notices++; },
    };
    deps.resolveCalendarCleaner = load('resolveCalendarCleaner', deps);
    const repair = load('repairCalendarAssignments', deps);
    await t.test('연결된 배정은 예약 시각만 정정하고 두 번째 실행은 쓰기 0건', async () => {
      assert.equal((await repair('s89-property')).repaired, 1);
      const { rows: [after] } = await db.query('SELECT * FROM pg_temp.propos_s89_jobs');
      assert.equal(after.cleaning_start_at.toISOString(), '2026-10-30T03:00:00.000Z');
      assert.equal(after.cleaning_end_at.toISOString(), '2026-10-30T06:00:00.000Z');
      for (const key of Object.keys(initial)) {
        if (!['cleaning_start_at', 'cleaning_end_at', 'updated_at'].includes(key)) assert.deepEqual(after[key], initial[key]);
      }
      assert.equal((await repair('s89-property')).repaired, 0);
      assert.equal(notices, 0);
    });
    for (const name of ['handleCalendarWebhook', 'handleCalendarScan']) await t.test(name, async () => {
      events = [event]; notices = 0; writes = 0;
      await db.query("UPDATE pg_temp.propos_s89_jobs SET status='PENDING',assigned_cleaner_id=NULL,google_event_id=NULL,cleaning_start_at=checkout_at,cleaning_end_at=checkout_at+interval '3 hours'");
      const handler = load(name, deps);
      const req = { method: 'POST', headers: {
        'x-goog-resource-uri': 'https://example.invalid/calendars/s89-calendar/events',
        'x-goog-channel-token': process.env.GOOGLE_WEBHOOK_SECRET,
      } };
      const res = { status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; return this; } };
      await handler(req, res);
      assert.equal(res.code, 200); assert.equal(writes, 1);
      assert.equal(notices, name === 'handleCalendarWebhook' ? 2 : 1, '신규 배정의 기존 알림 경로 유지');
      notices = 0; writes = 0;
      await handler(req, res); assert.equal(writes, 0); assert.equal(notices, 0);
      events = [{ ...event, start: { dateTime: '2026-10-30T13:00:00+09:00' }, end: { dateTime: '2026-10-30T16:00:00+09:00' } }];
      await handler(req, res); assert.equal(writes, 1); assert.equal(notices, 0, '시간 변경은 배정 알림을 재발송하지 않음');
      events = [event]; writes = 0; completeDuringRead = true;
      await handler(req, res); assert.equal(writes, 0); assert.equal(notices, 0);
      const { rows: [after] } = await db.query('SELECT status FROM pg_temp.propos_s89_jobs');
      assert.equal(after.status, 'COMPLETED', '조회 직후 완료된 작업을 다시 ASSIGNED로 되돌리지 않음');
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
});
