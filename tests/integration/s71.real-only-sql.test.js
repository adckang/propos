// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s71.real-only-sql.test.js
//
// s71 SQL — 가상(SIMULATED) 숙소·일정에는 실제 담당자 요청·재안내·배정 실패 알림·칸 열기·차단 생성이 나가지 않는다.
// 실제 정기 작업 모듈(api/cron)을 그대로 실행하고 DB 조회만 격리 DB(PGlite 또는 격리 로컬 DB)로 보낸다.
// 발송·Slack·구글 캘린더·iCal은 기록만 하는 가짜. 운영 DB·외부 요청 없음.
//
// DB 규칙 쪽: 모든 표의 출처 칸은 REAL/SIMULATED만, 예약 번호는 숙소마다 하나, 예약·청소 일정은 등록된 숙소에만.
// 스키마 파일로 만든 이 임시 DB의 제약이 운영 DB(2026-11-19 읽기 전용 카탈로그 비교)와 같은지도 확인한다(RF-36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';
import { calcCleaningTimes, planJobDispatch, toKstDateKey } from '../../server/cleaning/_dispatch.js';
import { getNextMonthDates } from '../../server/cleaning/_calendar.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const REAL = 'fixture-property', SIM = 'sim-property';

async function database(t) {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  await sql.pool.query('DELETE FROM cleaning_jobs WHERE id=$1', [sql.jobId]); // 도구의 기본 일정은 이 시나리오와 무관
  await sql.pool.query(`UPDATE property_cleaning_config SET google_calendar_id='real-cal', ical_url='https://fixture.invalid/real.ics' WHERE property_id=$1`, [REAL]);
  await sql.pool.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin,google_calendar_id,ical_url)
    VALUES($1,'Sim Property','SIMULATED','sim-cal','https://fixture.invalid/sim.ics')`, [SIM]);
  return sql;
}
const originOf = property => property === SIM ? 'SIMULATED' : 'REAL';
async function job(pool, property, { status, startAt, dispatchAfter = new Date(Date.now() - HOUR) }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO cleaning_jobs(property_id,checkout_at,cleaning_start_at,status,source,data_origin,dispatch_after)
     VALUES($1,$2,$2,$3,'MONTHLY_BATCH',$4,$5) RETURNING id`,
    [property, new Date(startAt).toISOString(), status, originOf(property), new Date(dispatchAfter).toISOString()]);
  return row.id;
}
let tokenSeq = 0;
async function notif(pool, jobId, cleanerId, property, { sentAgo, remindedAgo = null }) {
  const token = String(++tokenSeq).padStart(6, '0');
  const { rows: [row] } = await pool.query(
    `INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token,sent_at,reminded_at,data_origin)
     VALUES($1,$2,'BULK',$3,$4,$5,$6) RETURNING id`,
    [jobId, cleanerId, token, new Date(Date.now() - sentAgo).toISOString(),
      remindedAgo == null ? null : new Date(Date.now() - remindedAgo).toISOString(), originOf(property)]);
  return row.id;
}

async function runCron(t, sql, action, behavior) {
  const { default: handler } = await actualCronModule();
  const io = installCronIO({ behavior: { 'db.query': (text, params) => sql.pool.query(text, params), ...behavior } });
  t.after(() => io.restore());
  const res = cronResponse();
  await handler({ method: 'GET', url: `/api/cron/${action}`, query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
  return res;
}
const statusOf = async (pool, id) => (await pool.query('SELECT status FROM cleaning_jobs WHERE id=$1', [id])).rows[0].status;

test('SQL: the follow-up job requests, reopens, reminds and escalates only REAL jobs', { skip: !enabled }, async t => {
  const sql = await database(t);
  const { pool, cleanerId } = sql;
  const start = (days) => Date.now() + (10 + days) * DAY;
  const ids = {};
  for (const property of [REAL, SIM]) {
    const key = property === SIM ? 'sim' : 'real';
    // ① 요청 시각이 지난 "요청 전" 일정 → 첫 요청
    ids[`${key}Ready`] = await job(pool, property, { status: 'PENDING', startAt: start(0) });
    // ② 요청이 나갔는데 그날 칸이 아직 막힘 → 칸 다시 열기
    ids[`${key}Blocked`] = await job(pool, property, { status: 'NOTIFYING_VIP_1', startAt: start(1) });
    await pool.query(`INSERT INTO property_calendar_blockers(property_id,block_date,event_id,data_origin) VALUES($1,$2,'evt',$3)`,
      [property, toKstDateKey(new Date(start(1))), originOf(property)]);
    // ③ 단체 요청 2시간 전, 답 없음 → 재안내
    ids[`${key}Remind`] = await job(pool, property, { status: 'NOTIFYING_BULK', startAt: start(2) });
    ids[`${key}RemindNotif`] = await notif(pool, ids[`${key}Remind`], cleanerId, property, { sentAgo: 2 * HOUR });
    // ④ 단체 요청 4시간 전, 재안내도 함 → 배정 실패로 넘기고 Slack
    ids[`${key}Escalate`] = await job(pool, property, { status: 'BULK_REMINDED', startAt: start(3) });
    await notif(pool, ids[`${key}Escalate`], cleanerId, property, { sentAgo: 4 * HOUR, remindedAgo: 3 * HOUR });
  }
  const advanced = [], reopened = [], reminded = [], slack = [];
  const res = await runCron(t, sql, 'cleaning-followup', {
    advanceJob: async (_db, j) => { advanced.push(j.id); return { ok: true }; },
    openCleaningSlot: async (_db, slot) => { reopened.push(slot); },
    notify: async (_db, _cleaner, message) => { reminded.push(message.notifId); return { ok: true }; },
    postSlack: async text => { slack.push(text); return true; },
  });

  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, advanced: 1, reminded: 1, escalated: 1 });
  assert.deepEqual(advanced, [ids.realReady]);
  assert.deepEqual(reopened.map(s => s.propertyId), [REAL]);
  assert.deepEqual(reminded, [ids.realRemindNotif]);
  assert.equal(slack.length, 1); assert.ok(slack[0].includes(REAL)); assert.ok(!slack[0].includes(SIM));
  // DB: 실제 일정만 바뀌고 가상 일정은 그대로
  assert.equal(await statusOf(pool, ids.realRemind), 'BULK_REMINDED');
  assert.equal(await statusOf(pool, ids.simRemind), 'NOTIFYING_BULK');
  assert.equal(await statusOf(pool, ids.realEscalate), 'ESCALATED');
  assert.equal(await statusOf(pool, ids.simEscalate), 'BULK_REMINDED');
  const { rows: simNotif } = await pool.query('SELECT reminded_at FROM cleaning_notifs WHERE id=$1', [ids.simRemindNotif]);
  assert.equal(simNotif[0].reminded_at, null);
});

test('SQL: the monthly batch blocks, polls and schedules only REAL properties and jobs', { skip: !enabled }, async t => {
  const sql = await database(t);
  const { pool } = sql;
  const days = getNextMonthDates().slice(10, 12);
  const startAt = Date.parse(`${days[0]}T02:00:00Z`), initial = '2026-01-01T00:00:00.000Z';
  const realJob = await job(pool, REAL, { status: 'PENDING', startAt, dispatchAfter: initial });
  const simJob = await job(pool, SIM, { status: 'PENDING', startAt: startAt + HOUR, dispatchAfter: initial });
  const blockers = [], fetched = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: true, text: async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' }; };
  t.after(() => { globalThis.fetch = savedFetch; });

  const res = await runCron(t, sql, 'monthly-cleaning', {
    getGoogleToken: async () => 'fixture-google-token',
    getNextMonthDates: () => days,
    createBlockerEvent: async (calendarId, date, _h, _d, propertyId) => { blockers.push({ calendarId, date, propertyId }); return `evt-${date}`; },
    calcCleaningTimes, planJobDispatch, toKstDateKey,
  });

  assert.equal(res.code, 200);
  assert.deepEqual(blockers.map(b => [b.calendarId, b.propertyId]), [['real-cal', REAL], ['real-cal', REAL]]);
  assert.deepEqual(fetched, ['https://fixture.invalid/real.ics']);
  const { rows } = await pool.query('SELECT property_id FROM property_calendar_blockers ORDER BY 1');
  assert.deepEqual([...new Set(rows.map(r => r.property_id))], [REAL]);
  const dispatchAfter = async id => (await pool.query('SELECT dispatch_after FROM cleaning_jobs WHERE id=$1', [id])).rows[0].dispatch_after.toISOString();
  assert.equal(await dispatchAfter(realJob), new Date(startAt - 14 * DAY).toISOString(), 'REAL job scheduled 2 weeks ahead');
  assert.equal(await dispatchAfter(simJob), initial, 'SIMULATED job untouched');
  assert.equal(res.body.scheduled, 1);
});

// ── DB 규칙: 출처 칸과 숙소 연결 ────────────────────────────────────────────────

test('SQL: every table accepts only REAL or SIMULATED as the origin, and defaults to REAL', { skip: !enabled }, async t => {
  const sql = await database(t);
  const { pool, cleanerId } = sql;
  const jobId = await job(pool, REAL, { status: 'PENDING', startAt: Date.now() + 20 * DAY });
  const schema = await readFile(new URL('../../data/schema.sql', import.meta.url), 'utf8');
  await sql.engine.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS events')));
  const inserts = {
    property_cleaning_config: [`(property_id,name) VALUES('origin-check','Origin Check')`],
    property_reservations: [`(property_id,reservation_uid,check_in,check_out,source_system) VALUES('${REAL}','origin-check','2026-12-01T06:00Z','2026-12-03T02:00Z','AIRBNB_ICAL')`],
    cleaning_jobs: [`(property_id,checkout_at,cleaning_start_at,source) VALUES('${REAL}','2026-12-09T02:00Z','2026-12-09T02:00Z','MONTHLY_BATCH')`],
    cleaning_notifs: [`(job_id,cleaner_id,tier,token) VALUES('${jobId}','${cleanerId}','BULK','ORIGIN')`],
    property_calendar_blockers: [`(property_id,block_date,event_id) VALUES('${REAL}','2026-12-10','evt')`],
    events: [`(property_id,type,device_time,data) VALUES('${REAL}','CHECKOUT_DETECTED','2026-12-10T02:00Z','{}')`],
  };
  for (const [table, [values]] of Object.entries(inserts)) {
    const withOrigin = values.replace(/\) VALUES\(/, ',data_origin) VALUES(').replace(/\)$/, ",'FAKE')");
    await assert.rejects(pool.query(`INSERT INTO ${table}${withOrigin}`), e => e.code === '23514', `${table} refuses FAKE`);
    const { rows } = await pool.query(`INSERT INTO ${table}${values} RETURNING data_origin`);
    assert.equal(rows[0].data_origin, 'REAL', `${table} defaults to REAL`);
  }
});

test('SQL: a reservation number is unique per property, and reservations and jobs need a registered property', { skip: !enabled }, async t => {
  const sql = await database(t);
  const { pool } = sql;
  const reservation = (property, uid) => pool.query(`INSERT INTO property_reservations(property_id,reservation_uid,check_in,check_out,source_system,data_origin)
    VALUES($1,$2,'2026-12-01T06:00Z','2026-12-03T02:00Z','AIRBNB_ICAL',$3)`, [property, uid, originOf(property)]);
  await reservation(REAL, 'booking-1');
  await assert.rejects(reservation(REAL, 'booking-1'), e => e.code === '23505');
  await reservation(SIM, 'booking-1'); // 다른 숙소의 같은 번호는 괜찮다
  await assert.rejects(reservation('unknown-property', 'booking-2'), e => e.code === '23503');
  await assert.rejects(job(pool, 'unknown-property', { status: 'PENDING', startAt: Date.now() + 20 * DAY }), e => e.code === '23503');
  // 청소 일정이 가리키는 예약은 있어야 한다(트랜잭션 끝에 검사 — 이름 변경 때 순서를 풀기 위해, D-032)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO cleaning_jobs(property_id,reservation_uid,checkout_at,cleaning_start_at,source)
      VALUES($1,'no-such-booking','2026-12-03T02:00Z','2026-12-03T02:00Z','MONTHLY_BATCH')`, [REAL]);
    await assert.rejects(client.query('COMMIT'), e => e.code === '23503');
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
});

// RF-36(2026-11-19 사용자 승인 "넣어"): 운영 DB의 숙소 연결(FK)을 스키마 파일에도 — 이 임시 DB가 운영과 같게 만들어진다.
test('SQL: blockers and events also need a registered property (as in production)', { skip: !enabled }, async t => {
  const sql = await database(t);
  const schema = await readFile(new URL('../../data/schema.sql', import.meta.url), 'utf8');
  await sql.engine.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS events')));
  await assert.rejects(sql.pool.query(`INSERT INTO property_calendar_blockers(property_id,block_date,event_id) VALUES('unknown-property','2026-12-10','evt')`), e => e.code === '23503');
  await assert.rejects(sql.pool.query(`INSERT INTO events(property_id,type,device_time,data) VALUES('unknown-property','CHECKOUT_DETECTED','2026-12-10T02:00Z','{}')`), e => e.code === '23503');
});

// 운영 DB 제약 이름(2026-11-19 BEGIN READ ONLY 카탈로그 조회, 표 6개 — 외래키·유일·검사). 운영을 바꾸면 스키마 파일과 이 목록을 함께 고친다.
const PRODUCTION_CONSTRAINTS = `cleaning_jobs|cleaning_jobs_assigned_cleaner_id_fkey;cleaning_jobs|cleaning_jobs_data_origin_check;cleaning_jobs|cleaning_jobs_property_fk;cleaning_jobs|cleaning_jobs_property_id_checkout_at_key;cleaning_jobs|cleaning_jobs_reservation_fk;cleaning_jobs|cleaning_jobs_source_check;cleaning_jobs|cleaning_jobs_status_check;cleaning_notifs|cleaning_notifs_channel_check;cleaning_notifs|cleaning_notifs_cleaner_id_fkey;cleaning_notifs|cleaning_notifs_data_origin_check;cleaning_notifs|cleaning_notifs_initial_delivery_check;cleaning_notifs|cleaning_notifs_job_id_cleaner_id_key;cleaning_notifs|cleaning_notifs_job_id_fkey;cleaning_notifs|cleaning_notifs_response_check;cleaning_notifs|cleaning_notifs_token_key;events|events_data_origin_check;events|events_property_fk;events|events_property_id_type_device_time_key;events|events_status_check;property_calendar_blockers|property_calendar_blockers_data_origin_check;property_calendar_blockers|property_calendar_blockers_property_fk;property_cleaning_config|property_cleaning_config_data_origin_check;property_cleaning_config|property_cleaning_config_name_unique;property_reservations|property_reservations_check;property_reservations|property_reservations_data_origin_check;property_reservations|property_reservations_property_fk;property_reservations|property_reservations_property_id_reservation_uid_key;property_reservations|property_reservations_status_check`.split(';');
const constraintNames = async (pool) => (await pool.query(`SELECT conrelid::regclass::text || '|' || conname AS k FROM pg_constraint
  WHERE conrelid::regclass::text IN ('property_cleaning_config','property_reservations','cleaning_jobs','cleaning_notifs','property_calendar_blockers','events')
    AND contype IN ('f','u','c') ORDER BY 1`)).rows.map(r => r.k);

test('SQL: a DB built from the schema files has the same constraints as production', { skip: !enabled }, async t => {
  const sql = await database(t);
  const schema = await readFile(new URL('../../data/schema.sql', import.meta.url), 'utf8');
  await sql.engine.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS events')));
  assert.deepEqual(await constraintNames(sql.pool), [...PRODUCTION_CONSTRAINTS].sort());
  // 숙소 연결은 모두 운영처럼 "숙소 이름이 바뀌면 따라간다"(D-032)
  const { rows } = await sql.pool.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE '%\_property\_fk'`);
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.def, 'FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE', r.conname);
});

test('SQL: the event link is added whichever schema file is applied first', { skip: !process.env.PGLITE_TEST_ROOT }, async () => {
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { PGlite } = await import(pathToFileURL(resolve(process.env.PGLITE_TEST_ROOT, 'node_modules/@electric-sql/pglite/dist/index.js')));
  const db = await PGlite.create();
  try {
    const events = await readFile(new URL('../../data/schema.sql', import.meta.url), 'utf8');
    await db.exec(events.slice(events.indexOf('CREATE TABLE IF NOT EXISTS events'))); // 이벤트 표 먼저(숙소 표 없음 → 연결은 아직)
    await db.exec(await readFile(new URL('../../data/schema-cleaning.sql', import.meta.url), 'utf8'));
    const { rows } = await db.query(`SELECT 1 FROM pg_constraint WHERE conname='events_property_fk'`);
    assert.equal(rows.length, 1);
    // schema.sql 은 운영에도 다시 적용하는 파일(scripts/apply-schema.mjs) — 다시 돌려도 아무것도 바뀌지 않는다
    // (schema-cleaning.sql 은 예전부터 두 번 적용하면 예약 연결 추가 문장에서 멈춘다 — 새 DB용, RF-36 관찰)
    await db.exec(events.slice(events.indexOf('CREATE TABLE IF NOT EXISTS events')));
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%\_property\_fk'`)).rows[0].n, 4);
  } finally { await db.close(); }
});
