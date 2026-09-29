import { useState } from 'react';
import DrilldownSheet from './DrilldownSheet';
import SharedMetricRow, { ROW_GRID_TEMPLATE, ROW_GRID_TEMPLATE_MOBILE } from './SharedMetricRow';
import { pctColor } from '../../../domain/metricRowDomain.js';
import { computeOperationalMetrics } from '../../../domain/operationalMetricsDomain.js';

/**
 * Template-P — 7개 운영 지표 (건수 / 성공률)
 * 적용: PAST 기간 (last_week / yesterday / last_hour / last_month)
 * report-architecture.md 섹션 4 Template-P 참조.
 *
 * 지표 라벨·분자/분모 정의는 operationalMetricsDomain.computeOperationalMetrics 가 정본 —
 * SummaryBanner 요약 문장(reportingService.generateSummary / SelectedPropertyReport)도 같은
 * 정의를 써서, 표 숫자와 위 요약 문장이 항상 같은 얘기를 하게 한다 (D-026).
 */


const MetricRow = SharedMetricRow;

// 지표 key → drilldown metric 키 매핑 (없으면 드릴다운 없음)
const DRILLDOWN_METRIC = {
  pre_stay_optimization:  'pre_stay_optimization',
  post_checkout_energy:   'post_checkout_energy',
  post_checkout_security: 'post_checkout_security',
  vacant_energy:          'vacant_energy',
  post_cleaning_security: 'post_cleaning_security',
  cleaning_time:          'cleaning_time',
  cleaning_assign:        null, // 청소 스케줄 할당 (cleaning_jobs 테이블 기반 — 드릴다운 미지원)
};

export default function EventMatrixPanel({ stats, period, isMobile = false, onSelectRoom, propertyIds, properties = [] }) {
  const [drilldown, setDrilldown] = useState(null); // { metricKey, label }
  if (!stats) return null;

  const METRICS = computeOperationalMetrics(stats);

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
    <div style={{ padding: isMobile ? '10px 4px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 테이블 헤더 — 행(SharedMetricRow)과 같은 그리드 템플릿을 써야 칼럼이 어긋나지 않는다 */}
      <div style={{
        display: 'grid', gridTemplateColumns: isMobile ? ROW_GRID_TEMPLATE_MOBILE : ROW_GRID_TEMPLATE,
        columnGap: isMobile ? 4 : 6, alignItems: 'center',
        padding: isMobile ? '0 8px 6px 8px' : '0 14px 6px 14px',
        borderBottom: '2px solid #e2e8f0',
      }}>
        <div style={{ gridColumn: 1, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' }}>
          운영 지표
        </div>
        <div style={{ gridColumn: 2, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'right' }}>
          건수
        </div>
        <div style={{ gridColumn: 3, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
          성공률
        </div>
      </div>

      {/* 7개 지표 */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0',
        borderRadius: 10, padding: isMobile ? '0 8px' : '0 14px',
      }}>
        {METRICS.map((m, i) => {
          const { key: metricKey, ...rowProps } = m;
          const drilldownMetric = DRILLDOWN_METRIC[metricKey];
          return (
            <MetricRow
              key={metricKey}
              {...rowProps}
              isLast={i === METRICS.length - 1}
              isMobile={isMobile}
              onDrilldown={drilldownMetric ? () => setDrilldown({ metricKey: drilldownMetric, label: m.label }) : undefined}
            />
          );
        })}
      </div>

      {/* 드릴다운 바텀 시트 */}
      {drilldown && (
        <DrilldownSheet
          metric={drilldown.metricKey}
          metricLabel={drilldown.label}
          period={period}
          propertyIds={propertyIds}
          properties={properties}
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
