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
  const BASE  = 'http://192.168.45.76:8123';
  const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw';
  const TV_LIGHT = 'light.rgbcct_8002';
  const TV_PLUG  = 'switch.tv_smart_plug_socket_1';
  async function post(path, data) {
    const res = await fetch(`${BASE}${path}`, {
      method:'POST',
      headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify(data),
    });
    if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(`HA ${res.status}: ${t}`); }
    return res.json().catch(()=>({}));
  }
  async function setLockCode(entityId, code, name) {
    await post('/api/services/persistent_notification/create', {
      title:'[PROPOS] PIN 발급 완료',
      message:`게스트: ${name}\nPIN: ${code}\n등록 대상: ${entityId}`,
      notification_id:`propos_pin_${entityId.replace(/\W/g,'_')}`,
    });
  }
  async function activateScene(entityId) {
    if (entityId.includes('checkin_ready')) {
      await post('/api/services/light/turn_on', { entity_id:TV_LIGHT, brightness:255 });
      await post('/api/services/switch/turn_on', { entity_id:TV_PLUG });
      return;
    }
    await post('/api/services/scene/turn_on', { entity_id:entityId });
  }
  async function sendMessage(guestId, text) {
    await post('/api/services/persistent_notification/create', {
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

// ── Application Logic ─────────────────────────────────────────
async function runD1Automation(targets, deps, onProgress) {
  const results = [];
  for (const booking of targets) {
    const result = {
      propId:booking.propId, propName:booking.propName, guestName:booking.guestName,
      status:'running', steps:{pin:null, message:null, smartHome:null},
      pin:null, expiry:null, welcomeMsg:null, sceneId:null, error:null,
    };
    onProgress([...results, result]);

    const pin    = _d1.generatePIN();
    const expiry = _d1.calcExpiry(booking.checkIn, booking.checkOut);
    result.pin = pin; result.expiry = expiry;

    try {
      const eid = `lock.front_door_${booking.propId.toLowerCase().replace('-','_')}`;
      await deps.setLockCode(eid, pin, `guest_${booking.guestName}`);
      result.steps.pin = true;
    } catch (err) {
      result.steps.pin = false; result.status = 'failed'; result.error = err.message;
      deps.addAlert({ type:'error', prop:booking.propName, msg:`PIN 등록 실패 — ${err.message}`, time:_hhmm() });
      results.push(result); onProgress([...results]); continue;
    }

    try {
      const text = _d1.buildWelcomeMessage(booking, { pin, ...expiry });
      result.welcomeMsg = text;
      await deps.sendMessage(booking.guestId, text);
      result.steps.message = true;
    } catch (err) {
      result.steps.message = false; result.status = 'partial'; result.error = err.message;
      deps.addAlert({ type:'warn', prop:booking.propName, msg:`메시지 발송 실패 — ${err.message}`, time:_hhmm() });
    }

    try {
      const sid = `scene.checkin_ready_${booking.propId.toLowerCase().replace('-','_')}`;
      result.sceneId = sid;
      await deps.activateScene(sid);
      result.steps.smartHome = true;
    } catch (err) {
      result.steps.smartHome = false;
      if (result.status === 'running') result.status = 'partial';
      result.error = err.message;
      deps.addAlert({ type:'warn', prop:booking.propName, msg:`스마트홈 초기화 실패 — ${err.message}`, time:_hhmm() });
    }

    if (result.status === 'running') {
      result.status = 'success';
      deps.addAlert({ type:'info', prop:booking.propName, msg:`D-1 자동화 완료 (PIN ${pin} · 메시지 · 스마트홈)`, time:_hhmm() });
    }
    results.push(result); onProgress([...results]);
  }
  return results;
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
  const [failMode, setFailMode] = useState(false);
  const [haMode,   setHaMode]   = useState(false);
  const [lastRun,  setLastRun]  = useState(null);

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
      await runD1Automation(targets, deps, onProgress);
      setLastRun(_hhmm());
    } finally { setRunning(false); }
  }, [running, haMode, failMode, targets]);

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

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      fontFamily:"'DM Sans',sans-serif", background:'var(--bg)', overflow:'hidden' }}>

      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)',
        flexShrink:0, boxShadow:'var(--shadow)' }}>

        {/* ① 제목 행 — 이 페이지가 무엇인지 */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px',
          borderBottom:'1px solid var(--border)' }}>
          {onBack && <button className="back-btn" onClick={onBack}>← 뒤로</button>}
          <div style={{ width:1, height:28, background:'var(--border)' }} />
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'var(--text)', lineHeight:1.2, letterSpacing:'-0.3px' }}>
              D-1 체크인 전날 자동화
            </div>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:3 }}>
              체크인 하루 전 — PIN 자동 발급 · 웰컴 메시지 발송 · 스마트홈 초기화
            </div>
          </div>
          {/* 우측: 보조 액션 버튼들 */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={handleSync} disabled={syncing || !propConfigs.some(c=>c.icalUrl)}
              style={{ padding:'6px 14px', borderRadius:7,
                background: (syncing||!propConfigs.some(c=>c.icalUrl)) ? 'var(--surface2)' : '#ecfdf5',
                border:`1.5px solid ${(syncing||!propConfigs.some(c=>c.icalUrl)) ? 'var(--border)' : '#a7f3d0'}`,
                color: (syncing||!propConfigs.some(c=>c.icalUrl)) ? 'var(--text4)' : '#059669',
                fontSize:12, fontWeight:600,
                cursor:(syncing||!propConfigs.some(c=>c.icalUrl))?'not-allowed':'pointer',
                display:'flex', alignItems:'center', gap:5 }}>
              {syncing ? <><span style={{ display:'inline-block', animation:'d1spin 1s linear infinite' }}>↻</span> 동기화 중</> : '🔄 iCal 동기화'}
            </button>
            <button onClick={() => setView(v => v==='settings'?'auto':'settings')}
              style={{ padding:'6px 14px', borderRadius:7,
                background: view==='settings' ? 'var(--blue)' : 'var(--surface2)',
                border:`1.5px solid ${view==='settings' ? '#1d4ed8' : 'var(--border)'}`,
                color: view==='settings' ? '#fff' : 'var(--text2)',
                fontSize:12, fontWeight:600, cursor:'pointer' }}>
              ⚙ 숙소 설정
            </button>
          </div>
        </div>

        {/* ② 현재 상태 행 — 데이터 소스 + 다음 실행 카운트다운 */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'10px 20px',
          borderBottom:'1px solid var(--border)', background:'var(--bg)' }}>
          {/* 데이터 소스 */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--text3)', fontWeight:500 }}>데이터 소스</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
              background: isRealData ? '#ecfdf5' : '#f1f5f9',
              color: isRealData ? '#059669' : '#94a3b8',
              border: `1.5px solid ${isRealData ? '#a7f3d0' : '#e2e8f0'}` }}>
              {isRealData ? `● 실데이터 ${syncedBookings.length}건` : '○ 목업 데이터'}
            </span>
          </div>
          <div style={{ width:1, height:16, background:'var(--border)' }} />
          {/* 다음 실행 카운트다운 */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--text3)', fontWeight:500 }}>다음 자동 실행</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700,
              color: countdown.secs<300?'var(--red)':countdown.secs<3600?'var(--yellow)':'var(--green)',
              background: countdown.secs<300?'var(--red-l)':countdown.secs<3600?'var(--yellow-l)':'var(--green-l)',
              border: `1.5px solid ${countdown.secs<300?'var(--red-m)':countdown.secs<3600?'var(--yellow-m)':'var(--green-m)'}`,
              borderRadius:6, padding:'2px 10px' }}>
              ⏱ {countdown.label}
            </span>
            <span style={{ fontSize:11, color:'var(--text4)' }}>매일 오후 6:00 (UC-001)</span>
          </div>
          {/* HA / 오류 토글 — 우측으로 */}
          {view === 'auto' && (
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:12 }}>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11,
                color:haMode?'#059669':'var(--text3)', cursor:'pointer', userSelect:'none',
                background: haMode ? '#ecfdf5' : 'var(--surface)',
                border: `1.5px solid ${haMode ? '#a7f3d0' : 'var(--border)'}`,
                borderRadius:7, padding:'4px 10px' }}>
                <button className={`tog ${haMode?'on':''}`} onClick={()=>setHaMode(m=>!m)}
                  style={{ background:haMode?'var(--green)':undefined }}><div className="tog-d"/></button>
                <span style={{ fontWeight:600 }}>{haMode ? '● HA 연결됨' : '○ Mock 모드'}</span>
              </label>
              {!haMode && (
                <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11,
                  color:failMode?'var(--red)':'var(--text3)', cursor:'pointer', userSelect:'none',
                  background: failMode ? 'var(--red-l)' : 'var(--surface)',
                  border: `1.5px solid ${failMode ? 'var(--red-m)' : 'var(--border)'}`,
                  borderRadius:7, padding:'4px 10px' }}>
                  <button className={`tog ${failMode?'on':''}`} onClick={()=>setFailMode(f=>!f)}
                    style={{ background:failMode?'var(--red)':undefined }}><div className="tog-d"/></button>
                  <span style={{ fontWeight:600 }}>오류 시뮬</span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* ③ 실행 결과 요약 + ④ 실행 버튼 — 항상 표시 */}
        {view === 'auto' && (
          <div style={{ display:'flex', alignItems:'center', gap:20, padding:'12px 20px' }}>
            {/* 결과 요약 카드들 */}
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
                {results.length > 0
                  ? `실행 결과 요약${lastRun ? ` — 마지막 실행 ${lastRun}` : ''}`
                  : `처리 대상 — 내일 체크인 ${targets.length}개 숙소`}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {results.length > 0 ? [
                  { label:'총 대상',   val:targets.length,   accent:'#94a3b8', bg:'#f8fafc',  border:'#e2e8f0' },
                  { label:'완료',     val:summary.success,  accent:'#059669', bg:'#ecfdf5',  border:'#a7f3d0' },
                  { label:'부분 완료', val:summary.partial,  accent:'#d97706', bg:'#fffbeb',  border:'#fde68a' },
                  { label:'실패',     val:summary.failed,   accent:'#dc2626', bg:'#fef2f2',  border:'#fecaca' },
                ].map(({ label, val, accent, bg, border }) => (
                  <div key={label} style={{ display:'flex', alignItems:'center', gap:10,
                    background:bg, border:`1.5px solid ${border}`, borderRadius:8,
                    padding:'8px 14px', borderLeft:`4px solid ${accent}` }}>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:20, fontWeight:800, color:accent, lineHeight:1 }}>{val}</span>
                    <span style={{ fontSize:11, color:accent, fontWeight:600, lineHeight:1.3 }}>{label}</span>
                  </div>
                )) : (
                  /* 아직 실행 전 — 대상 숙소 미리보기 */
                  targets.length === 0 ? (
                    <div style={{ fontSize:12, color:'var(--text4)', padding:'6px 0' }}>내일 체크인 예정 숙소 없음</div>
                  ) : targets.map(t => (
                    <div key={t.propId} style={{ display:'flex', alignItems:'center', gap:6,
                      background:'var(--surface)', border:'1.5px solid var(--border)', borderRadius:8,
                      padding:'6px 12px', borderLeft:'4px solid var(--blue)' }}>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'var(--blue)', fontWeight:700 }}>{t.propId}</span>
                      <span style={{ fontSize:12, color:'var(--text)', fontWeight:500 }}>{t.propName}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ④ 주요 액션 버튼 — 명확하게 우측 */}
            <button onClick={handleRun} disabled={running}
              style={{ padding:'12px 28px', borderRadius:9,
                background: running ? 'var(--surface2)' : 'var(--blue)',
                border: `2px solid ${running ? 'var(--border)' : '#1d4ed8'}`,
                color: running ? 'var(--text4)' : '#fff',
                fontSize:14, fontWeight:800,
                cursor: running ? 'not-allowed' : 'pointer',
                fontFamily:"'DM Sans',sans-serif", transition:'all 0.15s',
                display:'flex', alignItems:'center', gap:8,
                boxShadow: running ? 'none' : '0 2px 8px rgba(37,99,235,0.35)',
                flexShrink:0 }}>
              {running
                ? <><span style={{ display:'inline-block', animation:'d1spin 1s linear infinite' }}>↻</span> 처리 중...</>
                : <><span style={{ fontSize:16 }}>▶</span> D-1 자동화 실행</>}
            </button>
          </div>
        )}
      </div>

      {/* ── 바디 ─────────────────────────────────────────── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* 왼쪽: 자동화 뷰 or 설정 뷰 */}
        {view === 'settings' ? (
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
        ) : (
          <div style={{ flex:1, overflow:'auto', padding:16 }}>
            {/* 대기 화면 */}
            {results.length === 0 && !running && (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                justifyContent:'center', height:'100%', gap:12, color:'var(--text4)', textAlign:'center' }}>
                <div style={{ fontSize:40 }}>🏠</div>
                <div style={{ fontSize:15, fontWeight:600, color:'var(--text3)' }}>D-1 자동화 대기 중</div>
                <div style={{ fontSize:12, lineHeight:1.8 }}>
                  {`내일 체크인 대상: ${targets.length}개 숙소`}<br/>
                  {targets.map(t=>t.propName).join(' · ')}
                </div>
                {!isRealData && (
                  <div style={{ fontSize:11, color:'#d97706', background:'#fffbeb',
                    border:'1px solid #fde68a', borderRadius:6, padding:'6px 12px',
                    display:'flex', alignItems:'center', gap:6 }}>
                    ⚠ 목업 데이터 사용 중 —
                    <button onClick={()=>setView('settings')}
                      style={{ color:'var(--blue)', background:'none', border:'none',
                        cursor:'pointer', fontWeight:700, fontSize:11, padding:0 }}>
                      ⚙ iCal 설정
                    </button>
                    후 동기화하면 실데이터를 사용합니다
                  </div>
                )}
                <div style={{ fontSize:12, color:'var(--text3)', fontFamily:"'DM Mono',monospace",
                  background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:8, padding:'8px 16px' }}>
                  자동 실행까지 <span style={{ color:'var(--blue)', fontWeight:700 }}>{countdown.label}</span>
                </div>
                <button onClick={handleRun}
                  style={{ marginTop:4, padding:'9px 22px', borderRadius:7, background:'var(--blue)',
                    border:'1.5px solid #1d4ed8', color:'#fff', fontSize:13, fontWeight:700,
                    cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
                  ▶ 지금 실행
                </button>
              </div>
            )}

            {/* 결과 카드 */}
            {results.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))', gap:10 }}>
                {results.map(r => <PropResultCard key={r.propId} result={r} />)}
                {running && targets.slice(results.length).map(t => (
                  <div key={t.propId} style={{ background:'var(--surface)', border:'1.5px solid var(--border)',
                    borderRadius:10, padding:'14px 16px', opacity:0.5 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:4 }}>{t.propName}</div>
                    <div style={{ fontSize:11, color:'var(--text4)' }}>{t.guestName}</div>
                    <div style={{ display:'flex', gap:5, marginTop:8, flexWrap:'wrap' }}>
                      <StepChip label="PIN 발급" state={null}/>
                      <StepChip label="메시지"   state={null}/>
                      <StepChip label="스마트홈" state={null}/>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 오른쪽: 알림 피드 */}
        <div style={{ width:280, flexShrink:0, background:'var(--surface2)',
          borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)',
            background:'var(--surface)', flexShrink:0,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>자동화 알림</span>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {alerts.length > 0 && (
                <button onClick={ackAllAlerts}
                  style={{ fontSize:10, color:'var(--text3)', background:'var(--surface2)',
                    border:'1px solid var(--border)', borderRadius:4, padding:'2px 8px',
                    cursor:'pointer', fontWeight:600 }}>
                  전체 확인
                </button>
              )}
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11,
                background:'var(--blue-l)', color:'var(--blue)',
                borderRadius:20, padding:'2px 8px', fontWeight:700 }}>
                {alerts.length}
              </span>
            </div>
          </div>
          <div style={{ flex:1, overflow:'auto', padding:'8px 10px' }}>
            {alerts.length === 0
              ? <div style={{ textAlign:'center', color:'var(--text4)', fontSize:12, marginTop:32 }}>실행 후 알림이 표시됩니다</div>
              : alerts.map(a => <D1AlertItem key={a.id} alert={a} onAck={ackAlert} />)
            }
          </div>
        </div>
      </div>

      <style>{`@keyframes d1spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
    </div>
  );
}
