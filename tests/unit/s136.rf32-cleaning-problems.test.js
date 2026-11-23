/**
 * RF-32 (DEC-08) — 청소 상태는 되돌리지 않고 문제로 남긴다.
 *  청소 시작 예정 시각에 담당자가 없음 → cleaning_unassigned_at_start, 청소 1건에 1번.
 *  청소 취소는 그 자체가 "청소 미배정(취소)" 문제 1건이다(DEC-14) — 취소 뒤 구글 작업 실패를 따로 기록하지 않는다(취소 API 계약은 s30)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { recordUnassignedAtStart } from '../../server/cleaning/_problems.js';
import { buildIssueItems, cleaningAssignmentIssueLabel } from '../../src/domain/monthlyCalendarDomain.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';
import { validateEvent, validateWriteEvent } from '../../src/domain/eventValidation.js';
import { SERVER_PROBLEM_EVENT_TYPES } from '../../src/config/eventTypes.js';

const NOW = new Date('2026-11-21T06:00:00.000Z');
const job = (id, extra = {}) => ({
  id, property_id: '파주201', status: 'NOTIFYING_BULK', reservation_uid: `uid-${id}`, start_rank: '0',
  checkout_at: '2026-11-21T02:00:00.000Z', cleaning_start_at: '2026-11-21T02:00:00.000Z', ...extra,
});

function fakeDb({ candidates = [], gone = new Set(), insertFails = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM cleaning_jobs j/.test(sql)) return { rows: candidates };
      if (/AS gone/.test(sql)) return { rows: [{ gone: gone.has(params[2]) }] };
      if (/INSERT INTO events/.test(sql)) {
        if (insertFails) throw new Error('fixture events unavailable');
        return { rows: [{ id: `event-${params[0]}` }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}
const inserts = db => db.queries.filter(q => /INSERT INTO events/.test(q.sql));

describe('RF-32 청소 시작 시 담당자 없음 기록', () => {
  test('찾는 조건: 실제 청소, 배정완료·완료 아님, 시작 시각이 지났고 이틀 안, 이미 기록한 청소(출처 번호) 제외', async () => {
    const db = fakeDb();
    assert.equal(await recordUnassignedAtStart(db, NOW), 0);
    const [{ sql, params }] = db.queries;
    assert.match(sql, /j\.data_origin = 'REAL'/);
    assert.match(sql, /j\.status NOT IN \('ASSIGNED','COMPLETED'\)/);
    assert.match(sql, /j\.cleaning_start_at <= \$1::timestamptz/);
    assert.match(sql, /j\.cleaning_start_at > \$1::timestamptz - INTERVAL '2 days'/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM events e[\s\S]*e\.type = 'cleaning_unassigned_at_start'[\s\S]*e\.source_ref = 'cleaning_job:' \|\| j\.id \|\| ':unassigned_at_start'\)/,
      '시작 시각이 바뀌어도 같은 청소는 다시 기록하지 않는다');
    assert.deepEqual(params, [NOW.toISOString()]);
    assert.match(sql, /SELECT COUNT\(\*\) FROM cleaning_jobs k[\s\S]*k\.property_id = j\.property_id AND k\.cleaning_start_at = j\.cleaning_start_at AND k\.id < j\.id\) AS start_rank/,
      '같은 숙소·같은 시작 시각 청소 중 순번');
  });

  test('청소 1건에 문제 1건 — 발생 시각은 청소 시작 예정 시각(+같은 시작 시각 안 순번 ms), 점검 때 상태를 함께 남긴다', async () => {
    const db = fakeDb({ candidates: [job('j1'), job('j2', { status: 'CANCELLED', cleaning_start_at: '2026-11-20T02:00:00.000Z' })] });
    assert.equal(await recordUnassignedAtStart(db, NOW), 2);
    const rows = inserts(db).map(q => q.params);
    assert.deepEqual(rows.map(([, property, type, isSoft]) => [property, type, isSoft]), [
      ['파주201', 'cleaning_unassigned_at_start', false],
      ['파주201', 'cleaning_unassigned_at_start', false],
    ]);
    assert.deepEqual(rows.map(row => row[4].toISOString()), ['2026-11-21T02:00:00.000Z', '2026-11-20T02:00:00.000Z']);
    const again = fakeDb({ candidates: [job('j1')] });
    await recordUnassignedAtStart(again, NOW);
    assert.equal(inserts(again)[0].params[4].getTime(), rows[0][4].getTime(), '같은 청소는 언제 다시 판정해도 같은 시각');
    assert.deepEqual(rows[0][5], { jobId: 'j1', status: 'NOTIFYING_BULK', checkoutAt: '2026-11-21T02:00:00.000Z' });
    assert.equal(rows[1][5].status, 'CANCELLED', '청소 취소는 다시 배정해야 하는 상태라 담당자 없음으로 센다');
    assert.deepEqual(rows.map(r => [r[6], r[7]]), [
      ['PROPOS_CLEANING', 'cleaning_job:j1:unassigned_at_start'],
      ['PROPOS_CLEANING', 'cleaning_job:j2:unassigned_at_start'],
    ]);
  });

  test('손님 예약이 취소돼 퇴실이 없어진 청소는 기록하지 않는다', async () => {
    const db = fakeDb({ candidates: [job('j1'), job('j2')], gone: new Set(['uid-j1']) });
    assert.equal(await recordUnassignedAtStart(db, NOW), 1);
    assert.deepEqual(inserts(db).map(q => q.params[5].jobId), ['j2']);
  });

  test('같은 숙소에서 같은 시각에 시작하는 두 청소도 둘 다 기록된다 — 순번만큼 1ms씩 밀린다', async () => {
    const db = fakeDb({ candidates: [job('a-job', { start_rank: '0' }), job('b-job', { start_rank: '1' })] });
    await recordUnassignedAtStart(db, NOW);
    const times = inserts(db).map(q => q.params[4].getTime() - Date.parse('2026-11-21T02:00:00.000Z'));
    assert.deepEqual(times, [0, 1]);
  });

  test('기록이 실패해도 다음 청소를 계속 보고, 실패한 건은 세지 않는다', async () => {
    const errors = [];
    const previous = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const db = fakeDb({ candidates: [job('j1'), job('j2')], insertFails: true });
      assert.equal(await recordUnassignedAtStart(db, NOW), 0);
      assert.equal(inserts(db).length, 2);
      assert.equal(errors.length, 2);
      assert.match(errors[0][0], /cleaning_unassigned_at_start 기록 실패/);
    } finally { console.error = previous; }
  });
});

describe('RF-32 달력 문제 목록', () => {
  const derived = (jobId, status) => ({
    property_id: '파주201', occurred_at: '2026-11-21T02:00:00.000Z', category: 'CLEANING', type: 'cleaning_assignment_issue',
    label: cleaningAssignmentIssueLabel(status), detail: { status, jobId },
  });

  test('같은 청소를 두 번 세지 않는다 — 아직 배정 안 된 청소는 지금 상태 항목(최신 문구), 나중에 배정된 청소는 시작 시 기록이 남는다', () => {
    const items = buildIssueItems([
      // j1: 시작 때 기록은 '요청 중'이었지만 지금은 배정 실패 — 지금 상태 문구를 보여 준다
      { property_id: '파주201', type: 'cleaning_unassigned_at_start', device_time: '2026-11-21T02:00:00.000Z', data: { jobId: 'j1', status: 'NOTIFYING_BULK' } },
      // j9: 나중에 배정돼 지금 상태 항목이 없다 — 기록이 남는다
      { property_id: '파주201', type: 'cleaning_unassigned_at_start', device_time: '2026-11-19T02:00:00.000Z', data: { jobId: 'j9', status: 'NOTIFYING_BULK' } },
    ], [derived('j1', 'ESCALATED'), derived('j2', 'CANCELLED')]);
    assert.deepEqual(items.map(item => [item.type, item.label, item.detail.jobId]), [
      ['cleaning_unassigned_at_start', '청소 미배정', 'j9'],
      ['cleaning_assignment_issue', '청소 배정 실패', 'j1'],
      ['cleaning_assignment_issue', '청소 미배정(취소)', 'j2'],
    ]);
    assert.ok(items.every(item => item.category === 'CLEANING'));
  });

  test('시작 시 기록은 지금 상태 항목과 같은 날(퇴실 시각)에 놓인다 — 퇴실과 청소 시작이 다른 달이어도 한 번만 보인다', () => {
    const [item] = buildIssueItems([{ property_id: '파주201', type: 'cleaning_unassigned_at_start', device_time: '2026-10-31T15:30:00.000Z',
      data: { jobId: 'j9', status: 'NOTIFYING_BULK', checkoutAt: '2026-10-31T14:30:00.000Z' } }]);
    assert.equal(item.occurred_at, '2026-10-31T14:30:00.000Z');
  });

  test('시작 시 기록의 문구는 기록할 때의 상태로 정한다', () => {
    const [item] = buildIssueItems([{ property_id: '파주201', type: 'cleaning_unassigned_at_start', device_time: '2026-11-19T02:00:00.000Z', data: { jobId: 'j9', status: 'CANCELLED' } }]);
    assert.equal(item.label, '청소 미배정(취소)');
  });

  test('청소 취소는 "청소 미배정(취소)" 1건 — 같은 청소를 두 번 세지 않는다 (DEC-14)', () => {
    const items = buildIssueItems([
      { property_id: '파주201', type: 'cleaning_unassigned_at_start', device_time: '2026-11-21T02:00:00.000Z', data: { jobId: 'j2', status: 'CANCELLED' } },
    ], [derived('j2', 'CANCELLED')]);
    assert.deepEqual(items.map(item => [item.category, item.label]), [['CLEANING', '청소 미배정(취소)']]);
  });

  test('"취소 후속 처리 실패"라는 문제는 없다 — 예전 종류의 기록이 있어도 문제 목록에 넣지 않는다', () => {
    assert.deepEqual(buildIssueItems([{ property_id: '파주201', type: 'cleaning_cancel_followup_failed', device_time: '2026-11-21T03:00:00.000Z', data: {} }]), []);
    assert.equal(Object.values(SERVER_PROBLEM_EVENT_TYPES).includes('cleaning_cancel_followup_failed'), false);
  });

  test('배정 문제 문구는 한 곳에서 정한다', () => {
    assert.equal(cleaningAssignmentIssueLabel('ESCALATED'), '청소 배정 실패');
    assert.equal(cleaningAssignmentIssueLabel('CANCELLED'), '청소 미배정(취소)');
    assert.equal(cleaningAssignmentIssueLabel('PENDING'), '청소 미배정');
  });
});

describe('RF-32 서버만 남기는 종류는 Pi 입구가 받지 않는다', () => {
  for (const type of Object.values(SERVER_PROBLEM_EVENT_TYPES)) test(type, () => {
    const base = { property_id: '파주201', type, device_time: '2026-11-21T02:00:00.000Z' };
    assert.equal(validateWriteEvent(base).success, false);
    assert.equal(validateEvent({ ...base, id: '123e4567-e89b-42d3-a456-426614174000' }).success, false);
  });
});

describe('RF-32 청소 후속 처리(크론)', () => {
  async function followup(behavior = {}) {
    const { default: handler } = await actualCronModule();
    const io = installCronIO({ behavior });
    try {
      const res = cronResponse();
      await handler({ method: 'GET', url: '/api/cron/cleaning-followup', query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
      return { res, names: io.names() };
    } finally { io.restore(); }
  }

  test('후속 처리는 시작 시 담당자 없음을 기록하고, 응답 모양은 그대로다', async () => {
    const { res, names } = await followup({ recordUnassignedAtStart: async () => 1 });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 0, escalated: 0 });
    assert.ok(names.includes('recordUnassignedAtStart'));
  });

  test('뒤 단계가 실패해도 기록은 먼저 시도된다', async () => {
    const { names } = await followup({ recoverInitialDeliveries: new Error('fixture earlier step down') });
    assert.ok(names.includes('recordUnassignedAtStart'));
    assert.ok(names.indexOf('recordUnassignedAtStart') < names.indexOf('recoverInitialDeliveries'));
  });

  test('기록이 실패해도 후속 처리는 성공으로 끝난다', async () => {
    const { res } = await followup({ recordUnassignedAtStart: async () => { throw new Error('fixture down'); } });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, advanced: 0, reminded: 0, escalated: 0 });
  });
});
