/**
 * s68 — 대시보드가 숙소를 불러오는 길: 예약·청소 일정의 정본은 운영 DB(Postgres) 하나 (2026-10-12, D-031 무결성 2026-09-29)
 *
 *   앱을 열면 → 운영 DB의 숙소 행(캐시 없이)과 Pi 기기 정보를 읽고 → 실제(REAL) 숙소 하나를 골라 → 마지막 저장된 예약을
 *   바로 보여 주고 → 서버에 iCal 동기화를 맡긴 뒤 DB를 다시 읽는다. 브라우저 캐시가 DB 값을 덮어쓰지 않고, Pi에는 기기
 *   정보만 보낸다.
 *
 * ACT-08 ⑦-5: 예전엔 RoomStateApp.jsx의 글자만 검사했다(12개). 이제 실제 RoomStateApp을 실행한다 — React 껍데기·하위 화면·
 * HA/날씨 클라이언트·HTTP·localStorage만 가짜(tests/helpers/roomStateAppFixture.js). 디테일뷰 새로고침은 s81.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { roomStateAppFixture, reply, findElement, nodes, text } from '../helpers/roomStateAppFixture.js';

const DAY = 86_400_000;
const iso = days => new Date(Date.now() + days * DAY).toISOString();
const LS_KEY = 'propos_calendar_sync';
const ICAL = 'https://fixture.invalid/real.ics';
const row = (over = {}) => ({ property_id: '파주201', name: '파주201', data_origin: 'REAL', ical_url: ICAL,
  checkout_hour: 10, cleaning_duration_hours: 3,
  reservations: [{ uid: 'booking-1', checkIn: iso(3), checkOut: iso(5), platform: 'Airbnb' }], ...over });

/** 가짜 운영 API. dbRows: 배열 또는 (몇 번째 읽기인지 → 배열) */
function server({ dbRows = [row()], pi = [], icalSync = reply(200, { created: 0 }), register = reply(200, {}), dbError = false } = {}) {
  let reads = 0;
  return (call) => {
    if (call.url === '/api/cleaning/properties' && call.method === 'GET') {
      if (dbError) return new Error('DB unreachable');
      reads++;
      return reply(200, typeof dbRows === 'function' ? dbRows(reads) : dbRows);
    }
    if (call.url === '/api/cleaning/properties' && call.method === 'POST') return register;
    if (call.url === '/api/properties' && call.method === 'GET') return reply(200, pi);
    if (call.url === '/api/properties' && call.method === 'PUT') return reply(200, { ok: true });
    if (call.url === '/api/cleaning/ical-sync' && call.method === 'POST') return icalSync;
    if (call.url.startsWith('/api/monitoring/config') && call.method === 'POST') return reply(200, { ok: true });
    if (call.url.startsWith('/api/monitoring/state') && call.method === 'GET') return reply(503, {});
    return null;
  };
}
async function openApp(t, options = {}, storage = {}) {
  const f = await roomStateAppFixture({ route: server(options), storage });
  t.after(() => {
    try { assert.deepEqual(globalThis.__productionFetchTrap?.calls ?? [], [], 'no production requests'); }
    finally { f.restore(); }
  });
  const tree = await f.settle();
  return { f, tree, monthly: findElement(tree, 'MonthlyView') };
}
const liveOf = (monthly) => monthly.props.properties.find(p => p.dataOrigin === 'REAL' && p.reservations?.length);
const writes = (f) => f.calls.filter(c => c.method !== 'GET' && !c.url.startsWith('/api/monitoring/') && c.url !== '/api/cleaning/ical-sync');
const saved = (f) => JSON.parse(f.store.get(LS_KEY) ?? 'null');

describe('actual RoomStateApp — which property the dashboard opens with', () => {
  test('reads the DB rows bypassing the browser cache, together with the Pi metadata', async t => {
    const { f } = await openApp(t);
    const first = f.calls.slice(0, 2).map(c => `${c.method} ${c.url} ${c.cache ?? ''}`.trim()).sort();
    assert.deepEqual(first, ['GET /api/cleaning/properties no-store', 'GET /api/properties']);
  });

  // 고른 행: 이름 = id 인 행이면 그 id 로 열고, 아니면(옛 id) 서버가 이름으로 옮긴 뒤 이름으로 연다
  for (const [label, rows, opened, movedFrom] of [
    ['a REAL row named after itself with iCal beats every other row', [
      row({ property_id: 'SIM', name: 'SIM', data_origin: 'SIMULATED' }), row({ property_id: '파주202', name: '파주202', ical_url: null }),
      row({ property_id: 'prop_9', name: '레거시' }), row()], '파주201', null],
    ['otherwise a REAL row with iCal', [row({ property_id: '파주202', name: '파주202', ical_url: null }), row({ property_id: 'prop_9', name: '레거시' })], '레거시', 'prop_9'],
    ['otherwise a REAL row named after itself', [row({ property_id: 'SIM', name: 'SIM', data_origin: 'SIMULATED' }), row({ property_id: '파주202', name: '파주202', ical_url: null })], '파주202', null],
  ]) test(`picks the right REAL row: ${label}`, async t => {
    const { f } = await openApp(t, { dbRows: rows });
    assert.equal(saved(f).id, opened);
    const move = f.calls.find(c => c.url === '/api/cleaning/properties' && c.method === 'POST');
    assert.equal(move?.body.previous_property_id ?? null, movedFrom);
  });

  test('a SIMULATED row is never opened as the live property, and nothing is written', async t => {
    const { f, monthly } = await openApp(t, { dbRows: [row({ property_id: 'SIM', name: 'SIM', data_origin: 'SIMULATED' })] });
    assert.equal(saved(f), null);
    assert.deepEqual(writes(f), []);
    assert.ok(!f.calls.some(c => c.url === '/api/cleaning/ical-sync'));
    assert.deepEqual(monthly.props.properties.map(p => [p.id, p.dataOrigin]), [['SIM', 'SIMULATED']], 'shown as a simulated property only');
  });

  test('if the DB cannot be reached the dashboard still opens, with no live property and no writes', async t => {
    const { f, monthly } = await openApp(t, { dbError: true });
    assert.deepEqual(monthly.props.properties, []);
    assert.equal(saved(f), null);
    assert.deepEqual(writes(f), []);
  });

  test('the last saved DB reservations show right away even when the server iCal sync fails', async t => {
    const { f, monthly } = await openApp(t, { icalSync: reply(500, { error: 'iCal down' }) });
    const shown = monthly.props.properties.filter(p => p.id === '파주201');
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0].reservations.map(r => r.uid), ['booking-1']);
    // 그냥 DB 목록의 한 줄이 아니라 실시간 숙소(센서·모니터링 상태가 붙는 자리)로 열려 있다
    assert.ok('monitorState' in shown[0] && 'serverWatcherActive' in shown[0], 'opened as the live property');
    assert.ok(f.toasts.some(([m, kind]) => kind === 'e' && /캘린더 동기화 실패: iCal down/.test(m)));
  });
});

describe('actual RoomStateApp — the DB is the source, the browser cache never overwrites it (D-031)', () => {
  test('settings come from the DB row, joined with the Pi metadata found by id or name', async t => {
    const pi = [{ id: 'x', name: '다른숙소', district: '서울', watcherId: 'watcher9', devices: {} },
      { id: 'pi-local-id', name: '파주201', district: '파주', watcherId: 'watcher1', devices: { LIGHT_LIVING: 'light.rgbcct_8002' } }];
    const { f } = await openApp(t, { pi });
    const cfg = saved(f);
    assert.deepEqual({ id: cfg.id, name: cfg.name, checkOutHour: cfg.checkOutHour, cleaningDurationHours: cfg.cleaningDurationHours,
      airbnbIcalUrl: cfg.airbnbIcalUrl, district: cfg.district, watcherId: cfg.watcherId, devices: cfg.devices },
    { id: '파주201', name: '파주201', checkOutHour: 10, cleaningDurationHours: 3, airbnbIcalUrl: ICAL,
      district: '파주', watcherId: 'watcher1', devices: { LIGHT_LIVING: 'light.rgbcct_8002' } });
  });

  test('an already-registered property is not re-saved from a stale browser cache; the DB values win', async t => {
    const stale = { id: '파주201', name: '파주201', checkOutHour: 8, cleaningDurationHours: 1, airbnbIcalUrl: 'https://fixture.invalid/stale.ics' };
    const { f } = await openApp(t, {}, { [LS_KEY]: JSON.stringify(stale) });
    assert.ok(!f.calls.some(c => c.url === '/api/cleaning/properties' && c.method === 'POST'), 'no save from the cache');
    const cfg = saved(f);
    assert.deepEqual([cfg.checkOutHour, cfg.cleaningDurationHours, cfg.airbnbIcalUrl], [10, 3, ICAL]);
  });

  test('a legacy id is moved to the name through the server first, then the Pi gets watcher metadata only', async t => {
    const pi = [{ id: 'prop_9', name: '파주201', district: '파주', watcherId: 'watcher1', devices: { LIGHT_LIVING: 'light.a' } }];
    const { f } = await openApp(t, { dbRows: [row({ property_id: 'prop_9' })], pi });
    const post = f.calls.find(c => c.url === '/api/cleaning/properties' && c.method === 'POST');
    assert.deepEqual(post.body, { property_id: '파주201', name: '파주201', checkout_hour: 10, cleaning_duration_hours: 3,
      ical_url: ICAL, host_phone: null, previous_property_id: 'prop_9' });
    const put = f.calls.find(c => c.url === '/api/properties' && c.method === 'PUT');
    assert.deepEqual(put.body, [{ id: '파주201', name: '파주201', district: '파주', watcherId: 'watcher1', devices: { LIGHT_LIVING: 'light.a' } }],
      'no iCal address, reservations or cleaning values go to the Pi');
    assert.equal(saved(f).id, '파주201');
  });

  test('if the server refuses the move, the old id is kept and the Pi is not touched', async t => {
    const { f } = await openApp(t, { dbRows: [row({ property_id: 'prop_9' })], register: reply(409, { error: '이미 같은 이름의 숙소가 있어요' }) });
    assert.equal(saved(f).id, 'prop_9');
    assert.ok(!f.calls.some(c => c.url === '/api/properties' && c.method === 'PUT'));
    assert.ok(f.toasts.some(([m]) => m === '숙소 이름 이전 실패: 이미 같은 이름의 숙소가 있어요'));
  });
});

describe('actual RoomStateApp — iCal sync goes through the server', () => {
  test('POSTs the property to the server sync, re-reads the DB, shows the new reservation and tells the watcher', async t => {
    const later = row({ reservations: [{ uid: 'booking-2', checkIn: iso(1), checkOut: iso(2), platform: 'Airbnb' }] });
    const { f, monthly } = await openApp(t, { dbRows: reads => reads === 1 ? [row()] : [later] });
    const sync = f.calls.findIndex(c => c.url === '/api/cleaning/ical-sync');
    assert.deepEqual(f.calls[sync].body, { property_id: '파주201' });
    const reread = f.calls.findIndex((c, i) => i > sync && c.url === '/api/cleaning/properties' && c.method === 'GET');
    assert.ok(reread > sync, 'the DB is read again after the server sync');
    assert.deepEqual(liveOf(monthly).reservations.map(r => r.uid), ['booking-2']);
    const watcher = f.calls.find((c, i) => i > reread && c.url.startsWith('/api/monitoring/config'));
    assert.deepEqual(watcher.body.reservation, { uid: 'booking-2', checkIn: later.reservations[0].checkIn, checkOut: later.reservations[0].checkOut });
    assert.ok(f.calls.every(c => c.url.startsWith('/api/')), 'the browser never fetches iCal or Google itself');
  });
});

describe('actual SettingsModal — "load server defaults"', () => {
  async function modal(t, options) {
    const f = await roomStateAppFixture({ route: server(options) });
    t.after(() => f.restore());
    const saves = [];
    const props = { config: null, onSave: cfg => saves.push(cfg), onClose: () => {} };
    const button = label => nodes(f.renderModal(props)).find(n => n.type === 'button' && text(n).includes(label));
    await button('서버 기본값 불러오기').props.onClick(); await f.flush();
    return { f, saves, button };
  }

  test('fills the form from the DB row and the Pi devices, ready to save', async t => {
    const pi = [{ id: '파주201', name: '파주201', district: '파주', watcherId: 'watcher1', devices: { LIGHT_LIVING: 'light.a' } }];
    const { f, saves, button } = await modal(t, { pi, dbRows: [row({ property_id: 'SIM', name: 'SIM', data_origin: 'SIMULATED' }), row()] });
    button('저장 및 동기화').props.onClick();
    assert.equal(saves.length, 1);
    const s = saves[0];
    assert.deepEqual([s.id, s.name, s.checkOutHour, s.cleaningDurationHours, s.airbnbIcalUrl, s.district, s.watcherId],
      ['파주201', '파주201', 10, 3, ICAL, '파주', 'watcher1']);
    assert.equal(s.devices.LIGHT_LIVING, 'light.a', 'Pi device mapping');
    assert.ok(Object.entries(s.devices).every(([role, v]) => role === 'LIGHT_LIVING' || v === null), 'other roles empty');
    assert.ok(f.toasts.some(([m]) => m === '운영 DB에서 설정을 불러왔습니다. 저장을 눌러 적용하세요.'));
  });

  test('with no REAL row it says so and leaves the form alone', async t => {
    const { f, saves, button } = await modal(t, { dbRows: [row({ property_id: 'SIM', name: 'SIM', data_origin: 'SIMULATED' })] });
    assert.ok(f.toasts.some(([m]) => m === '운영 DB에 저장된 숙소 설정이 없습니다.'));
    button('저장 및 동기화').props.onClick();
    assert.equal(saves[0].name, '내 숙소', 'the form still holds the blank defaults');
  });
});
