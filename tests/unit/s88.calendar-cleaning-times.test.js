import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as calendarDomain from '../../src/domain/calendarAssignmentDomain.js';
import { toKstDateKey } from '../../server/cleaning/_dispatch.js';
import { postAssignmentSlack } from '../../server/cleaning/_reservationSync.js';
import { assignFromCalendarEvents } from '../../server/cleaning/_calendarAssign.js';
import { actualCleaningModule, installDeliveryIO } from '../helpers/cleaningDeliveryFixture.js';

const source = readFileSync(new URL('../../api/cleaning/[...slug].js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module' });
const checkout = '2026-10-30T02:00:00.000Z';
const bookedStart = '2026-10-30T03:00:00.000Z';
const bookedEnd = '2026-10-30T06:00:00.000Z';
const cleaner = { id: 'cleaner-1', email: 'cleaner@example.invalid' };

function booking(overrides = {}) {
  return {
    id: 'event-1', status: 'confirmed',
    start: { dateTime: '2026-10-30T12:00:00+09:00' },
    end: { dateTime: '2026-10-30T15:00:00+09:00' },
    organizer: { email: 'host@example.invalid' },
    attendees: [{ email: cleaner.email }], ...overrides,
  };
}

function job(overrides = {}) {
  return { id: 'job-1', property_id: 'property-1', checkout_at: checkout, status: 'ASSIGNED',
    assigned_cleaner_id: cleaner.id, google_event_id: 'event-1',
    cleaning_start_at: checkout, cleaning_end_at: '2026-10-30T05:00:00.000Z',
    ...overrides };
}

function load(name, dependencies) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node);
  return new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)});`)(...Object.values(dependencies));
}

// 기록 저장소(KV) 흉내 — nx(처음일 때만 저장)와 고장 난 상태
function fakeKv({ broken = false } = {}) {
  const store = new Map();
  let now = 0;
  const get = key => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now) { store.delete(key); return null; }
    return entry?.value ?? null;
  };
  return {
    store,
    advance(seconds) { now += seconds; },
    async get(key) {
      if (broken) throw new Error('kv down');
      return get(key);
    },
    async set(key, value, { nx, ex = Infinity } = {}) {
      if (broken) throw new Error('kv down');
      if (nx && get(key) !== null) return null;
      store.set(key, { value, expiresAt: now + ex });
      return 'OK';
    },
  };
}

async function execute(name, { row = job(), events = [booking()], pages, calendarOk = true, checkoutGone = false, scanDate,
  kv = fakeKv(), networkDown = false, body = {}, blockerRows = [] } = {}) {
  const updates = [], notices = [], reads = [];
  const postSlack = async value => { notices.push({ type: 'slack', value }); return true; };
  const deps = {
    db: { query: async (sql, params) => {
      if (sql.includes('UPDATE cleaning_jobs')) { updates.push({ sql, params }); return { rowCount: 1, rows: [{ id: row.id }] }; }
      // RF-16 배정 Slack 의 퇴실 확인 — 실제 postAssignmentSlack 이 묻는다(checkoutGone 이면 그날 퇴실이 없어진 작업)
      if (sql.includes('AS gone')) return { rows: [{ gone: checkoutGone }] };
      // 퇴실이 없어진 작업 목록 — 방금 배정된 뒤의 모양(담당자 붙음)
      if (sql.includes('LEFT JOIN cleaners c')) return { rows: checkoutGone ? [{ ...row, status: 'ASSIGNED', has_cleaner: true }] : [] };
      reads.push({ sql, params });
      if (sql.includes('FROM property_cleaning_config')) return { rows: [{ property_id: 'property-1', google_calendar_id: 'calendar-1' }] };
      if (sql.includes('FROM property_calendar_blockers')) return { rows: blockerRows };
      if (sql.includes('FROM cleaning_jobs')) return { rows: [row] };
      if (sql.includes('FROM cleaners')) return { rows: [cleaner] };
      throw new Error('Unexpected DB call');
    } },
    getGoogleToken: async () => 'fake-token', kv, CALENDAR_API: 'https://example.invalid',
    fetch: async () => {
      if (networkDown) throw new Error('fetch failed');
      return { ok: calendarOk, status: calendarOk ? 200 : 503, text: async () => 'backendError',
        json: async () => pages ? pages.shift() : { items: events } };
    },
    deleteBlockerEvent: async (_calendarId, eventId) => { notices.push({ type: 'delete-blocker', eventId }); },
    readBody: async () => ({ calendar_id: 'calendar-1', ...(scanDate ? { date: scanDate } : {}), ...body }),
    sendJson: (res, code, body) => res.status(code).json(body),
    toKstDateKey,
    resolveCalendarCleaner: async event => {
      const matched = calendarDomain.matchCleanerAttendee(event.attendees, [cleaner], event.organizer?.email);
      return { attendeeEmail: event.attendees?.[0]?.email, cleaner: matched?.cleaner ?? null };
    },
    ...calendarDomain,
    postSlack,
    postAssignmentSlack,
    goneAlertDeps: { store: { get: async () => [], set: async () => {} }, send: postSlack },
    sendCompletionSmsToRest: async () => { notices.push({ type: 'sms' }); },
    console: { error() {} },
  };
  // 캘린더 알림·수동 스캔 공용(RF-14): 실제 배정 함수 + 실제 "여러 쪽 읽기"(가짜 fetch 위에서)
  deps.calendarAssignDeps = {
    calendarCleaningTimes: deps.calendarCleaningTimes, resolveCalendarCleaner: deps.resolveCalendarCleaner,
    sendCompletionSmsToRest: deps.sendCompletionSmsToRest, postAssignmentSlack, goneAlertDeps: deps.goneAlertDeps,
    // 실제 "같은 예약은 하루 한 번" 경고(가짜 KV 위에서)
    alertUnregisteredCleaner: load('alertUnregisteredCleanerOnce', { kv, postSlack }),
  };
  deps.assignFromCalendarEvents = assignFromCalendarEvents;
  deps.listCalendarEvents = load('listCalendarEvents', { fetch: deps.fetch, CALENDAR_API: deps.CALENDAR_API, URLSearchParams, console: deps.console });
  const handler = load(name, deps);
  if (name === 'repairCalendarAssignments') return { result: await handler('property-1'), updates, notices, reads };
  const req = { method: 'POST', headers: { 'x-goog-resource-uri': 'https://example.invalid/calendars/calendar-1/events' } };
  const res = { status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; return this; } };
  await handler(req, res);
  return { result: res.body, status: res.code, updates, notices, reads };
}

function assertBookedTimes(update) {
  assert.ok(update, 'Actual UPDATE must be executed');
  for (const [column, expected] of [['cleaning_start_at', bookedStart], ['cleaning_end_at', bookedEnd]]) {
    const match = update.sql.match(new RegExp(`${column}\\s*=\\s*\\$(\\d+)`));
    assert.ok(match, `Actual UPDATE must persist ${column}`);
    assert.equal(new Date(update.params[Number(match[1]) - 1]).toISOString(), expected);
  }
  const setClause = update.sql.slice(update.sql.indexOf('SET'), update.sql.indexOf('WHERE'));
  assert.doesNotMatch(setClause, /checkout_at\s*=/, 'Checkout identity must remain 11:00 KST');
}

describe('Calendar booked times — source timestamps and checkout constraints', () => {
  test('12–15 KST booking stays 12–15; checkout stays 11', () => {
    assert.equal(typeof calendarDomain.calendarCleaningTimes, 'function');
    assert.deepEqual(calendarDomain.calendarCleaningTimes(booking(), checkout), {
      date: '2026-10-30', cleaning_start_at: bookedStart, cleaning_end_at: bookedEnd,
    });
  });

  test('UTC timestamps match the KST calendar date, including UTC previous day', () => {
    const event = booking({ start: { dateTime: '2026-10-29T16:00:00Z' }, end: { dateTime: '2026-10-29T17:00:00Z' } });
    assert.equal(calendarDomain.calendarCleaningTimes(event, '2026-10-29T15:00:00Z')?.date, '2026-10-30');
  });

  for (const [label, event, checkoutAt] of [
    ['all-day event', booking({ start: { date: '2026-10-30' } }), checkout],
    ['invalid timestamp', booking({ end: { dateTime: 'invalid' } }), checkout],
    ['missing timezone', booking({ start: { dateTime: '2026-10-30T12:00:00' } }), checkout],
    ['end before start', booking({ end: { dateTime: '2026-10-30T10:00:00+09:00' } }), checkout],
    ['starts before checkout', booking(), '2026-10-30T04:00:00Z'],
    ['different checkout date', booking(), '2026-10-29T02:00:00Z'],
    ['cancelled event', booking({ status: 'cancelled' }), checkout],
    ['blocker', booking({ extendedProperties: { private: { propos: 'blocker' } } }), checkout],
  ]) test(`rejects ${label}`, () => assert.equal(calendarDomain.calendarCleaningTimes(event, checkoutAt), null));
});

describe('Actual Calendar repair — source times for existing assignments', () => {
  test('restores missing cleaner and stores both booked timestamps', async () => {
    const state = await execute('repairCalendarAssignments', { row: job({ assigned_cleaner_id: null }) });
    assert.equal(state.result.repaired, 1);
    assertBookedTimes(state.updates[0]);
    assert.deepEqual(state.notices, []);
  });
  test('already linked assignment gets time correction without reassignment or notices', async () => {
    const state = await execute('repairCalendarAssignments');
    assert.equal(state.result.repaired, 1);
    assertBookedTimes(state.updates[0]);
    assert.deepEqual(state.notices, []);
  });
  test('already correct assignment is a no-op', async () => {
    const state = await execute('repairCalendarAssignments', { row: job({ cleaning_start_at: bookedStart, cleaning_end_at: bookedEnd }) });
    assert.equal(state.updates.length, 0);
    assert.equal(state.result.repaired, 0);
  });
  test('does not switch an existing linked cleaner or event', async () => {
    for (const row of [job({ assigned_cleaner_id: 'other-cleaner' }), job({ google_event_id: 'other-event' })]) {
      assert.equal((await execute('repairCalendarAssignments', { row })).updates.length, 0);
    }
  });
  test('multiple bookings on a date do not guess a missing assignment', async () => {
    const state = await execute('repairCalendarAssignments', { row: job({ assigned_cleaner_id: null }), events: [booking(), booking({ id: 'other-event' })] });
    assert.equal(state.updates.length, 0);
  });
  test('reads subsequent Calendar pages before repairing', async () => {
    const pages = [{ items: [], nextPageToken: 'page-2' }, { items: [booking()] }];
    const state = await execute('repairCalendarAssignments', { pages });
    assertBookedTimes(state.updates[0]);
    assert.equal(pages.length, 0);
  });
  test('Calendar failure writes nothing', async () => {
    await assert.rejects(execute('repairCalendarAssignments', { calendarOk: false }), /Calendar/);
  });
});

for (const handler of ['handleCalendarWebhook', 'handleCalendarScan']) describe(`${handler} — actual booking writes`, () => {
  test('new assignment persists Google start/end and preserves checkout', async () => {
    const state = await execute(handler, { row: job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null }) });
    assertBookedTimes(state.updates[0]);
    assert.equal(state.status, 200);
    assert.match(state.notices.find(n => n.type === 'slack')?.value ?? '', /✅/);
  });
  // RF-16 리뷰 3차(2026-11-11): 손님 취소 뒤 이미 나간 요청을 수락 → "배정 완료" 대신 퇴실 없음 경고(배정 자체는 그대로 저장)
  test('new assignment on a day whose checkout is gone warns instead of "배정 완료"', async () => {
    const state = await execute(handler, { checkoutGone: true, row: job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null }) });
    assertBookedTimes(state.updates[0]);
    const slack = state.notices.filter(n => n.type === 'slack').map(n => n.value);
    assert.equal(slack.length, 1);
    assert.doesNotMatch(slack[0], /✅/);
    assert.match(slack[0], /그날 퇴실이 없어요/);
  });
  // RF-14(2026-11-13): 시나리오 S20·S22 — 캘린더 알림이든 수동 스캔이든 새 배정이면 요청 받은 나머지 담당자에게 "배정 완료" 안내
  // (예전 수동 스캔은 Slack 만 보내고 이 안내를 빠뜨렸다)
  test('new assignment also tells the other requested cleaners it is taken', async () => {
    const state = await execute(handler, { row: job({ status: 'NOTIFYING_BULK', assigned_cleaner_id: null, google_event_id: null }) });
    assert.deepEqual(state.notices.map(n => n.type), ['sms', 'slack']);
  });
  test('time correction for same linked event sends no duplicate assignment notice', async () => {
    const state = await execute(handler);
    assertBookedTimes(state.updates[0]);
    assert.deepEqual(state.notices, []);
  });
  test('invalid/cancelled/early bookings and changed assignee are ignored', async () => {
    for (const options of [
      { events: [booking({ status: 'cancelled' })] },
      { events: [booking({ end: {} })] },
      { row: job({ checkout_at: '2026-10-30T04:00:00Z' }) },
      { row: job({ assigned_cleaner_id: 'other-cleaner' }) },
    ]) assert.equal((await execute(handler, options)).updates.length, 0);
  });
});

describe('RF-14 — 캘린더 알림·수동 스캔은 같은 배정 함수를 쓰고, 바뀐 일정을 끝까지 읽는다', () => {
  const blocker = i => booking({ id: `blocker-${i}`, attendees: [], extendedProperties: { private: { propos: 'blocker', property_id: 'property-1' } } });

  test('15일 작업이 블로커를 30개 만든 직후의 담당자 예약도 놓치지 않는다(여러 쪽 읽기)', async () => {
    const pages = [{ items: Array.from({ length: 30 }, (_, i) => blocker(i)), nextPageToken: 'page-2' }, { items: [booking()] }];
    const state = await execute('handleCalendarWebhook', { pages, row: job({ status: 'NOTIFYING_VIP_1', assigned_cleaner_id: null, google_event_id: null }) });
    assert.equal(pages.length, 0, '두 번째 쪽까지 읽음');
    assertBookedTimes(state.updates[0]);
  });

  test('수동 스캔에서 날짜를 지정하면 그날 예약만 배정한다', async () => {
    const pending = job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null });
    assert.equal((await execute('handleCalendarScan', { row: pending, scanDate: '2026-10-31' })).updates.length, 0, '다른 날 예약은 건너뜀');
    assertBookedTimes((await execute('handleCalendarScan', { row: pending, scanDate: '2026-10-30' })).updates[0]);
  });

  test('캘린더 조회가 실패하면 아무것도 바꾸지 않는다', async () => {
    const state = await execute('handleCalendarWebhook', { calendarOk: false, row: job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null }) });
    assert.equal(state.updates.length, 0);
    assert.equal(state.status, 200);
  });

  test('구글 연결이 끊겨도(네트워크 오류) 아무것도 바꾸지 않고, 수동 스캔은 실패라고 알린다', async () => {
    const pending = job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null });
    const webhook = await execute('handleCalendarWebhook', { networkDown: true, row: pending });
    assert.equal(webhook.updates.length, 0);
    assert.equal(webhook.status, 200, '구글이 알림을 계속 다시 보내지 않게 200');
    const scan = await execute('handleCalendarScan', { networkDown: true, row: pending });
    assert.equal(scan.updates.length, 0);
    assert.equal(scan.status, 502);
  });

  describe('등록 안 된 사람이 청소 칸을 예약하면', () => {
    const pending = job({ status: 'NOTIFYING_VIP_1', assigned_cleaner_id: null, google_event_id: null });
    const stranger = (id = 'event-1') => booking({ id, attendees: [{ email: 'stranger@example.invalid' }] });
    const warned = state => state.notices.filter(n => n.type === 'slack' && n.value.includes('미등록 청소 담당자')).length;

    test('배정하지 않고 운영자에게 알리되, 같은 예약은 캘린더 알림이 여러 번 와도 한 번만', async () => {
      const kv = fakeKv();
      const first = await execute('handleCalendarWebhook', { row: pending, events: [stranger()], kv });
      const again = await execute('handleCalendarWebhook', { row: pending, events: [stranger()], kv });
      const another = await execute('handleCalendarWebhook', { row: pending, events: [stranger('event-2')], kv });
      assert.equal(first.updates.length + again.updates.length, 0, '배정하지 않음');
      assert.equal(warned(first), 1);
      assert.equal(warned(again), 0, '15일 블로커 30개로 알림이 연달아 와도 같은 경고를 반복하지 않음');
      assert.equal(warned(another), 1, '다른 예약은 따로 알림');
    });

    test('기록 저장소가 고장 나도 경고는 보낸다(놓치는 것보다 낫다)', async () => {
      assert.equal(warned(await execute('handleCalendarWebhook', { row: pending, events: [stranger()], kv: fakeKv({ broken: true }) })), 1);
    });
  });

  test('블로커 정리도 250개 넘는 블로커를 끝까지 읽어 고아 블로커를 지운다', async () => {
    const pages = [
      { items: Array.from({ length: 250 }, (_, i) => blocker(i)), nextPageToken: 'page-2' },
      { items: [blocker('orphan')] },
    ];
    const blockerRows = Array.from({ length: 250 }, (_, i) => ({ event_id: `blocker-${i}` }));
    const state = await execute('handleBlockerCleanup', { pages, blockerRows });
    assert.equal(state.status, 200);
    assert.deepEqual(state.result, { ok: true, scanned: 251, deleted: 1, dbTracked: 250 });
    assert.deepEqual(state.notices.filter(n => n.type === 'delete-blocker'), [{ type: 'delete-blocker', eventId: 'blocker-orphan' }]);
  });

  test('배정 판단·저장은 공용 함수 한 곳에만 있다(복사본 없음)', () => {
    const shared = readFileSync(new URL('../../server/cleaning/_calendarAssign.js', import.meta.url), 'utf8');
    const assignSql = "SET status='ASSIGNED',assigned_cleaner_id=$1,google_event_id=$2";
    assert.ok(shared.includes(assignSql));
    assert.ok(!source.includes(assignSql), '화면 API 에 배정 저장 복사본이 남아 있으면 안 된다');
    for (const name of ['handleCalendarWebhook', 'handleCalendarScan']) {
      const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
      assert.match(source.slice(node.start, node.end), /await assignFromCalendarEvents\(db, \{ property: propCfg, events/, name);
    }
    assert.ok(!/maxResults=10/.test(source), '10개만 읽는 조회가 남아 있으면 안 된다');
  });
});

describe('RF-14 — 조회가 완전하지 않으면 일부 일정으로 배정하거나 삭제하지 않는다', () => {
  function reader(responses) {
    return load('listCalendarEvents', {
      URLSearchParams, CALENDAR_API: 'https://example.invalid', console: { error() {} },
      fetch: async () => {
        const page = responses.shift();
        assert.ok(page, '예상한 페이지 수를 넘겨 조회함');
        return { ok: !page.failed, status: page.failed ? 503 : 200,
          text: async () => 'fixture error', json: async () => page };
      },
    });
  }

  test('페이지 한도에 닿았는데 다음 쪽이 남으면 성공 배열 대신 실패를 반환한다', async () => {
    const list = reader([{ items: [booking()], nextPageToken: 'more' }]);
    assert.equal(await list('fixture-calendar', 'fixture-token', {}, { maxPages: 1 }), null);
  });

  test('마지막 허용 페이지에서 끝나면 정상이며 빈 달력도 조회 성공이다', async () => {
    const list = reader([{ items: [booking()], nextPageToken: 'page-2' }, { items: [booking({ id: 'event-2' })] }]);
    assert.deepEqual((await list('fixture-calendar', 'fixture-token', {}, { maxPages: 2 })).map(e => e.id), ['event-1', 'event-2']);
    assert.deepEqual(await reader([{ items: [] }])('fixture-calendar', 'fixture-token', {}), []);
  });

  test('앞쪽 페이지가 정상이었어도 뒤쪽 조회 실패는 전체 조회 실패다', async () => {
    const list = reader([{ items: [booking()], nextPageToken: 'page-2' }, { failed: true }]);
    assert.equal(await list('fixture-calendar', 'fixture-token', {}), null);
  });

  for (const name of ['handleCalendarWebhook', 'handleCalendarScan', 'handleBlockerCleanup']) {
    test(`${name}: 한도 이후 쪽이 남으면 배정·블로커 삭제를 실행하지 않는다`, async () => {
      const maxPages = name === 'handleBlockerCleanup' ? 40 : 10;
      const pages = Array.from({ length: maxPages }, (_, i) => ({ items: [booking()], nextPageToken: `more-${i}` }));
      const state = await execute(name, { pages, row: job({ status: 'PENDING', assigned_cleaner_id: null, google_event_id: null }) });
      assert.equal(state.updates.length, 0, '불완전한 조회 결과로 배정하면 안 됨');
      assert.equal(state.notices.length, 0, '완료 안내나 실제 블로커 삭제를 하면 안 됨');
      assert.equal(state.status, name === 'handleCalendarWebhook' ? 200 : 502);
      if (name !== 'handleCalendarWebhook') {
        assert.equal(state.result.error, name === 'handleCalendarScan' ? '캘린더 조회 실패' : '이벤트 목록 조회 실패', '기존 API 오류 문구 유지');
      }
    });
  }
});

describe('RF-14 — 미등록 담당자 경고는 전송 성공 후에만 하루 동안 억제한다', () => {
  function warning(kv, postSlack) {
    return load('alertUnregisteredCleanerOnce', { kv, postSlack });
  }

  test('첫 전송이 실패하면 짧은 전송 중 보호가 지난 뒤 재시도하고, 성공 후에는 억제한다', async () => {
    const kv = fakeKv();
    let calls = 0;
    const alert = warning(kv, async () => ++calls > 1);
    await alert('fixture-event', 'fixture warning');
    kv.advance(61);
    await alert('fixture-event', 'fixture warning');
    assert.equal(calls, 2, '실패를 하루짜리 성공으로 기록하면 안 됨');
    kv.advance(61);
    await alert('fixture-event', 'fixture warning');
    assert.equal(calls, 2, '성공한 경고는 반복하지 않음');
  });

  test('같은 이벤트를 동시에 확인해도 전송 중에는 한 번만 보내고 성공 기록은 하루 유지한다', async () => {
    const kv = fakeKv();
    let calls = 0;
    const alert = warning(kv, async () => { calls++; return true; });
    await Promise.all(Array.from({ length: 5 }, () => alert('fixture-event', 'fixture warning')));
    assert.equal(calls, 1);
    kv.advance(86_399);
    await alert('fixture-event', 'fixture warning');
    assert.equal(calls, 1);
    kv.advance(2);
    await alert('fixture-event', 'fixture warning');
    assert.equal(calls, 2);
  });

  test('KV 장애 때도 배정 처리를 멈추지 않고 경고 전송은 시도한다', async () => {
    let calls = 0;
    await warning(fakeKv({ broken: true }), async () => { calls++; return false; })('fixture-event', 'fixture warning');
    assert.equal(calls, 1);
  });
});

describe('RF-14 — 실제 배정 완료 알림의 날짜는 한국 날짜다', () => {
  for (const [label, raw, expected] of [
    ['UTC 전날', '2026-10-29T16:00:00Z', '2026-10-30'],
    ['월 경계', '2026-10-31T16:00:00Z', '2026-11-01'],
    ['연도 경계·DB Date 타입', new Date('2026-12-31T16:00:00Z'), '2027-01-01'],
  ]) test(label, async () => {
    const io = installDeliveryIO();
    try {
      const dispatch = await actualCleaningModule('server/cleaning/_dispatch.js');
      const db = { query: async (sql, params) => {
        if (sql.includes('SELECT j.*')) return { rows: [{ id: 'fixture-job', data_origin: 'REAL', prop_name: '검증숙소', cleaning_start_at: raw }] };
        assert.ok(sql.includes('FROM cleaning_notifs'));
        assert.deepEqual(params, ['fixture-job', 'selected-cleaner']);
        return { rows: [{ cleaner_id: 'other-cleaner', fcm_status: 'active', fcm_token: 'fixture-token', phone: null }] };
      } };
      await dispatch.sendCompletionSmsToRest(db, 'fixture-job', 'selected-cleaner');
      assert.equal(io.calls.push.length, 1);
      assert.equal(io.calls.push[0].notification.body, `검증숙소 ${expected} 건이 배정됐습니다. 감사합니다.`);
      assert.equal(io.calls.sms.length, 0, '앱 경로의 시험이며 실제 문자 전송 없음');
    } finally { io.restore(); }
  });
});
