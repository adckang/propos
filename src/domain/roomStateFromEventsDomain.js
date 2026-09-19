/**
 * roomStateFromEventsDomain — 이벤트 기록으로 "지금 상태"를 계산 (순수 함수)
 *
 * 방 상태의 진짜 원천은 기록(이벤트)이다. 마지막 "큰 상태 변화"(체크인·체크아웃·청소 시작·청소 완료)를
 * 출발점으로 잡고, 그 뒤에 일어난 세부 이벤트(민원·에너지 낭비·입실 준비 …)를
 * 방 상태 규칙(roomStateDomain)에 시간 순서대로 적용한다. 규칙에 맞지 않는 이벤트는 무시한다.
 */

import { getNextRoomState, isValidTransition } from "./room-state/roomStateDomain.js";

/** 큰 상태 변화 이벤트 → 그 직후 상태 */
export const ANCHOR_EVENT_STATES = Object.freeze({
  check_in_detected:  { mainStatus: "OCCUPIED", subStatus: "GOOD_CONDITION" },
  check_out_detected: { mainStatus: "CLEANING", subStatus: "CLEANING_PENDING" },
  cleaning_started:   { mainStatus: "CLEANING", subStatus: "CLEANING_IN_PROGRESS" },
  cleaning_finished:  { mainStatus: "VACANT",   subStatus: "CLEANING_FINISHED" },
});

export const ANCHOR_EVENT_TYPES = Object.freeze(Object.keys(ANCHOR_EVENT_STATES));

/** 큰 변화 뒤에 세부 상태(체류 중 이상, 공실 중 에너지 낭비, 입실 준비)를 바꾸는 이벤트 */
export const FOLLOW_EVENT_TYPES = Object.freeze([
  "energy_waste_detected",
  "energy_waste_resolved",
  "complaint_detected",
  "complaint_resolved",
  "vacant_energy_waste_detected",
  "vacant_energy_waste_resolved",
  "checkin_prep_time_reached",
  "optimization_finished",
]);

/**
 * @param {string} anchorType   마지막 큰 상태 변화 이벤트 종류
 * @param {string[]} followTypes 그 뒤에 일어난 세부 이벤트 종류들 (시간 오름차순)
 * @returns {{ mainStatus: string, subStatus: string }|null}  큰 변화가 없으면 null (상태 알 수 없음)
 */
export function deriveRoomState(anchorType, followTypes = []) {
  const anchor = ANCHOR_EVENT_STATES[anchorType];
  if (!anchor) return null;

  let state = { ...anchor };
  for (const type of followTypes) {
    if (isValidTransition(state, type)) state = getNextRoomState(state, type);
  }
  return state;
}
