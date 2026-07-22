/**
 * deviceRoles.js — 숙소 기기의 논리적 역할 + 커맨드 상수
 *
 * 역할(Role)은 브랜드·모델과 무관한 기능적 추상화.
 * 숙소별 실제 entity_id는 monitoring-config.json의 devices 필드에서 매핑한다.
 */

// 역할 ID 상수 (config의 key이자 stateActions의 참조값)
export const DEVICE_ROLE = Object.freeze({
  AC_MAIN:         'AC_MAIN',          // 메인 냉난방기
  LIGHT_LIVING:    'LIGHT_LIVING',     // 거실 조명
  LIGHT_BEDROOM:   'LIGHT_BEDROOM',    // 침실 조명
  LIGHT_BATHROOM:  'LIGHT_BATHROOM',   // 욕실 조명
  LIGHT_ENTRANCE:  'LIGHT_ENTRANCE',   // 현관 조명
  PLUG_TV:         'PLUG_TV',          // TV 대기전력 플러그
  PLUG_WASHER:     'PLUG_WASHER',      // 세탁기 플러그
  FAN_VENTILATION: 'FAN_VENTILATION',  // 환기팬
  LOCK_ENTRANCE:   'LOCK_ENTRANCE',    // 현관 도어락
});

// 역할 → HA 도메인 (executor가 callHaService domain 결정에 사용)
export const ROLE_DOMAIN = Object.freeze({
  AC_MAIN:         'climate',
  LIGHT_LIVING:    'light',
  LIGHT_BEDROOM:   'light',
  LIGHT_BATHROOM:  'light',
  LIGHT_ENTRANCE:  'light',
  PLUG_TV:         'switch',
  PLUG_WASHER:     'switch',
  FAN_VENTILATION: 'switch',
  LOCK_ENTRANCE:   'lock',
});

// 커맨드 타입
// ON:       켜기. brightness(0~100) 옵션 포함 가능
// SET_TEMP: 온도 설정 + 켜기. hvacMode('cool'|'heat'|'auto') 함께 지정해야 실제 가동
export const CMD = Object.freeze({
  ON:       'ON',
  OFF:      'OFF',
  SET_TEMP: 'SET_TEMP',
  LOCK:     'LOCK',
  UNLOCK:   'UNLOCK',
});
