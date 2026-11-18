// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s69.property-name-unique-sql.test.js
//
// s69 SQL — 숙소 이름 중복 방지(D-031)를 실제 제약·실제 SQL로 확인한다. 실제 청소 API 핸들러를 그대로
// 실행하고, 그 핸들러가 보내는 SQL만 격리 DB(PGlite 또는 격리 로컬 DB)로 넘긴다. 운영 DB·외부 요청 없음.
//
// 설치 경로가 둘이다: ① 스키마 파일로 새로 만든 DB(제약 이름은 Postgres 기본 `..._name_key`)
// ② 운영 DB처럼 제약 없이 만들어진 뒤 마이그레이션 파일로 붙인 DB(`..._name_unique`, 2026-11-18 운영
// 읽기 전용 확인). 두 경우 모두 같은 이름의 두 번째 숙소는 409로 거절돼야 한다(RF-34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const EXISTING = 'Fixture Property'; // 도구가 만든 숙소(fixture-property)의 이름
// 화면(대시보드 설정·청소관리)은 체크아웃 시각·청소 시간을 항상 함께 보낸다 — 같은 모양으로 보낸다
const SCREEN = { checkout_hour: 11, cleaning_duration_hours: 2.5 };
const migration = () => readFile(new URL('../../data/migrate-property-name-unique.sql', import.meta.url), 'utf8');

async function database(t, { productionLike = false } = {}) {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  if (productionLike) {
    // 운영 DB는 이름 제약이 생기기 전에 만들어졌고 2026-09-29에 마이그레이션 파일로 붙였다
    await sql.pool.query('ALTER TABLE property_cleaning_config DROP CONSTRAINT property_cleaning_config_name_key');
    await sql.engine.exec(await migration());
  }
  return sql;
}
const constraintsOf = async (pool) => (await pool.query(
  `SELECT conname FROM pg_constraint WHERE conrelid='property_cleaning_config'::regclass AND contype='u' ORDER BY conname`)).rows.map(r => r.conname);
const namesOf = async (pool, name) => (await pool.query(
  'SELECT property_id FROM property_cleaning_config WHERE name=$1 ORDER BY property_id', [name])).rows.map(r => r.property_id);

// 실제 핸들러가 보내는 SQL 3개(저장된 이름 조회 → 중복 검사 → 저장)를 격리 DB로. afterQuery로 그 사이에 끼어들 수 있다.
async function save(t, sql, body, afterQuery = async () => {}) {
  const forward = async (text, params) => { const r = await sql.pool.query(text, params); await afterQuery(text); return r; };
  const api = await cleaningDeclineFixture({ responses: [forward, forward, forward] });
  t.after(() => api.restore());
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await api.invoke({ method: 'POST', url: '/api/cleaning/properties', body, headers: { cookie } });
  assert.deepEqual(api.blocked, []);
  return { res, api };
}

for (const productionLike of [false, true]) {
  const install = productionLike ? 'migrated DB (production-like)' : 'fresh schema DB';

  test(`SQL (${install}): the database itself refuses a second property with the same name`, { skip: !enabled }, async t => {
    const sql = await database(t, { productionLike });
    assert.deepEqual(await constraintsOf(sql.pool),
      [productionLike ? 'property_cleaning_config_name_unique' : 'property_cleaning_config_name_key']);
    await assert.rejects(
      sql.pool.query(`INSERT INTO property_cleaning_config(property_id,name) VALUES('copy-property',$1)`, [EXISTING]),
      e => e.code === '23505');
    assert.deepEqual(await namesOf(sql.pool, EXISTING), ['fixture-property']);
  });

  test(`SQL (${install}): saving a new property under a taken name is refused by the first check`, { skip: !enabled }, async t => {
    const sql = await database(t, { productionLike });
    const { res, api } = await save(t, sql, { ...SCREEN, property_id: 'copy-property', name: EXISTING });
    assert.equal(res.code, 409);
    assert.deepEqual(res.body, { error: '이미 같은 이름의 숙소가 있어요 (fixture-property)', code: 'NAME_TAKEN' });
    assert.equal(api.pendingResponses, 1, 'the INSERT was never sent');
    assert.deepEqual(await namesOf(sql.pool, EXISTING), ['fixture-property']);
  });

  test(`SQL (${install}): re-saving a property under its own name is not a duplicate`, { skip: !enabled }, async t => {
    const sql = await database(t, { productionLike });
    const { res } = await save(t, sql, { ...SCREEN, property_id: 'fixture-property', name: EXISTING, checkout_hour: 10 });
    assert.equal(res.code, 200);
    assert.equal(res.body.name, EXISTING); assert.equal(res.body.checkout_hour, 10);
  });

  test(`SQL (${install}): a concurrent save that slips past the first check gets 409 from the constraint, not 500`, { skip: !enabled }, async t => {
    const sql = await database(t, { productionLike });
    const NEW_NAME = 'Race Stay';
    // 첫 요청의 중복 검사가 "없음"으로 끝난 직후, 다른 요청이 같은 이름을 먼저 저장한다
    const { res, api } = await save(t, sql, { ...SCREEN, property_id: 'race-a', name: NEW_NAME }, async (text) => {
      if (/property_id <> ALL/.test(text)) {
        await sql.pool.query(`INSERT INTO property_cleaning_config(property_id,name) VALUES('race-b',$1)`, [NEW_NAME]);
      }
    });
    assert.deepEqual(api.errors, [], 'the clash is handled, not logged as a server error');
    assert.equal(res.code, 409);
    assert.deepEqual(res.body, { error: '이미 같은 이름의 숙소가 있어요', code: 'NAME_TAKEN' });
    assert.deepEqual(await namesOf(sql.pool, NEW_NAME), ['race-b'], 'only the earlier save exists');
  });
}

test('SQL: the migration stops without adding anything while duplicate names remain', { skip: !enabled }, async t => {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  await sql.pool.query('ALTER TABLE property_cleaning_config DROP CONSTRAINT property_cleaning_config_name_key');
  await sql.pool.query(`INSERT INTO property_cleaning_config(property_id,name) VALUES('copy-property',$1)`, [EXISTING]);
  await assert.rejects(sql.engine.exec(await migration()), e => e.code === '23505');
  assert.deepEqual(await constraintsOf(sql.pool), []);
});
