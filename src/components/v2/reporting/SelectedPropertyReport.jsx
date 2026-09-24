import { useReportingStats } from '../../../hooks/useReportingStats.js';
import { futureSummaryFor } from '../../../domain/futureWeekDomain.js';
import SummaryBanner from './SummaryBanner.jsx';
import ReportPanel from './ReportPanel.jsx';
import { describePeriod } from '../../../domain/periodDomain.js';

export default function SelectedPropertyReport({
  statsPeriod,
  scopedProperties,
  statsPropertyIds,
  scope,
  noSelection,
  allSelected,
  properties,
  onSelectProperty,
  isMobile,
  monthlyCalendarState,
}) {
  const { stats: periodStats, summary, loading: periodLoading } = useReportingStats(
    noSelection ? null : statsPeriod,
    statsPropertyIds,
  );
  const issueTotal = monthlyCalendarState.data?.items?.length ?? 0;
  const periodLabel = describePeriod(statsPeriod)?.label ?? '';
  const issueSummary = monthlyCalendarState.data
    ? issueTotal > 0
      ? `${periodLabel}${statsPeriod === 'this_month' ? ' 지금까지' : ''} 운영 문제 ${issueTotal}건이 있었어요.`
      : `${periodLabel}${statsPeriod === 'this_month' ? ' 지금까지' : ''} 운영 문제가 없었어요.`
    : '';
  const displaySummary = statsPeriod === 'next_month'
    ? (futureSummaryFor(statsPeriod, scopedProperties) || summary)
    : (issueSummary || summary);
  const reportLoading = periodLoading || monthlyCalendarState.loading;

  if (noSelection) {
    return (
      <div style={{
        padding: isMobile ? '9px 12px' : '10px 20px',
        background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        fontSize: isMobile ? 12 : 13, color: '#94a3b8',
        textAlign: 'center', fontWeight: 500,
      }}>
        숙소를 선택해주세요
      </div>
    );
  }

  return (
    <div data-testid="selected-property-report">
    <SummaryBanner summary={displaySummary} loading={reportLoading} isMobile={isMobile}>
      <div style={{
        padding: isMobile ? '4px 12px' : '4px 20px',
        background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <span style={{
          fontSize: 10, color: allSelected ? '#94a3b8' : '#2563eb',
          fontFamily: "'DM Mono', monospace", fontWeight: 600,
        }}>
          {allSelected
            ? `전체 ${properties.length}개 숙소`
            : `${scope.selectedCount} / ${scope.totalCount}개 선택`}
        </span>
        {!allSelected && (
          <span style={{
            fontSize: 9, background: '#dbeafe', color: '#1d4ed8',
            border: '1px solid #bfdbfe', borderRadius: 4,
            padding: '1px 5px', fontWeight: 700,
          }}>
            선택 레포트
          </span>
        )}
      </div>
      <ReportPanel
        period={statsPeriod}
        stats={periodStats}
        loading={periodLoading}
        isMobile={isMobile}
        properties={scopedProperties}
        propertyIds={statsPropertyIds}
        drilldownPropertyIds={statsPropertyIds}
        onSelectRoom={(propertyId) => {
          const property = properties.find(item => item.id === propertyId);
          if (property) onSelectProperty?.(property);
        }}
      />
    </SummaryBanner>
    </div>
  );
}
