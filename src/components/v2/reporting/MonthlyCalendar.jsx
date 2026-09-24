import { useEffect, useMemo, useState } from 'react';
import { STATE_META, getGanttSegments } from '../../../data/roomStateMockData.js';
import {
  buildFutureCalendarDays,
  buildFutureReservationSegments,
  ISSUE_CATEGORY_META,
} from '../../../domain/monthlyCalendarDomain.js';
import { periodToRemainingRange } from '../../../domain/periodDomain.js';
import DrilldownSheet from './DrilldownSheet.jsx';
import { NowCellMarker, NowLegendItem, nowStripHeight } from './NowMarker.jsx';
import { kstNowMarker } from '../../../domain/nowMarkerDomain.js';
import { useNow } from '../../../hooks/useNow.js';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MULTI_ISSUE_COLOR = '#475569';
const REQUESTING_CLEANING_STATUSES = new Set([
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED',
]);

function cleaningStatusMeta(status) {
  if (status === 'ESCALATED') return { label: '배정 실패', color: '#dc2626' };
  if (status === 'CANCELLED') return { label: '배정 요청 필요', color: '#dc2626' };
  if (REQUESTING_CLEANING_STATUSES.has(status)) return { label: '배정 요청중', color: '#d97706' };
  return { label: '배정완료', color: '#2563eb' };
}

function cleaningDayColor(items = []) {
  if (items.some(item => ['ESCALATED', 'CANCELLED'].includes(item.status))) return '#dc2626';
  if (items.some(item => REQUESTING_CLEANING_STATUSES.has(item.status))) return '#d97706';
  return '#2563eb';
}

function targetMonth(period, now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const offset = period === 'last_month' ? -1 : period === 'next_month' ? 1 : 0;
  const normalized = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offset, 1));
  return { year: normalized.getUTCFullYear(), month: normalized.getUTCMonth() };
}

function kstDate(year, month, day) {
  return new Date(Date.UTC(year, month, day) - KST_OFFSET_MS);
}

function dateKey(year, month, day) {
  const normalized = new Date(Date.UTC(year, month, day));
  return `${normalized.getUTCFullYear()}-${String(normalized.getUTCMonth() + 1).padStart(2, '0')}-${String(normalized.getUTCDate()).padStart(2, '0')}`;
}

function monthCells(period) {
  const { year, month } = targetMonth(period);
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return {
    year,
    month,
    cells: Array.from({ length: 42 }, (_, index) => {
      const day = index - firstDay + 1;
      const normalized = new Date(Date.UTC(year, month, day));
      return {
        key: dateKey(year, month, day),
        year: normalized.getUTCFullYear(),
        month: normalized.getUTCMonth(),
        day: normalized.getUTCDate(),
        inMonth: normalized.getUTCMonth() === month,
      };
    }),
  };
}

function issueColor(dayData) {
  const categories = Object.keys(dayData?.categories ?? {});
  if (categories.length !== 1) return MULTI_ISSUE_COLOR;
  return STATE_META[categories[0]]?.color ?? MULTI_ISSUE_COLOR;
}

function formatTime(raw) {
  return new Date(raw).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function segmentBarsForDay(segments, cell) {
  const from = kstDate(cell.year, cell.month, cell.day);
  const to = kstDate(cell.year, cell.month, cell.day + 1);
  const dayMs = to - from;
  return segments.flatMap((segment, index) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    const clippedStart = Math.max(start.getTime(), from.getTime());
    const clippedEnd = Math.min(end.getTime(), to.getTime());
    if (clippedEnd <= clippedStart) return [];
    return [{
      key: `${index}-${clippedStart}`,
      mainStatus: segment.mainStatus,
      left: ((clippedStart - from) / dayMs) * 100,
      width: ((clippedEnd - clippedStart) / dayMs) * 100,
      isFuture: segment.isFuture,
    }];
  });
}

function IssueRow({ item, properties, onSelectProperty, showProperty }) {
  const property = properties.find(candidate => candidate.id === item.property_id);
  return (
    <button
      onClick={() => property && onSelectProperty?.(property)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 16px', background: '#fff', border: 'none', borderBottom: '1px solid #f1f5f9',
        fontFamily: 'inherit', textAlign: 'left', cursor: property && onSelectProperty ? 'pointer' : 'default',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: STATE_META[item.category]?.color ?? MULTI_ISSUE_COLOR,
      }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155' }}>{item.label}</span>
        {showProperty && (
          <span style={{ display: 'block', marginTop: 2, fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {property?.name ?? item.property_id}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
        {formatTime(item.occurred_at)}
      </span>
    </button>
  );
}

function CleaningScheduleRow({ item, properties, onSelectProperty, showProperty }) {
  const property = properties.find(candidate => candidate.id === item.property_id);
  const meta = cleaningStatusMeta(item.status);
  return (
    <button
      onClick={() => property && onSelectProperty?.(property)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 16px', background: '#fff', border: 'none', borderBottom: '1px solid #f1f5f9',
        fontFamily: 'inherit', textAlign: 'left', cursor: property && onSelectProperty ? 'pointer' : 'default',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: meta.color }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155' }}>{meta.label}</span>
        {showProperty && (
          <span style={{ display: 'block', marginTop: 2, fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {property?.name ?? item.property_id}
          </span>
        )}
      </span>
    </button>
  );
}

export default function MonthlyCalendar({
  statsPeriod,
  scopedProperties,
  noSelection,
  properties,
  onSelectProperty,
  isMobile = false,
  monthlyCalendarState,
}) {
  const { data, loading, error } = monthlyCalendarState;
  const [selectedDay, setSelectedDay] = useState(null);
  const [futureCleaning, setFutureCleaning] = useState({ items: [], loading: false, error: null });
  const calendar = useMemo(() => monthCells(statsPeriod), [statsPeriod]);
  // "지금" 표시 — 리스트 화면과 같은 방식. 오늘 칸이 이 달력에 보일 때만 표시
  const now = useNow();
  const nowMarker = useMemo(() => kstNowMarker(now), [now]);
  const todayInGrid = calendar.cells.some(cell => cell.key === nowMarker.dateKey);
  const singleProperty = scopedProperties.length === 1 ? scopedProperties[0] : null;
  const isFutureMonth = statsPeriod === 'next_month';
  const selectedIdsKey = scopedProperties.map(property => property.id).join(',');
  const futureRange = useMemo(() => periodToRemainingRange('next_month'), []);

  useEffect(() => {
    setSelectedDay(null);
  }, [statsPeriod, selectedIdsKey]);

  useEffect(() => {
    if (!isFutureMonth || noSelection) {
      setFutureCleaning({ items: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setFutureCleaning(current => ({ ...current, loading: true, error: null }));
    const params = new URLSearchParams({ period: 'next_month', items: 'true' });
    if (selectedIdsKey) params.set('property_ids', selectedIdsKey);
    fetch(`/api/cleaning/stats?${params}`)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(result => {
        if (!cancelled) setFutureCleaning({ items: result.items ?? [], loading: false, error: null });
      })
      .catch(fetchError => {
        if (!cancelled) setFutureCleaning({ items: [], loading: false, error: String(fetchError) });
      });
    return () => { cancelled = true; };
  }, [isFutureMonth, noSelection, selectedIdsKey]);

  const futureDays = useMemo(
    () => buildFutureCalendarDays(scopedProperties, futureRange, futureCleaning.items),
    [scopedProperties, futureRange, futureCleaning.items],
  );

  const stateSegments = useMemo(() => {
    if (!singleProperty) return [];
    if (isFutureMonth) return buildFutureReservationSegments(singleProperty, futureRange);
    if (data?.stateSegments?.length) return data.stateSegments;
    const from = kstDate(calendar.year, calendar.month, 1);
    const to = kstDate(calendar.year, calendar.month + 1, 1);
    return getGanttSegments(singleProperty, from, to);
  }, [singleProperty, isFutureMonth, futureRange, data?.stateSegments, calendar.year, calendar.month]);

  const selectedItems = selectedDay
    ? isFutureMonth
      ? (futureDays[selectedDay]?.cleaningItems ?? [])
      : (data?.days?.[selectedDay]?.items ?? [])
    : [];
  const displayLoading = isFutureMonth ? futureCleaning.loading : loading;
  const displayError = isFutureMonth ? futureCleaning.error : error;

  if (noSelection) {
    return <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>숙소를 선택해주세요</div>;
  }

  return (
    <section data-testid="monthly-calendar" style={{ background: '#fff', padding: isMobile ? '12px 8px 20px' : '18px 20px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, padding: isMobile ? '0 4px' : 0 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 15 : 18, color: '#1e293b' }}>
          {calendar.year}년 {calendar.month + 1}월
        </h2>
        {displayLoading && <span style={{ fontSize: 11, color: '#94a3b8' }}>불러오는 중…</span>}
        {!displayLoading && displayError && <span style={{ fontSize: 11, color: '#dc2626' }}>데이터를 불러오지 못했어요</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: '1px solid #cbd5e1', borderLeft: '1px solid #cbd5e1' }}>
        {DAY_LABELS.map((label, index) => (
          <div key={label} style={{
            padding: isMobile ? '5px 0' : '7px 0', textAlign: 'center',
            borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1',
            fontSize: isMobile ? 10 : 11, fontWeight: 700,
            color: index === 0 ? '#ef4444' : index === 6 ? '#3b82f6' : '#64748b',
          }}>
            {label}
          </div>
        ))}

        {calendar.cells.map((cell, index) => {
          const dayData = data?.days?.[cell.key];
          const futureDay = futureDays[cell.key];
          const bars = singleProperty ? segmentBarsForDay(stateSegments, cell) : [];
          const dayColor = index % 7 === 0 ? '#ef4444' : index % 7 === 6 ? '#3b82f6' : '#475569';
          const isToday = cell.key === nowMarker.dateKey;
          const nowShift = isToday ? nowStripHeight(isMobile) : 0; // 오늘 칸 위쪽 "지금" 표식 자리
          return (
            <div
              key={cell.key}
              style={{
                position: 'relative',
                minHeight: singleProperty || isFutureMonth ? (isMobile ? 86 : 112) : (isMobile ? 68 : 100),
                padding: isMobile ? `${5 + nowShift}px 4px 5px` : `${7 + nowShift}px 7px 7px`,
                background: cell.inMonth ? '#fff' : '#f8fafc',
                borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1',
                overflow: 'hidden',
              }}
            >
              <span style={{
                fontSize: isMobile ? 10 : 12,
                color: isToday ? '#1a202c' : cell.inMonth ? dayColor : '#cbd5e1',
                fontWeight: isToday ? 700 : 400,
                fontFamily: "'DM Mono', monospace",
              }}>
                {cell.day}
              </span>

              {isToday && <NowCellMarker fraction={nowMarker.dayFraction} label={nowMarker.label} compact={isMobile} />}

              {isFutureMonth && cell.inMonth && futureDay && (
                <div style={{ position: 'relative', zIndex: 2, marginTop: isMobile ? 4 : 7, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {!singleProperty && (
                    <span
                      data-testid="future-occupancy-count"
                      data-occupied={futureDay.occupiedRooms}
                      data-vacant={futureDay.vacantRooms}
                      style={{ fontSize: isMobile ? 8 : 10, color: '#475569', whiteSpace: 'nowrap' }}
                    >
                      체류 {futureDay.occupiedRooms} · 공실 {futureDay.vacantRooms}
                    </span>
                  )}
                  {(futureDay.checkIns > 0 || futureDay.checkOuts > 0) && (
                    <span
                      data-testid="future-movement-count"
                      data-checkins={futureDay.checkIns}
                      data-checkouts={futureDay.checkOuts}
                      style={{ fontSize: isMobile ? 8 : 10, color: '#64748b', whiteSpace: 'nowrap' }}
                    >
                      입실 {futureDay.checkIns} · 퇴실 {futureDay.checkOuts}
                    </span>
                  )}
                  {futureDay.cleaningItems.length > 0 && (
                    <button
                      aria-label={`${cell.key} 청소 ${futureDay.cleaningItems.length}건`}
                      data-testid="future-cleaning-count"
                      data-count={futureDay.cleaningItems.length}
                      onClick={() => setSelectedDay(cell.key)}
                      style={{
                        alignSelf: 'flex-start', padding: isMobile ? '1px 4px' : '2px 6px',
                        border: 'none', borderRadius: 8,
                        background: cleaningDayColor(futureDay.cleaningItems), color: '#fff',
                        fontSize: isMobile ? 8 : 9, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      청소 {futureDay.cleaningItems.length}
                    </button>
                  )}
                </div>
              )}

              {singleProperty && bars.length > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, height: '44%',
                  background: '#f1f5f9', borderTop: '1px solid #e2e8f0', overflow: 'hidden',
                }}>
                  {bars.map(bar => (
                    <span key={bar.key} data-testid="calendar-state-bar" title={STATE_META[bar.mainStatus]?.label} style={{
                      position: 'absolute', left: `${bar.left}%`, width: `${bar.width}%`, top: 0, bottom: 0,
                      background: STATE_META[bar.mainStatus]?.color ?? '#cbd5e1', opacity: bar.isFuture ? 0.9 : 0.78,
                    }} />
                  ))}
                </div>
              )}

              {!isFutureMonth && dayData?.total > 0 && (
                <button
                  aria-label={`${cell.key} 문제 ${dayData.total}건`}
                  onClick={() => setSelectedDay(cell.key)}
                  style={{
                    position: 'absolute', right: isMobile ? 4 : 7, top: (isMobile ? 23 : 29) + nowShift,
                    minWidth: isMobile ? 20 : 24, height: isMobile ? 20 : 24,
                    padding: '0 5px', border: 'none', borderRadius: 12,
                    background: issueColor(dayData), color: '#fff',
                    fontSize: isMobile ? 10 : 11, fontWeight: 800,
                    cursor: 'pointer', fontFamily: "'DM Mono', monospace", zIndex: 3,
                  }}
                >
                  {dayData.total}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {todayInGrid && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: isMobile ? '10px 4px 0' : '12px 0 0' }}>
          <NowLegendItem />
        </div>
      )}

      {selectedDay && (
        <DrilldownSheet
          metricLabel={`${Number(selectedDay.slice(5, 7))}월 ${Number(selectedDay.slice(8, 10))}일 ${isFutureMonth ? '청소 예정' : '문제'} ${selectedItems.length}건`}
          staticItems={selectedItems}
          staticLoading={displayLoading}
          staticError={!!displayError}
          emptyMessage={isFutureMonth ? '청소 예정 없음' : '문제 없음'}
          onClose={() => setSelectedDay(null)}
          renderItem={(item, index) => (
            isFutureMonth
              ? <CleaningScheduleRow
                  key={`${item.property_id}-${item.checkout_at}-${index}`}
                  item={item}
                  properties={properties}
                  onSelectProperty={onSelectProperty}
                  showProperty={!singleProperty}
                />
              : <IssueRow
                  key={`${item.property_id}-${item.occurred_at}-${index}`}
                  item={item}
                  properties={properties}
                  onSelectProperty={onSelectProperty}
                  showProperty={!singleProperty}
                />
          )}
        />
      )}
    </section>
  );
}

export { monthCells, segmentBarsForDay };
