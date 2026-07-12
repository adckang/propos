/**
 * roomStateDomain — 숙소 상태 전환 순수 함수
 * 정본: docs/room-state-machine.md v2.2
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 초기 상태
 * @type {{ mainStatus: string, subStatus: string }}
 */
export const INITIAL_STATE = {
  mainStatus: 'VACANT',
  subStatus: 'CLEANING_FINISHED',
};

/**
 * 글로벌 이벤트: 모든 Main Status에서 유효. 중복 정의 금지.
 * 상태별 TRANSITIONS보다 낮은 우선순위로 적용 (fallback).
 * docs/room-state-machine.md 섹션 5A 기준.
 */
const GLOBAL_TRANSITIONS = {
  maintenance_required: { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' },
  maintenance_started:  { mainStatus: 'VACANT', subStatus: 'MAINTENANCE' },
  maintenance_finished: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
};

/**
 * OCCUPIED 4개 Sub-Status 공통 이벤트.
 * TRANSITIONS 각 항목에 스프레드로 포함.
 * docs/room-state-machine.md 섹션 5B 기준.
 */
const OCCUPIED_COMMON = {
  check_out_detected: { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' },
};

/**
 * 상태별 전환 테이블
 * key: "mainStatus/subStatus"
 * value: { [event]: nextState }
 * docs/room-state-machine.md 섹션 5C 기준.
 */
const TRANSITIONS = {
  'VACANT/CLEANING_FINISHED': {
    checkin_prep_time_reached: { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' },
    // reservation_cancelled: 자기전환 — 비즈니스 레이어에서 처리
    reservation_cancelled:     { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
  },
  'VACANT/MAINTENANCE': {
    checkin_prep_time_reached: { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' },
    // maintenance_finished: GLOBAL_TRANSITIONS에서 처리
  },
  'PRE_STAY_READY/OPTIMIZING': {
    optimization_finished:     { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' },
    // reservation_cancelled: VACANT 기간에만 유효. PRE_STAY_READY에서 제거.
    // maintenance_*: GLOBAL_TRANSITIONS에서 처리
  },
  'PRE_STAY_READY/OPTIMIZED': {
    check_in_detected:         { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    // reservation_cancelled: VACANT 기간에만 유효. PRE_STAY_READY에서 제거.
    // maintenance_*: GLOBAL_TRANSITIONS에서 처리
  },
  'OCCUPIED/GOOD_CONDITION': {
    ...OCCUPIED_COMMON,
    energy_waste_detected:     { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE' },
    complaint_detected:        { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT' },
  },
  'OCCUPIED/ENERGY_WASTE': {
    ...OCCUPIED_COMMON,
    energy_waste_resolved:     { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    complaint_detected:        { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_AND_ENERGY' },
  },
  'OCCUPIED/ISSUE_COMPLAINT': {
    ...OCCUPIED_COMMON,
    complaint_resolved:        { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    energy_waste_detected:     { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_AND_ENERGY' },
  },
  'OCCUPIED/ISSUE_AND_ENERGY': {
    ...OCCUPIED_COMMON,
    complaint_resolved:        { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE' },
    energy_waste_resolved:     { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT' },
  },
  'CLEANING/CLEANING_PENDING': {
    cleaning_started:          { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS' },
  },
  'CLEANING/CLEANING_IN_PROGRESS': {
    cleaning_finished:         { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
  },
};

/**
 * 다음 상태 계산
 * 우선순위: TRANSITIONS[key][event] → GLOBAL_TRANSITIONS[event] → throw
 * @param {{ mainStatus: string, subStatus: string }} currentState
 * @param {string} event
 * @returns {{ mainStatus: string, subStatus: string }}
 * @throws {Error} 정의되지 않은 전환
 */
export function getNextRoomState(currentState, event) {
  if (!currentState)             throw new Error('currentState is required');
  if (!currentState.mainStatus)  throw new Error('currentState.mainStatus is required');
  if (!currentState.subStatus)   throw new Error('currentState.subStatus is required');
  if (!event)                    throw new Error('event is required');

  const key = `${currentState.mainStatus}/${currentState.subStatus}`;
  const stateTransitions = TRANSITIONS[key];

  if (!stateTransitions) {
    throw new Error(`invalid state: ${key}`);
  }

  const nextState = stateTransitions[event];
  if (nextState) {
    return { mainStatus: nextState.mainStatus, subStatus: nextState.subStatus };
  }

  const globalNext = GLOBAL_TRANSITIONS[event];
  if (globalNext) {
    return { mainStatus: globalNext.mainStatus, subStatus: globalNext.subStatus };
  }

  throw new Error(`invalid transition: ${key} + ${event}`);
}

/**
 * 현재 상태에서 해당 이벤트가 유효한지 확인 (EventGuard용)
 * 상태별 전환과 글로벌 전환 모두 확인.
 * @param {{ mainStatus: string, subStatus: string }} currentState
 * @param {string} event
 * @returns {boolean}
 */
export function isValidTransition(currentState, event) {
  if (!currentState?.mainStatus || !currentState?.subStatus || !event) return false;
  const key = `${currentState.mainStatus}/${currentState.subStatus}`;
  return !!(TRANSITIONS[key]?.[event] || GLOBAL_TRANSITIONS[event]);
}

/**
 * 현재 상태에서 가능한 모든 이벤트 목록 반환 (디버그/UI용)
 * 상태별 + 글로벌 이벤트 모두 포함.
 * @param {{ mainStatus: string, subStatus: string }} currentState
 * @returns {string[]}
 */
export function getAvailableEvents(currentState) {
  if (!currentState?.mainStatus || !currentState?.subStatus) return [];
  const key = `${currentState.mainStatus}/${currentState.subStatus}`;
  const stateEvents = Object.keys(TRANSITIONS[key] ?? {});
  const globalEvents = Object.keys(GLOBAL_TRANSITIONS);
  return [...new Set([...stateEvents, ...globalEvents])];
}
