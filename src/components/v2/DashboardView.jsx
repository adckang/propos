import { PROPERTIES, STATE_META } from '../../data/roomStateMockData';
import { useMobile } from '../../hooks/useMobile';

const ORDER = ['OCCUPIED', 'PRE_STAY_READY', 'CLEANING', 'VACANT'];

export default function DashboardView({ onSelectStatus, onBack, properties = PROPERTIES, syncBadge }) {
  const isMobile = useMobile();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  const counts = {};
  for (const p of properties) {
    const { mainStatus, subStatus } = p.currentState;
    if (!counts[mainStatus]) counts[mainStatus] = { total: 0, subs: {} };
    counts[mainStatus].total++;
    counts[mainStatus].subs[subStatus] = (counts[mainStatus].subs[subStatus] || 0) + 1;
  }

  const urgentCount = (counts['OCCUPIED']?.subs['ISSUE_AND_ENERGY'] || 0)
    + (counts['OCCUPIED']?.subs['ISSUE_COMPLAINT'] || 0)
    + (counts['OCCUPIED']?.subs['ENERGY_WASTE'] || 0);

  const unassignedCleaningCount = properties.reduce((n, p) => {
    const unassigned = (p.reservations || []).filter(
      r => r.checkIn > now && r.cleaningStatus === 'UNASSIGNED'
    ).length;
    return n + unassigned;
  }, 0);

  // ── 모바일 뷰 ────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '5px 10px', fontSize: 12, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            ← 홈
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a202c' }}>현황 대시보드</div>
            <div style={{ fontSize: 10, color: '#a0aec0', fontFamily: "'DM Mono', monospace" }}>{dateStr} · {timeStr}</div>
          </div>
          {syncBadge && syncBadge}
          {urgentCount > 0 && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '4px 8px', fontSize: 11, color: '#dc2626', fontWeight: 700, flexShrink: 0 }}>
              ⚠ {urgentCount}건
            </div>
          )}
        </div>

        {/* 요약 한 줄 */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '7px 16px', display: 'flex', justifyContent: 'space-between' }}>
          {[
            { label: '전체',   val: properties.length,              color: '#1a202c' },
            { label: '체류',   val: counts['OCCUPIED']?.total || 0, color: '#2563eb' },
            { label: '입실전', val: counts['PRE_STAY_READY']?.total || 0, color: '#059669' },
            { label: '청소',   val: counts['CLEANING']?.total || 0, color: '#dc2626' },
            { label: '공실',   val: counts['VACANT']?.total || 0,   color: '#6b7280' },
          ].map(({ label, val, color }) => (
            <span key={label} style={{ fontSize: 11, color: '#718096', textAlign: 'center' }}>
              {label}<br />
              <strong style={{ fontSize: 15, color, fontFamily: "'DM Mono', monospace" }}>{val}</strong>
            </span>
          ))}
        </div>

        {/* 상태 카드 — 1열, 상태 순서대로 */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ORDER.map(mainStatus => {
            const meta = STATE_META[mainStatus];
            const data = counts[mainStatus] || { total: 0, subs: {} };
            const isUrgent = mainStatus === 'OCCUPIED' &&
              ((data.subs['ISSUE_AND_ENERGY'] || 0) + (data.subs['ISSUE_COMPLAINT'] || 0) + (data.subs['ENERGY_WASTE'] || 0)) > 0;

            return (
              <button
                key={mainStatus}
                onClick={() => onSelectStatus(mainStatus)}
                style={{
                  background: '#fff',
                  border: `2px solid ${isUrgent ? meta.color : meta.border}`,
                  borderRadius: 12, padding: '12px 14px',
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: isUrgent ? `0 0 0 1px ${meta.color}20` : '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                {/* 숫자 + 상태명 한 줄 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: meta.color, lineHeight: 1, fontFamily: "'DM Mono', monospace", minWidth: 44 }}>
                    {data.total}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                    <div style={{ fontSize: 10, color: '#a0aec0' }}>{mainStatus}</div>
                  </div>
                </div>

                {/* 서브 상태 칩 — 가로 wrap */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {Object.entries(meta.subStates).map(([sub, subMeta]) => {
                    const cnt = data.subs[sub] || 0;
                    const isAlert = mainStatus === 'OCCUPIED' &&
                      ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(sub) && cnt > 0;
                    return (
                      <div key={sub} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: isAlert ? meta.color : (cnt > 0 ? meta.bg : '#f8fafc'),
                        border: `1px solid ${isAlert ? meta.color : (cnt > 0 ? meta.border : '#e2e8f0')}`,
                        borderRadius: 20, padding: '3px 8px',
                      }}>
                        <span style={{ fontSize: 11, color: isAlert ? '#fff' : (cnt > 0 ? meta.color : '#b0bec5') }}>
                          {isAlert ? '⚠ ' : ''}{subMeta.label}
                        </span>
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: isAlert ? '#fff' : (cnt > 0 ? meta.color : '#d1d5db'),
                          fontFamily: "'DM Mono', monospace",
                        }}>{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 데스크탑 뷰 ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '6px 12px', fontSize: 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit' }}>
          ← 홈
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1a202c' }}>현황 대시보드</div>
          <div style={{ fontSize: 12, color: '#a0aec0', fontFamily: "'DM Mono', monospace" }}>{dateStr} · {timeStr} 기준</div>
        </div>
        {syncBadge && syncBadge}
        {unassignedCleaningCount > 0 && (
          <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#d97706', fontWeight: 700 }}>
            🧹 청소 미할당 {unassignedCleaningCount}건
          </div>
        )}
        {urgentCount > 0 && (
          <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
            ⚠ 즉시 확인 {urgentCount}건
          </div>
        )}
      </div>

      {/* 요약 배너 */}
      <div data-testid="dashboard-summary" style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 20 }}>
        <span style={{ fontSize: 13, color: '#4a5568' }}>전체 <strong style={{ color: '#1a202c' }}>{properties.length}</strong>개 숙소</span>
        <span style={{ fontSize: 13, color: '#4a5568' }}>체류중 <strong data-testid="count-occupied" style={{ color: '#2563eb' }}>{counts['OCCUPIED']?.total || 0}</strong></span>
        <span style={{ fontSize: 13, color: '#4a5568' }}>입실전 <strong data-testid="count-pre-stay-ready" style={{ color: '#059669' }}>{counts['PRE_STAY_READY']?.total || 0}</strong></span>
        <span style={{ fontSize: 13, color: '#4a5568' }}>청소중 <strong data-testid="count-cleaning" style={{ color: '#dc2626' }}>{counts['CLEANING']?.total || 0}</strong></span>
        <span style={{ fontSize: 13, color: '#4a5568' }}>공실 <strong data-testid="count-vacant" style={{ color: '#6b7280' }}>{counts['VACANT']?.total || 0}</strong></span>
      </div>

      {/* 상태 카드 그리드 */}
      <div data-testid="status-cards" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1 }}>
        {ORDER.map(mainStatus => {
          const meta = STATE_META[mainStatus];
          const data = counts[mainStatus] || { total: 0, subs: {} };
          const isUrgent = mainStatus === 'OCCUPIED' &&
            ((data.subs['ISSUE_AND_ENERGY'] || 0) + (data.subs['ISSUE_COMPLAINT'] || 0) + (data.subs['ENERGY_WASTE'] || 0)) > 0;

          return (
            <button
              key={mainStatus}
              data-testid={`status-card-${mainStatus}`}
              onClick={() => onSelectStatus(mainStatus)}
              style={{
                background: '#fff',
                border: `2px solid ${isUrgent ? meta.color : meta.border}`,
                borderRadius: 14,
                padding: '18px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: isUrgent ? `0 0 0 1px ${meta.color}20` : '0 1px 3px rgba(0,0,0,0.06)',
                transition: 'all 0.15s',
              }}
            >
              {/* 숫자 + 상태명 */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 14 }}>
                <div style={{ fontSize: 42, fontWeight: 800, color: meta.color, lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>
                  {data.total}
                </div>
                <div style={{ paddingBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: '#a0aec0' }}>{mainStatus}</div>
                </div>
              </div>

              {/* 색상 바 */}
              <div style={{ height: 4, background: meta.border, borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>
                {data.total > 0 && (
                  <div style={{ height: '100%', width: `${(data.total / properties.length) * 100}%`, background: meta.color, borderRadius: 2 }} />
                )}
              </div>

              {/* 서브 상태 분류 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(meta.subStates).map(([sub, subMeta]) => {
                  const cnt = data.subs[sub] || 0;
                  const isAlert = mainStatus === 'OCCUPIED' && ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(sub) && cnt > 0;
                  return (
                    <div key={sub} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: isAlert ? meta.color : '#718096', fontWeight: isAlert ? 700 : 400 }}>
                        {isAlert ? '⚠ ' : ''}{subMeta.label}
                      </span>
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        color: isAlert ? '#fff' : (cnt > 0 ? '#1a202c' : '#d1d5db'),
                        background: isAlert ? meta.color : 'transparent',
                        borderRadius: 6, padding: isAlert ? '1px 7px' : '0',
                        fontFamily: "'DM Mono', monospace",
                      }}>
                        {cnt}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 하단 CTA */}
              <div style={{ marginTop: 14, fontSize: 12, color: meta.color, fontWeight: 600, borderTop: `1px solid ${meta.border}`, paddingTop: 10 }}>
                목록 보기 →
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
