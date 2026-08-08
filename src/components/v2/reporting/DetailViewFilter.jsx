/**
 * Detail View 좌측 타임라인 네비게이터.
 *
 * 바이너리 토글 (일 | 시) + 수직 3행 네비게이터
 *   일 모드: 전날(dayOffset−1) | 오늘/D±N(dayOffset→0) | 다음날(dayOffset+1)
 *   시 모드: 한시간 전 | 지금 | 한시간 후  (hourPeriod 고정값)
 *
 * Props:
 *   dayOffset          — 일 단위 오프셋 (0=오늘, -1=어제, +1=내일 …±7)
 *   onDayOffsetChange  — (nextOffset) => void
 *   mode               — 'day' | 'hour'
 *   onModeChange       — ('day'|'hour') => void
 *   hourPeriod         — 'last_hour' | 'now' | 'next_hour'
 *   onHourPeriodChange — (p) => void
 *   isMobile
 */

const HOUR_ITEMS = [
  { key: 'last_hour', symbol: '−', label: '한시간 전' },
  { key: 'now',       symbol: '○', label: '지금'      },
  { key: 'next_hour', symbol: '+', label: '한시간 후' },
];

function dayLabel(offset) {
  if (offset === 0)  return '오늘';
  if (offset === -1) return '전날';
  if (offset === 1)  return '내일';
  return offset < 0 ? `D${offset}일` : `D+${offset}일`;
}

function daySymbol(offset) {
  if (offset === 0) return '○';
  return offset < 0 ? '−' : '+';
}

export default function DetailViewFilter({
  dayOffset, onDayOffsetChange,
  mode, onModeChange,
  hourPeriod, onHourPeriodChange,
  isMobile = false,
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: isMobile ? '8px 6px' : '10px 8px',
      borderBottom: '1px solid #e2e8f0',
      background: '#fff',
    }}>
      {/* 바이너리 토글 */}
      <div style={{
        display: 'flex',
        border: '1.5px solid #e2e8f0',
        borderRadius: 6,
        overflow: 'hidden',
        width: '100%',
      }}>
        {['day', 'hour'].map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                flex: 1,
                border: 'none',
                padding: '4px 0',
                background: active ? '#1a202c' : '#fff',
                color: active ? '#fff' : '#94a3b8',
                fontSize: isMobile ? 10 : 11,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                letterSpacing: 0.3,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {m === 'day' ? '일' : '시'}
            </button>
          );
        })}
      </div>

      {/* 수직 네비게이터 */}
      {mode === 'day' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* 이전 날 */}
          <NavButton
            symbol="−"
            label="전날"
            active={dayOffset < 0}
            isCenter={false}
            isMobile={isMobile}
            onClick={() => onDayOffsetChange(dayOffset - 1)}
          />
          {/* 현재 위치 (오늘 기준 reset or 현재 dayLabel) */}
          <NavButton
            symbol={daySymbol(dayOffset)}
            label={dayLabel(dayOffset)}
            active={dayOffset === 0}
            isCenter
            isMobile={isMobile}
            onClick={() => onDayOffsetChange(0)}
          />
          {/* 다음 날 */}
          <NavButton
            symbol="+"
            label="다음날"
            active={dayOffset > 0}
            isCenter={false}
            isMobile={isMobile}
            onClick={() => onDayOffsetChange(dayOffset + 1)}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {HOUR_ITEMS.map((item, i) => (
            <NavButton
              key={item.key}
              symbol={item.symbol}
              label={item.label}
              active={hourPeriod === item.key}
              isCenter={i === 1}
              isMobile={isMobile}
              onClick={() => onHourPeriodChange(item.key)}
            />
          ))}
        </div>
      )}

      {/* 일 오프셋 표시 (0이 아닐 때) */}
      {mode === 'day' && dayOffset !== 0 && (
        <div style={{
          fontSize: isMobile ? 9 : 10,
          color: '#94a3b8',
          fontFamily: "'DM Mono', monospace",
          textAlign: 'center',
        }}>
          {dayOffset > 0 ? `+${dayOffset}일` : `${dayOffset}일`}
        </div>
      )}
    </div>
  );
}

function NavButton({ symbol, label, active, isCenter, isMobile, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        border: `1.5px solid ${active ? '#1a202c' : '#e2e8f0'}`,
        borderRadius: 6,
        padding: isMobile ? '4px 6px' : '5px 7px',
        background: active ? '#1a202c' : isCenter ? '#f8fafc' : '#fff',
        color: active ? '#fff' : isCenter ? '#374151' : '#94a3b8',
        cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
        transition: 'all 0.15s',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <span style={{
        fontSize: isMobile ? 11 : 12,
        fontWeight: 700,
        width: 12,
        textAlign: 'center',
        flexShrink: 0,
        fontFamily: "'DM Mono', monospace",
      }}>
        {symbol}
      </span>
      <span style={{
        fontSize: isMobile ? 10 : 11,
        fontWeight: active ? 700 : isCenter ? 600 : 400,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </button>
  );
}
