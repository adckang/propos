// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s148.rf25-reservation-identity-sql.test.js
// RF-25 내부 숙박·청소 의무 발급을 실제 PostgreSQL 호환 엔진에서 검증한다. 운영 DB·외부 요청 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture, actualCleaningModule } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const identity = enabled ? await actualCleaningModule('server/cleaning/_reservationIdentity.js') : null;
const migration = () => readFile(new URL('../../data/migrate-automation-anomalies.sql', import.meta.url), 'utf8');
const PROPERTY = 'fixture-property';

const reservation = (uid, checkIn, checkOut) => ({
  propertyId: PROPERTY,
  reservationUid: uid,
  guestName: null,
  platform: 'Airbnb',
  checkIn,
  checkOut,
  sourceRef: 'https://example.invalid/fixture.ics',
  rawData: { uid },
  dataOrigin: 'REAL',
});

async function harness(t) {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  await f.engine.exec(await migration());
  return f;
}

test('RF-25 신원: 같은 UID의 A→B→A는 숙박 하나와 끝난 의무 둘·현재 의무 하나다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const first = await identity.saveReservationIdentity(f.pool, reservation(
    'same-uid', '2026-12-01T06:00:00Z', '2026-12-03T02:00:00Z'));
  const moved = await identity.saveReservationIdentity(f.pool, reservation(
    'same-uid', '2026-12-02T06:00:00Z', '2026-12-04T02:00:00Z'));
  const returned = await identity.saveReservationIdentity(f.pool, reservation(
    'same-uid', '2026-12-01T06:00:00Z', '2026-12-03T02:00:00Z'));

  assert.equal(moved.stayId, first.stayId);
  assert.equal(returned.stayId, first.stayId);
  assert.notEqual(moved.cleaningObligationId, first.cleaningObligationId);
  assert.notEqual(returned.cleaningObligationId, first.cleaningObligationId);

  const obligations = (await f.pool.query(`SELECT id,status,checkout_at,end_reason
    FROM cleaning_obligations WHERE stay_id=$1 ORDER BY created_at,id`, [first.stayId])).rows;
  assert.equal(obligations.length, 3);
  assert.equal(obligations.filter(row => row.status === 'ACTIVE').length, 1);
  assert.equal(obligations.find(row => row.status === 'ACTIVE').id, returned.cleaningObligationId);
  assert.deepEqual(obligations.filter(row => row.status === 'TARGET_REMOVED').map(row => row.end_reason),
    ['CHECKOUT_CHANGED', 'CHECKOUT_CHANGED']);
});

test('RF-25 신원: 새 UID의 정확히 같은 숙박만 기존 신원을 잇고 시각이 다르면 새 숙박이다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const first = await identity.saveReservationIdentity(f.pool, reservation(
    'old-uid', '2027-01-02T06:00:00Z', '2027-01-04T02:00:00Z'));
  const replacement = await identity.saveReservationIdentity(f.pool, reservation(
    'new-uid', '2027-01-02T06:00:00Z', '2027-01-04T02:00:00Z'));
  const different = await identity.saveReservationIdentity(f.pool, reservation(
    'different-uid', '2027-01-03T06:00:00Z', '2027-01-05T02:00:00Z'));

  assert.equal(replacement.stayId, first.stayId);
  assert.equal(replacement.cleaningObligationId, first.cleaningObligationId);
  assert.notEqual(different.stayId, first.stayId);
});

test('RF-25 신원: 같은 신규 예약이 동시에 들어와도 숙박·현재 의무는 하나다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const input = reservation('race-uid', '2027-02-01T06:00:00Z', '2027-02-03T02:00:00Z');
  const [a, b] = await Promise.all([
    identity.saveReservationIdentity(f.pool, input),
    identity.saveReservationIdentity(f.pool, input),
  ]);
  assert.equal(a.stayId, b.stayId);
  assert.equal(a.cleaningObligationId, b.cleaningObligationId);
  assert.equal((await f.pool.query(`SELECT COUNT(*)::int AS n FROM property_reservations
    WHERE property_id=$1 AND reservation_uid='race-uid'`, [PROPERTY])).rows[0].n, 1);
  assert.equal((await f.pool.query(`SELECT COUNT(*)::int AS n FROM cleaning_obligations
    WHERE stay_id=$1 AND status='ACTIVE'`, [a.stayId])).rows[0].n, 1);
});
