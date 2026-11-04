/**
 * PeriodReport — 기간 레포트 영역 (요약 배너 + 선택 숙소 표시 + 레포트 패널) 공용 부품.
 *
 * 리스트뷰(주/일)·대시보드(월)·숙소 상세(일/시)가 같은 부품을 쓴다. 예전엔 세 화면이 이 연결을 각자 복사해
 * 갖고 있어서, 대시보드에만 들어간 "실패 상세 목록을 고른 숙소로 거르기"가 리스트뷰·숙소 상세에선 빠져
 * 고르지 않은 숙소의 실패까지 목록에 나왔다(2026-11-04 발견). 이제 규칙이 한 곳에만 있다:
 *   - 통계는 (기간, 보이는 숙소) 로 가져오고, 레포트 패널과 실패 상세 목록이 같은 숙소 범위를 쓴다.
 *   - 요약 문장: 화면이 넘긴 대체 문장 → 미래 기간이면 예약 기준 문장 → 서버 문장 순.
 *   - 숙소를 누르면(실패 목록·발견된 패턴) 그 숙소 + 그 일이 일어난 날짜(오늘 기준 며칠 전)로 이동.
 *
 * Props:
 *   period            기간 키 (last_week · next_month · days_ago_3 …)
 *   properties        이동할 숙소를 찾을 전체 목록
 *   scopedProperties  레포트 대상 숙소 (선택한 숙소)
 *   propertyIds       레포트 대상 숙소 id — 통계·실패 상세 목록 공통 범위
 *   noSelection       숙소를 하나도 고르지 않음 → 안내만, 통계 호출 안 함
 *   scopeBadge        { allSelected, selectedCount, totalCount } — 선택 숙소 수 표시 (없으면 숨김)
 *   (리스트뷰·대시보드는 위 네 값을 usePropertySelection().reportScope 로 한 번에 넘긴다)
 *   onSelectProperty  (property, dayOffset|null) → 숙소 이동. 없으면 숙소 누르기 비활성
 *   summaryOverride   화면 고유 요약 문장(예: 숙소 상세 "오늘")이 있으면 우선
 *   panel             레포트 패널 대신 그릴 내용(예: 숙소 상세 "오늘" 활동 패널). 없으면 기간 레포트 패널
 *   extraLoading      요약 배너를 같이 기다리게 할 다른 로딩(예: 대시보드 캘린더)
 */
import { useMemo } from 'react';
import { useReportingStats } from '../../../hooks/useReportingStats.js';
import { futureSummaryFor } from '../../../domain/futureWeekDomain.js';
import { toKstDateKey, kstDayOffsetFromToday } from '../../../domain/monthlyCalendarDomain.js';
import SummaryBanner from './SummaryBanner.jsx';
import ReportPanel from './ReportPanel.jsx';

function ScopeBadge({ allSelected, selectedCount, totalCount, isMobile }) {
  return (
    <div style={{
      padding: isMobile ? '4px 12px' : '4px 20px',
      background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{
        fontSize: 10, color: allSelected ? '#94a3b8' : '#2563eb',
        fontFamily: "'DM Mono', monospace", fontWeight: 600,
      }}>
        {allSelected ? `전체 ${totalCount}개 숙소` : `${selectedCount} / ${totalCount}개 선택`}
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
  );
}

export default function PeriodReport({
  period,
  properties = [],
  scopedProperties = [],
  propertyIds = [],
  noSelection = false,
  scopeBadge = null,
  onSelectProperty,
  summaryOverride = '',
  panel = null,
  extraLoading = false,
  isMobile = false,
}) {
  const { stats, summary, insights, loading } = useReportingStats(noSelection ? null : period, propertyIds);

  // 미래 기간 요약은 예약(iCal) 기준 — 서버 요약은 이벤트 기반이라 미래엔 늘 "예약 없음".
  // 리스트뷰는 시계·드래그마다 다시 그려지므로 예약 집계는 기간·숙소가 바뀔 때만 다시 한다
  const futureSummary = useMemo(() => futureSummaryFor(period, scopedProperties), [period, scopedProperties]);
  const displaySummary = summaryOverride || futureSummary || summary;

  const handleSelectRoom = useMemo(() => (onSelectProperty
    ? (propertyId, occurredAt) => {
      const property = properties.find(item => item.id === propertyId);
      if (!property) return;
      const dayOffset = occurredAt != null ? kstDayOffsetFromToday(toKstDateKey(occurredAt)) : null;
      onSelectProperty(property, dayOffset);
    }
    : undefined), [onSelectProperty, properties]);

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
    <SummaryBanner
      summary={displaySummary} loading={loading || extraLoading} isMobile={isMobile} insights={insights}
      onSelectRoom={handleSelectRoom} properties={properties}
    >
      {scopeBadge && <ScopeBadge {...scopeBadge} isMobile={isMobile} />}
      {panel ?? (
        <ReportPanel
          period={period}
          stats={stats}
          loading={loading}
          isMobile={isMobile}
          properties={scopedProperties}
          propertyIds={propertyIds}
          drilldownPropertyIds={propertyIds}
          onSelectRoom={handleSelectRoom}
        />
      )}
    </SummaryBanner>
  );
}
