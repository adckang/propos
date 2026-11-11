// PGLITE_TEST_ROOT=/private/tmp/propos-act11-sql node --test tests/integration/s113.vanished-reservations-sql.test.js
// Or CLEANING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/propos_delivery_test
// All tables/mutations are in memory or a disposable local schema. No service DB.
//
// RF-16: 피드에서 사라진 예약 정리 — 실제 SQL 로 번호 재발행·진짜 취소·같은 번호의 날짜 변경·겹친 동기화·잘린 피드·빈 피드·
// 지난 예약·다른 숙소를 확인하고, 실제 발송 함수(advanceJob)가 퇴실이 없어진 날에만 요청을 보내지 않는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture, actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const dispatch = await actualCleaningModule('server/cleaning/_dispatch.js');
const sync = await actualCleaningModule('server/cleaning/_reservationSync.js');

// 픽스처 작업: fixture-property, 퇴실 2026-11-10 11:00 KST(02:00Z), PENDING. 기준 시각은 그보다 앞
const NOW = new Date('2026-11-01T00:00:00Z');
const SYNC_STARTED = new Date('2026-10-31T23:59:00Z'); // 이번 동기화가 시작된 시각
const BEFORE_SYNC = '2026-10-20T00:00:00Z';           // 지난 동기화에서 마지막으로 본 시각

async function run(options, fn) {
  const io = installDeliveryIO(options.io);
  let f;
  try {
    f = await createCleaningSqlFixture();
    await f.pool.query(`INSERT INTO property_cleaning_config(property_id,name,data_origin) VALUES('other-property','Other',$1)`, ['REAL']);
    await fn(f, io);
  } finally { try { await f?.close(); } finally { io.restore(); } }
}

const reservation = (pool, propertyId, uid, checkIn, checkOut, { status = 'ACTIVE', lastSeen = BEFORE_SYNC } = {}) => pool.query(
  `INSERT INTO property_reservations(property_id,reservation_uid,check_in,check_out,status,source_system,data_origin,last_seen_at)
   VALUES($1,$2,$3,$4,$5,'AIRBNB_ICAL','REAL',$6)`, [propertyId, uid, checkIn, checkOut, status, lastSeen]);
const statusOf = async (pool, propertyId, uid) =>
  (await pool.query('SELECT status FROM property_reservations WHERE property_id=$1 AND reservation_uid=$2', [propertyId, uid])).rows[0]?.status;
const retire = (f, seenUids, extra = {}) =>
  sync.retireVanishedReservations(f.pool, { propertyId: 'fixture-property', seenUids, syncStartedAt: SYNC_STARTED, now: NOW, ...extra });
const goneJobs = f => sync.listGoneCheckoutJobs(f.pool, { propertyId: 'fixture-property', now: NOW });

test('SQL: 번호만 바뀐 재발행 — 옛 번호는 취소, 같은 날 새 예약이 있어 알림 없음, 요청은 그대로 나간다', { skip: !enabled }, () => run({}, async (f, io) => {
  await reservation(f.pool, 'fixture-property', 'old-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
  await reservation(f.pool, 'fixture-property', 'new-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
  await f.pool.query(`UPDATE cleaning_jobs SET reservation_uid='old-uid' WHERE id=$1`, [f.jobId]); // 작업은 옛 번호에 묶여 있다(운영과 같은 모양)
  const result = await retire(f, ['new-uid']);
  assert.deepEqual(result.retired.map(row => row.reservation_uid), ['old-uid']);
  assert.equal(await statusOf(f.pool, 'fixture-property', 'new-uid'), 'ACTIVE');
  assert.deepEqual(await goneJobs(f), []);
  await dispatch.advanceJob(f.pool, await f.currentJob());
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1', '살아 있는 예약이 있으니 평소대로 요청');
  assert.equal(io.calls.sms.length, 1);
}));

test('SQL: 진짜 취소 — 예약은 취소, 그날 작업을 알릴 목록에 넣고, 새 요청은 보내지 않는다(작업·기록 그대로)', { skip: !enabled }, () => run({}, async (f, io) => {
  await reservation(f.pool, 'fixture-property', 'gone-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
  await reservation(f.pool, 'fixture-property', 'kept-uid', '2026-11-20T06:00:00Z', '2026-11-22T02:00:00Z');
  const result = await retire(f, ['kept-uid']);
  assert.deepEqual(result.retired.map(row => row.reservation_uid), ['gone-uid']);
  assert.deepEqual((await goneJobs(f)).map(job => [job.id, job.status, job.has_cleaner]), [[f.jobId, 'PENDING', false]]);

  const sent = await dispatch.advanceJob(f.pool, await f.currentJob());
  assert.deepEqual(sent, { ok: false, state: 'CANCELLED', errorCode: 'RESERVATION_CANCELLED' });
  assert.equal((await f.currentJob()).status, 'PENDING', '작업은 운영자가 정하도록 그대로');
  assert.equal(io.calls.sms.length + io.calls.push.length, 0);
  assert.equal((await f.notifications()).length, 0, '30분마다 다시 시도해도 기록이 쌓이지 않는다');

  // 예약이 피드에 다시 나타나 "예약됨"이 되면 평소대로 보낸다
  await f.pool.query(`UPDATE property_reservations SET status='ACTIVE' WHERE reservation_uid='gone-uid'`);
  await dispatch.advanceJob(f.pool, await f.currentJob());
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
}));

test('SQL: 같은 번호로 날짜만 바뀜 — 옛 날짜 작업은 퇴실이 없어진 것으로 보고 알림·발송 차단', { skip: !enabled }, () => run({}, async (f, io) => {
  // 손님이 11/10 퇴실을 11/12 로 바꿈 → 동기화가 같은 번호의 행을 새 날짜로 갱신했다
  await reservation(f.pool, 'fixture-property', 'moved-uid', '2026-11-08T06:00:00Z', '2026-11-12T02:00:00Z', { lastSeen: NOW.toISOString() });
  await f.pool.query(`UPDATE cleaning_jobs SET reservation_uid='moved-uid' WHERE id=$1`, [f.jobId]);
  assert.deepEqual((await retire(f, ['moved-uid'])).retired, [], '예약 자체는 살아 있다');
  assert.deepEqual((await goneJobs(f)).map(job => job.id), [f.jobId]);
  assert.equal(await sync.isCheckoutCancelled(f.pool, await f.currentJob()), true);
  assert.deepEqual(await dispatch.advanceJob(f.pool, await f.currentJob()), { ok: false, state: 'CANCELLED', errorCode: 'RESERVATION_CANCELLED' });
  assert.equal(io.calls.sms.length, 0);
}));

test('SQL: 겹쳐 돈 다른 동기화가 방금 넣은 새 예약은 피드에 없어도 취소하지 않는다', { skip: !enabled }, () => run({}, async f => {
  await reservation(f.pool, 'fixture-property', 'just-added', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z', { lastSeen: '2026-11-01T00:00:30Z' });
  await reservation(f.pool, 'fixture-property', 'stale-uid', '2026-11-20T06:00:00Z', '2026-11-22T02:00:00Z');
  const result = await retire(f, ['something-else']);
  assert.deepEqual(result.retired.map(row => row.reservation_uid), ['stale-uid']);
  assert.equal(await statusOf(f.pool, 'fixture-property', 'just-added'), 'ACTIVE');
}));

test('SQL: 미래 예약이 한꺼번에 절반 넘게(3건 이상) 사라지면 잘린 피드일 수 있어 아무것도 바꾸지 않는다', { skip: !enabled }, () => run({}, async f => {
  for (const [uid, day] of [['a', 10], ['b', 14], ['c', 18], ['d', 22]]) {
    await reservation(f.pool, 'fixture-property', uid, `2026-11-${day - 2}T06:00:00Z`, `2026-11-${day}T02:00:00Z`);
  }
  assert.deepEqual(await retire(f, ['d']), { retired: [], skipped: 'MASS_VANISH' });
  for (const uid of ['a', 'b', 'c']) assert.equal(await statusOf(f.pool, 'fixture-property', uid), 'ACTIVE');
  assert.deepEqual((await retire(f, ['b', 'c', 'd'])).retired.map(row => row.reservation_uid), ['a'], '한두 건은 평소대로 정리');
}));

test('SQL: 피드에 예약이 하나도 없으면(일시 장애·"예약 불가" 표시뿐) 아무것도 바꾸지 않는다', { skip: !enabled }, () => run({}, async f => {
  await reservation(f.pool, 'fixture-property', 'kept-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
  assert.deepEqual(await retire(f, []), { retired: [], skipped: 'NO_RESERVATIONS' });
  assert.equal(await statusOf(f.pool, 'fixture-property', 'kept-uid'), 'ACTIVE');
}));

test('SQL: 지난 예약·다른 숙소·이미 취소된 예약은 건드리지 않는다', { skip: !enabled }, () => run({}, async f => {
  await reservation(f.pool, 'fixture-property', 'past-uid', '2026-10-20T06:00:00Z', '2026-10-22T02:00:00Z'); // 피드에서 자연히 빠진 지난 숙박
  await reservation(f.pool, 'other-property', 'other-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
  await reservation(f.pool, 'fixture-property', 'already-uid', '2026-11-25T06:00:00Z', '2026-11-27T02:00:00Z', { status: 'CANCELLED' });
  await reservation(f.pool, 'fixture-property', 'seen-uid', '2026-11-28T06:00:00Z', '2026-11-29T02:00:00Z');
  const result = await retire(f, ['seen-uid']);
  assert.deepEqual(result.retired, []);
  assert.equal(await statusOf(f.pool, 'fixture-property', 'past-uid'), 'ACTIVE');
  assert.equal(await statusOf(f.pool, 'other-property', 'other-uid'), 'ACTIVE');
}));

test('SQL: 알림 목록은 살아 있는 작업만 — 배정된 담당자 이름을 함께 주고, 취소된 작업은 뺀다', { skip: !enabled }, () => run({}, async f => {
  await reservation(f.pool, 'fixture-property', 'gone-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z', { status: 'CANCELLED' });
  await f.pool.query(`UPDATE cleaning_jobs SET status='ASSIGNED', assigned_cleaner_id=$1 WHERE id=$2`, [f.cleanerId, f.jobId]);
  assert.deepEqual((await goneJobs(f)).map(job => [job.status, job.has_cleaner, job.cleaner_name]), [['ASSIGNED', true, 'Fixture Cleaner']]);
  await f.pool.query(`UPDATE cleaning_jobs SET status='CANCELLED' WHERE id=$1`, [f.jobId]);
  assert.deepEqual(await goneJobs(f), []);
}));

test('SQL: 예약 기록이 아예 없는 날의 작업은 판단 근거가 없어 평소대로 보낸다(옛 작업·다른 경로로 만든 작업)', { skip: !enabled }, () => run({}, async (f, io) => {
  assert.equal(await sync.isCheckoutCancelled(f.pool, await f.currentJob()), false);
  assert.deepEqual(await goneJobs(f), []);
  await dispatch.advanceJob(f.pool, await f.currentJob());
  assert.equal((await f.currentJob()).status, 'NOTIFYING_VIP_1');
  assert.equal(io.calls.sms.length, 1);
}));

test('SQL: 진행 중이던 요청은 퇴실이 없어진 동안 다시 보내지 않고 기록도 그대로 — 예약이 돌아오면 이어서 보낸다', { skip: !enabled },
  () => run({ io: { sms: async () => ({ ok: false, status: 429, text: async () => 'busy' }) } }, async (f, io) => {
    await reservation(f.pool, 'fixture-property', 'gone-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z');
    await dispatch.advanceJob(f.pool, await f.currentJob()); // 첫 시도는 "잠시 후 다시" 로 끝난다
    const [first] = await f.notifications();
    assert.equal(first.initial_delivery_state, 'RETRYABLE');
    assert.equal(io.calls.sms.length, 1);
    const retryNow = () => f.pool.query(`UPDATE cleaning_notifs SET initial_delivery_data = initial_delivery_data || '{"nextAttemptAt":"2000-01-01T00:00:00Z"}'::jsonb WHERE id=$1`, [first.id]);

    await f.pool.query(`UPDATE property_reservations SET status='CANCELLED' WHERE reservation_uid='gone-uid'`);
    await retryNow();
    assert.deepEqual(await dispatch.advanceJob(f.pool, await f.currentJob()), { ok: false, state: 'CANCELLED', errorCode: 'RESERVATION_CANCELLED' });
    const [held] = await f.notifications();
    assert.equal(held.initial_delivery_state, 'RETRYABLE', '피드가 한 번 흔들린 것일 수 있어 요청을 끝내지 않는다');
    assert.equal(io.calls.sms.length, 1, '다시 보내지 않는다');

    await f.pool.query(`UPDATE property_reservations SET status='ACTIVE' WHERE reservation_uid='gone-uid'`);
    await retryNow();
    await dispatch.advanceJob(f.pool, await f.currentJob());
    assert.equal(io.calls.sms.length, 2, '예약이 돌아오면 이어서 보낸다');
  }));

test('SQL: 피드에서 한 시간이 안 되게 빠진 예약은 아직 취소로 보지 않는다 (한 번 흔들린 피드)', { skip: !enabled }, () => run({}, async f => {
  await reservation(f.pool, 'fixture-property', 'blip-uid', '2026-11-08T06:00:00Z', '2026-11-10T02:00:00Z', { lastSeen: '2026-10-31T23:29:00Z' });
  await reservation(f.pool, 'fixture-property', 'kept-uid', '2026-11-20T06:00:00Z', '2026-11-22T02:00:00Z');
  assert.deepEqual((await retire(f, ['kept-uid'])).retired, []);
  assert.equal(await statusOf(f.pool, 'fixture-property', 'blip-uid'), 'ACTIVE');
}));
