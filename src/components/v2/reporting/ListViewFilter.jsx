/**
 * List View 상단 필터 (reporting-feature-design.md 섹션 2).
 *
 * 바이너리 토글 (주 | 일) + 수평 3칸 네비게이터
 *   주 모드: 지난주 | 이번주 | 다음주
 *   일 모드: 전날   | 오늘   | 내일
 */

const WEEK_ITEMS = [
  { key: 'last_week', label: '지난주' },
  { key: 'this_week', label: '이번주' },
  { key: 'next_week', label: '다음주' },
];

const DAY_ITEMS = [
  { key: 'yesterday', label: '전날' },
  { key: 'today',     label: '오늘' },
  { key: 'tomorrow',  label: '내일' },
];

const DEFAULT_BY_MODE = { week: 'this_week', day: 'today' };

function detectMode(period) {
  if (['last_week', 'this_week', 'next_week'].includes(period)) return 'week';
  if (['yesterday', 'today', 'tomorrow'].includes(period)) return 'day';
  return 'week';
}

export default function ListViewFilter({ period, onChange, isMobile = false }) {
  const mode = detectMode(period);
  const items = mode === 'week' ? WEEK_ITEMS : DAY_ITEMS;

  function switchMode(next) {
    if (next === mode) return;
    onChange(DEFAULT_BY_MODE[next]);
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
              onClick={() => switchMode(m)}
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
          const active = period === item.key;
          const isCenter = i === 1;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
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
    </div>
  );
}
