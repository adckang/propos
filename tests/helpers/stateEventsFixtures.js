/**
 * 현재 상태 조회용 가짜 DB.
 *
 * histories: { [숙소]: [이벤트 종류, ...] }  — 시간 오름차순 이벤트 기록.
 * 실제 조회(getLastKnownStatesFromDB)와 같은 규칙으로 답한다: 숙소마다 "마지막 큰 상태 변화"와
 * 그 뒤의 세부 이벤트만 돌려주고, 큰 변화가 한 번도 없는 숙소는 결과에 없다.
 * (실제 SQL 자체는 실제 Postgres 엔진에서 따로 검증한다 — 여기서는 서비스 로직 시나리오용)
 */

import { ANCHOR_EVENT_TYPES, FOLLOW_EVENT_TYPES } from "../../src/domain/roomStateFromEventsDomain.js";

const ANCHORS = new Set(ANCHOR_EVENT_TYPES);
const FOLLOWS = new Set(FOLLOW_EVENT_TYPES);

export function makeStateDb(histories) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const wanted = params?.[1]; // null = 기록이 있는 모든 숙소
      const rows = [];
      for (const [propertyId, types] of Object.entries(histories)) {
        if (wanted && !wanted.includes(propertyId)) continue;
        const lastAnchorIndex = types.reduce((last, t, i) => (ANCHORS.has(t) ? i : last), -1);
        if (lastAnchorIndex < 0) continue;
        const anchor = types[lastAnchorIndex];
        const follows = types.slice(lastAnchorIndex + 1).filter((t) => FOLLOWS.has(t));
        if (follows.length === 0) rows.push({ property_id: propertyId, anchor_type: anchor, follow_type: null });
        else for (const f of follows) rows.push({ property_id: propertyId, anchor_type: anchor, follow_type: f });
      }
      return { rows };
    },
  };
}
