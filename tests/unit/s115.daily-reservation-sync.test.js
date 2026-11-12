/**
 * s115 — 매일 Airbnb 예약 가져오기(RF-20) + 칸은 요청 보내는 날 연다(DEC-07) 연결 계약
 *
 * 사용자 상황: 예약 가져오기가 정해진 시간 없이(대시보드가 열려 있을 때·"예약 확정" 메일·수동) 돌아, 화면을 안 열면 취소·날짜 변경이
 * 반영되지 않았다. 이제 아침 8시·밤 10시 정기 작업이 요청 작업보다 먼저 예약을 가져온다. 추가·변경·취소가 청소 일정·칸·요청까지
 * 이어지는지는 tests/integration/s115.reservation-changes-sql.test.js 가 실제 코드로 돌려 확인한다.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as calendar from '../../server/cleaning/_calendar.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const cron = read('api/cron/[...slug].js');
const api = read('api/cleaning/[...slug].js');

const block = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} 없음`);
  return text.slice(start, text.indexOf(endMarker, start));
};

describe('정기 작업이 예약을 먼저 가져온다', () => {
  test('아침 8시: 브리핑·요청 작업·15일 월간 작업보다 먼저, 실패해도 나머지는 돈다', () => {
    const morning = block(cron, 'if (action === "morning")', 'if (action === "evening")');
    const at = name => morning.indexOf(name);
    const sync = morning.indexOf('await syncAllPropertiesIcal(db, { kv })');
    assert.ok(sync > 0, '아침 작업에 예약 가져오기');
    for (const later of ['handleDailyPlan(db', 'handleCleaningFollowup(db', 'handleMonthlyClean(db']) {
      assert.ok(at(later) > sync, `${later} 보다 먼저`);
    }
    assert.match(morning, /try \{ await syncAllPropertiesIcal\(db, \{ kv \}\); ran\.push\("ical-sync"\); \}\s*catch \(e\) \{ console\.error\("\[morning\] ical-sync 실패:"/);
    assert.ok(at('handleMonthlyClean(db') < at('handleCleaningFollowup(db'), '15일엔 칸을 막은 뒤 요청 작업이 칸을 열며 보낸다');
  });

  test('밤 10시: 요청 작업보다 먼저, 실패해도 요청 작업·결산은 돈다', () => {
    const evening = block(cron, 'if (action === "evening")', 'return res.status(404)');
    const sync = evening.indexOf('await syncAllPropertiesIcal(db, { kv })');
    assert.ok(sync > 0 && evening.indexOf('handleCleaningFollowup(db') > sync);
    assert.match(evening, /try \{ await syncAllPropertiesIcal\(db, \{ kv \}\); \}\s*catch \(e\) \{ console\.error\("\[evening\] ical-sync 실패:"/);
  });

  test('예약 가져오기는 한 곳(공용 모듈)에만 있고 화면 API·메일 알림·정기 작업이 같이 쓴다', () => {
    assert.ok(!/async function syncAllPropertiesIcal/.test(api), '화면 API 에 사본이 남아 있으면 안 된다');
    assert.match(api, /import \{ syncAllPropertiesIcal \} from "\.\.\/\.\.\/server\/cleaning\/_icalSync\.js";/);
    assert.match(cron, /import \{ syncAllPropertiesIcal \} from "\.\.\/\.\.\/server\/cleaning\/_icalSync\.js";/);
    assert.match(api, /await syncAllPropertiesIcal\(db, \{ kv \}\)\.catch\(/, '예약 확정 메일');
    assert.match(api, /await syncAllPropertiesIcal\(countingDb, \{ kv, filterPropertyId: property_id \?\? null \}\);/, '수동·화면 15분');
  });
});

describe('칸은 요청 보내는 날 연다 (DEC-07)', () => {
  test('15일 월간 작업은 칸을 지우지 않는다 — 청소 일정만 만든다', () => {
    const monthly = block(cron, 'async function handleMonthlyClean', '\n}\n');
    const step3 = monthly.slice(monthly.indexOf('// [3]'), monthly.indexOf('// [4]'));
    assert.ok(!/DELETE FROM property_calendar_blockers/.test(step3), '[3]에서 칸을 열면 요청 전 몇 주 동안 열려 있다');
    assert.ok(!/deleteBlockerEvent\(/.test(monthly), '월간 작업은 구글 캘린더의 칸을 지우지 않는다');
  });

  test('첫 요청을 보내는 곳(매일 요청 작업·수동 발송)은 그날 칸을 연다 — 날짜는 한국 날짜', () => {
    assert.match(cron, /advanceJob\(db, job, \{ deleteBlocker: makeCronBlockerDeleter\(db\) \}\)/);
    assert.match(api, /advanceJob\(db, job, \{ deleteBlocker: makeBlockerDeleter\(\) \}\)/);
    for (const [name, text] of [['매일 요청 작업', cron], ['수동 발송', api]]) {
      const deleter = block(text, name === '매일 요청 작업' ? 'function makeCronBlockerDeleter' : 'function makeBlockerDeleter', '\n}\n');
      assert.match(deleter, /await openCleaningSlot\(db, \{ propertyId: job\.property_id, date: toKstDateKey\(job\.checkout_at\), kv \}\);/, `${name}: 공용 칸 열기 + 한국 날짜`);
    }
  });

  test('요청은 나갔는데 칸이 아직 막힌 날은 매일 요청 작업이 실제로 다시 연다 — 실행해서 확인', async () => {
    const { parse } = await import('@babel/parser');
    const ast = parse(cron, { sourceType: 'module' });
    const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'handleCleaningFollowup');
    const opened = [];
    const db = { query: async sql => (sql.includes('JOIN property_calendar_blockers b')
      ? { rows: [{ property_id: '파주201', day: '2026-11-29' }, { property_id: '파주201', day: '2026-12-06' }] }
      : { rows: [] }) };
    const deps = {
      recoverInitialDeliveries: async () => 0, advanceJob: async () => ({ ok: true }), makeCronBlockerDeleter: () => async () => {},
      getVipFollowupJobs: async () => ({ rows: [] }), isCheckoutCancelled: async () => false, notify: async () => ({}),
      buildSmsRemind: () => '', postSlack: async () => true, getPropertyConfig: async () => null, kv: {},
      openCleaningSlot: async (_db, { propertyId, date }) => { opened.push(`${propertyId}/${date}`); return true; },
      console: { error() {} },
    };
    const handler = new Function(...Object.keys(deps), `return (${cron.slice(node.start, node.end)});`)(...Object.values(deps));
    const res = { status() { return this; }, json(body) { this.body = body; return this; } };
    await handler(db, res);
    assert.deepEqual(opened, ['파주201/2026-11-29', '파주201/2026-12-06']);
  });

  test('다시 열기 대상은 요청이 나갔거나 배정된 앞으로의 날만 — 요청 전·취소는 제외(칸을 막는 쪽과 같은 기준)', () => {
    const followup = block(cron, 'async function handleCleaningFollowup', '\n}\n');
    const retry = followup.slice(followup.indexOf('const { rows: stillBlocked }'));
    assert.match(retry, /JOIN property_calendar_blockers b\s+ON b\.property_id = j\.property_id AND b\.block_date = \(j\.checkout_at AT TIME ZONE 'Asia\/Seoul'\)::date/);
    assert.match(retry, /j\.status IN \('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED','ASSIGNED'\)/);
    assert.match(retry, /await openCleaningSlot\(db, \{ propertyId: property_id, date: day, kv \}\)/);
    assert.ok(followup.indexOf('const { rows: stillBlocked }') > followup.indexOf('const { rows: readyJobs }'), '첫 요청을 보낸 뒤');
  });
});

describe('칸을 일괄로 막는 곳은 요청이 나갔거나 배정된 날을 막지 않는다', () => {
  test('15일 월간 작업과 수동 일괄 생성이 같은 판단 함수를 쓰고, 막기 전에 건너뛴다', () => {
    const monthly = block(cron, 'async function handleMonthlyClean', '\n}\n');
    const bootstrap = block(api, 'async function bootstrapBlockers', '\n}\n');
    for (const [name, text, dates] of [['15일 월간 작업', monthly, 'nextMonthDates'], ['수동 일괄 생성', bootstrap, 'targetDates']]) {
      const decide = text.indexOf(`const keepOpen = await requestedCleaningDays(db, prop.property_id, ${dates});`);
      const skip = text.indexOf('if (keepOpen.has(date)) { blockersSkipped++; continue; }') >= 0
        ? text.indexOf('if (keepOpen.has(date)) { blockersSkipped++; continue; }') : text.indexOf('if (keepOpen.has(date)) { skipped++; continue; }');
      assert.ok(decide > 0 && skip > decide, `${name}: 판단 후 건너뛰기`);
      assert.ok(skip < text.indexOf('createBlockerEvent('), `${name}: 막기 전에`);
    }
  });

  test('판단 기준: 요청 전·취소가 아닌 일정이 있는 날(한국 날짜)', async () => {
    const calendarModule = await import('../../server/cleaning/_calendar.js');
    let captured;
    const days = await calendarModule.requestedCleaningDays({ query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ day: '2026-12-13' }] };
    } }, '파주201', ['2026-12-13', '2026-12-14']);
    assert.deepEqual([...days], ['2026-12-13']);
    assert.match(captured.sql, /status NOT IN \('PENDING','CANCELLED'\)/);
    assert.match(captured.sql, /AT TIME ZONE 'Asia\/Seoul'/);
    assert.deepEqual(captured.params, ['파주201', ['2026-12-13', '2026-12-14']]);
  });
});

describe('칸 열기 — 구글에서 지워졌을 때만 기록을 지운다(실패하면 다시 열 수 있게)', () => {
  function fakeDb({ blocker = { event_id: 'evt-1' }, calendarId = 'calendar-1' } = {}) {
    const deleted = [];
    return { deleted, query: async (sql, params) => {
      if (sql.includes('SELECT event_id FROM property_calendar_blockers')) return { rows: blocker ? [blocker] : [] };
      if (sql.includes('SELECT google_calendar_id')) return { rows: [{ google_calendar_id: calendarId }] };
      if (sql.includes('DELETE FROM property_calendar_blockers')) { deleted.push(params); return { rowCount: 1, rows: [] }; }
      throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 50)}`);
    } };
  }
  const kv = { get: async () => null, set: async () => {} };
  /** 가짜 구글: 토큰 발급 성공 여부와 칸(이벤트) 삭제 응답 코드를 정한다. 다른 주소는 막는다 */
  async function withGoogle({ tokenOk, eventStatus = 204 }, run) {
    const previous = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const target = String(url);
      calls.push({ target, method: options?.method });
      if (target.includes('oauth2')) return { ok: tokenOk, json: async () => (tokenOk ? { access_token: 'fake-token', expires_in: 3600 } : { error: 'invalid_grant' }) };
      if (target.includes('/events/')) return { ok: eventStatus < 300, status: eventStatus };
      throw new Error(`막힌 외부 요청: ${target}`);
    };
    try { return await run(calls); } finally { globalThis.fetch = previous; }
  }

  // 토큰은 모듈 안에 잠시 보관되므로 "토큰 실패"를 먼저 본다
  test('구글 연결(토큰)이 실패하면 칸 기록을 남긴다 — 다음 요청 작업이 다시 연다', async () => {
    const db = fakeDb();
    await withGoogle({ tokenOk: false }, async () => {
      await assert.rejects(calendar.openCleaningSlot(db, { propertyId: '파주201', date: '2026-11-29', kv }));
    });
    assert.deepEqual(db.deleted, [], '기록을 지우지 않는다');
  });

  test('구글이 칸 삭제를 거절하면(500) 칸 기록을 남긴다', async () => {
    const db = fakeDb();
    await withGoogle({ tokenOk: true, eventStatus: 500 }, async calls => {
      await assert.rejects(calendar.openCleaningSlot(db, { propertyId: '파주201', date: '2026-11-29', kv }));
      assert.ok(calls.some(c => c.target.includes('/events/evt-1') && c.method === 'DELETE'));
    });
    assert.deepEqual(db.deleted, []);
  });

  test('구글에서 지워지면(또는 이미 없으면) 그때 기록도 지운다', async () => {
    for (const status of [204, 404]) {
      const db = fakeDb();
      await withGoogle({ tokenOk: true, eventStatus: status }, async () => {
        assert.equal(await calendar.openCleaningSlot(db, { propertyId: '파주201', date: '2026-11-29', kv }), true);
      });
      assert.deepEqual(db.deleted, [['파주201', '2026-11-29', 'evt-1']], `구글 응답 ${status}`);
    }
  });

  test('구글 캘린더가 없는 숙소는 열 칸이 없으므로 기록만 지우고, 막힌 기록이 없으면 아무것도 안 한다', async () => {
    const noCalendar = fakeDb({ calendarId: null });
    assert.equal(await calendar.openCleaningSlot(noCalendar, { propertyId: 'p', date: '2026-11-29', kv }), true);
    assert.deepEqual(noCalendar.deleted, [['p', '2026-11-29', 'evt-1']]);
    const nothing = fakeDb({ blocker: null });
    assert.equal(await calendar.openCleaningSlot(nothing, { propertyId: 'p', date: '2026-11-29', kv }), false);
    assert.deepEqual(nothing.deleted, []);
  });
});
