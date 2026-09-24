import { useEffect, useMemo, useState } from 'react';
import { STATE_META, getGanttSegments } from '../../../data/roomStateMockData.js';
import {
  buildFutureCalendarDays,
  buildFutureReservationSegments,
  classifyDayCleaningItems,
  kstDayOffsetFromToday,
  ISSUE_CATEGORY_META,
} from '../../../domain/monthlyCalendarDomain.js';
import { periodToRemainingRange } from '../../../domain/periodDomain.js';
import { resolvePropertyName } from '../../../domain/propertyNameDomain.js';
import { buildCleaningIssueRows, buildMixedCleaningIssueRows } from '../../../domain/violationDetailDomain.js';
import DrilldownSheet from './DrilldownSheet.jsx';
import ViolationRow from './ViolationRow.jsx';
import { NowCellMarker, NowLegendItem } from './NowMarker.jsx';
import { kstNowMarker } from '../../../domain/nowMarkerDomain.js';
import { useNow } from '../../../hooks/useNow.js';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MULTI_ISSUE_COLOR = '#475569';

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

/** 배정완료 목록 한 줄 — 숙소 이름 + 청소 담당자 이름 */
function AssignedCleanerRow({ name, cleanerName, onClick }) {
  return (
    <SimpleListRow name={name} sub={cleanerName || '담당자 미정'} onClick={onClick} />
  );
}

/** 캘린더 칸의 작은 지표(체류/공실/입실/퇴실) — 값이 0이면 눌리지 않는다 */
function DayStat({ label, value, color, onClick, isMobile, testId }) {
  const clickable = value > 0 && !!onClick;
  const style = {
    fontSize: isMobile ? 8 : 10, color, whiteSpace: 'nowrap',
    background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
    cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline' : 'none',
    textDecorationColor: clickable ? `${color}66` : 'transparent',
  };
  return (
    <button data-testid={testId} data-value={value} onClick={clickable ? onClick : undefined} disabled={!clickable} style={style}>
      {label} {value}
    </button>
  );
}

/**
 * 청소 배정 요약 — "청소 배정 완료"는 일반 텍스트(하이라이트 없음), "청소 미배정"만 빨간 배경으로
 * 강조한다 (사용자 지시: 배정 완료는 굳이 강조할 필요 없고, 미배정만 눈에 띄면 됨).
 */
function CleaningDaySummary({ assigned, unassigned, onAssignedClick, onUnassignedClick, isMobile }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
      {assigned > 0 && (
        <DayStat testId="future-cleaning-assigned" label="청소 배정 완료" value={assigned} color="#64748b" isMobile={isMobile} onClick={onAssignedClick} />
      )}
      {unassigned > 0 && (
        <button
          data-testid="future-cleaning-unassigned"
          onClick={onUnassignedClick}
          style={{
            alignSelf: 'flex-start', padding: isMobile ? '1px 4px' : '2px 6px',
            border: 'none', borderRadius: 8, background: '#dc2626', color: '#fff',
            fontSize: isMobile ? 8 : 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          청소 미배정 {unassigned}
        </button>
      )}
    </div>
  );
}

/** 팝업 안의 단순 한 줄 — 숙소 이름 + 보조 문구(시각/담당자 등), 누르면 그 숙소로 이동 */
function SimpleListRow({ name, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '12px 16px', background: '#fff', border: 'none', borderBottom: '1px solid #f1f5f9',
        fontFamily: 'inherit', textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{name}</span>
      {sub && <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>{sub}</span>}
    </button>
  );
}

/** 팝업 안의 단순 통계 한 줄(수동배정 필요/배정 요청중 개수) — 다음 팝업으로 넘어가는 용도 */
function StatRow({ label, value, red = false, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px',
        background: 'none', borderWidth: 0, borderBottomWidth: 1, borderStyle: 'solid', borderColor: '#f1f5f9',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, color: '#475569' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: red ? '#dc2626' : '#1e293b' }}>{value}건</span>
      <span aria-hidden="true" style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>
    </button>
  );
}

export default function MonthlyCalendar({
  statsPeriod,
  scopedProperties,
  noSelection,
  properties,
  onSelectProperty,
  onNavigateToList,
  isMobile = false,
  monthlyCalendarState,
}) {
  const { data, loading, error } = monthlyCalendarState;
  const [selectedDay, setSelectedDay] = useState(null);
  // 미래달 칸의 입실/퇴실/청소배정 팝업 — { day: 'YYYY-MM-DD', kind } / kind: checkin|checkout|assigned|unassigned|requesting|manual
  const [futurePopup, setFuturePopup] = useState(null);
  const [futureCleaning, setFutureCleaning] = useState({ items: [], loading: false, error: null });
  const calendar = useMemo(() => monthCells(statsPeriod), [statsPeriod]);
  // "지금" 표시 — 리스트 화면과 같은 방식. 오늘 칸이 이 달력에 보일 때만 표시
  const now = useNow();
  const nowMarker = useMemo(() => kstNowMarker(now), [now]);
  const todayInGrid = calendar.cells.some(cell => cell.key === nowMarker.dateKey);
  // 그 칸의 날짜가 오늘이거나 이후인지 — 날짜 키가 'YYYY-MM-DD'라 문자열 비교로 충분하다.
  // 이번달 캘린더 안에서 "지금 이전"(문제 배지)과 "지금 이후"(다음달과 같은 포맷)를 이 값으로 나눈다.
  const cellIsFuture = (cell) => cell.key >= nowMarker.dateKey;
  const singleProperty = scopedProperties.length === 1 ? scopedProperties[0] : null;
  // 다음달은 전체가 미래라 항상 미래 포맷. 이번달은 "지금 이후"만 미래 포맷(다음달과 같은 방식),
  // 지금 이전은 그대로 지난달과 같은 "문제" 배지 포맷 — 칸 단위(cellIsFuture)로 나뉜다(사용자 요청).
  const needsFutureData = statsPeriod === 'this_month' || statsPeriod === 'next_month';
  const selectedIdsKey = scopedProperties.map(property => property.id).join(',');
  // next_month: 월 전체 / this_month: 지금 ~ 월말("지금 이후"). periodToRemainingRange가 이미 이 규칙을 안다.
  const futureRange = useMemo(
    () => (needsFutureData ? periodToRemainingRange(statsPeriod) : null),
    [needsFutureData, statsPeriod],
  );

  useEffect(() => {
    setSelectedDay(null);
    setFuturePopup(null);
  }, [statsPeriod, selectedIdsKey]);

  useEffect(() => {
    if (!needsFutureData || noSelection) {
      setFutureCleaning({ items: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setFutureCleaning(current => ({ ...current, loading: true, error: null }));
    const params = new URLSearchParams({ period: statsPeriod, items: 'true' });
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
  }, [needsFutureData, statsPeriod, noSelection, selectedIdsKey]);

  const futureDays = useMemo(
    () => (futureRange ? buildFutureCalendarDays(scopedProperties, futureRange, futureCleaning.items) : {}),
    [scopedProperties, futureRange, futureCleaning.items],
  );

  const stateSegments = useMemo(() => {
    if (!singleProperty) return [];
    if (statsPeriod === 'next_month') return buildFutureReservationSegments(singleProperty, futureRange);
    // 지난달 전체, 그리고 이번달의 "지금까지"는 실제 이벤트 막대 — 이번달의 "지금 이후"는 예약 기반 예측 막대를 이어 붙인다
    const from = kstDate(calendar.year, calendar.month, 1);
    const to = kstDate(calendar.year, calendar.month + 1, 1);
    const past = data?.stateSegments?.length ? data.stateSegments : getGanttSegments(singleProperty, from, to);
    if (statsPeriod === 'this_month' && futureRange) {
      return [...past, ...buildFutureReservationSegments(singleProperty, futureRange)];
    }
    return past;
  }, [singleProperty, statsPeriod, futureRange, data?.stateSegments, calendar.year, calendar.month]);

  // 이 목록(selectedDay)은 "문제" 배지(지난달 전체 + 이번달의 지난 날짜) 전용 — 미래 포맷 칸의
  // 입실/퇴실/청소배정은 futurePopup 이 따로 맡는다 (한 칸에 여러 팝업 종류가 있어서 분리함)
  const selectedItems = selectedDay ? (data?.days?.[selectedDay]?.items ?? []) : [];
  const displayLoading = needsFutureData ? (loading || futureCleaning.loading) : loading;
  const displayError = needsFutureData ? (error || futureCleaning.error) : error;

  // 입실/퇴실/청소배정 팝업 데이터 — 눌린 칸의 하루치 정보만 그때그때 계산 (양이 적어 useMemo 불필요)
  const popupDayData   = futurePopup ? futureDays[futurePopup.day] : null;
  const popupCleaning  = classifyDayCleaningItems(popupDayData?.cleaningItems ?? [], popupDayData?.checkOutPropertyIds ?? []);
  const popupRequestingRows = futurePopup?.kind === 'requesting'
    ? buildCleaningIssueRows('requesting', popupCleaning.requesting, Date.now())
    : [];
  const popupManualRows = futurePopup?.kind === 'manual'
    ? buildMixedCleaningIssueRows(
        popupCleaning.manual.map(item => ({ kind: item.status === 'CANCELLED' ? 'needsRequest' : 'failed', item })),
        Date.now(),
      )
    : [];

  // 팝업 안에서 숙소 ID로 그 숙소를 선택 (없는 ID면 아무 일도 안 함 — 목업 데이터 불일치 방어)
  const selectPropertyById = (propertyId) => {
    const property = properties.find(p => p.id === propertyId);
    if (property) onSelectProperty?.(property);
  };

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
          return (
            <div
              key={cell.key}
              style={{
                position: 'relative',
                minHeight: singleProperty || needsFutureData ? (isMobile ? 86 : 112) : (isMobile ? 68 : 100),
                // "지금" 표식은 날짜 숫자·배지와 겹쳐도 된다 (사용자 요청) — 자리를 비워 밀어내지 않는다
                padding: isMobile ? '5px 4px 5px' : '7px 7px 7px',
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

              {cell.inMonth && futureDay && cellIsFuture(cell) && (() => {
                const dayCleaning = classifyDayCleaningItems(futureDay.cleaningItems, futureDay.checkOutPropertyIds);
                // 미배정 = 배정 요청중 + 수동배정 필요 + 청소 계획 자체가 없는 체크아웃(noJob).
                // noJob을 빼면 "퇴실 6건인데 배정완료 1건"처럼 나머지가 어디에도 안 잡히는 문제가 생긴다.
                const dayUnassigned = dayCleaning.requesting.length + dayCleaning.manual.length + dayCleaning.noJob.length;
                return (
                  <div style={{ position: 'relative', zIndex: 2, marginTop: isMobile ? 4 : 7, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {!singleProperty && (
                      <span data-testid="future-occupancy-count" data-occupied={futureDay.occupiedRooms} data-vacant={futureDay.vacantRooms} style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        <DayStat
                          testId="future-occupied-btn" label="체류" value={futureDay.occupiedRooms} color="#475569" isMobile={isMobile}
                          onClick={() => onNavigateToList?.(kstDayOffsetFromToday(cell.key), 'OCCUPIED', { occupied: futureDay.occupiedPropertyIds, vacant: futureDay.vacantPropertyIds })}
                        />
                        <span style={{ fontSize: isMobile ? 8 : 10, color: '#cbd5e1' }}>·</span>
                        <DayStat
                          testId="future-vacant-btn" label="공실" value={futureDay.vacantRooms} color="#475569" isMobile={isMobile}
                          onClick={() => onNavigateToList?.(kstDayOffsetFromToday(cell.key), 'VACANT', { occupied: futureDay.occupiedPropertyIds, vacant: futureDay.vacantPropertyIds })}
                        />
                      </span>
                    )}
                    {(futureDay.checkIns > 0 || futureDay.checkOuts > 0) && (
                      <span data-testid="future-movement-count" data-checkins={futureDay.checkIns} data-checkouts={futureDay.checkOuts} style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        <DayStat
                          testId="future-checkin-btn" label="입실" value={futureDay.checkIns} color="#64748b" isMobile={isMobile}
                          onClick={() => setFuturePopup({ day: cell.key, kind: 'checkin' })}
                        />
                        <span style={{ fontSize: isMobile ? 8 : 10, color: '#cbd5e1' }}>·</span>
                        <DayStat
                          testId="future-checkout-btn" label="퇴실" value={futureDay.checkOuts} color="#64748b" isMobile={isMobile}
                          onClick={() => setFuturePopup({ day: cell.key, kind: 'checkout' })}
                        />
                      </span>
                    )}
                    {(dayCleaning.assigned.length > 0 || dayUnassigned > 0) && (
                      <CleaningDaySummary
                        assigned={dayCleaning.assigned.length}
                        unassigned={dayUnassigned}
                        isMobile={isMobile}
                        onAssignedClick={() => setFuturePopup({ day: cell.key, kind: 'assigned' })}
                        onUnassignedClick={() => setFuturePopup({ day: cell.key, kind: 'unassigned' })}
                      />
                    )}
                  </div>
                );
              })()}

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

              {!cellIsFuture(cell) && dayData?.total > 0 && (
                <button
                  aria-label={`${cell.key} 문제 ${dayData.total}건`}
                  onClick={() => setSelectedDay(cell.key)}
                  style={{
                    position: 'absolute', right: isMobile ? 4 : 7, top: isMobile ? 23 : 29,
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
          metricLabel={`${Number(selectedDay.slice(5, 7))}월 ${Number(selectedDay.slice(8, 10))}일 문제 ${selectedItems.length}건`}
          staticItems={selectedItems}
          staticLoading={displayLoading}
          staticError={!!displayError}
          emptyMessage="문제 없음"
          onClose={() => setSelectedDay(null)}
          renderItem={(item, index) => (
            <IssueRow
              key={`${item.property_id}-${item.occurred_at}-${index}`}
              item={item}
              properties={properties}
              onSelectProperty={onSelectProperty}
              showProperty={!singleProperty}
            />
          )}
        />
      )}

      {/* 다음달 칸의 입실/퇴실/청소배정 팝업 — 미배정 → 배정요청중/수동배정필요로 다시 팝업 전환 */}
      {futurePopup?.kind === 'checkin' && (
        <DrilldownSheet
          metricLabel={`${Number(futurePopup.day.slice(5, 7))}월 ${Number(futurePopup.day.slice(8, 10))}일 입실 예정 ${popupDayData?.checkInPropertyIds.length ?? 0}건`}
          staticItems={popupDayData?.checkInPropertyIds ?? []}
          renderItem={(propertyId) => (
            <SimpleListRow
              key={propertyId}
              name={resolvePropertyName(properties, propertyId)}
              onClick={() => { setFuturePopup(null); selectPropertyById(propertyId); }}
            />
          )}
          emptyMessage="입실 예정 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'checkout' && (
        <DrilldownSheet
          metricLabel={`${Number(futurePopup.day.slice(5, 7))}월 ${Number(futurePopup.day.slice(8, 10))}일 퇴실 예정 ${popupDayData?.checkOutPropertyIds.length ?? 0}건`}
          staticItems={popupDayData?.checkOutPropertyIds ?? []}
          renderItem={(propertyId) => (
            <SimpleListRow
              key={propertyId}
              name={resolvePropertyName(properties, propertyId)}
              onClick={() => { setFuturePopup(null); selectPropertyById(propertyId); }}
            />
          )}
          emptyMessage="퇴실 예정 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'assigned' && (
        <DrilldownSheet
          metricLabel={`${Number(futurePopup.day.slice(5, 7))}월 ${Number(futurePopup.day.slice(8, 10))}일 배정완료 ${popupCleaning.assigned.length}건`}
          staticItems={popupCleaning.assigned}
          renderItem={(item) => (
            <AssignedCleanerRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              cleanerName={item.cleaner_name}
              onClick={() => { setFuturePopup(null); selectPropertyById(item.property_id); }}
            />
          )}
          emptyMessage="배정완료 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'unassigned' && (
        <DrilldownSheet
          metricLabel={`${Number(futurePopup.day.slice(5, 7))}월 ${Number(futurePopup.day.slice(8, 10))}일 청소 미배정`}
          staticItems={[
            { key: 'requesting', label: '배정 요청중',    value: popupCleaning.requesting.length, clickable: popupCleaning.requesting.length > 0 },
            { key: 'manual',     label: '수동배정 필요',   value: popupCleaning.manual.length,     red: popupCleaning.manual.length > 0, clickable: popupCleaning.manual.length > 0 },
            { key: 'nojob',      label: '청소 계획 없음',  value: popupCleaning.noJob.length,      red: popupCleaning.noJob.length > 0,    clickable: popupCleaning.noJob.length > 0 },
          ]}
          renderItem={(row) => (
            <StatRow
              key={row.key}
              label={row.label}
              value={row.value}
              red={row.red}
              onClick={row.clickable ? () => setFuturePopup({ day: futurePopup.day, kind: row.key }) : undefined}
            />
          )}
          emptyMessage="해당 건 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'nojob' && (
        <DrilldownSheet
          metricLabel={`${Number(futurePopup.day.slice(5, 7))}월 ${Number(futurePopup.day.slice(8, 10))}일 청소 계획 없음 ${popupCleaning.noJob.length}건`}
          staticItems={popupCleaning.noJob}
          renderItem={(propertyId) => (
            <SimpleListRow
              key={propertyId}
              name={resolvePropertyName(properties, propertyId)}
              sub="청소 잡 미생성"
              onClick={() => { setFuturePopup(null); selectPropertyById(propertyId); }}
            />
          )}
          emptyMessage="해당 건 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'requesting' && (
        <DrilldownSheet
          metricLabel="배정 요청중"
          staticItems={popupRequestingRows}
          renderItem={({ item, view }) => (
            <ViolationRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              view={view}
              dateLabel={view.when}
              onClick={() => { setFuturePopup(null); selectPropertyById(item.property_id); }}
            />
          )}
          emptyMessage="해당 건 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}

      {futurePopup?.kind === 'manual' && (
        <DrilldownSheet
          metricLabel="수동배정 필요"
          staticItems={popupManualRows}
          renderItem={({ item, view }) => (
            <ViolationRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              view={view}
              dateLabel={view.when}
              onClick={() => { setFuturePopup(null); selectPropertyById(item.property_id); }}
            />
          )}
          emptyMessage="해당 건 없음"
          onClose={() => setFuturePopup(null)}
        />
      )}
    </section>
  );
}

export { monthCells, segmentBarsForDay };
