import { useState, useEffect, useMemo, useRef } from 'react';
import { PROPERTIES, STATE_META, SEGMENT_COLORS, getGanttSegments } from '../../data/roomStateMockData';
import { useMobile } from '../../hooks/useMobile';
import { useReportingStats } from '../../hooks/useReportingStats';
import ListViewFilter from './reporting/ListViewFilter';
import SummaryBanner from './reporting/SummaryBanner';

const PAST_DAYS   = 6;
const FUTURE_DAYS = 14;
const TOTAL_DAYS  = PAST_DAYS + FUTURE_DAYS;  // 20일 한 페이지
const ORDER       = ['CLEANING', 'PRE_STAY_READY', 'OCCUPIED', 'VACANT'];
const FILTER_ALL  = 'ALL';

const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// 윈도우 경계 + 날짜/월 레이블.
// offsetDays: 타임라인 스크롤 위치 (0 = 오늘 중심, -7 = 지난주, +7 = 다음주)
function useGanttWindow(offsetDays = 0) {
  return useMemo(() => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // offsetDays만큼 윈도우 전체를 이동
    const windowStart = new Date(todayMidnight.getTime() + (offsetDays - PAST_DAYS) * 86400000);
    const windowEnd   = new Date(todayMidnight.getTime() + (offsetDays + FUTURE_DAYS) * 86400000);
    const windowMs    = windowEnd - windowStart;

    const dayLabels   = [];
    const monthLabels = [];
    let lastMonth     = -1;

    for (let i = 0; i < TOTAL_DAYS; i++) {
      const d   = new Date(windowStart);
      d.setDate(d.getDate() + i);
      // 실제 오늘로부터 몇 일 차이인지 (0 = 오늘, 음수 = 과거, 양수 = 미래)
      const relToToday = i - (PAST_DAYS - offsetDays);
      const colLeft   = (i / TOTAL_DAYS * 100).toFixed(2);
      const labelLeft = ((i + 0.5) / TOTAL_DAYS * 100).toFixed(2);

      const dayNum = d.getDay();
      dayLabels.push({
        dayOfWeek: DAY_NAMES[dayNum],
        date:      d.getDate(),
        dayNum,
        colLeft,
        labelLeft,
        isToday:   relToToday === 0,
        isFuture:  relToToday > 0,
        isSat:     dayNum === 6,
        isSun:     dayNum === 0,
        isWeekend: dayNum === 0 || dayNum === 6,
      });

      const month = d.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({ label: `${MONTH_NAMES[month]} ${d.getFullYear()}`, left: colLeft });
        lastMonth = month;
      }
    }

    return { windowStart, windowEnd, windowMs, dayLabels, monthLabels };
  }, [offsetDays]);
}

// 현재 시각 위치 (1분마다 갱신)
function useLiveNow(windowStart, windowMs) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const nowLeft = ((now - windowStart) / windowMs * 100).toFixed(2);
  const h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, '0');
  const timeStr = `${h < 12 ? 'AM' : 'PM'} ${h % 12 || 12}:${m}`;
  return { now, nowLeft, timeStr };
}

function mergeGanttSegments(segs) {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of sorted) {
    const last = merged[merged.length - 1];
    // isFuture 경계를 넘어서 merge하지 않음 — 색상이 달라야 함
    if (last && last.mainStatus === seg.mainStatus && !!last.isFuture === !!seg.isFuture) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function GanttBar({ seg, windowStart, windowMs, isDragging }) {
  const meta = STATE_META[seg.mainStatus];
  if (!meta) return null;
  const windowEnd = windowStart.getTime() + windowMs;
  const s = Math.max(seg.start.getTime(), windowStart.getTime());
  const e = Math.min(seg.end.getTime(), windowEnd);
  if (e <= s) return null;
  const left  = ((s - windowStart) / windowMs * 100).toFixed(2);
  const width = ((e - s) / windowMs * 100).toFixed(2);
  const isFuture = !!seg.isFuture;
  const subColor = SEGMENT_COLORS[`${seg.mainStatus}/${seg.subStatus}`] || meta.lightColor;

  return (
    <div
      title={`${meta.label}${isFuture ? ' (예정)' : ''}`}
      style={{
        position: 'absolute',
        left: `${left}%`, width: `${width}%`,
        top: 5, bottom: 5,
        display: 'flex', flexDirection: 'column',
        opacity: isFuture ? 0.92 : 0.42,
        minWidth: 3, overflow: 'hidden',
        transition: isDragging ? 'none' : 'left 0.25s ease, width 0.25s ease',
      }}
    >
      {/* 메인 상태 바 */}
      <div style={{ flex: 1, background: meta.color }} />
      {/* 서브 상태 바 — 하단 10% 얇은 선, 텍스트 없음 */}
      <div style={{ height: 3, background: subColor }} />
    </div>
  );
}


export default function PropertyListView({ initialFilter, onSelectProperty, onBack, properties = PROPERTIES }) {
  const isMobile = useMobile();
  const [filter, setFilter] = useState(initialFilter || FILTER_ALL);
  const [windowOffset, setWindowOffset] = useState(0); // 일 단위 스크롤 오프셋
  const [listMode, setListMode] = useState('week');    // 'week' | 'day'

  // 현재 뷰포트 위치 → 통계 기간 자동 도출
  const statsPeriod = useMemo(() => {
    if (listMode === 'week') {
      if (windowOffset <= -4) return 'last_week';
      if (windowOffset >= 4)  return 'next_week';
      return 'this_week';
    }
    if (windowOffset < 0) return 'yesterday';
    if (windowOffset > 0) return 'tomorrow';
    return 'today';
  }, [windowOffset, listMode]);

  const { stats, summary, loading: statsLoading } = useReportingStats(statsPeriod, null);
  const { windowStart, windowEnd, windowMs, dayLabels, monthLabels } = useGanttWindow(windowOffset);
  const { now, nowLeft, timeStr } = useLiveNow(windowStart, windowMs);

  const filtered = properties.filter(p =>
    filter === FILTER_ALL || p.currentState.mainStatus === filter
  );

  const sortOrder  = { OCCUPIED: 0, PRE_STAY_READY: 1, CLEANING: 2, VACANT: 3 };
  const subUrgency = { ISSUE_AND_ENERGY: 0, ISSUE_COMPLAINT: 1, ENERGY_WASTE: 2, GOOD_CONDITION: 3 };
  const sorted = [...filtered].sort((a, b) => {
    if (!!a.isLive !== !!b.isLive) return a.isLive ? -1 : 1;
    const mo = (sortOrder[a.currentState.mainStatus] || 9) - (sortOrder[b.currentState.mainStatus] || 9);
    if (mo !== 0) return mo;
    return (subUrgency[a.currentState.subStatus] ?? 9) - (subUrgency[b.currentState.subStatus] ?? 9);
  });

  const PAD         = isMobile ? 12 : 20;
  const NAME_W      = isMobile ? 86 : 140;
  const BADGE_W     = isMobile ? 80 : 110;
  const STRIP_W     = 4;
  const GANTT_H     = isMobile ? 44 : 72;   // 간트 헤더 높이
  const ROW_GANTT_H = isMobile ? 26 : 40;   // 숙소 행 간트 바 높이
  // 고정 열 너비: 모바일 2행 레이아웃은 스트립만, PC는 스트립+이름+배지
  const fixedLeft   = isMobile ? PAD + STRIP_W : PAD + STRIP_W + NAME_W + BADGE_W;

  // ── 간트 드래그-to-스크롤 (헤더 + 각 숙소 행 공용) ────────────────────────────
  // didDragRef: pointerup 이후 click 이벤트까지 살아있어야 하므로 ref 사용
  const ganttHeaderRef = useRef(null);
  const dragRef   = useRef({ active: false, startX: 0, startOffset: 0 });
  const didDragRef = useRef(false);      // drag vs click 구별용
  const [isDragging, setIsDragging] = useState(false);

  function startGanttDrag(e) {
    dragRef.current = { active: true, startX: e.clientX, startOffset: windowOffset };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function updateGanttDrag(e) {
    if (!dragRef.current.active) return;
    // 너비: 이벤트 대상 요소 또는 헤더 ref 폴백
    const w = e.currentTarget.clientWidth || ganttHeaderRef.current?.clientWidth || 1;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) >= 5) {           // 5px 이상이면 드래그로 확정
      didDragRef.current = true;
      const delta = Math.round((-dx / w) * TOTAL_DAYS);
      setWindowOffset(dragRef.current.startOffset + delta);
    }
  }
  function endGanttDrag() {
    dragRef.current.active = false;
    setIsDragging(false);
    // didDragRef는 click 이벤트에서 초기화 (여기서 지우면 click이 먼저 볼 수 없음)
  }

  // ── 단일 JSX 트리 — isMobile로 크기/간격만 조정 ───────────────────────────────
  return (
    <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 최소 헤더 — 뒤로가기 + LIVE 인디케이터 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: isMobile ? '7px 12px' : '9px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: isMobile ? '4px 9px' : '5px 11px', fontSize: isMobile ? 12 : 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          ← 대시보드
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: isMobile ? 10 : 11, fontFamily: "'DM Mono', monospace", color: '#059669', fontWeight: 700, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', display: 'inline-block', flexShrink: 0 }} />
            {`LIVE ${now.getMonth()+1}/${now.getDate()} ${now.getHours() < 12 ? 'AM' : 'PM'} ${(now.getHours()%12||12).toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`}
          </span>
          <span style={{ fontSize: 10, color: '#c8d3dc', fontFamily: "'DM Mono', monospace" }}>
            {sorted.length}/{properties.length}
          </span>
        </div>
      </div>

      {/* 상태 필터 바 — 모바일: 소형 버튼 한 줄, PC: 일반 크기 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: `${isMobile ? 7 : 10}px ${PAD}px`, display: 'flex', gap: isMobile ? 4 : 8, overflowX: 'hidden', flexWrap: 'nowrap' }}>
        {[FILTER_ALL, ...ORDER].map(key => {
          const meta   = key === FILTER_ALL ? null : STATE_META[key];
          const cnt    = key === FILTER_ALL ? properties.length : properties.filter(p => p.currentState.mainStatus === key).length;
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} style={{
              flexShrink: 0,
              border: `1.5px solid ${active ? (meta?.color || '#2563eb') : '#e2e8f0'}`,
              borderRadius: 20, padding: isMobile ? '3px 7px' : '5px 14px',
              background: active ? (meta?.color || '#2563eb') : '#fff',
              color: active ? '#fff' : (meta?.color || '#4a5568'),
              fontSize: isMobile ? 10 : 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
              {meta ? meta.label : '전체'} {cnt}
            </button>
          );
        })}
      </div>

      {/* 타임라인 네비게이터 + 요약 배너 */}
      <ListViewFilter
        windowOffset={windowOffset}
        onOffsetChange={setWindowOffset}
        mode={listMode}
        onModeChange={setListMode}
        isMobile={isMobile}
      />
      <SummaryBanner summary={summary} loading={statsLoading} isMobile={isMobile} />

      {/* 간트 헤더 + 목록 래퍼 — 현재 시각 연속선 기준점 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }}>

        {/* 현재 시각 연속 수직선 — 헤더~목록 전체 관통 */}
        <div style={{
          position: 'absolute',
          left: `calc(${fixedLeft}px + ${nowLeft / 100} * (100% - ${fixedLeft + PAD}px))`,
          top: 0, bottom: 0,
          width: 2, background: '#1a202c', zIndex: 20, pointerEvents: 'none',
          transition: isDragging ? 'none' : 'left 0.25s ease',
        }} />

      {/* 간트 헤더 — 모바일: 스트립 너비만 고정, PC: 스트립+이름+배지 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: `0 ${PAD}px`, display: 'flex' }}>
        <div style={{ width: isMobile ? STRIP_W : STRIP_W + NAME_W, flexShrink: 0, padding: isMobile ? undefined : '8px 0 8px 8px', fontSize: 11, color: '#a0aec0', fontWeight: 600, letterSpacing: 0.5, display: 'flex', alignItems: 'flex-end' }}>
          {!isMobile && '숙소'}
        </div>
        <div style={{ width: isMobile ? 0 : BADGE_W, flexShrink: 0 }} />

        {/* 간트 열 헤더 — 드래그로 타임라인 이동 */}
        <div
          ref={ganttHeaderRef}
          style={{ flex: 1, position: 'relative', height: GANTT_H, overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
          onPointerDown={startGanttDrag}
          onPointerMove={updateGanttDrag}
          onPointerUp={endGanttDrag}
          onPointerCancel={endGanttDrag}
        >


          {/* ② 지금 레이블 + 도트 (Detail View와 동일 스타일) */}
          <div style={{
            position: 'absolute', left: `${nowLeft}%`, top: 3,
            transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 3, zIndex: 10,
            transition: isDragging ? 'none' : 'left 0.25s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
              <span style={{
                fontSize: 8, fontWeight: 800, color: '#1a202c',
                fontFamily: "'DM Mono', monospace", lineHeight: 1,
              }}>
                지금
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#fff', background: '#1a202c',
                padding: '1px 5px', borderRadius: 3,
                fontFamily: "'DM Mono', monospace",
              }}>
                {timeStr}
              </span>
            </div>
            {/* 도트 */}
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a202c' }} />
          </div>

          {/* ③ 월/연도 — PC만 표시 */}
          {!isMobile && monthLabels.map((ml, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${ml.left}%`, top: 30,
              fontSize: 10, color: '#64748b', fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2,
              paddingLeft: 4, whiteSpace: 'nowrap',
              transition: isDragging ? 'none' : 'left 0.25s ease',
            }}>
              {ml.label}
            </div>
          ))}

          {/* ④ 날짜 레이블 + 구분 세로선 */}
          {dayLabels.map((dl, i) => {
            // 요일별 색상
            const txtColor = dl.isToday ? '#1a202c'
              : dl.isSun ? '#f87171'
              : dl.isSat ? '#60a5fa'
              : dl.isFuture ? '#94a3b8'
              : '#374151';
            const sepColor = dl.isSun ? '#fecaca'
              : dl.isSat ? '#bfdbfe'
              : '#c8d3dc';
            const posLeft      = dl.labelLeft;
            const posTransform = 'translateX(-50%)';

            return (
              <div key={i}>
                {/* 날짜 구분 세로선 */}
                <div style={{
                  position: 'absolute', left: `${dl.colLeft}%`, top: 0, bottom: 0,
                  width: dl.isWeekend ? 1.5 : 1,
                  background: sepColor,
                  zIndex: 1,
                  transition: isDragging ? 'none' : 'left 0.25s ease',
                }} />
                {/* 날짜 레이블 (Today 포함 전부 표시) */}
                <div style={{
                  position: 'absolute', left: `${posLeft}%`, top: isMobile ? 37 : 44,
                  transform: posTransform,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  transition: isDragging ? 'none' : 'left 0.25s ease',
                }}>
                  {!isMobile && <span style={{
                    fontSize: 8, color: txtColor,
                    fontFamily: "'DM Mono', monospace", lineHeight: 1,
                    fontWeight: dl.isToday || dl.isWeekend ? 700 : 400,
                  }}>
                    {dl.dayOfWeek}
                  </span>}
                  <span style={{
                    fontSize: isMobile ? 9 : 11, color: txtColor,
                    fontFamily: "'DM Mono', monospace",
                    fontWeight: dl.isToday || dl.isWeekend ? 700 : 400, lineHeight: 1,
                  }}>
                    {dl.date}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 숙소 목록 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `8px ${PAD}px` }}>
        {sorted.map((prop) => {
          const meta     = STATE_META[prop.currentState.mainStatus];
          const subLabel = meta.subStates[prop.currentState.subStatus]?.label || prop.currentState.subStatus;
          const subColor = SEGMENT_COLORS[`${prop.currentState.mainStatus}/${prop.currentState.subStatus}`] || meta.color;
          const isUrgent = prop.currentState.mainStatus === 'OCCUPIED' &&
            ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(prop.currentState.subStatus);

          return (
            <div
              key={prop.id}
              onClick={() => {
                // 간트 바 드래그였으면 상세 이동 억제
                if (didDragRef.current) { didDragRef.current = false; return; }
                onSelectProperty(prop);
              }}
              style={{
                display: isMobile ? 'grid' : 'flex',
                gridTemplateColumns: isMobile ? `${STRIP_W}px 1fr ${BADGE_W}px` : undefined,
                gridTemplateRows: isMobile ? 'auto auto' : undefined,
                alignItems: isMobile ? 'stretch' : 'center',
                background: '#fff', borderRadius: 10, marginBottom: 6,
                border: `1.5px solid ${isUrgent ? meta.color : '#e2e8f0'}`,
                cursor: 'pointer', overflow: 'hidden',
              }}
            >
              {/* 색상 스트립 — 모바일: grid 1열 양쪽 행 span */}
              <div style={{
                gridRow: isMobile ? '1 / 3' : undefined,
                gridColumn: isMobile ? '1' : undefined,
                width: isMobile ? undefined : STRIP_W,
                alignSelf: 'stretch', background: meta.color, flexShrink: 0,
              }} />

              {/* 숙소명 — 모바일: grid 1행 2열 */}
              <div style={{
                gridRow: isMobile ? '1' : undefined,
                gridColumn: isMobile ? '2' : undefined,
                width: isMobile ? undefined : NAME_W,
                flexShrink: isMobile ? undefined : 0,
                padding: isMobile ? '5px 8px' : '10px 10px',
                minWidth: 0,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a202c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prop.name}
                </div>
                {!isMobile && <div style={{ fontSize: 10, color: '#a0aec0' }}>{prop.district}</div>}
              </div>

              {/* 상태 배지 — 모바일: grid 1행 3열 */}
              <div style={{
                gridRow: isMobile ? '1' : undefined,
                gridColumn: isMobile ? '3' : undefined,
                width: isMobile ? undefined : BADGE_W,
                flexShrink: 0,
                padding: isMobile ? '4px 5px' : '0 6px',
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  borderRadius: 7, padding: isMobile ? '3px 4px' : '4px 6px',
                  textAlign: 'center', width: '100%',
                }}>
                  <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, color: subColor, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subLabel}</div>
                </div>
              </div>

              {/* 간트 바 — 드래그로 타임라인 이동, 짧은 탭은 상세 이동 */}
              <div
                style={{
                  gridRow: isMobile ? '2' : undefined,
                  gridColumn: isMobile ? '2 / 4' : undefined,
                  flex: isMobile ? undefined : 1,
                  position: 'relative', height: ROW_GANTT_H, overflow: 'hidden',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  userSelect: 'none',
                }}
                onPointerDown={startGanttDrag}
                onPointerMove={updateGanttDrag}
                onPointerUp={endGanttDrag}
                onPointerCancel={endGanttDrag}
              >
                {/* 과거 구간 배경 — 연한 회색으로 "지난 시간" 느낌 */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${nowLeft}%`,
                  background: 'rgba(241,245,249,0.7)', zIndex: 0,
                  transition: isDragging ? 'none' : 'width 0.25s ease',
                }} />

                {/* 일자 구분선 */}
                {dayLabels.map((dl, di) => {
                  const sepColor = dl.isSun ? '#fecaca' : dl.isSat ? '#bfdbfe' : '#c8d3dc';
                  return (
                    <div key={di} style={{
                      position: 'absolute', left: `${dl.colLeft}%`, top: 0, bottom: 0,
                      width: dl.isWeekend ? 1.5 : 1,
                      background: sepColor,
                      zIndex: 0,
                      transition: isDragging ? 'none' : 'left 0.25s ease',
                    }} />
                  );
                })}


                {/* 상태 바 (과거 + 미래 예측 포함) */}
                {mergeGanttSegments(getGanttSegments(prop, windowStart, windowEnd)).map((seg, si) => (
                  <GanttBar key={si} seg={seg} windowStart={windowStart} windowMs={windowMs} isDragging={isDragging} />
                ))}
              </div>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#a0aec0', fontSize: 14 }}>
            해당 상태의 숙소가 없습니다.
          </div>
        )}
      </div>
      </div>{/* 간트 래퍼 끝 */}

      {/* 범례 */}
      <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: `10px ${PAD}px`, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(STATE_META).map(([key, meta]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, background: meta.color, borderRadius: 3 }} />
            <span style={{ fontSize: 11, color: '#718096' }}>{meta.label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 12, height: 12, background: '#2563eb', borderRadius: 3, opacity: 0.35 }} />
          <span style={{ fontSize: 11, color: '#718096' }}>미래 예측</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 2.5, height: 14, background: '#1a202c', borderRadius: 1 }} />
          <span style={{ fontSize: 11, color: '#718096' }}>지금 (현재)</span>
        </div>
      </div>
    </div>
  );
}
