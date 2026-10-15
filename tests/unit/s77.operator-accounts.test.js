import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPassword, verifyPassword, normalizeEmail, validatePassword, authenticateOperator, loadOperatorAccess, passwordFingerprint,
  resolveScope, scopePropertyIds, scopeQueryIds, canAccessProperty, isAdminScope, ADMIN_SCOPE, NO_ACCESS_ID,
} from '../../server/auth/operatorAccounts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

describe('비밀번호 암호화 (scrypt)', () => {
  test('해시는 평문을 담지 않고, 같은 비밀번호도 매번 다르다', async () => {
    const a = await hashPassword('pw-1234567890');
    const b = await hashPassword('pw-1234567890');
    assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.ok(!a.includes('pw-1234567890'));
    assert.notEqual(a, b);
  });
  test('맞는 비밀번호만 통과, 깨진 해시·빈 값은 예외 없이 거절', async () => {
    const h = await hashPassword('pw-1234567890');
    assert.equal(await verifyPassword('pw-1234567890', h), true);
    assert.equal(await verifyPassword('pw-1234567891', h), false);
    for (const bad of [undefined, '', 'scrypt', 'md5$a$b', 'scrypt$zz$', null]) assert.equal(await verifyPassword('x', bad), false);
    assert.equal(await verifyPassword(undefined, h), false);
  });
  test('손상·잘린 해시는 어떤 비밀번호도 통과시키지 않는다 (예전엔 빈 버퍼 == 빈 버퍼 로 true 였다)', async () => {
    const good = await hashPassword('pw-1234567890');
    const [alg, salt, hash] = good.split('$');
    const corrupt = ['scrypt$aa$zz', 'scrypt$aa$0', `scrypt$${salt}$`, `scrypt$${salt}$${hash.slice(0, 62)}`, `scrypt$${salt}$${'z'.repeat(64)}`,
      `scrypt$${salt.slice(0, 30)}$${hash}`, `${alg}$${salt}$${hash}$extra`, `SCRYPT$${salt}$${hash}`];
    for (const bad of corrupt) assert.equal(await verifyPassword('anything', bad), false, bad);
    assert.equal(await verifyPassword('pw-1234567890', good), true);
  });
  test('이메일 정규화·비밀번호 규칙', () => {
    assert.equal(normalizeEmail('  A@Example.COM '), 'a@example.com');
    for (const bad of ['', 'no-at', 'a@b', 'a b@c.com', 'a,b@c.com', null, 'x'.repeat(260) + '@a.com']) assert.equal(normalizeEmail(bad), null, String(bad));
    assert.equal(validatePassword('short').ok, false);
    assert.equal(validatePassword('long-enough-1').ok, true);
    assert.equal(validatePassword('x'.repeat(201)).ok, false);
  });
});

const fakeDb = (rows = {}) => ({
  async query(sql, params) {
    if (sql.includes('FROM operators WHERE email')) return { rows: rows.byEmail?.[params[0]] ? [rows.byEmail[params[0]]] : [] };
    if (sql.includes('FROM operators o LEFT JOIN operator_properties')) {
      const o = rows.byId?.[params[0]];
      return { rows: o ? [{ active: o.active, password_hash: o.hash ?? HASH, property_ids: o.props }] : [] };
    }
    throw new Error(`예상 못 한 SQL: ${sql}`);
  },
});
const HASH = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const PH = passwordFingerprint(HASH);

describe('운영자 인증', () => {
  test('이메일+비밀번호가 맞고 활성이면 계정 정보, 아니면 null (어느 쪽이 틀렸는지 구분 없음)', async () => {
    const hash = await hashPassword('right-password-1');
    const db = fakeDb({ byEmail: {
      'a@x.com': { id: 'op-1', email: 'a@x.com', name: 'A', password_hash: hash, active: true },
      'off@x.com': { id: 'op-2', email: 'off@x.com', name: 'Off', password_hash: hash, active: false },
    } });
    assert.deepEqual(await authenticateOperator(db, ' A@X.com ', 'right-password-1'), { id: 'op-1', email: 'a@x.com', name: 'A', ph: passwordFingerprint(hash) });
    assert.equal(await authenticateOperator(db, 'a@x.com', 'wrong-password-1'), null);
    assert.equal(await authenticateOperator(db, 'nobody@x.com', 'right-password-1'), null);
    assert.equal(await authenticateOperator(db, 'off@x.com', 'right-password-1'), null); // 정지 계정은 비밀번호가 맞아도 거절
    assert.equal(await authenticateOperator(db, 'not-an-email', 'right-password-1'), null);
    assert.equal(await authenticateOperator(db, 'a@x.com', ''), null);
  });
  test('없는 이메일도 비밀번호 검증 시간을 쓴다 (응답 시간으로 계정 존재를 알아내지 못하게)', async () => {
    const db = fakeDb();
    const t0 = process.hrtime.bigint();
    await authenticateOperator(db, 'nobody@x.com', 'whatever-password');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms > 5, `더미 해시 검증이 실행돼야 함 (${ms.toFixed(1)}ms)`);
  });
});

describe('숙소 범위 — 먼저 누구인지, 그 사람 몫만', () => {
  const opScope = { all: false, propertyIds: ['A', 'B'] };
  test('관리자 범위는 전부, 운영자 범위는 배정된 숙소만', () => {
    assert.equal(isAdminScope(ADMIN_SCOPE), true);
    assert.equal(isAdminScope(opScope), false);
    assert.equal(canAccessProperty(ADMIN_SCOPE, 'Z'), true);
    assert.equal(canAccessProperty(opScope, 'A'), true);
    assert.equal(canAccessProperty(opScope, 'Z'), false);
    assert.equal(canAccessProperty(null, 'A'), false);
  });
  test('요청한 숙소와 허용 숙소의 교집합 — 허용 밖은 요청해도 빠진다', () => {
    assert.deepEqual(scopePropertyIds(opScope, ['A', 'Z']), ['A']);
    assert.deepEqual(scopePropertyIds(opScope, ['Z']), []);
    assert.deepEqual(scopePropertyIds(opScope, null), ['A', 'B']);   // 요청이 없으면 허용된 전체
    assert.deepEqual(scopePropertyIds(opScope, []), ['A', 'B']);
    assert.equal(scopePropertyIds(ADMIN_SCOPE, null), null);         // 관리자: 제한 없음
    assert.deepEqual(scopePropertyIds(ADMIN_SCOPE, ['Z']), ['Z']);
    assert.deepEqual(scopePropertyIds(null, ['A']), []);
  });
  test('쿼리용 필터: 비어도 "전체"로 오해되지 않는다 — 운영자는 항상 1개 이상(없으면 일치하는 숙소가 없는 id)', () => {
    assert.equal(scopeQueryIds(ADMIN_SCOPE, null), null);
    assert.deepEqual(scopeQueryIds(opScope, ['Z']), [NO_ACCESS_ID]);
    assert.deepEqual(scopeQueryIds({ all: false, propertyIds: [] }, null), [NO_ACCESS_ID]);
    assert.deepEqual(scopeQueryIds(opScope, ['B']), ['B']);
    assert.ok(scopeQueryIds(null, null).every((id) => id === NO_ACCESS_ID), '범위가 없으면 아무것도 안 보임');
    for (const ids of [scopeQueryIds(opScope, ['Z']), scopeQueryIds({ all: false, propertyIds: [] })]) assert.ok(Array.isArray(ids) && ids.length > 0);
  });
  test('세션 → 범위: 관리자/운영자/정지·삭제 계정', async () => {
    const db = fakeDb({ byId: { 'op-1': { active: true, props: ['A'] }, 'op-2': { active: false, props: ['A'] } } });
    assert.deepEqual(await resolveScope({ role: 'admin' }, db), ADMIN_SCOPE);
    assert.deepEqual(await resolveScope({ role: 'operator', sub: 'op-1', ph: PH }, db), { all: false, propertyIds: ['A'] });
    assert.equal(await resolveScope({ role: 'operator', sub: 'op-2', ph: PH }, db), null);
    assert.equal(await resolveScope({ role: 'operator', sub: 'gone', ph: PH }, db), null);
    assert.equal(await resolveScope({ role: 'operator', ph: PH }, db), null);
    assert.equal(await resolveScope({ role: 'operator', sub: 'op-1' }, db), null);          // 지문 없는 세션
    assert.equal(await resolveScope({ role: 'operator', sub: 'op-1', ph: 'stale' }, db), null); // 비밀번호가 바뀐 뒤의 옛 세션
    assert.equal(await resolveScope(null, db), null);
    assert.equal((await loadOperatorAccess(db, 'op-1')).propertyIds.length, 1);
  });
});

describe('DB 스키마 계약', () => {
  const mig = read('data/migrate-operators.sql');
  test('운영자 계정: 이메일 유일·소문자, 평문 비밀번호 칼럼 없음, 정지 플래그', () => {
    assert.match(mig, /CREATE TABLE IF NOT EXISTS operators/);
    assert.match(mig, /CONSTRAINT operators_email_unique UNIQUE \(email\)/);
    assert.match(mig, /email = lower\(email\)/);
    assert.match(mig, /password_hash/);
    assert.ok(!/\bpassword\s+TEXT/i.test(mig));
    assert.match(mig, /active\s+BOOLEAN NOT NULL DEFAULT true/);
  });
  test('연결 테이블: 복합 PK, 숙소 이름 변경을 따라가고(UPDATE CASCADE) 숙소·계정 삭제 시 함께 삭제', () => {
    assert.match(mig, /PRIMARY KEY \(operator_id, property_id\)/);
    assert.match(mig, /REFERENCES operators\(id\) ON DELETE CASCADE/);
    assert.match(mig, /REFERENCES property_cleaning_config\(property_id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  });
  test('신규 설치 스키마에도 같은 정의가 있다', () => {
    const schema = read('data/schema-cleaning.sql');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS operators/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS operator_properties/);
  });
});
