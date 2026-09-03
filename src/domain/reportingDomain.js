// 모든 함수는 순수 함수 — 외부 의존 없음

/**
 * 기간 키를 날짜 범위로 변환한다.
 * @param {string} period
 * @param {Date} referenceDate
 * @returns {{ from: Date, to: Date } | null}  null = 실시간(범위 없음)
 */
// KST = UTC+9. 한국 호스트 기준 날짜 경계를 UTC로 변환하기 위한 오프셋.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 날짜 컴포넌트(y/m/d)로부터 하루 범위의 UTC Date 쌍을 반환한다.
 * KST 00:00 = UTC (y,m,d,00:00) - 9h
 */
function kstDayRange(y, m, d) {
  return {
    from: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - KST_OFFSET_MS),
    to:   new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - KST_OFFSET_MS),
  };
}

export function getPeriodRange(period, referenceDate = new Date()) {
  if (period === "now") return null;

  // KST 기준 날짜 컴포넌트 (UTC 날짜가 아닌 KST 날짜 기준으로 분기해야 함)
  const kstRef = new Date(referenceDate.getTime() + KST_OFFSET_MS);
  const y = kstRef.getUTCFullYear();
  const m = kstRef.getUTCMonth();
  const d = kstRef.getUTCDate();

  // 일 단위
  if (period === "yesterday") return kstDayRange(y, m, d - 1);
  if (period === "today")     return kstDayRange(y, m, d);
  if (period === "tomorrow")  return kstDayRange(y, m, d + 1);

  // 시간 단위 (절대 시각 기준 — KST 보정 불필요)
  if (period === "last_hour") {
    const to   = new Date(referenceDate);
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    return { from, to };
  }
  if (period === "next_hour") {
    const from = new Date(referenceDate);
    const to   = new Date(from.getTime() + 60 * 60 * 1000);
    return { from, to };
  }

  // 주 단위 (KST 기준 월요일 00:00 ~ 일요일 23:59)
  if (period === "this_week" || period === "last_week" || period === "next_week") {
    const dow = kstRef.getUTCDay(); // KST 기준 요일
    const daysToMonday = dow === 0 ? 6 : dow - 1;
    const mondayKstDate = d - daysToMonday;

    let weekOffset = 0;
    if (period === "last_week") weekOffset = -7;
    else if (period === "next_week") weekOffset = 7;

    const fromDay = mondayKstDate + weekOffset;
    const from = new Date(Date.UTC(y, m, fromDay, 0, 0, 0, 0) - KST_OFFSET_MS);
    const to   = new Date(Date.UTC(y, m, fromDay + 6, 23, 59, 59, 999) - KST_OFFSET_MS);
    return { from, to };
  }

  // 월 단위 (KST 기준 월 1일 00:00 ~ 말일 23:59)
  if (period === "this_month" || period === "last_month" || period === "next_month") {
    let targetYear = y;
    let targetMonth = m;

    if (period === "last_month") {
      targetMonth -= 1;
      if (targetMonth < 0) { targetMonth = 11; targetYear -= 1; }
    } else if (period === "next_month") {
      targetMonth += 1;
      if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }
    }

    const from = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0) - KST_OFFSET_MS);
    const to   = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999) - KST_OFFSET_MS);
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
