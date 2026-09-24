import { useState } from 'react';
import DailyActivityPanel from './DailyActivityPanel.jsx';

export default function DailyActivityReportPanel({ items, loading, error, isMobile = false }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      <button onClick={() => setIsOpen(open => !open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 20px', background: '#dcfce7', border: 'none',
        borderBottom: isOpen ? '1px solid #bbf7d0' : 'none',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      }}>
        <span style={{ fontSize: 13 }}>🔄</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#065f46' }}>오늘 레포트</span>
        <span style={{ fontSize: 10, color: '#065f46', transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
      </button>
      {isOpen && <DailyActivityPanel items={items} loading={loading} error={error} isMobile={isMobile} />}
    </div>
  );
}
