import { useState, useEffect, useCallback, useRef } from 'react';
import MonthlyView from './MonthlyView';
import PropertyListView from './PropertyListView';
import PropertyDetailView from './PropertyDetailView';
import CleaningManager from './CleaningManager';
import { PROPERTIES } from '../../data/roomStateMockData';
import { buildLiveProperty, deriveCurrentState } from '../../application/calendarSyncService';
import { getAreaData, callService } from '../../infrastructure/haBrowserClient';
import { getWeatherByDistrict } from '../../infrastructure/weatherClient';
import { OccupancyMonitor } from '../../application/occupancyMonitor';
import { getNextRoomState, isValidTransition, INITIAL_STATE } from '../../domain/room-state/roomStateDomain';
import { DEVICE_ROLE } from '../../domain/device-control/deviceRoles';
import Toast from '../../utils/toast';
import { canonicalPropertyId, planPropertyIdentity, validatePropertyName } from '../../domain/propertyIdentityDomain';
import { DATA_PROFILE, normalizeDataProfile } from '../../config/dataProfile.js';

const APP_DATA_PROFILE = normalizeDataProfile(import.meta.env.VITE_PROPOS_DATA_PROFILE, DATA_PROFILE.HYBRID);
const USE_DEMO_DATA = APP_DATA_PROFILE === DATA_PROFILE.DEMO;

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

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
  catch { return null; }
}
function saveConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

// Pi 워처 메타데이터 로드. 예약·iCal·청소 일정은 이 응답을 사용하지 않는다.
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

async function fetchCloudProperties() {
  try {
    const res = await fetch('/api/cleaning/properties', { cache: 'no-store' });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Postgres property_cleaning_config 행을 화면 모델로 변환한다.
// Pi 워처 전용 district/watcherId/devices는 별도 메타데이터로 합친다.
function cloudRowToConfig(row) {
  return {
    id: row.property_id,
    name: row.name,
    district: '',
    watcherId: null,
    airbnbIcalUrl: row.ical_url || '',
    googleCalendarId: row.google_calendar_id || '',
    checkInHour: 15,
    checkOutHour: row.checkout_hour ?? 11,
    cleaningDurationHours: row.cleaning_duration_hours ?? 2.5,
    devices: {},
  };
}

function cloudRowToLiveProperty(row) {
  const reservations = (Array.isArray(row?.reservations) ? row.reservations : [])
    .filter(item => item.status !== 'CANCELLED')
    .map(item => ({
      uid: item.uid,
      guestName: item.guestName || '',
      platform: item.platform || 'Airbnb',
      checkIn: new Date(item.checkIn),
      checkOut: new Date(item.checkOut),
      ...(item.cleanerName ? { cleanerName: item.cleanerName } : {}),
      ...(item.cleaningStatus ? { cleaningStatus: item.cleaningStatus } : {}),
      ...(item.cleaningAt ? { cleaningAt: new Date(item.cleaningAt) } : {}),
      ...(item.cleaningEnd ? { cleaningEnd: new Date(item.cleaningEnd) } : {}),
    }))
    .filter(item => Number.isFinite(item.checkIn.getTime()) && Number.isFinite(item.checkOut.getTime()));
  const cleaningSlots = reservations
    .filter(item => item.cleaningAt && item.cleaningEnd)
    .map(item => ({
      start: item.cleaningAt,
      end: item.cleaningEnd,
      cleanerName: item.cleanerName,
      cleaningStatus: item.cleaningStatus,
    }));
  return {
    ...buildLiveProperty({
      id: row.property_id,
      name: row.name,
      district: row.district || '',
      watcherId: null,
      checkInHour: 15,
      checkOutHour: row.checkout_hour ?? 11,
      cleaningDurationHours: row.cleaning_duration_hours ?? 2.5,
      sensors: null,
    }, reservations, cleaningSlots),
    dataOrigin: row.data_origin || 'REAL',
    sourceSystem: row.source_system || null,
  };
}

// Pi에는 워처 메타데이터만 저장한다. 실제 숙소·예약·iCal 값은 보내지 않는다.
async function putProperties(list) {
  try {
    const watcherProperties = list.map(property => ({
      id: property.id,
      name: property.name,
      district: property.district || '',
      watcherId: property.watcherId ?? null,
      devices: property.devices && typeof property.devices === 'object' ? property.devices : {},
    }));
    await fetch('/api/properties', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watcherProperties),
    });
  } catch { /* Pi 미연결 시 무시 — Postgres 정본은 유지 */ }
}

// Vercel 청소 DB에 숙소 등록/갱신. 식별자 = 이름 (D-016) —
// previousId 가 있으면 서버가 이전 식별자(레거시 prop_… 또는 변경 전 이름)의 이력을 새 이름으로 함께 이전한다.
function registerProperty(cfg, previousId = null) {
  return fetch('/api/cleaning/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      property_id:             cfg.id,
      name:                    cfg.name,
      checkout_hour:           cfg.checkOutHour ?? 11,
      cleaning_duration_hours: cfg.cleaningDurationHours ?? 2.5,
      ical_url:                cfg.airbnbIcalUrl,
      host_phone:              cfg.hostPhone ?? null,
      ...(previousId ? { previous_property_id: previousId } : {}),
    }),
  });
}

async function errorMessageOf(res) {
  try { return (await res.json())?.error ?? String(res.status); } catch { return String(res.status); }
}

// ── 설정 모달 ─────────────────────────────────────────────────────────────────
function SettingsModal({ config, onSave, onClose }) {
  const initial = config ?? {
    name: '내 숙소',
    district: '',
    watcherId: 'watcher1',
    airbnbIcalUrl: '',
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
    const [cloudRows, watcherRows] = await Promise.all([fetchCloudProperties(), fetchProperties()]);
    setLoadingServer(false);
    const savedRow = cloudRows.find(row => row.data_origin === 'REAL' && row.property_id === row.name && row.ical_url)
      ?? cloudRows.find(row => row.data_origin === 'REAL' && row.ical_url)
      ?? cloudRows.find(row => row.data_origin === 'REAL' && row.property_id === row.name);
    const saved = savedRow ? cloudRowToConfig(savedRow) : null;
    if (!saved) {
      Toast.show('운영 DB에 저장된 숙소 설정이 없습니다.', 'w');
      return;
    }
    const watcher = watcherRows.find(item => item.id === saved.id || item.name === saved.name);
    const merged = {
      ...saved,
      district: watcher?.district ?? saved.district,
      watcherId: watcher?.watcherId ?? saved.watcherId,
      devices: watcher?.devices ?? saved.devices,
    };
    setForm(f => ({ ...f, ...merged, _uiDevices: formatDeviceMap(merged.devices ?? {}) }));
    Toast.show('운영 DB에서 설정을 불러왔습니다. 저장을 눌러 적용하세요.', 's');
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
  const [listDayOffset, setListDayOffset] = useState(null); // 대시보드 캘린더에서 "체류/공실" 눌러 날짜 지정 이동할 때만 채움
  const [listJumpIds, setListJumpIds]     = useState(null); // 그 날짜 기준 { occupied: [...], vacant: [...] } — 캘린더가 이미 계산한 값 그대로 사용
  const [detailDayOffset, setDetailDayOffset] = useState(null); // "발견된 패턴" 팝업에서 특정 날짜로 눌러 들어올 때만 채움 (D-028)
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [showSettings, setShowSettings]   = useState(false);
  const [syncConfig, setSyncConfig]       = useState(() => USE_DEMO_DATA ? null : loadConfig());
  const [liveProperty, setLiveProperty]     = useState(null);
  const [dbPropertyRows, setDbPropertyRows] = useState([]);
  const [liveSensorReadings, setLiveSensorReadings] = useState(null);
  const [liveDevices, setLiveDevices]       = useState([]);
  const [liveWeather, setLiveWeather]       = useState(null);
  const [syncStatus, setSyncStatus]       = useState('idle');   // idle | syncing | ok | error
  const [lastSynced, setLastSynced]       = useState(null);

  const refreshDbProperties = useCallback(async () => {
    const rows = await fetchCloudProperties();
    setDbPropertyRows(rows);
    return rows;
  }, []);

  // 모니터링 상태 — 서버(Pi watcher)에서 폴링, fallback으로 브라우저 로컬 실행
  const [monitorState, setMonitorState]         = useState(INITIAL_STATE);
  const [snapshotLog, setSnapshotLog]           = useState([]);
  const [serverWatcherActive, setServerWatcherActive] = useState(false);
  const [lastMonitorEvent, setLastMonitorEvent] = useState(null);
  const localMonitorRef = useRef(new OccupancyMonitor());
  // 날씨를 HA 폴링 클로저 안에서 읽기 위한 ref (stale closure 방지)
  const liveWeatherRef = useRef(null);

  // 서버 정본 동기화 실행. 브라우저는 iCal/Google 원본을 직접 읽지 않는다.
  const runSync = useCallback(async (cfg) => {
    if (USE_DEMO_DATA || !cfg?.id || !cfg?.airbnbIcalUrl) return;
    setSyncStatus('syncing');
    try {
      const syncResponse = await fetch('/api/cleaning/ical-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: canonicalPropertyId(cfg) }),
      });
      if (!syncResponse.ok) throw new Error(await errorMessageOf(syncResponse));

      const cloudRows = await refreshDbProperties();
      const row = cloudRows.find(item => (
        item.property_id === canonicalPropertyId(cfg) && item.data_origin === 'REAL'
      ));
      if (!row) throw new Error('운영 DB에서 REAL 숙소를 찾을 수 없습니다.');

      const live = cloudRowToLiveProperty(row);
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
  }, [refreshDbProperties]);

  // 마운트 시 Postgres에서 REAL 숙소 설정·예약 정본을 로드한다.
  // Pi는 같은 숙소의 HA 워처 메타데이터만 보조한다.
  useEffect(() => {
    // 명시적인 demo 프로필만 정적 fixture를 사용한다. 기본 hybrid는 로컬/운영 모두 DB를 읽는다.
    if (USE_DEMO_DATA) {
      setSyncStatus('ok');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const [list, cloudRows]  = await Promise.all([fetchProperties(), fetchCloudProperties()]);
      if (!cancelled) setDbPropertyRows(cloudRows);
      const realRows = cloudRows.filter(row => row.data_origin === 'REAL');
      const canonicalReal = realRows.find(row => row.property_id === row.name && row.ical_url)
        ?? realRows.find(row => row.ical_url)
        ?? realRows.find(row => row.property_id === row.name);
      const piCfg = canonicalReal
        ? list.find(item => item.id === canonicalReal.property_id || item.name === canonicalReal.name)
        : null;
      const cloudRow = canonicalReal ?? null;
      let cfg = canonicalReal
        ? {
          ...cloudRowToConfig(canonicalReal),
          district: piCfg?.district ?? '',
          watcherId: piCfg?.watcherId ?? null,
          devices: piCfg?.devices ?? {},
        }
        : null;
      if (!cfg || cancelled) return;
      // 최초 화면은 마지막으로 저장된 Postgres 예약/배정값을 즉시 표시한다.
      // 이후 runSync가 최신 iCal을 반영하되, 일시적인 원본 장애로 REAL 숙소 자체가
      // 목록에서 사라지지는 않게 한다.
      setLiveProperty(cloudRowToLiveProperty(canonicalReal));

      // 청소 DB 백필 + 식별자 정규화 (D-016). 저장된 id 가 이름과 다르면(레거시 prop_…)
      // 서버가 이력을 새 이름으로 이전한 뒤에만 정규 설정으로 바꾼다 — 실패하면 기존 설정 유지.
      if (cfg.airbnbIcalUrl) {
        const plan = planPropertyIdentity(cfg);
        // 청소 DB(Postgres)가 정본(D-014) — 이미 이 이름으로 등록돼 있고 옮길 이력도 없으면
        // (previousId 없음) 쓰지 않고 정본 값을 그대로 반영만 한다. 안 그러면 이 브라우저가
        // 들고 있는(어쩌면 낡은) 체크아웃시각·청소시간·iCal 값이 열 때마다 정본을 덮어써서,
        // 청소 관리 화면에서 방금 바꾼 값이 다음 접속 때 조용히 되돌아가 버린다
        // (실사용 무결성 점검 중 발견, 2026-09-29 — A/B 두 화면이 같은 필드를 서로 몰래 쓰던 문제).
        const alreadyCanonical = cloudRow?.property_id === plan.config.id;
        if (alreadyCanonical && !plan.previousId) {
          cfg = {
            ...plan.config,
            checkOutHour: cloudRow.checkout_hour ?? plan.config.checkOutHour,
            cleaningDurationHours: cloudRow.cleaning_duration_hours ?? plan.config.cleaningDurationHours,
            airbnbIcalUrl: cloudRow.ical_url || plan.config.airbnbIcalUrl,
          };
        } else {
          const res = await registerProperty(plan.config, plan.previousId).catch(() => null);
          if (res?.ok && plan.previousId) {
            cfg = plan.config;
            putProperties([cfg]);
          } else if (res && !res.ok && plan.previousId) {
            Toast.show(`숙소 이름 이전 실패: ${await errorMessageOf(res)}`, 'w');
          }
        }
      }

      // Postgres 정본에서 읽은 설정만 화면 캐시에 반영한다.
      if (cancelled) return;
      saveConfig(cfg);
      setSyncConfig(cfg);
    })();
    return () => { cancelled = true; };
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

  const handleSaveSettings = async (form) => {
    // 이름은 곧 ID (D-016) — 쉼표 등 키로 쓸 수 없는 이름은 저장하지 않는다
    const nameCheck = validatePropertyName(form.name);
    if (!nameCheck.ok) { Toast.show(nameCheck.reason, 'e'); return; }

    // form.id = 변경 전 식별자(레거시 prop_… 또는 이전 이름). 다르면 서버가 이력을 새 이름으로 함께 이전
    const plan   = planPropertyIdentity(form);
    const withId = plan.config;

    // 청소 DB 등록/이전을 먼저 — 이름 변경이 거절되면(같은 이름 존재 등) 설정을 바꾸지 않는다
    if (withId.airbnbIcalUrl || plan.previousId) {
      try {
        const res = await registerProperty(withId, plan.previousId);
        if (res.ok) {
          Toast.show(plan.previousId ? '숙소 이름 변경 — 이력을 새 이름으로 이전했어요' : '청소 DB 동기화 완료', 's');
        } else {
          Toast.show(`청소 DB 동기화 실패: ${await errorMessageOf(res)}`, 'e');
          if (plan.previousId) return;
        }
      } catch (e) {
        Toast.show(`청소 DB 동기화 실패: ${e.message}`, 'e');
        if (plan.previousId) return;
      }
    }

    saveConfig(withId);           // localStorage 캐시
    setSyncConfig(withId);
    setShowSettings(false);
    putProperties([withId]);      // Pi 파일에 영구 저장 (source of truth)
    // Pi 워처에도 설정 전달 (areaName + district + devices) — 이벤트 property_id 도 이 이름으로 쌓인다
    postMonitoringConfig(
      { areaName: withId.name, district: withId.district, devices: withId.devices },
      withId.watcherId ?? null,
    );
  };

  // 기본 hybrid 프로필은 DB의 REAL/SIMULATED 숙소를 같은 구조로 합친다.
  // 명시적인 demo 프로필에서만 코드 fixture를 사용한다.
  const dbProperties = dbPropertyRows
    .map(cloudRowToLiveProperty)
    .filter(property => property.id !== liveProperty?.id);
  const liveDbRow = liveProperty
    ? dbPropertyRows.find(row => row.property_id === liveProperty.id)
    : null;
  const liveDbProperty = liveDbRow ? cloudRowToLiveProperty(liveDbRow) : null;
  const liveWithDbAssignments = liveProperty && liveDbProperty
    ? {
      ...liveProperty,
      reservations: liveProperty.reservations.map(reservation => {
        const dbReservation = liveDbProperty.reservations.find(item => item.uid === reservation.uid);
        return dbReservation ? { ...reservation, ...dbReservation } : reservation;
      }),
      cleaningSlots: liveDbProperty.cleaningSlots,
    }
    : liveProperty;
  const mergedProperties = USE_DEMO_DATA
    ? PROPERTIES.map(property => ({ ...property, dataOrigin: 'SIMULATED', snapshotLog: [] }))
    : [
      ...dbProperties,
      ...(liveWithDbAssignments ? [{
        ...liveWithDbAssignments,
        dataOrigin: 'REAL',
        sensorReadings: liveSensorReadings ?? liveProperty.sensorReadings,
        haDevices: liveDevices,
        // OCCUPIED 상태일 때 서버 워처(또는 로컬 모니터) subStatus로 덮어쓰기
        subStatus: liveProperty.currentState?.mainStatus === 'OCCUPIED'
          ? monitorState.subStatus
          : liveProperty.subStatus,
        monitorState,
        lastMonitorEvent,
        serverWatcherActive,
        snapshotLog,
      }] : []),
    ];

  // ID로 항상 최신 mergedProperties에서 lookup → 폴링 업데이트가 즉시 반영됨
  const selectedProperty = mergedProperties.find(p => p.id === selectedPropertyId) ?? null;

  let currentView;
  if (view === 'cleaning') {
    currentView = (
      <CleaningManager
        syncConfig={syncConfig}
        onBack={() => setView('dashboard')}
        onDataChanged={refreshDbProperties}
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
        initialDayOffset={detailDayOffset}
      />
    );
  } else if (view === 'list') {
    currentView = (
      <PropertyListView
        initialFilter={listFilter}
        initialDayOffset={listDayOffset}
        initialOccupantIds={listJumpIds}
        onSelectProperty={(p, dayOffset) => { setSelectedPropertyId(p.id); setDetailDayOffset(dayOffset ?? null); setView('detail'); }}
        onBack={() => setView('dashboard')}
        properties={mergedProperties}
      />
    );
  } else {
    currentView = (
      <MonthlyView
        onSelectStatus={(status) => { setListFilter(status); setListDayOffset(null); setListJumpIds(null); setView('list'); }}
        onNavigateToList={(dayOffset, occupancy, propertyIds) => { setListFilter(occupancy); setListDayOffset(dayOffset); setListJumpIds(propertyIds); setView('list'); }}
        onSelectProperty={(p, dayOffset) => { setSelectedPropertyId(p.id); setDetailDayOffset(dayOffset ?? null); setView('detail'); }}
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
