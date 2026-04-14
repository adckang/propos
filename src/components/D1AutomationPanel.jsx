import React, { useCallback, useEffect, useRef, useState } from "react";

import checkinPreparationService from "../application/checkinPreparationService.js";
import PROPOS_CONFIG from "../config/publicConfig.js";
import BatchConsoleGuide from "./BatchConsoleGuide";
import haBrowserClient from "../infrastructure/haBrowserClient.js";
import Toast from "../utils/toast";

// ============================================================
// D1AutomationPanel.jsx — UC-001 체크인 전날 자동화 UI
// ============================================================

// ── 도메인 함수 ──────────────────────────────────────────────
const _d1 = (() => {
  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function filterTomorrowCheckIns(bookings, today) {
    if (!Array.isArray(bookings)) return [];
    const tomorrow = addDays(today, 1);
    return bookings.filter(b => b && b.checkIn && b.status === 'confirmed' && b.checkIn.slice(0, 10) === tomorrow);
  }
  function generatePIN() {
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  }
  function asUTC(s) {
    return (s.endsWith('Z') || s.includes('+')) ? s : s + 'Z';
  }
  function calcExpiry(checkIn, checkOut) {
    const from  = new Date(asUTC(checkIn));
    const until = new Date(asUTC(checkOut));
    return { validFrom: new Date(from.getTime() - 3600000).toISOString(), validUntil: until.toISOString() };
  }
  function buildWelcomeMessage(booking, pinRecord) {
    const { guestName, propName, wifi } = booking;
    const lines = [
      `안녕하세요 ${guestName}님!`,
      `${propName} 내일 체크인 안내드립니다.`,
      ``,
      `도어락 PIN: ${pinRecord.pin}`,
      `체크인: ${booking.checkIn.slice(0, 16).replace('T', ' ')} 이후 입실 가능합니다.`,
    ];
    if (wifi?.ssid) lines.push(`WiFi: ${wifi.ssid} / ${wifi.pw}`);
    lines.push(``, `불편하신 점은 채팅으로 알려주세요.`);
    return lines.join('\n');
  }
  function fmtExpiry(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return { filterTomorrowCheckIns, generatePIN, calcExpiry, buildWelcomeMessage, fmtExpiry };
})();

// ── iCal 유틸리티 ─────────────────────────────────────────────
const _ical = (() => {
  // iCal 텍스트 파싱 → VEVENT 배열
  function parse(text) {
    // line folding 해제 (RFC 5545)
    const unfolded = text
      .replace(/\r\n[ \t]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n[ \t]/g, '');
    const lines  = unfolded.split('\n');
    const events = [];
    let evt = null;
    for (const line of lines) {
      const t = line.trim();
      if (t === 'BEGIN:VEVENT') { evt = {}; continue; }
      if (t === 'END:VEVENT')   { if (evt) events.push(evt); evt = null; continue; }
      if (!evt) continue;
      const ci = t.indexOf(':');
      if (ci < 0) continue;
      const key = t.slice(0, ci).split(';')[0].toUpperCase();
      const val = t.slice(ci + 1);
      if      (key === 'DTSTART')     evt.dtstart = val.replace(/\D/g,'').slice(0,8);
      else if (key === 'DTEND')       evt.dtend   = val.replace(/\D/g,'').slice(0,8);
      else if (key === 'SUMMARY')     evt.summary = val;
      else if (key === 'STATUS')      evt.status  = val.trim().toUpperCase();
      else if (key === 'UID')         evt.uid     = val;
      else if (key === 'DESCRIPTION') evt.description = val;
    }
    return events;
  }

  // VEVENT 배열 + 숙소 설정 → Booking 배열
  function toBookings(events, cfg) {
    const dt = s => `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return events
      .filter(e => {
        if (!e.dtstart || !e.dtend) return false;
        if (e.status !== 'CONFIRMED') return false;
        const s = (e.summary || '').toLowerCase();
        // 에어비앤비 차단 기간 / 비가용 일정 제외
        if (s.includes('not available') || s.includes('blocked') || s === '') return false;
        return true;
      })
      .map((e, i) => {
        let guestName = e.summary || '게스트';
        // 에어비앤비 iCal은 무료 플랜에서 이름 미제공 → 예약 확정으로 표시
        if (/^(reserved|airbnb)/i.test(guestName)) guestName = '예약 확정';
        return {
          propId   : cfg.propId,
          propName : cfg.propName,
          guestName,
          guestId  : `${cfg.propId}_${e.uid || i}`,
          checkIn  : `${dt(e.dtstart)}T${cfg.checkInTime  || '15:00:00'}`,
          checkOut : `${dt(e.dtend)}T${cfg.checkOutTime || '11:00:00'}`,
          status   : 'confirmed',
          wifi     : cfg.wifi || { ssid:'', pw:'' },
        };
      });
  }

  // allorigins.win CORS 프록시를 통해 iCal 텍스트 fetch
  async function fetchViaProxy(url) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { cache:'no-store' });
    if (!res.ok) throw new Error(`프록시 응답 오류 (${res.status})`);
    const json = await res.json();
    if (!json.contents) throw new Error('iCal 내용이 비어있습니다');
    return json.contents;
  }

  return { parse, toBookings, fetchViaProxy };
})();

// ── 숙소 설정 (localStorage) ─────────────────────────────────
const _cfgKey = 'propos_prop_configs';

const DEFAULT_PROP_CONFIGS = [
  { propId:'P-042', propName:'해운대 오션뷰 펜트하우스', icalUrl:'', checkInTime:'15:00:00', checkOutTime:'11:00:00', wifi:{ssid:'ProposGuest_5G', pw:'1234567890'} },
  { propId:'P-007', propName:'강남 럭셔리 스위트',       icalUrl:'', checkInTime:'14:00:00', checkOutTime:'11:00:00', wifi:{ssid:'ProposGuest_7',  pw:'abcde12345'} },
  { propId:'P-015', propName:'제주 한옥 스테이',         icalUrl:'', checkInTime:'16:00:00', checkOutTime:'11:00:00', wifi:{ssid:'JejuGuest_2G',   pw:'jeju5678'  } },
  { propId:'P-031', propName:'마포 모던 스튜디오',       icalUrl:'', checkInTime:'15:00:00', checkOutTime:'11:00:00', wifi:{ssid:'ProposGuest_3G', pw:'mapo9999'  } },
];

function loadPropConfigs() {
  try { return JSON.parse(localStorage.getItem(_cfgKey)) || DEFAULT_PROP_CONFIGS; }
  catch { return DEFAULT_PROP_CONFIGS; }
}
function savePropConfigs(configs) {
  try { localStorage.setItem(_cfgKey, JSON.stringify(configs)); } catch {}
}

// ── Mock Infrastructure ───────────────────────────────────────
function makeMockInfra(onAlert, failPropId) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  return {
    setLockCode: async (entityId) => {
      await delay(300 + Math.random() * 200);
      if (failPropId && entityId.includes(failPropId.toLowerCase().replace('-','_')))
        throw new Error('HA 503 — 도어락 응답 없음');
    },
    activateScene: async () => { await delay(200 + Math.random() * 150); },
    sendMessage:   async () => { await delay(100 + Math.random() * 100); },
    addAlert: onAlert,
  };
}

// ── Real HA Infrastructure (TV방) ─────────────────────────────
const _ha = (() => {
  const TV_LIGHT = (typeof PROPOS_CONFIG !== 'undefined') ? PROPOS_CONFIG.entities.tvLight : 'light.rgbcct_8002';
  const TV_PLUG  = (typeof PROPOS_CONFIG !== 'undefined') ? PROPOS_CONFIG.entities.tvPlug  : 'switch.tv_smart_plug_socket_1';
  async function setLockCode(entityId, code, name) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      title:'[PROPOS] PIN 발급 완료',
      message:`게스트: ${name}\nPIN: ${code}\n등록 대상: ${entityId}`,
      notification_id:`propos_pin_${entityId.replace(/\W/g,'_')}`,
    });
  }
  async function activateScene(entityId) {
    if (entityId.includes('checkin_ready')) {
      await haBrowserClient.callService('light', 'turn_on', { entity_id:TV_LIGHT, brightness:255 });
      await haBrowserClient.callService('switch', 'turn_on', { entity_id:TV_PLUG });
      return;
    }
    await haBrowserClient.callService('scene', 'turn_on', { entity_id:entityId });
  }
  async function sendMessage(guestId, text) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      title:`[PROPOS] 웰컴 메시지 — ${guestId}`,
      message:text,
      notification_id:`propos_msg_${guestId}`,
    });
  }
  return { setLockCode, activateScene, sendMessage };
})();

function makeHAInfra(onAlert) {
  return { setLockCode:_ha.setLockCode, activateScene:_ha.activateScene, sendMessage:_ha.sendMessage, addAlert:onAlert };
}

function _hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── 카운트다운 훅 ─────────────────────────────────────────────
function useCountdownTo1800() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    function calc() {
      const now = new Date(), t = new Date(now);
      t.setHours(18,0,0,0);
      if (now >= t) t.setDate(t.getDate()+1);
      return Math.max(0, Math.floor((t-now)/1000));
    }
    setSecs(calc());
    const id = setInterval(() => setSecs(calc()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = String(Math.floor(secs/3600)).padStart(2,'0');
  const m = String(Math.floor((secs%3600)/60)).padStart(2,'0');
  const s = String(secs%60).padStart(2,'0');
  return { secs, label:`${h}:${m}:${s}` };
}

// ── 목업 예약 데이터 (iCal 없을 때 fallback) ─────────────────
function makeTomorrowBookings(today, propConfigs) {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const tmrw = d.toISOString().slice(0, 10);
  const addDay = (base, n) => { const dd = new Date(base+'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate()+n); return dd.toISOString().slice(0,10); };
  const cfgs = (propConfigs && propConfigs.length) ? propConfigs : DEFAULT_PROP_CONFIGS;
  return cfgs.slice(0, 4).map((cfg, i) => ({
    propId  : cfg.propId,
    propName: cfg.propName,
    guestName: ['김민준','Sarah M.','田中花子','Emma C.'][i] || '게스트',
    guestId : `g00${i+1}`,
    checkIn : `${tmrw}T${cfg.checkInTime  || '15:00:00'}`,
    checkOut: `${addDay(tmrw, i+1)}T${cfg.checkOutTime || '11:00:00'}`,
    status  : 'confirmed',
    wifi    : cfg.wifi || { ssid:'', pw:'' },
  }));
}

// ── 공용 input 스타일 ─────────────────────────────────────────
const _inp = {
  border:'1px solid var(--border)', borderRadius:6, padding:'5px 8px',
  fontSize:11, background:'var(--surface)', color:'var(--text)',
  fontFamily:"'DM Sans',sans-serif", outline:'none', width:'100%',
};

// ── PropConfigCard (설정 뷰 - 숙소 1개) ──────────────────────
function PropConfigCard({ config, onChange, onRemove }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:8, padding:12, marginBottom:8 }}>
      {/* 숙소 ID + 이름 */}
      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <input value={config.propId} onChange={e=>onChange('propId', e.target.value)}
          placeholder="P-042" style={{ ..._inp, width:72, flexShrink:0 }} />
        <input value={config.propName} onChange={e=>onChange('propName', e.target.value)}
          placeholder="숙소명" style={{ ..._inp, flex:1 }} />
        <button onClick={onRemove}
          style={{ padding:'4px 9px', borderRadius:6, background:'#fef2f2',
            border:'1px solid #fca5a5', color:'#dc2626', fontSize:12, cursor:'pointer', flexShrink:0 }}>
          ✕
        </button>
      </div>

      {/* iCal URL */}
      <div style={{ marginBottom:6, position:'relative' }}>
        <input value={config.icalUrl} onChange={e=>onChange('icalUrl', e.target.value)}
          placeholder="Airbnb iCal URL — https://www.airbnb.com/calendar/ical/XXXXX.ics?s=..."
          style={{ ..._inp, fontFamily:"'DM Mono',monospace", fontSize:10,
            borderColor: config.icalUrl ? '#a7f3d0' : 'var(--border)',
            paddingRight: config.icalUrl ? 52 : 8 }} />
        {config.icalUrl && (
          <span style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
            fontSize:9, color:'#059669', fontWeight:700, background:'#ecfdf5',
            border:'1px solid #a7f3d0', borderRadius:4, padding:'1px 5px' }}>
            설정됨
          </span>
        )}
      </div>

      {/* WiFi + 체크인/아웃 시간 */}
      <div style={{ display:'flex', gap:6 }}>
        <input value={config.wifi?.ssid||''} onChange={e=>onChange('wifi.ssid', e.target.value)}
          placeholder="WiFi SSID" style={{ ..._inp, flex:1 }} />
        <input value={config.wifi?.pw||''} onChange={e=>onChange('wifi.pw', e.target.value)}
          placeholder="WiFi PW" style={{ ..._inp, flex:1 }} />
        <div style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
          <span style={{ fontSize:10, color:'var(--text3)', whiteSpace:'nowrap' }}>IN</span>
          <input value={config.checkInTime||'15:00:00'} onChange={e=>onChange('checkInTime', e.target.value)}
            style={{ ..._inp, width:72, fontFamily:"'DM Mono',monospace", fontSize:10 }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
          <span style={{ fontSize:10, color:'var(--text3)', whiteSpace:'nowrap' }}>OUT</span>
          <input value={config.checkOutTime||'11:00:00'} onChange={e=>onChange('checkOutTime', e.target.value)}
            style={{ ..._inp, width:72, fontFamily:"'DM Mono',monospace", fontSize:10 }} />
        </div>
      </div>
    </div>
  );
}

// ── SettingsView (설정 탭) ────────────────────────────────────
function SettingsView({ propConfigs, onChange, onAdd, onRemove, onSave, syncing, onSync, lastSyncTime, syncError }) {
  const hasAnyIcal = propConfigs.some(c => c.icalUrl.trim());
  return (
    <div style={{ flex:1, overflow:'auto', padding:16 }}>

      {/* 안내 배너 */}
      <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8,
        padding:'10px 14px', marginBottom:14, fontSize:11, color:'#78350f', lineHeight:1.7 }}>
        <strong>Airbnb iCal URL 찾는 방법</strong><br/>
        에어비앤비 앱 → 숙소 관리 → 캘린더 → 우측 상단 메뉴 → <strong>캘린더 내보내기</strong> → iCal 링크 복사<br/>
        <span style={{ color:'#94a3b8', fontSize:10 }}>동기화 시 실시간 예약 데이터를 가져옵니다. URL이 없는 숙소는 목업 데이터를 사용합니다.</span>
      </div>

      {/* 헤더 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>
          숙소 목록 ({propConfigs.length}개)
        </span>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={onSync} disabled={syncing || !hasAnyIcal}
            style={{ padding:'6px 12px', borderRadius:6,
              background: (syncing||!hasAnyIcal) ? 'var(--border)' : '#059669',
              border:`1.5px solid ${(syncing||!hasAnyIcal) ? 'var(--border2)' : '#047857'}`,
              color: (syncing||!hasAnyIcal) ? 'var(--text3)' : '#fff',
              fontSize:11, fontWeight:700, cursor:(syncing||!hasAnyIcal)?'not-allowed':'pointer',
              display:'flex', alignItems:'center', gap:4 }}>
            {syncing ? <><span style={{ animation:'d1spin 1s linear infinite', display:'inline-block' }}>↻</span> 동기화 중...</> : '🔄 동기화'}
          </button>
          <button onClick={onAdd}
            style={{ padding:'6px 12px', borderRadius:6, background:'var(--blue)',
              border:'1.5px solid #1d4ed8', color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer' }}>
            + 숙소 추가
          </button>
        </div>
      </div>

      {lastSyncTime && (
        <div style={{ fontSize:10, color:'#059669', marginBottom:8,
          fontFamily:"'DM Mono',monospace" }}>
          ✓ 마지막 동기화: {lastSyncTime}
        </div>
      )}

      {syncError && (
        <div style={{ fontSize:10, color:'#dc2626', background:'#fef2f2',
          border:'1px solid #fecaca', borderRadius:6, padding:'8px 10px', marginBottom:8,
          fontFamily:"'DM Mono',monospace", lineHeight:1.6, whiteSpace:'pre-wrap' }}>
          {syncError}
        </div>
      )}

      {propConfigs.map((cfg, i) => (
        <PropConfigCard key={i} config={cfg}
          onChange={(field, val) => onChange(i, field, val)}
          onRemove={() => onRemove(i)} />
      ))}

      <button onClick={onSave}
        style={{ width:'100%', padding:'10px', borderRadius:7, background:'var(--blue)',
          border:'1.5px solid #1d4ed8', color:'#fff', fontSize:13, fontWeight:700,
          cursor:'pointer', fontFamily:"'DM Sans',sans-serif", marginTop:4 }}>
        ✓ 설정 저장
      </button>
    </div>
  );
}

// ── StepChip ─────────────────────────────────────────────────
function StepChip({ label, state }) {
  const s = ({
    null:    { bg:'#f1f5f9', border:'#e2e8f0', color:'#94a3b8', icon:'·' },
    true:    { bg:'#ecfdf5', border:'#a7f3d0', color:'#059669', icon:'✓' },
    false:   { bg:'#fef2f2', border:'#fecaca', color:'#dc2626', icon:'✕' },
    loading: { bg:'#eff6ff', border:'#bfdbfe', color:'#2563eb', icon:'…' },
  })[state] || { bg:'#f1f5f9', border:'#e2e8f0', color:'#94a3b8', icon:'·' };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:s.bg,
      border:`1px solid ${s.border}`, color:s.color, borderRadius:20, padding:'3px 9px',
      fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace", transition:'all 0.2s' }}>
      <span style={{ fontSize:13, lineHeight:1 }}>{s.icon}</span>{label}
    </span>
  );
}

// ── PropResultCard ────────────────────────────────────────────
function PropResultCard({ result }) {
  const [expanded, setExpanded] = useState(false);
  const st = ({
    running:{ bg:'#eff6ff',border:'#bfdbfe',top:'#2563eb',label:'처리중'  },
    success:{ bg:'#ecfdf5',border:'#a7f3d0',top:'#059669',label:'완료'    },
    partial:{ bg:'#fffbeb',border:'#fde68a',top:'#d97706',label:'부분완료'},
    failed: { bg:'#fef2f2',border:'#fecaca',top:'#dc2626',label:'실패'    },
  })[result.status] || { bg:'#f8fafc',border:'#e2e8f0',top:'#94a3b8',label:'' };
  const ss = k => (result.status === 'running' && result.steps[k] === null) ? 'loading' : result.steps[k];

  return (
    <div style={{ background:st.bg, border:`1.5px solid ${st.border}`, borderRadius:10,
      borderTop:`3px solid ${st.top}`, padding:'14px 16px',
      boxShadow:'0 1px 3px rgba(0,0,0,0.06)', transition:'all 0.3s' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:'#1a202c', marginBottom:2, lineHeight:1.3 }}>{result.propName}</div>
          <div style={{ fontSize:11, color:'#718096' }}>{result.guestName}</div>
        </div>
        <span style={{ fontSize:10, fontWeight:700, color:st.top, background:'#fff',
          border:`1px solid ${st.border}`, borderRadius:20, padding:'2px 8px', whiteSpace:'nowrap', flexShrink:0 }}>
          {st.label}
        </span>
      </div>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:8 }}>
        <StepChip label="PIN 발급"  state={ss('pin')} />
        <StepChip label="메시지"    state={ss('message')} />
        <StepChip label="스마트홈"  state={ss('smartHome')} />
      </div>
      {result.pin && result.steps.pin && (
        <div style={{ background:'rgba(255,255,255,0.7)', borderRadius:6,
          padding:'6px 10px', marginBottom:6, border:'1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
            <span style={{ fontSize:10, color:'#64748b', fontWeight:600 }}>도어락 PIN</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:16, fontWeight:700,
              color:'#1a202c', letterSpacing:'0.15em' }}>{result.pin}</span>
          </div>
          {result.expiry && (
            <div style={{ fontSize:10, color:'#94a3b8', fontFamily:"'DM Mono',monospace" }}>
              {_d1.fmtExpiry(result.expiry.validFrom)} ~ {_d1.fmtExpiry(result.expiry.validUntil)}
            </div>
          )}
        </div>
      )}
      {result.steps.smartHome && result.sceneId && (
        <div style={{ fontSize:10, color:'#64748b', marginBottom:6, background:'rgba(255,255,255,0.6)',
          borderRadius:6, padding:'5px 8px', border:'1px solid rgba(0,0,0,0.06)' }}>
          <span style={{ fontWeight:600 }}>씬: </span>
          <span style={{ fontFamily:"'DM Mono',monospace" }}>{result.sceneId}</span>
          <div style={{ marginTop:3, color:'#94a3b8' }}>조명 100% · TV 플러그 ON</div>
        </div>
      )}
      {result.welcomeMsg && result.steps.message && (
        <div>
          <button onClick={() => setExpanded(e => !e)}
            style={{ fontSize:10, color:'#2563eb', background:'none', border:'none',
              padding:'2px 0', cursor:'pointer', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
            <span>{expanded?'▲':'▼'}</span> 웰컴 메시지 {expanded?'접기':'미리보기'}
          </button>
          {expanded && (
            <pre style={{ marginTop:6, fontSize:10, lineHeight:1.6, color:'#374151',
              background:'rgba(255,255,255,0.8)', borderRadius:6, padding:'8px 10px',
              whiteSpace:'pre-wrap', wordBreak:'break-word', border:'1px solid rgba(0,0,0,0.06)',
              fontFamily:"'DM Sans',sans-serif", maxHeight:140, overflowY:'auto' }}>
              {result.welcomeMsg}
            </pre>
          )}
        </div>
      )}
      {result.error && (
        <div style={{ marginTop:6, fontSize:10, color:'#dc2626', background:'#fef2f2',
          borderRadius:6, padding:'5px 8px', fontFamily:"'DM Mono',monospace", lineHeight:1.4 }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

// ── D1AlertItem ───────────────────────────────────────────────
function D1AlertItem({ alert, onAck }) {
  const s = ({
    info: { border:'#2563eb',bg:'#eff6ff',icon:'ℹ',color:'#1d4ed8' },
    warn: { border:'#d97706',bg:'#fffbeb',icon:'!',color:'#92400e' },
    error:{ border:'#dc2626',bg:'#fef2f2',icon:'✕',color:'#991b1b' },
  })[alert.type] || { border:'#e2e8f0',bg:'#f8fafc',icon:'·',color:'#64748b' };
  return (
    <div style={{ background:s.bg, borderLeft:`3px solid ${s.border}`,
      borderRadius:'0 6px 6px 0', padding:'8px 10px', marginBottom:4,
      display:'flex', gap:8, alignItems:'flex-start' }}>
      <span style={{ fontSize:12, fontWeight:700, color:s.color, flexShrink:0, lineHeight:1.4 }}>{s.icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:700, color:s.color, marginBottom:1 }}>{alert.prop}</div>
        <div style={{ fontSize:11, color:'#4a5568', lineHeight:1.4, wordBreak:'break-word' }}>{alert.msg}</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, flexShrink:0 }}>
        <span style={{ fontSize:10, color:'#94a3b8', fontFamily:"'DM Mono',monospace" }}>{alert.time}</span>
        <button onClick={() => onAck(alert.id)}
          style={{ fontSize:9, color:'#94a3b8', background:'rgba(0,0,0,0.04)',
            border:'1px solid #e2e8f0', borderRadius:4, padding:'1px 6px', cursor:'pointer', lineHeight:1.6 }}>
          확인
        </button>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
function D1AutomationPanel({ onBack }) {
  const today = new Date().toISOString().slice(0, 10);

  // 뷰 상태
  const [view, setView] = useState('auto'); // 'auto' | 'settings'

  // 숙소 설정 (localStorage)
  const [propConfigs, setPropConfigs] = useState(loadPropConfigs);

  // iCal 동기화 상태
  const [syncedBookings, setSyncedBookings] = useState([]);
  const [syncing,        setSyncing]        = useState(false);
  const [lastSyncTime,   setLastSyncTime]   = useState(null);
  const [syncError,      setSyncError]      = useState(null);

  // 자동화 실행 상태
  const [running,  setRunning]  = useState(false);
  const [results,  setResults]  = useState([]);
  const [alerts,   setAlerts]   = useState([]);
  const [failMode,   setFailMode]   = useState(false);
  const [haMode,     setHaMode]     = useState(false);
  const [lastRun,    setLastRun]    = useState(null);
  const [devOpen,    setDevOpen]    = useState(false);

  const countdown  = useCountdownTo1800();
  const ranAtZero  = useRef(false);

  // targets: 동기화 완료 시 실데이터, 아니면 목업
  const isRealData = syncedBookings.length > 0;
  const targets = React.useMemo(() => {
    if (isRealData) return _d1.filterTomorrowCheckIns(syncedBookings, today);
    return makeTomorrowBookings(today, propConfigs);
  }, [syncedBookings, today, propConfigs, isRealData]);

  // ── 설정 핸들러 ───────────────────────────────────────────
  const handleConfigChange = (idx, field, value) => {
    setPropConfigs(prev => {
      const next = [...prev];
      if (field.includes('.')) {
        const [p, c] = field.split('.');
        next[idx] = { ...next[idx], [p]: { ...next[idx][p], [c]: value } };
      } else {
        next[idx] = { ...next[idx], [field]: value };
      }
      return next;
    });
  };
  const handleAddProp = () => {
    setPropConfigs(prev => [...prev, {
      propId:`P-${String(prev.length+1).padStart(3,'0')}`,
      propName:'새 숙소', icalUrl:'',
      checkInTime:'15:00:00', checkOutTime:'11:00:00',
      wifi:{ ssid:'', pw:'' },
    }]);
  };
  const handleRemoveProp = idx => setPropConfigs(prev => prev.filter((_,i) => i!==idx));
  const handleSaveConfigs = () => {
    savePropConfigs(propConfigs);
    Toast.success('설정이 저장되었습니다');
    setView('auto');
  };

  // ── iCal 동기화 ───────────────────────────────────────────
  const handleSync = async () => {
    const withUrl = propConfigs.filter(c => c.icalUrl.trim());
    if (!withUrl.length) { Toast.warn('iCal URL을 먼저 설정하세요'); return; }
    setSyncing(true); setSyncError(null);
    const all = [], errs = [];
    for (const cfg of withUrl) {
      try {
        const text     = await _ical.fetchViaProxy(cfg.icalUrl.trim());
        const events   = _ical.parse(text);
        const bookings = _ical.toBookings(events, cfg);
        all.push(...bookings);
      } catch (err) {
        errs.push(`${cfg.propName}: ${err.message}`);
      }
    }
    setSyncing(false);
    setSyncedBookings(all);
    setLastSyncTime(_hhmm());
    if (errs.length) {
      setSyncError(errs.join('\n'));
      Toast.warn(`동기화 오류: ${errs.length}개 숙소`);
    } else {
      Toast.success(`동기화 완료 — 총 ${all.length}건 예약`);
    }
  };

  // ── D-1 자동화 실행 ────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true); setResults([]); setAlerts([]); setLastRun(null);
    const onAlert    = a  => setAlerts(prev => [{ id:Date.now()+Math.random(), ...a }, ...prev]);
    const onProgress = r  => setResults([...r]);
    const deps = haMode
      ? makeHAInfra(onAlert)
      : makeMockInfra(onAlert, failMode ? 'P-007' : null);
    try {
      await checkinPreparationService.runD1Automation(targets, today, deps, { onProgress });
      setLastRun(_hhmm());
    } finally { setRunning(false); }
  }, [running, haMode, failMode, targets, today]);

  // 18:00 자동 실행
  useEffect(() => {
    if (countdown.secs === 0 && !running && !ranAtZero.current) {
      ranAtZero.current = true; handleRun();
    }
    if (countdown.secs > 0) ranAtZero.current = false;
  }, [countdown.secs, running, handleRun]);

  const summary = React.useMemo(() => ({
    success: results.filter(r=>r.status==='success').length,
    partial: results.filter(r=>r.status==='partial').length,
    failed:  results.filter(r=>r.status==='failed').length,
  }), [results]);

  const ackAlert    = id  => setAlerts(prev => prev.filter(a => a.id !== id));
  const ackAllAlerts = () => setAlerts([]);

  const anyPin       = results.some(r => r.steps?.pin       === true);
  const anyMsg       = results.some(r => r.steps?.message   === true);
  const anySmartHome = results.some(r => r.steps?.smartHome === true);
  const pinRunning   = running && results.length > 0 && !anyPin;
  const msgRunning   = running && anyPin   && !anyMsg;
  const shRunning    = running && anyMsg   && !anySmartHome;

  function getStepSC(done, isRun, num) {
    if (done)  return { b:'#86efac', hBg:'#f0fdf4', cBg:'#16a34a', cFg:'#fff', tc:'#15803d', lbl:'✓' };
    if (isRun) return { b:'#93c5fd', hBg:'#eff6ff', cBg:'#2563eb', cFg:'#fff', tc:'#2563eb', lbl:'↻' };
    return          { b:'#e2e8f0', hBg:'#f8fafc', cBg:'#e2e8f0', cFg:'#64748b', tc:'#94a3b8', lbl:String(num) };
  }
  const sc1 = getStepSC(targets.length > 0, false, 1);
  const sc2 = getStepSC(anyPin,       pinRunning, 2);
  const sc3 = getStepSC(anyMsg,       msgRunning, 3);
  const sc4 = getStepSC(anySmartHome, shRunning,  4);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      fontFamily:"'DM Sans',sans-serif", background:'#f0f4f8', overflow:'hidden' }}>
      <style>{`@keyframes d1spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } } @keyframes d1pulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>

      {/* ── 헤더 ── */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0', padding:'16px 24px',
        display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 12px', fontSize:12, color:'#64748b', cursor:'pointer', fontWeight:600 }}>← 커맨드 센터</button>}
        {onBack && <div style={{ width:1, height:22, background:'#e2e8f0' }} />}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>S01 · D-1 자동화</div>
          <div style={{ fontWeight:800, fontSize:18, color:'#1e293b', lineHeight:1.2 }}>내일 체크인 준비</div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>PIN 발급, 웰컴 메시지, 스마트홈 준비를 한 번에 마무리합니다.</div>
        </div>
        <button onClick={handleSync} disabled={syncing || !propConfigs.some(c=>c.icalUrl)}
          style={{ padding:'7px 14px', borderRadius:8,
            background:(syncing||!propConfigs.some(c=>c.icalUrl))?'#f8fafc':'#f0fdf4',
            border:`1.5px solid ${(syncing||!propConfigs.some(c=>c.icalUrl))?'#e2e8f0':'#86efac'}`,
            color:(syncing||!propConfigs.some(c=>c.icalUrl))?'#94a3b8':'#059669',
            fontSize:12, fontWeight:600,
            cursor:(syncing||!propConfigs.some(c=>c.icalUrl))?'not-allowed':'pointer',
            display:'flex', alignItems:'center', gap:5 }}>
          {syncing ? <><span style={{ display:'inline-block', animation:'d1spin 1s linear infinite' }}>↻</span> 동기화 중</> : '🔄 iCal 동기화'}
        </button>
        <button onClick={() => setView(v => v==='settings'?'auto':'settings')}
          style={{ padding:'7px 14px', borderRadius:8,
            background: view==='settings' ? '#2563eb' : '#f8fafc',
            border:`1.5px solid ${view==='settings' ? '#1d4ed8' : '#e2e8f0'}`,
            color: view==='settings' ? '#fff' : '#64748b',
            fontSize:12, fontWeight:600, cursor:'pointer' }}>
          ⚙ 숙소 설정
        </button>
        {view === 'auto' && (
          <button onClick={handleRun} disabled={running}
            style={{ padding:'9px 20px', borderRadius:8,
              background: running ? '#e2e8f0' : '#2563eb',
              border:`2px solid ${running ? '#cbd5e1' : '#1d4ed8'}`,
              color: running ? '#94a3b8' : '#fff',
              fontSize:13, fontWeight:800, cursor: running?'not-allowed':'pointer',
              display:'flex', alignItems:'center', gap:8,
              boxShadow: running ? 'none' : '0 2px 8px rgba(37,99,235,0.4)' }}>
            {running ? <><span style={{ display:'inline-block', animation:'d1spin 1s linear infinite' }}>↻</span> 준비 중...</> : '▶ D-1 준비 다시 확인'}
          </button>
        )}
      </div>

      <BatchConsoleGuide stageId="d1" onBack={onBack} />

      {/* ── 바디 ── */}
      {view === 'settings' ? (
        <div style={{ flex:1, overflow:'auto' }}>
          <SettingsView
            propConfigs={propConfigs}
            onChange={handleConfigChange}
            onAdd={handleAddProp}
            onRemove={handleRemoveProp}
            onSave={handleSaveConfigs}
            syncing={syncing}
            onSync={handleSync}
            lastSyncTime={lastSyncTime}
            syncError={syncError}
          />
        </div>
      ) : (
        <div style={{ flex:1, display:'grid', gridTemplateColumns:'260px 1fr 340px', gap:20, padding:20, overflow:'hidden' }}>

          {/* ── 좌측 260px ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:16, overflow:'hidden' }}>

            {/* 숙소 현황 */}
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', flexShrink:0 }}>
              <div style={{ padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:3, height:13, background:'#059669', borderRadius:2, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1 }}>한 번에 볼 숙소</span>
                {isRealData && <span style={{ width:7, height:7, borderRadius:'50%', background:'#059669', animation:'d1pulse 2s ease-in-out infinite' }} />}
              </div>
              <div style={{ padding:'10px 14px' }}>
                {isRealData ? (
                  <div style={{ fontSize:12, fontWeight:600, color:'#059669', marginBottom:8 }}>
                    에어비앤비 {syncedBookings.length}건 연동됨
                  </div>
                ) : (
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                    <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>⚠ 예약 미연동 (목업)</span>
                  </div>
                )}
                {targets.length === 0 ? (
                  <div style={{ fontSize:11, color:'#94a3b8', padding:'6px 0' }}>내일 체크인 없음</div>
                ) : targets.map(t => (
                  <div key={t.propId} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', background:'#f8fafc', borderRadius:7, marginBottom:5, border:'1px solid #e2e8f0' }}>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#2563eb', fontWeight:700 }}>{t.propId}</span>
                    <span style={{ fontSize:12, color:'#1e293b', fontWeight:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.propName}</span>
                  </div>
                ))}
                {/* 카운트다운 */}
                <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:6, padding:'7px 10px', background:'#eff6ff', borderRadius:7, border:'1px solid #bfdbfe' }}>
                  <span style={{ fontSize:10, color:'#64748b' }}>다음 자동 실행</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color: countdown.secs<300?'#dc2626':countdown.secs<3600?'#d97706':'#2563eb' }}>⏱ {countdown.label}</span>
                </div>
              </div>
            </div>

            {/* 개발 옵션 */}
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', flexShrink:0 }}>
              <button onClick={() => setDevOpen(v => !v)} style={{ width:'100%', padding:'11px 16px', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:8, textAlign:'left' }}>
                <span style={{ width:3, height:13, background:'#7c3aed', borderRadius:2, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1 }}>개발 옵션</span>
                <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background:'#f5f3ff', border:'1px solid #c4b5fd', color:'#7c3aed' }}>테스트용</span>
                <span style={{ fontSize:10, color:'#94a3b8' }}>{devOpen ? '▲' : '▼'}</span>
              </button>
              {devOpen && (
                <div style={{ padding:'0 14px 14px', background:'#fefce8', borderTop:'1px solid #fef08a' }}>
                  <div style={{ marginTop:10, marginBottom:10 }}>
                    <div style={{ fontSize:10, color:'#78716c', fontWeight:600, marginBottom:6 }}>HA 연동 모드</div>
                    <button onClick={() => setHaMode(m => !m)} style={{ width:'100%', padding:'6px 8px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:haMode?'#f0fdf4':'#ffffff', border:`1.5px solid ${haMode?'#86efac':'#e2e8f0'}`, color:haMode?'#059669':'#64748b' }}>
                      {haMode ? '⚡ 실제 HA 연동' : '○ Mock 모드'}
                    </button>
                  </div>
                  {!haMode && (
                    <div>
                      <div style={{ fontSize:10, color:'#78716c', fontWeight:600, marginBottom:6 }}>오류 시뮬레이션</div>
                      <button onClick={() => setFailMode(f => !f)} style={{ width:'100%', padding:'6px 8px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:failMode?'#fee2e2':'#ffffff', border:`1.5px solid ${failMode?'#fca5a5':'#e2e8f0'}`, color:failMode?'#dc2626':'#64748b' }}>
                        {failMode ? '✕ 에러 시뮬 ON' : '○ 정상 동작'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 실행 결과 요약 (실행 후) */}
            {results.length > 0 && (
              <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'14px', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, paddingBottom:8, borderBottom:'1.5px solid #e2e8f0' }}>
                  <span style={{ width:3, height:13, background:'#0ea5e9', borderRadius:2, flexShrink:0 }} />
                  <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>실행 결과</span>
                  {lastRun && <span style={{ marginLeft:'auto', fontSize:10, color:'#94a3b8', fontFamily:"'DM Mono',monospace" }}>{lastRun}</span>}
                </div>
                {[
                  { label:'총 대상', val:targets.length, c:'#94a3b8', bg:'#f8fafc', b:'#e2e8f0' },
                  { label:'완료',    val:summary.success,  c:'#059669', bg:'#f0fdf4', b:'#86efac' },
                  { label:'부분완료',val:summary.partial,  c:'#d97706', bg:'#fffbeb', b:'#fde68a' },
                  { label:'실패',    val:summary.failed,   c:'#dc2626', bg:'#fef2f2', b:'#fca5a5' },
                ].map(({ label, val, c, bg, b }) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:bg, borderRadius:6, border:`1px solid ${b}`, marginBottom:5 }}>
                    <span style={{ fontSize:12, color:c, fontWeight:600 }}>{label}</span>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:16, fontWeight:800, color:c }}>{val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 중앙 flex:1 ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:16, overflow:'hidden' }}>

            {/* 자동화 흐름 */}
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', flexShrink:0 }}>
              <div style={{ padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:3, height:13, background:'#2563eb', borderRadius:2, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>처리 흐름</span>
              </div>
              <div style={{ padding:'16px', display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { sc:sc1, title:'숙소 확인', desc:`내일 체크인 대상 ${targets.length}개 숙소 필터링`, tag:'확인' },
                  { sc:sc2, title:'PIN 발급',  desc:'6자리 도어락 PIN 생성 · HA 등록 · 유효기간 설정',   tag:'보안' },
                  { sc:sc3, title:'웰컴 메시지', desc:'게스트에게 입실 안내 + WiFi 정보 자동 발송',      tag:'메시지' },
                  { sc:sc4, title:'스마트홈 초기화', desc:'체크인 준비 씬 실행 · 조명 · 에어컨 설정',    tag:'IoT' },
                ].map(({ sc, title, desc, tag }, idx) => (
                  <div key={idx} style={{ display:'flex', gap:12, alignItems:'flex-start', padding:'12px 14px', borderRadius:10, background:sc.hBg, border:`2px solid ${sc.b}`, transition:'all 0.3s' }}>
                    <div style={{ width:22, height:22, borderRadius:'50%', background:sc.cBg, color:sc.cFg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, flexShrink:0, animation:sc.lbl==='↻'?'d1spin 1s linear infinite':'none' }}>{sc.lbl}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:sc.tc, marginBottom:2 }}>{title}</div>
                      <div style={{ fontSize:11, color:'#64748b' }}>{desc}</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:4, background:sc.cBg, color:sc.cFg, flexShrink:0 }}>{tag}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 처리 결과 */}
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', flex:1, display:'flex', flexDirection:'column' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                <span style={{ width:3, height:13, background:'#0ea5e9', borderRadius:2, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>숙소별 처리 결과</span>
              </div>
              <div style={{ flex:1, overflow:'auto', padding:'10px 14px' }}>
                {results.length === 0 && !running ? (
                  <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8', fontSize:12 }}>
                    <div style={{ fontSize:32, marginBottom:10, opacity:0.4 }}>🏠</div>
                    D-1 준비를 다시 확인하면<br/>숙소별 처리 결과가 표시됩니다.
                    {!isRealData && <div style={{ fontSize:11, color:'#d97706', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'6px 10px', marginTop:12 }}>⚠ 목업 데이터 사용 중</div>}
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:10 }}>
                    {results.map(r => <PropResultCard key={r.propId} result={r} />)}
                    {running && targets.slice(results.length).map(t => (
                      <div key={t.propId} style={{ background:'#f8fafc', border:'1.5px solid #e2e8f0', borderRadius:10, padding:'14px 16px', opacity:0.5 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#94a3b8', marginBottom:4 }}>{t.propName}</div>
                        <div style={{ fontSize:11, color:'#94a3b8' }}>{t.guestName}</div>
                        <div style={{ display:'flex', gap:5, marginTop:8, flexWrap:'wrap' }}>
                          <StepChip label="PIN 발급" state={null}/><StepChip label="메시지" state={null}/><StepChip label="스마트홈" state={null}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 우측 340px ── */}
          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <span style={{ width:3, height:13, background:'#d97706', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1 }}>실시간 알림</span>
              {alerts.length > 0 && <span style={{ background:'#dc2626', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{alerts.length}</span>}
              {alerts.length > 0 && <button onClick={ackAllAlerts} style={{ padding:'3px 9px', borderRadius:5, background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b', fontSize:10, cursor:'pointer', fontWeight:600 }}>전체 확인</button>}
            </div>
            <div style={{ flex:1, overflow:'auto', padding:'10px 12px' }}>
              {alerts.length === 0
                ? <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8', fontSize:12 }}><div style={{ fontSize:32, marginBottom:10, opacity:0.4 }}>🔔</div>지금 바로 확인할 알림은 없어요.</div>
                : alerts.map(a => <D1AlertItem key={a.id} alert={a} onAck={ackAlert} />)
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default D1AutomationPanel;
