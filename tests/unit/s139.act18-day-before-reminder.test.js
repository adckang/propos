/**
 * ACT-18 (DEC-13) — 담당자 청소 "하루 전" 알림.
 * 밤 정기 작업(KST 22:00)이 내일(한국 날짜) 배정된 실제 청소를 담당자에게 알린다. 시작 시각과 무관하게 같은 규칙, 한 번만.
 * 보내지 못하거나 담당자가 활동 중지면 운영자에게 직접 연락하라고 알린다(DEC-11).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { dayBeforeMessage, remindTomorrowCleanings, tomorrowKstRange } from '../../server/cleaning/_dayBeforeReminder.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';

const EVENING = new Date('2026-11-23T13:00:00.000Z'); // 11-23 22:00 KST
const job = (id, startAt, extra = {}) => ({
  id, property_id: '파주201', cleaning_start_at: startAt, checkout_at: startAt, reservation_uid: `uid-${id}`,
  cleaner_id: `cleaner-${id}`, cleaner_name: '담당자', phone: '010-0000-0000', fcm_token: 'token', fcm_status: 'active',
  cleaner_active: true, property_name: '파주 201호', ...extra,
});

function harness({ rows = [], cancelled = new Set(), claimed = new Set(), kvFails = false, notifyResult = { ok: true, channel: 'FCM' } } = {}) {
  const queries = [], sends = [], slack = [], keys = [];
  const deps = {
    now: EVENING,
    kv: {
      async get(key) { if (kvFails) throw new Error('fixture KV down'); return claimed.has(key) ? '1' : null; },
      async set(key, value, options) {
        keys.push([key, value, options]);
        if (kvFails) throw new Error('fixture KV down');
        claimed.add(key); return 'OK';
      },
    },
    notify: async (_db, cleaner, message) => {
      sends.push({ cleaner, message });
      if (notifyResult instanceof Error) throw notifyResult;
      return notifyResult;
    },
    postSlack: async text => { slack.push(text); return true; },
    isCheckoutCancelled: async (_db, j) => cancelled.has(j.id),
  };
  const db = { async query(sql, params) { queries.push({ sql, params }); return { rows }; } };
  return { db, deps, queries, sends, slack, keys, claimed };
}

async function quietly(fn) {
  const previous = console.error; const errors = [];
  console.error = (...args) => errors.push(args);
  try { return { value: await fn(), errors }; } finally { console.error = previous; }
}

describe('ACT-18 내일의 범위 — 한국 날짜', () => {
  test('밤 10시(KST)에 "내일"은 다음 날 0시부터 하루', () => {
    const range = tomorrowKstRange(EVENING);
    assert.equal(range.date, '2026-11-24');
    assert.equal(range.from.toISOString(), '2026-11-23T15:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-11-24T15:00:00.000Z');
  });

  test('찾는 조건: 배정 완료된 실제 청소, 시작 시각이 내일 안', async () => {
    const h = harness();
    await remindTomorrowCleanings(h.db, h.deps);
    const [{ sql, params }] = h.queries;
    assert.match(sql, /JOIN cleaners c ON c\.id = j\.assigned_cleaner_id/);
    assert.match(sql, /c\.active AS cleaner_active/);
    assert.match(sql, /LEFT JOIN property_cleaning_config p ON p\.property_id = j\.property_id/);
    assert.match(sql, /j\.status = 'ASSIGNED' AND j\.data_origin = 'REAL'/);
    assert.match(sql, /j\.cleaning_start_at >= \$1::timestamptz AND j\.cleaning_start_at < \$2::timestamptz/);
    assert.deepEqual(params, ['2026-11-23T15:00:00.000Z', '2026-11-24T15:00:00.000Z']);
  });
});

describe('ACT-18 알림 내용 — 시작 시각과 무관하게 같은 규칙', () => {
  for (const [startAt, time] of [['2026-11-24T00:00:00.000Z', '09:00'], ['2026-11-24T02:00:00.000Z', '11:00'], ['2026-11-23T23:30:00.000Z', '08:30']]) {
    test(`${time} 청소`, () => {
      assert.deepEqual(dayBeforeMessage('파주 201호', startAt), {
        title: '[PROPOS] 내일 청소 안내',
        body: `파주 201호 내일 ${time} 청소가 있습니다`,
        data: {},
        smsText: `[PROPOS] 내일(2026-11-24) ${time} 파주 201호 청소가 있습니다.`,
      });
    });
  }
});

describe('ACT-18 보내기', () => {
  test('배정된 담당자에게 숙소 이름·내일 시각으로 보낸다', async () => {
    const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')] });
    assert.equal(await remindTomorrowCleanings(h.db, h.deps), 1);
    assert.deepEqual(h.sends, [{
      cleaner: { id: 'cleaner-j1', name: '담당자', phone: '010-0000-0000', fcm_token: 'token', fcm_status: 'active' },
      message: dayBeforeMessage('파주 201호', '2026-11-24T02:00:00.000Z'),
    }]);
    assert.deepEqual(h.slack, []);
  });

  test('한 번만 — 같은 청소·같은 담당자는 다시 보내지 않고, 담당자가 바뀌면 새 담당자에게 보낸다', async () => {
    const claimed = new Set();
    const first = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')], claimed });
    await remindTomorrowCleanings(first.db, first.deps);
    assert.deepEqual(first.keys, [['cleaning_day_before:j1:cleaner-j1', '1', { ex: 3 * 24 * 3600 }]], '보낸 뒤에 표시');
    const again = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')], claimed });
    assert.equal(await remindTomorrowCleanings(again.db, again.deps), 0);
    assert.deepEqual(again.sends, []);
    const reassigned = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z', { cleaner_id: 'cleaner-new' })], claimed });
    assert.equal(await remindTomorrowCleanings(reassigned.db, reassigned.deps), 1);
  });

  test('"한 번만" 표시를 읽거나 쓰지 못해도(KV 장애) 빠뜨리지 않고 보낸다', async () => {
    const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')], kvFails: true });
    const { value, errors } = await quietly(() => remindTomorrowCleanings(h.db, h.deps));
    assert.equal(value, 1);
    assert.equal(h.sends.length, 1);
    assert.match(errors[0][0], /보냄 표시 읽기 실패/);
    assert.match(errors[1][0], /보냄 표시 실패/);
    assert.deepEqual(h.slack, [], '보냈으니 운영자에게 넘기지 않는다');
  });

  test('보내지 못한 청소는 "보냄" 표시를 남기지 않는다 — 다시 돌리면 다시 시도한다', async () => {
    const claimed = new Set();
    const failed = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')], claimed, notifyResult: { ok: false, channel: 'NONE' } });
    await quietly(() => remindTomorrowCleanings(failed.db, failed.deps));
    assert.deepEqual(failed.keys, []);
    const retry = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z')], claimed });
    assert.equal(await remindTomorrowCleanings(retry.db, retry.deps), 1);
  });

  test('손님 예약이 없어진 청소는 보내지 않는다', async () => {
    const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z'), job('j2', '2026-11-24T03:00:00.000Z')], cancelled: new Set(['j1']) });
    assert.equal(await remindTomorrowCleanings(h.db, h.deps), 1);
    assert.deepEqual(h.sends.map(s => s.cleaner.id), ['cleaner-j2']);
    assert.deepEqual(h.keys.map(k => k[0]), ['cleaning_day_before:j2:cleaner-j2'], '보내지 않을 청소는 "보냄" 표시도 하지 않는다');
  });
});

describe('ACT-18 보내지 못하면 운영자에게', () => {
  for (const [label, notifyResult] of [['받을 곳이 없음', { ok: false, channel: 'NONE' }], ['발송 중 오류', new Error('fixture send failed')]]) {
    test(label, async () => {
      const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z'), job('j2', '2026-11-24T05:00:00.000Z')], notifyResult });
      const { value } = await quietly(() => remindTomorrowCleanings(h.db, h.deps));
      assert.equal(value, 0);
      assert.equal(h.sends.length, 2, '하나가 실패해도 다음 청소를 계속 본다');
      assert.deepEqual(h.slack, [
        '[PROPOS] ⚠️ 파주 201호 2026-11-24 11:00 청소 — 담당자에게 하루 전 알림을 보내지 못했어요. 직접 연락해 주세요.',
        '[PROPOS] ⚠️ 파주 201호 2026-11-24 14:00 청소 — 담당자에게 하루 전 알림을 보내지 못했어요. 직접 연락해 주세요.',
      ]);
    });
  }

  test('담당자가 활동 중지면 그 사람에게 보내지 않고 운영자에게 넘긴다', async () => {
    const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z', { cleaner_active: false })] });
    const { value } = await quietly(() => remindTomorrowCleanings(h.db, h.deps));
    assert.equal(value, 0);
    assert.deepEqual(h.sends, []);
    assert.deepEqual(h.keys, []);
    assert.deepEqual(h.slack, ['[PROPOS] ⚠️ 파주 201호 2026-11-24 11:00 청소 — 담당자에게 하루 전 알림을 보내지 못했어요. 직접 연락해 주세요.']);
  });

  test('예약 확인이 실패해도 운영자에게 알린다(숙소 이름을 모르면 숙소 번호로)', async () => {
    const h = harness({ rows: [job('j1', '2026-11-24T02:00:00.000Z', { property_name: null })] });
    h.deps.isCheckoutCancelled = async () => { throw new Error('fixture db down'); };
    const { value } = await quietly(() => remindTomorrowCleanings(h.db, h.deps));
    assert.equal(value, 0);
    assert.deepEqual(h.sends, []);
    assert.deepEqual(h.slack, ['[PROPOS] ⚠️ 파주201 2026-11-24 11:00 청소 — 담당자에게 하루 전 알림을 보내지 못했어요. 직접 연락해 주세요.']);
  });
});

describe('ACT-18 밤 정기 작업', () => {
  async function evening(behavior = {}) {
    const { default: handler } = await actualCronModule();
    const io = installCronIO({ behavior });
    try {
      const res = cronResponse();
      await handler({ method: 'GET', url: '/api/cron/evening', query: {}, headers: { authorization: 'Bearer fixture-cron-secret' } }, res);
      return { res, io };
    } finally { io.restore(); }
  }

  test('후속 처리 뒤, 결산 전에 하루 전 알림을 보낸다', async () => {
    const { res, io } = await evening({ remindTomorrowCleanings: async () => 1 });
    assert.equal(res.code, 200);
    const names = io.names();
    assert.ok(names.includes('remindTomorrowCleanings'));
    assert.ok(names.indexOf('recordUnassignedAtStart') < names.indexOf('remindTomorrowCleanings'), '후속 처리 뒤');
    assert.ok(names.indexOf('remindTomorrowCleanings') < names.indexOf('getStatsForPeriod'), '결산 전');
  });

  test('알림 단계가 실패해도 결산은 그대로이고, 운영자에게 직접 연락하라고 알린다', async () => {
    const errors = []; const previous = console.error; console.error = (...a) => errors.push(a);
    try {
      const { res, io } = await evening({ remindTomorrowCleanings: async () => { throw new Error('fixture query failed'); } });
      assert.equal(res.code, 200);
      assert.ok(io.names().includes('getStatsForPeriod'));
      assert.ok(io.calls.some(c => c.name === 'postSlack' && c.args[0] === '[PROPOS] ⚠️ 내일 청소 담당자 알림을 확인하지 못했어요. 내일 청소 담당자에게 직접 연락해 주세요.'));
    } finally { console.error = previous; }
  });
});
