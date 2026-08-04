import { useState, useEffect } from 'react';

/**
 * /api/stats 호출 훅.
 * period가 바뀔 때마다 재요청. propertyId null이면 전체 숙소 집계.
 *
 * @param {string} period
 * @param {string|null} propertyId
 * @returns {{ stats: object|null, summary: string, loading: boolean, error: string|null }}
 */
export function useReportingStats(period, propertyId = null) {
  const [state, setState] = useState({ stats: null, summary: '', loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams({ period });
    if (propertyId) params.set('property_id', propertyId);

    fetch(`/api/stats?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`stats API ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        setState({ stats: data.stats ?? null, summary: data.summary ?? '', loading: false, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ stats: null, summary: '', loading: false, error: err.message });
      });

    return () => { cancelled = true; };
  }, [period, propertyId]);

  return state;
}
