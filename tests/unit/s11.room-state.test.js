import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_STATE,
  getNextRoomState,
  isValidTransition,
  getAvailableEvents,
} from '../../src/domain/room-state/roomStateDomain.js';

import {
  createStatusSegment,
  appendStatusTransitionLog,
  filterLogByMainStatus,
  getLatestSegment,
} from '../../src/domain/room-state/statusLogDomain.js';

// ─── 헬퍼 ────────────────────────────────────────────────────
const s = (main, sub) => ({ mainStatus: main, subStatus: sub });

const VACANT_CF   = s('VACANT',        'CLEANING_FINISHED');
const VACANT_MN   = s('VACANT',        'MAINTENANCE');
const PRE_OPTG    = s('PRE_STAY_READY','OPTIMIZING');
const PRE_OPTD    = s('PRE_STAY_READY','OPTIMIZED');
const OCC_GOOD    = s('OCCUPIED',      'GOOD_CONDITION');
const OCC_EW      = s('OCCUPIED',      'ENERGY_WASTE');
const OCC_IC      = s('OCCUPIED',      'ISSUE_COMPLAINT');
const OCC_IAE     = s('OCCUPIED',      'ISSUE_AND_ENERGY');
const CLN_PEND    = s('CLEANING',      'CLEANING_PENDING');
const CLN_PROG    = s('CLEANING',      'CLEANING_IN_PROGRESS');

// ============================================================
// 초기 상태
// ============================================================
describe('INITIAL_STATE', () => {
  test('VACANT/CLEANING_FINISHED 이다', () => {
    assert.deepEqual(INITIAL_STATE, VACANT_CF);
  });
});

// ============================================================
// getNextRoomState — 상태별 전환
// ============================================================
describe('getNextRoomState — 상태별 전환', () => {

  // VACANT
  test('T01 VACANT/CLEANING_FINISHED + checkin_prep_time_reached → PRE_STAY_READY/OPTIMIZING', () => {
    assert.deepEqual(getNextRoomState(VACANT_CF, 'checkin_prep_time_reached'), PRE_OPTG);
  });
  test('T02 VACANT/CLEANING_FINISHED + reservation_cancelled → VACANT/CLEANING_FINISHED (자기전환)', () => {
    assert.deepEqual(getNextRoomState(VACANT_CF, 'reservation_cancelled'), VACANT_CF);
  });
  test('T03 VACANT/MAINTENANCE + checkin_prep_time_reached → PRE_STAY_READY/OPTIMIZING', () => {
    assert.deepEqual(getNextRoomState(VACANT_MN, 'checkin_prep_time_reached'), PRE_OPTG);
  });

  // PRE_STAY_READY
  test('T04 PRE_STAY_READY/OPTIMIZING + optimization_finished → PRE_STAY_READY/OPTIMIZED', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTG, 'optimization_finished'), PRE_OPTD);
  });
  test('T05 PRE_STAY_READY/OPTIMIZED + check_in_detected → OCCUPIED/GOOD_CONDITION', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTD, 'check_in_detected'), OCC_GOOD);
  });

  // OCCUPIED (상태별)
  test('T06 OCCUPIED/GOOD_CONDITION + energy_waste_detected → OCCUPIED/ENERGY_WASTE', () => {
    assert.deepEqual(getNextRoomState(OCC_GOOD, 'energy_waste_detected'), OCC_EW);
  });
  test('T07 OCCUPIED/GOOD_CONDITION + complaint_detected → OCCUPIED/ISSUE_COMPLAINT', () => {
    assert.deepEqual(getNextRoomState(OCC_GOOD, 'complaint_detected'), OCC_IC);
  });
  test('T08 OCCUPIED/ENERGY_WASTE + energy_waste_resolved → OCCUPIED/GOOD_CONDITION', () => {
    assert.deepEqual(getNextRoomState(OCC_EW, 'energy_waste_resolved'), OCC_GOOD);
  });
  test('T09 OCCUPIED/ENERGY_WASTE + complaint_detected → OCCUPIED/ISSUE_AND_ENERGY', () => {
    assert.deepEqual(getNextRoomState(OCC_EW, 'complaint_detected'), OCC_IAE);
  });
  test('T10 OCCUPIED/ISSUE_COMPLAINT + complaint_resolved → OCCUPIED/GOOD_CONDITION', () => {
    assert.deepEqual(getNextRoomState(OCC_IC, 'complaint_resolved'), OCC_GOOD);
  });
  test('T11 OCCUPIED/ISSUE_COMPLAINT + energy_waste_detected → OCCUPIED/ISSUE_AND_ENERGY', () => {
    assert.deepEqual(getNextRoomState(OCC_IC, 'energy_waste_detected'), OCC_IAE);
  });
  test('T12 OCCUPIED/ISSUE_AND_ENERGY + complaint_resolved → OCCUPIED/ENERGY_WASTE', () => {
    assert.deepEqual(getNextRoomState(OCC_IAE, 'complaint_resolved'), OCC_EW);
  });
  test('T13 OCCUPIED/ISSUE_AND_ENERGY + energy_waste_resolved → OCCUPIED/ISSUE_COMPLAINT', () => {
    assert.deepEqual(getNextRoomState(OCC_IAE, 'energy_waste_resolved'), OCC_IC);
  });

  // CLEANING
  test('T14 CLEANING/CLEANING_PENDING + cleaning_started → CLEANING/CLEANING_IN_PROGRESS', () => {
    assert.deepEqual(getNextRoomState(CLN_PEND, 'cleaning_started'), CLN_PROG);
  });
  test('T15 CLEANING/CLEANING_IN_PROGRESS + cleaning_finished → VACANT/CLEANING_FINISHED', () => {
    assert.deepEqual(getNextRoomState(CLN_PROG, 'cleaning_finished'), VACANT_CF);
  });
});

// ============================================================
// OCCUPIED_COMMON — check_out_detected (4개 Sub-Status 공통)
// ============================================================
describe('OCCUPIED_COMMON — check_out_detected', () => {

  test('OC1 OCCUPIED/GOOD_CONDITION + check_out_detected → CLEANING/CLEANING_PENDING', () => {
    assert.deepEqual(getNextRoomState(OCC_GOOD, 'check_out_detected'), CLN_PEND);
  });
  test('OC2 OCCUPIED/ENERGY_WASTE + check_out_detected → CLEANING/CLEANING_PENDING', () => {
    assert.deepEqual(getNextRoomState(OCC_EW, 'check_out_detected'), CLN_PEND);
  });
  test('OC3 OCCUPIED/ISSUE_COMPLAINT + check_out_detected → CLEANING/CLEANING_PENDING', () => {
    assert.deepEqual(getNextRoomState(OCC_IC, 'check_out_detected'), CLN_PEND);
  });
  test('OC4 OCCUPIED/ISSUE_AND_ENERGY + check_out_detected → CLEANING/CLEANING_PENDING', () => {
    assert.deepEqual(getNextRoomState(OCC_IAE, 'check_out_detected'), CLN_PEND);
  });
});

// ============================================================
// GLOBAL_TRANSITIONS — maintenance 이벤트 (모든 상태에서 유효)
// ============================================================
describe('GLOBAL_TRANSITIONS — maintenance 이벤트', () => {

  // maintenance_required → VACANT/MAINTENANCE (모든 상태에서)
  test('G1 VACANT/CLEANING_FINISHED + maintenance_required → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(VACANT_CF, 'maintenance_required'), VACANT_MN);
  });
  test('G1 PRE_STAY_READY/OPTIMIZING + maintenance_required → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTG, 'maintenance_required'), VACANT_MN);
  });
  test('G1 PRE_STAY_READY/OPTIMIZED + maintenance_required → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTD, 'maintenance_required'), VACANT_MN);
  });
  test('G1 OCCUPIED/GOOD_CONDITION + maintenance_required → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(OCC_GOOD, 'maintenance_required'), VACANT_MN);
  });
  test('G1 CLEANING/CLEANING_IN_PROGRESS + maintenance_required → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(CLN_PROG, 'maintenance_required'), VACANT_MN);
  });

  // maintenance_started → VACANT/MAINTENANCE (모든 상태에서)
  test('G2 VACANT/CLEANING_FINISHED + maintenance_started → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(VACANT_CF, 'maintenance_started'), VACANT_MN);
  });
  test('G2 PRE_STAY_READY/OPTIMIZING + maintenance_started → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTG, 'maintenance_started'), VACANT_MN);
  });
  test('G2 CLEANING/CLEANING_PENDING + maintenance_started → VACANT/MAINTENANCE', () => {
    assert.deepEqual(getNextRoomState(CLN_PEND, 'maintenance_started'), VACANT_MN);
  });

  // maintenance_finished → VACANT/CLEANING_FINISHED (모든 상태에서)
  test('G3 VACANT/MAINTENANCE + maintenance_finished → VACANT/CLEANING_FINISHED', () => {
    assert.deepEqual(getNextRoomState(VACANT_MN, 'maintenance_finished'), VACANT_CF);
  });
  test('G3 PRE_STAY_READY/OPTIMIZED + maintenance_finished → VACANT/CLEANING_FINISHED', () => {
    assert.deepEqual(getNextRoomState(PRE_OPTD, 'maintenance_finished'), VACANT_CF);
  });
  test('G3 CLEANING/CLEANING_IN_PROGRESS + maintenance_finished → VACANT/CLEANING_FINISHED', () => {
    assert.deepEqual(getNextRoomState(CLN_PROG, 'maintenance_finished'), VACANT_CF);
  });
});

// ============================================================
// getNextRoomState — invalid transition (throw)
// ============================================================
describe('getNextRoomState — invalid transition은 throw', () => {

  test('VACANT 상태에서 check_out_detected', () => {
    assert.throws(() => getNextRoomState(VACANT_CF, 'check_out_detected'), /invalid transition/);
  });
  test('OCCUPIED 상태에서 cleaning_started', () => {
    assert.throws(() => getNextRoomState(OCC_GOOD, 'cleaning_started'), /invalid transition/);
  });
  test('OCCUPIED 상태에서 check_in_detected (이미 체크인됨)', () => {
    assert.throws(() => getNextRoomState(OCC_GOOD, 'check_in_detected'), /invalid transition/);
  });
  test('CLEANING 상태에서 reservation_cancelled', () => {
    assert.throws(() => getNextRoomState(CLN_PEND, 'reservation_cancelled'), /invalid transition/);
  });
  test('PRE_STAY_READY에서 energy_waste_detected (게스트 없음)', () => {
    assert.throws(() => getNextRoomState(PRE_OPTG, 'energy_waste_detected'), /invalid transition/);
  });
  test('OCCUPIED/ISSUE_AND_ENERGY에서 complaint_detected (이미 복합 상태)', () => {
    assert.throws(() => getNextRoomState(OCC_IAE, 'complaint_detected'), /invalid transition/);
  });
  // reservation_cancelled는 VACANT 기간에만 유효 — PRE_STAY_READY에서 throw
  test('PRE_STAY_READY/OPTIMIZING + reservation_cancelled → throw (VACANT 기간에만 유효)', () => {
    assert.throws(() => getNextRoomState(PRE_OPTG, 'reservation_cancelled'), /invalid transition/);
  });
  test('PRE_STAY_READY/OPTIMIZED + reservation_cancelled → throw (VACANT 기간에만 유효)', () => {
    assert.throws(() => getNextRoomState(PRE_OPTD, 'reservation_cancelled'), /invalid transition/);
  });
  test('OCCUPIED 상태에서 reservation_cancelled → throw', () => {
    assert.throws(() => getNextRoomState(OCC_GOOD, 'reservation_cancelled'), /invalid transition/);
  });
});

// ============================================================
// getNextRoomState — 입력 검증
// ============================================================
describe('getNextRoomState — 입력 검증', () => {

  test('currentState 없으면 throw', () => {
    assert.throws(() => getNextRoomState(null, 'cleaning_started'), /currentState is required/);
  });
  test('event 없으면 throw', () => {
    assert.throws(() => getNextRoomState(VACANT_CF, null), /event is required/);
  });
  test('mainStatus 없으면 throw', () => {
    assert.throws(() => getNextRoomState({ subStatus: 'CLEANING_FINISHED' }, 'cleaning_started'), /mainStatus is required/);
  });
});

// ============================================================
// 정상 운영 흐름 시나리오
// ============================================================
describe('정상 운영 흐름 — 전체 순환', () => {

  test('공실 → 입실전 → 체류 → 청소 → 공실 전체 순환', () => {
    let state = INITIAL_STATE;

    state = getNextRoomState(state, 'checkin_prep_time_reached');
    assert.deepEqual(state, PRE_OPTG);

    state = getNextRoomState(state, 'optimization_finished');
    assert.deepEqual(state, PRE_OPTD);

    state = getNextRoomState(state, 'check_in_detected');
    assert.deepEqual(state, OCC_GOOD);

    state = getNextRoomState(state, 'check_out_detected');
    assert.deepEqual(state, CLN_PEND);

    state = getNextRoomState(state, 'cleaning_started');
    assert.deepEqual(state, CLN_PROG);

    state = getNextRoomState(state, 'cleaning_finished');
    assert.deepEqual(state, VACANT_CF);
  });

  test('에너지낭비 → 민원 추가 → 민원 해소 → 에너지낭비 잔존 → 해소', () => {
    let state = OCC_GOOD;

    state = getNextRoomState(state, 'energy_waste_detected');
    assert.deepEqual(state, OCC_EW);

    state = getNextRoomState(state, 'complaint_detected');
    assert.deepEqual(state, OCC_IAE);

    state = getNextRoomState(state, 'complaint_resolved');
    assert.deepEqual(state, OCC_EW);          // 에너지낭비 잔존

    state = getNextRoomState(state, 'energy_waste_resolved');
    assert.deepEqual(state, OCC_GOOD);
  });

  test('민원 → 에너지낭비 추가 → 에너지낭비 해소 → 민원 잔존 → 해소', () => {
    let state = OCC_GOOD;

    state = getNextRoomState(state, 'complaint_detected');
    assert.deepEqual(state, OCC_IC);

    state = getNextRoomState(state, 'energy_waste_detected');
    assert.deepEqual(state, OCC_IAE);

    state = getNextRoomState(state, 'energy_waste_resolved');
    assert.deepEqual(state, OCC_IC);           // 민원 잔존

    state = getNextRoomState(state, 'complaint_resolved');
    assert.deepEqual(state, OCC_GOOD);
  });

  test('정비 중 체크인 준비시간 도래', () => {
    let state = VACANT_MN;
    state = getNextRoomState(state, 'checkin_prep_time_reached');
    assert.deepEqual(state, PRE_OPTG);
  });

  test('정비 전체 흐름 — VACANT에서 시작 (글로벌 이벤트)', () => {
    let state = VACANT_CF;

    state = getNextRoomState(state, 'maintenance_started');
    assert.deepEqual(state, VACANT_MN);

    state = getNextRoomState(state, 'maintenance_finished');
    assert.deepEqual(state, VACANT_CF);
  });

  test('정비 — PRE_STAY_READY에서 maintenance_required (글로벌 이벤트)', () => {
    let state = PRE_OPTG;
    state = getNextRoomState(state, 'maintenance_required');
    assert.deepEqual(state, VACANT_MN);
  });

  test('reservation_cancelled — VACANT에서 자기전환', () => {
    let state = VACANT_CF;
    state = getNextRoomState(state, 'reservation_cancelled');
    assert.deepEqual(state, VACANT_CF);  // 상태 유지, 비즈니스 레이어 처리
  });
});

// ============================================================
// isValidTransition
// ============================================================
describe('isValidTransition', () => {

  test('유효한 전환은 true', () => {
    assert.equal(isValidTransition(VACANT_CF, 'checkin_prep_time_reached'), true);
  });
  test('무효한 전환은 false', () => {
    assert.equal(isValidTransition(VACANT_CF, 'check_out_detected'), false);
  });
  test('잘못된 상태는 false', () => {
    assert.equal(isValidTransition(null, 'cleaning_started'), false);
  });
  test('글로벌 이벤트는 어느 상태에서도 true', () => {
    assert.equal(isValidTransition(OCC_GOOD,   'maintenance_started'), true);
    assert.equal(isValidTransition(CLN_PROG,   'maintenance_required'), true);
    assert.equal(isValidTransition(PRE_OPTD,   'maintenance_finished'), true);
  });
  test('reservation_cancelled는 VACANT에서만 true', () => {
    assert.equal(isValidTransition(VACANT_CF, 'reservation_cancelled'), true);
    assert.equal(isValidTransition(PRE_OPTG,  'reservation_cancelled'), false);
    assert.equal(isValidTransition(PRE_OPTD,  'reservation_cancelled'), false);
    assert.equal(isValidTransition(OCC_GOOD,  'reservation_cancelled'), false);
  });
});

// ============================================================
// getAvailableEvents
// ============================================================
describe('getAvailableEvents', () => {

  test('VACANT/CLEANING_FINISHED — 상태별 + 글로벌 포함', () => {
    const events = getAvailableEvents(VACANT_CF);
    // 상태별: checkin_prep_time_reached, reservation_cancelled
    // 글로벌: maintenance_required, maintenance_started, maintenance_finished
    assert.ok(events.includes('checkin_prep_time_reached'));
    assert.ok(events.includes('reservation_cancelled'));
    assert.ok(events.includes('maintenance_required'));
    assert.ok(events.includes('maintenance_started'));
    assert.ok(events.includes('maintenance_finished'));
  });
  test('OCCUPIED/ISSUE_AND_ENERGY — 상태별 3개 + 글로벌 3개', () => {
    const events = getAvailableEvents(OCC_IAE);
    assert.ok(events.includes('check_out_detected'));       // OCCUPIED_COMMON
    assert.ok(events.includes('complaint_resolved'));
    assert.ok(events.includes('energy_waste_resolved'));
    assert.ok(events.includes('maintenance_required'));     // 글로벌
    assert.ok(events.includes('maintenance_started'));      // 글로벌
    assert.ok(events.includes('maintenance_finished'));     // 글로벌
  });
  test('잘못된 상태는 빈 배열', () => {
    assert.deepEqual(getAvailableEvents(null), []);
  });
});

// ============================================================
// statusLogDomain
// ============================================================
describe('createStatusSegment', () => {

  const SEG = createStatusSegment(VACANT_CF, PRE_OPTG, 'checkin_prep_time_reached', '2026-07-02T14:00:00Z');

  test('event 필드 정확', () => {
    assert.equal(SEG.event, 'checkin_prep_time_reached');
  });
  test('prevState 정확', () => {
    assert.deepEqual(SEG.prevState, VACANT_CF);
  });
  test('nextState 정확', () => {
    assert.deepEqual(SEG.nextState, PRE_OPTG);
  });
  test('timestamp 포함', () => {
    assert.equal(SEG.timestamp, '2026-07-02T14:00:00Z');
  });
  test('prevState 없으면 throw', () => {
    assert.throws(() => createStatusSegment(null, PRE_OPTG, 'e', 't'), /prevState is required/);
  });
});

describe('appendStatusTransitionLog', () => {

  test('불변 — 원본 배열 변경 없음', () => {
    const log = [];
    const seg = createStatusSegment(VACANT_CF, PRE_OPTG, 'checkin_prep_time_reached', '2026-07-02T14:00:00Z');
    const next = appendStatusTransitionLog(log, seg);
    assert.equal(log.length, 0);
    assert.equal(next.length, 1);
  });
  test('누적 추가', () => {
    const seg1 = createStatusSegment(VACANT_CF,  PRE_OPTG,  'checkin_prep_time_reached', 't1');
    const seg2 = createStatusSegment(PRE_OPTG,   PRE_OPTD,  'optimization_finished',     't2');
    const log  = appendStatusTransitionLog(appendStatusTransitionLog([], seg1), seg2);
    assert.equal(log.length, 2);
  });
});

describe('filterLogByMainStatus', () => {

  test('OCCUPIED 세그먼트만 반환', () => {
    const seg1 = createStatusSegment(PRE_OPTD,  OCC_GOOD, 'check_in_detected',    't1');
    const seg2 = createStatusSegment(OCC_GOOD,  OCC_EW,   'energy_waste_detected', 't2');
    const seg3 = createStatusSegment(OCC_EW,    CLN_PEND, 'check_out_detected',   't3');
    const log  = [seg1, seg2, seg3];
    const result = filterLogByMainStatus(log, 'OCCUPIED');
    assert.equal(result.length, 2);
  });
});

describe('getLatestSegment', () => {

  test('마지막 세그먼트 반환', () => {
    const seg1 = createStatusSegment(VACANT_CF, PRE_OPTG, 'checkin_prep_time_reached', 't1');
    const seg2 = createStatusSegment(PRE_OPTG,  PRE_OPTD, 'optimization_finished',     't2');
    assert.equal(getLatestSegment([seg1, seg2]).event, 'optimization_finished');
  });
  test('빈 배열이면 null', () => {
    assert.equal(getLatestSegment([]), null);
  });
});
