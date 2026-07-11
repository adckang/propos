/**
 * statusLogDomain — 상태 전환 로그 순수 함수
 * 정본: docs/room-state-machine.md
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 상태 전환 세그먼트 생성
 * @param {{ mainStatus: string, subStatus: string }} prevState
 * @param {{ mainStatus: string, subStatus: string }} nextState
 * @param {string} event
 * @param {string} timestamp  - ISO 8601
 * @returns {{ id, event, prevState, nextState, timestamp }}
 */
export function createStatusSegment(prevState, nextState, event, timestamp) {
  if (!prevState)            throw new Error('prevState is required');
  if (!prevState.mainStatus) throw new Error('prevState.mainStatus is required');
  if (!prevState.subStatus)  throw new Error('prevState.subStatus is required');
  if (!nextState)            throw new Error('nextState is required');
  if (!nextState.mainStatus) throw new Error('nextState.mainStatus is required');
  if (!nextState.subStatus)  throw new Error('nextState.subStatus is required');
  if (!event)                throw new Error('event is required');
  if (!timestamp)            throw new Error('timestamp is required');

  return {
    id:        `${timestamp}-${event}`,
    event,
    prevState: { mainStatus: prevState.mainStatus, subStatus: prevState.subStatus },
    nextState: { mainStatus: nextState.mainStatus, subStatus: nextState.subStatus },
    timestamp,
  };
}

/**
 * 로그 배열에 세그먼트 추가 (불변 — 원본 변경 없음)
 * @param {Array} log
 * @param {object} segment  - createStatusSegment 반환값
 * @returns {Array}
 */
export function appendStatusTransitionLog(log, segment) {
  if (!Array.isArray(log)) throw new Error('log must be an array');
  if (!segment)            throw new Error('segment is required');
  return [...log, segment];
}

/**
 * 로그에서 특정 Main Status 구간만 필터
 * @param {Array} log
 * @param {string} mainStatus
 * @returns {Array}
 */
export function filterLogByMainStatus(log, mainStatus) {
  if (!Array.isArray(log)) throw new Error('log must be an array');
  if (!mainStatus)         throw new Error('mainStatus is required');
  return log.filter(s => s.nextState.mainStatus === mainStatus);
}

/**
 * 가장 최근 전환 세그먼트 반환
 * @param {Array} log
 * @returns {object | null}
 */
export function getLatestSegment(log) {
  if (!Array.isArray(log)) throw new Error('log must be an array');
  return log.length > 0 ? log[log.length - 1] : null;
}
