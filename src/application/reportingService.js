import { getPeriodRange, countCurrentStats, countPeriodEvents } from "../domain/reportingDomain.js";
import { getRoomState, setRoomState } from "../infrastructure/kvStore.js";
import { queryEvents, getLastKnownStateFromDB } from "../infrastructure/eventRepository.js";

// content-guide.md 규칙 준수: 한 문장에 숫자 최대 2개, 내부 상태명 노출 금지

/**
 * 기간과 KPI 통계를 받아 운영자용 요약 문장을 생성한다.
 *
 * now 형태:   { occupied, preStayReady, vacant, cleaning, anomalyCount, total }
 * 나머지 형태: { checkIns, checkOuts, anomalies, energyWaste }
 *
 * @param {string} period
 * @param {object} stats
 * @returns {string}
 */
export function generateSummary(period, stats) {
  if (period === "now") {
    if (stats.anomalyCount > 0) {
      return `현재 이상 징후 ${stats.anomalyCount}건이 확인됐어요. 바로 확인이 필요해요.`;
    }
    return `현재 ${stats.total}개 숙소 정상 운영 중이에요.`;
  }

  if (period === "this_week" || period === "this_month") {
    const prefix = period === "this_week" ? "이번 주" : "이번 달";
    if (stats.anomalies > 0) {
      return `${prefix} 이상감지 ${stats.anomalies}건이 있어요.`;
    }
    return `${prefix} 체크인 ${stats.checkIns}건, 체크아웃 ${stats.checkOuts}건이에요.`;
  }

  if (period === "last_week" || period === "last_month") {
    const prefix = period === "last_week" ? "지난주" : "지난달";
    if (stats.anomalies > 0) {
      return `${prefix} 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`;
    }
    return `${prefix} 체크인 ${stats.checkIns}건 완료, 이상 없었어요.`;
  }

  if (period === "next_week" || period === "next_month") {
    const unit = period === "next_week" ? "주" : "달";
    if (stats.checkIns > 0) {
      return `다음 ${unit} 체크인 ${stats.checkIns}건 예정이에요.`;
    }
    return `다음 ${unit} 예약이 없어요.`;
  }

  return "";
}

/**
 * 기간별 KPI를 조회한다.
 * now: KV 룸 상태 기반 실시간 집계
 * 나머지: DB 이벤트 기반 기간 집계
 *
 * @param {string} period
 * @param {{ db: object, kv: object, propertyId?: string }} deps
 * @returns {Promise<{ period, stats, summary, range? }>}
 */
export async function getStatsForPeriod(period, { db, kv, propertyId = null }) {
  if (period === "now") {
    let properties = [];

    if (propertyId) {
      let state = await getRoomState(kv, propertyId);
      if (!state) {
        // KV TTL 만료 → DB에서 마지막 상태를 읽어 캐시 재적재
        state = await getLastKnownStateFromDB(db, propertyId);
        if (state) await setRoomState(kv, propertyId, state);
      }
      if (state) properties = [state];
    } else {
      const keys = await kv.keys("state:*");
      const states = await Promise.all(
        keys.map((key) => {
          const id = key.replace("state:", "");
          return getRoomState(kv, id);
        })
      );
      properties = states.filter(Boolean);
    }

    const stats = countCurrentStats(properties);
    const summary = generateSummary("now", stats);
    return { period: "now", stats, summary };
  }

  const range = getPeriodRange(period);
  const events = await queryEvents(db, range, propertyId);
  const stats = countPeriodEvents(events);
  const summary = generateSummary(period, stats);
  return {
    period,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    stats,
    summary,
  };
}
