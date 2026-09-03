/**
 * 기간별 KPI 타일 4개 (reporting-feature-design.md 섹션 3).
 *
 * now:                   입실중 / 입실준비 / 공실 / 청소중
 * this_week / this_month: 체크인 / 체크아웃 / 이상감지 / 에너지낭비
 * last_week / last_month: 체크인 / 체크아웃 / 이상감지 / 에너지낭비
 * next_week / next_month: 예정 체크인 / 예정 체크아웃 / 예약률(미구현) / 청소할당(미구현)
 */

function Tile({ label, value, sub, accent, warn = false, isMobile }) {
  return (
    <div style={{
      flex: 1, minWidth: isMobile ? 72 : 100,
      background: warn ? '#fef2f2' : '#fff',
      border: `1.5px solid ${warn ? '#fca5a5' : '#e2e8f0'}`,
      borderRadius: 12,
      padding: isMobile ? '10px 8px' : '14px 16px',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 5,
    }}>
      <div style={{
        fontSize: isMobile ? 10 : 11,
        color: '#64748b',
        fontWeight: 600,
        letterSpacing: 0.3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: isMobile ? 22 : 28,
        fontWeight: 800,
        color: warn ? '#dc2626' : accent,
        fontFamily: "'DM Mono', monospace",
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub != null && (
        <div style={{ fontSize: isMobile ? 9 : 10, color: warn ? '#dc2626' : '#94a3b8', fontWeight: 600 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const PERIOD_TYPE = {
  // 실시간 / ACTIVE → live state 카운트 (report-architecture.md 섹션 11)
  now:        'now',
  today:      'now',        // API가 KV 기반으로 live state 반환
  this_week:  'now',        // KPI용으로 live stats 별도 전달 필요 (PropertyListView 참조)
  this_month: 'now',
  // 과거
  last_week:  'past',    last_month:  'past',
  yesterday:  'past',    last_hour:   'past',
  // 미래
  next_week:  'future',  next_month:  'future',
  tomorrow:   'future',  next_hour:   'future',
};

export default function KpiTiles({ period, stats, loading, isMobile = false }) {
  const type = PERIOD_TYPE[period] ?? 'current';

  if (loading) {
    return (
      <div style={{
        display: 'flex', gap: isMobile ? 6 : 10,
        padding: isMobile ? '10px 12px' : '14px 20px',
        background: '#f8fafc',
      }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            flex: 1, height: isMobile ? 72 : 90,
            background: '#e2e8f0', borderRadius: 12,
          }} />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const tiles = buildTiles(type, stats, isMobile);

  return (
    <div style={{
      display: 'flex', gap: isMobile ? 6 : 10,
      padding: isMobile ? '10px 12px' : '14px 20px',
      background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
    }}>
      {tiles.map((t, i) => <Tile key={i} isMobile={isMobile} {...t} />)}
    </div>
  );
}

function buildTiles(type, stats, isMobile) {
  if (type === 'now') {
    const hasAnomaly = stats.anomalyCount > 0;
    return [
      {
        label: '입실 중',
        value: stats.occupied ?? 0,
        sub: hasAnomaly ? `이상 ${stats.anomalyCount}건` : null,
        accent: '#2563eb',
        warn: hasAnomaly,
      },
      {
        label: '입실 준비',
        value: stats.preStayReady ?? 0,
        accent: '#059669',
      },
      {
        label: '공실',
        value: stats.vacant ?? 0,
        accent: '#6b7280',
      },
      {
        label: '청소 중',
        value: stats.cleaning ?? 0,
        accent: '#dc2626',
      },
    ];
  }

  if (type === 'current' || type === 'past') {
    return [
      { label: '체크인',    value: `${stats.checkIns ?? 0}건`,    accent: '#2563eb' },
      { label: '체크아웃',  value: `${stats.checkOuts ?? 0}건`,   accent: '#059669' },
      { label: '이상감지',  value: `${stats.anomalies ?? 0}건`,   accent: '#dc2626', warn: (stats.anomalies ?? 0) > 0 },
      { label: '에너지 낭비', value: `${stats.energyWaste ?? 0}건`, accent: '#d97706' },
    ];
  }

  // future
  return [
    { label: '예정 체크인',  value: `${stats.checkIns ?? 0}건`,  accent: '#7c3aed' },
    { label: '예정 체크아웃', value: `${stats.checkOuts ?? 0}건`, accent: '#7c3aed' },
    { label: '예약률',  value: '—', sub: '준비 중',   accent: '#94a3b8' },
    { label: '청소 할당', value: '—', sub: '준비 중', accent: '#94a3b8' },
  ];
}
