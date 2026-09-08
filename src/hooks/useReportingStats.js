import { useState, useEffect } from 'react';

/** 실데이터 없을 때 UI 확인용 데모 데이터 */
const DEMO_STATS = {
  now:        { checkIns: 2, checkOuts: 1, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
  today:      { checkIns: 2, checkOuts: 3, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 1, checkoutConfirmationNeeded: 0 },
  this_week:  { checkIns: 9, checkOuts: 8, anomalies: 1, energyWaste: 1, noShowSuspected: 0, earlyCheckinSuspected: 2, checkoutConfirmationNeeded: 1 },
  this_month: { checkIns: 23, checkOuts: 21, anomalies: 2, energyWaste: 1, noShowSuspected: 1, earlyCheckinSuspected: 3, checkoutConfirmationNeeded: 1 },
  yesterday:  { checkIns: 3, checkOuts: 4, anomalies: 1, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 1 },
  last_week:  { checkIns: 11, checkOuts: 10, anomalies: 2, energyWaste: 2, noShowSuspected: 1, earlyCheckinSuspected: 1, checkoutConfirmationNeeded: 0 },
  last_month: { checkIns: 38, checkOuts: 37, anomalies: 4, energyWaste: 3, noShowSuspected: 2, earlyCheckinSuspected: 4, checkoutConfirmationNeeded: 2 },
  last_hour:  { checkIns: 0, checkOuts: 1, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
  tomorrow:   { checkIns: 2, checkOuts: 3, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
  next_week:  { checkIns: 7, checkOuts: 6, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
  next_month: { checkIns: 20, checkOuts: 19, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
  next_hour:  { checkIns: 1, checkOuts: 0, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 },
};

function isEmptyStats(stats) {
  if (!stats) return true;
  return Object.values(stats).every(v => !v);
}

/**
 * /api/stats 호출 훅.
 * period가 바뀔 때마다 재요청. propertyId null이면 전체 숙소 집계.
 * API 실패 또는 데이터 없을 때 DEMO_STATS fallback 사용.
 *
 * @param {string} period
 * @param {string|null} propertyId
 * @returns {{ stats: object|null, summary: string, loading: boolean, error: string|null }}
 */
export function useReportingStats(period, propertyId = null) {
  const [state, setState] = useState({ stats: null, summary: '', loading: true, error: null });

  useEffect(() => {
    // period null → 스킵 (조건부 fetching)
    if (!period) {
      setState({ stats: null, summary: '', loading: false, error: null });
      return;
    }

    let cancelled = false;
    // stats/summary는 유지 (stale-while-revalidating) — 깜빡임 방지
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
        const real = data.stats ?? null;
        const stats = isEmptyStats(real) ? (DEMO_STATS[period] ?? null) : real;
        setState({ stats, summary: data.summary ?? '', loading: false, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        // API 실패 시 데모 데이터 fallback
        const stats = DEMO_STATS[period] ?? null;
        setState(s => ({ ...s, stats: s.stats ?? stats, loading: false, error: err.message }));
      });

    return () => { cancelled = true; };
  }, [period, propertyId]);

  return state;
}
