/**
 * s125 — RF-27 (사용자 지시 2026-11-17): 대시보드를 열지 않아도 Pi 워처의 예약이 낡지 않게, 서버 정기 작업이
 * iCal 동기화 직후 DB의 최신 예약을 Pi 워처 설정(`/api/monitoring/config`)으로 보낸다.
 *
 * 지켜야 할 것(사용자 지시): Pi 상태(roomState)를 바꾸지 않는다 — 빈 예약은 보내지 않는다(워처는 예약이 있다가
 * 빈 값이 오면 "예약 취소"로 보고 상태를 바꾼다), 상태·이벤트 경로는 부르지 않는다. 워처 하나가 숙소 여러 개를
 * 맡으면 서로 덮어쓰므로 보내지 않는다. 보내는 것은 예약뿐(이름·기기 설정은 그대로). 실패해도 정기 작업의 다른 단계를 막지 않는다.
 *
 * 레이어: L1 = 예약 고르기 도메인 함수 실제 실행 / L2 = 전달 함수를 가짜 DB·가짜 워처 목록·가로챈 fetch 로 실행
 * (실제 네트워크 없음) + 정기 작업·대시보드·동기화 서비스 소스 계약.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  splitReservationsAt,
  pickCurrentReservation,
  usableReservations,
  toMonitoringReservation,
} from '../../src/domain/monitoringReservationDomain.js';
import { pushCurrentReservationsToWatchers } from '../../server/watcherReservationSync.js';
import { buildLiveProperty } from '../../src/application/calendarSyncService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = new Date('2026-11-17T06:00:00.000Z'); // 11-17 15:00 KST
const iso = s => new Date(s).toISOString();

// ── 가짜 DB: 숙소 설정·예약을 숙소 id 별로 돌려주고 받은 쿼리를 기록한다 ──
function fakeDb({ configs = {}, reservations = {}, jobs = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      const id = params[0];
      if (/FROM property_cleaning_config/.test(text)) return { rows: configs[id] ? [configs[id]] : [] };
      if (/FROM property_reservations/.test(text)) return { rows: reservations[id] ?? [] };
      if (/FROM cleaning_jobs/.test(text)) return { rows: jobs[id] ?? [] };
      throw new Error(`예상하지 못한 쿼리: ${text}`);
    },
  };
}

function fakeFetch(respond = () => ({ ok: true, status: 200 })) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return respond(url, init);
  };
  return { calls, impl };
}

const REAL_CONFIG = { property_id: '파주201', name: '파주201' };
const PAST = { uid: 'past@airbnb', checkIn: '2026-11-14T06:00:00.000Z', checkOut: '2026-11-15T02:00:00.000Z', status: 'ACTIVE' };
const NEXT = { uid: 'next@airbnb', checkIn: '2026-11-20T06:00:00.000Z', checkOut: '2026-11-23T02:00:00.000Z', status: 'ACTIVE' };
const LATER = { uid: 'later@airbnb', checkIn: '2026-11-25T06:00:00.000Z', checkOut: '2026-11-26T02:00:00.000Z', status: 'ACTIVE' };
const ACTIVE = { uid: 'active@airbnb', checkIn: '2026-11-16T06:00:00.000Z', checkOut: '2026-11-18T02:00:00.000Z', status: 'ACTIVE' };

const oneWatcher = (id = '파주201', sourceUrl = 'https://watcher.test') => async () => [{ id, watcherId: 'watcher1', sourceUrl }];
const quiet = () => {};

// ═══ L1: 예약 고르기 ═══
describe('L1 monitoringReservationDomain — 대시보드와 서버가 같은 "지금 예약" 규칙', () => {
  const toDates = r => ({ ...r, checkIn: new Date(r.checkIn), checkOut: new Date(r.checkOut) });

  test('진행 중 예약이 있으면 그것, 앞으로 올 예약은 입실 순', () => {
    const { active, future } = splitReservationsAt([LATER, ACTIVE, NEXT].map(toDates), NOW);
    assert.equal(active.uid, 'active@airbnb');
    assert.deepEqual(future.map(r => r.uid), ['next@airbnb', 'later@airbnb']);
  });

  test('경계: 입실 시각 = 지금이면 진행 중, 퇴실 시각 = 지금이면 끝난 예약', () => {
    const startsNow = toDates({ uid: 's', checkIn: iso(NOW), checkOut: '2026-11-18T02:00:00.000Z' });
    const endsNow = toDates({ uid: 'e', checkIn: '2026-11-16T06:00:00.000Z', checkOut: iso(NOW) });
    assert.equal(splitReservationsAt([startsNow], NOW).active?.uid, 's');
    assert.equal(splitReservationsAt([endsNow], NOW).active, null);
    assert.deepEqual(splitReservationsAt([endsNow], NOW).future, []);
  });

  test('같은 입실 시각의 예약이 uid 만 다르게 여럿이면 들어온 순서와 무관하게 같은 것을 고른다', () => {
    const dupActive = [{ ...ACTIVE, uid: 'b@airbnb' }, { ...ACTIVE, uid: 'a@airbnb' }].map(toDates);
    assert.equal(splitReservationsAt(dupActive, NOW).active.uid, 'a@airbnb');
    assert.equal(splitReservationsAt([...dupActive].reverse(), NOW).active.uid, 'a@airbnb');
    const dupNext = [{ ...NEXT, uid: 'z@airbnb' }, { ...NEXT, uid: 'm@airbnb' }].map(toDates);
    assert.deepEqual(splitReservationsAt(dupNext, NOW).future.map(r => r.uid), ['m@airbnb', 'z@airbnb']);
    assert.deepEqual(splitReservationsAt([...dupNext].reverse(), NOW).future.map(r => r.uid), ['m@airbnb', 'z@airbnb']);
  });

  test('진행 중 예약이 둘이면(겹침) 먼저 입실한 것', () => {
    const early = toDates({ uid: 'z-early', checkIn: '2026-11-15T06:00:00.000Z', checkOut: '2026-11-18T02:00:00.000Z' });
    const late = toDates({ uid: 'a-late', checkIn: '2026-11-16T06:00:00.000Z', checkOut: '2026-11-19T02:00:00.000Z' });
    assert.equal(splitReservationsAt([late, early], NOW).active.uid, 'z-early');
  });

  test('pickCurrentReservation: 진행 중 → 없으면 가장 가까운 다음 예약 → 둘 다 없으면 null', () => {
    assert.equal(pickCurrentReservation([NEXT, ACTIVE].map(toDates), NOW).uid, 'active@airbnb');
    assert.equal(pickCurrentReservation([LATER, PAST, NEXT].map(toDates), NOW).uid, 'next@airbnb');
    assert.equal(pickCurrentReservation([PAST].map(toDates), NOW), null);
    assert.equal(pickCurrentReservation([], NOW), null);
    assert.equal(pickCurrentReservation(undefined, NOW), null);
  });

  // DB의 check_in·check_out 은 NOT NULL 이라 빈 시각은 오지 않는다(예전 대시보드 규칙 그대로 — new Date(null) 은 1970년)
  test('usableReservations: 취소·차단·날짜 오류·빈 행을 빼고 문자열 시각을 Date 로', () => {
    const rows = usableReservations([
      NEXT,
      { ...LATER, status: 'CANCELLED' },
      { ...LATER, uid: 'blocked', status: 'BLOCKED' },
      { uid: 'bad', checkIn: 'not-a-date', checkOut: NEXT.checkOut },
      null,
    ]);
    assert.deepEqual(rows.map(r => r.uid), ['next@airbnb']);
    assert.ok(rows[0].checkIn instanceof Date);
    assert.equal(rows[0].checkIn.toISOString(), NEXT.checkIn);
    assert.deepEqual(usableReservations(null), []);
  });

  test('toMonitoringReservation: 워처 설정 모양(uid·입실·퇴실 ISO), 예약 없으면 null', () => {
    assert.deepEqual(toMonitoringReservation(toDates(NEXT)), { uid: 'next@airbnb', checkIn: NEXT.checkIn, checkOut: NEXT.checkOut });
    assert.deepEqual(toMonitoringReservation({ checkIn: new Date(NEXT.checkIn), checkOut: new Date(NEXT.checkOut) }).uid, null);
    assert.equal(toMonitoringReservation(null), null);
  });

  test('대시보드(buildLiveProperty)가 고르는 예약과 서버가 고르는 예약이 같다', () => {
    const reservations = [PAST, NEXT, LATER].map(toDates);
    const RealDate = Date;
    // buildLiveProperty 는 현재 시각을 Date.now() 로 읽는다 — 이 테스트 동안만 NOW 로 고정
    const fixedNow = NOW.getTime();
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixedNow])); } static now() { return fixedNow; } };
    try {
      const live = buildLiveProperty({ id: '파주201', name: '파주201' }, reservations, []);
      assert.deepEqual(toMonitoringReservation(live.reservation), toMonitoringReservation(pickCurrentReservation(reservations, NOW)));
      assert.equal(live.reservation.uid, 'next@airbnb');
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

// ═══ L2: 서버 → 워처 전달 ═══
describe('L2 pushCurrentReservationsToWatchers — DB 최신 예약을 워처 설정으로', () => {
  test('다음 예약을 워처 설정 경로로 POST — 예약만, 공유키 헤더 포함, 주소 끝 / 정리', async () => {
    const db = fakeDb({ configs: { 파주201: REAL_CONFIG }, reservations: { 파주201: [PAST, NEXT, LATER] } });
    const f = fakeFetch();
    const results = await pushCurrentReservationsToWatchers(db, {
      lookup: oneWatcher('파주201', 'https://watcher.test/'), fetchImpl: f.impl, now: NOW, env: { PROPOS_PI_SECRET: 'k'.repeat(32) }, log: quiet,
    });
    assert.equal(f.calls.length, 1);
    const [call] = f.calls;
    assert.equal(call.url, 'https://watcher.test/api/monitoring/config');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.equal(call.init.headers['x-pi-secret'], 'k'.repeat(32));
    assert.ok(call.init.signal, '응답 없는 워처에 대비한 제한 시간');
    // 예약 하나와 청소 일정만(없으면 null — 지난 일정이 남지 않게) — 이름(areaName)·기기 설정은 보내지 않는다(워처는 받은 키만 덮어쓴다)
    assert.deepEqual(call.body, { reservation: { uid: 'next@airbnb', checkIn: NEXT.checkIn, checkOut: NEXT.checkOut }, cleaning: null });
    assert.deepEqual(results.map(r => [r.propertyId, r.sent, r.result, r.httpStatus]), [['파주201', true, '보냄', 200]]);
  });

  test('DB 조회는 그 숙소의 실제(REAL) 데이터만', async () => {
    const db = fakeDb({ configs: { 파주201: REAL_CONFIG }, reservations: { 파주201: [NEXT] } });
    await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: fakeFetch().impl, now: NOW, env: {}, log: quiet });
    assert.equal(db.calls.length, 3);
    for (const c of db.calls) {
      assert.match(c.text, /data_origin='REAL'/);
      assert.equal(c.params[0], '파주201');
    }
    assert.match(db.calls[2].text, /checkout_at = \$2::timestamptz/);
    assert.deepEqual(db.calls[2].params, ['파주201', NEXT.checkOut], '보내는 예약의 퇴실에 딸린 청소만 읽는다');
  });

  test('청소 일정(DEC-17): 끝나지 않은 청소 중 가장 이른 것 — 퇴실·시작·끝 시각과 배정 여부', async () => {
    const jobs = [
      { id: 'job-done', checkout_at: '2026-11-17T02:00:00.000Z', cleaning_start_at: '2026-11-17T02:00:00.000Z', cleaning_end_at: '2026-11-17T05:00:00.000Z', status: 'ASSIGNED' },
      { id: 'job-later', checkout_at: '2026-11-25T02:00:00.000Z', cleaning_start_at: '2026-11-25T02:00:00.000Z', cleaning_end_at: '2026-11-25T05:00:00.000Z', status: 'PENDING' },
      { id: 'job-next', checkout_at: '2026-11-23T02:00:00.000Z', cleaning_start_at: '2026-11-23T02:00:00.000Z', cleaning_end_at: null, status: 'ASSIGNED' },
    ];
    const db = fakeDb({ configs: { 파주201: { ...REAL_CONFIG, cleaning_duration_hours: 2.5 } }, reservations: { 파주201: [NEXT] }, jobs: { 파주201: jobs } });
    const f = fakeFetch();
    await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.deepEqual(f.calls[0].body.cleaning, {
      jobId: 'job-next', checkoutAt: '2026-11-23T02:00:00.000Z', startAt: '2026-11-23T02:00:00.000Z',
      endAt: '2026-11-23T04:30:00.000Z', assigned: true,
    }, '끝 시각이 비면 숙소의 청소 소요 시간으로');
    assert.equal(f.calls[0].body.cleaning.jobId, 'job-next', '보내는 예약(11-23 퇴실)의 청소 — 다른 퇴실의 청소는 보내지 않는다');
  });

  test('진행 중 예약이 있으면 다음 예약이 아니라 진행 중 예약', async () => {
    const db = fakeDb({ configs: { 파주201: REAL_CONFIG }, reservations: { 파주201: [NEXT, ACTIVE] } });
    const f = fakeFetch();
    await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.equal(f.calls[0].body.reservation.uid, 'active@airbnb');
  });

  test('지난 예약·취소 예약뿐이면 보내지 않는다 — 빈 예약은 워처 상태를 바꾸므로', async () => {
    const db = fakeDb({ configs: { 파주201: REAL_CONFIG }, reservations: { 파주201: [PAST, { ...NEXT, status: 'CANCELLED' }] } });
    const f = fakeFetch();
    const results = await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.equal(f.calls.length, 0);
    assert.match(results[0].result, /예약 없음/);
  });

  test('워처 하나가 숙소 둘을 맡으면 DB도 안 읽고 보내지 않는다', async () => {
    const db = fakeDb({ configs: { A: { property_id: 'A', name: 'A' }, B: { property_id: 'B', name: 'B' } }, reservations: { A: [NEXT], B: [NEXT] } });
    const f = fakeFetch();
    const lookup = async () => [
      { id: 'A', watcherId: 'watcher1', sourceUrl: 'https://watcher.test' },
      { id: 'B', watcherId: 'watcher1', sourceUrl: 'https://watcher.test' },
    ];
    const results = await pushCurrentReservationsToWatchers(db, { lookup, fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.equal(f.calls.length, 0);
    assert.equal(db.calls.length, 0);
    assert.match(results[0].result, /숙소 2개/);
  });

  test('워처가 둘이면 각자 자기 숙소 예약을 자기 주소로', async () => {
    const db = fakeDb({
      configs: { A: { property_id: 'A', name: 'A' }, B: { property_id: 'B', name: 'B' } },
      reservations: { A: [NEXT], B: [LATER] },
    });
    const f = fakeFetch();
    const lookup = async () => [
      { id: 'A', watcherId: 'w1', sourceUrl: 'https://a.test' },
      { id: 'B', watcherId: 'w2', sourceUrl: 'https://b.test' },
    ];
    await pushCurrentReservationsToWatchers(db, { lookup, fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    const byUrl = Object.fromEntries(f.calls.map(c => [c.url, c.body.reservation.uid]));
    assert.deepEqual(byUrl, {
      'https://a.test/api/monitoring/config': 'next@airbnb',
      'https://b.test/api/monitoring/config': 'later@airbnb',
    });
  });

  test('운영 DB의 실제 숙소가 아니면(설정 행 없음) 예약도 안 읽고 보내지 않는다', async () => {
    const db = fakeDb({ configs: {}, reservations: { 파주201: [NEXT] } });
    const f = fakeFetch();
    const results = await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.equal(f.calls.length, 0);
    assert.equal(db.calls.length, 1);
    assert.match(results[0].result, /실제 숙소가 아님/);
  });

  test('DEMO 프로필이면 워처 목록도 묻지 않는다', async () => {
    let looked = false;
    const f = fakeFetch();
    const results = await pushCurrentReservationsToWatchers(fakeDb(), {
      lookup: async () => { looked = true; return []; }, fetchImpl: f.impl, now: NOW, env: { PROPOS_DATA_PROFILE: 'demo' }, log: quiet,
    });
    assert.equal(looked, false);
    assert.equal(f.calls.length, 0);
    assert.match(results[0].result, /demo/);
  });

  test('워처 목록에 주소·id 가 없는 항목은 건너뛴다', async () => {
    const db = fakeDb({ configs: { 파주201: REAL_CONFIG }, reservations: { 파주201: [NEXT] } });
    const f = fakeFetch();
    const lookup = async () => [null, { id: '파주201' }, { sourceUrl: 'https://x.test' }, { id: '', sourceUrl: 'https://y.test' }];
    const results = await pushCurrentReservationsToWatchers(db, { lookup, fetchImpl: f.impl, now: NOW, env: {}, log: quiet });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(results.map(r => [r.sent, r.result]), [[false, '워처 숙소 목록 없음 — 보내지 않음']]);
  });

  test('워처 목록이 비면(워처 꺼짐·키 불일치로 조회기가 빈 목록) 결과가 남는다 — 조용히 아무것도 안 한 것처럼 보이지 않게', async () => {
    const results = await pushCurrentReservationsToWatchers(fakeDb(), { lookup: async () => [], fetchImpl: fakeFetch().impl, now: NOW, env: {}, log: quiet });
    assert.equal(results.length, 1);
    assert.equal(results[0].sent, false);
    assert.match(results[0].result, /목록 없음/);
  });

  test('워처마다 따로 보낸다 — 느린 워처가 다른 워처를 기다리게 하지 않는다', async () => {
    const db = fakeDb({ configs: { A: { property_id: 'A' }, B: { property_id: 'B' } }, reservations: { A: [NEXT], B: [NEXT] } });
    let releaseA;
    const started = [];
    const fetchImpl = async url => {
      started.push(url);
      if (url.startsWith('https://a.test')) await new Promise(r => { releaseA = r; });
      return { ok: true, status: 200 };
    };
    const lookup = async () => [{ id: 'A', sourceUrl: 'https://a.test' }, { id: 'B', sourceUrl: 'https://b.test' }];
    const done = pushCurrentReservationsToWatchers(db, { lookup, fetchImpl, now: NOW, env: {}, log: quiet });
    for (let i = 0; i < 20 && started.length < 2; i++) await new Promise(r => setImmediate(r));
    assert.equal(started.length, 2, 'A 가 끝나기 전에 B 도 시작해야 한다');
    releaseA();
    assert.deepEqual((await done).map(r => [r.propertyId, r.sent]), [['A', true], ['B', true]]);
  });

  test('실패해도 던지지 않는다 — 목록 조회 실패·전달 예외·워처 거절, 다른 워처는 계속', async () => {
    const r1 = await pushCurrentReservationsToWatchers(fakeDb(), { lookup: async () => { throw new Error('down'); }, fetchImpl: fakeFetch().impl, now: NOW, env: {}, log: quiet });
    assert.match(r1[0].result, /목록 조회 실패/);

    const db = fakeDb({
      configs: { A: { property_id: 'A', name: 'A' }, B: { property_id: 'B', name: 'B' }, C: { property_id: 'C', name: 'C' } },
      reservations: { A: [NEXT], B: [NEXT], C: [NEXT] },
    });
    const lookup = async () => [
      { id: 'A', sourceUrl: 'https://a.test' }, { id: 'B', sourceUrl: 'https://b.test' }, { id: 'C', sourceUrl: 'https://c.test' },
    ];
    const f = fakeFetch(url => {
      if (url.startsWith('https://a.test')) throw new Error('timeout');
      if (url.startsWith('https://b.test')) return { ok: false, status: 401 };
      return { ok: true, status: 200 };
    });
    const logs = [];
    const results = await pushCurrentReservationsToWatchers(db, { lookup, fetchImpl: f.impl, now: NOW, env: {}, log: m => logs.push(m) });
    assert.deepEqual(results.map(r => [r.propertyId, r.sent, r.result, r.httpStatus]), [
      ['A', false, '전달 실패', undefined], ['B', false, '워처가 거절', 401], ['C', true, '보냄', 200],
    ]);
    assert.equal(logs.length, 2);
  });

  test('DB 조회 실패도 그 숙소만 실패로 남긴다', async () => {
    const db = { async query() { throw new Error('db down'); } };
    const results = await pushCurrentReservationsToWatchers(db, { lookup: oneWatcher(), fetchImpl: fakeFetch().impl, now: NOW, env: {}, log: quiet });
    assert.equal(results[0].result, '전달 실패');
  });
});

// ═══ L2: 소스 계약 ═══
describe('L2 소스 계약 — 정기 작업 배선, 상태 경로 미사용, 대시보드와 같은 규칙', () => {
  const cron = read('api/cron/[...slug].js');
  const sync = read('server/watcherReservationSync.js');

  const blockOf = (label, startMarker, endMarker) => {
    const start = cron.indexOf(startMarker);
    assert.ok(start >= 0, `${label}: 시작 표식 없음`);
    const end = cron.indexOf(endMarker, start);
    assert.ok(end > start, `${label}: 끝 표식 없음`);
    return cron.slice(start, end);
  };

  test('아침 작업: iCal 동기화 뒤, 청소 계획 앞에서 예약을 보낸다(실패는 따로 잡음)', () => {
    const block = blockOf('morning', 'await syncAllPropertiesIcal(db, { kv }); ran.push("ical-sync")', 'await handleDailyPlan(db, nullRes)');
    assert.match(block, /try \{\s*const pushed = await pushCurrentReservationsToWatchers\(db\);\s*logWatcherReservationPush\("morning", pushed\);/);
    assert.match(block, /\}\s*\n\s*catch \(e\) \{ console\.error\("\[morning\] watcher-reservation 실패:"/);
  });

  test('아침 작업: 실제로 보낸 워처가 있을 때만 "했음" 목록에 적는다', () => {
    const block = blockOf('morning', 'const pushed = await pushCurrentReservationsToWatchers(db);', 'catch (e) { console.error("[morning] watcher-reservation');
    assert.match(block, /if \(pushed\.some\(r => r\.sent\)\) ran\.push\("watcher-reservation"\);/);
  });

  test('밤 작업: iCal 동기화 뒤, 청소 후속 처리 앞에서 예약을 보낸다(실패는 따로 잡음)', () => {
    const start = cron.indexOf('catch (e) { console.error("[evening] ical-sync 실패:"');
    assert.ok(start >= 0);
    const block = cron.slice(start, cron.indexOf('await handleCleaningFollowup(db, nullRes)', start));
    assert.match(block, /try \{ logWatcherReservationPush\("evening", await pushCurrentReservationsToWatchers\(db\)\); \}\s*\n\s*catch \(e\) \{ console\.error\("\[evening\] watcher-reservation 실패:"/);
  });

  test('로그에는 워처 주소를 남기지 않는다(숙소·결과·HTTP 상태만)', () => {
    const fn = cron.slice(cron.indexOf('function logWatcherReservationPush'), cron.indexOf('const WATCH_STALE_MS'));
    assert.match(fn, /r\.propertyId/);
    assert.doesNotMatch(fn, /watcherUrl/);
  });

  test('워처의 설정 경로만 부른다 — 상태(roomState)·이벤트 경로는 부르지 않는다', () => {
    assert.match(sync, /\/api\/monitoring\/config/);
    assert.doesNotMatch(sync, /\/api\/monitoring\/(state|event)/);
    assert.doesNotMatch(sync, /method: '(PUT|DELETE)'/);
  });

  test('대시보드와 동기화 서비스가 같은 도메인 함수를 쓴다', () => {
    const app = read('src/components/v2/RoomStateApp.jsx');
    assert.match(app, /reservation: toMonitoringReservation\(currentRes\)/);
    assert.match(app, /usableReservations\(Array\.isArray\(row\?\.reservations\)/);
    const svc = read('src/application/calendarSyncService.js');
    assert.match(svc, /const \{ active: activeRes, future: futureRes \} = splitReservationsAt\(reservations, now\);/);
    assert.match(sync, /toMonitoringReservation\(pickCurrentReservation\(usableReservations\(rows\), now\)\)/);
  });
});
