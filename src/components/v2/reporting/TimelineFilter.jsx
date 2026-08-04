/**
 * 기간 선택 필터 (reporting-feature-design.md 섹션 2).
 * 7개 기간을 수평 스크롤 가능한 탭으로 표시.
 * now = 기본 선택 / 좌=과거 / 우=미래.
 */

const PERIODS = [
  { key: 'last_month', label: '지난달',  dir: 'past'   },
  { key: 'last_week',  label: '지난주',  dir: 'past'   },
  { key: 'this_month', label: '이번달',  dir: 'current'},
  { key: 'this_week',  label: '이번주',  dir: 'current'},
  { key: 'now',        label: '지금 ●',  dir: 'live'   },
  { key: 'next_week',  label: '다음주',  dir: 'future' },
  { key: 'next_month', label: '다음달',  dir: 'future' },
];

const DIR_COLOR = {
  past:    { active: '#64748b', inactive: '#94a3b8' },
  current: { active: '#2563eb', inactive: '#64748b' },
  live:    { active: '#059669', inactive: '#64748b' },
  future:  { active: '#7c3aed', inactive: '#94a3b8' },
};

export default function TimelineFilter({ period, onChange, isMobile = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6,
      overflowX: 'auto', padding: isMobile ? '8px 12px' : '10px 20px',
      background: '#fff', borderBottom: '1px solid #e2e8f0',
      scrollbarWidth: 'none',
    }}>
      {PERIODS.map((p, i) => {
        const isActive = period === p.key;
        const colors = DIR_COLOR[p.dir];

        return (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            style={{
              flexShrink: 0,
              border: `1.5px solid ${isActive ? colors.active : '#e2e8f0'}`,
              borderRadius: 20,
              padding: isMobile ? '4px 10px' : '5px 14px',
              background: isActive ? colors.active : '#fff',
              color: isActive ? '#fff' : colors.inactive,
              fontSize: isMobile ? 11 : 13,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
              position: 'relative',
            }}
          >
            {p.label}
            {/* 구분자 — 과거/현재 경계, 현재/미래 경계 */}
            {(i === 1 || i === 4) && (
              <span style={{
                position: 'absolute', right: isMobile ? -4 : -5,
                top: '50%', transform: 'translateY(-50%)',
                color: '#cbd5e1', fontSize: 12, pointerEvents: 'none',
              }}>·</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
