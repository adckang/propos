/**
 * generateSummary 결과 문장 1줄 표시 (reporting-feature-design.md 섹션 4).
 * 이상 있으면 강조색, 이상 없으면 중립색.
 * children이 있으면 우측 펼치기 화살표 표시 — 클릭 시 children 토글.
 */

import { useState } from 'react';

// "이상 없었어요" 같은 정상 문장과 구분하기 위해 구체적 표현만 매칭.
// "이상감지"는 반드시 뒤에 [1-9]로 시작하는 건수가 붙어야 매칭한다 — 문장에 "이상감지 0건이
// 있었어요"처럼 0건이 그대로 들어가는 호출부가 있으면(예: 얕은 stats의 폴백 문구) 단순 부분
// 문자열 매칭으로는 문제가 없는데도 빨간 배너가 뜬다(실사용 중 실제로 발견된 버그, 2026-09-26).
// "불안정해요"는 operationalMetricsDomain.summarizeOperationalMetrics의 5단계 등급 중 하위
// 두 단계("조금 불안정해요"/"아주 불안정해요", 평균 75점 미만)에서만 쓰는 문구 — "완벽해요"/
// "양호해요"/"보통이에요"는 urgent 취급하지 않는다(D-026 후속, 2026-09-25).
const URGENT_PATTERNS = [/이상감지 [1-9]\d*건/, /이상 징후/, /바로 확인/, /불안정해요/];

function isUrgent(text) {
  return URGENT_PATTERNS.some(p => p.test(text));
}

export default function SummaryBanner({ summary, loading, isMobile = false, insights = [], children }) {
  const [expanded, setExpanded] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  if (!summary && !children) return null;

  const hasInsights = insights.length > 0;

  const urgent = summary ? isUrgent(summary) : false;
  const hasChildren = Boolean(children);

  // summary 없이 children만 있어도 expand 버튼은 보여줘야 함
  const showRow = Boolean(summary) || hasChildren;

  return (
    <div>
      {showRow && (
        <div
          onClick={hasChildren ? () => setExpanded(v => !v) : undefined}
          style={{
            padding: isMobile ? '7px 12px' : '9px 20px',
            background: urgent ? '#fef2f2' : '#f0fdf4',
            borderBottom: `1.5px solid ${urgent ? '#fca5a5' : (expanded ? 'transparent' : '#bbf7d0')}`,
            fontSize: isMobile ? 12 : 13,
            color: urgent ? '#dc2626' : '#065f46',
            fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            opacity: loading ? 0.55 : 1,
            transition: 'opacity 0.2s ease',
            cursor: hasChildren ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {summary && <span style={{ fontSize: isMobile ? 13 : 15 }}>{urgent ? '⚠' : '✓'}</span>}
          <span style={{ flex: 1 }}>{summary || '운영 현황'}</span>
          {hasChildren && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
              fontSize: isMobile ? 11 : 12,
              fontWeight: 700,
              color: urgent ? '#b91c1c' : '#047857',
              background: urgent ? '#fee2e2' : '#dcfce7',
              border: `1.5px solid ${urgent ? '#fca5a5' : '#86efac'}`,
              borderRadius: 6,
              padding: isMobile ? '2px 7px' : '3px 10px',
              cursor: 'pointer',
            }}>
              {expanded ? '닫기' : '자세히'}
              <span style={{
                fontSize: isMobile ? 13 : 15,
                transition: 'transform 0.2s ease',
                display: 'inline-block',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}>▾</span>
            </span>
          )}
        </div>
      )}
      {hasInsights && (
        <div
          onClick={() => setInsightsExpanded(v => !v)}
          style={{
            padding: isMobile ? '6px 12px' : '7px 20px',
            background: '#f8fafc',
            borderBottom: `1px solid ${insightsExpanded ? 'transparent' : '#e2e8f0'}`,
            fontSize: isMobile ? 11 : 12,
            color: '#475569', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <span>🔍</span>
          <span style={{ flex: 1 }}>발견된 패턴 {insights.length}건</span>
          <span style={{
            fontSize: isMobile ? 12 : 13,
            transition: 'transform 0.2s ease',
            display: 'inline-block',
            transform: insightsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▾</span>
        </div>
      )}
      {hasInsights && insightsExpanded && (
        <ul style={{
          margin: 0, listStyle: 'none',
          padding: isMobile ? '8px 12px' : '9px 20px',
          background: '#fff', borderBottom: '1px solid #e2e8f0',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {insights.map((sentence, i) => (
            <li key={i} style={{
              fontSize: isMobile ? 12 : 13, color: '#334155', lineHeight: 1.4,
              display: 'flex', gap: 6,
            }}>
              <span style={{ color: '#94a3b8', flexShrink: 0 }}>·</span>
              <span>{sentence}</span>
            </li>
          ))}
        </ul>
      )}
      {hasChildren && expanded && children}
    </div>
  );
}
