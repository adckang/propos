/**
 * List View 상단 네비게이터.
 * 바이너리 토글(주|일) + 수평 3버튼 (이전 | 오늘/이번주 | 다음)
 *
 * 버튼 역할: 타임라인 뷰포트를 이동하는 스크롤 컨트롤.
 *   주 모드: 지난주(−7일) | 이번주(0) | 다음주(+7일)
 *   일 모드: 전날(−1일)   | 오늘(0)   | 내일(+1일)
 *
 * Props:
 *   windowOffset   — 현재 오프셋(일 단위, 기준=0=오늘)
 *   onOffsetChange — (nextOffset) => void
 *   mode           — 'week' | 'day'
 *   onModeChange   — ('week'|'day') => void
 *   isMobile
 */

const WEEK_NAV = [
  { label: '지난주', delta: -7 },
  { label: '이번주', absolute: 0 },
  { label: '다음주', delta: +7 },
];

const DAY_NAV = [
  { label: '전날', delta: -1 },
  { label: '오늘', absolute: 0 },
  { label: '내일', delta: +1 },
];

function navActive(item, windowOffset) {
  if ('absolute' in item) return windowOffset === 0;
  if (item.delta < 0) return windowOffset < 0;
  return windowOffset > 0;
}

export default function ListViewFilter({
  windowOffset, onOffsetChange, mode, onModeChange, isMobile = false,
}) {
  const items = mode === 'week' ? WEEK_NAV : DAY_NAV;

  function handleNav(item) {
    if ('absolute' in item) {
      onOffsetChange(item.absolute);
    } else {
      onOffsetChange(windowOffset + item.delta);
    }
  }

  const pad = isMobile ? '8px 12px' : '10px 20px';

  return (
    <div style={{
      background: '#fff',
      borderBottom: '1px solid #e2e8f0',
      padding: pad,
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? 8 : 12,
    }}>
      {/* 바이너리 토글 */}
      <div style={{
        display: 'flex',
        border: '1.5px solid #e2e8f0',
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {['week', 'day'].map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                border: 'none',
                padding: isMobile ? '5px 10px' : '6px 14px',
                background: active ? '#1a202c' : '#fff',
                color: active ? '#fff' : '#94a3b8',
                fontSize: isMobile ? 11 : 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                letterSpacing: 0.3,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {m === 'week' ? '주' : '일'}
            </button>
          );
        })}
      </div>

      {/* 수평 네비게이터 */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 4 : 6,
      }}>
        {items.map((item, i) => {
          const active = navActive(item, windowOffset);
          const isCenter = i === 1;
          return (
            <button
              key={item.label}
              onClick={() => handleNav(item)}
              style={{
                flex: 1,
                border: `1.5px solid ${active ? '#1a202c' : '#e2e8f0'}`,
                borderRadius: 8,
                padding: isMobile ? '5px 0' : '6px 0',
                background: active ? '#1a202c' : isCenter ? '#f8fafc' : '#fff',
                color: active ? '#fff' : isCenter ? '#374151' : '#94a3b8',
                fontSize: isMobile ? 12 : 13,
                fontWeight: active ? 700 : isCenter ? 600 : 500,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'all 0.15s',
                textAlign: 'center',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* 오프셋 표시 — 0이 아닐 때만 */}
      {windowOffset !== 0 && (
        <div style={{
          fontSize: isMobile ? 10 : 11,
          color: '#94a3b8',
          fontFamily: "'DM Mono', monospace",
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {windowOffset > 0 ? `+${windowOffset}일` : `${windowOffset}일`}
        </div>
      )}
    </div>
  );
}
