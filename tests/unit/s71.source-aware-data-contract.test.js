/**
 * s71 — 실제 데이터와 가상(시뮬레이션) 데이터 구분: 가상 숙소·일정에는 실제 담당자 요청·재안내·Slack이 나가지 않는다.
 *
 * ACT-08 ⑦-3: 예전엔 소스 파일 글자만 검사했다(정기 작업 파일에 `data_origin = 'REAL'`이 4번 이상 있는지 등).
 * 이제 실제 코드를 실행한다.
 *   - 실제 정기 작업(후속 처리·월간 배치)이 일감을 고르는 조회가 모두 실제 행만 고르는지(DB만 가짜) — 이 파일
 *   - 그 조회를 실제 SQL로 돌려 가상 일정이 정말 빠지는지 — tests/integration/s71.real-only-sql.test.js (PGlite, CI 밖)
 *   - 수동 발송 API가 가상 일정을 거절하는지 — 이 파일
 *   - 가상 데이터 생성 스크립트(seed)는 s121(단위·격리 SQL)이 실제 스크립트를 실행해 확인한다
 *   - 다른 입구의 가상 일정 거절: 거절 링크 s13, 취소 s30, 수동 배정 s78, 발송 함수 s25·s26, 첫 요청·VIP 후속 s109,
 *     캘린더 배정 s89 (각자 실제 구현 시험)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { createSessionToken } from '../../server/auth/operatorAuth.js';

async function runCron(t, action) {
  const { default: handler } = await actualCronModule();
  const fixture = installCronIO();
  t.after(() => fixture.restore());
  const res = cronResponse();
  await handler({ method: 'GET', url: `/api/cron/${action}`, query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
  const picks = fixture.calls.filter(c => c.name === 'db.query').map(c => c.args[0])
    .filter(sql => /^\s*SELECT/i.test(sql));
  return { res, picks };
}
const REAL_ONLY = /data_origin\s*=\s*'REAL'/;

describe('actual cron jobs pick real work only', () => {
  test('follow-up job: every query that picks jobs to request, reopen, remind or escalate selects REAL jobs only', async t => {
    const { res, picks } = await runCron(t, 'cleaning-followup');
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 0, escalated: 0 });
    // 요청 전 일정의 첫 요청 / 아직 막힌 칸 다시 열기 / 단체 재안내 / 배정 실패 넘기기
    assert.equal(picks.length, 4);
    for (const sql of picks) assert.match(sql, REAL_ONLY, sql.trim().split('\n')[0]);
  });

  test('monthly batch: the properties it blocks and polls, and the jobs it schedules, are REAL only', async t => {
    const { res, picks } = await runCron(t, 'monthly-cleaning');
    assert.equal(res.code, 200);
    assert.equal(picks.length, 2);
    assert.match(picks[0], /FROM property_cleaning_config WHERE data_origin = 'REAL'/);
    assert.match(picks[1], /FROM cleaning_jobs\s+WHERE data_origin = 'REAL'/);
  });
});

describe('actual manual dispatch API refuses simulated jobs', () => {
  const JOB = { id: '11111111-1111-4111-8111-111111111111', property_id: 'fixture-property', status: 'PENDING', data_origin: 'SIMULATED' };
  async function dispatch(t, row) {
    const f = await cleaningDeclineFixture({ responses: [[row]], advance: async () => ({ ok: true }) });
    t.after(() => {
      try {
        assert.equal(f.pendingResponses, 0, 'all scripted DB results consumed');
        assert.deepEqual(f.unexpectedQueries, [], 'no hidden unexpected SQL');
        assert.deepEqual(f.blocked, [], 'no unmocked external I/O');
        assert.deepEqual(f.errors, [], 'no hidden handler errors');
        assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests');
      } finally { f.restore(); }
    });
    const cookie = 'propos_session=' + createSessionToken(process.env, Date.now(), { role: 'admin' });
    const res = await f.invoke({ method: 'POST', url: '/api/cleaning/dispatch', body: { job_id: JOB.id }, headers: { cookie } });
    return { res, f };
  }

  test('a SIMULATED job gets 409 and is never handed to the sender', async t => {
    const { res, f } = await dispatch(t, JOB);
    assert.equal(res.code, 409);
    assert.deepEqual(res.body, { error: '시뮬레이션 일정은 외부 배정 발송을 하지 않습니다.', data_origin: 'SIMULATED' });
    assert.equal(f.queries.length, 1);
    assert.deepEqual(f.advances, []);
  });

  test('the same job as REAL is handed to the sender (the refusal is about origin only)', async t => {
    const { res, f } = await dispatch(t, { ...JOB, data_origin: 'REAL' });
    assert.equal(res.code, 200);
    assert.equal(f.advances.length, 1);
    assert.equal(f.advances[0][1].id, JOB.id);
  });
});
