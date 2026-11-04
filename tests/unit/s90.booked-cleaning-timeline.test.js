import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { buildLiveProperty, deriveCurrentState, deriveTimeline, lastPastReservation } from '../../src/application/calendarSyncService.js';
import { getWindowSegments, getGanttSegments } from '../../src/data/roomStateMockData.js';
import { ASSIGNED_STATUSES } from '../../src/domain/cleaningStatsDomain.js';

const at = value => new Date(`2026-10-${value}:00+09:00`);
const template = { id: 'timeline-fixture', name: '검증숙소', checkOutHour: 11, cleaningDurationHours: 3 };
function reservations() {
  return [
    { uid: 'first', checkIn: at('29T15:00'), checkOut: at('30T11:00'), cleaningAt: at('30T12:00'), cleaningEnd: at('30T15:00'), cleaningStatus: 'ASSIGNED', cleanerName: '첫담당자' },
    { uid: 'next', checkIn: at('30T15:00'), checkOut: at('31T11:00'), cleaningAt: at('31T12:00'), cleaningEnd: at('31T15:00'), cleaningStatus: 'ASSIGNED', cleanerName: '다음담당자' },
  ];
}
function withNow(value, run) {
  mock.timers.enable({ apis: ['Date'], now: at(value) });
  try { return run(); } finally { mock.timers.reset(); }
}
const cleaningRows = segments => segments.filter(s => s.mainStatus === 'CLEANING').map(s => ({
  subStatus: s.subStatus, start: s.start.toISOString(), end: s.end?.toISOString() ?? null,
  checkout: s.cleaningCheckoutAt?.toISOString(),
}));

function indicatorMap(property, recentSegs) {
  const source = readFileSync(new URL('../../src/components/v2/PropertyDetailView.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback;
  function visit(node) {
    if (!node || typeof node !== 'object' || callback) return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'cleaningInfoMap') callback = node.init.arguments[0];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast); assert.ok(callback);
  return new Function('property', 'recentSegs', 'lastPastReservation', 'ASSIGNED_STATUSES', `return (${source.slice(callback.start, callback.end)})();`)(property, recentSegs, lastPastReservation, ASSIGNED_STATUSES);
}

describe('Booked cleaning timeline — 11 checkout / 12–15 cleaning', () => {
  test('current state switches from pending to progress at the booked start', () => {
    assert.deepEqual(deriveCurrentState(reservations(), at('30T11:30'), 3), { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' });
    assert.deepEqual(deriveCurrentState(reservations(), at('30T12:00'), 3), { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' });
    assert.deepEqual(deriveCurrentState(reservations(), at('30T14:30'), 3), { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' });
    assert.equal(deriveCurrentState(reservations(), at('30T15:00'), 3).mainStatus, 'OCCUPIED');
  });

  test('historical waiting and progress retain their checkout identity', () => withNow('30T16:00', () => {
    assert.deepEqual(cleaningRows(deriveTimeline(reservations().slice(0, 1), 3)), [
      { subStatus: 'CLEANING_PENDING', start: at('30T11:00').toISOString(), end: at('30T12:00').toISOString(), checkout: at('30T11:00').toISOString() },
      { subStatus: 'CLEANING_IN_PROGRESS', start: at('30T12:00').toISOString(), end: at('30T15:00').toISOString(), checkout: at('30T11:00').toISOString() },
    ]);
  }));

  for (const now of ['30T10:00', '30T11:30', '30T12:00', '30T12:30', '30T14:30']) test(`detail and list finish cleaning at 15:00 from ${now}`, () => withNow(now, () => {
    const property = buildLiveProperty(template, reservations());
    const detail = getWindowSegments(property, 24, 48);
    const gantt = getGanttSegments(property, at('29T00:00'), at('31T23:00'));
    for (const segments of [detail, gantt]) {
      const first = segments.filter(s => s.mainStatus === 'CLEANING' && s.isFuture && s.start < at('30T15:00'));
      assert.ok(first.length);
      assert.equal(first.at(-1).end.getTime(), at('30T15:00').getTime(), 'refresh must not add another full three hours');
      assert.ok(first.every(s => s.cleaningCheckoutAt?.getTime() === at('30T11:00').getTime()));
      if (at(now) < at('30T12:00')) {
        const wait = first.find(s => s.subStatus === 'CLEANING_PENDING');
        assert.ok(wait); assert.equal(wait.end.getTime(), at('30T12:00').getTime());
      }
      const progress = first.find(s => s.subStatus === 'CLEANING_IN_PROGRESS');
      assert.ok(progress); assert.equal(progress.start.getTime(), Math.max(at(now).getTime(), at('30T12:00').getTime()));
      assert.ok(segments.some(s => s.mainStatus === 'OCCUPIED' && s.start.getTime() === at('30T15:00').getTime()), 'next checkin exactly at cleaning end must remain visible');
      assert.ok(segments.every(s => s.end > s.start));
    }
  }));

  test('future reservation cycles also use 12–15 instead of checkout + 3h', () => withNow('30T10:00', () => {
    const segments = getWindowSegments(buildLiveProperty(template, reservations()), 24, 48);
    const rows = cleaningRows(segments).filter(s => s.checkout === at('31T11:00').toISOString());
    assert.deepEqual(rows.map(s => [s.subStatus, s.start, s.end]), [
      ['CLEANING_PENDING', at('31T11:00').toISOString(), at('31T12:00').toISOString()],
      ['CLEANING_IN_PROGRESS', at('31T12:00').toISOString(), at('31T15:00').toISOString()],
    ]);
  }));

  for (const now of ['29T12:00', '29T14:15']) test(`future cleaning from vacant/preparation state at ${now}`, () => withNow(now, () => {
    const segments = getWindowSegments(buildLiveProperty(template, reservations()), 24, 48);
    const rows = cleaningRows(segments).filter(s => s.checkout === at('30T11:00').toISOString());
    assert.deepEqual(rows.map(s => [s.subStatus, s.start, s.end]), [
      ['CLEANING_PENDING', at('30T11:00').toISOString(), at('30T12:00').toISOString()],
      ['CLEANING_IN_PROGRESS', at('30T12:00').toISOString(), at('30T15:00').toISOString()],
    ]);
  }));

  test('late cleaning end does not overlap the next preparation segment', () => withNow('30T15:10', () => {
    const rows = reservations(); rows[1].checkIn = at('30T15:30');
    const timeline = deriveTimeline(rows, 3);
    // 지난 예약의 입실준비도 타임라인 앞에 남으므로(s91) 다음 예약의 입실준비 = 마지막 것
    const preparation = timeline.findLast(s => s.mainStatus === 'PRE_STAY_READY');
    assert.ok(preparation); assert.equal(preparation.start.getTime(), at('30T15:00').getTime());
  }));

  test('missing or invalid booked times keep the default checkout-based window', () => withNow('30T11:30', () => {
    for (const values of [{ cleaningAt: undefined, cleaningEnd: undefined }, { cleaningAt: at('30T10:00'), cleaningEnd: at('30T13:00') }]) {
      const rows = reservations(); Object.assign(rows[0], values);
      assert.equal(deriveCurrentState(rows, at('30T11:30'), 3).subStatus, 'CLEANING_IN_PROGRESS');
      const segs = getWindowSegments(buildLiveProperty(template, rows), 24, 48);
      assert.equal(segs.find(s => s.mainStatus === 'CLEANING' && s.isFuture).end.getTime(), at('30T14:00').getTime());
    }
  }));
});

describe('Actual detail indicator mapping after splitting waiting and progress', () => {
  test('each future booking has one indicator with its own cleaner', () => withNow('30T10:00', () => {
    const property = buildLiveProperty(template, reservations());
    const segments = getWindowSegments(property, 24, 48), map = indicatorMap(property, segments);
    assert.deepEqual([...map.values()].map(r => r.cleanerName), ['첫담당자', '다음담당자']);
    assert.ok([...map.keys()].every(s => s.subStatus === 'CLEANING_IN_PROGRESS'));
  }));
  test('a segment clipped to now still matches its booking', () => withNow('30T14:30', () => {
    const property = buildLiveProperty(template, reservations());
    const segments = getWindowSegments(property, 24, 48), map = indicatorMap(property, segments);
    assert.deepEqual([...map.values()].map(r => r.cleanerName), ['첫담당자', '다음담당자']);
  }));
  test('duplicate reservation UIDs do not extend cleaning or duplicate its indicator', () => withNow('30T10:00', () => {
    const rows = reservations(); rows.push({ ...rows[1], uid: 'next-alias' });
    const property = buildLiveProperty(template, rows);
    const segments = getWindowSegments(property, 24, 48);
    assert.equal(segments.filter(s => s.mainStatus === 'CLEANING' && s.cleaningCheckoutAt?.getTime() === at('31T11:00').getTime()).length, 2);
    assert.deepEqual([...indicatorMap(property, segments).values()].map(r => r.cleanerName), ['첫담당자', '다음담당자']);
  }));
  test('explicit missing checkout identity does not borrow another booking cleaner', () => withNow('30T14:30', () => {
    const property = buildLiveProperty(template, reservations());
    const segment = { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', isFuture: true,
      start: at('31T12:00'), end: at('31T15:00'), cleaningCheckoutAt: at('31T10:00') };
    assert.equal(indicatorMap(property, [segment]).get(segment)?.cleaningStatus, 'UNASSIGNED');
  }));
});

test('list Gantt does not merge progress into a pending-colored bar', () => withNow('30T10:00', () => {
  const text = readFileSync(new URL('../../src/components/v2/PropertyListView.jsx', import.meta.url), 'utf8');
  const tree = parse(text, { sourceType: 'module', plugins: ['jsx'] });
  const node = tree.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'mergeGanttSegments');
  assert.ok(node);
  const merge = new Function(`return (${text.slice(node.start, node.end)});`)();
  const property = buildLiveProperty(template, reservations());
  const rows = merge(getGanttSegments(property, at('29T00:00'), at('31T23:00')))
    .filter(s => s.mainStatus === 'CLEANING' && s.start < at('30T15:00'));
  assert.deepEqual(rows.map(s => [s.subStatus, s.start.toISOString(), s.end.toISOString()]), [
    ['CLEANING_PENDING', at('30T11:00').toISOString(), at('30T12:00').toISOString()],
    ['CLEANING_IN_PROGRESS', at('30T12:00').toISOString(), at('30T15:00').toISOString()],
  ]);
}));
