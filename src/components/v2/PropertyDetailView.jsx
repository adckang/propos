import { useState, useEffect, useRef, useMemo } from 'react';
import { weatherMeta } from '../../infrastructure/weatherClient';
import { STATE_META, SEGMENT_COLORS, getWindowSegments } from '../../data/roomStateMockData';
import { useMobile } from '../../hooks/useMobile';

const PAST_HOURS    = 24;          // 현재 시각 이전 24h
const FUTURE_HOURS  = 48;          // 현재 시각 이후 48h
const WINDOW_HOURS  = PAST_HOURS + FUTURE_HOURS;  // 총 72h
const VISIBLE_HOURS = 20;          // 한 화면에 보여줄 시간 수 (1시간 칸 크기 기준)
const TIMELINE_WIDTH = 60;
const LABEL_WIDTH    = 46;
const SUB_BAR_W      = 28;         // 서브 상태 바 폭 (px)

const SENSOR_ICONS   = { temp: '🌡', humidity: '💧', noise: '🔊', power: '⚡', co2: '💨', energy: '🔋' };
const SENSOR_UNITS   = { temp: '°C', humidity: '%', noise: 'dB', power: 'W', co2: 'ppm', energy: 'kWh' };
const SENSOR_LABELS  = { temp: '온도', humidity: '습도', noise: '소음', power: '전력', co2: 'CO₂', energy: '오늘 전력' };
const SENSOR_WARN    = { temp: [27, 99], humidity: [70, 99], noise: [75, 99], power: [2000, 99999], co2: [1000, 9999] };

function isWarn(key, val) {
  const [lo] = SENSOR_WARN[key] || [Infinity];
  return val >= lo;
}

function formatSensorVal(key, val) {
  if (key === 'energy') return val.toFixed(3);
  if (key === 'temp')   return val.toFixed(1);
  return String(Math.round(val));
}

function hourLabelColor(m) {
  if (m.isMajor) return '#475569';
  if (m.isMid)   return '#94a3b8';
  return '#b0bec5';
}

function hourLineBorder(m) {
  if (m.isNewDay) return '2px solid rgba(30,58,138,0.45)';
  if (m.isMajor)  return '1px solid rgba(100,116,139,0.18)';
  if (m.isMid)    return '1px solid rgba(100,116,139,0.10)';
  return '1px solid rgba(100,116,139,0.05)';
}

const MONITOR_SUB_META = {
  GOOD_CONDITION:   { label: '정상',      color: '#059669', bg: '#f0fdf4', border: '#bbf7d0', icon: '✓' },
  ENERGY_WASTE:     { label: '에너지 낭비', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '⚡' },
  ISSUE_COMPLAINT:  { label: '민원 이슈',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '⚠' },
  ISSUE_AND_ENERGY: { label: '복합 이슈',  color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe', icon: '🚨' },
};

function MonitoringStatusCard({ monitorState, lastEvent, weather }) {
  if (!monitorState) return null;
  const sub  = monitorState.subStatus ?? 'GOOD_CONDITION';
  const meta = MONITOR_SUB_META[sub] ?? MONITOR_SUB_META.GOOD_CONDITION;

  const isGood      = sub === 'GOOD_CONDITION';
  const isEstimated = lastEvent?.reason?.startsWith('⚠');

  return (
    <div style={{ background: meta.bg, border: `1.5px solid ${meta.border}`, borderRadius: 10, padding: '12px 14px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isGood ? 0 : 8 }}>
        <span style={{ fontSize: 13 }}>{meta.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>감시 중 — {meta.label}</span>
        {isGood && (
          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>30초 주기</span>
        )}
      </div>

      {/* 감지 사유 */}
      {!isGood && lastEvent?.reason && (
        <div style={{
          fontSize: 11, color: '#374151', lineHeight: 1.65,
          borderTop: `1px solid ${meta.border}`, paddingTop: 8,
        }}>
          {lastEvent.reason}
        </div>
      )}

      {/* 추정 모드 설명 */}
      {isEstimated && (
        <div style={{
          marginTop: 8, background: 'rgba(0,0,0,0.04)', borderRadius: 6,
          padding: '7px 10px', fontSize: 10, color: '#6b7280', lineHeight: 1.65,
        }}>
          <div style={{ fontWeight: 700, color: '#78716c', marginBottom: 3 }}>📊 추정 근거</div>
          <div>전력 센서 미설치 → 지역 기상 데이터(Open-Meteo)로 대체</div>
          {weather && (
            <div style={{ marginTop: 2 }}>
              실외 기온 {weather.temp.toFixed(1)}°C · 습도 {weather.humidity}%
              {lastEvent.snap?.indoorTemps?.length > 0 && (
                <span> · 실내 평균 {(lastEvent.snap.indoorTemps.reduce((s, r) => s + r.val, 0) / lastEvent.snap.indoorTemps.length).toFixed(1)}°C</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CLEANING_CHECKLIST = [
  { id: 'bedding',   label: '침구 교체 / 정리' },
  { id: 'bathroom',  label: '욕실 청소 (변기·세면대·욕조)' },
  { id: 'kitchen',   label: '주방 청소 (설거지·가스레인지)' },
  { id: 'floor',     label: '바닥 청소 (청소기·걸레)' },
  { id: 'trash',     label: '쓰레기 수거 및 분리배출' },
  { id: 'amenities', label: '어메니티 보충 (샴푸·수건·TP)' },
  { id: 'ac',        label: '에어컨 필터 확인' },
  { id: 'inspect',   label: '파손·분실 최종 점검' },
];

const CHECKED_INIT = Object.fromEntries(CLEANING_CHECKLIST.map(i => [i.id, false]));

function CleaningCard({ monitorState, onCleaningStarted, onCleaningFinished }) {
  const [checked, setChecked] = useState(CHECKED_INIT);

  const sub = monitorState?.subStatus;
  const isPending    = sub === 'CLEANING_PENDING';
  const isInProgress = sub === 'CLEANING_IN_PROGRESS';
  if (!isPending && !isInProgress) return null;

  const doneCount = CLEANING_CHECKLIST.filter(i => checked[i.id]).length;
  const allDone   = doneCount === CLEANING_CHECKLIST.length;

  function toggle(id) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 10, padding: '14px 16px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>🧹</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
            {isPending ? '청소 대기 중' : `청소 진행 중 (${doneCount}/${CLEANING_CHECKLIST.length})`}
          </div>
          <div style={{ fontSize: 10, color: '#4ade80', marginTop: 1 }}>
            {isPending ? '퇴실 확인됨 — 청소를 시작해주세요' : '항목 완료 후 청소 완료 버튼을 누르세요'}
          </div>
        </div>
      </div>

      {/* CLEANING_IN_PROGRESS: 체크리스트 */}
      {isInProgress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {CLEANING_CHECKLIST.map(item => (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: checked[item.id] ? '#dcfce7' : '#fff',
                border: `1.5px solid ${checked[item.id] ? '#86efac' : '#e2e8f0'}`,
                borderRadius: 8, padding: '9px 12px',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                background: checked[item.id] ? '#16a34a' : '#fff',
                border: `2px solid ${checked[item.id] ? '#16a34a' : '#cbd5e1'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {checked[item.id] && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5l2.5 2.5L8.5 2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 12, color: checked[item.id] ? '#15803d' : '#374151', fontWeight: checked[item.id] ? 600 : 400 }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 액션 버튼 */}
      {isPending && (
        <button
          onClick={onCleaningStarted}
          style={{
            width: '100%', padding: '10px 0',
            background: '#16a34a', border: '1.5px solid #15803d', borderRadius: 8,
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          청소 시작
        </button>
      )}
      {isInProgress && (
        <button
          onClick={onCleaningFinished}
          disabled={!allDone}
          style={{
            width: '100%', padding: '10px 0',
            background: allDone ? '#16a34a' : '#f1f5f9',
            border: `1.5px solid ${allDone ? '#15803d' : '#e2e8f0'}`,
            borderRadius: 8,
            color: allDone ? '#fff' : '#94a3b8',
            fontSize: 13, fontWeight: 700,
            cursor: allDone ? 'pointer' : 'default',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          {allDone ? '청소 완료 ✓' : `청소 완료 (${doneCount}/${CLEANING_CHECKLIST.length} 항목 완료)`}
        </button>
      )}
    </div>
  );
}

function VacantCard({ monitorState, nextReservation, onMaintenanceStarted, onMaintenanceFinished }) {
  const isMaintenance = monitorState?.subStatus === 'MAINTENANCE';
  return (
    <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>{isMaintenance ? '🔧' : '🏠'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>
            {isMaintenance ? '정비 중' : '공실 — 예약 대기 중'}
          </div>
          {!isMaintenance && nextReservation?.checkIn && (
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
              다음 체크인 {nextReservation.checkIn.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} {formatTime(nextReservation.checkIn)}
            </div>
          )}
        </div>
      </div>
      {isMaintenance ? (
        <button
          onClick={onMaintenanceFinished}
          style={{ width: '100%', padding: '9px 0', background: '#059669', border: '1.5px solid #047857', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          정비 완료
        </button>
      ) : (
        <button
          onClick={onMaintenanceStarted}
          style={{ width: '100%', padding: '9px 0', background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8, color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          정비 시작
        </button>
      )}
    </div>
  );
}

function PreStayCard({ monitorState }) {
  const isOptimizing = monitorState?.subStatus === 'OPTIMIZING';
  return (
    <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{isOptimizing ? '⚙️' : '✅'}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
            {isOptimizing ? '입실 준비 중...' : '입실 준비 완료'}
          </div>
          <div style={{ fontSize: 10, color: '#60a5fa', marginTop: 1 }}>
            {isOptimizing ? 'HA 씬 실행 중 — 조명·에어컨 설정' : '게스트 입실 대기'}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeatherCard({ weather }) {
  const meta = weatherMeta(weather.weatherCode);
  return (
    <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700, marginBottom: 6 }}>
        {meta.emoji} {weather.locationName} 현재 날씨 · {meta.desc}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#1a202c', fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
            {weather.temp.toFixed(1)}
          </span>
          <span style={{ fontSize: 14, color: '#718096' }}>°C</span>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b', lineHeight: 1.7 }}>
          <div>체감 {weather.feelsLike.toFixed(1)}°C</div>
          <div>습도 {weather.humidity}%</div>
        </div>
      </div>
    </div>
  );
}

function deviceStateLabel(device) {
  if (device.isUnavailable) return '연결 안됨';
  if (device.deviceClass === 'door') return device.isOn ? '열림' : '닫힘';
  if (device.deviceClass === 'motion') return device.isOn ? '감지됨' : '없음';
  return device.isOn ? '켜짐' : '꺼짐';
}

function DeviceCard({ device }) {
  const label = deviceStateLabel(device);
  let color, bg, border;
  if (device.isUnavailable) {
    color = '#94a3b8'; bg = '#f9fafb'; border = '#e2e8f0';
  } else if (device.isOn) {
    color = '#059669'; bg = '#f0fdf4'; border = '#86efac';
  } else {
    color = '#6b7280'; bg = '#f8fafc'; border = '#e2e8f0';
  }
  return (
    <div style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{device.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#4a5568', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.label}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color }}>{label}</div>
      </div>
    </div>
  );
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

function StateBar({ seg, windowStart, mainStatusRefs, hourPx, suppressLabel, subBarW = SUB_BAR_W }) {
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
        {heightPx > 22 && !suppressLabel && (
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
          width: subBarW,
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
          width: subBarW, flexShrink: 0,
          background: 'rgba(255,255,255,0.12)',
          borderLeft: '1px solid rgba(255,255,255,0.2)',
        }} />
      )}
    </div>
  );
}

function LiveSensor({ sensorKey, baseVal, label }) {
  const [val, setVal] = useState(baseVal);
  useEffect(() => {
    const ranges = { temp: 0.3, humidity: 2, noise: 5, power: 80, co2: 30, energy: 0 };
    const range = ranges[sensorKey] ?? 1;
    const jitter = (sensorKey.length * 137) % 1500; // 센서마다 다른 위상, Math.random 불필요
    const timer = setInterval(() => {
      setVal(v => v + (((Date.now() % 1000) / 1000) - 0.5) * range * 0.4);
    }, 2500 + jitter);
    return () => clearInterval(timer);
  }, [sensorKey, baseVal]);

  const warn = isWarn(sensorKey, val);
  const display = formatSensorVal(sensorKey, val);
  const sensorLabel = label ? `${SENSOR_LABELS[sensorKey]} (${label})` : SENSOR_LABELS[sensorKey];

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
        <span style={{ fontSize: 12, color: '#718096' }}>{SENSOR_ICONS[sensorKey]} {sensorLabel}</span>
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

export default function PropertyDetailView({ property, weather, onBack, onCleaningStarted, onCleaningFinished, onMaintenanceStarted, onMaintenanceFinished }) {
  const isMobile = useMobile();
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

  // CLEANING 세그먼트 → 청소 슬롯 직접 매핑 (시간 겹침 기준)
  // reservation.cleaningStatus 경유 시 현재 입실중 예약의 체크아웃 후 청소가 누락됨
  const cleaningInfoMap = useMemo(() => {
    const map = new Map();
    const slots = property.cleaningSlots || [];
    if (!slots.length) return map;
    for (const seg of recentSegs) {
      if (seg.mainStatus !== 'CLEANING' || !seg.isFuture) continue;
      const slot = slots.find(s => s.start < seg.end && s.end > seg.start);
      if (slot) {
        map.set(seg, { cleaningStatus: 'ASSIGNED', cleanerName: slot.cleanerName, cleaningAt: slot.start, cleaningEnd: slot.end });
      } else {
        map.set(seg, { cleaningStatus: 'UNASSIGNED' });
      }
    }
    return map;
  }, [recentSegs, property.cleaningSlots]);

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

  // 모바일 전용 추가 데이터 (isMobile && ... 블록에서 사용)
  const sensorRows = property.sensorReadings ??
    (property.sensors ? Object.entries(property.sensors).map(([key, val]) => ({ key, val, label: '' })) : []);
  const anomalies = sensorRows.filter(r => isWarn(r.key, r.val));
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const tomorrowMid = new Date(todayMid.getTime() + 86400000);
  const todaySegs = recentSegs.filter(s => s.start < tomorrowMid && s.end > todayMid);

  // 반응형 상수 — JSX 구조는 동일
  const LABEL_W    = isMobile ? 32 : LABEL_WIDTH;
  const TIMELINE_W = isMobile ? 40 : TIMELINE_WIDTH;
  const SUB_W      = isMobile ? 18 : SUB_BAR_W;
  const tlPad      = isMobile ? '8px 4px 40px 8px' : '16px 8px 40px 16px';
  const detailPad  = isMobile ? '10px 12px' : '16px';

  // ── 단일 JSX 트리 — isMobile로 크기/간격만 조정 ───────────────────────────────
  return (
    <div style={{ background: '#f0f4f8', height: '100%', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: isMobile ? '10px 16px' : '14px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: isMobile ? '5px 10px' : '6px 12px', fontSize: isMobile ? 12 : 13, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            ← 목록
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{property.name}</div>
            <div style={{ fontSize: isMobile ? 10 : 12, color: '#a0aec0' }}>{property.district} · {property.id}</div>
          </div>
          <div style={{
            background: currentMeta.bg, border: `1.5px solid ${currentMeta.border}`,
            borderRadius: isMobile ? 8 : 10, padding: isMobile ? '5px 10px' : '8px 14px', textAlign: 'center', flexShrink: 0,
          }}>
            <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 700, color: currentMeta.color }}>{currentMeta.label}</div>
            <div style={{ fontSize: isMobile ? 9 : 11, color: currentMeta.color, opacity: 0.9 }}>{currentSubLabel}</div>
          </div>
        </div>

        {/* 상태 필터 탭 — 모바일: 시각 인디케이터만 (클릭 없음), PC: 탭 클릭 → 해당 구간 이동 */}
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8, overflowX: isMobile ? 'hidden' : 'auto', flexWrap: 'nowrap' }}>
          {Object.entries(STATE_META).map(([key, meta]) => {
            const active = presentMainStatuses.has(key);
            return (
              <button
                key={key}
                onClick={() => !isMobile && active && scrollToState(key)}
                disabled={!active}
                style={{
                  flexShrink: 0,
                  border: `1.5px solid ${active ? meta.color : '#e2e8f0'}`,
                  borderRadius: 20,
                  padding: isMobile ? '3px 9px' : '4px 13px',
                  background: active ? meta.bg : '#f9fafb',
                  color: active ? meta.color : '#c8d5e0',
                  fontSize: isMobile ? 11 : 12, fontWeight: 600,
                  cursor: (!isMobile && active) ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {meta.label}
              </button>
            );
          })}
          {!isMobile && (
            <span style={{ fontSize: 11, color: '#a0aec0', alignSelf: 'center', marginLeft: 4, flexShrink: 0 }}>
              탭 클릭 → 해당 구간
            </span>
          )}
        </div>
      </div>

      {/* 이상 감지 배너 — 모바일만 표시 */}
      {isMobile && anomalies.length > 0 && (
        <div style={{ background: '#fef2f2', borderBottom: '1.5px solid #fca5a5', padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>⚠ 이상 감지</span>
          {anomalies.map(r => (
            <span key={r.key} style={{ fontSize: 11, background: '#fff', border: '1px solid #fca5a5', borderRadius: 12, padding: '2px 8px', color: '#dc2626' }}>
              {SENSOR_ICONS[r.key]} {SENSOR_LABELS[r.key]} {formatSensorVal(r.key, r.val)}{SENSOR_UNITS[r.key]}
            </span>
          ))}
        </div>
      )}

      {/* 본문: 타임라인(좁게) + 센서 패널(넓게) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* 세로 타임라인 — 반응형 폭 */}
        <div
          ref={timelineRef}
          style={{
            width: LABEL_W + TIMELINE_W + SUB_W + (isMobile ? 20 : 24),
            flexShrink: 0,
            overflowY: 'auto',
            padding: tlPad,
          }}
        >
          <div style={{ position: 'relative', height: containerHeight }}>
            {/* 시간 축 */}
            {hourMarkers.map((m) => (
              <div key={m.topPx} style={{ position: 'absolute', top: m.topPx, left: 0, right: 0, display: 'flex', alignItems: 'flex-start', zIndex: m.isNewDay ? 5 : 1 }}>
                {m.isNewDay ? (
                  /* 자정 — 날짜 레이블 강조 */
                  <div style={{
                    width: LABEL_W, flexShrink: 0,
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
                    width: LABEL_W, flexShrink: 0,
                    fontSize: 9,
                    color: hourLabelColor(m),
                    fontFamily: "'DM Mono', monospace",
                    fontWeight: m.isMajor ? 700 : 400,
                    paddingRight: 6, textAlign: 'right',
                    lineHeight: 1, transform: 'translateY(-5px)',
                    whiteSpace: 'nowrap',
                  }}>
                    {m.label}
                  </div>
                )}
                <div style={{ width: TIMELINE_W, borderTop: hourLineBorder(m) }} />
              </div>
            ))}

            {/* 상태 바 컬럼 (메인 + 서브) */}
            <div style={{ position: 'absolute', left: LABEL_W, width: TIMELINE_W + SUB_W, top: 0, height: containerHeight }}>
              <div style={{ position: 'relative', height: '100%', borderRadius: 6, overflow: 'hidden', background: '#f0f4f8' }}>
                {recentSegs.map((seg) => (
                  <StateBar
                    key={`${seg.mainStatus}-${seg.start.getTime()}`}
                    seg={seg}
                    windowStart={windowStart}
                    mainStatusRefs={mainStatusRefs}
                    hourPx={hourPx}
                    suppressLabel={cleaningInfoMap.has(seg)}
                    subBarW={SUB_W}
                  />
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
              position: 'absolute', top: nowTopPx - 22, left: LABEL_W + 4,
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

            {/* 청소 배정 인디케이터 — CLEANING 세그먼트 위 오버레이 */}
            {recentSegs.map((seg, i) => {
              if (seg.mainStatus !== 'CLEANING') return null;
              const res = cleaningInfoMap.get(seg);
              if (!res) return null;

              const segEnd = seg.end ?? new Date(seg.start.getTime() + 3 * 3600000);
              const anchorTime = res.cleaningAt ?? new Date((seg.start.getTime() + segEnd.getTime()) / 2);
              const topPx = ((anchorTime.getTime() - windowStart.getTime()) / 3600000) * hourPx;
              const isAssigned = res.cleaningStatus === 'ASSIGNED';

              return (
                <div
                  key={`ci-${seg.start.getTime()}`}
                  style={{
                    position: 'absolute',
                    top: topPx - 12,
                    left: LABEL_W + (TIMELINE_W - 22) / 2,
                    zIndex: 35,
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {/* 동그라미 */}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: isAssigned ? '#059669' : '#fff',
                    border: `2.5px solid ${isAssigned ? '#059669' : '#94a3b8'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
                    flexShrink: 0,
                  }}>
                    {isAssigned && (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M2 5.5l2.5 2.5L9 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  {/* 담당자 이름 또는 미배정 */}
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: isAssigned ? '#059669' : '#64748b',
                    background: 'rgba(255,255,255,0.95)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    border: `1px solid ${isAssigned ? '#d1fae5' : '#e2e8f0'}`,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}>
                    {isAssigned ? res.cleanerName : '미배정'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 센서 패널 — 나머지 공간 전부 */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: detailPad, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* 오늘의 상태 흐름 — 모바일만 표시 */}
          {isMobile && todaySegs.length > 0 && (
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>오늘의 상태 흐름</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {todaySegs.map((seg, i) => {
                  const meta = STATE_META[seg.mainStatus];
                  const subLabel = meta?.subStates[seg.subStatus]?.label || seg.subStatus;
                  const displayStart = seg.start < todayMid ? '자정 이전' : formatTime(seg.start);
                  const displayEnd = seg.end > tomorrowMid ? '자정 이후' : (seg.isFuture ? `예정 ${formatTime(seg.end)}` : formatTime(seg.end));
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta?.color || '#94a3b8', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: meta?.color || '#374151' }}>{meta?.label || seg.mainStatus}</span>
                        <span style={{ fontSize: 10, color: '#718096', marginLeft: 5 }}>{subLabel}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                        {displayStart} → {displayEnd}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {property.monitorState?.mainStatus === 'VACANT' && (
            <VacantCard
              monitorState={property.monitorState}
              nextReservation={property.nextReservation}
              onMaintenanceStarted={onMaintenanceStarted}
              onMaintenanceFinished={onMaintenanceFinished}
            />
          )}
          {property.monitorState?.mainStatus === 'PRE_STAY_READY' && (
            <PreStayCard monitorState={property.monitorState} />
          )}
          {property.monitorState?.mainStatus === 'CLEANING' && (
            <CleaningCard
              monitorState={property.monitorState}
              onCleaningStarted={onCleaningStarted}
              onCleaningFinished={onCleaningFinished}
            />
          )}
          {property.monitorState?.mainStatus === 'OCCUPIED' && (
            <MonitoringStatusCard
              monitorState={property.monitorState}
              lastEvent={property.lastMonitorEvent}
              weather={weather}
            />
          )}
          {weather && <WeatherCard weather={weather} />}

          {sensorRows.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#718096', letterSpacing: 0.5, marginBottom: 2 }}>실시간 센서</div>
              {sensorRows.map((r, i) => (
                <LiveSensor key={`${r.key}-${i}`} sensorKey={r.key} baseVal={r.val} label={r.label} />
              ))}
            </>
          )}

          {/* 기기 상태 */}
          {property.haDevices?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#718096', letterSpacing: 0.5, marginBottom: 8 }}>기기 상태</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {property.haDevices.map(device => (
                  <DeviceCard key={device.entityId} device={device} />
                ))}
              </div>
            </div>
          )}

          {/* CCTV 출입 스냅샷 */}
          {property.snapshotLog?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#718096', letterSpacing: 0.5, marginBottom: 8 }}>출입 기록 (CCTV)</div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {[...property.snapshotLog].reverse().map((snap) => {
                  const d = new Date(snap.ts);
                  const label = d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  const thumbW = isMobile ? 110 : 140;
                  const thumbH = isMobile ? 70 : 88;
                  return (
                    <div key={snap.ts} style={{ flexShrink: 0, width: thumbW }}>
                      <img
                        src={`/api/camera/snapshot?path=${encodeURIComponent(snap.path)}`}
                        alt={label}
                        style={{ width: '100%', height: thumbH, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0', display: 'block' }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                      />
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3, textAlign: 'center' }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
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

        </div>
      </div>
    </div>
  );
}
