/**
 * roomStateDomain — 숙소 상태 전환 순수 함수
 * 정본: docs/room-state-machine.md
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
 * 전환 테이블 (docs/room-state-machine.md 섹션 5 기준)
 * key: "mainStatus/subStatus"
 * value: { [event]: nextState }
 */
const TRANSITIONS = {
  'VACANT/CLEANING_FINISHED': {
    checkin_prep_time_reached: { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' },
    maintenance_started:       { mainStatus: 'VACANT',         subStatus: 'MAINTENANCE' },
  },
  'VACANT/MAINTENANCE': {
    maintenance_finished:      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
    checkin_prep_time_reached: { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING' },
  },
  'PRE_STAY_READY/OPTIMIZING': {
    optimization_finished:     { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED' },
    reservation_cancelled:     { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
    maintenance_required:      { mainStatus: 'VACANT',         subStatus: 'MAINTENANCE' },
  },
  'PRE_STAY_READY/OPTIMIZED': {
    check_in_detected:         { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    reservation_cancelled:     { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED' },
    maintenance_required:      { mainStatus: 'VACANT',         subStatus: 'MAINTENANCE' },
  },
  'OCCUPIED/GOOD_CONDITION': {
    energy_waste_detected:     { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE' },
    complaint_detected:        { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT' },
    check_out_detected:        { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING' },
  },
  'OCCUPIED/ENERGY_WASTE': {
    energy_waste_resolved:     { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    complaint_detected:        { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_AND_ENERGY' },
    check_out_detected:        { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING' },
  },
  'OCCUPIED/ISSUE_COMPLAINT': {
    complaint_resolved:        { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION' },
    energy_waste_detected:     { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_AND_ENERGY' },
    check_out_detected:        { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING' },
  },
  'OCCUPIED/ISSUE_AND_ENERGY': {
    complaint_resolved:        { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE' },
    energy_waste_resolved:     { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT' },
    check_out_detected:        { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING' },
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

  if (!nextState) {
    throw new Error(`invalid transition: ${key} + ${event}`);
  }

  return { mainStatus: nextState.mainStatus, subStatus: nextState.subStatus };
}

/**
 * 현재 상태에서 해당 이벤트가 유효한지 확인 (EventGuard용)
 * @param {{ mainStatus: string, subStatus: string }} currentState
 * @param {string} event
 * @returns {boolean}
 */
export function isValidTransition(currentState, event) {
  if (!currentState?.mainStatus || !currentState?.subStatus || !event) return false;
  const key = `${currentState.mainStatus}/${currentState.subStatus}`;
  return !!(TRANSITIONS[key]?.[event]);
}

/**
 * 특정 Main Status에서 나올 수 있는 모든 이벤트 목록 반환 (디버그/UI용)
 * @param {{ mainStatus: string, subStatus: string }} currentState
 * @returns {string[]}
 */
export function getAvailableEvents(currentState) {
  if (!currentState?.mainStatus || !currentState?.subStatus) return [];
  const key = `${currentState.mainStatus}/${currentState.subStatus}`;
  return Object.keys(TRANSITIONS[key] ?? {});
}
