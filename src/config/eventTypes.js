export const EVENT_TYPES = Object.freeze({
  // 상태 기계 이벤트 (is_soft: false)
  CHECK_IN_DETECTED: "check_in_detected",
  CHECK_OUT_DETECTED: "check_out_detected",
  CLEANING_STARTED: "cleaning_started",
  CLEANING_FINISHED: "cleaning_finished",
  ENERGY_WASTE_DETECTED: "energy_waste_detected",
  ENERGY_WASTE_RESOLVED: "energy_waste_resolved",
  COMPLAINT_DETECTED: "complaint_detected",
  COMPLAINT_RESOLVED: "complaint_resolved",
  CHECKIN_PREP_TIME_REACHED: "checkin_prep_time_reached",
  OPTIMIZATION_FINISHED: "optimization_finished",
  RESERVATION_CANCELLED: "reservation_cancelled",

  // 글로벌 이벤트 (미구현 — 상수만 선언)
  MAINTENANCE_REQUIRED: "maintenance_required",
  MAINTENANCE_STARTED: "maintenance_started",
  MAINTENANCE_FINISHED: "maintenance_finished",

  // Soft 이벤트 (is_soft: true — 상태 변경 없음)
  CHECKOUT_CONFIRMATION_NEEDED: "checkout_confirmation_needed",
  EARLY_CHECKIN_SUSPECTED: "early_checkin_suspected",
  NO_SHOW_SUSPECTED: "no_show_suspected",
});

export const SOFT_EVENT_TYPES = new Set([
  "checkout_confirmation_needed",
  "early_checkin_suspected",
  "no_show_suspected",
  "vacancy_energy_alert",   // VACANT 상태 에너지낭비 — State Machine 외부. 안심지수 분모 미포함.
]);

// 미구현 이벤트 (Zod 검증 통과시키되 파이프라인 처리 건너뜀)
export const UNIMPLEMENTED_EVENT_TYPES = new Set([
  "maintenance_required",
  "maintenance_started",
  "maintenance_finished",
  "checkin_prep_time_reached",
  "optimization_finished",
  "reservation_cancelled",
]);
