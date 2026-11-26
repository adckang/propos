// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s137.worker-register-guard-sql.test.js
//
// 담당자 앱 등록이 관리자가 미리 저장한 전화번호·이메일에만 기기를 연결하고 기존 신원·승인을 바꾸지 않는지,
// 실제 핸들러의 SQL을 격리 DB(PGlite 또는 격리 로컬 DB)에서 그대로 실행해 확인한다. 운영 DB·외부 요청 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const PHONE = '010-9876-5432';

async function registerSql() {
  const source = await readFile(new URL('../../api/workers/[...slug].js', import.meta.url), 'utf8');
  const sql = source.match(/db\.query\(\s*`(UPDATE cleaners SET\s+fcm_token[\s\S]*?RETURNING id, name, phone, tier, active, fcm_status, app_installed_at)`,/)?.[1];
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

test('SQL: a number not pre-registered by the host is not created', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  const { rows } = await sql.pool.query(await registerSql(), [PHONE, 'new@example.invalid', 'new-token']);
  assert.equal(rows.length, 0);
  const { rows: saved } = await sql.pool.query('SELECT id FROM cleaners WHERE phone=$1', [PHONE]);
  assert.equal(saved.length, 0);
});

test('SQL: a wrong email cannot attach to a pre-registered phone', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  await sql.pool.query(
    `INSERT INTO cleaners (name, phone, email, tier, active) VALUES ('Owner', $1, 'owner@example.invalid', 'VIP_1', true)`, [PHONE]);
  const { rows } = await sql.pool.query(await registerSql(), [PHONE, 'wrong@example.invalid', 'new-token']);
  assert.equal(rows.length, 0);
  const { rows: [after] } = await sql.pool.query('SELECT fcm_token, app_installed_at FROM cleaners WHERE phone=$1', [PHONE]);
  assert.deepEqual([after.fcm_token, after.app_installed_at], [null, null]);
});

for (const [label, token, status, accepted] of cases) {
  test(`SQL: existing number with ${label} → ${accepted ? 'takes the new token' : 'unchanged'}, email never changes`, { skip: !enabled }, async t => {
    const sql = await createCleaningSqlFixture();
    t.after(() => sql.close());
    await sql.pool.query(
      `INSERT INTO cleaners (name, phone, email, tier, active, fcm_token, fcm_status)
       VALUES ('Owner', $1, 'owner@example.invalid', 'VIP_1', true, $2, $3)`, [PHONE, token, status]);
    const { rows } = await sql.pool.query(await registerSql(), [PHONE, 'owner@example.invalid', 'new-token']);
    assert.equal(rows.length, accepted ? 1 : 0);
    // RF-57: 첫 연결 Slack은 관리자가 저장한 이름만 쓴다 — 연결 SQL이 그 이름을 돌려줘야 한다
    if (accepted) assert.equal(rows[0].name, 'Owner');
    const { rows: [after] } = await sql.pool.query('SELECT email, tier, active, fcm_token, fcm_status, app_installed_at FROM cleaners WHERE phone=$1', [PHONE]);
    assert.equal(after.email, 'owner@example.invalid');
    assert.equal(after.tier, 'VIP_1');
    assert.equal(after.active, true);
    assert.equal(after.fcm_token, accepted ? 'new-token' : token);
    assert.equal(after.app_installed_at !== null, accepted);
    // 같은 토큰의 재시도는 상태를 그대로 둔다(죽었다고 표시된 토큰을 되살리지 않는다)
    assert.equal(after.fcm_status, accepted && token !== 'new-token' ? 'active' : status);
  });
}

test('SQL: the schema files build the worker table like production (name and app status may be empty — RF-50)', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  const { rows } = await sql.pool.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'cleaners' AND column_name IN ('name', 'fcm_status') ORDER BY column_name`);
  assert.deepEqual(rows.map(r => [r.column_name, r.is_nullable]), [['fcm_status', 'YES'], ['name', 'YES']]);
  assert.match(rows[0].column_default, /'uninstalled'/);
  await sql.pool.query(`INSERT INTO cleaners (phone, email, tier, fcm_status) VALUES ('010-0000-0001', 'a@example.invalid', 'BULK', NULL)`);
  await assert.rejects(sql.pool.query(`INSERT INTO cleaners (phone, email, tier, fcm_status) VALUES ('010-0000-0002', 'b@example.invalid', 'BULK', 'bogus')`));
  const { rows: indexes } = await sql.pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'cleaners'
    AND indexname IN ('idx_cleaners_fcm_status', 'idx_cleaners_last_seen') ORDER BY indexname`);
  assert.deepEqual(indexes.map(r => r.indexname), ['idx_cleaners_fcm_status', 'idx_cleaners_last_seen'], '운영 DB와 같은 앱 상태 색인');
});
