// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s137.worker-register-guard-sql.test.js
//
// D-033 남은 노출(DEC-08) — 담당자 앱 등록이 이미 있는 번호의 살아 있는 푸시 토큰·이메일을 덮어쓰지 않는지, 실제 핸들러의 SQL을
// 격리 DB(PGlite 또는 격리 로컬 DB)에서 그대로 실행해 확인한다. 운영 DB·외부 요청 없음.
// 저장소 스키마는 cleaners.name 이 필수(NOT NULL)인데 운영은 비워 둘 수 있다(RF-50). 이름 없는 등록 SQL은 번호가 겹치는지 보기 전에
// NOT NULL 검사에 걸리므로, 운영과 같게 그 제약만 풀고 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PHONE = '010-9876-5432';

async function registerSql() {
  const source = await readFile(new URL('../../api/workers/[...slug].js', import.meta.url), 'utf8');
  const sql = source.match(/db\.query\(\s*`(INSERT INTO cleaners \(phone, email[\s\S]*?)`,/)?.[1];
  assert.ok(sql, 'actual register SQL');
  return sql;
}

const cases = [
  ['no usable token yet (admin pre-created)', null, 'uninstalled', true],
  ['live token', 'old-live', 'active', false],
  ['token idle 30 days (still live for FCM)', 'old-idle', 'inactive', false],
  ['FCM said unregistered (app removed)', 'old-dead', 'unregistered', true],
  ['FCM said invalid (may be a payload error — re-checked by the probe, not by SQL)', 'old-bad', 'invalid', false],
  ['same token again (app retry)', 'new-token', 'active', true],
  ['same token again after FCM said unregistered (status is not revived)', 'new-token', 'unregistered', true],
];

test('SQL: a new number is inserted as a pending BULK worker with the given email', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  await sql.pool.query('ALTER TABLE cleaners ALTER COLUMN name DROP NOT NULL'); // 운영과 같게(RF-50)
  const { rows } = await sql.pool.query(await registerSql(), [PHONE, 'new@example.invalid', 'new-token']);
  assert.equal(rows.length, 1);
  assert.equal(Object.hasOwn(rows[0], 'email'), false, '저장된 이메일은 돌려주지 않는다');
  const { rows: [saved] } = await sql.pool.query('SELECT email, tier, active, fcm_status FROM cleaners WHERE phone=$1', [PHONE]);
  assert.deepEqual([saved.email, saved.tier, saved.active, saved.fcm_status], ['new@example.invalid', 'BULK', false, 'active']);
});

for (const [label, token, status, accepted] of cases) {
  test(`SQL: existing number with ${label} → ${accepted ? 'takes the new token' : 'unchanged'}, email never changes`, { skip: !enabled }, async t => {
    const sql = await createCleaningSqlFixture();
    t.after(() => sql.close());
    await sql.pool.query('ALTER TABLE cleaners ALTER COLUMN name DROP NOT NULL'); // 운영과 같게(RF-50)
    await sql.pool.query(
      `INSERT INTO cleaners (name, phone, email, tier, active, fcm_token, fcm_status)
       VALUES ('Owner', $1, 'owner@example.invalid', 'VIP_1', true, $2, $3)`, [PHONE, token, status]);
    const { rows } = await sql.pool.query(await registerSql(), [PHONE, 'someone-else@example.invalid', 'new-token']);
    assert.equal(rows.length, accepted ? 1 : 0);
    const { rows: [after] } = await sql.pool.query('SELECT email, tier, active, fcm_token, fcm_status FROM cleaners WHERE phone=$1', [PHONE]);
    assert.equal(after.email, 'owner@example.invalid');
    assert.equal(after.tier, 'VIP_1');
    assert.equal(after.active, true);
    assert.equal(after.fcm_token, accepted ? 'new-token' : token);
    // 같은 토큰의 재시도는 상태를 그대로 둔다(죽었다고 표시된 토큰을 되살리지 않는다)
    assert.equal(after.fcm_status, accepted && token !== 'new-token' ? 'active' : status);
  });
}
