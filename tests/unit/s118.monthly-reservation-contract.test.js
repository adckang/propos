import { after, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as calendar from '../../server/cleaning/_calendar.js';
import { calcCleaningTimes, planJobDispatch, toKstDateKey } from '../../server/cleaning/_dispatch.js';
import { parseVEvents, airbnbEventsToReservations } from '../../src/domain/room-state/icalParser.js';
import { reservationUidOf } from '../../server/cleaning/_reservationSync.js';

mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T00:00:00Z') });
after(() => mock.timers.reset());

const source = readFileSync(new URL('../../api/cron/[...slug].js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module' });
const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'handleMonthlyClean');

function feed({ uid = 'booking-1', blocked = false, start = '20261211', end = '20261213', extra = [] } = {}) {
  return ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...(start ? [`DTSTART;VALUE=DATE:${start}`] : []),
    `DTEND;VALUE=DATE:${end}`, ...(uid ? [`UID:${uid}`] : []),
    `SUMMARY:${blocked ? 'Airbnb (Not available)' : 'Reserved'}`, ...extra,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

async function run(text, overrides = {}) {
  const inserts = [], notices = [], blockers = [];
  const property = { property_id: 'fixture-property', name: '검증숙소', ical_url: 'https://example.invalid/feed.ics',
    data_origin: 'REAL', checkin_hour: 15, checkout_hour: 11, cleaning_duration_hours: 3, ...overrides };
  const db = { query: async (sql, params) => {
    if (sql.includes('FROM property_cleaning_config')) return { rows: [property] };
    if (sql.includes('INSERT INTO cleaning_jobs')) { inserts.push({ sql, params }); return { rows: [], rowCount: 1 }; }
    if (sql.includes('SELECT * FROM cleaning_jobs')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql.slice(0, 60)}`);
  } };
  const deps = { ...calendar, calcCleaningTimes, planJobDispatch, toKstDateKey,
    parseVEvents, airbnbEventsToReservations, reservationUidOf,
    kv: {}, getGoogleToken: async () => { throw new Error('fixture: no Google'); },
    getNextMonthDates: () => ['2026-12-01', '2026-12-31'],
    fetch: async url => { assert.equal(url, property.ical_url); return { ok: true, text: async () => text }; },
    createBlockerEvent: async () => { blockers.push('unexpected'); throw new Error('No Google writes'); },
    postSlack: async text => { notices.push(text); return true; }, console: { error() {} },
  };
  const handler = new Function(...Object.keys(deps), `return (${source.slice(node.start, node.end)});`)(...Object.values(deps));
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(db, res);
  assert.equal(res.code, 200);
  assert.deepEqual(blockers, []);
  return { inserts, notices, body: res.body };
}

describe('RF-14 월간 배치 — 공통 예약 판정·식별키·출처 계약', () => {
  test('예약 번호 없는 Airbnb 예약 불가 기간은 청소 작업으로 만들지 않는다', async () => {
    assert.equal((await run(feed({ uid: null, blocked: true }))).inserts.length, 0);
  });

  test('예약 번호가 있어도 예약 불가 기간은 숙박으로 취급하지 않는다', async () => {
    assert.equal((await run(feed({ blocked: true }))).inserts.length, 0);
  });

  test('입실 날짜가 없는 일정은 실제 숙박으로 취급하지 않는다', async () => {
    assert.equal((await run(feed({ start: null }))).inserts.length, 0);
  });

  test('예약 번호가 없으면 공통 동기화와 같은 숙소:한국 입실시각 키를 사용한다', async () => {
    const { inserts } = await run(feed({ uid: null }), { checkin_hour: 14 });
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params[1], 'fixture-property:2026-12-11T05:00:00.000Z');
  });

  test('줄 접힌 예약 번호는 끊지 않고 같은 예약을 가리킨다', async () => {
    const { inserts } = await run(feed({ uid: 'booking-\r\n 1' }));
    assert.equal(inserts[0].params[1], 'booking-1');
  });

  test('기존 예약 번호와 청소 11~14시·2주 전 요청 규칙을 유지한다', async () => {
    const { inserts } = await run(feed());
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params, ['fixture-property', 'booking-1', '2026-12-13T02:00:00.000Z',
      '2026-12-13T02:00:00.000Z', '2026-12-13T05:00:00.000Z', 'MONTHLY_BATCH', '2026-11-29T02:00:00.000Z']);
  });

  test('한국 날짜의 다음 달 경계를 사용하고 다른 달 퇴실은 제외한다', async () => {
    assert.equal((await run(feed({ start: '20261129', end: '20261201' }), { checkout_hour: 0 })).inserts[0].params[2], '2026-11-30T15:00:00.000Z');
    assert.equal((await run(feed({ start: '20261230', end: '20270101' }))).inserts.length, 0);
  });
});
