import { useState, useEffect, useRef, useMemo } from 'react';
import { STATE_META, SEGMENT_COLORS, getWindowSegments } from '../../data/roomStateMockData';

const PAST_HOURS    = 24;          // 현재 시각 이전 24h
const FUTURE_HOURS  = 48;          // 현재 시각 이후 48h
const WINDOW_HOURS  = PAST_HOURS + FUTURE_HOURS;  // 총 72h
const VISIBLE_HOURS = 20;          // 한 화면에 보여줄 시간 수 (1시간 칸 크기 기준)
const TIMELINE_WIDTH = 60;
const LABEL_WIDTH    = 46;
const SUB_BAR_W      = 28;         // 서브 상태 바 폭 (px)

const SENSOR_ICONS   = { temp: '🌡', humidity: '💧', noise: '🔊', power: '⚡', co2: '💨' };
const SENSOR_UNITS   = { temp: '°C', humidity: '%', noise: 'dB', power: 'W', co2: 'ppm' };
const SENSOR_LABELS  = { temp: '온도', humidity: '습도', noise: '소음', power: '전력', co2: 'CO₂' };
const SENSOR_WARN    = { temp: [27, 99], humidity: [70, 99], noise: [75, 99], power: [2000, 99999], co2: [1000, 9999] };

function isWarn(key, val) {
  const [lo] = SENSOR_WARN[key] || [Infinity];
  return val >= lo;
}

function formatTime(d) {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h < 12 ? 'AM' : 'PM'} ${h % 12 || 12}:${m}`;
}

// "AM 1", "PM 3" 형식 — 분 없이 간결하게
function formatHourLabel(t) {
  const h = t.getHours();
  return `${h < 12 ? 'AM' : 'PM'} ${h % 12 || 12}`;
}

// "7/6 (월)" 형식 — 자정 날짜 표기
const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateLabel(t) {
  return `${t.getMonth() + 1}/${t.getDate()} (${DAY_KR[t.getDay()]})`;
}

function StateBar({ seg, windowStart, mainStatusRefs, hourPx }) {
  const meta = STATE_META[seg.mainStatus];
  if (!meta) return null;

  const mainColor = meta.color;
  const subColor  = SEGMENT_COLORS[`${seg.mainStatus}/${seg.subStatus}`] || meta.lightColor;
  const topPx     = ((seg.start - windowStart) / 3600000) * hourPx;
  const heightPx  = ((seg.end - seg.start) / 3600000) * hourPx;
  if (heightPx < 2) return null;
  const subLabel  = meta.subStates[seg.subStatus]?.label || '';

  // 과거: 연하게 / 미래: 진하게
  const opacity = seg.isFuture ? 1 : 0.48;

  // 미래 OCCUPIED sub-status는 게스트 행동 예측 불가 → 서브 바 숨김
  const showSub = !(seg.isFuture && seg.mainStatus === 'OCCUPIED');

  return (
    <div style={{
      position: 'absolute',
      top: topPx, height: heightPx,
      left: 0, right: 0,
      display: 'flex',
      overflow: 'hidden',
      opacity,
    }}>
      {/* 메인 상태 바 */}
      <div
        ref={el => { if (el && mainStatusRefs.current) mainStatusRefs.current[seg.mainStatus] = el; }}
        style={{
          flex: 1,
          background: mainColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {heightPx > 22 && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            textAlign: 'center', padding: '0 2px',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            {meta.label}
          </span>
        )}
      </div>

      {/* 서브 상태 바 — 미래 OCCUPIED는 숨김 (예측 불가) */}
      {showSub ? (
        <div style={{
          width: SUB_BAR_W,
          background: subColor,
          borderLeft: '1px solid rgba(255,255,255,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {heightPx > 44 && subLabel && (
            <span style={{
              fontSize: 8, color: 'rgba(255,255,255,0.95)',
              textShadow: '0 1px 1px rgba(0,0,0,0.4)',
              writingMode: 'vertical-rl',
              userSelect: 'none',
              lineHeight: 1.1,
              overflow: 'hidden',
            }}>
              {subLabel}
            </span>
          )}
        </div>
      ) : (
        /* 미래 OCCUPIED: 서브 바 자리는 유지하되 빈 공간으로 */
        <div style={{
          width: SUB_BAR_W, flexShrink: 0,
          background: 'rgba(255,255,255,0.12)',
          borderLeft: '1px solid rgba(255,255,255,0.2)',
        }} />
      )}
    </div>
  );
}

function LiveSensor({ sensorKey, baseVal }) {
  const [val, setVal] = useState(baseVal);
  useEffect(() => {
    const ranges = { temp: 0.3, humidity: 2, noise: 5, power: 80, co2: 30 };
    const range = ranges[sensorKey] || 1;
    const timer = setInterval(() => {
      setVal(baseVal + (Math.random() - 0.5) * range * 2);
    }, 2500 + Math.random() * 1500);
    return () => clearInterval(timer);
  }, [sensorKey, baseVal]);

  const warn = isWarn(sensorKey, val);
  const display = sensorKey === 'temp' ? val.toFixed(1) : Math.round(val);

  return (
    <div style={{
      background: warn ? '#fef2f2' : '#f9fafb',
      border: `1.5px solid ${warn ? '#fca5a5' : '#e2e8f0'}`,
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#718096' }}>{SENSOR_ICONS[sensorKey]} {SENSOR_LABELS[sensorKey]}</span>
        {warn && <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 700 }}>⚠ 주의</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: warn ? '#dc2626' : '#1a202c', fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
          {display}
        </span>
        <span style={{ fontSize: 14, color: '#718096', paddingBottom: 2 }}>{SENSOR_UNITS[sensorKey]}</span>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: warn ? '#dc2626' : '#059669',
          marginLeft: 4, marginBottom: 3,
          animation: 'pulse 2s ease infinite',
        }} />
      </div>
    </div>
  );
}

export default function PropertyDetailView({ property, onBack }) {
  const mainStatusRefs = useRef({});
  const timelineRef = useRef(null);
  const now = new Date();

  // 화면 높이 기반 초기 추정: 헤더 약 140px 제외 후 40시간 분할
  const [hourPx, setHourPx] = useState(() =>
    Math.max(20, Math.floor((window.innerHeight - 140) / VISIBLE_HOURS))
  );

  // windowStart = now - PAST_HOURS  /  windowEnd = now + FUTURE_HOURS
  // 덕분에 "지금" 마커가 타임라인 바닥 경계에 붙지 않고 내부에 위치
  const windowStart = useMemo(() => new Date(now.getTime() - PAST_HOURS * 3600000), []);
  const containerHeight = WINDOW_HOURS * hourPx;

  const recentSegs = useMemo(() => getWindowSegments(property, PAST_HOURS, FUTURE_HOURS), [property]);

  const presentMainStatuses = useMemo(() => {
    const seen = new Set();
    recentSegs.forEach(s => seen.add(s.mainStatus));
    return seen;
  }, [recentSegs]);

  const currentMeta = STATE_META[property.currentState.mainStatus];
  const currentSubLabel = currentMeta.subStates[property.currentState.subStatus]?.label || property.currentState.subStatus;

  // 매시간 정각 마커 — windowEnd(=now+2h)까지 포함, 자정엔 날짜 표시
  const windowEnd = useMemo(
    () => new Date(windowStart.getTime() + WINDOW_HOURS * 3600000), [windowStart]);

  const hourMarkers = useMemo(() => {
    const markers = [];
    const first = new Date(windowStart);
    first.setMinutes(0, 0, 0);
    if (first <= windowStart) first.setHours(first.getHours() + 1);

    for (let t = new Date(first); t <= windowEnd; t = new Date(t.getTime() + 3600000)) {
      const topPx    = ((t - windowStart) / 3600000) * hourPx;
      const h        = t.getHours();
      const isNewDay = h === 0;
      const isMajor  = isNewDay || h % 6 === 0;
      const isMid    = !isMajor && h % 3 === 0;
      markers.push({
        topPx,
        label:     isNewDay ? formatDateLabel(t) : formatHourLabel(t),
        isNewDay,
        isMajor,
        isMid,
      });
    }
    return markers;
  }, [windowStart, windowEnd, hourPx]);

  // "지금" 마커 위치: PAST_HOURS 기준 → 타임라인 안쪽에 위치 (바닥 경계에 붙지 않음)
  const nowTopPx = PAST_HOURS * hourPx;

  // 마운트 후 실제 컨테이너 높이로 보정 (40시간 = 화면 꽉 채움)
  useEffect(() => {
    if (!timelineRef.current) return;
    const h = timelineRef.current.clientHeight;
    if (h > 0) setHourPx(h / VISIBLE_HOURS);
  }, []);

  // hourPx 확정 후 "지금" 마커를 화면 상단 30% 위치로 스크롤
  // → 화면 위 30%: 과거 / 아래 70%: 미래
  useEffect(() => {
    if (timelineRef.current) {
      const visibleH = timelineRef.current.clientHeight;
      timelineRef.current.scrollTop = nowTopPx - visibleH * 0.3;
    }
  }, [hourPx, nowTopPx]);

  function scrollToState(mainStatus) {
    const el = mainStatusRefs.current[mainStatus];
    if (el && timelineRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return (
    <div style={{ background: '#f0f4f8', height: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: '6px 12px', fontSize: 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit' }}>
            ← 목록
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1a202c' }}>{property.name}</div>
            <div style={{ fontSize: 12, color: '#a0aec0' }}>{property.district} · {property.id}</div>
          </div>
          <div style={{
            background: currentMeta.bg, border: `1.5px solid ${currentMeta.border}`,
            borderRadius: 10, padding: '8px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: currentMeta.color }}>{currentMeta.label}</div>
            <div style={{ fontSize: 11, color: currentMeta.color, opacity: 0.9 }}>{currentSubLabel}</div>
          </div>
        </div>

        {/* 상태 필터 탭 */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {Object.entries(STATE_META).map(([key, meta]) => {
            const active = presentMainStatuses.has(key);
            return (
              <button
                key={key}
                onClick={() => active && scrollToState(key)}
                disabled={!active}
                style={{
                  flexShrink: 0,
                  border: `1.5px solid ${active ? meta.color : '#e2e8f0'}`,
                  borderRadius: 20,
                  padding: '4px 13px',
                  background: active ? meta.bg : '#f9fafb',
                  color: active ? meta.color : '#c8d5e0',
                  fontSize: 12, fontWeight: 600,
                  cursor: active ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {meta.label}
              </button>
            );
          })}
          <span style={{ fontSize: 11, color: '#a0aec0', alignSelf: 'center', marginLeft: 4, flexShrink: 0 }}>
            탭 클릭 → 해당 구간
          </span>
        </div>
      </div>

      {/* 본문: 타임라인(좁게) + 센서 패널(넓게) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* 세로 타임라인 — 고정 폭 */}
        <div
          ref={timelineRef}
          style={{
            width: LABEL_WIDTH + TIMELINE_WIDTH + SUB_BAR_W + 24,  // 레이블 + 메인바 + 서브바 + 패딩
            flexShrink: 0,
            overflowY: 'auto',
            padding: '16px 8px 40px 16px',
          }}
        >
          <div style={{ position: 'relative', height: containerHeight }}>
            {/* 시간 축 */}
            {hourMarkers.map((m, i) => (
              <div key={i} style={{ position: 'absolute', top: m.topPx, left: 0, right: 0, display: 'flex', alignItems: 'flex-start', zIndex: m.isNewDay ? 5 : 1 }}>
                {m.isNewDay ? (
                  /* 자정 — 날짜 레이블 강조 */
                  <div style={{
                    width: LABEL_WIDTH, flexShrink: 0,
                    fontSize: 10, fontWeight: 800,
                    color: '#1e3a8a',
                    fontFamily: "'DM Sans', sans-serif",
                    paddingRight: 4, textAlign: 'right',
                    lineHeight: 1, transform: 'translateY(-6px)',
                    whiteSpace: 'nowrap',
                    letterSpacing: -0.3,
                  }}>
                    {m.label}
                  </div>
                ) : (
                  <div style={{
                    width: LABEL_WIDTH, flexShrink: 0,
                    fontSize: 9,
                    color: m.isMajor ? '#475569' : m.isMid ? '#94a3b8' : '#b0bec5',
                    fontFamily: "'DM Mono', monospace",
                    fontWeight: m.isMajor ? 700 : 400,
                    paddingRight: 6, textAlign: 'right',
                    lineHeight: 1, transform: 'translateY(-5px)',
                    whiteSpace: 'nowrap',
                  }}>
                    {m.label}
                  </div>
                )}
                <div style={{
                  width: TIMELINE_WIDTH,
                  borderTop: m.isNewDay
                    ? '2px solid rgba(30,58,138,0.45)'
                    : m.isMajor ? '1px solid rgba(100,116,139,0.18)'
                    : m.isMid   ? '1px solid rgba(100,116,139,0.10)'
                    :             '1px solid rgba(100,116,139,0.05)',
                }} />
              </div>
            ))}

            {/* 상태 바 컬럼 (메인 + 서브) */}
            <div style={{ position: 'absolute', left: LABEL_WIDTH, width: TIMELINE_WIDTH + SUB_BAR_W, top: 0, height: containerHeight }}>
              <div style={{ position: 'relative', height: '100%', borderRadius: 6, overflow: 'hidden', background: '#f0f4f8' }}>
                {recentSegs.map((seg, i) => (
                  <StateBar key={i} seg={seg} windowStart={windowStart} mainStatusRefs={mainStatusRefs} hourPx={hourPx} />
                ))}
              </div>
            </div>

            {/* 현재 시각 마커 — 선 */}
            <div style={{
              position: 'absolute', top: nowTopPx - 2, left: 0, right: 0,
              height: 2.5, background: '#1a202c', zIndex: 30, pointerEvents: 'none',
            }} />
            {/* 현재 시각 마커 — 왼쪽 점 */}
            <div style={{
              position: 'absolute', top: nowTopPx - 7, left: 0,
              width: 10, height: 10, borderRadius: '50%', background: '#1a202c',
              zIndex: 30, pointerEvents: 'none',
            }} />
            {/* 현재 시각 마커 — 레이블 */}
            <div style={{
              position: 'absolute', top: nowTopPx - 22, left: LABEL_WIDTH + 4,
              display: 'flex', alignItems: 'center', gap: 4,
              zIndex: 30, pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#1a202c', fontFamily: "'DM Mono', monospace" }}>지금</span>
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#fff', background: '#1a202c',
                padding: '2px 6px', borderRadius: 3,
                fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap',
              }}>
                {formatTime(now)}
              </span>
            </div>
          </div>
        </div>

        {/* 센서 패널 — 나머지 공간 전부 */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {property.sensors && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#718096', letterSpacing: 0.5, marginBottom: 2 }}>실시간 센서</div>
              {Object.entries(property.sensors).map(([key, val]) => (
                <LiveSensor key={key} sensorKey={key} baseVal={val} />
              ))}
            </>
          )}

          {/* 예약 정보 */}
          {property.reservation?.guestName && (
            <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700, marginBottom: 8 }}>현재 예약</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1a202c' }}>{property.reservation.guestName}</div>
              <div style={{ fontSize: 12, color: '#4a5568', marginTop: 2 }}>{property.reservation.platform}</div>
              {property.reservation.checkIn && (
                <div style={{ fontSize: 11, color: '#718096', marginTop: 6 }}>
                  체크인: {property.reservation.checkIn.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}{' '}
                  {formatTime(property.reservation.checkIn)}
                </div>
              )}
              {property.reservation.checkOut && (
                <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                  체크아웃: {property.reservation.checkOut.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}{' '}
                  {formatTime(property.reservation.checkOut)}
                </div>
              )}
            </div>
          )}

          {/* 청소 배정 현황 — Google Calendar 싱크 시만 표시 */}
          {(() => {
            const futureWithCleaning = (property.reservations || []).filter(
              r => r.checkIn > now && r.cleaningStatus
            );
            if (!futureWithCleaning.length) return null;
            const unassigned = futureWithCleaning.filter(r => r.cleaningStatus === 'UNASSIGNED').length;
            return (
              <div style={{ background: '#fff', border: `1.5px solid ${unassigned ? '#fbbf24' : '#d1fae5'}`, borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#718096', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>청소 배정 현황</span>
                  {unassigned > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#d97706', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6, padding: '1px 7px' }}>
                      미할당 {unassigned}건
                    </span>
                  )}
                </div>
                {futureWithCleaning.map((r, i) => (
                  <div
                    key={r.uid || i}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '7px 0',
                      borderBottom: i < futureWithCleaning.length - 1 ? '1px solid #f0f4f8' : 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: '#1a202c', fontWeight: 600 }}>
                        체크아웃 {r.checkOut.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                      </div>
                      <div style={{ fontSize: 10, color: '#a0aec0', marginTop: 1 }}>
                        {r.checkOut.toLocaleDateString('ko-KR', { weekday: 'short' })} {formatTime(r.checkOut)}
                      </div>
                    </div>
                    {r.cleaningStatus === 'ASSIGNED' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>✓ {r.cleanerName} 배정</span>
                        {r.cleaningAt && (
                          <span style={{ fontSize: 10, color: '#718096', fontFamily: "'DM Mono', monospace" }}>
                            {r.cleaningAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}–
                            {r.cleaningEnd?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '2px 8px' }}>
                        ⚠ 미할당
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
