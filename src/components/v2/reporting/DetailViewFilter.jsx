/**
 * Detail View 좌측 상단 필터 (reporting-feature-design.md 섹션 2).
 * 타임라인 위에 배치 — 수직 레이아웃, 상하 방향 네비게이션.
 *
 * 바이너리 토글 (일 | 시) + 수직 3행 네비게이터
 *   일 모드: - 하루 전 / ○ 오늘 / + 다음날
 *   시 모드: - 한시간 전 / ○ 지금 / + 한시간 후
 */

const DAY_ITEMS = [
  { key: 'yesterday', symbol: '−', label: '하루 전' },
  { key: 'today',     symbol: '○', label: '오늘'    },
  { key: 'tomorrow',  symbol: '+', label: '다음날'  },
];

const HOUR_ITEMS = [
  { key: 'last_hour', symbol: '−', label: '한시간 전' },
  { key: 'now',       symbol: '○', label: '지금'      },
  { key: 'next_hour', symbol: '+', label: '한시간 후' },
];

const DEFAULT_BY_MODE = { day: 'today', hour: 'now' };

function detectMode(period) {
  if (['yesterday', 'today', 'tomorrow'].includes(period)) return 'day';
  if (['last_hour', 'now', 'next_hour'].includes(period)) return 'hour';
  return 'day';
}

export default function DetailViewFilter({ period, onChange, isMobile = false }) {
  const mode = detectMode(period);
  const items = mode === 'day' ? DAY_ITEMS : HOUR_ITEMS;

  function switchMode(next) {
    if (next === mode) return;
    onChange(DEFAULT_BY_MODE[next]);
  }

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
              onClick={() => switchMode(m)}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item, i) => {
          const active = period === item.key;
          const isCenter = i === 1;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
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
                {item.symbol}
              </span>
              <span style={{
                fontSize: isMobile ? 10 : 11,
                fontWeight: active ? 700 : isCenter ? 600 : 400,
                whiteSpace: 'nowrap',
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
