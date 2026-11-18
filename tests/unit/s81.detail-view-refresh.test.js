/**
 * s81 — 디테일뷰를 열 때마다 청소 배정을 운영 DB에서 다시 읽는다 (2026-10-30 실사용 중 발견)
 *
 * 관리자가 청소 배정을 직접 복구한 뒤 대시보드 캘린더는 바로 "배정완료"였는데 디테일뷰는 "미배정"이었다 — 같은 표를 보지만,
 * 캘린더는 열 때마다 다시 읽고 디테일뷰는 앱을 처음 열 때·15분마다만 읽었다. 고침: 디테일뷰로 들어갈 때마다 다시 읽는다.
 *
 * ACT-08 ⑦-5: 예전엔 RoomStateApp.jsx의 글자만 검사했다(5개 — 이펙트 모양·의존성 배열 글자 등). 이제 실제 RoomStateApp을
 * 실행해 디테일뷰로 들어가면 요청이 나가고 디테일뷰가 새 배정을 받는지 본다(tests/helpers/roomStateAppFixture.js).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { roomStateAppFixture, reply, findElement } from '../helpers/roomStateAppFixture.js';

const DAY = 86_400_000, HOUR = 3_600_000;
const at = ms => new Date(Date.now() + ms).toISOString();
const checkOut = at(5 * DAY);
const row = (cleaning = {}) => ({ property_id: '파주201', name: '파주201', data_origin: 'REAL', ical_url: 'https://fixture.invalid/real.ics',
  checkout_hour: 11, cleaning_duration_hours: 2.5,
  reservations: [{ uid: 'booking-1', checkIn: at(3 * DAY), checkOut, platform: 'Airbnb',
    cleaningAt: checkOut, cleaningEnd: at(5 * DAY + 3 * HOUR), ...cleaning }] });
const BEFORE = row({ cleaningStatus: 'PENDING' });
const AFTER = row({ cleaningStatus: 'ASSIGNED', cleanerName: 'Fixture Cleaner' });

async function openApp(t, { profile = 'hybrid', dbRows }) {
  let reads = 0;
  const route = (call) => {
    if (call.url === '/api/cleaning/properties' && call.method === 'GET') { reads++; return reply(200, dbRows(reads)); }
    if (call.url === '/api/properties' && call.method === 'GET') return reply(200, []);
    if (call.url === '/api/cleaning/ical-sync') return reply(200, { created: 0 });
    if (call.url.startsWith('/api/monitoring/config')) return reply(200, { ok: true });
    if (call.url.startsWith('/api/monitoring/state')) return reply(503, {});
    return null;
  };
  const f = await roomStateAppFixture({ route, profile });
  t.after(() => {
    try { assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests'); }
    finally { f.restore(); }
  });
  await f.settle();
  return { f, reads: () => reads };
}
const dbReads = f => f.calls.filter(c => c.url === '/api/cleaning/properties' && c.method === 'GET').length;

describe('actual RoomStateApp — the detail view re-reads cleaning assignments every time it opens', () => {
  test('a cleaning assigned after the app opened shows in the detail view as soon as it is opened', async t => {
    // 앱을 열 때 1번 + 첫 동기화 뒤 1번 읽음(둘 다 미배정). 그 뒤 관리자가 배정 → 디테일뷰를 열 때 읽으면 배정완료
    const { f } = await openApp(t, { dbRows: n => (n <= 2 ? [BEFORE] : [AFTER]) });
    assert.equal(dbReads(f), 2);
    const monthly = findElement(f.render(), 'MonthlyView');
    monthly.props.onSelectProperty({ id: '파주201' });
    const detail = findElement(await f.settle(), 'PropertyDetailView');
    assert.equal(dbReads(f), 3, 'opening the detail view reads the DB once');
    assert.deepEqual(detail.props.property.cleaningSlots.map(s => [s.cleaningStatus, s.cleanerName]), [['ASSIGNED', 'Fixture Cleaner']]);
  });

  test('going back and opening the detail view again reads again; staying on the list does not', async t => {
    const { f } = await openApp(t, { dbRows: () => [BEFORE] });
    findElement(f.render(), 'MonthlyView').props.onSelectProperty({ id: '파주201' });
    findElement(await f.settle(), 'PropertyDetailView').props.onBack(); // → 목록
    await f.settle();
    const onList = dbReads(f);
    await f.settle();
    assert.equal(dbReads(f), onList, 'no extra reads while the list stays open');
    findElement(f.render(), 'PropertyListView').props.onSelectProperty({ id: '파주201' });
    await f.settle();
    assert.equal(dbReads(f), onList + 1);
  });

  test('the 15-minute automatic sync stays: it asks the server to sync and reads the DB again', async t => {
    const { f } = await openApp(t, { dbRows: () => [BEFORE] });
    const timer = f.intervals.find(i => i.ms === 15 * 60 * 1000 && !i.cleared);
    assert.ok(timer, '15-minute sync timer');
    const before = f.calls.length;
    timer.fn(); await f.settle();
    const after = f.calls.slice(before).map(c => `${c.method} ${c.url}`);
    assert.deepEqual(after.filter(c => !c.includes('/api/monitoring/')), ['POST /api/cleaning/ical-sync', 'GET /api/cleaning/properties']);
  });

  test('the explicit demo profile never reads the DB, not even when a detail view opens', async t => {
    const { f } = await openApp(t, { profile: 'demo', dbRows: () => { throw new Error('demo must not read the DB'); } });
    const monthly = findElement(f.render(), 'MonthlyView');
    const demo = monthly.props.properties[0];
    assert.equal(demo.dataOrigin, 'SIMULATED');
    monthly.props.onSelectProperty({ id: demo.id });
    const detail = findElement(await f.settle(), 'PropertyDetailView');
    assert.equal(detail.props.property.id, demo.id);
    assert.equal(dbReads(f), 0);
  });
});
