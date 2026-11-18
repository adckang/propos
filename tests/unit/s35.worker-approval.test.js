/**
 * ACT-08 단계 ⑥-6 — 직원 승인 화면과 cleaners API의 실제 구현 계약.
 * 화면/handler를 실행하고 React shell·DB·HTTP만 가짜 I/O로 격리한다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleaningApprovalFixture, approvalResponse } from '../helpers/cleaningApprovalFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PENDING_APP = { id: ID, name: '홍길동', phone: '010-1111-1111', email: 'hong@example.invalid',
  tier: 'BULK', active: false, fcm_status: 'active', app_installed_at: '2026-08-24T00:00:00Z' };
const ACTIVE_FCM = { id: OTHER_ID, name: '이활성', phone: '010-2222-2222', email: 'lee@example.invalid',
  tier: 'VIP_1', active: true, fcm_status: 'active', app_installed_at: '2026-08-20T00:00:00Z' };

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node !== 'object') return [node];
  const children = node.props?.children;
  return [node, ...nodes(children)];
}
function text(node) {
  return nodes(node).filter(value => typeof value === 'string' || typeof value === 'number').join(' ')
    .replace(/\s+/g, ' ').trim();
}
function button(tree, label) {
  const found = nodes(tree).find(node => node?.type === 'button' && text(node) === label);
  assert.ok(found, `button not found: ${label}`);
  return found;
}
async function actualPanel(t, replies) {
  const f = await cleaningApprovalFixture({ replies });
  t.after(() => {
    try {
      assert.equal(f.pendingReplies, 0, 'all scripted HTTP replies consumed');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return f;
}

function adminCookie() {
  return 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
}
async function actualCleanerApi(t, { responses = [], profile = 'hybrid' } = {}) {
  const f = await cleaningDeclineFixture({ responses, profile });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.deepEqual(f.errors, [], 'no hidden handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  return { ...f, send({ method = 'GET', id, body, headers = {}, url } = {}) {
    const path = url ?? `/api/cleaning/cleaners${id ? `/${id}` : ''}`;
    return f.invoke({ method, url: path, body, headers: { cookie: adminCookie(), ...headers } });
  } };
}

describe('actual WorkerApprovalPanel', () => {
  test('starts in the loading state and requests the actual cleaners endpoint', async t => {
    const f = await actualPanel(t, [approvalResponse(200, [])]);
    assert.equal(text(f.render()), '불러오는 중…');
    assert.deepEqual(f.calls, [{
      url: '/api/cleaning/cleaners', method: 'GET', body: undefined,
      headers: { 'Content-Type': 'application/json' },
    }]);
    await f.flush();
    assert.match(text(f.render()), /승인 대기 0\s*명.*대기 중인 직원 없음.*활성 직원 0\s*명.*활성 직원 없음/);
  });

  test('renders pending and active rows with their actual status labels', async t => {
    const rows = [
      PENDING_APP,
      { ...PENDING_APP, id: 'pending-sms', name: '김대기', active: false, app_installed_at: null, fcm_status: 'uninstalled' },
      ACTIVE_FCM,
      { ...ACTIVE_FCM, id: 'active-lazy', name: '최느림', fcm_status: 'inactive' },
      { ...ACTIVE_FCM, id: 'active-invalid', name: '박오류', fcm_status: 'invalid' },
    ];
    const f = await actualPanel(t, [approvalResponse(200, rows)]);
    f.render(); await f.flush();
    const visible = text(f.render());
    assert.match(visible, /승인 대기 2\s*명/); assert.match(visible, /활성 직원 3\s*명/);
    for (const label of ['앱 설치됨 · 승인 대기', '승인 대기', '활성 (앱)', '활성 (장기 미접속)', '활성 (SMS)']) {
      assert.ok(visible.includes(label), `missing actual status: ${label}`);
    }
    assert.match(visible, /앱 활성/); assert.match(visible, /장기 미접속/); assert.match(visible, /토큰 오류/);
    assert.equal(nodes(f.render()).filter(node => node?.type === 'button' && text(node) === '승인').length, 2);
    assert.equal(nodes(f.render()).filter(node => node?.type === 'button' && text(node) === '비활성화').length, 3);
  });

  test('the actual falsy check currently treats null or missing active as pending', async t => {
    const rows = [
      { ...PENDING_APP, id: 'null-active', name: 'Null Active', active: null },
      { ...PENDING_APP, id: 'missing-active', name: 'Missing Active' },
    ];
    delete rows[1].active;
    const f = await actualPanel(t, [approvalResponse(200, rows)]);
    f.render(); await f.flush();
    const tree = f.render();
    assert.match(text(tree), /승인 대기 2\s*명/);
    assert.equal(nodes(tree).filter(node => node?.type === 'button' && text(node) === '승인').length, 2);
  });

  test('approving sends the actual PATCH body, reloads, toasts, and moves the row', async t => {
    const approved = { ...PENDING_APP, active: true };
    const f = await actualPanel(t, [
      approvalResponse(200, [PENDING_APP]), approvalResponse(200, approved), approvalResponse(200, [approved]),
    ]);
    f.render(); await f.flush();
    await button(f.render(), '승인').props.onClick();
    await f.flush();
    assert.deepEqual(f.calls, [
      { url: '/api/cleaning/cleaners', method: 'GET', body: undefined, headers: { 'Content-Type': 'application/json' } },
      { url: `/api/cleaning/cleaners/${ID}`, method: 'PATCH', body: { active: true }, headers: { 'Content-Type': 'application/json' } },
      { url: '/api/cleaning/cleaners', method: 'GET', body: undefined, headers: { 'Content-Type': 'application/json' } },
    ]);
    assert.deepEqual(f.toasts, [['승인 완료', 'success']]);
    assert.match(text(f.render()), /승인 대기 0\s*명.*활성 직원 1\s*명/);
  });

  test('deactivating sends active=false and reloads the row into pending', async t => {
    const inactive = { ...ACTIVE_FCM, active: false };
    const f = await actualPanel(t, [
      approvalResponse(200, [ACTIVE_FCM]), approvalResponse(200, inactive), approvalResponse(200, [inactive]),
    ]);
    f.render(); await f.flush();
    await button(f.render(), '비활성화').props.onClick();
    await f.flush();
    assert.deepEqual(f.calls[1].body, { active: false });
    assert.deepEqual(f.toasts, [['비활성화 완료', 'success']]);
    assert.match(text(f.render()), /승인 대기 1\s*명.*활성 직원 0\s*명/);
  });

  test('a list failure shows the actual error toast and finishes loading with empty sections', async t => {
    const f = await actualPanel(t, [new Error('fixture list unavailable')]);
    f.render(); await f.flush();
    assert.deepEqual(f.toasts, [['fixture list unavailable', 'error']]);
    assert.match(text(f.render()), /승인 대기 0\s*명.*활성 직원 0\s*명/);
  });

  test('a PATCH failure keeps the row pending and does not issue a reload', async t => {
    const f = await actualPanel(t, [approvalResponse(200, [PENDING_APP]), new Error('fixture approval denied')]);
    f.render(); await f.flush();
    await button(f.render(), '승인').props.onClick();
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.toasts, [['fixture approval denied', 'error']]);
    assert.match(text(f.render()), /승인 대기 1\s*명.*활성 직원 0\s*명/);
  });
});

describe('actual cleaners approval API', () => {
  test('GET requires login before querying cleaners', async t => {
    const f = await actualCleanerApi(t);
    const res = await f.send({ headers: { cookie: '' } });
    assert.equal(res.code, 401); assert.equal(res.body.code, 'AUTH_REQUIRED');
    assert.deepEqual(f.queries, []);
  });

  test('DEMO rejects the list before authentication and DB access', async t => {
    const f = await actualCleanerApi(t, { profile: 'demo' });
    const res = await f.send();
    assert.equal(res.code, 403); assert.deepEqual(res.body, { error: 'demo profile is read-only', dataProfile: 'demo' });
    assert.deepEqual(f.queries, []);
  });

  test('GET returns actual DB rows using the production tier/name order', async t => {
    const rows = [PENDING_APP, ACTIVE_FCM];
    const f = await actualCleanerApi(t, { responses: [rows] });
    const res = await f.send();
    assert.equal(res.code, 200); assert.deepEqual(res.body, rows);
    assert.match(f.queries[0].sql, /SELECT \* FROM cleaners/);
    assert.match(f.queries[0].sql, /CASE tier WHEN 'VIP_1' THEN 1 WHEN 'VIP_2' THEN 2 WHEN 'VIP_3' THEN 3 ELSE 4 END, name/);
  });

  for (const active of [true, false]) test(`PATCH active=${active} updates the actual row and returns it`, async t => {
    const row = { ...PENDING_APP, active };
    const f = await actualCleanerApi(t, { responses: [[row]] });
    const res = await f.send({ method: 'PATCH', id: ID, body: { active } });
    assert.equal(res.code, 200); assert.deepEqual(res.body, row);
    assert.match(f.queries[0].sql, /UPDATE cleaners SET active=\$1 WHERE id=\$2 RETURNING \*/);
    assert.deepEqual(f.queries[0].params, [active, ID]);
  });

  test('PATCH with no fields returns 400 without querying the DB', async t => {
    const f = await actualCleanerApi(t);
    const res = await f.send({ method: 'PATCH', id: ID, body: {} });
    assert.equal(res.code, 400); assert.deepEqual(res.body, { error: '수정할 필드 없음' });
    assert.deepEqual(f.queries, []);
  });

  test('PATCH returns the actual 404 when the cleaner does not exist', async t => {
    const f = await actualCleanerApi(t, { responses: [[]] });
    const res = await f.send({ method: 'PATCH', id: ID, body: { active: true } });
    assert.equal(res.code, 404); assert.deepEqual(res.body, { error: '청소자 없음' });
  });

  test('an unsupported method with an ID does not query or mutate cleaners', async t => {
    const f = await actualCleanerApi(t);
    const res = await f.send({ method: 'POST', id: ID, body: { active: true } });
    assert.equal(res.code, 404); assert.deepEqual(res.body, { error: 'Not found' });
    assert.deepEqual(f.queries, []);
  });
});
