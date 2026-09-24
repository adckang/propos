/**
 * ViolationRow — 레포트 "위반·문제 건" 목록의 한 줄
 *
 * 한 줄 = [신호등 점] [숙소 이름] [무슨 문제가 어떻게 있었는지 구어체 한 줄] [시간 ›]
 * 심각도는 글자·막대로 설명하지 않고 줄의 색만으로 알린다:
 *   빨강 = 심각 / 주황 = 주의 / 초록 = 가벼움 / 회색 = 등급을 나누지 않는 지표
 * 값 계산(문장·심각도·정렬)은 violationDetailDomain — 이 컴포넌트는 그리기만 한다.
 *
 * Props:
 *   name      — 리스트 화면과 같은 숙소 이름
 *   view      — describeViolation / describeCleaningIssue 결과 { severity, text }
 *   dateLabel — 오른쪽 시각 문자열
 *   onClick   — 눌렀을 때 (숙소 상세로 이동 등)
 */

import { useState } from 'react';

// 라이트 테마 신호등 색 — 점(진한 색) + 줄 배경(옅은 색) + 테두리
const TONE = {
  severe:  { dot: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
  caution: { dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  minor:   { dot: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' },
  info:    { dot: '#94a3b8', bg: '#ffffff', border: '#e2e8f0' },
};

export default function ViolationRow({ name, view, dateLabel, onClick }) {
  const [hover, setHover] = useState(false);
  const tone = TONE[view.severity] ?? TONE.info;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${name}, ${view.text}, ${dateLabel}`}
      data-severity={view.severity}
      style={{
        width: 'calc(100% - 24px)', margin: '6px 12px', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 4,
        padding: '12px 14px',
        background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 10,
        boxShadow: hover ? '0 1px 6px rgba(15, 23, 42, 0.12)' : 'none',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        transition: 'box-shadow 0.12s',
      }}
    >
      <span aria-hidden="true" style={{
        width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: tone.dot,
      }} />

      <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', flex: '0 0 auto', minWidth: 84 }}>{name}</span>

      <span style={{ flex: '1 1 240px', minWidth: 0, fontSize: 13, color: '#334155', lineHeight: 1.5 }}>{view.text}</span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#64748b', fontFamily: "'DM Mono', monospace" }}>{dateLabel}</span>
        <span aria-hidden="true" style={{ fontSize: 14, color: '#94a3b8' }}>›</span>
      </span>
    </button>
  );
}
