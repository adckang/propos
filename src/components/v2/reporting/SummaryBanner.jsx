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
  if (loading) {
    return (
      <div style={{
        height: isMobile ? 32 : 38,
        background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
        margin: isMobile ? '0 12px 8px' : '0 20px 10px',
        borderRadius: 8,
      }} />
    );
  }

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
    }}>
      <span style={{ fontSize: isMobile ? 13 : 15 }}>{urgent ? '⚠' : '✓'}</span>
      {summary}
    </div>
  );
}
