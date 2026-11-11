/**
 * s113 — RF-16 Airbnb 피드에서 사라진 예약 정리 (단위)
 *
 * 사용자 상황(2026-11-11 운영 확인): Airbnb 가 같은 예약을 새 번호로 다시 내보내거나 손님이 취소·날짜 변경을 해도 동기화가
 * 옛 예약·옛 청소 작업을 그대로 남겨, 화면에 숙박이 그대로 보이고 퇴실 없는 날로 청소 요청이 나갈 수 있었다.
 * SQL 동작은 tests/integration/s113.vanished-reservations-sql.test.js 가 격리 DB 로 확인한다.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { actualCleaningModule } from '../helpers/cleaningDeliveryFixture.js';
import { alertGoneCheckoutJobs, alertGoneCheckouts, describeOrphanedJobs, goneAlertKeyOf, goneAlertStoreKey, isCheckoutCancelled,
  isCompleteCalendar, lastSyncStoreKey, postAssignmentSlack, reservationUidOf, retireAfterSync } from '../../server/cleaning/_reservationSync.js';

const api = readFileSync(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
const cron = readFileSync(new URL('../../api/cron/[...slug].js', import.meta.url), 'utf8');
const syncBlock = (() => {
  const start = api.indexOf('async function syncAllPropertiesIcal');
  return api.slice(start, api.indexOf('\n}\n', start));
})();

describe('동기화 연결', () => {
  test('피드 번호가 있으면 그대로, 없으면 "숙소:입실시각" — 저장과 정리가 같은 함수', () => {
    const checkIn = new Date('2026-12-19T06:00:00Z');
    assert.equal(reservationUidOf('파주201', { uid: 'abc@airbnb.com', checkIn }), 'abc@airbnb.com');
    assert.equal(reservationUidOf('파주201', { uid: '', checkIn }), '파주201:2026-12-19T06:00:00.000Z');
    assert.match(syncBlock, /\[prop\.property_id, reservationUidOf\(prop\.property_id, reservation\),/);
    assert.match(syncBlock, /seenUids: parsedReservations\.map\(reservation => reservationUidOf\(prop\.property_id, reservation\)\)/);
    assert.ok(!/reservation\.uid \|\| `\$\{prop\.property_id\}:/.test(syncBlock), '번호 규칙 사본이 남아 있음');
  });

  test('이번 동기화의 시작 시각(DB 시계)을 피드를 받기 전에 잡아 정리에 넘긴다 — 겹친 동기화가 넣은 새 예약 보호', () => {
    const started = syncBlock.indexOf(`db.query('SELECT NOW() AS now')`);
    const fetched = syncBlock.indexOf('await fetch(prop.ical_url)');
    assert.ok(started > 0 && fetched > started, '시작 시각을 피드 요청보다 먼저 잡아야 함');
    assert.match(syncBlock, /if \(syncStartedAt\) \{[\s\S]*retireAfterSync\(db, \{[\s\S]*feedIsCalendar: isCompleteCalendar\(icalText\),\s*syncStartedAt,[\s\S]*store: kv,/);
  });

  // 2026-11-11 리뷰 3차: 동기화는 정해진 주기 없이 돈다(화면·새 예약 메일·수동) — 한 번 흔들린 피드로 진짜 예약을 취소하지 않게
  // 직전 정상 동기화에도 안 보였어야 하고, 숙소의 마지막 예약 취소(피드가 비어 있음)도 놓치지 않게 "온전한 달력"으로 판단한다.
  test('온전한 달력 판단 — 예약 0건인 정상 달력은 판단, 오류 페이지·빈 응답·잘린 응답은 판단하지 않음', () => {
    assert.equal(isCompleteCalendar('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'), true);
    assert.equal(isCompleteCalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR'), true);
    for (const text of ['', '<html>error</html>', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x', null, undefined]) {
      assert.equal(isCompleteCalendar(text), false, String(text));
    }
  });

  const recordStore = ({ previous, failGet = false, failSet = false } = {}) => {
    const writes = [];
    return {
      writes,
      get: async () => { if (failGet) throw new Error('kv down'); return previous ?? null; },
      set: async (key, value, options) => { if (failSet) throw new Error('kv down'); writes.push({ key, value, options }); },
    };
  };
  const noDb = { query: async () => { throw new Error('직전 기록이 없으면 DB 를 보지 않아야 함'); } };
  const started = new Date('2026-11-11T00:00:00Z');

  test('동기화마다 직전 기록을 읽고, 판단할 수 있는 피드(온전한 달력 + 예약 1건 이상)였을 때만 이번 시작 시각을 남긴다', async () => {
    const first = recordStore();
    assert.deepEqual(await retireAfterSync(noDb, { propertyId: '파주201', seenUids: ['a'], feedIsCalendar: true, syncStartedAt: started, store: first }),
      { retired: [], skipped: 'NO_PREVIOUS_SYNC' }, '반영 직후 첫 동기화는 기록만 남긴다');
    assert.deepEqual(first.writes, [{ key: lastSyncStoreKey('파주201'), value: '2026-11-11T00:00:00.000Z', options: { ex: 30 * 86_400 } }]);
    for (const [feedIsCalendar, seenUids, skipped] of [[false, ['a'], 'INVALID_FEED'], [true, [], 'NO_RESERVATIONS']]) {
      const store = recordStore({ previous: '2026-11-10T23:45:00.000Z' });
      assert.deepEqual(await retireAfterSync(noDb, { propertyId: '파주201', seenUids, feedIsCalendar, syncStartedAt: started, store }), { retired: [], skipped });
      assert.deepEqual(store.writes, [], `${skipped} 피드는 "정상 동기화"로 남기지 않는다`);
    }
  });

  test('직전 기록을 못 읽으면 정리하지 않고, 기록 저장 실패는 동기화를 멈추지 않는다', async () => {
    assert.deepEqual(await retireAfterSync(noDb, { propertyId: '파주201', seenUids: ['a'], feedIsCalendar: true, syncStartedAt: started, store: recordStore({ failGet: true }) }),
      { retired: [], skipped: 'NO_PREVIOUS_SYNC' });
    assert.deepEqual(await retireAfterSync(noDb, { propertyId: '파주201', seenUids: ['a'], feedIsCalendar: true, syncStartedAt: started, store: recordStore({ failSet: true }) }),
      { retired: [], skipped: 'NO_PREVIOUS_SYNC' });
  });

  test('다시 나타난 예약은 기존 저장이 "예약됨"으로 되돌린다 (취소 표시가 굳지 않는다)', () => {
    assert.match(syncBlock, /ON CONFLICT \(property_id,reservation_uid\) DO UPDATE SET[\s\S]*?status='ACTIVE'/);
  });

  test('정리·알림이 실패해도 새 예약·청소 생성은 계속되고, 알림 기록은 숙소마다 하나(바뀌었을 때만 저장)', () => {
    const start = syncBlock.indexOf('// RF-16: 피드에서 사라진 미래 예약');
    const block = syncBlock.slice(start, syncBlock.indexOf('for (const reservation of checkouts)', start));
    // 2026-11-11 리뷰 3차: 알림 단계를 동기화·캘린더 배정이 같이 쓰는 alertGoneCheckouts 로 옮김(기록·보내기 동작은 아래 행동 테스트)
    assert.match(block, /try \{[\s\S]*retireAfterSync[\s\S]*await alertGoneCheckouts\(db, \{ propertyId: prop\.property_id, propertyName: prop\.name, now: new Date\(now\), \.\.\.goneAlertDeps \}\);\s*\} catch \(e\) \{\s*console\.error/);
    assert.match(api, /const goneAlertDeps = \{ store: kv, send: postSlack \};/);
  });

  test('새 청소 작업도 예약과 같은 번호 규칙으로 저장한다 (번호 없는 피드 예약도 저장된 예약을 가리킴)', () => {
    assert.match(syncBlock, /\[prop\.property_id, reservationUidOf\(prop\.property_id, reservation\), cleaning_start_at\.toISOString\(\),/);
    assert.ok(!/\[prop\.property_id, uid \?\? null, cleaning_start_at/.test(syncBlock));
  });
});

describe('운영자 알림', () => {
  test('퇴실이 없어진 날과 청소 상태(담당자 배정·요청 중·배정 실패)를 알린다', () => {
    const message = describeOrphanedJobs('파주201', [
      { checkout_at: '2026-12-20T02:00:00Z', status: 'ASSIGNED', cleaner_name: '김민지' },
      { checkout_at: '2026-12-27T02:00:00Z', status: 'PENDING' },
      { checkout_at: '2027-01-03T02:00:00Z', status: 'ESCALATED' },
      { checkout_at: '2027-01-10T02:00:00Z', status: 'ASSIGNED' },
      { checkout_at: '2027-01-17T02:00:00Z', status: 'NOTIFYING_BULK' },
    ]);
    assert.equal(message, [
      '[PROPOS] ⚠️ 파주201 예약이 Airbnb에서 사라지거나 날짜가 바뀌어 그날 퇴실이 없어요. 청소 일정을 확인해 주세요.',
      '• 12/20(일) 11:00 퇴실 청소 — 김민지님 배정됨',
      '• 12/27(일) 11:00 퇴실 청소 — 아직 요청 전 — 요청은 보내지 않아요',
      '• 1/3(일) 11:00 퇴실 청소 — 배정 실패로 남아 있음',
      '• 1/10(일) 11:00 퇴실 청소 — 담당자 배정됨',
      '• 1/17(일) 11:00 퇴실 청소 — 청소 요청 진행 중 — 새 요청은 보내지 않아요',
      '담당자에게 알리거나 청소 관리에서 일정을 취소해 주세요.',
    ].join('\n'));
    assert.equal(describeOrphanedJobs('파주201', []), null);
  });

  const jobs = [{ id: 'a', checkout_at: '2026-12-20T02:00:00Z', status: 'PENDING' }, { id: 'b', checkout_at: '2026-12-27T02:00:00Z', status: 'PENDING' }];
  const sender = ok => { const sent = []; return { sent, send: async text => { sent.push(text); return ok; } }; };

  test('아직 알리지 않은 작업만 모아 한 번 보내고, 알린 목록에 더한다', async () => {
    const s = sender(true);
    const result = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: ['a'], send: s.send });
    assert.deepEqual(result, { alerted: 1, alertedIds: ['a', 'b'], sentIds: ['b'] });
    assert.equal(s.sent.length, 1);
    assert.match(s.sent[0], /12\/27/);
    assert.doesNotMatch(s.sent[0], /12\/20/);
  });

  test('보내기에 실패하면 알린 목록에 넣지 않는다 — 다음 동기화에 다시 보낸다', async () => {
    const result = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: [], send: sender(false).send });
    assert.deepEqual(result, { alerted: 0, alertedIds: [], sentIds: [] });
  });

  test('정상으로 돌아온 작업은 목록에서 빠진다 — 나중에 다시 사라지면 다시 알린다', async () => {
    const s = sender(true);
    const restored = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs: [jobs[1]], previouslyAlertedIds: ['a', 'b'], send: s.send });
    assert.deepEqual(restored, { alerted: 0, alertedIds: ['b'], sentIds: [] });
    assert.equal(s.sent.length, 0);
    const again = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: restored.alertedIds, send: s.send });
    assert.deepEqual(again, { alerted: 1, alertedIds: ['b', 'a'], sentIds: ['a'] });
  });

  test('기록을 못 읽었으면 이번엔 보내지 않고 저장도 하지 않는다 — 동기화마다 같은 알림이 반복되지 않게', async () => {
    const s = sender(true);
    assert.deepEqual(await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: null, send: s.send }), { alerted: 0, alertedIds: null, sentIds: [] });
    assert.equal(s.sent.length, 0);
  });

  // 2026-11-11 리뷰 3차: 손님 취소 알림(요청 중)이 나간 뒤 담당자가 이미 받은 요청을 수락하면, 담당자가 퇴실 없는 날 온다.
  // 같은 작업이라도 담당자가 배정되면 다시 알린다(가장 위험한 순간). 요청 중 상태끼리 바뀌는 건 다시 알리지 않는다.
  test('요청 중일 때 알린 작업에 담당자가 배정되면 다시 알린다 — 요청 중 상태끼리는 다시 알리지 않는다', async () => {
    const s = sender(true);
    const first = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs: [{ ...jobs[0], status: 'NOTIFYING_VIP_1' }], previouslyAlertedIds: [], send: s.send });
    assert.deepEqual(first, { alerted: 1, alertedIds: ['a'], sentIds: ['a'] });
    const stillRequesting = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs: [{ ...jobs[0], status: 'NOTIFYING_BULK' }], previouslyAlertedIds: first.alertedIds, send: s.send });
    assert.deepEqual(stillRequesting, { alerted: 0, alertedIds: ['a'], sentIds: [] });
    const assigned = await alertGoneCheckoutJobs({ propertyName: '파주201',
      jobs: [{ ...jobs[0], status: 'ASSIGNED', has_cleaner: true, cleaner_name: '김민지' }], previouslyAlertedIds: stillRequesting.alertedIds, send: s.send });
    assert.deepEqual(assigned, { alerted: 1, alertedIds: ['a:assigned'], sentIds: ['a:assigned'] });
    assert.equal(s.sent.length, 2);
    assert.match(s.sent[1], /12\/20\(일\) 11:00 퇴실 청소 — 김민지님 배정됨/);
    const again = await alertGoneCheckoutJobs({ propertyName: '파주201',
      jobs: [{ ...jobs[0], status: 'ASSIGNED', has_cleaner: true, cleaner_name: '김민지' }], previouslyAlertedIds: assigned.alertedIds, send: s.send });
    assert.deepEqual(again, { alerted: 0, alertedIds: ['a:assigned'], sentIds: [] });
    assert.equal(goneAlertKeyOf({ id: 7, status: 'ESCALATED', has_cleaner: true }), '7');
    assert.equal(goneAlertKeyOf({ id: 7, status: 'ASSIGNED', has_cleaner: false }), '7', '상태만 배정됨이고 담당자가 없으면 아직 아무도 오지 않는다');
  });
});

describe('알림 기록·캘린더 배정 경고 (동기화와 캘린더 배정이 같은 함수)', () => {
  // 퇴실 확인 결과(gone)와 퇴실이 없어진 작업 목록만 돌려주는 가짜 DB
  const fakeDb = ({ gone, goneJobs = [] }) => ({
    query: async (sql) => {
      if (/AS gone/.test(sql)) return { rows: [{ gone }] };
      if (/FROM cleaning_jobs j/.test(sql)) return { rows: goneJobs };
      throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`);
    },
  });
  const fakeStore = (initial, { failGet = false } = {}) => {
    const saved = new Map(initial === undefined ? [] : [[goneAlertStoreKey('파주201'), initial]]);
    const writes = [];
    return {
      saved, writes,
      get: async key => { if (failGet) throw new Error('kv down'); return saved.get(key) ?? null; },
      set: async (key, value, options) => { writes.push({ key, value, options }); saved.set(key, value); },
    };
  };
  const sender = ok => { const sent = []; return { sent, send: async text => { sent.push(text); return ok; } }; };
  const job = { id: 'j1', property_id: '파주201', checkout_at: '2026-12-20T02:00:00Z', reservation_uid: 'old@airbnb.com' };
  const goneJob = { id: 'j1', checkout_at: '2026-12-20T02:00:00Z', status: 'ASSIGNED', has_cleaner: true, cleaner_name: '김민지' };

  test('알린 기록은 숙소마다 하나, 바뀌었을 때만 반년 보관으로 저장한다', async () => {
    const store = fakeStore(undefined);
    const s = sender(true);
    const result = await alertGoneCheckouts(fakeDb({ gone: true, goneJobs: [goneJob] }), { propertyId: '파주201', propertyName: '파주201', store, send: s.send });
    assert.equal(result.alerted, 1);
    assert.deepEqual(store.writes, [{ key: 'cleaning:gone-checkout-alerts:파주201', value: ['j1:assigned'], options: { ex: 180 * 86_400 } }]);
    await alertGoneCheckouts(fakeDb({ gone: true, goneJobs: [goneJob] }), { propertyId: '파주201', store, send: s.send });
    assert.equal(store.writes.length, 1, '바뀌지 않았는데 다시 저장함');
    assert.equal(s.sent.length, 1);
  });

  test('기록 저장소가 고장 나면 보내지 않는다 (예외 없이)', async () => {
    const s = sender(true);
    const result = await alertGoneCheckouts(fakeDb({ gone: true, goneJobs: [goneJob] }), { propertyId: '파주201', store: fakeStore(undefined, { failGet: true }), send: s.send });
    assert.deepEqual(result, { alerted: 0, alertedIds: null, sentIds: [] });
    assert.equal(s.sent.length, 0);
  });

  test('퇴실이 있는 날의 캘린더 배정은 예전 "배정 완료" 그대로', async () => {
    const s = sender(true);
    const store = fakeStore(undefined);
    await postAssignmentSlack(fakeDb({ gone: false }), { job, propertyName: '파주201', cleanerName: '김민지', normalText: '✅ 배정 완료', store, send: s.send });
    assert.deepEqual(s.sent, ['✅ 배정 완료']);
    assert.equal(store.writes.length, 0);
  });

  test('퇴실이 없어진 날의 캘린더 배정은 "배정 완료" 대신 경고 — 기록에 남겨 다음 동기화에 다시 가지 않는다', async () => {
    const s = sender(true);
    const store = fakeStore(['j1']); // 요청 중일 때 이미 한 번 알림
    await postAssignmentSlack(fakeDb({ gone: true, goneJobs: [goneJob] }), { job, propertyName: '파주201', cleanerName: '김민지', normalText: '✅ 배정 완료', store, send: s.send });
    assert.equal(s.sent.length, 1);
    assert.doesNotMatch(s.sent[0], /✅/);
    assert.match(s.sent[0], /그날 퇴실이 없어요[\s\S]*12\/20\(일\) 11:00 퇴실 청소 — 김민지님 배정됨/);
    assert.deepEqual(store.saved.get(goneAlertStoreKey('파주201')), ['j1:assigned']);
    // 다음 동기화: 같은 상태라 다시 보내지 않는다
    const next = await alertGoneCheckouts(fakeDb({ gone: true, goneJobs: [goneJob] }), { propertyId: '파주201', store, send: s.send });
    assert.equal(next.alerted, 0);
    assert.equal(s.sent.length, 1);
  });

  test('기록을 못 읽었거나 이미 알렸어도 "배정 완료"라고는 하지 않는다 — 이 작업만 경고', async () => {
    for (const store of [fakeStore(undefined, { failGet: true }), fakeStore(['j1:assigned'])]) {
      const s = sender(true);
      await postAssignmentSlack(fakeDb({ gone: true, goneJobs: [goneJob] }), { job, propertyName: '파주201', cleanerName: '김민지', normalText: '✅ 배정 완료', store, send: s.send });
      assert.equal(s.sent.length, 1);
      assert.doesNotMatch(s.sent[0], /✅/);
      assert.match(s.sent[0], /12\/20\(일\) 11:00 퇴실 청소 — 김민지님 배정됨/);
    }
  });

  test('같은 숙소의 다른 작업만 이번 메시지에 들어갔으면 방금 배정된 작업을 따로 알린다', async () => {
    const s = sender(true);
    const store = fakeStore(['j1:assigned']);
    const other = { id: 'j2', checkout_at: '2026-12-27T02:00:00Z', status: 'PENDING', has_cleaner: false };
    await postAssignmentSlack(fakeDb({ gone: true, goneJobs: [goneJob, other] }), { job, propertyName: '파주201', cleanerName: '김민지', normalText: '✅ 배정 완료', store, send: s.send });
    assert.equal(s.sent.length, 2);
    assert.match(s.sent[0], /12\/27/);
    assert.doesNotMatch(s.sent[0], /12\/20/);
    assert.match(s.sent[1], /12\/20\(일\) 11:00 퇴실 청소 — 김민지님 배정됨/);
  });

  test('캘린더 웹훅·관리자 캘린더 스캔 두 곳 모두 이 함수로 알린다 (예전 "배정" Slack 직접 호출이 남지 않음)', () => {
    const calls = api.match(/await postAssignmentSlack\(db, \{ job, propertyName: propCfg\.name, cleanerName: cleaner\.name, \.\.\.goneAlertDeps,/g) ?? [];
    assert.equal(calls.length, 2);
    assert.ok(!/await postSlack\(`\[PROPOS\] ✅ \$\{propCfg\.name\} \$\{eventDate\} 청소 배정/.test(api), '배정 Slack 직접 호출이 남아 있음');
  });

  test('Slack 보내기는 성공 여부를 돌려준다 (실패해도 예외 없음)', async () => {
    const previousFetch = globalThis.fetch;
    const previousHook = process.env.PROPOS_SLACK_WEBHOOK;
    process.env.PROPOS_SLACK_WEBHOOK = 'https://hooks.slack.invalid/fixture';
    try {
      const { postSlack } = await import(`../../server/cleaning/_slack.js?fixture=${Date.now()}`);
      globalThis.fetch = async () => ({ ok: true, status: 200 });
      assert.equal(await postSlack('x'), true);
      globalThis.fetch = async () => ({ ok: false, status: 503 });
      assert.equal(await postSlack('x'), false);
      globalThis.fetch = async () => { throw new Error('network'); };
      assert.equal(await postSlack('x'), false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousHook === undefined) delete process.env.PROPOS_SLACK_WEBHOOK; else process.env.PROPOS_SLACK_WEBHOOK = previousHook;
    }
  });
});

describe('발송 전 확인 — 퇴실이 없어진 날만 막는다', () => {
  const job = { id: 'j1', property_id: '파주201', checkout_at: '2026-12-20T02:00:00Z', reservation_uid: 'u1', data_origin: 'REAL' };

  test('판단은 DB 규칙 하나(gone)를 그대로 따르고, 근거가 없으면 보낸다', async () => {
    const answer = gone => ({ query: async (_sql, params) => {
      assert.deepEqual(params, ['파주201', '2026-12-20T02:00:00.000Z', 'u1']);
      return { rows: [{ gone }] };
    } });
    assert.equal(await isCheckoutCancelled(answer(true), job), true);
    assert.equal(await isCheckoutCancelled(answer(false), job), false);
    assert.equal(await isCheckoutCancelled({ query: async () => ({ rows: [] }) }, job), false);
    assert.equal(await isCheckoutCancelled(answer(true), { property_id: '파주201' }), false);
  });

  for (const [status, label] of [['PENDING', '첫 요청'], ['NOTIFYING_VIP_3', '단체 요청']]) {
    test(`${label}: 퇴실이 없어진 날이면 보내지 않고, 작업·요청 기록도 바꾸지 않는다`, async () => {
      const dispatch = await actualCleaningModule('server/cleaning/_dispatch.js');
      const queries = [];
      const db = {
        query: async sql => {
          queries.push(sql);
          if (/FROM property_cleaning_config/.test(sql)) return { rows: [{ property_id: '파주201', name: '파주201', data_origin: 'REAL' }] };
          if (/FROM cleaning_notifs/.test(sql)) return { rows: [] };
          if (/FROM property_reservations/.test(sql)) return { rows: [{ gone: true }] };
          throw new Error(`예상하지 못한 DB 호출: ${sql.slice(0, 60)}`);
        },
      };
      const result = await dispatch.advanceJob(db, { ...job, status });
      assert.deepEqual(result, { ok: false, state: 'CANCELLED', errorCode: 'RESERVATION_CANCELLED' });
      assert.ok(!queries.some(sql => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), '쓰기 쿼리가 있음');
    });
  }

  test('이미 접수된 요청(ACCEPTED)의 상태 반영은 퇴실 확인 없이 그대로 한다 — 보내는 일이 아니므로', async () => {
    const dispatch = await actualCleaningModule('server/cleaning/_dispatch.js');
    const queries = [];
    const db = {
      query: async sql => {
        queries.push(sql);
        if (/FROM property_cleaning_config/.test(sql)) return { rows: [{ property_id: '파주201', name: '파주201', data_origin: 'REAL' }] };
        if (/FROM cleaning_notifs/.test(sql)) return { rows: [{ id: 'n1', initial_delivery_state: 'ACCEPTED', initial_delivery_data: { cleaner: { id: 'c1' } } }] };
        return { rows: [] };
      },
    };
    await dispatch.advanceJob(db, { ...job, status: 'PENDING' }).catch(() => {}); // 이 가짜 DB 로는 상태 반영 단계에서 멈춘다
    assert.ok(!queries.some(sql => /FROM property_reservations/.test(sql)), '접수된 요청 반영 전에 퇴실 확인을 함');
  });

  test('퇴실 확인이 실패하면 예전처럼 진행한다 (확인 하나가 정상 요청·크론 전체를 멈추지 않게)', async () => {
    const failing = { query: async () => { throw Object.assign(new Error('fixture'), { code: 'XX000' }); } };
    assert.equal(await isCheckoutCancelled(failing, job), false);
  });

  test('단체 재안내·"배정 실패" 넘김도 퇴실이 없어진 날이면 하지 않는다', () => {
    assert.match(cron, /j\.checkout_at AS job_checkout_at, j\.reservation_uid AS job_reservation_uid,/);
    assert.match(cron, /for \(const notif of bulkNotifs\) \{\s*\/\/ RF-16[^\n]*\n\s*if \(await isCheckoutCancelled\(db, \{ property_id: notif\.property_id, checkout_at: notif\.job_checkout_at, reservation_uid: notif\.job_reservation_uid \}\)\) continue;/);
    assert.match(cron, /SELECT j\.id, j\.property_id, j\.cleaning_start_at, j\.checkout_at, j\.reservation_uid/);
    assert.match(cron, /for \(const job of bulkJobs\) \{\s*\/\/ RF-16[^\n]*\n\s*if \(await isCheckoutCancelled\(db, job\)\) continue;/);
  });

  // 2026-11-11 리뷰 3차: 단체 요청을 모두 거절한 경우·화면이 열릴 때 도는 후속 처리의 "배정 실패 — 수동 처리 필요" 넘김도 같은 규칙으로
  test('단체 요청을 모두 거절해도 퇴실이 없어진 날이면 "배정 실패"로 넘기지 않는다', () => {
    assert.match(api, /j\.status AS job_status, j\.data_origin, j\.property_id, j\.cleaning_start_at, j\.checkout_at, j\.reservation_uid\s+FROM cleaning_notifs n/);
    assert.match(api, /if \(parseInt\(total\) === parseInt\(declined\) && !\(await isCheckoutCancelled\(db, notif\)\)\) \{\s*await db\.query\(`UPDATE cleaning_jobs SET status='ESCALATED'/);
  });

  test('화면이 열릴 때 도는 후속 처리(runFollowupChecks)도 퇴실이 없어진 날은 "배정 실패"로 넘기지 않는다', () => {
    const block = api.slice(api.indexOf('async function runFollowupChecks'), api.indexOf('async function listJobs'));
    assert.match(block, /SELECT j\.id, j\.property_id, j\.cleaning_start_at, j\.checkout_at, j\.reservation_uid FROM cleaning_jobs j/);
    assert.match(block, /for \(const job of bulkJobs\) \{\s*\/\/ RF-16[^\n]*\n\s*if \(await isCheckoutCancelled\(db, job\)\) continue;/);
  });

  test('"배정 실패"로 넘기는 곳은 모두 바로 앞에서 퇴실을 확인한다 — 새로 만든 넘김이 확인을 빠뜨리면 깨진다', () => {
    // 각 넘김 바로 앞(같은 파일의 앞 넘김 뒤부터, 최대 700자)만 본다 — 앞 넘김의 확인으로 새 넘김이 통과하지 않게
    const sites = [];
    for (const [file, text] of [['api/cleaning', api], ['api/cron', cron]]) {
      let previousEnd = 0;
      for (const match of text.matchAll(/SET status='ESCALATED'/g)) {
        sites.push([file, text.slice(Math.max(previousEnd, match.index - 700), match.index)]);
        previousEnd = match.index + match[0].length;
      }
    }
    assert.equal(sites.length, 3, '넘김 위치 수가 바뀌었다 — 새 위치도 퇴실 확인을 넣고 이 숫자를 고칠 것');
    for (const [file, before] of sites) assert.match(before, /isCheckoutCancelled\(db, /, `${file} 의 "배정 실패" 넘김 앞에 퇴실 확인이 없음`);
  });

  test('운영자가 직접 보낸 경우엔 내부 코드 대신 문장으로 알린다', () => {
    assert.match(api, /if \(result\.errorCode === 'RESERVATION_CANCELLED'\) \{\s*return sendJson\(res, 409, \{ ok: false, error: '그날 퇴실 예약이 없어 청소 요청을 보내지 않았어요\. 예약을 확인해 주세요\.'/);
  });
});
