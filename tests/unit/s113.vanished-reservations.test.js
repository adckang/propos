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
import { alertGoneCheckoutJobs, describeOrphanedJobs, reservationUidOf, isCheckoutCancelled } from '../../server/cleaning/_reservationSync.js';

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
    assert.match(syncBlock, /if \(syncStartedAt\) \{[\s\S]*retireVanishedReservations\(db, \{[\s\S]*syncStartedAt,/);
  });

  test('다시 나타난 예약은 기존 저장이 "예약됨"으로 되돌린다 (취소 표시가 굳지 않는다)', () => {
    assert.match(syncBlock, /ON CONFLICT \(property_id,reservation_uid\) DO UPDATE SET[\s\S]*?status='ACTIVE'/);
  });

  test('정리·알림이 실패해도 새 예약·청소 생성은 계속되고, 알림 기록은 숙소마다 하나(바뀌었을 때만 저장)', () => {
    const start = syncBlock.indexOf('// RF-16: 피드에서 사라진 미래 예약');
    const block = syncBlock.slice(start, syncBlock.indexOf('for (const reservation of checkouts)', start));
    assert.match(block, /try \{[\s\S]*retireVanishedReservations[\s\S]*alertGoneCheckoutJobs\(\{[\s\S]*send: postSlack,[\s\S]*\} catch \(e\) \{\s*console\.error/);
    assert.match(block, /jobs: await listGoneCheckoutJobs\(db, \{ propertyId: prop\.property_id/);
    assert.match(block, /const previouslyAlertedIds = await kv\.get\(alertKey\)/);
    assert.match(block, /if \(alertedIds && JSON\.stringify\(alertedIds\) !== JSON\.stringify\(previouslyAlertedIds\)\) \{\s*await kv\.set\(alertKey, alertedIds/);
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
    assert.deepEqual(result, { alerted: 1, alertedIds: ['a', 'b'] });
    assert.equal(s.sent.length, 1);
    assert.match(s.sent[0], /12\/27/);
    assert.doesNotMatch(s.sent[0], /12\/20/);
  });

  test('보내기에 실패하면 알린 목록에 넣지 않는다 — 다음 동기화에 다시 보낸다', async () => {
    const result = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: [], send: sender(false).send });
    assert.deepEqual(result, { alerted: 0, alertedIds: [] });
  });

  test('정상으로 돌아온 작업은 목록에서 빠진다 — 나중에 다시 사라지면 다시 알린다', async () => {
    const s = sender(true);
    const restored = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs: [jobs[1]], previouslyAlertedIds: ['a', 'b'], send: s.send });
    assert.deepEqual(restored, { alerted: 0, alertedIds: ['b'] });
    assert.equal(s.sent.length, 0);
    const again = await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: restored.alertedIds, send: s.send });
    assert.deepEqual(again, { alerted: 1, alertedIds: ['b', 'a'] });
  });

  test('기록을 못 읽었으면 이번엔 보내지 않고 저장도 하지 않는다 — 동기화마다 같은 알림이 반복되지 않게', async () => {
    const s = sender(true);
    assert.deepEqual(await alertGoneCheckoutJobs({ propertyName: '파주201', jobs, previouslyAlertedIds: null, send: s.send }), { alerted: 0, alertedIds: null });
    assert.equal(s.sent.length, 0);
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

  test('운영자가 직접 보낸 경우엔 내부 코드 대신 문장으로 알린다', () => {
    assert.match(api, /if \(result\.errorCode === 'RESERVATION_CANCELLED'\) \{\s*return sendJson\(res, 409, \{ ok: false, error: '그날 퇴실 예약이 없어 청소 요청을 보내지 않았어요\. 예약을 확인해 주세요\.'/);
  });
});
