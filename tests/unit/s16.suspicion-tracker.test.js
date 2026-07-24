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
// check_out_detected
// ============================================================
describe('check_out_detected', () => {
  test('Case 1: checkOut 경과 후 EXIT → 즉시 check_out_detected', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.ok(events.some(e => e.type === 'check_out_detected'));
  });

  test('Case 2: checkOut 전 EXIT → 의심 기록, 이벤트 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    const events = evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
    assert.ok(t.checkoutSuspectedAt !== null);
  });

  test('의심 상태 → checkOut 도래 → check_out_detected', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(30 * MIN) };
    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 31 * MIN);
    assert.ok(events.some(e => e.type === 'check_out_detected'));
  });

  test('의심 상태 + 모션 있으면 → check_out_detected 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(30 * MIN) };
    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    const events = evalTracker(t, noSensor(), OCCUPIED, res, true, 31 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('의심 상태 + ENTRY → 의심 취소', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(60 * MIN) };
    evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    evalTracker(t, withEntry(10 * MIN), OCCUPIED, res, true, 10 * MIN);
    assert.equal(t.checkoutSuspectedAt, null);
  });

  test('예약 없으면 check_out_detected 없음', () => {
    const t = new SuspicionTracker();
    const events = evalTracker(t, withExit(0), OCCUPIED, null, false, 60 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('OCCUPIED 아닌 상태에서 EXIT → 퇴실 이벤트 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = evalTracker(t, withExit(0), PRE_STAY_OPTIMIZED, res, false, 5 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('의심 만료: checkOut + 120분 경과 → 의심 자동 취소', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(10 * MIN) };
    evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    evalTracker(t, noSensor(), OCCUPIED, res, true, 10 * MIN + 121 * MIN);
    assert.equal(t.checkoutSuspectedAt, null);
  });
});

// ============================================================
// checkout_confirmation_needed
// ============================================================
describe('checkout_confirmation_needed', () => {
  test('Case A — checkOut + GRACE 경과 + 모션 있음 → late_checkout 발행', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    // now = checkOut + 21분 (GRACE 20분 초과), 모션 있음
    const events = evalTracker(t, noSensor(), OCCUPIED, res, true, 21 * MIN);
    assert.ok(events.some(e => e.type === 'checkout_confirmation_needed' && e.subType === 'late_checkout'));
  });

  test('Case A — AC 가동 중 → late_checkout 발행', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 21 * MIN, { acPower: 200 });
    assert.ok(events.some(e => e.type === 'checkout_confirmation_needed' && e.subType === 'late_checkout'));
  });

  test('Case A — 점유 징후 없으면 발행 안됨', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    // 모션/AC/소음 모두 없음
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 21 * MIN, { acPower: 10, noiseLevel: 30 });
    assert.equal(events.filter(e => e.type === 'checkout_confirmation_needed').length, 0);
  });

  test('Case A — 중복 발행 방지 (caseAFiredAt)', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(0) };
    evalTracker(t, noSensor(), OCCUPIED, res, true, 21 * MIN);
    // 두 번째 poll
    const events = evalTracker(t, noSensor(), OCCUPIED, res, true, 22 * MIN);
    assert.equal(events.filter(e => e.type === 'checkout_confirmation_needed').length, 0);
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
// check_in_detected
// ============================================================
describe('check_in_detected', () => {
  test('ENTRY + checkIn 시각 이후 → 즉시 check_in_detected', () => {
    const t = new SuspicionTracker();
    const res = { checkIn: new Date(0), checkOut: new Date(2 * 60 * MIN) };
    const events = evalTracker(t, withEntry(MIN), PRE_STAY_OPTIMIZED, res, true, MIN);
    assert.ok(events.some(e => e.type === 'check_in_detected'));
  });

  test('ENTRY + checkIn 정보 없음 → 즉시 check_in_detected', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(2 * 60 * MIN) };
    const events = evalTracker(t, withEntry(MIN), PRE_STAY_OPTIMIZED, res, true, MIN);
    assert.ok(events.some(e => e.type === 'check_in_detected'));
  });

  test('ENTRY 없으면 check_in_detected 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkIn: new Date(0), checkOut: new Date(60 * MIN) };
    const events = evalTracker(t, noSensor(), PRE_STAY_OPTIMIZED, res, false, MIN);
    assert.equal(events.filter(e => e.type === 'check_in_detected').length, 0);
  });

  test('OCCUPIED 상태에서 ENTRY → check_in_detected 없음', () => {
    const t = new SuspicionTracker();
    const res = { checkIn: new Date(0), checkOut: new Date(60 * MIN) };
    const events = evalTracker(t, withEntry(0), OCCUPIED, res, true, 5 * MIN);
    assert.equal(events.filter(e => e.type === 'check_in_detected').length, 0);
  });
});

// ============================================================
// early_checkin_suspected
// ============================================================
describe('early_checkin_suspected', () => {
  test('OPTIMIZED + ENTRY + checkIn 이전 → early_checkin_suspected 발행', () => {
    const t = new SuspicionTracker();
    const res = { checkIn: new Date(60 * MIN), checkOut: new Date(3 * 60 * MIN) };
    const events = evalTracker(t, withEntry(4 * MIN), PRE_STAY_OPTIMIZED, res, true, 5 * MIN);
    assert.ok(events.some(e => e.type === 'early_checkin_suspected'), 'early_checkin_suspected 발행');
    assert.equal(events.filter(e => e.type === 'check_in_detected').length, 0, 'check_in_detected 없음');
    assert.ok(t.checkinSuspectedAt !== null);
  });

  test('OPTIMIZING + ENTRY + checkIn 이전 → early_checkin_suspected 발행', () => {
    const t = new SuspicionTracker();
    const res = { checkIn: new Date(60 * MIN), checkOut: new Date(3 * 60 * MIN) };
    const events = evalTracker(t, withEntry(4 * MIN), PRE_STAY_OPTIMIZING, res, true, 5 * MIN);
    assert.ok(events.some(e => e.type === 'early_checkin_suspected'));
  });

  test('조기 체크인 후 checkIn 시각 도래 → check_in_detected 발화 (bug fix)', () => {
    const t = new SuspicionTracker();
    const checkInMs = 60 * MIN;
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(3 * 60 * MIN) };

    // t=5min: 조기 ENTRY → early_checkin_suspected
    evalTracker(t, withEntry(4 * MIN), PRE_STAY_OPTIMIZED, res, true, 5 * MIN);
    assert.ok(t.checkinSuspectedAt !== null);

    // t=61min: checkIn 도래, entry=false (재발화 없음) → check_in_detected 발화
    const events = evalTracker(t, noSensor(), PRE_STAY_OPTIMIZED, res, true, 61 * MIN);
    assert.ok(events.some(e => e.type === 'check_in_detected'), 'checkIn 도래 후 check_in_detected 발화');
    assert.equal(t.checkinSuspectedAt, null);
  });
});

// ============================================================
// no_show_suspected
// ============================================================
describe('no_show_suspected', () => {
  test('checkIn 당일 자정 경과 + ENTRY 없음 → no_show_suspected (게스트+호스트)', () => {
    const t = new SuspicionTracker();
    // checkIn = 2000-01-01 15:00, 자정 = 2000-01-02 00:00
    const checkInMs  = new Date(2000, 0, 1, 15, 0, 0).getTime();
    const midnightMs = new Date(2000, 0, 2, 0,  0, 0).getTime();
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(checkInMs + 25 * 60 * MIN) };

    const events = evalTracker(t, noSensor(), PRE_STAY_OPTIMIZED, res, false, midnightMs + 1);
    assert.ok(events.some(e => e.type === 'no_show_suspected'), 'no_show_suspected 발행');
    const ev = events.find(e => e.type === 'no_show_suspected');
    assert.ok(ev.recipients.includes('guest'), 'guest 포함');
    assert.ok(ev.recipients.includes('host'),  'host 포함');
  });

  test('조기 체크인 의심 있으면 no_show 발행 안됨', () => {
    const t = new SuspicionTracker();
    const checkInMs  = new Date(2000, 0, 1, 15, 0, 0).getTime();
    const midnightMs = new Date(2000, 0, 2, 0,  0, 0).getTime();
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(checkInMs + 25 * 60 * MIN) };

    // 게스트가 먼저 도착 (early checkin)
    evalTracker(t, withEntry(checkInMs - 30 * MIN), PRE_STAY_OPTIMIZED, res, true, checkInMs - 30 * MIN);
    assert.ok(t.checkinSuspectedAt !== null);

    const events = evalTracker(t, noSensor(), PRE_STAY_OPTIMIZED, res, false, midnightMs + 1);
    assert.equal(events.filter(e => e.type === 'no_show_suspected').length, 0, '조기 도착 시 no_show 억제');
  });

  test('자정 이전 → no_show 발행 안됨', () => {
    const t = new SuspicionTracker();
    const checkInMs  = new Date(2000, 0, 1, 15, 0, 0).getTime();
    const midnightMs = new Date(2000, 0, 2, 0,  0, 0).getTime();
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(checkInMs + 25 * 60 * MIN) };

    const events = evalTracker(t, noSensor(), PRE_STAY_OPTIMIZED, res, false, midnightMs - 1);
    assert.equal(events.filter(e => e.type === 'no_show_suspected').length, 0);
  });
});

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
