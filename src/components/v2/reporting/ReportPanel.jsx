/**
 * Report Panel — Navigation-Drives-Content 원칙 구현.
 * report-architecture.md 섹션 11 참조.
 *
 * period에 따라 적절한 Template Panel을 선택하여 렌더링.
 * 접기/펼치기 가능.
 *
 * Props:
 *   period   — 현재 기간 키 (this_week / last_week / next_week / today / ...)
 *   stats    — useReportingStats 결과 stats 객체
 *   loading  — 로딩 여부
 *   isMobile
 */

import { useState } from 'react';
import EventMatrixPanel from './EventMatrixPanel';
import ActiveHybridPanel from './ActiveHybridPanel';
import SchedulePanel from './SchedulePanel';

// period → tense 매핑 (report-architecture.md 섹션 2 Axis-2)
const PERIOD_TENSE = {
  now:        'now',
  today:      'active',   this_week:  'active',   this_month:  'active',
  yesterday:  'past',     last_week:  'past',      last_hour:   'past',     last_month:  'past',
  tomorrow:   'future',   next_week:  'future',    next_hour:   'future',   next_month:  'future',
};

const PERIOD_NAV_LABEL = {
  now:        '지금',
  today:      '오늘',       this_week:  '이번 주',    this_month:  '이번 달',
  yesterday:  '어제',       last_week:  '지난주',     last_hour:   '지난 1시간', last_month: '지난달',
  tomorrow:   '내일',       next_week:  '다음 주',    next_hour:   '다음 예정', next_month: '다음 달',
};

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

function PanelContent({ tense, period, stats, loading, isMobile }) {
  if (loading) return <LoadingRows />;

  if (!stats) {
    return (
      <div style={{ padding: '18px 20px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        데이터를 불러올 수 없어요
        <div style={{ fontSize: 10, marginTop: 4, color: '#cbd5e1' }}>실제 배포 환경에서 확인 가능합니다</div>
      </div>
    );
  }

  if (tense === 'past')   return <EventMatrixPanel   stats={stats} period={period} isMobile={isMobile} />;
  if (tense === 'active') return <ActiveHybridPanel  stats={stats} period={period} isMobile={isMobile} />;
  if (tense === 'future') return <SchedulePanel      stats={stats} period={period} isMobile={isMobile} />;

  return null;
}

export default function ReportPanel({ period, stats, loading, isMobile = false }) {
  const [expanded, setExpanded] = useState(false);

  const tense    = PERIOD_TENSE[period] ?? 'active';
  const navLabel = PERIOD_NAV_LABEL[period] ?? period;
  const style    = TENSE_STYLE[tense];

  // NOW 기간(Template-C)은 DetailView에서 별도 처리. 여기서는 표시 안 함.
  if (tense === 'now' || !style) return null;

  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      {/* 접기/펼치기 토글 헤더 */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: isMobile ? '8px 12px' : '10px 20px',
          background: expanded ? style.activeBg : '#fff',
          border: 'none',
          borderBottom: expanded ? `1px solid ${style.border}` : 'none',
          cursor: 'pointer',
          gap: 8,
          fontFamily: "'DM Sans', sans-serif",
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontSize: 14 }}>{style.icon}</span>
        <span style={{
          fontSize: isMobile ? 11 : 12,
          fontWeight: 700,
          color: style.label,
        }}>
          {navLabel} 레포트
        </span>
        <span style={{
          marginLeft: 'auto',
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, color: '#94a3b8', fontWeight: 600,
        }}>
          {expanded ? '접기' : '펼치기'}
          <span style={{ fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* 콘텐츠 영역 */}
      {expanded && (
        <PanelContent
          tense={tense}
          period={period}
          stats={stats}
          loading={loading}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
