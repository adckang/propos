import { useState, useEffect, useCallback, useRef } from 'react';
import DashboardView from './DashboardView';
import PropertyListView from './PropertyListView';
import PropertyDetailView from './PropertyDetailView';
import CleaningManager from './CleaningManager';
import { PROPERTIES } from '../../data/roomStateMockData';
import { syncAirbnbReservations, syncGoogleCalendarSlots, buildLiveProperty, deriveCurrentState } from '../../application/calendarSyncService';
import { getAreaData, callService } from '../../infrastructure/haBrowserClient';
import { getWeatherByDistrict } from '../../infrastructure/weatherClient';
import { OccupancyMonitor } from '../../application/occupancyMonitor';
import { getNextRoomState, isValidTransition, INITIAL_STATE } from '../../domain/room-state/roomStateDomain';
import { DEVICE_ROLE } from '../../domain/device-control/deviceRoles';
import Toast from '../../utils/toast';

// 기기 역할 한국어 레이블
const DEVICE_ROLE_LABELS = {
  AC_MAIN:         '냉난방기',
  LIGHT_LIVING:    '거실 조명',
  LIGHT_BEDROOM:   '침실 조명',
  LIGHT_BATHROOM:  '욕실 조명',
  LIGHT_ENTRANCE:  '현관 조명',
  PLUG_TV:         'TV 플러그',
  PLUG_WASHER:     '세탁기 플러그',
  FAN_VENTILATION: '환기팬',
  LOCK_ENTRANCE:   '현관 도어락',
};

// UI(쉼표 구분 문자열) → API 전송 형태(string | string[] | null)
function parseDeviceMap(uiDevices = {}) {
  const result = {};
  for (const role of Object.values(DEVICE_ROLE)) {
    const raw = (uiDevices[role] ?? '').trim();
    if (!raw) { result[role] = null; continue; }
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    result[role] = ids.length === 1 ? ids[0] : ids;
  }
  return result;
}

// 저장된 매핑 → UI 표시용 쉼표 문자열
function formatDeviceMap(devices = {}) {
  const result = {};
  for (const role of Object.values(DEVICE_ROLE)) {
    const val = devices[role];
    result[role] = Array.isArray(val) ? val.join(', ') : (val ?? '');
  }
  return result;
}

const LS_KEY = 'propos_calendar_sync';
const LS_PAST_RES_KEY = 'propos_past_reservations';

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
  catch { return null; }
}
function saveConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

// 과거 예약 캐시 — iCal 피드에서 사라진 past reservation 보존
function loadPastReservations() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PAST_RES_KEY) || '[]');
    return raw.map(r => ({ ...r, checkIn: new Date(r.checkIn), checkOut: new Date(r.checkOut) }));
  } catch { return []; }
}
function savePastReservations(reservations) {
  const now = new Date();
  // 과거 예약 + 현재 체류 중인 예약(나중에 과거가 될 수 있음)을 캐시에 보존.
  // 오프라인 중 체크아웃이 발생하면 피드에서 사라지기 전에 캐시가 없으면 유실되므로
  // active 예약도 함께 저장해둔다.
  const toSave = reservations.filter(r =>
    r.checkOut <= now ||                          // 완료된 과거 예약
    (r.checkIn <= now && r.checkOut > now)        // 현재 체류 중 (안전망)
  );
  localStorage.setItem(LS_PAST_RES_KEY, JSON.stringify(toSave));
}
function mergePastReservations(freshFromFeed, now = new Date()) {
  const cached = loadPastReservations();
  const freshMap = new Map(freshFromFeed.map(r => [r.uid, r]));
  // 캐시에 있는 과거/active 예약 중 피드에 없는 것만 보존 (피드 우선).
  // 취소된 미래 예약은 캐시에 존재할 수 없음 — savePastReservations가
  // checkOut <= now 또는 active 만 저장하기 때문에 미래 예약은 캐시 제외.
  // 따라서 "취소된 미래 예약이 캐시에 남는" 버그는 발생하지 않음.
  const onlyInCache = cached.filter(r => !freshMap.has(r.uid));
  const merged = [...onlyInCache, ...freshFromFeed].sort((a, b) => a.checkIn - b.checkIn);
  savePastReservations(merged);
  return merged;
}

// Pi 파일에서 숙소 목록 로드 (PROPOS_WATCHER_URL → /api/properties)
async function fetchProperties() {
  try {
    const res = await fetch('/api/properties');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Pi 파일에 숙소 목록 저장
async function putProperties(list) {
  try {
    await fetch('/api/properties', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list),
    });
  } catch { /* Pi 미연결 시 무시 — localStorage 캐시 유지 */ }
}

// ── 설정 모달 ─────────────────────────────────────────────────────────────────
function SettingsModal({ config, onSave, onClose }) {
  const initial = config ?? {
    name: '내 숙소',
    district: '',
    watcherId: 'watcher1',
    airbnbIcalUrl: '',
    googleCalIcalUrl: '',
    checkInHour: 15,
    checkOutHour: 11,
    cleaningDurationHours: 2.5,
    devices: {},
  };
  const [form, setForm] = useState({
    ...initial,
    _uiDevices: formatDeviceMap(initial.devices),
  });
  const [loadingServer, setLoadingServer] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setDevice = (role, val) =>
    setForm(f => ({ ...f, _uiDevices: { ...f._uiDevices, [role]: val } }));

  async function handleLoadServer() {
    setLoadingServer(true);
    const list = await fetchProperties();
    setLoadingServer(false);
    const saved = list[0];
    if (!saved) {
      Toast.show('Pi에 저장된 숙소 설정이 없습니다.', 'w');
      return;
    }
    setForm(f => ({ ...f, ...saved, _uiDevices: formatDeviceMap(saved.devices ?? {}) }));
    Toast.show('Pi에서 설정을 불러왔습니다. 저장을 눌러 적용하세요.', 's');
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 420, maxWidth: '95vw',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a202c', marginBottom: 20 }}>
          캘린더 연동 설정
        </div>

        {[
          { label: '숙소 이름', key: 'name', type: 'text', placeholder: '파주 게스트하우스' },
          { label: '지역 (선택)', key: 'district', type: 'text', placeholder: '파주 (시·군·구 제외)' },
          { label: 'Pi 워처 ID', key: 'watcherId', type: 'text', placeholder: 'watcher1' },
          { label: 'Airbnb iCal URL', key: 'airbnbIcalUrl', type: 'url', placeholder: 'https://www.airbnb.com/calendar/ical/...' },
          { label: 'Google 캘린더 iCal URL (선택)', key: 'googleCalIcalUrl', type: 'url', placeholder: 'https://calendar.google.com/calendar/ical/...' },
        ].map(({ label, key, type, placeholder }) => (
          <div key={key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', marginBottom: 5 }}>{label}</div>
            <input
              type={type}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
                fontSize: 13, fontFamily: "'DM Mono', monospace", color: '#1a202c',
                outline: 'none',
              }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          {[
            { label: '체크인 시각', key: 'checkInHour', suffix: '시' },
            { label: '체크아웃 시각', key: 'checkOutHour', suffix: '시' },
            { label: '청소 시간(h)', key: 'cleaningDurationHours', suffix: 'h' },
          ].map(({ label, key, suffix }) => (
            <div key={key} style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#4a5568', marginBottom: 5 }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={form[key]}
                  onChange={e => set(key, parseFloat(e.target.value))}
                  style={{
                    width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8,
                    padding: '8px 10px', fontSize: 13, fontFamily: "'DM Mono', monospace",
                    color: '#1a202c', outline: 'none',
                  }}
                />
                <span style={{ fontSize: 12, color: '#718096' }}>{suffix}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#f0f4f8', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#4a5568', marginBottom: 12, lineHeight: 1.6 }}>
          Airbnb 관리자 → 캘린더 → 내보내기 → iCal URL 복사<br/>
          Google 캘린더 → 설정 → 통합 → iCal 형식 공개 주소
        </div>

        {/* 기기 매핑 섹션 */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowDevices(v => !v)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 14px',
            background: showDevices ? '#f0f4f8' : '#fff', fontSize: 13, fontWeight: 600,
            color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span>⚡ HA 기기 매핑 (상태 변경 시 자동 제어)</span>
            <span style={{ fontSize: 11 }}>{showDevices ? '▲' : '▼'}</span>
          </button>

          {showDevices && (
            <div style={{
              border: '1.5px solid #e2e8f0', borderTop: 'none',
              borderRadius: '0 0 10px 10px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 10, lineHeight: 1.6 }}>
                HA entity_id를 입력하세요. 복수 기기는 쉼표로 구분.<br/>
                예: <span style={{ fontFamily: "'DM Mono', monospace" }}>light.ceiling, light.floor_lamp</span>
              </div>
              {Object.values(DEVICE_ROLE).map(role => (
                <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 80, fontSize: 12, color: '#4a5568', fontWeight: 600, flexShrink: 0,
                  }}>
                    {DEVICE_ROLE_LABELS[role]}
                  </div>
                  <input
                    type="text"
                    value={form._uiDevices[role] ?? ''}
                    onChange={e => setDevice(role, e.target.value)}
                    placeholder={`entity_id (예: ${role.toLowerCase().replace('_', '.')})`}
                    style={{
                      flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 7,
                      padding: '6px 10px', fontSize: 12, fontFamily: "'DM Mono', monospace",
                      color: '#1a202c', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleLoadServer} disabled={loadingServer} style={{
          width: '100%', border: '1.5px solid #7c3aed', borderRadius: 10, padding: '9px 0',
          background: '#f5f0ff', fontSize: 13, fontWeight: 600, color: '#7c3aed',
          cursor: loadingServer ? 'wait' : 'pointer', fontFamily: 'inherit', marginBottom: 16,
        }}>
          {loadingServer ? '불러오는 중...' : '☁ 서버 기본값 불러오기 (Vercel 환경변수)'}
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 0',
            background: '#fff', fontSize: 14, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
          }}>취소</button>
          <button onClick={() => {
            const { _uiDevices, ...rest } = form;
            onSave({ ...rest, devices: parseDeviceMap(_uiDevices) });
          }} style={{
            flex: 2, border: '2px solid #2563eb', borderRadius: 10, padding: '10px 0',
            background: '#2563eb', fontSize: 14, fontWeight: 700, color: '#fff',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>저장 및 동기화</button>
        </div>
      </div>
    </div>
  );
}

// ── 싱크 상태 뱃지 ─────────────────────────────────────────────────────────────
function SyncBadge({ status, lastSynced, onSync, onSettings, onCleaning }) {
  const fmtWithDate = d => {
    if (!d) return '';
    const h = d.getHours(), m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getMonth()+1}/${d.getDate()} ${h < 12 ? 'AM' : 'PM'} ${(h%12||12).toString().padStart(2,'0')}:${m}`;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {status === 'syncing' && (
        <div style={{ fontSize: 12, color: '#2563eb', fontFamily: "'DM Mono', monospace" }}>⟳ 동기화중...</div>
      )}
      {status === 'ok' && lastSynced && (
        <div style={{ fontSize: 12, color: '#059669', fontFamily: "'DM Mono', monospace" }}>
          ● LIVE {fmtWithDate(lastSynced)}
        </div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 12, color: '#dc2626', fontFamily: "'DM Mono', monospace" }}>⚠ 싱크 실패</div>
      )}
      <button onClick={onSync} title="지금 동기화" style={{
        border: '1.5px solid #e2e8f0', borderRadius: 7, background: '#fff',
        padding: '4px 10px', fontSize: 12, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
      }}>↺</button>
      <button onClick={onSettings} title="캘린더 설정" style={{
        border: '1.5px solid #e2e8f0', borderRadius: 7, background: '#fff',
        padding: '4px 10px', fontSize: 12, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
      }}>⚙</button>
      <button onClick={onCleaning} title="청소 관리" style={{
        border: '1.5px solid #e2e8f0', borderRadius: 7, background: '#fff',
        padding: '4px 10px', fontSize: 12, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
      }}>청소</button>
    </div>
  );
}

function buildReservation(property) {
  const r = property.reservation;
  if (!r) return null;
  const hour = String(property.checkOutHour ?? 11).padStart(2, '0');
  return { checkOut: new Date(`${r.checkOutDate}T${hour}:00`) };
}

// ── 서버 모니터링 API ─────────────────────────────────────────────────────────
async function postMonitoringConfig(cfg, watcherId = null) {
  const qs = watcherId ? `?watcherId=${encodeURIComponent(watcherId)}` : '';
  try {
    await fetch(`/api/monitoring/config${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  } catch { /* 서버 미연결 시 무시 */ }
}

// isValidTransition 통과 시 next state, 아니면 null
function tryCalEvent(monitorState, event) {
  return isValidTransition(monitorState, event) ? getNextRoomState(monitorState, event) : null;
}

/**
 * 캘린더 상태(calMain/calSub)와 현재 monitorState를 비교해
 * 다음 monitorState를 반환. 변경 불필요 시 null.
 */
function deriveNextMonitorState(calMain, calSub, monitorState) {
  const { mainStatus: monMain, subStatus: monSub } = monitorState;

  if (calMain === 'PRE_STAY_READY' && monMain === 'VACANT')
    return tryCalEvent(monitorState, 'checkin_prep_time_reached');

  const optimizationDone = calSub === 'OPTIMIZED' && monMain === 'PRE_STAY_READY' && monSub === 'OPTIMIZING';
  if (calMain === 'PRE_STAY_READY' && optimizationDone)
    return tryCalEvent(monitorState, 'optimization_finished');

  if (calMain === 'OCCUPIED' && monMain === 'PRE_STAY_READY')
    return tryCalEvent(monitorState, 'check_in_detected');

  if (calMain === 'OCCUPIED' && monMain !== 'OCCUPIED')
    return { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' };

  if (calMain === 'VACANT' && monMain === 'OCCUPIED')
    return INITIAL_STATE;

  // iCal이 VACANT로 돌아왔는데 monitorState가 PRE_STAY_READY인 경우
  // reservation_cancelled는 VACANT 기간에만 유효 → 비즈니스 레이어에서 INITIAL_STATE 직접 복귀
  if (calMain === 'VACANT' && monMain === 'PRE_STAY_READY')
    return INITIAL_STATE;

  return null;
}

async function fetchMonitoringState(watcherId = null) {
  const qs = watcherId ? `?watcherId=${encodeURIComponent(watcherId)}` : '';
  const res = await fetch(`/api/monitoring/state${qs}`);
  if (!res.ok) return null;
  return res.json();
}

async function putMonitoringRoomState(roomState, watcherId = null) {
  const qs = watcherId ? `?watcherId=${encodeURIComponent(watcherId)}` : '';
  try {
    await fetch(`/api/monitoring/state${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomState }),
    });
  } catch { /* 서버 미연결 시 무시 */ }
}

// ── 메인 앱 ────────────────────────────────────────────────────────────────────
export default function RoomStateApp({ onBack }) {
  const [view, setView]                   = useState('dashboard');
  const [listFilter, setListFilter]       = useState(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [showSettings, setShowSettings]   = useState(false);
  const [syncConfig, setSyncConfig]       = useState(() => loadConfig());
  const [liveProperty, setLiveProperty]     = useState(null);
  const [liveSensorReadings, setLiveSensorReadings] = useState(null);
  const [liveDevices, setLiveDevices]       = useState([]);
  const [liveWeather, setLiveWeather]       = useState(null);
  const [syncStatus, setSyncStatus]       = useState('idle');   // idle | syncing | ok | error
  const [lastSynced, setLastSynced]       = useState(null);

  // 모니터링 상태 — 서버(Pi watcher)에서 폴링, fallback으로 브라우저 로컬 실행
  const [monitorState, setMonitorState]         = useState(INITIAL_STATE);
  const [snapshotLog, setSnapshotLog]           = useState([]);
  const [serverWatcherActive, setServerWatcherActive] = useState(false);
  const [lastMonitorEvent, setLastMonitorEvent] = useState(null);
  const localMonitorRef = useRef(new OccupancyMonitor());
  // 날씨를 HA 폴링 클로저 안에서 읽기 위한 ref (stale closure 방지)
  const liveWeatherRef = useRef(null);

  // 싱크 실행
  const runSync = useCallback(async (cfg) => {
    if (!cfg?.airbnbIcalUrl) return;
    setSyncStatus('syncing');
    try {
      const freshReservations = await syncAirbnbReservations(cfg.airbnbIcalUrl, {
        checkInHour:  cfg.checkInHour  ?? 15,
        checkOutHour: cfg.checkOutHour ?? 11,
      });

      // 과거 예약은 iCal 피드에서 제거되어도 로컬 캐시로 보존
      const reservations = mergePastReservations(freshReservations);

      let cleaningSlots = [];
      if (cfg.googleCalIcalUrl) {
        try { cleaningSlots = await syncGoogleCalendarSlots(cfg.googleCalIcalUrl); }
        catch { /* Google Calendar 실패해도 Airbnb 데이터는 표시 */ }
      }

      const template = {
        id:                   'LIVE_001',
        name:                 cfg.name || '내 숙소',
        district:             cfg.district || '',
        watcherId:            cfg.watcherId ?? null,
        checkInHour:          cfg.checkInHour ?? 15,
        checkOutHour:         cfg.checkOutHour ?? 11,
        cleaningDurationHours: cfg.cleaningDurationHours ?? 2.5,
        sensors:              null,
      };

      const live = buildLiveProperty(template, reservations, cleaningSlots);
      setLiveProperty(live);
      setLastSynced(new Date());
      setSyncStatus('ok');

      // Pi 워처에 현재 예약 정보 전달 (퇴실 감지용)
      const currentRes = live.reservation;
      postMonitoringConfig({
        areaName: cfg.name,
        district: cfg.district,
        reservation: currentRes ? { checkOut: currentRes.checkOut?.toISOString?.() ?? null } : null,
      });
    } catch (error) {
      setSyncStatus('error');
      Toast.show(`캘린더 동기화 실패: ${error.message || '설정과 URL을 확인하세요.'}`, 'e');
    }
  }, []);

  // 마운트 시 Pi에서 숙소 설정 로드 — Pi가 source of truth, localStorage는 캐시
  useEffect(() => {
    fetchProperties().then(list => {
      const piCfg = list[0];
      if (!piCfg?.airbnbIcalUrl) return;
      // Pi 값과 로컬 캐시가 다르면 Pi 값으로 갱신
      const local = loadConfig();
      if (JSON.stringify(piCfg) !== JSON.stringify(local)) {
        saveConfig(piCfg);
        setSyncConfig(piCfg);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 마운트 + 설정 변경 시 싱크, 이후 15분 주기
  useEffect(() => {
    if (!syncConfig) return;
    runSync(syncConfig);
    const interval = setInterval(() => runSync(syncConfig), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncConfig, runSync]);

  // ── HA 폴링 헬퍼 ──────────────────────────────────────────────────────────
  function buildSnap(haSnap) {
    const w = liveWeatherRef.current;
    let outdoorTempSource;
    if (haSnap.outdoorTemp)   outdoorTempSource = 'ha';
    else if (w?.temp)         outdoorTempSource = 'weather-api';
    else                      outdoorTempSource = null;

    return {
      ...haSnap,
      outdoorTemp:      haSnap.outdoorTemp     ?? w?.temp     ?? null,
      outdoorHumidity:  haSnap.outdoorHumidity ?? w?.humidity ?? null,
      outdoorTempSource,
    };
  }

  function applyMonitorEvents(events, snap) {
    for (const event of events) {
      if (!isValidTransition(monitorState, event.type)) continue;
      const next = getNextRoomState(monitorState, event.type);
      setMonitorState(next);
      putMonitoringRoomState(next);
      setLastMonitorEvent({ ...event, snap });
      Toast.show(`🏠 ${event.reason}`, event.severity === 'CRITICAL' ? 'e' : 'w');

      // check_out_detected: HA Area 전체 기기 종료
      if (event.type === 'check_out_detected' && syncConfig?.name) {
        callService('homeassistant', 'turn_off', { area_id: syncConfig.name }).catch(() => {});
        Toast.show('퇴실 확인 — 모든 기기 종료 중', 'i');
      }
    }
  }

  function handleCleaningStarted() {
    if (!isValidTransition(monitorState, 'cleaning_started')) return;
    const next = getNextRoomState(monitorState, 'cleaning_started');
    setMonitorState(next);
    putMonitoringRoomState(next);
    Toast.show('청소 시작됨', 'i');
  }

  function handleCleaningFinished() {
    if (!isValidTransition(monitorState, 'cleaning_finished')) return;
    const next = getNextRoomState(monitorState, 'cleaning_finished');
    setMonitorState(next);
    putMonitoringRoomState(next);
    setLastMonitorEvent(null);
    Toast.show('청소 완료 — 숙소 준비됨', 's');

    // 스펙: "청소 완료 시점에 체크인까지 1시간 미만이면 즉시 PRE_STAY_READY 전환"
    // 15분 iCal 싱크 주기를 기다리지 않고 현재 시각 기준으로 즉시 재계산
    if (liveProperty?.reservations) {
      const freshCal = deriveCurrentState(
        liveProperty.reservations, new Date(),
        liveProperty.cleaningDurationHours ?? 2.5,
      );
      const immediate = deriveNextMonitorState(freshCal.mainStatus, freshCal.subStatus, next);
      if (immediate) {
        setMonitorState(immediate);
        putMonitoringRoomState(immediate);
      }
    }
  }

  function handleMaintenanceStarted() {
    if (!isValidTransition(monitorState, 'maintenance_started')) return;
    const next = getNextRoomState(monitorState, 'maintenance_started');
    setMonitorState(next);
    putMonitoringRoomState(next);
    Toast.show('정비 시작됨', 'i');
  }

  function handleMaintenanceFinished() {
    if (!isValidTransition(monitorState, 'maintenance_finished')) return;
    const next = getNextRoomState(monitorState, 'maintenance_finished');
    setMonitorState(next);
    putMonitoringRoomState(next);
    Toast.show('정비 완료', 's');
  }

  // HA 폴링 — 숙소 이름을 Area ID로 사용, 30초 주기
  useEffect(() => {
    const areaName = syncConfig?.name;
    if (!areaName) return;
    let cancelled = false;

    async function poll() {
      try {
        const data = await getAreaData(areaName);
        if (cancelled || !data) return;
        if (data.sensorReadings) setLiveSensorReadings(data.sensorReadings);
        setLiveDevices(data.devices ?? []);

        if (serverWatcherActive || !data.monitoringSnapshot || liveProperty?.currentState?.mainStatus !== 'OCCUPIED') return;

        const snap   = buildSnap(data.monitoringSnapshot);
        const res    = buildReservation(liveProperty);
        const events = localMonitorRef.current.process({ snap, roomState: monitorState, reservation: res, now: Date.now() });
        applyMonitorEvents(events, snap);
      } catch {
        // HA 미연결 시 무시
      }
    }

    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [syncConfig?.name, serverWatcherActive, liveProperty, monitorState]);

  // 서버 워처 폴링 — 5초 주기
  useEffect(() => {
    if (!syncConfig?.name) return;
    const watcherId = syncConfig?.watcherId ?? null;
    let cancelled = false;

    async function pollServer() {
      try {
        const state = await fetchMonitoringState(watcherId);
        if (cancelled || !state) return;
        if (state.roomState) {
          setMonitorState(state.roomState);
          setServerWatcherActive(true);
          const log = state.eventLog;
          if (log?.length) setLastMonitorEvent(log[log.length - 1]);
        }
      } catch {
        setServerWatcherActive(false);
      }
    }

    pollServer();
    const interval = setInterval(pollServer, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [syncConfig?.name, syncConfig?.watcherId]);

  // snapshotLog 폴링 — 라이브 숙소(syncConfig)의 워처에서만 가져옴
  useEffect(() => {
    const watcherId = syncConfig?.watcherId ?? null;
    let cancelled = false;

    async function pollSnapshot() {
      try {
        const state = await fetchMonitoringState(watcherId);
        if (cancelled || !state) return;
        setSnapshotLog(state.snapshotLog ?? []);
      } catch { /* 연결 없으면 무시 */ }
    }

    pollSnapshot();
    const interval = setInterval(pollSnapshot, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [syncConfig?.watcherId]);

  // 날씨 폴링 — district 기준, 15분 주기
  useEffect(() => {
    const district = syncConfig?.district;
    if (!district) return;
    let cancelled = false;
    async function fetchWeather() {
      try {
        const data = await getWeatherByDistrict(district);
        if (!cancelled && data) setLiveWeather(data);
      } catch { /* 네트워크 실패 시 이전 값 유지 */ }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [syncConfig?.district]);

  // liveWeather 변경 시 ref 동기화
  useEffect(() => { liveWeatherRef.current = liveWeather; }, [liveWeather]);

  // iCal 캘린더 상태 → monitorState 동기화
  useEffect(() => {
    if (!liveProperty) return;
    const next = deriveNextMonitorState(
      liveProperty.currentState?.mainStatus,
      liveProperty.currentState?.subStatus,
      monitorState,
    );
    if (next) {
      setMonitorState(next);
      putMonitoringRoomState(next);
    }
  }, [liveProperty?.currentState?.mainStatus, liveProperty?.currentState?.subStatus]);

  // PRE_STAY_READY 진입 시 HA 입실 준비 씬 실행
  useEffect(() => {
    if (monitorState.mainStatus !== 'PRE_STAY_READY' || !syncConfig?.name) return;
    callService('homeassistant', 'turn_on', { area_id: syncConfig.name }).catch(() => {});
    Toast.show('입실 준비 시작 — HA 씬 실행 중', 'i');
  }, [monitorState.mainStatus]);

  const handleSaveSettings = (form) => {
    saveConfig(form);           // localStorage 캐시
    setSyncConfig(form);
    setShowSettings(false);
    // Pi 파일에 영구 저장 (source of truth)
    const id = form.id ?? `prop_${Date.now()}`;
    const withId = { ...form, id };
    putProperties([withId]);
    saveConfig(withId);
    // Pi 워처에도 설정 전달 (areaName + district + devices)
    postMonitoringConfig(
      { areaName: form.name, district: form.district, devices: form.devices },
      form.watcherId ?? null,
    );
  };

  // 실 데이터 + 목업 데이터 병합 (실 데이터 맨 앞, HA 센서·기기·모니터링 상태 주입)
  const mergedProperties = liveProperty
    ? [{
        ...liveProperty,
        sensorReadings: liveSensorReadings ?? liveProperty.sensorReadings,
        haDevices: liveDevices,
        // OCCUPIED 상태일 때 서버 워처(또는 로컬 모니터) subStatus로 덮어쓰기
        subStatus: liveProperty.currentStatus === 'OCCUPIED'
          ? monitorState.subStatus
          : liveProperty.subStatus,
        monitorState,
        lastMonitorEvent,
        serverWatcherActive,
        snapshotLog,
      }, ...PROPERTIES.map(p => ({ ...p, snapshotLog: [] }))]
    : PROPERTIES.map(p => ({ ...p, snapshotLog: [] }));

  // ID로 항상 최신 mergedProperties에서 lookup → 폴링 업데이트가 즉시 반영됨
  const selectedProperty = mergedProperties.find(p => p.id === selectedPropertyId) ?? null;

  let currentView;
  if (view === 'cleaning') {
    currentView = (
      <CleaningManager
        syncConfig={syncConfig}
        liveProperty={liveProperty}
        onBack={() => setView('dashboard')}
      />
    );
  } else if (view === 'detail' && selectedProperty) {
    currentView = (
      <PropertyDetailView
        property={selectedProperty}
        weather={liveWeather}
        onBack={() => setView('list')}
        onCleaningStarted={handleCleaningStarted}
        onCleaningFinished={handleCleaningFinished}
        onMaintenanceStarted={handleMaintenanceStarted}
        onMaintenanceFinished={handleMaintenanceFinished}
      />
    );
  } else if (view === 'list') {
    currentView = (
      <PropertyListView
        initialFilter={listFilter}
        onSelectProperty={(p) => { setSelectedPropertyId(p.id); setView('detail'); }}
        onBack={() => setView('dashboard')}
        properties={mergedProperties}
      />
    );
  } else {
    currentView = (
      <DashboardView
        onSelectStatus={(status) => { setListFilter(status); setView('list'); }}
        onBack={onBack}
        properties={mergedProperties}
        syncBadge={
          <SyncBadge
            status={syncStatus}
            lastSynced={lastSynced}
            onSync={() => runSync(syncConfig)}
            onSettings={() => setShowSettings(true)}
            onCleaning={() => setView('cleaning')}
          />
        }
      />
    );
  }

  return (
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {currentView}
      </div>

      {showSettings && (
        <SettingsModal
          config={syncConfig}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 캘린더 미설정 시 하단 안내 */}
      {!syncConfig && view === 'dashboard' && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#1a202c', color: '#fff', borderRadius: 12, padding: '12px 20px',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', zIndex: 100,
        }}>
          실제 예약 데이터를 연동하려면
          <button onClick={() => setShowSettings(true)} style={{
            border: '1.5px solid #fff', borderRadius: 8, background: 'transparent',
            color: '#fff', padding: '4px 12px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>캘린더 설정 →</button>
        </div>
      )}
    </div>
  );
}
