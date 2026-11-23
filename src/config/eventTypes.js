export const EVENT_TYPES = Object.freeze({
  // 상태 기계 이벤트 (is_soft: false)
  CHECK_IN_DETECTED: "check_in_detected",
  CHECK_OUT_DETECTED: "check_out_detected",
  SCHEDULED_CHECKOUT_REACHED: "scheduled_checkout_reached",
  SCHEDULED_CHECKIN_REACHED: "scheduled_checkin_reached",
  // 스케줄 안에서 기대한 일이 확인되지 않음 — 상태 변경 없음, 운영자에게 넘김 (DEC-10·11·16)
  LATE_CHECKOUT_DETECTED: "late_checkout_detected",
  CHECKIN_NOT_DETECTED: "checkin_not_detected",
  DETECTION_UNCONFIRMABLE: "detection_unconfirmable", // 그 시각에 감지 센서가 꺼져 있거나 감시가 멈춰 있어 확인할 수 없음
  // 옛 기록 — 감지 센서 30분 꺼짐 알림(RF-28)은 퇴실·입실 전 사전 점검으로 바뀌었다(DEC-12). 지금은 내지 않는다
  SENSOR_OFFLINE_DETECTED: "sensor_offline_detected",
  SENSOR_OFFLINE_RESOLVED: "sensor_offline_resolved",
  CLEANING_STARTED: "cleaning_started",
  CLEANING_FINISHED: "cleaning_finished",
  // 청소 일정(DEC-17) — 상태는 일정대로, 실제 청소 시각은 따로 기록(청소시간 준수 지표)
  SCHEDULED_CLEANING_STARTED: "scheduled_cleaning_started",
  SCHEDULED_CLEANING_FINISHED: "scheduled_cleaning_finished",
  CLEANING_ACTIVITY_STARTED: "cleaning_activity_started",
  CLEANING_ACTIVITY_FINISHED: "cleaning_activity_finished",
  CLEANING_NOT_DETECTED: "cleaning_not_detected", // 배정된 청소 시간 동안 담당자가 보이지 않음 — 운영자에게 넘김
  ENERGY_WASTE_DETECTED: "energy_waste_detected",
  ENERGY_WASTE_RESOLVED: "energy_waste_resolved",
  // VACANT 기간 전용 — OCCUPIED 에너지낭비와 구분
  VACANT_ENERGY_WASTE_DETECTED: "vacant_energy_waste_detected",
  VACANT_ENERGY_WASTE_RESOLVED: "vacant_energy_waste_resolved",
  // 퇴실 직후 (CLEANING 전) — HA 센서 기반 감지
  POST_CHECKOUT_ENERGY_WASTE_DETECTED:    "post_checkout_energy_waste_detected",    // 퇴실 후 조명/냉난방 켜진 상태 감지
  POST_CHECKOUT_SECURITY_BREACH_DETECTED: "post_checkout_security_breach_detected", // 퇴실 후 문/창문/재실센서 감지
  // 청소 완료 후 공실 기간 — HA 센서 기반 감지
  POST_CLEANING_SECURITY_BREACH_DETECTED: "post_cleaning_security_breach_detected", // 청소 완료 후 보안 침해 감지
  COMPLAINT_DETECTED: "complaint_detected",
  COMPLAINT_RESOLVED: "complaint_resolved",
  CHECKIN_PREP_TIME_REACHED: "checkin_prep_time_reached",
  OPTIMIZATION_FINISHED: "optimization_finished",
  OPTIMIZATION_FAILED: "optimization_failed",
  OPTIMIZATION_SKIPPED: "optimization_skipped",
  OPTIMIZATION_CANCELLED: "optimization_cancelled",
  RESERVATION_CANCELLED: "reservation_cancelled",

  // 글로벌 이벤트 (미구현 — 상수만 선언)
  MAINTENANCE_REQUIRED: "maintenance_required",
  MAINTENANCE_STARTED: "maintenance_started",
  MAINTENANCE_FINISHED: "maintenance_finished",

  // Soft 이벤트 (is_soft: true — 상태 변경 없음)
  CHECKOUT_CONFIRMATION_NEEDED: "checkout_confirmation_needed",
  EARLY_CHECKIN_SUSPECTED: "early_checkin_suspected",
  NO_SHOW_SUSPECTED: "no_show_suspected", // 옛 기록 — 입실 미감지 문제(checkin_not_detected)로 바뀌었다(DEC-16)
  // 퇴실·입실 하루 전·2시간 전 감지 센서 사전 점검에서 꺼진 센서 발견 — 문제가 아니라 미리 알림 (DEC-12)
  SENSOR_PRECHECK_FAILED: "sensor_precheck_failed",
});

export const SOFT_EVENT_TYPES = new Set([
  "checkout_confirmation_needed",
  "early_checkin_suspected",
  "no_show_suspected",
  "sensor_precheck_failed",
]);

// 청소 운영 문제 — 서버(청소 API·후속 처리)가 직접 events 표에 남긴다, 상태 변경 없음 (RF-32).
// EVENT_TYPES(= Pi 입구가 받는 종류)에 넣지 않는다 — Pi 키로 가짜 문제를 넣거나 서버 기록 자리를 먼저 차지하지 못하게
export const SERVER_PROBLEM_EVENT_TYPES = Object.freeze({
  CLEANING_UNASSIGNED_AT_START: "cleaning_unassigned_at_start",
});

// Pi 입구(/api/events/write)는 저장만 한다(RF-06). Pi가 운영자에게 넘기는 것만 처음 저장될 때 Slack을 보낸다 (DEC-11·16)
// 이름표: Slack 한 줄에 쓰는 무엇이 · 무엇을 해 달라는지
export const OPERATOR_ALERT_LABELS = Object.freeze({
  late_checkout_detected: "퇴실 지연 — 퇴실이 확인되지 않아 청소 모드를 켜지 않았어요. 확인 후 직접 켜 주세요",
  checkin_not_detected: "입실 미감지 — 입실 시각이 지나도 입실이 확인되지 않았어요. 기기 상태를 직접 확인해 주세요",
  detection_unconfirmable: "확인 불가 — 감지 센서가 꺼져 있거나 감시가 멈춰 있어 퇴실·입실·청소를 확인할 수 없어요. 직접 확인하고 처리해 주세요",
  cleaning_not_detected: "청소 미감지 — 청소 시간 동안 담당자가 들어온 것이 보이지 않았어요. 청소가 됐는지 직접 확인해 주세요",
  sensor_precheck_failed: "센서 점검 — 퇴실·입실 전에 감지 센서가 꺼져 있어요. 그 전에 확인해 주세요",
});
export const OPERATOR_ALERT_EVENT_TYPES = new Set(Object.keys(OPERATOR_ALERT_LABELS));

// 미구현 이벤트 (Zod 검증 통과시키되 파이프라인 처리 건너뜀)
export const UNIMPLEMENTED_EVENT_TYPES = new Set([
  "maintenance_required",
  "maintenance_started",
  "maintenance_finished",
  "checkin_prep_time_reached",
  "optimization_finished",
  "reservation_cancelled",
]);
