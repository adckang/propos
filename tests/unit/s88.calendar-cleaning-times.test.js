import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import * as calendarDomain from '../../src/domain/calendarAssignmentDomain.js';
import { toKstDateKey } from '../../server/cleaning/_dispatch.js';

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
  return { id: 'job-1', checkout_at: checkout, status: 'ASSIGNED',
    assigned_cleaner_id: cleaner.id, google_event_id: 'event-1',
    cleaning_start_at: checkout, cleaning_end_at: '2026-10-30T05:00:00.000Z',
    ...overrides };
}

function load(name, dependencies) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node);
  return new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)});`)(...Object.values(dependencies));
}

async function execute(name, { row = job(), events = [booking()], pages, calendarOk = true } = {}) {
  const updates = [], notices = [], reads = [];
  const deps = {
    db: { query: async (sql, params) => {
      if (sql.includes('UPDATE cleaning_jobs')) { updates.push({ sql, params }); return { rowCount: 1, rows: [{ id: row.id }] }; }
      reads.push({ sql, params });
      if (sql.includes('FROM property_cleaning_config')) return { rows: [{ property_id: 'property-1', google_calendar_id: 'calendar-1' }] };
      if (sql.includes('FROM cleaning_jobs')) return { rows: [row] };
      if (sql.includes('FROM cleaners')) return { rows: [cleaner] };
      throw new Error('Unexpected DB call');
    } },
    getGoogleToken: async () => 'fake-token', kv: {}, CALENDAR_API: 'https://example.invalid',
    fetch: async () => ({ ok: calendarOk, status: calendarOk ? 200 : 503,
      json: async () => pages ? pages.shift() : { items: events } }),
    readBody: async () => ({ calendar_id: 'calendar-1' }),
    sendJson: (res, code, body) => res.status(code).json(body),
    toKstDateKey,
    resolveCalendarCleaner: async event => {
      const matched = calendarDomain.matchCleanerAttendee(event.attendees, [cleaner], event.organizer?.email);
      return { attendeeEmail: event.attendees?.[0]?.email, cleaner: matched?.cleaner ?? null };
    },
    ...calendarDomain,
    postSlack: async value => { notices.push({ type: 'slack', value }); },
    sendCompletionSmsToRest: async () => { notices.push({ type: 'sms' }); },
    console: { error() {} },
  };
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
