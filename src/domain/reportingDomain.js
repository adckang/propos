// 모든 함수는 순수 함수 — 외부 의존 없음

/**
 * 기간 키를 ISO 월요일 시작 주 또는 달 범위로 변환한다.
 * @param {string} period - 'now' | 'this_week' | 'last_week' | 'next_week' | 'this_month' | 'last_month' | 'next_month'
 * @param {Date} referenceDate
 * @returns {{ from: Date, to: Date } | null}
 */
export function getPeriodRange(period, referenceDate = new Date()) {
  if (period === "now") return null;

  const y = referenceDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth(); // 0-indexed
  const d = referenceDate.getUTCDate();

  if (period === "this_week" || period === "last_week" || period === "next_week") {
    const dow = referenceDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToMonday = dow === 0 ? 6 : dow - 1;
    const thisMonday = new Date(Date.UTC(y, m, d - daysToMonday));

    let weekOffset = 0;
    if (period === "last_week") weekOffset = -7;
    else if (period === "next_week") weekOffset = 7;

    const from = new Date(thisMonday.getTime() + weekOffset * 86400000);
    const to = new Date(from.getTime() + 6 * 86400000);
    to.setUTCHours(23, 59, 59, 999);
    return { from, to };
  }

  if (period === "this_month" || period === "last_month" || period === "next_month") {
    let targetYear = y;
    let targetMonth = m; // 0-indexed

    if (period === "last_month") {
      targetMonth -= 1;
      if (targetMonth < 0) { targetMonth = 11; targetYear -= 1; }
    } else if (period === "next_month") {
      targetMonth += 1;
      if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }
    }

    const from = new Date(Date.UTC(targetYear, targetMonth, 1));
    const to = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999));
    return { from, to };
  }

  throw new Error(`unknown period: "${period}"`);
}

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
    cleaning: 0,
    anomalyCount: 0,
    total: properties.length,
  };

  for (const { mainStatus, subStatus } of properties) {
    if (mainStatus === "OCCUPIED") {
      result.occupied += 1;
      if (subStatus === "ISSUE_COMPLAINT" || subStatus === "ISSUE_AND_ENERGY") {
        result.anomalyCount += 1;
      }
    } else if (mainStatus === "PRE_STAY_READY") {
      result.preStayReady += 1;
    } else if (mainStatus === "VACANT") {
      result.vacant += 1;
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
 * @param {Array<{ type: string }>} events
 * @returns {{ checkIns, checkOuts, anomalies, energyWaste }}
 */
export function countPeriodEvents(events) {
  const result = { checkIns: 0, checkOuts: 0, anomalies: 0, energyWaste: 0 };

  for (const { type } of events) {
    if (type === "check_in_detected") result.checkIns += 1;
    else if (type === "check_out_detected") result.checkOuts += 1;
    else if (type === "complaint_detected") result.anomalies += 1;
    else if (type === "energy_waste_detected") {
      result.energyWaste += 1;
      result.anomalies += 1;
    }
  }

  return result;
}
