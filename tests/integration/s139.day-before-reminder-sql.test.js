// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s139.day-before-reminder-sql.test.js
//
// ACT-18 — 하루 전 알림의 실제 SQL을 격리 DB(PGlite, 실제 스키마)에서 실행해, 내일(한국 날짜) 배정된 실제 청소만 고르는지 확인한다.
// 발송·Slack·예약 확인은 가짜로 바꾼다. 운영 DB·외부 요청 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { remindTomorrowCleanings } from '../../server/cleaning/_dayBeforeReminder.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const EVENING = new Date('2026-11-23T13:00:00.000Z'); // 11-23 22:00 KST

test('SQL: only real cleanings assigned for tomorrow (Korean date) are reminded', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  const { pool, cleanerId } = sql;
  const cases = [
    ['tomorrow 00:00 KST', '2026-11-23T15:00:00Z', 'ASSIGNED', 'REAL', true],
    ['tomorrow 11:00 KST', '2026-11-24T02:00:00Z', 'ASSIGNED', 'REAL', true],
    ['tomorrow 23:59 KST', '2026-11-24T14:59:00Z', 'ASSIGNED', 'REAL', true],
    ['today 23:30 KST', '2026-11-23T14:30:00Z', 'ASSIGNED', 'REAL', false],
    ['day after 00:00 KST', '2026-11-24T15:00:00Z', 'ASSIGNED', 'REAL', false],
    ['tomorrow but not assigned', '2026-11-24T03:00:00Z', 'NOTIFYING_BULK', 'REAL', false],
    ['tomorrow but simulated', '2026-11-24T04:00:00Z', 'ASSIGNED', 'SIMULATED', false],
  ];
  const expected = [];
  for (const [label, at, status, origin, remind] of cases) {
    const { rows: [job] } = await pool.query(`INSERT INTO cleaning_jobs(property_id,checkout_at,cleaning_start_at,status,assigned_cleaner_id,source,data_origin)
      VALUES('fixture-property',$1,$1,$2,$3,'MONTHLY_BATCH',$4) RETURNING id`, [at, status, status === 'ASSIGNED' ? cleanerId : null, origin]);
    if (remind) expected.push([job.id, label]);
  }
  const sent = [];
  const count = await remindTomorrowCleanings(pool, {
    now: EVENING,
    kv: { get: async () => null, set: async () => 'OK' },
    notify: async (_db, cleaner, message) => { sent.push([cleaner.id, message.body]); return { ok: true, channel: 'FCM' }; },
    postSlack: async () => { throw new Error('operator must not be alerted'); },
    isCheckoutCancelled: async () => false,
  });
  assert.equal(count, expected.length);
  assert.deepEqual(sent.map(([id]) => id), expected.map(() => cleanerId));
  assert.deepEqual(sent.map(([, body]) => body), [
    'Fixture Property 내일 00:00 청소가 있습니다',
    'Fixture Property 내일 11:00 청소가 있습니다',
    'Fixture Property 내일 23:59 청소가 있습니다',
  ]);
});
