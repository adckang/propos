// ListView의 "지난주 | 이번주 | 다음주" 수평 네비게이터(ListViewFilter)와 같은 크기·모양.
// 대시보드 월 탭에는 주/일 같은 두 번째 축이 없어 바이너리 토글만 없을 뿐, 3버튼 자체의
// 치수(flex:1, borderRadius:20, padding, 색상, 폰트)는 그대로 맞춘다 (D-025, 사용자 요청).
const OPTIONS = [
  { key: 'last_month', label: '지난달' },
  { key: 'this_month', label: '이번달' },
  { key: 'next_month', label: '다음달' },
];

export default function MonthlyViewFilter({ statsPeriod, onPeriodChange, isMobile = false }) {
  return (
    <div data-testid="monthly-view-filter" style={{
      background: '#fff',
      borderBottom: '1px solid #e2e8f0',
      padding: isMobile ? '8px 12px' : '10px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? 4 : 6,
    }}>
      {OPTIONS.map((option, i) => {
        const active = statsPeriod === option.key;
        const isCenter = i === 1; // '이번달' — ListView의 '오늘'/'이번주'와 같은 중앙 강조
        return (
          <button
            key={option.key}
            onClick={() => onPeriodChange(option.key)}
            style={{
              flex: 1,
              border: `1.5px solid ${active ? '#1a202c' : '#e2e8f0'}`,
              borderRadius: 20,
              padding: isMobile ? '3px 0' : '4px 0',
              background: active ? '#1a202c' : isCenter ? '#f8fafc' : '#fff',
              color: active ? '#fff' : isCenter ? '#374151' : '#94a3b8',
              fontSize: isMobile ? 10 : 11,
              fontWeight: active ? 700 : isCenter ? 600 : 500,
              cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
              textAlign: 'center',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
