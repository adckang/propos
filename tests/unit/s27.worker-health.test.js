/**
 * s27 — Worker 앱 헬스체크 실제 크론 핸들러 테스트
 *
 * 예전 테스트는 30일/7일 판정과 Slack 문구를 이 파일에 다시 구현했다. 여기서는
 * /api/cron/worker-health-check를 실행해 실제 SQL, 실행 순서, 응답, Slack 경계를 검증한다.
 */

import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';

let handler;
before(async () => { ({ default: handler } = await actualCronModule()); });
after(() => { delete globalThis.__cronHandlerIO; });
afterEach(() => {
  assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
});

function dbSequence(...results) {
  let index = 0;
  return async () => {
    if (index >= results.length) throw new Error(`unexpected worker-health query ${index + 1}`);
    const result = results[index++];
    if (result instanceof Error) throw result;
    return result;
  };
}

async function runHealth(t, { deactivated = 0, stale = [], behavior = {} } = {}) {
  const fixture = installCronIO({
    behavior: {
      'db.query': dbSequence(
        { rows: [], rowCount: deactivated },
        { rows: stale, rowCount: stale.length },
      ),
      ...behavior,
    },
  });
  t.after(() => fixture.restore());
  const res = cronResponse();
  await handler({
    method: 'GET',
    url: '/api/cron/worker-health-check',
    query: {},
    headers: { authorization: 'Bearer fixture-cron-secret' },
  }, res);
  return { fixture, res };
}

const sqlCalls = fixture => fixture.calls
  .filter(call => call.name === 'db.query')
  .map(call => call.args[0].replace(/\s+/g, ' ').trim());

const slackMessages = fixture => fixture.calls
  .filter(call => call.name === 'postSlack')
  .map(call => call.args[0]);

describe('actual worker-health cron — database contract', () => {
  test('30일 초과 active를 먼저 inactive로 바꾸고, 남은 active 중 7일 초과를 조회한다', async t => {
    const { fixture, res } = await runHealth(t);
    const [deactivateSql, staleSql] = sqlCalls(fixture);

    assert.match(deactivateSql, /^UPDATE cleaners SET fcm_status = 'inactive'/i);
    assert.match(deactivateSql, /WHERE fcm_status = 'active'/i);
    assert.match(deactivateSql, /last_seen_at < NOW\(\) - INTERVAL '30 days'/i);
    assert.doesNotMatch(deactivateSql, /last_seen_at\s*<=/i);

    assert.match(staleSql, /^SELECT name, phone, last_seen_at FROM cleaners/i);
    assert.match(staleSql, /WHERE fcm_status = 'active'/i);
    assert.match(staleSql, /last_seen_at < NOW\(\) - INTERVAL '7 days'/i);
    assert.match(staleSql, /ORDER BY last_seen_at ASC/i);
    assert.doesNotMatch(staleSql, /last_seen_at\s*<=/i);

    assert.deepEqual(res.body, { ok: true, deactivated: 0, stale: 0 });
    assert.equal(fixture.names().at(-1), 'db.end');
  });

  test('30일 전환 뒤 7일 목록을 조회하므로 같은 실행에서 전환된 직원은 경고 목록에서 빠진다', async t => {
    const { fixture } = await runHealth(t, { deactivated: 1, stale: [
      { name: '열흘미접속', phone: '010-0000-0001', last_seen_at: '2026-11-08T00:00:00.000Z' },
    ] });
    const queries = fixture.calls.filter(call => call.name === 'db.query');
    assert.ok(queries[0].args[0].includes('UPDATE cleaners'));
    assert.ok(queries[1].args[0].includes('SELECT name'));
    assert.equal(slackMessages(fixture).filter(message => message.includes('장기 미접속')).length, 1);
    assert.equal(slackMessages(fixture).filter(message => message.includes('비활성 전환')).length, 1);
  });

  test('null last_seen_at은 두 SQL의 엄격한 비교에서 제외하고 별도 미기록 문구를 만들지 않는다', async t => {
    const { fixture, res } = await runHealth(t);
    const queries = sqlCalls(fixture);
    assert.equal(queries.length, 2);
    assert.ok(queries.every(sql => sql.includes('last_seen_at < NOW()')));
    assert.equal(fixture.names().includes('postSlack'), false);
    assert.deepEqual(res.body, { ok: true, deactivated: 0, stale: 0 });
  });
});

describe('actual worker-health cron — response and Slack messages', () => {
  test('대상 없으면 Slack 없이 0건 성공 응답을 반환한다', async t => {
    const { fixture, res } = await runHealth(t);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, deactivated: 0, stale: 0 });
    assert.deepEqual(slackMessages(fixture), []);
  });

  test('7일 초과 active 목록은 조회 순서대로 인원·이름·경과 일수를 알린다', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-18T00:00:00.000Z');
    t.after(() => { Date.now = realNow; });
    const stale = [
      { name: '김청소', phone: '010-1111-1111', last_seen_at: '2026-11-08T00:00:00.000Z' },
      { name: '이청소', phone: '010-2222-2222', last_seen_at: '2026-11-10T12:00:00.000Z' },
    ];
    const { fixture, res } = await runHealth(t, { stale });

    assert.deepEqual(res.body, { ok: true, deactivated: 0, stale: 2 });
    assert.deepEqual(slackMessages(fixture), [
      '[PROPOS] 🟡 Worker 앱 장기 미접속 (2명)\n  • 김청소 — 10일 미접속\n  • 이청소 — 7일 미접속',
    ]);
  });

  test('이름이 없으면 phone을 사용하고 경과 일수는 내림한다', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-18T00:00:00.000Z');
    t.after(() => { Date.now = realNow; });
    const { fixture } = await runHealth(t, { stale: [
      { name: null, phone: '010-3333-3333', last_seen_at: '2026-11-09T01:00:00.000Z' },
    ] });
    assert.deepEqual(slackMessages(fixture), [
      '[PROPOS] 🟡 Worker 앱 장기 미접속 (1명)\n  • 010-3333-3333 — 8일 미접속',
    ]);
  });

  test('30일 초과 전환 건수는 별도 Slack과 응답에 반영한다', async t => {
    const { fixture, res } = await runHealth(t, { deactivated: 3 });
    assert.deepEqual(res.body, { ok: true, deactivated: 3, stale: 0 });
    assert.deepEqual(slackMessages(fixture), [
      '[PROPOS] 🟠 Worker 앱 비활성 전환 — 3명 (30일 미접속)',
    ]);
  });

  test('경고 목록과 전환 건수가 모두 있으면 경고를 먼저, 전환을 나중에 알린다', async t => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-18T00:00:00.000Z');
    t.after(() => { Date.now = realNow; });
    const { fixture, res } = await runHealth(t, { deactivated: 2, stale: [
      { name: '이청소', phone: '010-2222-2222', last_seen_at: '2026-11-10T00:00:00.000Z' },
    ] });
    assert.deepEqual(res.body, { ok: true, deactivated: 2, stale: 1 });
    assert.match(slackMessages(fixture)[0], /장기 미접속/);
    assert.match(slackMessages(fixture)[1], /비활성 전환/);
  });
});

describe('actual worker-health cron — failure boundary', () => {
  test('inactive UPDATE 실패는 500이고 조회·Slack 없이 DB를 닫는다', async t => {
    const { fixture, res } = await runHealth(t, { behavior: {
      'db.query': dbSequence(new Error('deactivate failed')),
    } });
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'deactivate failed' });
    assert.deepEqual(fixture.names(), ['db.pool', 'db.query', 'db.end']);
  });

  test('7일 목록 조회 실패는 이미 끝난 UPDATE를 되돌리지 않고 500을 반환한다', async t => {
    const { fixture, res } = await runHealth(t, { behavior: {
      'db.query': dbSequence({ rows: [], rowCount: 2 }, new Error('stale query failed')),
    } });
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'stale query failed' });
    assert.deepEqual(fixture.names(), ['db.pool', 'db.query', 'db.query', 'db.end']);
  });

  test('장기 미접속 Slack 실패는 전환 알림 전 500으로 끝난다', async t => {
    const { fixture, res } = await runHealth(t, {
      deactivated: 1,
      stale: [{ name: '김청소', phone: '010-1111-1111', last_seen_at: '2026-11-01T00:00:00.000Z' }],
      behavior: { postSlack: new Error('slack failed') },
    });
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'slack failed' });
    assert.equal(fixture.names().filter(name => name === 'postSlack').length, 1);
    assert.equal(fixture.names().at(-1), 'db.end');
  });
});
