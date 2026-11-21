/**
 * RF-29 — 객실 상태는 예약 체크아웃 시각을 기준으로 청소 대기로 넘어간다(DEC-08).
 * 실제 퇴실(EXIT)이 유예 시간(CHECKOUT_GRACE_MS) 안에 확인되지 않은 예약은 퇴실 지연 문제를 한 번만 남긴다.
 * 배경: 파주201 Pi가 11-15 퇴실 뒤에도 체류 중으로 멈춰 다음 입실 감지까지 막혔다.
 */
import { TEST_DATA_DIR } from '../helpers/isolateDataDir.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SuspicionTracker } from '../../src/application/suspicionTracker.js';
import { PreStayOptimizationController } from '../../src/application/preStayOptimizationController.js';
import { getNextRoomState } from '../../src/domain/room-state/roomStateDomain.js';
import { countPeriodEvents } from '../../src/domain/reportingDomain.js';
import { detectPostCheckoutFailures } from '../../src/domain/metricDrilldownDomain.js';
import { planMonitoringReservationUpdate } from '../../src/domain/monitoringReservationDomain.js';
import { buildIssueItems } from '../../src/domain/monthlyCalendarDomain.js';

const MIN = 60_000;
const OCCUPIED = { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };
const CLEANING = { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' };
const CFG = {
  CHECKOUT_GRACE_MS: 20 * MIN,
  EARLY_CHECKOUT_QUIET_MS: 20 * MIN,
  SUSPICION_EXPIRE_MS: 120 * MIN,
  CLEANING_SUSTAINED_MS: 20 * MIN,
  CLEANING_DONE_QUIET_MS: 10 * MIN,
  NO_SHOW_WINDOW_MS: 60 * MIN,
  NOISE_QUIET_DB: 40,
  AC_ON: 50,
};

const noSensor = () => ({ exit: false, exitAt: null, entry: false, entryAt: null });
const exitAt = at => ({ exit: true, exitAt: at, entry: false, entryAt: null });
const entryAt = at => ({ exit: false, exitAt: null, entry: true, entryAt: at });
const reservation = (uid = 'stay-1') => ({ uid, checkIn: new Date(-60 * MIN), checkOut: new Date(0) });
const types = events => events.map(event => event.type);

function evaluate(tracker, { sensorResult = noSensor(), roomState = OCCUPIED, res = reservation(), motionNow = false, now = 0 } = {}) {
  return tracker.evaluate({ sensorResult, roomState, reservation: res, motionNow, acPower: null, noiseLevel: null, now, cfg: CFG });
}

describe('RF-29 체크아웃 시각 기준 전환과 퇴실 지연', () => {
  test('퇴실 확인이 없으면 예정 시각에 전환하고, 유예 시간이 지나야 퇴실 지연을 한 번 낸다', () => {
    const tracker = new SuspicionTracker();
    const first = evaluate(tracker, { now: 1 });
    assert.deepEqual(types(first), ['scheduled_checkout_reached'], '전환은 퇴실 확인을 기다리지 않는다');
    assert.equal(first[0].timestamp, 0, '예약 체크아웃 시각이 상태 전환 시각이다');
    assert.equal(first[0].data.reservationUid, 'stay-1');

    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 20 * MIN - 1 }), [], '유예 시간 중에는 판정하지 않는다');
    const late = evaluate(tracker, { roomState: CLEANING, now: 20 * MIN });
    assert.deepEqual(types(late), ['late_checkout_detected']);
    assert.equal(late[0].timestamp, 0, '예약 체크아웃 시각이 문제 발생 시각이다');
    assert.equal(late[0].data.reservationUid, 'stay-1');

    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 30 * MIN }), [], '같은 예약의 지연을 반복 생성하지 않는다');
    assert.deepEqual(evaluate(tracker, { now: 31 * MIN }), [], '상태가 체류로 남아 있어도 같은 예약은 다시 전환하지 않는다');
  });

  test('정시에 나가 EXIT 확정이 예정 시각 뒤에 와도(유예 안) 퇴실 지연이 아니다', () => {
    const tracker = new SuspicionTracker();
    assert.deepEqual(types(evaluate(tracker, { now: 1 })), ['scheduled_checkout_reached']);
    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, sensorResult: exitAt(-MIN), now: 4 * MIN }), []);
    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 25 * MIN }), []);
  });

  test('체크아웃 전 EXIT 뒤 재입실·모션이 없으면 예정 시각에 상태만 전환한다', () => {
    const tracker = new SuspicionTracker();
    evaluate(tracker, { sensorResult: exitAt(-10 * MIN), now: -10 * MIN });
    assert.deepEqual(types(evaluate(tracker, { now: 1 })), ['scheduled_checkout_reached']);
    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 25 * MIN }), []);
  });

  test('체크아웃 전 EXIT 뒤 다시 들어오면 퇴실 지연 문제로 본다', () => {
    const tracker = new SuspicionTracker();
    evaluate(tracker, { sensorResult: exitAt(-10 * MIN), now: -10 * MIN });
    evaluate(tracker, { sensorResult: entryAt(-5 * MIN), motionNow: true, now: -5 * MIN });
    assert.deepEqual(types(evaluate(tracker, { motionNow: true, now: 1 })), ['scheduled_checkout_reached']);
    assert.deepEqual(types(evaluate(tracker, { roomState: CLEANING, motionNow: true, now: 20 * MIN })), ['late_checkout_detected']);
  });

  test('예정 시각 직후 다시 들어온 관측(ENTRY)은 앞선 퇴실 의심을 지운다', () => {
    const tracker = new SuspicionTracker();
    evaluate(tracker, { sensorResult: exitAt(-10 * MIN), now: -10 * MIN });
    assert.deepEqual(types(evaluate(tracker, { sensorResult: entryAt(0), now: 1 })), ['scheduled_checkout_reached']);
    assert.deepEqual(types(evaluate(tracker, { roomState: CLEANING, now: 20 * MIN })), ['late_checkout_detected']);
  });

  test('체크아웃 시각 이후 같은 관측에서 EXIT가 확인되면 지연 문제 없이 상태만 전환한다', () => {
    const tracker = new SuspicionTracker();
    assert.deepEqual(types(evaluate(tracker, { sensorResult: exitAt(1), now: 1 })), ['scheduled_checkout_reached']);
    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 25 * MIN }), []);
  });

  test('유예 시간이 지난 뒤 처음 판정하면(워처가 꺼져 있었음) 전환만 하고 퇴실 지연은 판정하지 않는다', () => {
    const tracker = new SuspicionTracker();
    const events = evaluate(tracker, { now: 3 * 60 * MIN });
    assert.deepEqual(types(events), ['scheduled_checkout_reached']);
    assert.equal(events[0].timestamp, 0);
    assert.deepEqual(evaluate(tracker, { roomState: CLEANING, now: 4 * 60 * MIN }), []);
  });

  test('같은 예약이라도 퇴실 시각이 바뀌면(연장) 새 시각에 다시 전환한다', () => {
    const tracker = new SuspicionTracker();
    evaluate(tracker, { sensorResult: exitAt(1), now: 1 });
    const extended = { uid: 'stay-1', checkIn: new Date(-60 * MIN), checkOut: new Date(3 * 60 * MIN) };
    assert.deepEqual(evaluate(tracker, { res: extended, now: 60 * MIN }), [], '새 퇴실 시각 전');
    const events = evaluate(tracker, { res: extended, now: 3 * 60 * MIN + 1 });
    assert.deepEqual(types(events), ['scheduled_checkout_reached']);
    assert.equal(events[0].timestamp, 3 * 60 * MIN);
  });

  test('유예 중에 같은 예약의 퇴실 시각이 뒤로 바뀌면(연장이 늦게 도착) 퇴실 지연이 아니다', () => {
    const tracker = new SuspicionTracker();
    evaluate(tracker, { now: 1 });
    const extended = { uid: 'stay-1', checkIn: new Date(-60 * MIN), checkOut: new Date(2 * 60 * MIN) };
    assert.deepEqual(evaluate(tracker, { res: extended, roomState: CLEANING, now: 10 * MIN }), []);
    assert.deepEqual(evaluate(tracker, { res: extended, roomState: CLEANING, now: 25 * MIN }), []);
    // 다른 예약이 들어온 것은 연장이 아니다
    const other = new SuspicionTracker();
    evaluate(other, { now: 1 });
    const next = { uid: 'stay-2', checkIn: new Date(3 * 60 * MIN), checkOut: new Date(26 * 60 * MIN) };
    assert.deepEqual(types(evaluate(other, { res: next, roomState: CLEANING, now: 20 * MIN })), ['late_checkout_detected']);
  });

  test('들고 있는 예약의 입실이 아직 미래인 체류는 바로잡지 않는다 (체류 중 재시작 무영향, s103)', () => {
    const tracker = new SuspicionTracker();
    const future = { uid: 'stay-2', checkIn: new Date(20 * MIN), checkOut: new Date(48 * 60 * MIN) };
    assert.deepEqual(evaluate(tracker, { res: future, motionNow: true, now: 0 }), []);
    assert.deepEqual(evaluate(tracker, { res: future, now: 10 * MIN }), []);
  });
});

describe('RF-29 예약 교체 보존', () => {
  const current = { uid: 'stay-1', checkIn: new Date(-2 * 60 * MIN).toISOString(), checkOut: new Date(0).toISOString() };
  const next = { uid: 'stay-2', checkIn: new Date(3 * 60 * MIN).toISOString(), checkOut: new Date(5 * 60 * MIN).toISOString() };

  test('체류 상태에서 지난 예약 대신 다음 예약이 오면 전환이 끝날 때까지 지난 예약을 보존한다', () => {
    assert.deepEqual(planMonitoringReservationUpdate(current, next, OCCUPIED, new Date(MIN)), {
      reservation: current, pendingReservation: next, deferred: true, keepPending: false,
    });
  });

  test('보존 중에 지금 예약과 같은 예약이 다시 와도 대기 중인 다음 예약을 지우지 않는다', () => {
    assert.equal(planMonitoringReservationUpdate(current, { ...current }, OCCUPIED, new Date(MIN)).keepPending, true);
    assert.equal(planMonitoringReservationUpdate(current, next, CLEANING, new Date(MIN)).keepPending, false);
  });

  test('퇴실 시각이 지나 "예약 없음"(null)이 와도 지난 예약을 보존하고 null을 대기시킨다', () => {
    assert.deepEqual(planMonitoringReservationUpdate(current, null, OCCUPIED, new Date(MIN)), {
      reservation: current, pendingReservation: null, deferred: true, keepPending: false,
    });
  });

  test('보존하지 않는 경우: 청소 대기 상태, 퇴실 전, 같은 예약 갱신, 다음 손님 입실 시각도 지난 예약', () => {
    const plain = incoming => ({ reservation: incoming, pendingReservation: null, deferred: false, keepPending: incoming?.uid === current.uid });
    assert.deepEqual(planMonitoringReservationUpdate(current, next, CLEANING, new Date(MIN)), plain(next));
    assert.deepEqual(planMonitoringReservationUpdate(current, next, OCCUPIED, new Date(-MIN)), plain(next));
    const extended = { ...current, checkOut: new Date(60 * MIN).toISOString() };
    assert.deepEqual(planMonitoringReservationUpdate(current, extended, OCCUPIED, new Date(MIN)), plain(extended));
    const noCheckIn = { uid: 'stay-3', checkIn: null, checkOut: new Date(5 * 60 * MIN).toISOString() };
    assert.equal(planMonitoringReservationUpdate(current, noCheckIn, OCCUPIED, new Date(MIN)).deferred, true, '입실 시각을 읽을 수 없는 다른 예약도 보존 쪽');
    const nextAlreadyStarted = { ...next, checkIn: new Date(30 * MIN).toISOString() };
    assert.deepEqual(planMonitoringReservationUpdate(current, nextAlreadyStarted, OCCUPIED, new Date(60 * MIN)), plain(nextAlreadyStarted));
    assert.deepEqual(planMonitoringReservationUpdate(null, next, OCCUPIED, new Date(MIN)), plain(next));
    const noCheckOut = { uid: 'stay-1', checkIn: current.checkIn, checkOut: null };
    assert.equal(planMonitoringReservationUpdate(noCheckOut, next, OCCUPIED, new Date(MIN)).deferred, false, '퇴실 시각이 빈 예약은 "퇴실이 지났다"로 보지 않는다');
  });
});

describe('RF-29 새 이벤트를 따라가는 곳', () => {
  test('퇴실 지연은 체크아웃 1건이면서 문제·이상 1건으로 집계한다', () => {
    const stats = countPeriodEvents([{ type: 'scheduled_checkout_reached' }, { type: 'late_checkout_detected' }]);
    assert.equal(stats.checkOuts, 1);
    assert.equal(stats.anomalies, 1);
    assert.equal(stats.lateCheckouts, 1);
  });

  test('달력 문제 목록에 청소 문제 "퇴실 지연"으로 한 건 보인다 (상태 전환 자체는 문제가 아니다)', () => {
    const items = buildIssueItems([
      { property_id: 'P', type: 'scheduled_checkout_reached', device_time: '2026-11-21T02:00:00.000Z' },
      { property_id: 'P', type: 'late_checkout_detected', device_time: '2026-11-21T02:00:00.000Z', data: { reservationUid: 'stay-1' } },
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'late_checkout_detected');
    assert.equal(items[0].category, 'CLEANING');
    assert.equal(items[0].label, '퇴실 지연');
  });

  test('퇴실 후 위반의 기준 시각은 예정 시각 전환도 쓴다', () => {
    const [row] = detectPostCheckoutFailures([
      { property_id: 'P', type: 'scheduled_checkout_reached', device_time: '2026-11-21T02:00:00.000Z' },
      { property_id: 'P', type: 'post_checkout_energy_waste_detected', device_time: '2026-11-21T02:12:00.000Z' },
    ], 'post_checkout_energy_waste_detected');
    assert.equal(row.detail.anchor_at, '2026-11-21T02:00:00.000Z');
  });

  test('예정 시각 전환은 진행 중인 입실 준비를 취소한다', async () => {
    const controller = new PreStayOptimizationController({
      callService: async () => {}, getStates: async () => ({}), emit: async () => {}, save: () => true,
    });
    controller.restore({ run: { id: 'run-1', status: 'PREPARING', controlled: [], pendingOff: [], readings: [] } });
    await controller.onLifecycleEvent('scheduled_checkout_reached', { config: {}, now: 0 });
    assert.equal(controller.snapshot().run.status, 'CANCELLED');
  });
});

// ── 워처 전체 실행 — 외부 호출은 모두 가로챈다 ─────────────────────────────────
process.env.PROPOS_HA_BASE_URL = 'http://ha.test';
process.env.PROPOS_HA_WS_URL = 'ws://ha.test/api/websocket';
process.env.PROPOS_HA_TOKEN = 'fixture-token';
process.env.PROPOS_PI_SECRET = 'fixture-key';

let sequence = 0;
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), 'Expected watcher condition within 500ms');
}
async function watcherFixture() {
  const previousFetch = global.fetch, previousWs = global.WebSocket, previousDir = process.env.PROPOS_DATA_DIR;
  const folder = mkdtempSync(join(TEST_DATA_DIR, 'rf29-'));
  process.env.PROPOS_DATA_DIR = folder;
  global.WebSocket = class { static OPEN = 1; readyState = 1; addEventListener() {} close() {} };
  global.fetch = async (url) => {
    // 전송은 실패로 돌려 대기열에 남긴다 — 무엇을 보내려 했는지 대기열에서 확인한다
    if (String(url).endsWith('/api/events/write')) return { ok: false, status: 503, json: async () => ({}) };
    assert.ok(String(url).startsWith('http://ha.test/'), 'Tests must never call external services');
    return { ok: true, text: async () => '[]', json: async () => ({}) };
  };
  const watcher = await import(`../../server/occupancyWatcher.js?rf29=${++sequence}`);
  return {
    watcher,
    config: () => JSON.parse(readFileSync(join(folder, 'monitoring-config.json'), 'utf8')),
    outbox: () => JSON.parse(readFileSync(join(folder, 'monitoring-state.json'), 'utf8')).preparationOutbox,
    cleanup() { watcher.stopWatcher(); global.fetch = previousFetch; global.WebSocket = previousWs; process.env.PROPOS_DATA_DIR = previousDir; },
  };
}
const stay = (uid, checkInMs, checkOutMs) => ({ uid, checkIn: new Date(checkInMs).toISOString(), checkOut: new Date(checkOutMs).toISOString() });

describe('RF-29 워처 — 체류 중 멈춤 재현', () => {
  const ofCheckout = events => events.filter(event => ['scheduled_checkout_reached', 'late_checkout_detected'].includes(event.type));

  test('퇴실 시각이 지난 체류 중에 다음 예약이 먼저 와도 청소 대기로 넘어가고, 유예 뒤 퇴실 지연을 문제로 보낸다', async () => {
    const f = await watcherFixture();
    const realNow = Date.now;
    try {
      const checkOutMs = Date.now() - 2 * MIN;
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf29', reservation: stay('stay-1', checkOutMs - 24 * 60 * MIN, checkOutMs) });
      f.watcher.setMonitoringConfig({ reservation: stay('stay-2', Date.now() + 60 * MIN, Date.now() + 25 * 60 * MIN) });
      f.watcher.setMonitoringConfig({ reservation: stay('stay-1', checkOutMs - 24 * 60 * MIN, checkOutMs) }); // 늦게 온 같은 예약
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'CLEANING');
      await until(() => f.config().reservation?.uid === 'stay-2');
      assert.equal(Object.hasOwn(f.config(), 'pendingReservation'), false);
      assert.deepEqual(ofCheckout(f.outbox()).map(event => event.type), ['scheduled_checkout_reached'], '유예 중에는 지연 없음');

      // 유예 20분이 지난 판정 — 실제 퇴실은 끝내 확인되지 않음
      Date.now = () => realNow() + 21 * MIN;
      f.watcher.setMonitoringConfig({});
      await until(() => ofCheckout(f.outbox()).length === 2);
      const sent = ofCheckout(f.outbox());
      assert.deepEqual(sent.map(event => event.type), ['scheduled_checkout_reached', 'late_checkout_detected']);
      for (const event of sent) {
        assert.equal(event.device_time, checkOutMs, '발생 시각 = 예정 체크아웃');
        assert.equal(event.is_soft, false);
        assert.equal(event.property_id, 'fixture-rf29');
        assert.equal(event.data.reservationUid, 'stay-1');
      }
      const state = f.watcher.getMonitoringState();
      assert.deepEqual(state.roomState, CLEANING, '퇴실 지연은 상태를 바꾸지 않는다');
      assert.equal(state.eventLog.at(-1).type, 'scheduled_checkout_reached', '화면의 마지막 전환은 실제 전환');
      assert.equal(state.softEventLog.at(-1).type, 'late_checkout_detected');
    } finally { Date.now = realNow; f.cleanup(); }
  });

  test('퇴실 시각 직후 "예약 없음"이 먼저 와도 청소 대기로 넘어간다', async () => {
    const f = await watcherFixture();
    try {
      const checkOutMs = Date.now() - 2 * MIN;
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf29', reservation: stay('stay-1', checkOutMs - 24 * 60 * MIN, checkOutMs) });
      f.watcher.setMonitoringConfig({ reservation: null });
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'CLEANING');
      await until(() => f.config().reservation === null);
      assert.equal(Object.hasOwn(f.config(), 'pendingReservation'), false);
      assert.deepEqual(ofCheckout(f.outbox()).map(event => event.type), ['scheduled_checkout_reached']);
    } finally { f.cleanup(); }
  });

  test('꺼져 있다 켜진 워처는 유예가 지난 퇴실을 전환만 하고 퇴실 지연으로 적지 않는다', async () => {
    const f = await watcherFixture();
    try {
      const checkOutMs = Date.now() - 3 * 60 * MIN;
      f.watcher.setRoomState(OCCUPIED);
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf29', reservation: stay('stay-1', checkOutMs - 24 * 60 * MIN, checkOutMs) });
      await until(() => f.watcher.getMonitoringState().roomState.mainStatus === 'CLEANING');
      assert.deepEqual(ofCheckout(f.outbox()).map(event => event.type), ['scheduled_checkout_reached']);
    } finally { f.cleanup(); }
  });

  test('운영자가 손으로 상태를 바꿔도 대기 중인 다음 예약을 쓴다', async () => {
    const f = await watcherFixture();
    try {
      f.watcher.setRoomState(OCCUPIED);
      // 예정 시각이 이미 지난 예약 — 판정 전에 다음 예약으로 바꾸고, 손으로 청소 대기로 옮긴다
      f.watcher.setMonitoringConfig({ areaName: 'fixture-rf29', reservation: stay('stay-1', Date.now() - 25 * 60 * MIN, Date.now() - MIN) });
      f.watcher.setMonitoringConfig({ reservation: stay('stay-2', Date.now() + 60 * MIN, Date.now() + 25 * 60 * MIN) });
      assert.equal(f.config().pendingReservation?.uid, 'stay-2');
      f.watcher.setRoomState(CLEANING);
      assert.equal(f.config().reservation?.uid, 'stay-2');
      assert.equal(Object.hasOwn(f.config(), 'pendingReservation'), false);
    } finally { f.cleanup(); }
  });
});
