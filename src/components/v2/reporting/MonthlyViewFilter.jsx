const OPTIONS = [
  { key: 'last_month', label: '지난달' },
  { key: 'this_month', label: '이번달' },
  { key: 'next_month', label: '다음달' },
];

export default function MonthlyViewFilter({ statsPeriod, onPeriodChange, isMobile = false }) {
  return (
    <div data-testid="monthly-view-filter" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 5 : 8,
      padding: isMobile ? '8px 12px' : '10px 20px',
      background: '#fff', borderBottom: '1px solid #e2e8f0',
    }}>
      {OPTIONS.map(option => {
        const active = statsPeriod === option.key;
        return (
          <button
            key={option.key}
            onClick={() => onPeriodChange(option.key)}
            style={{
              border: `1.5px solid ${active ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 8,
              padding: isMobile ? '5px 11px' : '6px 16px',
              background: active ? '#2563eb' : '#fff',
              color: active ? '#fff' : '#64748b',
              fontSize: isMobile ? 11 : 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
