import { STATE_META } from '../../../data/roomStateMockData.js';
import { ISSUE_CATEGORY_META } from '../../../domain/monthlyCalendarDomain.js';

const CATEGORY_ORDER = ['PRE_STAY_READY', 'OCCUPIED', 'CLEANING', 'VACANT'];

function formatTime(raw) {
  return new Date(raw).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function DailyActivityPanel({ items = [], loading = false, error = false, isMobile = false }) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0]));
  for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1;

  if (loading) {
    return <div style={{ padding: '18px 20px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>불러오는 중…</div>;
  }
  if (error) {
    return <div style={{ padding: '18px 20px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>데이터를 불러올 수 없어요</div>;
  }

  return (
    <div style={{ padding: isMobile ? 12 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {CATEGORY_ORDER.map(category => (
          <div key={category} style={{
            border: `1px solid ${STATE_META[category]?.border ?? '#e2e8f0'}`,
            borderRadius: 8, padding: '8px 10px', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>{ISSUE_CATEGORY_META[category]?.label}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: counts[category] ? STATE_META[category]?.color : '#cbd5e1', fontFamily: "'DM Mono', monospace" }}>
              {counts[category]}건
            </span>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '12px 0 4px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>오늘 발생한 문제 없음</div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {[...items].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)).map((item, index) => (
            <div key={`${item.occurred_at}-${item.type}-${index}`} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px',
              borderBottom: index === items.length - 1 ? 'none' : '1px solid #f1f5f9',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATE_META[item.category]?.color ?? '#64748b', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#334155', fontWeight: 600 }}>{item.label}</span>
              <span style={{ fontSize: 10, color: '#64748b', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{formatTime(item.occurred_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
