// PGLITE_TEST_ROOT=/private/tmp/propos-act11-sql node --test tests/integration/s118.monthly-reservation-sql.test.js
// Or an isolated CLEANING_TEST_DATABASE_URL. No production DB, calendars or notifications.
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as calendar from '../../server/cleaning/_calendar.js';
import { calcCleaningTimes, planJobDispatch, toKstDateKey } from '../../server/cleaning/_dispatch.js';
import { parseVEvents, airbnbEventsToReservations } from '../../src/domain/room-state/icalParser.js';
import { reservationUidOf } from '../../server/cleaning/_reservationSync.js';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T00:00:00Z') });
after(() => mock.timers.reset());

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const source = readFileSync(new URL('../../api/cron/[...slug].js', import.meta.url), 'utf8');
const node = parse(source, { sourceType: 'module' }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'handleMonthlyClean');
const days = calendar.getNextMonthDates();
const date = days[12], inDate = days[10];

function feed({ uid = 'booking-1', blocked = false } = {}) {
  return ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `DTSTART;VALUE=DATE:${inDate.replaceAll('-', '')}`,
    `DTEND;VALUE=DATE:${date.replaceAll('-', '')}`, ...(uid ? [`UID:${uid}`] : []),
    `SUMMARY:${blocked ? 'Airbnb (Not available)' : 'Reserved'}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

const scenarios = [
  { name: '예약 불가·번호 없음: 예약도 청소도 생성하지 않음', uid: null, blocked: true, persist: false, jobs: 0, failed: 0 },
  { name: '정상 숙박·번호 없음: 기존 예약의 합성키·출처로 연결', uid: null, persist: true, jobs: 1, failed: 0 },
  { name: '정상 숙박·번호 있음: 기존 예약 관계·출처 보존', uid: 'booking-1', persist: true, jobs: 1, failed: 0 },
  { name: '줄 접힌 번호: 기존 예약과 같은 키로 저장', uid: 'booking-\r\n 1', persist: true, jobs: 1, failed: 0 },
  { name: '두 번째 피드에만 등장한 예약: FK를 우회하지 않음', uid: 'not-yet-stored', persist: false, jobs: 0, failed: 1 },
  { name: '번호 없는 미저장 예약도 FK를 우회하지 않음', uid: null, persist: false, jobs: 0, failed: 1 },
];

for (const scenario of scenarios) test(`월간 SQL — ${scenario.name}`, { skip: !enabled }, async () => {
  const f = await createCleaningSqlFixture();
  try {
    await f.pool.query('DELETE FROM cleaning_jobs WHERE id=$1', [f.jobId]);
    await f.pool.query("UPDATE property_cleaning_config SET ical_url='https://example.invalid/feed.ics',checkout_hour=11,cleaning_duration_hours=3");
    const text = feed(scenario);
    const reservations = airbnbEventsToReservations(parseVEvents(text));
    if (scenario.persist) for (const reservation of reservations) {
      await f.pool.query(`INSERT INTO property_reservations(property_id,reservation_uid,check_in,check_out,source_system,data_origin)
        VALUES('fixture-property',$1,$2,$3,'AIRBNB_ICAL','REAL')`,
      [reservationUidOf('fixture-property', reservation), reservation.checkIn.toISOString(), reservation.checkOut.toISOString()]);
    }
    const deps = { ...calendar, calcCleaningTimes, planJobDispatch, toKstDateKey,
      parseVEvents, airbnbEventsToReservations, reservationUidOf,
      kv: {}, getGoogleToken: async () => { throw new Error('fixture: no Google'); },
      fetch: async url => { assert.equal(url, 'https://example.invalid/feed.ics'); return { ok: true, text: async () => text }; },
      postSlack: async () => true, console: { error() {} },
    };
    const handler = new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler(f.pool, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.jobsFailed, scenario.failed);
    const { rows } = await f.pool.query('SELECT * FROM cleaning_jobs');
    assert.equal(rows.length, scenario.jobs);
    if (!rows.length) return;
    const key = reservationUidOf('fixture-property', reservations[0]);
    assert.equal(rows[0].reservation_uid, key);
    assert.equal(rows[0].source_ref, key);
    assert.equal(rows[0].data_origin, 'REAL');
    assert.equal(toKstDateKey(rows[0].checkout_at), date);
    assert.equal(new Date(rows[0].dispatch_after).getTime(), new Date(rows[0].cleaning_start_at).getTime() - 14 * 86_400_000);
    const originalId = rows[0].id;
    await handler(f.pool, res);
    assert.equal(res.body.jobsCreated, 0);
    assert.equal(res.body.jobsFailed, 0, '동일 피드 재실행은 생성 실패가 아니라 기존 작업 건너뛰기');
    const after = (await f.pool.query('SELECT * FROM cleaning_jobs')).rows;
    assert.equal(after.length, 1, '동일 피드 재실행은 청소 작업을 늘리지 않음');
    assert.equal(after[0].id, originalId);
    assert.equal(after[0].reservation_uid, key);
    assert.equal(after[0].source_ref, key);
  } finally { await f.close(); }
});
