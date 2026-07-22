/**
 * stateActions.js — 방 상태 전환 시 실행할 기기 제어 액션 정의
 *
 * mainStatus가 바뀔 때 해당 배열의 액션이 순서대로 실행된다.
 * entity_id는 없음 — 역할(DEVICE_ROLE)만 사용.
 * 숙소에 매핑되지 않은 역할은 executor가 조용히 건너뜀.
 */

import { DEVICE_ROLE, CMD } from './deviceRoles.js';

export const STATE_DEVICE_ACTIONS = Object.freeze({

  OCCUPIED: [
    // 게스트 입실: 쾌적한 환경 자동 세팅
    { role: DEVICE_ROLE.AC_MAIN,        cmd: { type: CMD.SET_TEMP, value: 24, hvacMode: 'cool' } },
    { role: DEVICE_ROLE.LIGHT_ENTRANCE, cmd: { type: CMD.ON, brightness: 100 } },
    { role: DEVICE_ROLE.LIGHT_LIVING,   cmd: { type: CMD.ON, brightness: 80 } },
    { role: DEVICE_ROLE.PLUG_TV,        cmd: { type: CMD.ON } },
  ],

  CLEANING: [
    // 청소 모드: 에어컨 off, 전체 조명 최대, 환기팬 on
    { role: DEVICE_ROLE.AC_MAIN,          cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_LIVING,     cmd: { type: CMD.ON, brightness: 100 } },
    { role: DEVICE_ROLE.LIGHT_BEDROOM,    cmd: { type: CMD.ON, brightness: 100 } },
    { role: DEVICE_ROLE.LIGHT_BATHROOM,   cmd: { type: CMD.ON, brightness: 100 } },
    { role: DEVICE_ROLE.LIGHT_ENTRANCE,   cmd: { type: CMD.ON, brightness: 100 } },
    { role: DEVICE_ROLE.FAN_VENTILATION,  cmd: { type: CMD.ON } },
  ],

  PRE_STAY_READY: [
    // 체크인 1시간 전: 예냉 시작, 조명·환기팬은 대기
    { role: DEVICE_ROLE.AC_MAIN,          cmd: { type: CMD.SET_TEMP, value: 23, hvacMode: 'cool' } },
    { role: DEVICE_ROLE.FAN_VENTILATION,  cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_LIVING,     cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_BEDROOM,    cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_BATHROOM,   cmd: { type: CMD.OFF } },
  ],

  VACANT: [
    // 공실: 전체 절전 + 도어락 잠금
    { role: DEVICE_ROLE.AC_MAIN,          cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_LIVING,     cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_BEDROOM,    cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_BATHROOM,   cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LIGHT_ENTRANCE,   cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.PLUG_TV,          cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.FAN_VENTILATION,  cmd: { type: CMD.OFF } },
    { role: DEVICE_ROLE.LOCK_ENTRANCE,    cmd: { type: CMD.LOCK } },
  ],
});
