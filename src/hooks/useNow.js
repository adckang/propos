import { useEffect, useState } from 'react';

/**
 * 현재 시각 (기본 1분마다 갱신) — 캘린더의 "지금" 표시가 화면을 켜 둔 채로도 따라가도록.
 * 리스트 화면의 지금 표시(useLiveNow)와 같은 60초 주기.
 */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
