/**
 * Report Panel — Navigation-Drives-Content 원칙 구현.
 * report-architecture.md 섹션 11 참조.
 *
 * period에 따라 적절한 Template Panel을 선택하여 렌더링.
 * 접기/펼치기 가능.
 *
 * Props:
 *   period   — 현재 기간 키 (this_week / last_week / next_week / today / weeks_ahead_2 / days_ago_3 / ...)
 *   stats    — useReportingStats 결과 stats 객체
 *   loading  — 로딩 여부
 *   isMobile
 */

import { useState } from 'react';
import EventMatrixPanel from './EventMatrixPanel';
import ActiveHybridPanel from './ActiveHybridPanel';
import FutureMatrixPanel from './FutureMatrixPanel';
import TodayStatusPanel from './TodayStatusPanel';
import { describePeriod, periodRangeLabel } from '../../../domain/periodDomain.js';

const TENSE_STYLE = {
  past:   { bg: '#f8fafc', border: '#e2e8f0',  activeBg: '#f1f5f9',  label: '#475569', icon: '📋' },
  active: { bg: '#f0fdf4', border: '#bbf7d0',  activeBg: '#dcfce7',  label: '#065f46', icon: '🔄' },
  future: { bg: '#eff6ff', border: '#bfdbfe',  activeBg: '#dbeafe',  label: '#1e40af', icon: '📅' },
};

function LoadingRows() {
  return (
    <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[80, 60, 80].map((w, i) => (
        <div key={i} style={{ height: 16, width: `${w}%`, background: '#e2e8f0', borderRadius: 6 }} />
      ))}
    </div>
  );
}

function PanelContent({ tense, period, stats, loading, isMobile, onSelectRoom, properties, propertyIds, drilldownPropertyIds }) {
  if (loading) return <LoadingRows />;

  if (!stats) {
    return (
      <div style={{ padding: '18px 20px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        데이터를 불러올 수 없어요
        <div style={{ fontSize: 10, marginTop: 4, color: '#cbd5e1' }}>잠시 후 다시 시도해 주세요</div>
      </div>
    );
  }

  if (tense === 'past')   return <EventMatrixPanel  stats={stats} period={period} isMobile={isMobile} onSelectRoom={onSelectRoom} propertyIds={drilldownPropertyIds} properties={properties} />;
  if (tense === 'active' && period === 'today') return <TodayStatusPanel stats={stats} isMobile={isMobile} />;
  if (tense === 'active') return <ActiveHybridPanel stats={stats} period={period} isMobile={isMobile} properties={properties} propertyIds={propertyIds} drilldownPropertyIds={drilldownPropertyIds} onSelectRoom={onSelectRoom} />;
  if (tense === 'future') return <FutureMatrixPanel stats={stats} period={period} isMobile={isMobile} properties={properties} propertyIds={propertyIds} onSelectRoom={onSelectRoom} />;

  return null;
}

export default function ReportPanel({ period, stats, loading, isMobile = false, onSelectRoom, properties = [], propertyIds = null, drilldownPropertyIds }) {
  // 시제·표시 이름은 기간 규칙(periodDomain)에서 — 지난주/다음 주/2주 뒤/3일 전 …
  const desc  = describePeriod(period);
  const tense = desc?.tense ?? 'active';
  // ACTIVE 기간은 기본 열림, 나머지는 기본 닫힘
  const [isOpen, setIsOpen] = useState(tense === 'active');

  // NOW 기간(Template-C)은 DetailView에서 별도 처리. 여기서는 표시 안 함.
  if (tense === 'now') return null;

  const navLabel = desc?.label ?? period;
  // "2주 뒤"·"3일 전"처럼 몇 번째 주/날인지 헷갈릴 수 있는 제목에는 날짜 범위를 함께 표시
  const rangeText = desc && Math.abs(desc.offset) >= 2 ? periodRangeLabel(period) : '';
  const style    = TENSE_STYLE[tense];

  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      {/* 헤더 — 클릭으로 접기/펼치기 */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '9px 20px',
          background: style?.activeBg ?? '#f8fafc',
          border: 'none',
          borderBottom: isOpen ? `1px solid ${style?.border ?? '#e2e8f0'}` : 'none',
          cursor: 'pointer', fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13 }}>{style?.icon}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: style?.label ?? '#475569' }}>
          {navLabel} 레포트{rangeText ? ` · ${rangeText}` : ''}
        </span>
        <span style={{
          fontSize: 10, color: style?.label ?? '#475569',
          transition: 'transform 0.2s',
          display: 'inline-block',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▼
        </span>
      </button>

      {isOpen && (
        <PanelContent
          tense={tense}
          period={period}
          stats={stats}
          loading={loading}
          isMobile={isMobile}
          onSelectRoom={onSelectRoom}
          properties={properties}
          propertyIds={propertyIds}
          drilldownPropertyIds={drilldownPropertyIds}
        />
      )}
    </div>
  );
}
