/**
 * futureReportDomain.js — 미래 레포트 순수 함수
 *
 * assessDeviceReadiness(haStates[], now?)  — HA 기기 준비 상태 판정
 * getOccupancyIssues(properties[], now?)  — 체류중 이상 감지
 */

import { OCCUPIED_ISSUE_SUB_STATUSES as ISSUE_SUB_STATUSES } from './reportingDomain.js';

const BATTERY_LOW_THRESHOLD  = 20;   // % 미만
const NO_RESPONSE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24시간

// ── assessDeviceReadiness ─────────────────────────────────────────────────────

/**
 * HA 전체 entity 상태 배열을 받아 기기 준비 상태를 판정한다.
 *
 * 우선순위: offline > no_response > battery_low
 *
 * @param {object[]} haStates  HA /api/states 응답 배열
 * @param {Date}     now       기준 시각 (테스트 주입용, 기본: new Date())
 * @returns {{ total, ready, readyRate, issues }}
 */
export function assessDeviceReadiness(haStates, now = new Date()) {
  if (!haStates.length) return { total: 0, ready: 0, readyRate: null, issues: [] };

  const issues = [];

  for (const s of haStates) {
    const problem = detectProblem(s, now);
    if (problem) {
      issues.push({
        entity_id:    s.entity_id,
        friendly_name: s.attributes?.friendly_name ?? s.entity_id,
        problem,
        detail:       buildDetail(problem, s),
      });
    }
  }

  const total    = haStates.length;
  const ready    = total - issues.length;
  const readyRate = Math.round((ready / total) * 100);

  return { total, ready, readyRate, issues };
}

function detectProblem(state, now) {
  const s = state.state;

  // 1순위: offline
  if (s === 'unavailable' || s === 'unknown') return 'offline';

  // 2순위: no_response (last_updated 있을 때만)
  if (state.last_updated) {
    const elapsed = now.getTime() - new Date(state.last_updated).getTime();
    if (elapsed > NO_RESPONSE_THRESHOLD_MS) return 'no_response';
  }

  // 3순위: battery_low (battery_level 속성 있을 때만)
  const bat = state.attributes?.battery_level;
  if (bat != null && bat < BATTERY_LOW_THRESHOLD) return 'battery_low';

  return null;
}

function buildDetail(problem, state) {
  if (problem === 'battery_low') return `배터리 ${state.attributes.battery_level}%`;
  if (problem === 'offline')     return '기기 오프라인';
  if (problem === 'no_response') return '응답 없음 (24시간 초과)';
  return '';
}

// ── getOccupancyIssues ────────────────────────────────────────────────────────

/**
 * 현재 체류중(OCCUPIED) 숙소 중 이상 서브 상태인 항목을 반환한다.
 *
 * @param {object[]} properties  RoomStateApp properties 배열
 * @param {Date}     now         기준 시각 (테스트 주입용)
 * @returns {{ issueCount, items }}
 */
export function getOccupancyIssues(properties, now = new Date()) {
  const items = properties
    .filter(p => p.currentState?.mainStatus === 'OCCUPIED')
    .filter(p => ISSUE_SUB_STATUSES.has(p.currentState?.subStatus))
    .map(p => ({
      property_id:     p.id,
      name:            p.name,
      subStatus:       p.currentState.subStatus,
      remainingNights: calcRemainingNights(p.reservation?.checkOut, now),
    }));

  return { issueCount: items.length, items };
}

function calcRemainingNights(checkOut, now) {
  if (!checkOut) return null;
  const diffMs = new Date(checkOut).getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
