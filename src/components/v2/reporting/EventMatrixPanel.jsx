/**
 * Template-P — Event Matrix
 * 적용: PAST 기간 (last_week / yesterday / last_hour / last_month)
 * report-architecture.md 섹션 4 Template-P 참조.
 */

const PERIOD_LABELS = {
  last_week:  '지난주',
  yesterday:  '어제',
  last_hour:  '지난 1시간',
  last_month: '지난달',
};

function SectionTitle({ children, accent = '#64748b' }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: accent,
      letterSpacing: 1, textTransform: 'uppercase',
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function EventRow({ label, value, warn = false, dimIfZero = false }) {
  const isEmpty = value == null;
  const isZero  = value === 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <div style={{ flex: 1, fontSize: 12, color: '#4a5568', fontWeight: 500 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 700,
        color: isEmpty
          ? '#cbd5e1'
          : warn && !isZero ? '#dc2626'
          : isZero && dimIfZero ? '#94a3b8'
          : isZero ? '#94a3b8'
          : '#1a202c',
        fontFamily: "'DM Mono', monospace",
        minWidth: 36, textAlign: 'right',
      }}>
        {isEmpty ? '—' : `${value}건`}
      </div>
    </div>
  );
}

function SafetyScore({ complaints, energyWaste }) {
  const anomalies = complaints + energyWaste;
  // resolution 데이터 없으면 안심지수 계산 불가 → anomalies 있으면 "—" 표시
  const score = anomalies === 0 ? 100 : null;
  const color = score === 100 ? '#059669' : '#94a3b8';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0 0',
      borderTop: '1.5px solid #e2e8f0',
      marginTop: 4,
    }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 0.3 }}>
          안심지수
        </div>
        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>
          {anomalies === 0 ? '이상감지 없음' : `민원 ${complaints}건 · 에너지낭비 ${energyWaste}건 (해결 데이터 연동 후 계산)`}
        </div>
      </div>
      <div style={{
        fontSize: 26, fontWeight: 800, color,
        fontFamily: "'DM Mono', monospace", lineHeight: 1,
      }}>
        {score !== null ? `${score}%` : '—'}
      </div>
    </div>
  );
}

export default function EventMatrixPanel({ stats, period, isMobile = false }) {
  if (!stats) return null;

  const periodLabel = PERIOD_LABELS[period] || period;
  const complaints  = (stats.anomalies ?? 0) - (stats.energyWaste ?? 0);
  const energyWaste = stats.energyWaste ?? 0;
  const hasAnomaly  = (stats.anomalies ?? 0) > 0;

  const softTotal =
    (stats.noShowSuspected ?? 0) +
    (stats.earlyCheckinSuspected ?? 0) +
    (stats.checkoutConfirmationNeeded ?? 0);

  return (
    <div style={{ padding: isMobile ? '14px 12px' : '18px 20px' }}>
      {/* 헤더 레이블 */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 14, letterSpacing: 0.3 }}>
        {periodLabel} 이벤트 결과
      </div>

      {/* 운영 이벤트 섹션 */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle>운영 이벤트</SectionTitle>
        <EventRow label="체크인" value={stats.checkIns ?? 0} dimIfZero />
        <EventRow label="체크아웃" value={stats.checkOuts ?? 0} dimIfZero />
      </div>

      {/* 이상 감지 섹션 */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle accent={hasAnomaly ? '#dc2626' : '#64748b'}>
          이상 감지
        </SectionTitle>
        <EventRow label="민원 감지 (OCCUPIED)" value={complaints} warn dimIfZero />
        <EventRow label="에너지낭비 감지 (입실중)" value={energyWaste} warn={energyWaste > 0} dimIfZero />
      </div>

      {/* SOFT 이벤트 섹션 */}
      <div style={{ marginBottom: 4 }}>
        <SectionTitle accent={softTotal > 0 ? '#d97706' : '#94a3b8'}>
          소프트 알림
        </SectionTitle>
        <EventRow label="노쇼 의심" value={stats.noShowSuspected ?? 0} dimIfZero />
        <EventRow label="얼리체크인 의심" value={stats.earlyCheckinSuspected ?? 0} dimIfZero />
        <EventRow label="체크아웃 확인 필요" value={stats.checkoutConfirmationNeeded ?? 0} dimIfZero />
      </div>

      {/* 안심지수 */}
      <SafetyScore complaints={complaints} energyWaste={energyWaste} />
    </div>
  );
}
