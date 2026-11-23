/**
 * S16 SuspicionTracker 단위 테스트
 * node --test tests/unit/s16.suspicion-tracker.test.js
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SuspicionTracker } from '../../src/application/suspicionTracker.js';

const MIN = 60_000;

const CFG = {
  CHECKOUT_GRACE_MS:        20 * MIN,
  EARLY_CHECKOUT_QUIET_MS:  20 * MIN,
  SUSPICION_EXPIRE_MS:     120 * MIN,
  CLEANING_SUSTAINED_MS:    20 * MIN,
  CLEANING_DONE_QUIET_MS:   10 * MIN,
  NO_SHOW_WINDOW_MS:        60 * MIN,
  NOISE_QUIET_DB:           40,
  AC_ON:                    50,
};

const OCCUPIED           = { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' };
const PRE_STAY_OPTIMIZED = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' };
const PRE_STAY_OPTIMIZING= { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' };
const CLEANING_PENDING   = { mainStatus: 'CLEANING',        subStatus: 'CLEANING_PENDING' };
const CLEANING_IN_PROG   = { mainStatus: 'CLEANING',        subStatus: 'CLEANING_IN_PROGRESS' };

function noSensor()       { return { exit: false, exitAt: null, entry: false, entryAt: null }; }
function withExit(at)     { return { exit: true,  exitAt: at,   entry: false, entryAt: null }; }
function withEntry(at)    { return { exit: false, exitAt: null,  entry: true,  entryAt: at  }; }

function evalTracker(tracker, sensorResult, roomState, reservation, motionNow, now,
                     { acPower = null, noiseLevel = null } = {}) {
  return tracker.evaluate({ sensorResult, roomState, reservation, motionNow, acPower, noiseLevel, now, cfg: CFG });
}

// ============================================================
// 예정 체크아웃 전환 (RF-29) — 옛 check_out_detected 대신 scheduled_checkout_reached
// ============================================================
const typesOf = events => events.map(e => e.type);
const CHECKOUT_TYPES = ['check_out_detected', 'scheduled_checkout_reached', 'late_checkout_detected'];
const checkoutEvents = events => events.filter(e => CHECKOUT_TYPES.includes(e.type));

describe('scheduled_checkout_reached', () => {
  test('Case 1: checkOut 경과 후 EXIT → 즉시 전환, 퇴실 지연 판정 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.deepEqual(typesOf(checkoutEvents(events)), ['scheduled_checkout_reached']);
    assert.equal(t.lateCheckoutWatch, null);
  });

  test('Case 2: checkOut 전 EXIT → 의심 기록, 이벤트 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    const events = evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.deepEqual(checkoutEvents(events), []);
    assert.ok(t.checkoutSuspectedAt !== null);
  });

  test('의심 상태 → checkOut 도래 + 모션 없음 → 전환, 퇴실 확인됨', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(30 * MIN) };
    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 31 * MIN);
    assert.deepEqual(typesOf(checkoutEvents(events)), ['scheduled_checkout_reached']);
    assert.equal(t.lateCheckoutWatch, null);
  });

  test('의심 상태 + 모션 있으면 → 예정 시각에 전환하되 퇴실은 미확인', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(30 * MIN) };
    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    const events = evalTracker(t, noSensor(), OCCUPIED, res, true, 31 * MIN);
    assert.deepEqual(typesOf(checkoutEvents(events)), ['scheduled_checkout_reached']);
    assert.notEqual(t.lateCheckoutWatch, null, '유예 시간 동안 실제 퇴실을 기다린다');
  });

  test('의심 상태 + ENTRY → 의심 취소', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    evalTracker(t, withEntry(10 * MIN), OCCUPIED, res, true, 10 * MIN);
    assert.equal(t.checkoutSuspectedAt, null);
  });

  test('예약 없으면 전환·퇴실 지연 모두 없음', () => {
    const t = new SuspicionTracker();
    const events = evalTracker(t, withExit(0), OCCUPIED, null, false, 60 * MIN);
    assert.deepEqual(checkoutEvents(events), []);
    assert.equal(t.lateCheckoutWatch, null);
  });

  test('OCCUPIED 아닌 상태에서는 예정 시각이 지나도 전환 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = evalTracker(t, withExit(0), PRE_STAY_OPTIMIZED, res, false, 5 * MIN);
    assert.deepEqual(checkoutEvents(events), []);
  });

  test('전환하면 퇴실 의심 기록이 지워진다', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(10 * MIN) };
    evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.notEqual(t.checkoutSuspectedAt, null);
    evalTracker(t, noSensor(), OCCUPIED, res, true, 10 * MIN + 121 * MIN);
    assert.equal(t.checkoutSuspectedAt, null);
  });
});

// ============================================================
// checkout_confirmation_needed
// ============================================================
describe('checkout_confirmation_needed', () => {
  test('체크아웃 경과 후 점유 징후 → 옛 late_checkout 확인 요청 대신 퇴실 지연 문제 1건 (RF-29)', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = [
      ...evalTracker(t, noSensor(), OCCUPIED, res, true, 1),
      ...evalTracker(t, noSensor(), CLEANING_PENDING, res, true, 21 * MIN, { acPower: 200 }),
      ...evalTracker(t, noSensor(), CLEANING_PENDING, res, true, 22 * MIN, { acPower: 200 }),
    ];
    assert.equal(events.filter(e => e.type === 'checkout_confirmation_needed').length, 0);
    assert.equal(events.filter(e => e.type === 'late_checkout_detected').length, 1);
  });

  test('Case B — EXIT 후 EARLY_CHECKOUT_QUIET 경과 + 방 비어있음 → early_checkout 발행', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    // EXIT 감지 (checkOut 아직 안 됨)
    evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    // 20분+1 후 조용한 방 (acPower null, noise null, no motion)
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 25 * MIN + 1);
    assert.ok(events.some(e => e.type === 'checkout_confirmation_needed' && e.subType === 'early_checkout'));
  });

  test('Case B — EXIT 없으면 early_checkout 발행 안됨', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    // EXIT 없이 방이 조용함
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 25 * MIN + 1);
    assert.equal(events.filter(e => e.type === 'checkout_confirmation_needed' && e.subType === 'early_checkout').length, 0);
  });
});

// ============================================================
// 입실 — 입실 시각에 체류로 바꾸고, 그 뒤 입실을 확인한다(DEC-10·16). 계약은 s141
// ============================================================

// ============================================================
// cleaning_started
// ============================================================
describe('cleaning_started', () => {
  test('CLEANING_PENDING + ENTRY + 모션 20분 지속 → cleaning_started', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withEntry(0), CLEANING_PENDING, null, true, 0);
    assert.ok(t.cleaningStartAt !== null);
    const events1 = evalTracker(t, noSensor(), CLEANING_PENDING, null, true, 19 * MIN);
    assert.equal(events1.filter(e => e.type === 'cleaning_started').length, 0);
    const events2 = evalTracker(t, noSensor(), CLEANING_PENDING, null, true, 20 * MIN + 1);
    assert.ok(events2.some(e => e.type === 'cleaning_started'));
  });

  test('CLEANING_PENDING + ENTRY + 짧은 체류 후 EXIT → 의심 취소', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withEntry(0), CLEANING_PENDING, null, true, 0);
    evalTracker(t, withExit(5 * MIN), CLEANING_PENDING, null, false, 5 * MIN);
    assert.equal(t.cleaningStartAt, null);
  });

  test('CLEANING_PENDING 아닌 상태 → cleaning_started 없음', () => {
    const t = new SuspicionTracker();
    const events = evalTracker(t, withEntry(0), CLEANING_IN_PROG, null, true, 0);
    assert.equal(events.filter(e => e.type === 'cleaning_started').length, 0);
  });
});

// ============================================================
// cleaning_finished
// ============================================================
describe('cleaning_finished', () => {
  test('CLEANING_IN_PROGRESS + EXIT + 10분 조용 → cleaning_finished', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    assert.ok(t.cleaningDoneAt !== null);
    const events1 = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, false, 9 * MIN);
    assert.equal(events1.filter(e => e.type === 'cleaning_finished').length, 0);
    const events2 = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, false, 10 * MIN + 1);
    assert.ok(events2.some(e => e.type === 'cleaning_finished'));
  });

  test('청소완료 의심 중 ENTRY → 의심 취소', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    evalTracker(t, withEntry(5 * MIN), CLEANING_IN_PROG, null, true, 5 * MIN);
    assert.equal(t.cleaningDoneAt, null);
  });

  test('모션 있는 동안 cleaning_finished 없음', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    const events = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, true, 15 * MIN);
    assert.equal(events.filter(e => e.type === 'cleaning_finished').length, 0);
  });

  test('CLEANING_IN_PROGRESS 아닌 상태 → cleaning_finished 없음', () => {
    const t = new SuspicionTracker();
    const events = evalTracker(t, withExit(0), CLEANING_PENDING, null, false, 15 * MIN);
    assert.equal(events.filter(e => e.type === 'cleaning_finished').length, 0);
  });
});
