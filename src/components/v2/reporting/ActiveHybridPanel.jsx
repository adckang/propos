/**
 * Template-A — Active Hybrid
 * 적용: ACTIVE 기간 (this_week / today)
 * report-architecture.md 섹션 4 Template-A 참조.
 *
 * [완료] + [예정] 두 섹션으로 구성.
 * [현재] 섹션 없음 — KPI Tiles가 해당 역할 담당.
 */

const PERIOD_LABELS = {
  this_week: '이번 주',
  today: '오늘',
};

function CompletionChip({ label, value, color, warn = false }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 14px',
      background: warn && value > 0 ? '#fef2f2' : '#f8fafc',
      border: `1.5px solid ${warn && value > 0 ? '#fca5a5' : '#e2e8f0'}`,
      borderRadius: 10,
      gap: 3, flex: 1, minWidth: 60,
    }}>
      <span style={{
        fontSize: 20, fontWeight: 800, color,
        fontFamily: "'DM Mono', monospace", lineHeight: 1,
      }}>
        {value ?? 0}
      </span>
      <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

function SectionTitle({ children, color = '#064e3b', suffix }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 8,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color,
        letterSpacing: 1, textTransform: 'uppercase',
      }}>
        {children}
      </div>
      {suffix && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{suffix}</div>
      )}
    </div>
  );
}

export default function ActiveHybridPanel({ stats, period, isMobile = false }) {
  const periodLabel = PERIOD_LABELS[period] || period;
  const hasAnomaly = (stats?.anomalies ?? 0) > 0;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} 기준`;

  return (
    <div style={{ padding: isMobile ? '14px 12px' : '18px 20px' }}>
      {/* 헤더 */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 14, letterSpacing: 0.3 }}>
        {periodLabel} 현황
      </div>

      {/* ── 완료 섹션 ── */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle color="#064e3b" suffix={timeStr}>완료</SectionTitle>

        {!stats ? (
          <div style={{ height: 64, background: '#f1f5f9', borderRadius: 10 }} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: 'wrap' }}>
              <CompletionChip label="체크인" value={stats.checkIns} color="#2563eb" />
              <CompletionChip label="체크아웃" value={stats.checkOuts} color="#059669" />
              <CompletionChip
                label="이상감지"
                value={stats.anomalies}
                color={hasAnomaly ? '#dc2626' : '#94a3b8'}
                warn
              />
              <CompletionChip label="에너지낭비" value={stats.energyWaste} color="#d97706" />
            </div>

            {hasAnomaly && (
              <div style={{
                marginTop: 8, padding: '7px 10px',
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
                fontSize: 11, color: '#dc2626', fontWeight: 600,
              }}>
                ⚠ 이상 {stats.anomalies}건 감지 — 안심지수 확인 필요
              </div>
            )}
          </>
        )}
      </div>

      {/* 구분선 */}
      <div style={{ borderTop: '1px dashed #e2e8f0', marginBottom: 14 }} />

      {/* ── 예정 섹션 ── */}
      <div>
        <SectionTitle color="#1e3a5f">예정</SectionTitle>
        <div style={{
          padding: '12px',
          background: '#f8fafc',
          border: '1.5px solid #e2e8f0',
          borderRadius: 10,
          fontSize: 12, color: '#94a3b8', textAlign: 'center',
          lineHeight: 1.5,
        }}>
          iCal 서버 연동 후 표시됩니다<br />
          <span style={{ fontSize: 10 }}>체크인 예정 · 청소 배정 상태 확인 가능</span>
        </div>
      </div>
    </div>
  );
}
