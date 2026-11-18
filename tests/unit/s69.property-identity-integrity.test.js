/**
 * s69 — 숙소 이름 중복 방지와 "이름은 한 화면에서만 바꾼다"(D-031·D-016).
 *
 * 배경(2026-09-29): "파주201"이 서로 다른 property_id 3개로 중복 등록된 사고 뒤
 *   1. DB에 UNIQUE(name) 제약을 두고, 서버(upsertProperty)가 저장 전 검사(1차)를 빠져나간
 *      동시 저장 충돌을 그 제약 위반(23505)으로 받아 같은 409 NAME_TAKEN으로 돌려준다(2차).
 *   2. 청소관리 "숙소" 탭(PropertyPanel)의 이름 칸을 읽기 전용으로 — 이름(=식별자) 변경은
 *      대시보드 ⚙설정의 이전 절차 한 곳에서만.
 *   (3. 앱을 열 때 캐시가 정본을 덮어쓰지 않는 것은 s68.)
 *
 * ACT-08 ⑦-2: 예전엔 소스 파일 글자만 검사했다. 이제 실제 청소 API 핸들러(DB만 가짜)와
 * 실제 PropertyPanel(React 껍데기·HTTP만 가짜)을 실행한다. 실제 제약·SQL 결과는 격리 DB 시험
 * tests/integration/s69.property-name-unique-sql.test.js 가 확인한다(PGlite 필요, CI 밖).
 *
 * RF-34(2026-11-18): 제약 이름이 설치 경로마다 다르다 — 운영 DB는 ALTER로 붙인
 * `property_cleaning_config_name_unique`, 스키마 파일로 새로 만든 DB는 Postgres 기본 이름
 * `property_cleaning_config_name_key`. 서버가 앞의 이름만 알아 뒤의 DB에서는 같은 충돌이 500이었다.
 * → 서버가 두 이름 모두 받고(그 시절 만든 DB용), 2026-11-19부터 스키마 파일도 운영과 같은 이름을 쓴다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { cleaningApprovalFixture, approvalResponse } from '../helpers/cleaningApprovalFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

const PROPERTY = '파주201';
const SAVED_ROW = { property_id: PROPERTY, name: PROPERTY, checkout_hour: 11, cleaning_duration_hours: 2.5 };
const uniqueViolation = (constraint) => Object.assign(
  new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', constraint });

async function saveProperty(t, responses, { body = { property_id: PROPERTY, name: PROPERTY }, expectedErrors = 0 } = {}) {
  const f = await cleaningDeclineFixture({ responses });
  t.after(() => {
    try {
      assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
      assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
      assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
      assert.equal(f.errors.length, expectedErrors, 'no unexpected or swallowed handler errors');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
  const res = await f.invoke({ method: 'POST', url: '/api/cleaning/properties', body, headers: { cookie } });
  return { res, f };
}
const isInsert = (q) => /INSERT INTO property_cleaning_config/.test(q.sql);

describe('actual upsertProperty — the same name cannot be registered twice', () => {
  test('first check: a name another property already uses is refused before anything is written', async t => {
    const { res, f } = await saveProperty(t, [[], [{ property_id: '다른숙소' }]]);
    assert.equal(res.code, 409);
    assert.deepEqual(res.body, { error: '이미 같은 이름의 숙소가 있어요 (다른숙소)', code: 'NAME_TAKEN' });
    assert.equal(f.queries.length, 2);
    assert.ok(!f.queries.some(isInsert), 'no INSERT after the duplicate is found');
  });

  test('the first check looks for the name under any other property id (the property itself is excluded)', async t => {
    const { f } = await saveProperty(t, [[SAVED_ROW], [], [SAVED_ROW]]);
    const dup = f.queries[1];
    assert.match(dup.sql, /FROM property_cleaning_config WHERE name = \$1 AND property_id <> ALL\(\$2::text\[\]\)/);
    assert.deepEqual(dup.params, [PROPERTY, [PROPERTY]]);
  });

  for (const constraint of ['property_cleaning_config_name_unique', 'property_cleaning_config_name_key']) {
    test(`second check: a concurrent save that slips past the first check gets the same 409 from the DB constraint (${constraint})`, async t => {
      const { res, f } = await saveProperty(t, [[], [], uniqueViolation(constraint)]);
      assert.equal(res.code, 409);
      assert.deepEqual(res.body, { error: '이미 같은 이름의 숙소가 있어요', code: 'NAME_TAKEN' });
      assert.ok(isInsert(f.queries[2]), 'the DB refused the INSERT itself');
    });
  }

  for (const [label, error] of [['another unique constraint', uniqueViolation('property_cleaning_config_pkey')],
    ['a non-unique DB error', Object.assign(new Error('fixture connection reset'), { code: '08006' })]]) {
    test(`other DB errors are not disguised as a name clash (${label}) — the existing 500 stays`, async t => {
      const { res } = await saveProperty(t, [[], [], error], { expectedErrors: 1 });
      assert.equal(res.code, 500);
      assert.deepEqual(res.body, { error: error.message });
    });
  }

  test('a normal save returns the saved row', async t => {
    const { res, f } = await saveProperty(t, [[SAVED_ROW], [], [SAVED_ROW]]);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, SAVED_ROW);
    assert.equal(f.queries.length, 3);
    assert.deepEqual(f.queries[2].params.slice(0, 2), [PROPERTY, PROPERTY]);
  });
});

// ── 청소관리 "숙소" 탭(PropertyPanel) ──────────────────────────────────────────

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node !== 'object') return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = (node) => nodes(node).filter(v => typeof v === 'string' || typeof v === 'number').join(' ').replace(/\s+/g, ' ').trim();

const LOADED = { ...SAVED_ROW, google_calendar_id: null, google_calendar_booking_url: null, host_phone: null, ical_configured: true };

async function propertyPanel(t, extraReplies = []) {
  const route = (call) => {
    if (call.method === 'GET' && call.url === '/api/cleaning/properties') return approvalResponse(200, [LOADED]);
    if (call.method === 'GET' && call.url === '/api/gmail/watch') return approvalResponse(200, { status: 'unknown' });
    throw new Error(`unexpected panel request ${call.method} ${call.url}`);
  };
  const f = await cleaningApprovalFixture({ panel: 'PropertyPanel', replies: [route, route, ...extraReplies],
    props: { syncConfig: { id: PROPERTY, name: '예전 캐시 이름', checkOutHour: 11, cleaningDurationHours: 2.5 } } });
  t.after(() => {
    try {
      assert.equal(f.pendingReplies, 0, 'all scripted HTTP replies consumed');
      assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
    } finally { f.restore(); }
  });
  f.render(); await f.flush();
  return f;
}

describe('actual PropertyPanel — the property name cannot be edited here', () => {
  test('shows the saved name as plain text with the hint to change it in the dashboard settings', async t => {
    const f = await propertyPanel(t);
    const tree = f.render();
    assert.match(text(tree), new RegExp(`숙소 이름 \\(변경은 대시보드 ⚙설정에서\\) ${PROPERTY}`));
    const inputs = nodes(tree).filter(n => n?.type === 'input');
    assert.ok(inputs.length >= 5, 'the other settings are still editable inputs');
    assert.ok(!inputs.some(i => i.props.value === PROPERTY), 'no input carries the name');
  });

  test('typing into every input and saving still sends the loaded name unchanged', async t => {
    const saved = [];
    const afterTyping = (call) => {
      // 캘린더 ID 칸이 채워지면 화면이 그 캘린더의 구독 상태를 한 번 묻는다(실제 동작)
      if (call.method === 'GET' && call.url === '/api/cleaning/calendar-watch?calendar_id=typed-value') return approvalResponse(200, { status: 'unknown' });
      if (call.method === 'POST') { saved.push(call); return approvalResponse(200, LOADED); }
      throw new Error(`unexpected panel request ${call.method} ${call.url}`);
    };
    const f = await propertyPanel(t, [afterTyping, afterTyping]);
    for (const input of nodes(f.render()).filter(n => n?.type === 'input')) {
      input.props.onChange({ target: { value: input.props.type === 'number' ? '9' : 'typed-value' } });
    }
    const save = nodes(f.render()).find(n => n?.type === 'button' && text(n) === '설정 저장');
    assert.ok(save, 'save button');
    await save.props.onClick(); await f.flush();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].method, 'POST'); assert.equal(saved[0].url, '/api/cleaning/properties');
    assert.equal(saved[0].body.property_id, PROPERTY);
    assert.equal(saved[0].body.name, PROPERTY, 'name is the loaded value (server requires it), never typed');
    // 다른 칸은 실제로 바뀌었다 — 입력 이벤트가 효과가 있는데도 이름만 그대로라는 뜻
    assert.equal(saved[0].body.checkout_hour, 9);
    assert.equal(saved[0].body.host_phone, 'typed-value');
    assert.deepEqual(f.toasts, [['숙소 청소 설정 저장 완료', 's']]);
  });
});
