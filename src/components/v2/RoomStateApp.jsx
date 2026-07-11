import { useState, useEffect, useCallback } from 'react';
import DashboardView from './DashboardView';
import PropertyListView from './PropertyListView';
import PropertyDetailView from './PropertyDetailView';
import { PROPERTIES } from '../../data/roomStateMockData';
import { syncAirbnbReservations, syncGoogleCalendarSlots, buildLiveProperty } from '../../application/calendarSyncService';
import Toast from '../../utils/toast';

const LS_KEY = 'propos_calendar_sync';

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
  catch { return null; }
}
function saveConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

// ── 설정 모달 ─────────────────────────────────────────────────────────────────
function SettingsModal({ config, onSave, onClose }) {
  const initial = config ?? {
    name: '내 숙소',
    district: '',
    airbnbIcalUrl: '',
    googleCalIcalUrl: '',
    checkInHour: 15,
    checkOutHour: 11,
    cleaningDurationHours: 2.5,
  };
  const [form, setForm] = useState(initial);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 420, maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a202c', marginBottom: 20 }}>
          캘린더 연동 설정
        </div>

        {[
          { label: '숙소 이름', key: 'name', type: 'text', placeholder: '파주 게스트하우스' },
          { label: '지역 (선택)', key: 'district', type: 'text', placeholder: '파주시' },
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

        <div style={{ background: '#f0f4f8', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#4a5568', marginBottom: 20, lineHeight: 1.6 }}>
          Airbnb 관리자 → 캘린더 → 내보내기 → iCal URL 복사<br/>
          Google 캘린더 → 설정 → 통합 → iCal 형식 공개 주소
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 0',
            background: '#fff', fontSize: 14, color: '#4a5568', cursor: 'pointer', fontFamily: 'inherit',
          }}>취소</button>
          <button onClick={() => onSave(form)} style={{
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
function SyncBadge({ status, lastSynced, onSync, onSettings }) {
  const fmt = d => d ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {status === 'syncing' && (
        <div style={{ fontSize: 12, color: '#2563eb', fontFamily: "'DM Mono', monospace" }}>⟳ 동기화중...</div>
      )}
      {status === 'ok' && lastSynced && (
        <div style={{ fontSize: 12, color: '#059669', fontFamily: "'DM Mono', monospace" }}>
          ● LIVE {fmt(lastSynced)}
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
    </div>
  );
}

// ── 메인 앱 ────────────────────────────────────────────────────────────────────
export default function RoomStateApp({ onBack }) {
  const [view, setView]                   = useState('dashboard');
  const [listFilter, setListFilter]       = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [showSettings, setShowSettings]   = useState(false);
  const [syncConfig, setSyncConfig]       = useState(() => loadConfig());
  const [liveProperty, setLiveProperty]   = useState(null);
  const [syncStatus, setSyncStatus]       = useState('idle');   // idle | syncing | ok | error
  const [lastSynced, setLastSynced]       = useState(null);

  // 싱크 실행
  const runSync = useCallback(async (cfg) => {
    if (!cfg?.airbnbIcalUrl) return;
    setSyncStatus('syncing');
    try {
      const reservations = await syncAirbnbReservations(cfg.airbnbIcalUrl, {
        checkInHour:  cfg.checkInHour  ?? 15,
        checkOutHour: cfg.checkOutHour ?? 11,
      });

      let cleaningSlots = [];
      if (cfg.googleCalIcalUrl) {
        try { cleaningSlots = await syncGoogleCalendarSlots(cfg.googleCalIcalUrl); }
        catch { /* Google Calendar 실패해도 Airbnb 데이터는 표시 */ }
      }

      const template = {
        id:                   'LIVE_001',
        name:                 cfg.name || '내 숙소',
        district:             cfg.district || '',
        checkInHour:          cfg.checkInHour ?? 15,
        checkOutHour:         cfg.checkOutHour ?? 11,
        cleaningDurationHours: cfg.cleaningDurationHours ?? 2.5,
        sensors:              null,
      };

      const live = buildLiveProperty(template, reservations, cleaningSlots);
      setLiveProperty(live);
      setLastSynced(new Date());
      setSyncStatus('ok');
    } catch (error) {
      setSyncStatus('error');
      Toast.show(`캘린더 동기화 실패: ${error.message || '설정과 URL을 확인하세요.'}`, 'e');
    }
  }, []);

  // 마운트 + 설정 변경 시 싱크, 이후 15분 주기
  useEffect(() => {
    if (!syncConfig) return;
    runSync(syncConfig);
    const interval = setInterval(() => runSync(syncConfig), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncConfig, runSync]);

  const handleSaveSettings = (form) => {
    saveConfig(form);
    setSyncConfig(form);
    setShowSettings(false);
  };

  // 실 데이터 + 목업 데이터 병합 (실 데이터 맨 앞)
  const mergedProperties = liveProperty
    ? [liveProperty, ...PROPERTIES]
    : PROPERTIES;

  let currentView;
  if (view === 'detail' && selectedProperty) {
    currentView = (
      <PropertyDetailView
        property={selectedProperty}
        onBack={() => setView('list')}
      />
    );
  } else if (view === 'list') {
    currentView = (
      <PropertyListView
        initialFilter={listFilter}
        onSelectProperty={(p) => { setSelectedProperty(p); setView('detail'); }}
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
