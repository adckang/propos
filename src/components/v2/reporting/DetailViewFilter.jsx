/**
 * Detail View 좌측 타임라인 네비게이터 — 2열 레이아웃
 *   좌열: 일 / 시  (모드 토글, 세로)
 *   우열: 전날 / 오늘 / 내일  또는  −1h / 지금 / +1h  (네비, 세로)
 *
 * Props:
 *   dayOffset          — 일 단위 오프셋 (0=오늘, ±N=N일)
 *   onDayOffsetChange  — (nextOffset) => void
 *   mode               — 'day' | 'hour'
 *   onModeChange       — ('day'|'hour') => void
 *   hourPeriod         — 'last_hour' | 'now' | 'next_hour'
 *   onHourPeriodChange — (p) => void
 *   isMobile
 */

const DAY_NAV = [
  { key: 'prev',  label: '전날', getActive: (d) => d < 0,  onClick: (d, set) => set(d - 1) },
  { key: 'today', label: '오늘', getActive: (d) => d === 0, onClick: (_, set) => set(0), isCenter: true },
  { key: 'next',  label: '내일', getActive: (d) => d > 0,  onClick: (d, set) => set(d + 1) },
];

const HOUR_NAV = [
  { key: 'last_hour', label: '−1h',  isCenter: false },
  { key: 'now',       label: '지금',  isCenter: true  },
  { key: 'next_hour', label: '+1h',  isCenter: false },
];

export default function DetailViewFilter({
  dayOffset, onDayOffsetChange,
  mode, onModeChange,
  hourPeriod, onHourPeriodChange,
  isMobile = false,
}) {
  const btnBase = {
    border: '1.5px solid',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: isMobile ? 10 : 11,
    fontWeight: 600,
    transition: 'all 0.15s',
    width: '100%',
    lineHeight: 1.2,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
  };

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: isMobile ? '7px 6px' : '9px 8px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
      height: isMobile ? 72 : 86,
      boxSizing: 'border-box',
      flexShrink: 0,
    }}>

      {/* 좌열: 일 / 시 모드 토글 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: isMobile ? 26 : 30, overflow: 'hidden' }}>
        {['day', 'hour'].map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                ...btnBase,
                flex: 1,
                borderColor: active ? '#1a202c' : '#e2e8f0',
                background: active ? '#1a202c' : '#fff',
                color: active ? '#fff' : '#94a3b8',
                fontWeight: 700,
              }}
            >
              {m === 'day' ? '일' : '시'}
            </button>
          );
        })}
      </div>

      {/* 우열: 네비게이션 버튼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'hidden' }}>
        {mode === 'day'
          ? DAY_NAV.map(({ key, label, getActive, onClick, isCenter }) => {
              const active = getActive(dayOffset);
              return (
                <button
                  key={key}
                  onClick={() => onClick(dayOffset, onDayOffsetChange)}
                  style={{
                    ...btnBase,
                    flex: 1,
                    borderColor: active ? '#1a202c' : '#e2e8f0',
                    background: active ? '#1a202c' : isCenter ? '#f8fafc' : '#fff',
                    color: active ? '#fff' : isCenter ? '#374151' : '#94a3b8',
                    fontWeight: active ? 700 : isCenter ? 600 : 500,
                  }}
                >
                  {label}
                </button>
              );
            })
          : HOUR_NAV.map(({ key, label, isCenter }) => {
              const active = hourPeriod === key;
              return (
                <button
                  key={key}
                  onClick={() => onHourPeriodChange(key)}
                  style={{
                    ...btnBase,
                    flex: 1,
                    borderColor: active ? '#1a202c' : '#e2e8f0',
                    background: active ? '#1a202c' : isCenter ? '#f8fafc' : '#fff',
                    color: active ? '#fff' : isCenter ? '#374151' : '#94a3b8',
                    fontWeight: active ? 700 : isCenter ? 600 : 500,
                  }}
                >
                  {label}
                </button>
              );
            })
        }
      </div>

    </div>
  );
}
