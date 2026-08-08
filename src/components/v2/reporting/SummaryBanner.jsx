/**
 * generateSummary 결과 문장 1줄 표시 (reporting-feature-design.md 섹션 4).
 * 이상 있으면 강조색, 이상 없으면 중립색.
 */

// "이상 없었어요" 같은 정상 문장과 구분하기 위해 구체적 표현만 매칭
const URGENT_PHRASES = ['이상감지', '이상 징후', '바로 확인'];

function isUrgent(text) {
  return URGENT_PHRASES.some(p => text.includes(p));
}

export default function SummaryBanner({ summary, loading, isMobile = false }) {
  if (!summary) return null;

  const urgent = isUrgent(summary);

  return (
    <div style={{
      padding: isMobile ? '7px 12px' : '9px 20px',
      background: urgent ? '#fef2f2' : '#f0fdf4',
      borderBottom: `1.5px solid ${urgent ? '#fca5a5' : '#bbf7d0'}`,
      fontSize: isMobile ? 12 : 13,
      color: urgent ? '#dc2626' : '#065f46',
      fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 8,
      // 새 데이터 로딩 중: 살짝 투명하게 (깜빡임 없이 상태 표시)
      opacity: loading ? 0.55 : 1,
      transition: 'opacity 0.2s ease',
    }}>
      <span style={{ fontSize: isMobile ? 13 : 15 }}>{urgent ? '⚠' : '✓'}</span>
      {summary}
    </div>
  );
}
