import { useReportingStats } from '../../../hooks/useReportingStats.js';
import { futureSummaryFor } from '../../../domain/futureWeekDomain.js';
import { toKstDateKey, kstDayOffsetFromToday } from '../../../domain/monthlyCalendarDomain.js';
import SummaryBanner from './SummaryBanner.jsx';
import ReportPanel from './ReportPanel.jsx';

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
  const { stats: periodStats, summary, insights, loading: periodLoading } = useReportingStats(
    noSelection ? null : statsPeriod,
    statsPropertyIds,
  );
  // 지난달/이번달 요약 문장은 서버(generateSummary)가 운영 지표 기준으로 만들어서 준다 —
  // ListView(지난주/이번주)와 같은 톤·같은 숫자 정의를 쓴다 (D-026). next_month(미래)만
  // 이벤트가 없어 예약(iCal) 기준 문장으로 별도 처리.
  const displaySummary = statsPeriod === 'next_month'
    ? (futureSummaryFor(statsPeriod, scopedProperties) || summary)
    : summary;
  const reportLoading = periodLoading || monthlyCalendarState.loading;

  // 위반 상세 목록·인사이트 팝업 둘 다 여기서 같은 방식으로 숙소 선택을 처리 — occurredAt이 있으면
  // 디테일뷰가 그 날짜로 바로 열리도록 day offset을 같이 계산해서 넘긴다 (D-028).
  const handleSelectRoom = (propertyId, occurredAt) => {
    const property = properties.find(item => item.id === propertyId);
    if (!property) return;
    const dayOffset = occurredAt != null ? kstDayOffsetFromToday(toKstDateKey(occurredAt)) : null;
    onSelectProperty?.(property, dayOffset);
  };

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
    <SummaryBanner
      summary={displaySummary} loading={reportLoading} isMobile={isMobile} insights={insights}
      onSelectRoom={handleSelectRoom} properties={properties}
    >
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
        onSelectRoom={handleSelectRoom}
      />
    </SummaryBanner>
    </div>
  );
}
