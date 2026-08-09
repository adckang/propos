import { PROPERTIES, STATE_META } from '../../data/roomStateMockData';
import { useMobile } from '../../hooks/useMobile';

const ORDER = ['CLEANING', 'PRE_STAY_READY', 'OCCUPIED', 'VACANT'];

export default function DashboardView({ onSelectStatus, onBack, properties = PROPERTIES, syncBadge }) {
  const isMobile = useMobile();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const dateStrShort = `${now.getMonth() + 1}.${now.getDate()}(${['일','월','화','수','목','금','토'][now.getDay()]}) ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

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

  // ── 단일 JSX 트리 — isMobile로 크기/간격만 조정 ───────────────────────────────
  return (
    <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: isMobile ? '10px 16px' : '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: isMobile ? '5px 10px' : '6px 12px', fontSize: isMobile ? 12 : 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          ← 홈
        </button>
        {isMobile ? (
          /* 모바일: 제목 + 날짜시간 한 줄 인라인 */
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a202c', whiteSpace: 'nowrap' }}>현황 대시보드</span>
            <span style={{ fontSize: 10, color: '#a0aec0', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dateStrShort}</span>
          </div>
        ) : (
          /* PC: 기존 2줄 레이아웃 */
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1a202c' }}>현황 대시보드</div>
            <div style={{ fontSize: 12, color: '#a0aec0', fontFamily: "'DM Mono', monospace" }}>{dateStr} · {timeStr} 기준</div>
          </div>
        )}
        {syncBadge && syncBadge}
        {unassignedCleaningCount > 0 && (
          <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 8, padding: isMobile ? '4px 8px' : '6px 12px', fontSize: isMobile ? 11 : 12, color: '#d97706', fontWeight: 700, flexShrink: 0 }}>
            {isMobile ? `🧹 ${unassignedCleaningCount}` : `🧹 청소 미할당 ${unassignedCleaningCount}건`}
          </div>
        )}
      </div>

      {/* 요약 배너 — 모바일: 5열 grid, PC: flex */}
      <div data-testid="dashboard-summary" style={{
        padding: isMobile ? '5px 12px' : '12px 20px',
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? 'repeat(5, 1fr)' : undefined,
        gap: isMobile ? 0 : 20,
        justifyContent: isMobile ? undefined : 'flex-start',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: isMobile ? 10 : 13, color: '#4a5568', ...(isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          {isMobile ? '전체' : '전체 '}<strong style={{ color: '#1a202c', fontFamily: isMobile ? "'DM Mono', monospace" : undefined, fontSize: isMobile ? 15 : undefined }}>{properties.length}</strong>{!isMobile && '개 숙소'}
        </span>
        <span style={{ fontSize: isMobile ? 10 : 13, color: '#4a5568', ...(isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          {isMobile ? '청소' : '청소중 '}<strong data-testid="count-cleaning" style={{ color: '#dc2626', fontFamily: isMobile ? "'DM Mono', monospace" : undefined, fontSize: isMobile ? 15 : undefined }}>{counts['CLEANING']?.total || 0}</strong>
        </span>
        <span style={{ fontSize: isMobile ? 10 : 13, color: '#4a5568', ...(isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          {isMobile ? '입실전' : '입실전 '}<strong data-testid="count-pre-stay-ready" style={{ color: '#059669', fontFamily: isMobile ? "'DM Mono', monospace" : undefined, fontSize: isMobile ? 15 : undefined }}>{counts['PRE_STAY_READY']?.total || 0}</strong>
        </span>
        <span style={{ fontSize: isMobile ? 10 : 13, color: '#4a5568', ...(isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          {isMobile ? '체류' : '체류중 '}<strong data-testid="count-occupied" style={{ color: '#2563eb', fontFamily: isMobile ? "'DM Mono', monospace" : undefined, fontSize: isMobile ? 15 : undefined }}>{counts['OCCUPIED']?.total || 0}</strong>
        </span>
        <span style={{ fontSize: isMobile ? 10 : 13, color: '#4a5568', ...(isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 } : {}) }}>
          {isMobile ? '공실' : '공실 '}<strong data-testid="count-vacant" style={{ color: '#6b7280', fontFamily: isMobile ? "'DM Mono', monospace" : undefined, fontSize: isMobile ? 15 : undefined }}>{counts['VACANT']?.total || 0}</strong>
        </span>
      </div>

      {/* 상태 카드 그리드 — 모바일/PC 모두 2열 */}
      <div data-testid="status-cards" style={{ padding: isMobile ? '10px 12px' : 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 8 : 14, flex: 1 }}>
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
                borderRadius: isMobile ? 12 : 14,
                padding: isMobile ? '12px 14px' : '18px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: isUrgent ? `0 0 0 1px ${meta.color}20` : '0 1px 3px rgba(0,0,0,0.06)',
                transition: 'all 0.15s',
              }}
            >
              {/* 숫자 + 상태명 */}
              <div style={{ display: 'flex', alignItems: isMobile ? 'center' : 'flex-end', gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 14 }}>
                <div style={{ fontSize: isMobile ? 26 : 42, fontWeight: 800, color: meta.color, lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>
                  {data.total}
                </div>
                <div style={{ paddingBottom: isMobile ? 0 : 4 }}>
                  <div style={{ fontSize: isMobile ? 12 : 15, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontSize: isMobile ? 9 : 11, color: '#a0aec0' }}>{mainStatus}</div>
                </div>
              </div>

              {/* 색상 바 — PC만 표시 */}
              {!isMobile && (
                <div style={{ height: 4, background: meta.border, borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>
                  {data.total > 0 && (
                    <div style={{ height: '100%', width: `${(data.total / properties.length) * 100}%`, background: meta.color, borderRadius: 2 }} />
                  )}
                </div>
              )}

              {/* 서브 상태 — 세로 리스트 (모바일/PC 통일) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 6 }}>
                {Object.entries(meta.subStates).map(([sub, subMeta]) => {
                  const cnt = data.subs[sub] || 0;
                  const isAlert = mainStatus === 'OCCUPIED' && ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(sub) && cnt > 0;
                  return (
                    <div key={sub} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{
                        fontSize: isMobile ? 9 : 12,
                        color: isAlert ? meta.color : '#718096',
                        fontWeight: isAlert ? 700 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                      }}>
                        {isAlert ? '⚠ ' : ''}{subMeta.label}
                      </span>
                      <span style={{
                        fontSize: isMobile ? 10 : 13, fontWeight: 700,
                        color: isAlert ? '#fff' : (cnt > 0 ? (isMobile ? meta.color : '#1a202c') : '#d1d5db'),
                        background: isAlert ? meta.color : 'transparent',
                        borderRadius: isAlert ? (isMobile ? 3 : 6) : 0,
                        padding: isAlert ? (isMobile ? '0 3px' : '1px 7px') : '0',
                        fontFamily: "'DM Mono', monospace",
                        flexShrink: 0,
                      }}>
                        {cnt}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 하단 CTA — PC만 표시 */}
              {!isMobile && (
                <div style={{ marginTop: 14, fontSize: 12, color: meta.color, fontWeight: 600, borderTop: `1px solid ${meta.border}`, paddingTop: 10 }}>
                  목록 보기 →
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
