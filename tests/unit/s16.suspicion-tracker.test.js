/**
 * S16 SuspicionTracker 단위 테스트
 * node --test tests/unit/s16.suspicion-tracker.test.js
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SuspicionTracker } from '../../src/application/suspicionTracker.js';

const MIN = 60_000;

const CFG = {
  CHECKOUT_GRACE_MS:      20 * MIN,
  SUSPICION_EXPIRE_MS:   120 * MIN,
  CLEANING_SUSTAINED_MS:  20 * MIN,
  CLEANING_DONE_QUIET_MS: 10 * MIN,
  NO_SHOW_WINDOW_MS:      60 * MIN,
};

const OCCUPIED           = { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' };
const PRE_STAY_OPTIMIZED = { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' };
const CLEANING_PENDING   = { mainStatus: 'CLEANING',        subStatus: 'CLEANING_PENDING' };
const CLEANING_IN_PROG   = { mainStatus: 'CLEANING',        subStatus: 'CLEANING_IN_PROGRESS' };

function noSensor() { return { exit: false, exitAt: null, entry: false, entryAt: null }; }
function withExit(at)  { return { exit: true,  exitAt: at,   entry: false, entryAt: null }; }
function withEntry(at) { return { exit: false, exitAt: null,  entry: true,  entryAt: at  }; }

function evalTracker(tracker, sensorResult, roomState, reservation, motionNow, now) {
  return tracker.evaluate({ sensorResult, roomState, reservation, motionNow, now, cfg: CFG });
}

// ============================================================
// check_out_detected
// ============================================================
describe('check_out_detected', () => {
  test('Case 1: checkOut 경과 후 EXIT → 즉시 check_out_detected', () => {
    const t = new SuspicionTracker();
    const checkOutMs = 0;
    const res = { checkOut: new Date(checkOutMs) };

    // now=5min (checkOut 이미 지남), EXIT 감지
    const events = evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.ok(events.some(e => e.type === 'check_out_detected'), 'check_out_detected 있어야 함');
  });

  test('Case 2: checkOut 전 EXIT → 의심 기록, 이벤트 없음', () => {
    const t = new SuspicionTracker();
    const checkOutMs = 60 * MIN; // 1시간 후
    const res = { checkOut: new Date(checkOutMs) };

    const events = evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0, '즉시 확신 없어야 함');
    assert.ok(t.checkoutSuspectedAt !== null, '의심 상태 기록됨');
  });

  test('의심 상태 → checkOut 도래 → check_out_detected', () => {
    const t = new SuspicionTracker();
    const checkOutMs = 30 * MIN;
    const res = { checkOut: new Date(checkOutMs) };

    // t=10min: EXIT → 의심 기록
    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    assert.ok(t.checkoutSuspectedAt !== null);

    // t=31min: checkOut(30min) 도래, 모션 없음 → check_out_detected
    const events = evalTracker(t, noSensor(), OCCUPIED, res, false, 31 * MIN);
    assert.ok(events.some(e => e.type === 'check_out_detected'));
  });

  test('의심 상태 + 모션 있으면 → check_out_detected 없음', () => {
    const t = new SuspicionTracker();
    const checkOutMs = 30 * MIN;
    const res = { checkOut: new Date(checkOutMs) };

    evalTracker(t, withExit(9 * MIN), OCCUPIED, res, false, 10 * MIN);
    // checkOut 도래했지만 모션 있음
    const events = evalTracker(t, noSensor(), OCCUPIED, res, true, 31 * MIN);
    assert.equal(events.filter(e => e.type === 'check_out_detected').length, 0);
  });

  test('의심 상태 + ENTRY → 의심 취소 (돌아옴)', () => {
    const t = new SuspicionTracker();
    const checkOutMs = 60 * MIN;
    const res = { checkOut: new Date(checkOutMs) };

    evalTracker(t, withExit(5 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.ok(t.checkoutSuspectedAt !== null);

    // ENTRY 감지 → 취소
    evalTracker(t, withEntry(10 * MIN), OCCUPIED, res, true, 10 * MIN);
    assert.equal(t.checkoutSuspectedAt, null, '의심 취소됨');
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
    const checkOutMs = 10 * MIN;
    const res = { checkOut: new Date(checkOutMs) };

    // t=5min: EXIT 의심
    evalTracker(t, withExit(4 * MIN), OCCUPIED, res, false, 5 * MIN);
    assert.ok(t.checkoutSuspectedAt !== null);

    // t=checkOut + 121min → 만료 (하지만 checkOut도 지났고 motionNow=true, 확신 못함)
    // 만료 조건: 의심중 + checkOut + EXPIRE 초과
    evalTracker(t, noSensor(), OCCUPIED, res, true, checkOutMs + 121 * MIN);
    assert.equal(t.checkoutSuspectedAt, null, '의심 만료 취소됨');
  });
});

// ============================================================
// check_in_detected
// ============================================================
describe('check_in_detected', () => {
  test('ENTRY + checkIn 시각 이후 → 즉시 check_in_detected', () => {
    const t = new SuspicionTracker();
    const checkInMs  = 0;
    const checkOutMs = 2 * 60 * MIN;
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(checkOutMs) };

    const events = evalTracker(t, withEntry(MIN), PRE_STAY_OPTIMIZED, res, true, MIN);
    assert.ok(events.some(e => e.type === 'check_in_detected'));
  });

  test('ENTRY + checkIn 정보 없음 → 즉시 check_in_detected', () => {
    const t = new SuspicionTracker();
    const res = { checkOut: new Date(2 * 60 * MIN) }; // checkIn 없음
    const events = evalTracker(t, withEntry(MIN), PRE_STAY_OPTIMIZED, res, true, MIN);
    assert.ok(events.some(e => e.type === 'check_in_detected'));
  });

  test('ENTRY + checkIn 시각 이전 → 조기 체크인 의심 (이벤트 없음)', () => {
    const t = new SuspicionTracker();
    const checkInMs  = 60 * MIN;
    const checkOutMs = 3 * 60 * MIN;
    const res = { checkIn: new Date(checkInMs), checkOut: new Date(checkOutMs) };

    // now=5min (checkIn 1시간 전)
    const events = evalTracker(t, withEntry(4 * MIN), PRE_STAY_OPTIMIZED, res, true, 5 * MIN);
    assert.equal(events.filter(e => e.type === 'check_in_detected').length, 0, '체크인 시각 전');
    assert.ok(t.checkinSuspectedAt !== null, '의심 기록됨');
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
// cleaning_started
// ============================================================
describe('cleaning_started', () => {
  test('CLEANING_PENDING + ENTRY + 모션 20분 지속 → cleaning_started', () => {
    const t = new SuspicionTracker();

    // t=0: ENTRY 감지 → 의심 기록
    evalTracker(t, withEntry(0), CLEANING_PENDING, null, true, 0);
    assert.ok(t.cleaningStartAt !== null);

    // t=19min: 모션 지속 중 → 아직 확신 안 됨
    const events1 = evalTracker(t, noSensor(), CLEANING_PENDING, null, true, 19 * MIN);
    assert.equal(events1.filter(e => e.type === 'cleaning_started').length, 0);

    // t=20min+1: 20분 초과 → cleaning_started
    const events2 = evalTracker(t, noSensor(), CLEANING_PENDING, null, true, 20 * MIN + 1);
    assert.ok(events2.some(e => e.type === 'cleaning_started'));
  });

  test('CLEANING_PENDING + ENTRY + 짧은 체류 후 EXIT → 의심 취소 (청소팀 아님)', () => {
    const t = new SuspicionTracker();

    evalTracker(t, withEntry(0), CLEANING_PENDING, null, true, 0);
    // 5분 후 EXIT (< 20min)
    evalTracker(t, withExit(5 * MIN), CLEANING_PENDING, null, false, 5 * MIN);
    assert.equal(t.cleaningStartAt, null, '의심 취소됨');
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

    // t=0: EXIT → 의심 기록
    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    assert.ok(t.cleaningDoneAt !== null);

    // t=9min: 아직 10분 미만
    const events1 = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, false, 9 * MIN);
    assert.equal(events1.filter(e => e.type === 'cleaning_finished').length, 0);

    // t=10min+1 → cleaning_finished
    const events2 = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, false, 10 * MIN + 1);
    assert.ok(events2.some(e => e.type === 'cleaning_finished'));
  });

  test('청소완료 의심 중 ENTRY → 의심 취소 (재입실)', () => {
    const t = new SuspicionTracker();

    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    assert.ok(t.cleaningDoneAt !== null);

    // 재입실
    evalTracker(t, withEntry(5 * MIN), CLEANING_IN_PROG, null, true, 5 * MIN);
    assert.equal(t.cleaningDoneAt, null, '의심 취소됨');
  });

  test('모션 있는 동안 cleaning_finished 없음', () => {
    const t = new SuspicionTracker();
    evalTracker(t, withExit(0), CLEANING_IN_PROG, null, false, 0);
    // 모션 있음 → 청소 완료 아님
    const events = evalTracker(t, noSensor(), CLEANING_IN_PROG, null, true, 15 * MIN);
    assert.equal(events.filter(e => e.type === 'cleaning_finished').length, 0);
  });

  test('CLEANING_IN_PROGRESS 아닌 상태 → cleaning_finished 없음', () => {
    const t = new SuspicionTracker();
    const events = evalTracker(t, withExit(0), CLEANING_PENDING, null, false, 15 * MIN);
    assert.equal(events.filter(e => e.type === 'cleaning_finished').length, 0);
  });
});
