import { useState } from 'react';
import DrilldownSheet from './DrilldownSheet';

/**
 * Template-P — 7개 운영 지표 (건수 / 달성률)
 * 적용: PAST 기간 (last_week / yesterday / last_hour / last_month)
 * report-architecture.md 섹션 4 Template-P 참조.
 *
 * 지표 정의:
 *   1. 입실전 숙소 최적화율       — preStayOptimized / preStayAttempts
 *   2. 퇴실후 청소전 절전 적용률  — (checkOuts - postCheckoutEnergyWaste) / checkOuts
 *   3. 퇴실후 청소전 보안 적용률  — (checkOuts - postCheckoutSecurityBreach) / checkOuts
 *   4. 청소후 공실중 절전 적용률  — (cleaningFinished - vacantEnergyWaste) / cleaningFinished
 *   5. 청소후 공실중 보안 적용률  — (cleaningFinished - postCleaningSecurityBreach) / cleaningFinished
 *   6. 청소 시작~완료 시간 준수율 — cleaningOnTime / cleaningFinished  (기준: 3시간)
 *   7. 청소 스케줄 할당 성공률    — cleaningAssigned / cleaningCreated
 */


/** 달성률에 따른 텍스트 색상 */
function pctColor(pct) {
  if (pct >= 90) return '#059669';
  if (pct >= 70) return '#d97706';
  return '#dc2626';
}

/** 달성률에 따른 배지 배경 */
function pctBg(pct) {
  if (pct >= 90) return '#dcfce7';
  if (pct >= 70) return '#fef9c3';
  return '#fee2e2';
}

/**
 * 개별 운영 지표 행
 * @param {string}   label       - 지표명
 * @param {number}   numerator   - 달성 건수
 * @param {number}   denominator - 전체 건수
 * @param {boolean}  noData      - true면 "준비 중" 표시
 * @param {boolean}  isLast      - 마지막 행이면 border-bottom 없음
 * @param {Function} onDrilldown - 탭 시 드릴다운 콜백 (실패 건 있을 때만)
 */
function MetricRow({ label, numerator, denominator, noData = false, isLast = false, onDrilldown }) {
  const isEmpty = !noData && (denominator == null || denominator === 0);

  let countText = '—';
  let ratioText = noData ? '준비 중' : '해당 없음';
  let ratioColor = '#94a3b8';
  let ratioBg    = 'transparent';
  let pct        = null;

  if (!noData && !isEmpty) {
    pct        = Math.round((numerator / denominator) * 100);
    countText  = `${numerator}/${denominator}건`;
    ratioText  = `${pct}%`;
    ratioColor = pctColor(pct);
    ratioBg    = pctBg(pct);
  }

  const failCount = (!noData && !isEmpty && pct !== null) ? (denominator - numerator) : 0;
  const tappable  = failCount > 0 && !!onDrilldown;

  const rowContent = (
    <>
      {/* 지표명 */}
      <div style={{ flex: 1, fontSize: 12, color: noData ? '#94a3b8' : '#4a5568', fontWeight: 500 }}>
        {label}
      </div>

      {/* 건수 */}
      <div style={{
        fontSize: 11, color: '#64748b',
        fontFamily: "'DM Mono', monospace",
        minWidth: 64, textAlign: 'right', marginRight: 10,
      }}>
        {countText}
      </div>

      {/* 달성률 배지 */}
      <div style={{
        fontSize: 12, fontWeight: 700,
        color: ratioColor,
        background: ratioBg,
        fontFamily: "'DM Mono', monospace",
        minWidth: 46, textAlign: 'center',
        borderRadius: 5, padding: '2px 6px',
      }}>
        {ratioText}
      </div>

      {/* 드릴다운 화살표 */}
      {tappable && (
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>
      )}
    </>
  );

  const baseStyle = {
    display: 'flex', alignItems: 'center',
    padding: '9px 0',
    borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
  };

  if (tappable) {
    return (
      <button
        onClick={onDrilldown}
        style={{
          ...baseStyle, width: '100%', background: 'none',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {rowContent}
      </button>
    );
  }

  return <div style={baseStyle}>{rowContent}</div>;
}

// 지표 index → drilldown metric 키 매핑 (없으면 null = 드릴다운 없음)
const METRIC_KEYS = [
  'pre_stay_optimization',   // 0: 입실전 숙소 최적화율
  'post_checkout_energy',    // 1: 퇴실후 절전
  'post_checkout_security',  // 2: 퇴실후 보안
  'vacant_energy',           // 3: 청소후 공실중 절전
  'post_cleaning_security',  // 4: 청소후 공실중 보안
  'cleaning_time',           // 5: 청소 시간 준수율
  null,                      // 6: 청소 스케줄 할당 (cleaning_jobs 테이블 기반 — 미지원)
];

export default function EventMatrixPanel({ stats, period, isMobile = false, onSelectRoom }) {
  const [drilldown, setDrilldown] = useState(null); // { metricKey, label }
  if (!stats) return null;

  const checkOuts                  = stats.checkOuts                  ?? 0;
  const cleaningFinished           = stats.cleaningFinished            ?? checkOuts;
  const vacantEnergyWaste          = stats.vacantEnergyWaste           ?? 0;
  const postCheckoutEnergyWaste    = stats.postCheckoutEnergyWaste     ?? 0;
  const postCheckoutSecurityBreach = stats.postCheckoutSecurityBreach  ?? 0;
  const postCleaningSecurityBreach = stats.postCleaningSecurityBreach  ?? 0;

  // 역산 패턴: 위반 건수를 분모에서 빼면 적용률 달성 건수
  const vacantEnergySavingOk       = Math.max(0, cleaningFinished - vacantEnergyWaste);
  const postCheckoutEnergyOk       = Math.max(0, checkOuts - postCheckoutEnergyWaste);
  const postCheckoutSecurityOk     = Math.max(0, checkOuts - postCheckoutSecurityBreach);
  const postCleaningSecurityOk     = Math.max(0, cleaningFinished - postCleaningSecurityBreach);

  const METRICS = [
    {
      label:       '입실전 숙소 최적화율',
      numerator:   stats.preStayOptimized ?? 0,
      denominator: stats.preStayAttempts  ?? 0,
    },
    {
      label:       '퇴실후 청소전 절전 적용률',
      numerator:   postCheckoutEnergyOk,
      denominator: checkOuts,
    },
    {
      label:       '퇴실후 청소전 보안 적용률',
      numerator:   postCheckoutSecurityOk,
      denominator: checkOuts,
    },
    {
      label:       '청소후 공실중 절전 적용률',
      numerator:   vacantEnergySavingOk,
      denominator: cleaningFinished,
    },
    {
      label:       '청소후 공실중 보안 적용률',
      numerator:   postCleaningSecurityOk,
      denominator: cleaningFinished,
    },
    {
      label:       '청소 시작~완료 시간 준수율',
      numerator:   stats.cleaningOnTime  ?? 0,
      denominator: cleaningFinished,
    },
    {
      label:       '청소 스케줄 할당 성공률',
      numerator:   stats.cleaningAssigned ?? 0,
      denominator: stats.cleaningCreated  ?? checkOuts,
    },
  ];

  // 안심지수: 측정 가능한 지표(noData 아니고 분모 > 0)만 평균
  const measurable = METRICS.filter(m => !m.noData && (m.denominator ?? 0) > 0);
  const avgScore   = measurable.length > 0
    ? Math.round(measurable.reduce((s, m) => s + (m.numerator / m.denominator) * 100, 0) / measurable.length)
    : null;

  const scoreColor = avgScore != null ? pctColor(avgScore) : '#94a3b8';
  const scoreBg    = avgScore != null
    ? (avgScore >= 90 ? '#f0fdf4' : avgScore >= 70 ? '#fffbeb' : '#fef2f2')
    : '#f8fafc';
  const scoreBorder = avgScore != null
    ? (avgScore >= 90 ? '#bbf7d0' : avgScore >= 70 ? '#fde68a' : '#fca5a5')
    : '#e2e8f0';

  return (
    <div style={{ padding: isMobile ? '12px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 테이블 헤더 */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '0 14px 6px 14px',
        borderBottom: '2px solid #e2e8f0',
      }}>
        <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' }}>
          운영 지표
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase',
          minWidth: 64, textAlign: 'right', marginRight: 10 }}>
          건수
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase',
          minWidth: 46, textAlign: 'center' }}>
          달성률
        </div>
      </div>

      {/* 7개 지표 */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0',
        borderRadius: 10, padding: '0 14px',
      }}>
        {METRICS.map((m, i) => (
          <MetricRow
            key={i}
            {...m}
            isLast={i === METRICS.length - 1}
            onDrilldown={METRIC_KEYS[i] ? () => setDrilldown({ metricKey: METRIC_KEYS[i], label: m.label }) : undefined}
          />
        ))}
      </div>

      {/* 드릴다운 바텀 시트 */}
      {drilldown && (
        <DrilldownSheet
          metric={drilldown.metricKey}
          metricLabel={drilldown.label}
          period={period}
          onClose={() => setDrilldown(null)}
          onSelectRoom={onSelectRoom}
        />
      )}

      {/* 안심지수 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scoreBg, border: `1px solid ${scoreBorder}`,
        borderRadius: 10, padding: '10px 14px',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 0.3 }}>
            안심지수
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
            {measurable.length > 0
              ? `측정가능 ${measurable.length}개 지표 평균 · ${METRICS.filter(m => m.noData).length}개 지표 연동 후 포함`
              : '측정가능 지표 없음'}
          </div>
        </div>
        <div style={{
          fontSize: 26, fontWeight: 800, color: scoreColor,
          fontFamily: "'DM Mono', monospace", lineHeight: 1,
        }}>
          {avgScore != null ? `${avgScore}%` : '—'}
        </div>
      </div>
    </div>
  );
}
