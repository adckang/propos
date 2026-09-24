import { useEffect, useRef, useState } from 'react';
import { PROPERTIES, STATE_META } from '../../data/roomStateMockData.js';
import { useMobile } from '../../hooks/useMobile.js';
import { useMonthlyCalendar } from '../../hooks/useMonthlyCalendar.js';
import { deriveSelectionScope, syncSelectionWithProperties } from '../../domain/selectionScopeDomain.js';
import SelectedPropertyReport from './reporting/SelectedPropertyReport.jsx';
import MonthlyViewFilter from './reporting/MonthlyViewFilter.jsx';
import PropertyMultiSelectDropdown from './reporting/PropertyMultiSelectDropdown.jsx';
import MonthlyCalendar from './reporting/MonthlyCalendar.jsx';

const ORDER = ['CLEANING', 'PRE_STAY_READY', 'OCCUPIED', 'VACANT'];

export default function MonthlyView({ onSelectStatus, onNavigateToList, onSelectProperty, onBack, properties = PROPERTIES, syncBadge }) {
  const isMobile = useMobile();
  const [statusDetailsOpen, setStatusDetailsOpen] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState('this_month');
  const [selectedRooms, setSelectedRooms] = useState(() => new Set(properties.map(property => property.id)));
  const knownIdsRef = useRef(new Set(properties.map(property => property.id)));

  useEffect(() => {
    const currentIds = properties.map(property => property.id);
    const previousKnown = knownIdsRef.current;
    knownIdsRef.current = new Set(currentIds);
    setSelectedRooms(previous => syncSelectionWithProperties(previous, previousKnown, currentIds));
  }, [properties]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const dateStrShort = `${now.getMonth() + 1}.${now.getDate()}(${['일','월','화','수','목','금','토'][now.getDay()]}) ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  const counts = {};
  for (const property of properties) {
    const { mainStatus, subStatus } = property.currentState;
    if (!counts[mainStatus]) counts[mainStatus] = { total: 0, subs: {} };
    counts[mainStatus].total += 1;
    counts[mainStatus].subs[subStatus] = (counts[mainStatus].subs[subStatus] || 0) + 1;
  }

  const allIds = properties.map(property => property.id);
  const scope = deriveSelectionScope(selectedRooms, allIds);
  const noSelection = scope.mode === 'none';
  const allSelected = scope.mode === 'all';
  // MonthlyView는 ALL이어도 화면에 보이는 숙소 ID를 명시적으로 전달한다.
  // DB 전체(null)가 화면의 숙소 범위를 벗어나는 일을 막고, 숙소 1개인 경우도 단일 조회로 처리한다.
  const statsPropertyIds = noSelection ? [] : scope.selectedIds;
  const scopedProperties = allSelected ? properties : properties.filter(property => selectedRooms.has(property.id));
  const monthlyCalendarState = useMonthlyCalendar(noSelection ? null : statsPeriod, statsPropertyIds);

  const unassignedCleaningCount = properties.reduce((count, property) => count + (property.reservations || []).filter(
    reservation => reservation.checkIn > now && reservation.cleaningStatus === 'UNASSIGNED'
  ).length, 0);

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: isMobile ? '10px 16px' : '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: isMobile ? '5px 10px' : '6px 12px', fontSize: isMobile ? 12 : 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>← 홈</button>
          {isMobile ? (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1a202c', whiteSpace: 'nowrap' }}>현황 대시보드</span>
              <span style={{ fontSize: 10, color: '#a0aec0', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dateStrShort}</span>
            </div>
          ) : (
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

        <div data-testid="dashboard-summary" style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: `${isMobile ? 7 : 10}px ${isMobile ? 12 : 20}px`, display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10 }}>
          <div style={{ display: 'flex', gap: isMobile ? 4 : 8, overflowX: 'auto', flexWrap: 'nowrap', flex: 1, minWidth: 0 }}>
            {[{ key: 'ALL', label: '전체', color: '#2563eb', testId: null }, ...ORDER.map(key => ({ key, label: STATE_META[key].label, color: STATE_META[key].color, testId: key === 'OCCUPIED' ? 'count-occupied' : key === 'CLEANING' ? 'count-cleaning' : null }))].map(({ key, label, color, testId }) => {
              const count = key === 'ALL' ? properties.length : (counts[key]?.total || 0);
              return (
                <button key={key} data-testid={testId || undefined} onClick={() => onSelectStatus(key === 'ALL' ? null : key)} style={{ flexShrink: 0, border: `1.5px solid ${color}`, borderRadius: 20, padding: isMobile ? '3px 7px' : '5px 14px', background: '#fff', color, fontSize: isMobile ? 10 : 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label} {count}
                </button>
              );
            })}
          </div>
          <button data-testid="status-details-toggle" aria-expanded={statusDetailsOpen} aria-controls="status-cards" aria-label={statusDetailsOpen ? '상태 상세 접기' : '상태 상세 펼치기'} onClick={() => setStatusDetailsOpen(open => !open)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #93c5fd', borderRadius: 6, width: isMobile ? 28 : 32, height: isMobile ? 24 : 30, padding: 0, background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ fontSize: isMobile ? 16 : 18, transition: 'transform 0.2s ease', display: 'inline-block', transform: statusDetailsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </button>
        </div>
      </div>

      {statusDetailsOpen && (
        <div id="status-cards" data-testid="status-cards" style={{ padding: isMobile ? '10px 12px' : 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 8 : 14 }}>
          {ORDER.map(mainStatus => {
            const meta = STATE_META[mainStatus];
            const status = counts[mainStatus] || { total: 0, subs: {} };
            const isUrgent = mainStatus === 'OCCUPIED' && ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].some(sub => (status.subs[sub] || 0) > 0);
            return (
              <button key={mainStatus} data-testid={`status-card-${mainStatus}`} onClick={() => onSelectStatus(mainStatus)} style={{ background: '#fff', border: `2px solid ${isUrgent ? meta.color : meta.border}`, borderRadius: isMobile ? 12 : 14, padding: isMobile ? '12px 14px' : '18px 16px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', boxShadow: isUrgent ? `0 0 0 1px ${meta.color}20` : '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: isMobile ? 'center' : 'flex-end', gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 14 }}>
                  <div style={{ fontSize: isMobile ? 26 : 42, fontWeight: 800, color: meta.color, lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>{status.total}</div>
                  <div style={{ paddingBottom: isMobile ? 0 : 4 }}>
                    <div style={{ fontSize: isMobile ? 12 : 15, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                    <div style={{ fontSize: isMobile ? 9 : 11, color: '#a0aec0' }}>{mainStatus}</div>
                  </div>
                </div>
                {!isMobile && <div style={{ height: 4, background: meta.border, borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>{status.total > 0 && <div style={{ height: '100%', width: `${(status.total / properties.length) * 100}%`, background: meta.color, borderRadius: 2 }} />}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 6 }}>
                  {Object.entries(meta.subStates).map(([sub, subMeta]) => {
                    const count = status.subs[sub] || 0;
                    const alert = mainStatus === 'OCCUPIED' && ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(sub) && count > 0;
                    return (
                      <div key={sub} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                        <span style={{ fontSize: isMobile ? 9 : 12, color: alert ? meta.color : '#718096', fontWeight: alert ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{alert ? '⚠ ' : ''}{subMeta.label}</span>
                        <span style={{ fontSize: isMobile ? 10 : 13, fontWeight: 700, color: alert ? '#fff' : count > 0 ? (isMobile ? meta.color : '#1a202c') : '#d1d5db', background: alert ? meta.color : 'transparent', borderRadius: alert ? (isMobile ? 3 : 6) : 0, padding: alert ? (isMobile ? '0 3px' : '1px 7px') : 0, fontFamily: "'DM Mono', monospace" }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
                {!isMobile && <div style={{ marginTop: 14, fontSize: 12, color: meta.color, fontWeight: 600, borderTop: `1px solid ${meta.border}`, paddingTop: 10 }}>목록 보기 →</div>}
              </button>
            );
          })}
        </div>
      )}

      <SelectedPropertyReport statsPeriod={statsPeriod} scopedProperties={scopedProperties} statsPropertyIds={statsPropertyIds} scope={scope} noSelection={noSelection} allSelected={allSelected} properties={properties} onSelectProperty={onSelectProperty} isMobile={isMobile} monthlyCalendarState={monthlyCalendarState} />
      <MonthlyViewFilter statsPeriod={statsPeriod} onPeriodChange={setStatsPeriod} isMobile={isMobile} />
      <PropertyMultiSelectDropdown properties={properties} selectedRooms={selectedRooms} setSelectedRooms={setSelectedRooms} scope={scope} isMobile={isMobile} />
      <MonthlyCalendar statsPeriod={statsPeriod} scopedProperties={scopedProperties} noSelection={noSelection} properties={properties} onSelectProperty={onSelectProperty} onNavigateToList={onNavigateToList} isMobile={isMobile} monthlyCalendarState={monthlyCalendarState} />
    </div>
  );
}
