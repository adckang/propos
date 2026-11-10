/**
 * useFutureCleaningStats — 앞으로 할 청소 작업 목록(/api/cleaning/stats?items=true)을 가져온다.
 *
 * 레포트 [예정](FutureMatrixPanel)과 대시보드 캘린더(MonthlyCalendar)가 같이 쓴다. 대시보드는 두 부품이 같은
 * 기간·숙소를 그리는데, 예전엔 각자 같은 요청을 한 번씩 보냈다(ACT-14). 이제 대시보드(MonthlyView)가
 * FutureCleaningProvider 로 한 번 받아 두 부품에 같은 응답을 나눠 준다 — 레포트는 통계를 받은 뒤에야 그려져서
 * "동시에 나간 같은 요청 합치기"만으로는 다음달에 요청이 두 번 나갔다(브라우저 확인).
 * 공급자가 없거나 기간·숙소가 다르면(리스트뷰·숙소 상세) 부품이 직접 받는다.
 * 응답을 저장해 두지는 않는다 — 요청이 끝나면 바로 잊으므로 화면을 다시 열면 항상 새로 받는다(s81과 같은 원칙).
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

const inFlight = new Map();
const FutureCleaningContext = createContext(null);
const idsKeyOf = propertyIds => (Array.isArray(propertyIds) ? propertyIds.join(',') : null);

/**
 * 같은 (기간, 숙소) 요청이 진행 중이면 그 요청을 같이 기다린다. 성공·실패와 관계없이 끝나면 잊는다.
 * @param {string} period
 * @param {string[]|null} propertyIds  null·빈 배열 = 숙소 지정 없음(서버가 권한 범위 전체)
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 서버 응답 JSON
 */
export function requestFutureCleaningStats(period, propertyIds = null, fetchImpl = globalThis.fetch) {
  const params = new URLSearchParams({ period, items: 'true' });
  if (Array.isArray(propertyIds) && propertyIds.length > 0) params.set('property_ids', propertyIds.join(','));
  const url = `/api/cleaning/stats?${params}`;
  const pending = inFlight.get(url);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => fetchImpl(url))
    .then(response => (response.ok ? response.json() : Promise.reject(new Error(`cleaning stats API ${response.status}`))))
    .finally(() => { inFlight.delete(url); });
  inFlight.set(url, request);
  return request;
}

/** 공급자가 받은 것과 부품이 원하는 것(기간·숙소)이 같을 때만 공급자 응답을 쓴다 */
export function sharesFutureCleaning(shared, period, propertyIds) {
  return !!period && shared?.period === period && shared.idsKey === idsKeyOf(propertyIds);
}

/**
 * 화면 하나(대시보드)가 청소 작업 목록을 한 번 받아 안쪽 부품들에 나눠 준다.
 * @param {{ period: string|null, propertyIds: string[]|null, children: any }} props  period 가 null 이면 받지 않는다
 */
export function FutureCleaningProvider({ period, propertyIds = null, children }) {
  const state = useFetchedFutureCleaning(period, propertyIds);
  const idsKey = idsKeyOf(propertyIds);
  const value = useMemo(() => ({ period, idsKey, state }), [period, idsKey, state]);
  return createElement(FutureCleaningContext.Provider, { value }, children);
}

/**
 * @param {string|null} period  null 이면 가져오지 않는다(지난 기간·숙소 미선택)
 * @param {string[]|null} propertyIds
 * @returns {{ data: object|null, loading: boolean, error: string|null }}
 */
export function useFutureCleaningStats(period, propertyIds = null) {
  const shared = useContext(FutureCleaningContext);
  const fromProvider = sharesFutureCleaning(shared, period, propertyIds);
  const own = useFetchedFutureCleaning(fromProvider ? null : period, propertyIds);
  return fromProvider ? shared.state : own;
}

function useFetchedFutureCleaning(period, propertyIds) {
  const idsKey = idsKeyOf(propertyIds);
  const requestKey = period ? `${period}|${idsKey ?? ''}` : null;
  const [state, setState] = useState(() => ({ key: requestKey, data: null, loading: !!period, error: null }));

  useEffect(() => {
    if (!period) {
      setState({ key: null, data: null, loading: false, error: null });
      return;
    }
    let cancelled = false; // 선택이 빠르게 바뀔 때 늦게 도착한 이전 응답이 최신 값을 덮지 않도록
    setState({ key: requestKey, data: null, loading: true, error: null });
    requestFutureCleaningStats(period, propertyIds)
      .then(data => { if (!cancelled) setState({ key: requestKey, data, loading: false, error: null }); })
      .catch(error => { if (!cancelled) setState({ key: requestKey, data: null, loading: false, error: error?.message ?? String(error) }); });
    return () => { cancelled = true; };
  }, [period, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return stateForRequest(state, requestKey);
}

/**
 * 기간·숙소가 바뀐 첫 렌더에는 이전 요청의 응답이 아직 남아 있다(효과는 그린 뒤에 돈다) — 다른 달의 청소 작업을
 * 이번 퇴실과 맞추지 않게, 지금 요청의 응답이 아니면 "받는 중"으로 본다.
 * @param {{ key: string|null, data: object|null, loading: boolean, error: string|null }} state
 * @param {string|null} requestKey  `${period}|${숙소}` — null 이면 받지 않는 상태
 */
export function stateForRequest(state, requestKey) {
  if (state.key === requestKey) return state;
  return { data: null, loading: requestKey != null, error: null };
}
