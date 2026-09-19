import { useState, useEffect } from 'react';

/**
 * /api/stats 호출 훅.
 * period가 바뀔 때마다 재요청. propertyIds null이면 전체 숙소 집계.
 *
 * 서버가 준 값은 0이어도 그대로 반환한다 (가짜 수치로 대체하지 않음).
 * API 실패 시 stats=null + error 메시지 — 화면은 "데이터를 불러올 수 없어요"를 표시.
 * dev에서 백엔드 없이 UI를 볼 때의 견본 데이터는 vite.config.mjs의 /api/stats 스텁이 제공.
 *
 * @param {string|null} period - null이면 fetch 스킵
 * @param {string[]|null} propertyIds - null=전체, [...]= 선택된 숙소 ID
 * @returns {{ stats: object|null, summary: string, loading: boolean, error: string|null }}
 */
export function useReportingStats(period, propertyIds = null) {
  const [state, setState] = useState({ stats: null, summary: '', loading: true, error: null });

  // stable key for useEffect dependency — prevents re-render on array reference change
  const idsKey = Array.isArray(propertyIds) ? propertyIds.join(',') : null;

  useEffect(() => {
    // period null → 스킵 (조건부 fetching)
    if (!period) {
      setState({ stats: null, summary: '', loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams({ period });
    if (Array.isArray(propertyIds) && propertyIds.length > 0) {
      params.set('property_ids', propertyIds.join(','));
    }

    fetch(`/api/stats?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`stats API ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        setState({ stats: data.stats ?? null, summary: data.summary || '', loading: false, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ stats: null, summary: '', loading: false, error: err.message });
      });

    return () => { cancelled = true; };
  }, [period, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
