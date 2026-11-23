// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s140.same-day-korean-date-sql.test.js
//
// RF-51 (DEC-14·15) — 담당자가 "그날" 다른 청소 요청을 받고 있는지 보는 세 곳이 한국 날짜로 같은 날을 판단하는지,
// 실제 코드의 SQL을 격리 DB(PGlite, 실제 스키마)에서 실행해 확인한다. 운영 DB·외부 요청 없음.
// 예: 11-21 00:30 KST(UTC로는 11-20) 퇴실 청소를 요청받는 중인 담당자는 11-21 11:00 KST 청소에 "그날 바쁨"이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
const EARLY = '2026-11-20T15:30:00.000Z'; // 11-21 00:30 KST
const LATE = '2026-11-21T02:00:00.000Z';  // 11-21 11:00 KST
const NEXT_DAY = '2026-11-21T15:30:00.000Z'; // 11-22 00:30 KST

async function sqlFrom(path, pattern) {
  const text = (await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')).match(pattern)?.[1];
  assert.ok(text, `SQL in ${path}`);
  return text;
}
const vipSql = () => sqlFrom('server/cleaning/_dispatch.js', /async function getAvailableVip[\s\S]*?db\.query\(\s*`[\s\S]*?`[\s\S]*?db\.query\(\s*`([\s\S]*?)`/);
const bulkSql = () => sqlFrom('server/cleaning/_dispatch.js', /async function dispatchBulk[\s\S]*?db\.query\(\s*`([\s\S]*?)`/);
const initialSql = () => sqlFrom('server/cleaning/_initialDelivery.js', /const \{ rows: busy \} = await client\.query\(\s*`([\s\S]*?)`/);

async function setup(t, busyCheckout) {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  const { pool, cleanerId, jobId } = sql;
  await pool.query(`UPDATE cleaners SET tier='BULK' WHERE id=$1`, [cleanerId]);
  await pool.query(`UPDATE cleaning_jobs SET checkout_at=$2, cleaning_start_at=$2, status='NOTIFYING_BULK' WHERE id=$1`, [jobId, busyCheckout]);
  await pool.query(`INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token) VALUES($1,$2,'BULK','SAME01')`, [jobId, cleanerId]);
  const { rows: [other] } = await pool.query(`INSERT INTO cleaning_jobs(property_id,checkout_at,cleaning_start_at,status,source,data_origin)
    VALUES('fixture-property',$1,$1,'PENDING','MONTHLY_BATCH','REAL') RETURNING id, checkout_at`, [LATE]);
  return { pool, cleanerId, other };
}

for (const [label, busyCheckout, busy] of [['00:30 KST the same Korean day', EARLY, true], ['00:30 KST the next Korean day', NEXT_DAY, false]]) {
  test(`SQL: a cleaner asked for a cleaning at ${label} ${busy ? 'is' : 'is not'} busy that day — VIP, BULK and the first request agree`, { skip: !enabled }, async t => {
    const { pool, cleanerId, other } = await setup(t, busyCheckout);
    const vip = await pool.query(await vipSql(), [cleanerId, other.checkout_at, other.id]);
    assert.equal(vip.rows.length > 0, busy, 'VIP');
    const bulk = await pool.query(await bulkSql(), [other.checkout_at, other.id]);
    assert.equal(bulk.rows.some(c => c.id === cleanerId), !busy, 'BULK candidates');
    const first = await pool.query(await initialSql(), [cleanerId, other.checkout_at, other.id]);
    assert.equal(first.rows.length > 0, busy, 'first request');
  });
}
