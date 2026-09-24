/**
 * Template-A — Active Hybrid Panel
 * 적용: ACTIVE 기간 (this_week / today / this_month)
 *
 * [완료] 섹션 — EventMatrixPanel (Template-P) 7개 과거 지표
 * [예정] 섹션 — FutureMatrixPanel (Template-F) 4개 미래 지표
 *
 * splitActiveStats()로 this_week 통합 stats를 분리해서 각 패널에 전달.
 */

import EventMatrixPanel  from './EventMatrixPanel.jsx';
import FutureMatrixPanel from './FutureMatrixPanel.jsx';
import { splitActiveStats } from '../../../domain/activeWeekDomain.js';

const PAST_SECTION_STYLE = {
  border: '1px solid #bbf7d0', borderRadius: 10, overflow: 'hidden', marginBottom: 10,
};
const FUTURE_SECTION_STYLE = {
  border: '1px solid #bfdbfe', borderRadius: 10, overflow: 'hidden',
};

function SectionLabel({ label, color, bg }) {
  return (
    <div style={{
      padding: '7px 16px',
      background: bg,
      borderBottom: `1px solid ${color}`,
      fontSize: 10, fontWeight: 700, color,
      letterSpacing: 0.5, textTransform: 'uppercase',
    }}>
      {label}
    </div>
  );
}

export default function ActiveHybridPanel({ stats, period, isMobile = false, properties = [], propertyIds = null, drilldownPropertyIds, onSelectRoom }) {
  const { pastStats, futureStats } = splitActiveStats(stats);

  return (
    <div style={{ padding: isMobile ? '12px' : '16px 20px', display: 'flex', flexDirection: 'column' }}>

      {/* ── 완료 섹션 (Template-P) ── */}
      <div style={PAST_SECTION_STYLE}>
        <SectionLabel label="완료" color="#059669" bg="#f0fdf4" />
        <EventMatrixPanel
          stats={pastStats}
          period={period}
          isMobile={isMobile}
          onSelectRoom={onSelectRoom}
          propertyIds={drilldownPropertyIds}
          properties={properties}
        />
      </div>

      {/* ── 예정 섹션 (Template-F) ── */}
      <div style={FUTURE_SECTION_STYLE}>
        <SectionLabel label={period === 'this_month' ? '예정 · 지금부터 월말까지' : '예정 · 지금부터 일요일까지'} color="#1e40af" bg="#eff6ff" />
        <FutureMatrixPanel
          stats={futureStats}
          period={period}
          isMobile={isMobile}
          properties={properties}
          propertyIds={propertyIds}
          onSelectRoom={onSelectRoom}
        />
      </div>

    </div>
  );
}
