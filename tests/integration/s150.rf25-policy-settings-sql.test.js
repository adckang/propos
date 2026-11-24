// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s150.rf25-policy-settings-sql.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture, actualCleaningModule } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const settings = enabled ? await actualCleaningModule('server/anomalyPolicySettings.js') : null;
const PROPERTY = 'fixture-property';
const INITIAL = {
  noise: 5,
  vacant_energy_waste: 5,
  guest_complaint_sensor: 10,
  cleaning_unassigned: 0,
  device_offline: 5,
};

async function harness(t) {
  const f = await createCleaningSqlFixture();
  t.after(() => f.close());
  return f;
}

test('RF-25 설정: DB 마스터를 읽고 숙소 재정의만 우선 적용한다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const initial = await settings.getAnomalyPolicySettings(f.pool, { propertyId: PROPERTY });
  assert.deepEqual(initial.master.values, INITIAL);
  assert.equal(initial.property, null);
  assert.deepEqual(initial.effective, INITIAL);

  const saved = await settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY,
    masterValues: { ...INITIAL, device_offline: 8 },
    propertyValues: { noise: 3, cleaning_unassigned: 0 },
  });
  assert.deepEqual(saved.changed, { master: true, property: true });
  assert.deepEqual(saved.master.values, { ...INITIAL, device_offline: 8 });
  assert.deepEqual(saved.property.values, { noise: 3, cleaning_unassigned: 0 });
  assert.deepEqual(saved.effective, { ...INITIAL, noise: 3, device_offline: 8 });
});

test('RF-25 설정: 숙소 값을 모두 비우면 빈 새 버전으로 공통값 상속을 복구한다', { skip: !enabled }, async t => {
  const f = await harness(t);
  await settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: INITIAL, propertyValues: { noise: 2 },
  });
  const reset = await settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: INITIAL, propertyValues: {},
  });
  assert.equal(reset.changed.property, true);
  assert.deepEqual(reset.property.values, {});
  assert.deepEqual(reset.effective, INITIAL);

  const again = await settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: INITIAL, propertyValues: {},
  });
  assert.deepEqual(again.changed, { master: false, property: false });
  assert.equal((await f.pool.query(`SELECT COUNT(*)::int AS n FROM automation_policy_versions
    WHERE scope='PROPERTY' AND property_id=$1`, [PROPERTY])).rows[0].n, 2);
});

test('RF-25 설정: 불완전·음수 설정과 없는 숙소는 저장하지 않는다', { skip: !enabled }, async t => {
  const f = await harness(t);
  const before = (await f.pool.query(`SELECT COUNT(*)::int AS n FROM automation_policy_versions`)).rows[0].n;
  const incomplete = { ...INITIAL };
  delete incomplete.noise;
  await assert.rejects(settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: incomplete, propertyValues: {},
  }), /noise/);
  await assert.rejects(settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: INITIAL, propertyValues: { noise: -1 },
  }), /noise/);
  await assert.rejects(settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: 'missing-property', masterValues: { ...INITIAL, noise: 7 }, propertyValues: {},
  }), /숙소 설정 없음/);
  assert.equal((await f.pool.query(`SELECT COUNT(*)::int AS n FROM automation_policy_versions`)).rows[0].n, before);
});

test('RF-25 설정: 마스터가 없으면 조회는 설정 오류이고 완전한 저장으로만 복구한다', { skip: !enabled }, async t => {
  const f = await harness(t);
  await f.pool.query(`DELETE FROM automation_policy_versions WHERE scope='MASTER'`);
  await assert.rejects(
    settings.getAnomalyPolicySettings(f.pool, { propertyId: PROPERTY }),
    /마스터 설정/,
  );
  const repaired = await settings.saveAnomalyPolicySettings(f.pool, {
    propertyId: PROPERTY, masterValues: INITIAL, propertyValues: {},
  });
  assert.equal(repaired.changed.master, true);
  assert.deepEqual(repaired.master.values, INITIAL);
});
