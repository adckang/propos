// 모든 함수는 순수 함수 — 외부 의존 없음

import { periodToDateRange } from "./periodDomain.js";

/**
 * 기간 키 → 이벤트 집계용 날짜 범위 (끝 포함: to = 다음 경계 - 1ms).
 * 날짜 계산 자체는 periodDomain.periodToDateRange 하나가 한다 — 화면·서버·패턴 분석·데모가 같은 구간을 본다
 * (예전엔 여기에 주·일·월 계산이 따로 있었고, 화면용엔 "지난달"이 아예 없었다).
 * @param {string} period
 * @param {Date} referenceDate
 * @returns {{ from: Date, to: Date } | null}  null = 실시간(범위 없음)
 */
export function getPeriodRange(period, referenceDate = new Date()) {
  if (period === "now") return null;
  const range = periodToDateRange(period, referenceDate.getTime());
  if (!range) throw new Error(`unknown period: "${period}"`);
  return { from: range.from, to: new Date(range.to.getTime() - 1) };
}

/**
 * 체류중(OCCUPIED) 숙소의 "이상" 서브 상태. 현재 레포트·리스트 긴급 표시·체류중 이상 감지가
 * 모두 이 정의를 공유한다 (report-architecture §6-1: 체류 중 민원·에너지낭비는 이상, 공실 에너지낭비는 별도 카운터).
 */
export const OCCUPIED_ISSUE_SUB_STATUSES = new Set([
  "ISSUE_COMPLAINT",
  "ISSUE_AND_ENERGY",
  "ENERGY_WASTE",
]);

/**
 * 실시간 숙소 목록에서 현재 상태 KPI를 집계한다.
 * room-state-machine.md 기준 mainStatus / subStatus 사용.
 * @param {Array<{ mainStatus: string, subStatus: string }>} properties
 * @returns {{ occupied, preStayReady, vacant, cleaning, anomalyCount, total }}
 */
export function countCurrentStats(properties) {
  const result = {
    occupied: 0,
    preStayReady: 0,
    vacant: 0,
    vacantEnergyWaste: 0,
    cleaning: 0,
    anomalyCount: 0,
    total: properties.length,
  };

  for (const { mainStatus, subStatus } of properties) {
    if (mainStatus === "OCCUPIED") {
      result.occupied += 1;
      if (OCCUPIED_ISSUE_SUB_STATUSES.has(subStatus)) result.anomalyCount += 1;
    } else if (mainStatus === "PRE_STAY_READY") {
      result.preStayReady += 1;
    } else if (mainStatus === "VACANT") {
      result.vacant += 1;
      if (subStatus === "ENERGY_WASTE") result.vacantEnergyWaste += 1;
    } else if (mainStatus === "CLEANING") {
      result.cleaning += 1;
    }
  }

  return result;
}

/**
 * 기간 이벤트 목록에서 KPI를 집계한다.
 * anomalies = complaint_detected + energy_waste_detected
 * energyWaste = energy_waste_detected만
 * softEvents = no_show_suspected + early_checkin_suspected + checkout_confirmation_needed
 *
 * 7개 운영 지표용 추가 필드:
 *   preStayAttempts    — checkin_prep_time_reached (입실 준비 시작)
 *   preStayOptimized   — optimization_finished (최적화 완료)
 *   cleaningFinished   — cleaning_finished (청소 완료, 지표 4~6 분모)
 *   cleaningOnTime     — 3시간 이내 완료 건수 (API 레이어에서 주입)
 *   cleaningAssigned   — 할당된 cleaning_job 수 (reportingService.getStatsForPeriod가 주입)
 *   cleaningCreated    — 생성된 cleaning_job 수 (CANCELLED 제외, reportingService가 주입)
 *
 * HA 센서 기반 감지 이벤트 (퇴실 후 / 청소 완료 후):
 *   postCheckoutEnergyWaste   — post_checkout_energy_waste_detected (퇴실 후 조명/냉난방 감지)
 *   postCheckoutSecurityBreach — post_checkout_security_breach_detected (퇴실 후 문/창문/재실센서)
 *   postCleaningSecurityBreach — post_cleaning_security_breach_detected (청소 완료 후 보안 침해)
 *
 * @param {Array<{ type: string }>} events
 */
export function countPeriodEvents(events) {
  const result = {
    checkIns: 0,
    checkOuts: 0,
    anomalies: 0,
    energyWaste: 0,
    noShowSuspected: 0,
    earlyCheckinSuspected: 0,
    checkoutConfirmationNeeded: 0,
    vacantEnergyWaste: 0,
    vacantEnergyResolved: 0,
    // 7개 운영 지표
    preStayAttempts: 0,
    preStayOptimized: 0,
    cleaningFinished: 0,
    cleaningOnTime: 0,    // API 레이어 주입 — 이벤트 쌍 시간차 계산 필요 (청소 완료 − 3시간 초과 건)
    cleaningAssigned: 0,  // API 레이어 주입 — cleaning_jobs 테이블
    cleaningCreated: 0,   // API 레이어 주입 — cleaning_jobs 테이블
    // HA 센서 기반 (지표 2, 3, 5)
    postCheckoutEnergyWaste:    0,  // 퇴실 후 절전 위반 건수 (지표 2 역산 분자)
    postCheckoutSecurityBreach: 0,  // 퇴실 후 보안 위반 건수 (지표 3 역산 분자)
    postCleaningSecurityBreach: 0,  // 청소 완료 후 보안 위반 건수 (지표 5 역산 분자)
  };

  for (const { type } of events) {
    if (type === "check_in_detected") result.checkIns += 1;
    else if (type === "check_out_detected") result.checkOuts += 1;
    else if (type === "complaint_detected") result.anomalies += 1;
    else if (type === "energy_waste_detected") {
      result.energyWaste += 1;
      result.anomalies += 1;
    } else if (type === "vacant_energy_waste_detected") result.vacantEnergyWaste += 1;
    else if (type === "vacant_energy_waste_resolved") result.vacantEnergyResolved += 1;
    else if (type === "no_show_suspected") result.noShowSuspected += 1;
    else if (type === "early_checkin_suspected") result.earlyCheckinSuspected += 1;
    else if (type === "checkout_confirmation_needed") result.checkoutConfirmationNeeded += 1;
    // 7개 운영 지표
    else if (type === "checkin_prep_time_reached") result.preStayAttempts += 1;
    else if (type === "optimization_finished") result.preStayOptimized += 1;
    else if (type === "cleaning_finished") result.cleaningFinished += 1;
    // HA 센서 기반 (지표 2, 3, 5)
    else if (type === "post_checkout_energy_waste_detected")    result.postCheckoutEnergyWaste += 1;
    else if (type === "post_checkout_security_breach_detected") result.postCheckoutSecurityBreach += 1;
    else if (type === "post_cleaning_security_breach_detected") result.postCleaningSecurityBreach += 1;
  }

  return result;
}
