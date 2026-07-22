import { useState, useEffect, useMemo } from 'react';
import { PROPERTIES, STATE_META, SEGMENT_COLORS, getGanttSegments } from '../../data/roomStateMockData';

const PAST_DAYS   = 6;
const FUTURE_DAYS = 14;
const TOTAL_DAYS  = PAST_DAYS + FUTURE_DAYS;  // 20일 한 페이지
const ORDER       = ['OCCUPIED', 'PRE_STAY_READY', 'CLEANING', 'VACANT'];
const FILTER_ALL  = 'ALL';

const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// 윈도우 경계 + 날짜/월 레이블 (정적 — 하루에 한 번만 계산)
function useGanttWindow() {
  return useMemo(() => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const windowStart = new Date(todayMidnight);
    windowStart.setDate(windowStart.getDate() - PAST_DAYS);

    const windowEnd = new Date(todayMidnight);
    windowEnd.setDate(windowEnd.getDate() + FUTURE_DAYS);

    const windowMs  = windowEnd - windowStart;
    const todayLeft = (PAST_DAYS / TOTAL_DAYS * 100).toFixed(2); // 30%

    const dayLabels   = [];
    const monthLabels = [];
    let lastMonth     = -1;

    for (let i = 0; i < TOTAL_DAYS; i++) {
      const d   = new Date(windowStart);
      d.setDate(d.getDate() + i);
      const rel       = i - PAST_DAYS;
      const colLeft   = (i / TOTAL_DAYS * 100).toFixed(2);
      const labelLeft = ((i + 0.5) / TOTAL_DAYS * 100).toFixed(2); // 열 중앙

      const dayNum = d.getDay(); // 0=Sun, 6=Sat
      dayLabels.push({
        dayOfWeek: DAY_NAMES[dayNum],
        date:      d.getDate(),
        dayNum,
        colLeft,
        labelLeft,
        isToday:   rel === 0,
        isFuture:  rel > 0,
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

    return { windowStart, windowEnd, windowMs, todayLeft, dayLabels, monthLabels };
  }, []);
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

function GanttBar({ seg, windowStart, windowMs }) {
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
  const [filter, setFilter] = useState(initialFilter || FILTER_ALL);
  const { windowStart, windowEnd, windowMs, dayLabels, monthLabels } = useGanttWindow();
  const { nowLeft, timeStr } = useLiveNow(windowStart, windowMs);

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

  const NAME_W  = 140;
  const BADGE_W = 82;
  const STRIP_W = 4;

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 페이지 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '6px 12px', fontSize: 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit' }}>
          ← 대시보드
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1a202c' }}>숙소 목록</div>
          <div style={{ fontSize: 12, color: '#a0aec0', fontFamily: "'DM Mono', monospace" }}>
            20일 타임라인 · {sorted.length}개 표시 (전체 {properties.length})
          </div>
        </div>
      </div>

      {/* 필터 바 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {[FILTER_ALL, ...ORDER].map(key => {
          const meta   = key === FILTER_ALL ? null : STATE_META[key];
          const cnt    = key === FILTER_ALL ? properties.length : properties.filter(p => p.currentState.mainStatus === key).length;
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} style={{
              flexShrink: 0,
              border: `1.5px solid ${active ? (meta?.color || '#2563eb') : '#e2e8f0'}`,
              borderRadius: 20, padding: '5px 14px',
              background: active ? (meta?.color || '#2563eb') : '#fff',
              color: active ? '#fff' : (meta?.color || '#4a5568'),
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
              {meta ? meta.label : '전체'} {cnt}
            </button>
          );
        })}
      </div>

      {/* 간트 헤더 + 목록 래퍼 — 현재 시각 연속선 기준점 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }}>

        {/* 현재 시각 연속 수직선 — 헤더~목록 전체 관통, 각 행에 개별 선 없음 */}
        <div style={{
          position: 'absolute',
          left: `calc(${20 + STRIP_W + NAME_W + BADGE_W}px + ${nowLeft / 100} * (100% - ${20 + STRIP_W + NAME_W + BADGE_W + 20}px))`,
          top: 0, bottom: 0,
          width: 2, background: '#1a202c', zIndex: 20, pointerEvents: 'none',
        }} />

      {/* 간트 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 20px', display: 'flex' }}>
        {/* 왼쪽 고정 열 헤더 */}
        <div style={{ width: STRIP_W + NAME_W, flexShrink: 0, padding: '8px 0 8px 8px', fontSize: 11, color: '#a0aec0', fontWeight: 600, letterSpacing: 0.5, display: 'flex', alignItems: 'flex-end' }}>
          숙소
        </div>
        <div style={{ width: BADGE_W, flexShrink: 0 }} />

        {/* 간트 열 헤더 */}
        <div style={{ flex: 1, position: 'relative', height: 72, overflow: 'hidden' }}>


          {/* ② 지금 레이블 + 도트 (Detail View와 동일 스타일) */}
          <div style={{
            position: 'absolute', left: `${nowLeft}%`, top: 3,
            transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 3, zIndex: 10,
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

          {/* ③ 월/연도 — Today 레이블 아래 */}
          {monthLabels.map((ml, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${ml.left}%`, top: 30,
              fontSize: 10, color: '#64748b', fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2,
              paddingLeft: 4, whiteSpace: 'nowrap',
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
                }} />
                {/* 날짜 레이블 (Today 포함 전부 표시) */}
                <div style={{
                  position: 'absolute', left: `${posLeft}%`, top: 44,
                  transform: posTransform,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                }}>
                  <span style={{
                    fontSize: 8, color: txtColor,
                    fontFamily: "'DM Mono', monospace", lineHeight: 1,
                    fontWeight: dl.isToday || dl.isWeekend ? 700 : 400,
                  }}>
                    {dl.dayOfWeek}
                  </span>
                  <span style={{
                    fontSize: 11, color: txtColor,
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
        {sorted.map((prop) => {
          const meta     = STATE_META[prop.currentState.mainStatus];
          const subLabel = meta.subStates[prop.currentState.subStatus]?.label || prop.currentState.subStatus;
          const isUrgent = prop.currentState.mainStatus === 'OCCUPIED' &&
            ['ISSUE_AND_ENERGY', 'ISSUE_COMPLAINT', 'ENERGY_WASTE'].includes(prop.currentState.subStatus);

          return (
            <div
              key={prop.id}
              onClick={() => onSelectProperty(prop)}
              style={{
                display: 'flex', alignItems: 'center',
                background: '#fff', borderRadius: 10, marginBottom: 6,
                border: `1.5px solid ${isUrgent ? meta.color : '#e2e8f0'}`,
                cursor: 'pointer', overflow: 'hidden',
              }}
            >
              <div style={{ width: STRIP_W, alignSelf: 'stretch', background: meta.color, flexShrink: 0 }} />
              <div style={{ width: NAME_W, flexShrink: 0, padding: '10px 10px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a202c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prop.name}
                </div>
                <div style={{ fontSize: 10, color: '#a0aec0' }}>{prop.district}</div>
              </div>
              <div style={{ width: BADGE_W, flexShrink: 0, padding: '0 6px' }}>
                <div style={{
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  borderRadius: 7, padding: '4px 6px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: meta.color, lineHeight: 1.2 }}>{meta.label}</div>
                  <div style={{ fontSize: 9, color: meta.color, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subLabel}</div>
                </div>
              </div>

              {/* 간트 바 */}
              <div style={{ flex: 1, position: 'relative', height: 40, overflow: 'hidden' }}>
                {/* 과거 구간 배경 — 연한 회색으로 "지난 시간" 느낌 */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${nowLeft}%`,
                  background: 'rgba(241,245,249,0.7)', zIndex: 0,
                }} />

                {/* 일자 구분선 */}
                {dayLabels.map((dl) => {
                  const sepColor = dl.isSun ? '#fecaca' : dl.isSat ? '#bfdbfe' : '#c8d3dc';
                  return (
                    <div key={dl.date + dl.dayNum} style={{
                      position: 'absolute', left: `${dl.colLeft}%`, top: 0, bottom: 0,
                      width: dl.isWeekend ? 1.5 : 1,
                      background: sepColor,
                      zIndex: 0,
                    }} />
                  );
                })}


                {/* 상태 바 (과거 + 미래 예측 포함) */}
                {mergeGanttSegments(getGanttSegments(prop, windowStart, windowEnd)).map((seg, si) => (
                  <GanttBar key={si} seg={seg} windowStart={windowStart} windowMs={windowMs} />
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
      <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
