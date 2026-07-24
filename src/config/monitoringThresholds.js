/**
 * monitoringThresholds.js — 체류중 감시 임계값 설정
 * 이 파일만 수정하면 감지 민감도가 전체 반영됩니다.
 *
 * 서버(Pi watcher)와 브라우저 fallback 모두 이 파일을 참조합니다.
 */

export const THRESHOLDS = {
  // ── 계절 판별 (실외 온도 기준) ──────────────────────────────────────────
  SUMMER_OUT: 20,   // 이 이상이면 여름 규칙 적용 (°C)
  WINTER_OUT: 10,   // 이 이하면  겨울 규칙 적용 (°C)

  // ── 여름 실내 적정범위 ────────────────────────────────────────────────────
  SUM_TEMP_MAX: 27, // 초과 시 "너무 더움" 경보 (°C)
  SUM_TEMP_MIN: 21, // 미만 시 "과냉방" 경보    (°C)
  SUM_HUM_MAX:  65, // 초과 시 "너무 습함" 경보 (%)

  // ── 겨울 실내 적정범위 ────────────────────────────────────────────────────
  WIN_TEMP_MIN: 18, // 미만 시 "너무 추움" 경보 (°C)
  WIN_TEMP_MAX: 26, // 초과 시 "과난방" 경보    (°C)
  WIN_HUM_MIN:  35, // 미만 시 "너무 건조" 경보 (%)

  // ── AC 전력 ──────────────────────────────────────────────────────────────
  AC_ON:   50,  // 이 이상이면 에어컨 가동 중으로 판정 (W)
  AC_HIGH: 500, // 이 이상이면 고전력 과도 가동 경보   (W)

  // ── 지속 시간 ─────────────────────────────────────────────────────────────
  // 단위: 분(minute). 조건이 이 시간 연속으로 유지돼야 이벤트 발생.
  ENERGY_DETECT_MIN:   3, // 에너지낭비 조건 지속 → 감지 이벤트
  ENERGY_RESOLVE_MIN:  5, // 정상 조건 지속       → 해소 이벤트
  NO_MOTION_AWAY_MIN: 15, // 모션 없음 → 외출로 판단 (에너지낭비 판정에 사용)
  DOOR_OPEN_MIN:      15, // 문열림 지속 → 민원 이벤트
  CHECKOUT_GRACE_MIN: 20, // 체크아웃 시각 이후 유예 기간
  CHECKOUT_ABSENT_MIN:15, // 유예 후 모션 없음 → 퇴실 확정

  // ── 전력 센서 없을 때 fallback (실내외 온도차 기준) ─────────────────────
  FALLBACK_SUMMER_DIFF: 4, // 실내 < 실외 - 이값 → 과냉방 추정 (°C)
  FALLBACK_WINTER_DIFF: 6, // 실내 > 실외 + 이값 → 과난방 추정 (°C)

  // ── EXIT / ENTRY 시맨틱 이벤트 감지 (SensorEventGenerator) ───────────────
  // EXIT: ① 모션 있음 → ② 문열림닫힘 → ③ N분 모션 없음
  EXIT_LOOKBACK_MIN:   10, // ①: 문 열리기 직전 이 시간 이내 모션이 있어야 EXIT 후보
  EXIT_NO_MOTION_MIN:   5, // ③: 문 닫힌 후 N분간 모션 없으면 EXIT 확정
  // ENTRY: ① 문열림닫힘 → ② 모션 감지 → ③ 모션 N분 지속
  ENTRY_SUSTAINED_MIN:  3, // ③: 입실 후 모션 N분 지속 → ENTRY 확정

  // ── 의심 → 확신 (SuspicionTracker) ─────────────────────────────────────
  SUSPICION_EXPIRE_MIN:       120, // 의심 상태 최대 유효 기간 (체크아웃+N분 지나면 취소)
  NO_SHOW_WINDOW_MIN:          60, // 체크인 시각 + N분 경과 → no_show 판정
  EARLY_CHECKOUT_QUIET_MIN:    20, // Case B: EXIT 후 N분 조용 → 조기 퇴실 확인 메시지
  NOISE_QUIET_DB:              40, // 이 미만이면 조용한 것으로 판단 (소음 부재 지표)

  // ── 청소팀 판정 ─────────────────────────────────────────────────────────
  CLEANING_SUSTAINED_MIN: 20, // ENTRY 후 모션 N분 지속 → 청소팀 (게스트 복귀와 구분)
  CLEANING_DONE_QUIET_MIN: 10, // EXIT 후 N분 조용 → 청소 완료
};
