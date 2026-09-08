/**
 * Template-A — Active Hybrid
 * 적용: ACTIVE 기간 (this_week / today)
 * report-architecture.md 섹션 4 Template-A 참조.
 *
 * [완료] + [예정] 두 섹션으로 구성.
 * [현재] 섹션 없음 — StatusFilterBar가 해당 역할 담당.
 */

const PERIOD_LABELS = {
  this_week: '이번 주',
  today:     '오늘',
  this_month: '이번 달',
};

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function SectionHeader({ label, sub, warn = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 10,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: warn ? '#dc2626' : '#059669',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {sub && <span style={{ fontSize: 10, color: '#94a3b8' }}>{sub}</span>}
    </div>
  );
}

function StatRow({ label, value, warn = false }) {
  const isZero = value === 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <span style={{ flex: 1, fontSize: 12, color: '#4a5568', fontWeight: 500 }}>{label}</span>
      <span style={{
        fontSize: 13, fontWeight: 700,
        color: warn && !isZero ? '#dc2626' : isZero ? '#cbd5e1' : '#1a202c',
        fontFamily: "'DM Mono', monospace",
      }}>
        {value ?? 0}건
      </span>
    </div>
  );
}

export default function ActiveHybridPanel({ stats, period, isMobile = false }) {
  const periodLabel = PERIOD_LABELS[period] || period;
  const hasAnomaly  = (stats?.anomalies ?? 0) > 0;

  const now    = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} 기준`;
  const daySub  = period === 'this_week'
    ? `${DAY_KR[now.getDay()]}요일까지 처리된 이벤트`
    : `오늘 ${timeStr}까지 처리된 이벤트`;

  return (
    <div style={{ padding: isMobile ? '12px 12px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── 완료 섹션 ── */}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px' }}>
        <SectionHeader label="완료" sub={daySub} warn={false} />
        {!stats ? (
          <div style={{ height: 52, background: '#dcfce7', borderRadius: 8 }} />
        ) : (
          <>
            <StatRow label="체크인" value={stats.checkIns} />
            <StatRow label="체크아웃" value={stats.checkOuts} />
            <StatRow label="이상감지" value={stats.anomalies} warn />
            {hasAnomaly && (
              <div style={{
                marginTop: 8, padding: '6px 10px',
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7,
                fontSize: 11, color: '#dc2626', fontWeight: 600,
              }}>
                ⚠ 이상 {stats.anomalies}건 감지 — 자동처리 여부 확인 필요
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 예정 섹션 ── */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px' }}>
        <SectionHeader label="예정" sub="남은 일정" />
        <div style={{
          padding: '8px 10px',
          background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 7,
          fontSize: 11, color: '#3b82f6', textAlign: 'center', lineHeight: 1.6,
        }}>
          캘린더 연동 후 체크인 예정 · 청소 배정 현황이 표시됩니다
        </div>
      </div>
    </div>
  );
}
