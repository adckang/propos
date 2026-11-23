// PGLITE_TEST_ROOT=<pglite 설치 폴더> node --test tests/integration/s127.cleaning-demo-contract-sql.test.js
//
// s127 SQL — 청소 API의 데모 응답이 운영 응답과 같은 모양인가 (ACT-08 QA-06, 2026-11-19).
// 운영: 실제 청소 API 핸들러 + 실제 SQL을 격리 DB(PGlite, 실제 스키마)에서. 데모: 같은 핸들러의 데모 분기. 운영 DB·외부 요청 없음.
// 화면은 두 응답을 같은 코드로 읽으므로, 운영이 주는 칸은 데모에도 같은 종류(또는 빈 값)로 있어야 한다.
// 데모에 없어도 되는 칸은 아래 목록으로 못 박는다 — 데모 화면이 읽지 않는 칸이다(데모 대시보드는 숙소 목록 API를 읽지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleaningSqlFixture } from '../helpers/cleaningDeliveryFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';
import { periodToRemainingRange } from '../../src/domain/periodDomain.js';

const enabled = !!(process.env.PGLITE_TEST_ROOT || process.env.CLEANING_TEST_DATABASE_URL);
// 운영 숙소 목록에만 있는 칸 — 예약·iCal 설정 여부·출처 기록. 데모에서 이 목록을 읽는 화면(청소관리·절차 확인)은 쓰지 않는다
const PROPERTY_FIELDS_NOT_IN_DEMO = ['reservations', 'ical_configured', 'created_at', 'updated_at', 'source_system', 'source_ref', 'source_updated_at'];

async function database(t) {
  const sql = await createCleaningSqlFixture();
  t.after(() => sql.close());
  const { pool, cleanerId } = sql;
  const range = periodToRemainingRange('next_week');
  const mid = (range.from.getTime() + range.to.getTime()) / 2;
  const at = hours => new Date(mid + hours * 3_600_000).toISOString();
  await pool.query('DELETE FROM cleaning_jobs WHERE id=$1', [sql.jobId]);
  await pool.query(`UPDATE property_cleaning_config SET ical_url='https://fixture.invalid/x.ics' WHERE property_id='fixture-property'`);
  await pool.query(`INSERT INTO property_reservations(property_id,reservation_uid,check_in,check_out,source_system,data_origin)
    VALUES('fixture-property','r1',$1,$2,'AIRBNB_ICAL','REAL')`, [at(-48), at(0)]);
  for (const [i, status, cleaner] of [[0, 'ASSIGNED', cleanerId], [1, 'PENDING', null], [2, 'ESCALATED', null], [3, 'CANCELLED', null]]) {
    const { rows: [job] } = await pool.query(`INSERT INTO cleaning_jobs(property_id,checkout_at,cleaning_start_at,status,assigned_cleaner_id,source,data_origin)
      VALUES('fixture-property',$1,$1,$2,$3,'MONTHLY_BATCH','REAL') RETURNING id`, [at(i * 6), status, cleaner]);
    if (status === 'ESCALATED') await pool.query(`INSERT INTO cleaning_notifs(job_id,cleaner_id,tier,token,response) VALUES($1,$2,'BULK','QA0601','DECLINED')`, [job.id, cleanerId]);
  }
  return sql;
}
async function call(t, profile, url, sql) {
  const forward = (text, params) => sql.pool.query(text, params);
  const api = await cleaningDeclineFixture({ profile, responses: profile === 'demo' ? [] : Array(8).fill(forward) });
  t.after(() => api.restore());
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await api.invoke({ method: 'GET', url, headers: { cookie } });
  assert.deepEqual(api.blocked, []);
  // 실제 응답은 JSON 글자로 나간다(날짜 → ISO 글자) — 시험 도구가 넘긴 객체를 같은 모양으로 바꿔 비교한다
  return { ...res, body: JSON.parse(JSON.stringify(res.body)) };
}
const kind = v => v === null || v === undefined ? 'empty' : Array.isArray(v) ? 'array' : typeof v;
/** 운영 한 줄의 칸마다 데모 한 줄에 같은 종류(또는 빈 값)가 있는지 — 없는 칸·다른 종류를 돌려준다 */
function mismatches(prod, demo, allowedMissing = []) {
  const out = [];
  for (const [key, value] of Object.entries(prod)) {
    if (allowedMissing.includes(key)) continue;
    if (!(key in demo)) { out.push(`missing ${key}`); continue; }
    const [p, d] = [kind(value), kind(demo[key])];
    if (p !== d && p !== 'empty' && d !== 'empty') out.push(`${key}: ${p} vs ${d}`);
  }
  return out;
}

test('SQL: property list — DEMO rows carry every production field except the documented ones no DEMO screen reads', { skip: !enabled }, async t => {
  const sql = await database(t);
  const prod = await call(t, 'hybrid', '/api/cleaning/properties', sql);
  const demo = await call(t, 'demo', '/api/cleaning/properties', sql);
  assert.equal(prod.code, 200); assert.equal(demo.code, 200);
  assert.deepEqual(mismatches(prod.body[0], demo.body[0], PROPERTY_FIELDS_NOT_IN_DEMO), []);
  for (const key of PROPERTY_FIELDS_NOT_IN_DEMO) assert.ok(key in prod.body[0], `production still returns ${key} (otherwise drop it from the list)`);
  const names = await call(t, 'hybrid', '/api/cleaning/properties?view=names', sql);
  assert.deepEqual(mismatches(names.body[0], (await call(t, 'demo', '/api/cleaning/properties?view=names', sql)).body[0]), []);
});

test('SQL: cleaning stats — the totals and every item list match in fields and kinds', { skip: !enabled }, async t => {
  const sql = await database(t);
  // 데모 청소의 상태는 날짜로 정해져, 다음 주에 배정 실패가 0건인 날도 있다 — 칸 모양은 기간과 무관하므로 다른 기간의 데모 줄로도 비교한다
  const demoSamples = [];
  for (const period of ['next_week', 'next_month', 'this_month', 'weeks_ahead_2', 'weeks_ahead_3']) {
    demoSamples.push((await call(t, 'demo', `/api/cleaning/stats?period=${period}&items=true`, sql)).body);
  }
  for (const url of ['/api/cleaning/stats?period=next_week', '/api/cleaning/stats?period=next_week&items=true']) {
    const prod = await call(t, 'hybrid', url, sql);
    const demo = await call(t, 'demo', url, sql);
    assert.equal(prod.code, 200); assert.equal(demo.code, 200);
    assert.deepEqual(mismatches(prod.body, demo.body), [], url);
    for (const list of ['items', 'failedItems', 'needsRequestItems']) {
      if (!prod.body[list]) continue;
      const demoRow = demo.body[list][0] ?? demoSamples.find(body => body[list]?.length)?.[list][0];
      assert.ok(prod.body[list].length > 0 && demoRow, `${list} has rows on both sides to compare`);
      assert.deepEqual(mismatches(prod.body[list][0], demoRow), [], `${url} ${list}`);
    }
  }
});

test('SQL: choosing one property scopes both answers to that property', { skip: !enabled }, async t => {
  const sql = await database(t);
  const prod = await call(t, 'hybrid', '/api/cleaning/stats?period=next_week&items=true&property_ids=fixture-property', sql);
  const demo = await call(t, 'demo', '/api/cleaning/stats?period=next_week&items=true&property_ids=P001', sql);
  assert.ok(prod.body.items.length > 0 && prod.body.items.every(i => i.property_id === 'fixture-property'));
  assert.ok(demo.body.items.length > 0 && demo.body.items.every(i => i.property_id === 'P001'));
  assert.equal(prod.body.unassigned, prod.body.total - prod.body.assigned);
  assert.equal(demo.body.unassigned, demo.body.total - demo.body.assigned, 'the same "unassigned = total - assigned" rule');
});
