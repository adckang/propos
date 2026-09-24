import { useEffect, useState } from 'react';

export function useMonthlyCalendar(period, propertyIds = null) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const idsKey = Array.isArray(propertyIds) ? propertyIds.join(',') : null;

  useEffect(() => {
    if (!period) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState(current => ({ ...current, loading: true, error: null }));
    const params = new URLSearchParams({ period });
    if (Array.isArray(propertyIds) && propertyIds.length > 0) {
      params.set('property_ids', propertyIds.join(','));
    }

    fetch(`/api/stats/calendar?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`calendar API ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ data: null, loading: false, error: error.message });
      });

    return () => { cancelled = true; };
  }, [period, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
