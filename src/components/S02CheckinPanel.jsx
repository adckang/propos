// ============================================================
// S02CheckinPanel.jsx — UC-002 체크인 당일 자동화 UI
// 시나리오: 입실 감지 → IoT 씬 실행 → 게스트 채팅 오픈 → 상태 갱신
// ============================================================

// ── 도메인 함수 (인라인) ─────────────────────────────────────
const _s02 = (() => {
  function getCheckinWindow(checkIn) {
    const m = String(checkIn).match(/T(\d{2}):(\d{2})/);
    if (!m) return { from: '14:00', until: '20:00' };
    const totalMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const pad = n => String(Math.floor(n / 60)).padStart(2,'0') + ':' + String(n % 60).padStart(2,'0');
    return { from: pad(Math.max(0, totalMins - 60)), until: pad(Math.min(23*60+59, totalMins + 5*60)) };
  }

  function isCheckinEvent(haEvent, booking, now) {
    if (haEvent.context !== 'guest_checkin') return false;
    if (booking.status !== 'confirmed')      return false;
    const w = getCheckinWindow(booking.checkIn);
    return now >= w.from && now <= w.until;
  }

  function buildCheckinConfirmMessage(booking, actualTime) {
    const lines = [
      `${booking.guestName}님, 입실이 확인되었습니다.`,
      `입실 시각: ${actualTime}`,
    ];
    if (booking.checkOut) lines.push(`체크아웃: ${booking.checkOut.slice(0,10)}`);
    lines.push('', '편안한 여행 되세요!', '불편하신 점은 채팅으로 알려주세요.');
    return lines.join('\n');
  }

  function buildPinLockoutAlert(propId, failCount) {
    return `PIN 오류 ${failCount}회 초과 — 도어락 잠금\n게스트 확인 필요 (${propId})`;
  }

  function hhmm() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  return { getCheckinWindow, isCheckinEvent, buildCheckinConfirmMessage, buildPinLockoutAlert, hhmm };
})();

// ── Mock Infrastructure ──────────────────────────────────────
function makeMockInfra(onAlert, onUpdateStatus, sceneFail, channelFail) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  return {
    activateScene: async (entityId) => {
      await delay(400 + Math.random() * 200);
      if (sceneFail) throw new Error('HA 503 — 씬 응답 없음');
    },
    openChannel: async (booking) => {
      await delay(250 + Math.random() * 150);
      if (channelFail) throw new Error('메시지 서비스 연결 오류');
    },
    sendMessage: async (guestId, text) => {
      await delay(200 + Math.random() * 100);
    },
    updateStatus: (propId, status) => {
      onUpdateStatus(propId, status);
    },
    addAlert: onAlert,
  };
}

// ── Real HA Infrastructure ───────────────────────────────────
const _haS02 = (() => {
  const BASE  = 'http://192.168.45.76:8123';
  const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw';
  async function post(path, data) {
    const res = await fetch(`${BASE}${path}`, {
      method:'POST',
      headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify(data),
    });
    if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(`HA ${res.status}: ${t}`); }
    return res.json().catch(()=>({}));
  }
  async function activateScene(entityId) {
    await post('/api/services/persistent_notification/create', {
      title:'[PROPOS S02] 체크인 씬 실행',
      message:`씬: ${entityId}\n시각: ${_s02.hhmm()}`,
      notification_id:`propos_s02_scene_${entityId.replace(/\W/g,'_')}`,
    });
  }
  async function openChannel(booking) {
    await post('/api/services/persistent_notification/create', {
      title:`[PROPOS S02] 채팅 채널 오픈 — ${booking.guestName}`,
      message:`숙소: ${booking.propId}\n체크인: ${booking.checkIn?.slice(0,16).replace('T',' ')}`,
      notification_id:`propos_s02_ch_${booking.propId}`,
    });
  }
  async function sendMessage(guestId, text) {
    await post('/api/services/persistent_notification/create', {
      title:`[PROPOS S02] 입실 확인 메시지 — ${guestId}`,
      message:text,
      notification_id:`propos_s02_msg_${guestId}`,
    });
  }
  return { activateScene, openChannel, sendMessage };
})();

// ── Application (오케스트레이터) ─────────────────────────────
async function runCheckinAutomation(haEvent, bookings, deps, now, onStepUpdate) {
  const booking = bookings.find(b => b.propId === haEvent.propId);
  if (!booking) return null;

  const currentTime = now || _s02.hhmm();
  if (!_s02.isCheckinEvent(haEvent, booking, currentTime)) return null;

  const result = {
    propId: booking.propId,
    propName: booking.propName,
    guestName: booking.guestName,
    time: haEvent.time,
    status: 'running',
    steps: { scene: null, channel: null, message: null },
    error: null,
  };
  onStepUpdate({ ...result });

  // Step 1: 체크인 웰컴 씬 실행
  try {
    const sceneId = `scene.checkin_welcome_${booking.propId.toLowerCase().replace('-','_')}`;
    await deps.activateScene(sceneId);
    result.steps.scene = true;
  } catch (err) {
    result.steps.scene = false;
    result.status = 'failed';
    result.error = `씬 실행 실패: ${err.message}`;
    deps.addAlert({ type:'error', prop:booking.propId, msg:result.error, time:haEvent.time });
    onStepUpdate({ ...result });
    return result;
  }
  onStepUpdate({ ...result });

  const confirmText = _s02.buildCheckinConfirmMessage(booking, haEvent.time || _s02.hhmm());

  // Step 2: 게스트 채팅 채널 오픈
  try {
    await deps.openChannel(booking);
    result.steps.channel = true;
  } catch (err) {
    result.steps.channel = false;
    result.status = 'partial';
    result.error = `채팅 채널 오픈 실패: ${err.message}`;
    deps.addAlert({ type:'warn', prop:booking.propId, msg:result.error, time:haEvent.time });
  }
  onStepUpdate({ ...result });

  // Step 3: 입실 확인 메시지 발송
  try {
    await deps.sendMessage(booking.guestId, confirmText);
    result.steps.message = true;
  } catch (err) {
    result.steps.message = false;
    if (result.status === 'running') result.status = 'partial';
    result.error = `메시지 발송 실패: ${err.message}`;
    deps.addAlert({ type:'warn', prop:booking.propId, msg:result.error, time:haEvent.time });
  }
  onStepUpdate({ ...result });

  // Step 4: 상태 갱신 + 완료 알림
  deps.updateStatus(booking.propId, 'occupied');

  if (result.status === 'running') {
    result.status = 'success';
    deps.addAlert({
      type: 'info',
      prop: booking.propId,
      msg: `입실 감지 — ${booking.guestName}님 체크인 완료 (${haEvent.time})`,
      time: haEvent.time,
    });
  }

  onStepUpdate({ ...result });
  return result;
}

// ── 기본 숙소 데이터 ─────────────────────────────────────────
const DEFAULT_S02_BOOKINGS = [
  { propId:'P-042', propName:'해운대 오션뷰 펜트하우스', guestName:'김민준',  guestId:'guest_001', checkIn:'2026-03-31T15:00:00', checkOut:'2026-04-02T11:00:00', status:'confirmed' },
  { propId:'P-007', propName:'강남 럭셔리 스위트',       guestName:'이수진',  guestId:'guest_002', checkIn:'2026-03-31T14:00:00', checkOut:'2026-04-01T11:00:00', status:'confirmed' },
  { propId:'P-015', propName:'제주 한옥 스테이',         guestName:'Sarah M.', guestId:'guest_003', checkIn:'2026-03-31T16:00:00', checkOut:'2026-04-03T11:00:00', status:'confirmed' },
  { propId:'P-031', propName:'마포 모던 스튜디오',       guestName:'田中花子', guestId:'guest_004', checkIn:'2026-03-31T15:00:00', checkOut:'2026-04-02T11:00:00', status:'confirmed' },
];

// ── 컬러 상수 ─────────────────────────────────────────────────
const STATUS_COLOR = {
  occupied:    { bg:'#dcfce7', border:'#86efac', text:'#166534', label:'입실 완료' },
  vacant:      { bg:'#f1f5f9', border:'#cbd5e1', text:'#64748b', label:'공실' },
  checking_in: { bg:'#dbeafe', border:'#93c5fd', text:'#1d4ed8', label:'입실 중...' },
};

const STEP_COLOR = {
  true:    { bg:'#dcfce7', border:'#86efac', icon:'✓', text:'#166534' },
  false:   { bg:'#fee2e2', border:'#fca5a5', icon:'✕', text:'#dc2626' },
  null:    { bg:'#f1f5f9', border:'#e2e8f0', icon:'·', text:'#94a3b8' },
  running: { bg:'#dbeafe', border:'#93c5fd', icon:'↻', text:'#2563eb' },
};

// ── StepBadge ────────────────────────────────────────────────
function StepBadge({ label, state }) {
  const c = state === 'running' ? STEP_COLOR.running
          : STEP_COLOR[String(state)] || STEP_COLOR.null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4,
      background:c.bg, border:`1px solid ${c.border}`, borderRadius:6,
      padding:'3px 8px', fontSize:11 }}>
      <span style={{ color:c.text, fontWeight:700,
        display:'inline-block',
        animation: state === 'running' ? 's02spin 1s linear infinite' : 'none' }}>
        {c.icon}
      </span>
      <span style={{ color:c.text }}>{label}</span>
    </div>
  );
}

// ── EventResultCard ───────────────────────────────────────────
function EventResultCard({ result }) {
  const statusStyle = result.status === 'success'
    ? { bg:'#dcfce7', border:'#86efac', text:'#166534' }
    : result.status === 'failed'
    ? { bg:'#fee2e2', border:'#fca5a5', text:'#dc2626' }
    : result.status === 'partial'
    ? { bg:'#fffbeb', border:'#fde68a', text:'#92400e' }
    : { bg:'#dbeafe', border:'#93c5fd', text:'#1d4ed8' };

  return (
    <div style={{ background:statusStyle.bg, border:`1.5px solid ${statusStyle.border}`,
      borderRadius:8, padding:'10px 12px', marginBottom:8 }}>

      {/* 헤더 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700,
            color:'var(--text)', background:'var(--surface)',
            border:'1px solid var(--border)', borderRadius:4, padding:'1px 6px' }}>
            {result.propId}
          </span>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{result.propName}</span>
          <span style={{ fontSize:12, color:'var(--text2)' }}>— {result.guestName}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'var(--text3)' }}>{result.time}</span>
          <span style={{ fontSize:11, fontWeight:700, color:statusStyle.text,
            background:'var(--surface)', border:`1px solid ${statusStyle.border}`,
            borderRadius:4, padding:'1px 7px' }}>
            {result.status === 'success' ? '완료' : result.status === 'failed' ? '실패' : result.status === 'partial' ? '부분 완료' : '처리 중...'}
          </span>
        </div>
      </div>

      {/* 단계 뱃지 */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <StepBadge label="① 씬 실행"     state={result.status === 'running' && result.steps.scene === null ? 'running' : result.steps.scene} />
        <StepBadge label="② 채팅 오픈"   state={result.status === 'running' && result.steps.scene === true && result.steps.channel === null ? 'running' : result.steps.channel} />
        <StepBadge label="③ 메시지 발송" state={result.status === 'running' && result.steps.channel === true && result.steps.message === null ? 'running' : result.steps.message} />
      </div>

      {/* 에러 메시지 */}
      {result.error && (
        <div style={{ marginTop:8, fontSize:11, color:'#b91c1c',
          background:'#fff1f2', border:'1px solid #fca5a5', borderRadius:4, padding:'4px 8px',
          fontFamily:"'DM Mono',monospace" }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

// ── PropStatusCard ────────────────────────────────────────────
function PropStatusCard({ booking, status }) {
  const s = STATUS_COLOR[status] || STATUS_COLOR.vacant;
  const w = _s02.getCheckinWindow(booking.checkIn);
  return (
    <div style={{ background:'var(--surface)', border:`1.5px solid ${s.border}`,
      borderRadius:8, padding:'10px 12px', marginBottom:6,
      transition:'border-color 0.3s, background 0.3s' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700,
              color:'var(--text3)', background:'var(--bg)', border:'1px solid var(--border)',
              borderRadius:4, padding:'1px 5px' }}>
              {booking.propId}
            </span>
            <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{booking.propName}</span>
          </div>
          <div style={{ fontSize:11, color:'var(--text2)' }}>
            {booking.guestName} · 체크인 {booking.checkIn?.slice(11,16)}
          </div>
          <div style={{ fontSize:10, color:'var(--text3)', marginTop:2,
            fontFamily:"'DM Mono',monospace" }}>
            가능 시간: {w.from} ~ {w.until}
          </div>
        </div>
        <span style={{ fontSize:11, fontWeight:700, color:s.text,
          background:s.bg, border:`1px solid ${s.border}`,
          borderRadius:4, padding:'2px 8px', whiteSpace:'nowrap', flexShrink:0 }}>
          {s.label}
        </span>
      </div>
    </div>
  );
}

// ── AlertItem ─────────────────────────────────────────────────
function AlertItem({ alert, onAck }) {
  const COLOR = {
    info:  { bg:'#f0fdf4', border:'#86efac', icon:'✓', text:'#166534', iconBg:'#dcfce7' },
    warn:  { bg:'#fffbeb', border:'#fde68a', icon:'⚠', text:'#92400e', iconBg:'#fef3c7' },
    error: { bg:'#fff1f2', border:'#fca5a5', icon:'✕', text:'#b91c1c', iconBg:'#fee2e2' },
  };
  const c = COLOR[alert.type] || COLOR.info;
  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'8px 10px',
      background:c.bg, border:`1px solid ${c.border}`, borderRadius:6, marginBottom:5 }}>
      <span style={{ width:20, height:20, borderRadius:'50%', background:c.iconBg,
        border:`1px solid ${c.border}`, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:11, color:c.text, fontWeight:700, flexShrink:0 }}>
        {c.icon}
      </span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ fontSize:11, fontWeight:600, color:c.text }}>{alert.prop}</span>
          <span style={{ fontSize:10, color:'var(--text3)', fontFamily:"'DM Mono',monospace", flexShrink:0, marginLeft:6 }}>{alert.time}</span>
        </div>
        <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.4, whiteSpace:'pre-line' }}>{alert.msg}</div>
      </div>
      <button onClick={() => onAck(alert.id)}
        style={{ flexShrink:0, padding:'2px 7px', borderRadius:4, border:`1px solid ${c.border}`,
          background:'var(--surface)', color:c.text, fontSize:10, cursor:'pointer' }}>
        확인
      </button>
    </div>
  );
}

// ── WebSocket Status Indicator ────────────────────────────────
function WsStatusBadge({ status }) {
  const MAP = {
    connected:    { color:'#059669', bg:'#dcfce7', border:'#86efac', label:'WebSocket 연결됨', dot: true },
    connecting:   { color:'#d97706', bg:'#fffbeb', border:'#fde68a', label:'연결 중...',       dot: true },
    disconnected: { color:'#dc2626', bg:'#fee2e2', border:'#fca5a5', label:'연결 끊김',        dot: false },
    simulating:   { color:'#7c3aed', bg:'#ede9fe', border:'#c4b5fd', label:'시뮬레이션 모드',  dot: false },
  };
  const s = MAP[status] || MAP.disconnected;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5,
      background:s.bg, border:`1px solid ${s.border}`, borderRadius:20,
      padding:'3px 10px', fontSize:11, color:s.color, fontWeight:600 }}>
      {s.dot && (
        <span style={{ width:7, height:7, borderRadius:'50%', background:s.color,
          display:'inline-block', animation:'s02pulse 1.5s ease-in-out infinite' }} />
      )}
      {s.label}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
function S02CheckinPanel({ bookings: propBookings }) {
  const bookings = propBookings || DEFAULT_S02_BOOKINGS;

  // ── 상태 ──
  const [wsStatus,      setWsStatus]      = useState('simulating');
  const [propStatuses,  setPropStatuses]  = useState(() =>
    Object.fromEntries(bookings.map(b => [b.propId, 'vacant']))
  );
  const [eventResults,  setEventResults]  = useState([]);
  const [alerts,        setAlerts]        = useState([]);
  const [running,       setRunning]       = useState(false);

  // 시뮬레이터 설정
  const [simPropId,     setSimPropId]     = useState('P-042');
  const [simContext,    setSimContext]     = useState('guest_checkin');
  const [simTime,       setSimTime]       = useState('15:12');
  const [sceneFail,     setSceneFail]     = useState(false);
  const [channelFail,   setChannelFail]   = useState(false);
  const [useRealHA,     setUseRealHA]     = useState(false);

  // ── 알림 추가 ──
  const addAlert = (alert) => {
    setAlerts(prev => [{ ...alert, id: Date.now() + Math.random() }, ...prev].slice(0, 30));
  };

  const ackAlert = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const updateStatus = (propId, status) => {
    setPropStatuses(prev => ({ ...prev, [propId]: status }));
  };

  // ── 이벤트 처리 ──
  const handleEvent = async (haEvent) => {
    if (running) return;
    setRunning(true);

    const deps = useRealHA
      ? { activateScene:_haS02.activateScene, openChannel:_haS02.openChannel,
          sendMessage:_haS02.sendMessage, updateStatus, addAlert }
      : makeMockInfra(addAlert, updateStatus, sceneFail, channelFail);

    // "입실 중" 뱃지로 선행 표시
    setPropStatuses(prev => ({ ...prev, [haEvent.propId]: 'checking_in' }));

    const onStepUpdate = (result) => {
      setEventResults(prev => {
        const idx = prev.findIndex(r => r.propId === result.propId && r.time === result.time);
        if (idx >= 0) { const next = [...prev]; next[idx] = result; return next; }
        return [result, ...prev];
      });
    };

    try {
      const result = await runCheckinAutomation(haEvent, bookings, deps, haEvent.time, onStepUpdate);

      if (!result) {
        // 체크인 이벤트 아님 → 원상복귀
        setPropStatuses(prev => ({ ...prev, [haEvent.propId]: 'vacant' }));
        addAlert({ type:'warn', prop:haEvent.propId,
          msg:`도어락 열림 감지 — 체크인 이벤트 아님 (context: ${haEvent.context}, 시각: ${haEvent.time})`,
          time: haEvent.time || _s02.hhmm() });
      }
    } catch (err) {
      setPropStatuses(prev => ({ ...prev, [haEvent.propId]: 'vacant' }));
      addAlert({ type:'error', prop:haEvent.propId,
        msg:`예기치 않은 오류: ${err.message}`, time: _s02.hhmm() });
    } finally {
      setRunning(false);
    }
  };

  // ── PIN 오류 처리 ──
  const handlePinLockout = (propId, failCount) => {
    const time = _s02.hhmm();
    const text = _s02.buildPinLockoutAlert(propId, failCount);
    addAlert({ type:'error', prop:propId, msg:text, time });
  };

  // ── 체크인 시뮬레이션 ──
  const simulate = () => {
    const event = { event:'door_unlocked', propId:simPropId, time:simTime, context:simContext, failCount:0 };
    handleEvent(event);
  };

  // ── WebSocket 연결 시뮬레이션 ──
  const connectWS = () => {
    setWsStatus('connecting');
    setTimeout(() => setWsStatus('connected'), 1200);
  };
  const disconnectWS = () => setWsStatus('simulating');

  const _inp = { border:'1px solid var(--border)', borderRadius:6, padding:'5px 8px',
    fontSize:11, background:'var(--surface)', color:'var(--text)',
    fontFamily:"'DM Sans',sans-serif", outline:'none' };

  const checkinBook = bookings.find(b => b.propId === simPropId);
  const simWindow   = checkinBook ? _s02.getCheckinWindow(checkinBook.checkIn) : null;
  const timeInWindow = simWindow && simTime >= simWindow.from && simTime <= simWindow.until;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden',
      fontFamily:"'DM Sans',sans-serif" }}>

      {/* CSS 애니메이션 */}
      <style>{`
        @keyframes s02spin   { to { transform: rotate(360deg); } }
        @keyframes s02pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* 헤더 */}
      <div style={{ padding:'12px 16px', background:'var(--surface)',
        borderBottom:'1px solid var(--border)', display:'flex',
        justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>
            S02 — 체크인 당일 자동화
          </div>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>
            입실 감지 → IoT 씬 실행 → 게스트 채팅 오픈 → 상태 갱신
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <WsStatusBadge status={wsStatus} />
          {wsStatus === 'simulating' || wsStatus === 'disconnected' ? (
            <button onClick={connectWS}
              style={{ padding:'5px 12px', borderRadius:6, background:'#2563eb',
                border:'1.5px solid #1d4ed8', color:'#fff',
                fontSize:11, fontWeight:700, cursor:'pointer' }}>
              HA 연결
            </button>
          ) : (
            <button onClick={disconnectWS}
              style={{ padding:'5px 12px', borderRadius:6, background:'#fee2e2',
                border:'1.5px solid #fca5a5', color:'#dc2626',
                fontSize:11, fontWeight:600, cursor:'pointer' }}>
              연결 해제
            </button>
          )}
        </div>
      </div>

      {/* 본문 — 좌/우 분할 */}
      <div style={{ flex:1, display:'flex', gap:0, overflow:'hidden' }}>

        {/* ── 좌측: 숙소 상태 + 시뮬레이터 ── */}
        <div style={{ width:300, flexShrink:0, borderRight:'1px solid var(--border)',
          display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* 숙소 상태 카드 */}
          <div style={{ flex:1, overflow:'auto', padding:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>
              숙소 현황
            </div>
            {bookings.map(b => (
              <PropStatusCard key={b.propId} booking={b} status={propStatuses[b.propId] || 'vacant'} />
            ))}
          </div>

          {/* 이벤트 시뮬레이터 */}
          <div style={{ borderTop:'1px solid var(--border)', padding:12, flexShrink:0,
            background:'#fafbfc' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
              이벤트 시뮬레이터
            </div>

            {/* 숙소 선택 */}
            <div style={{ marginBottom:7 }}>
              <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>숙소</div>
              <select value={simPropId} onChange={e => setSimPropId(e.target.value)}
                style={{ ..._inp, width:'100%' }}>
                {bookings.map(b => (
                  <option key={b.propId} value={b.propId}>{b.propId} — {b.propName}</option>
                ))}
              </select>
            </div>

            {/* context + 시각 */}
            <div style={{ display:'flex', gap:6, marginBottom:7 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>이벤트 context</div>
                <select value={simContext} onChange={e => setSimContext(e.target.value)}
                  style={{ ..._inp, width:'100%' }}>
                  <option value="guest_checkin">guest_checkin</option>
                  <option value="manual">manual (무시됨)</option>
                  <option value="maintenance">maintenance (무시됨)</option>
                </select>
              </div>
              <div style={{ width:72 }}>
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>시각</div>
                <input type="time" value={simTime}
                  onChange={e => setSimTime(e.target.value)}
                  style={{ ..._inp, width:'100%', fontFamily:"'DM Mono',monospace" }} />
              </div>
            </div>

            {/* 체크인 시간창 안내 */}
            {simWindow && (
              <div style={{ fontSize:10, marginBottom:8, padding:'4px 8px', borderRadius:5,
                background: timeInWindow ? '#f0fdf4' : '#fff7ed',
                border: `1px solid ${timeInWindow ? '#86efac' : '#fed7aa'}`,
                color: timeInWindow ? '#166534' : '#92400e',
                fontFamily:"'DM Mono',monospace" }}>
                체크인 가능: {simWindow.from} ~ {simWindow.until}
                {timeInWindow ? ' ✓' : ' ← 시간창 외'}
              </div>
            )}

            {/* 실패 시나리오 토글 */}
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              {[
                { key:'sceneFail',   label:'씬 실패',   val:sceneFail,   set:setSceneFail },
                { key:'channelFail', label:'채널 실패', val:channelFail, set:setChannelFail },
              ].map(({ key, label, val, set }) => (
                <button key={key} onClick={() => set(v => !v)}
                  style={{ flex:1, padding:'4px 6px', borderRadius:5, fontSize:10, fontWeight:600,
                    cursor:'pointer',
                    background: val ? '#fee2e2' : 'var(--surface)',
                    border: `1.5px solid ${val ? '#fca5a5' : 'var(--border)'}`,
                    color: val ? '#dc2626' : 'var(--text3)' }}>
                  {val ? '✕ ' : ''}{label}
                </button>
              ))}
            </div>

            {/* HA 모드 토글 */}
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
              <button onClick={() => setUseRealHA(v => !v)}
                style={{ flex:1, padding:'4px 8px', borderRadius:5, fontSize:10, fontWeight:600,
                  cursor:'pointer',
                  background: useRealHA ? '#ede9fe' : 'var(--surface)',
                  border: `1.5px solid ${useRealHA ? '#c4b5fd' : 'var(--border)'}`,
                  color: useRealHA ? '#7c3aed' : 'var(--text3)' }}>
                {useRealHA ? '⚡ 실제 HA 모드' : '○ Mock 모드'}
              </button>
            </div>

            {/* 이벤트 발생 버튼 */}
            <button onClick={simulate} disabled={running}
              style={{ width:'100%', padding:'9px', borderRadius:7,
                background: running ? 'var(--border)' : '#2563eb',
                border: `1.5px solid ${running ? 'var(--border2)' : '#1d4ed8'}`,
                color: running ? 'var(--text3)' : '#fff',
                fontSize:12, fontWeight:700, cursor: running ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {running
                ? <><span style={{ animation:'s02spin 1s linear infinite', display:'inline-block' }}>↻</span> 처리 중...</>
                : '🚪 도어락 열림 이벤트 발생'}
            </button>

            {/* PIN 오류 버튼 */}
            <button onClick={() => handlePinLockout(simPropId, 3)}
              style={{ width:'100%', marginTop:6, padding:'7px', borderRadius:7,
                background:'#fff7ed', border:'1.5px solid #fed7aa',
                color:'#92400e', fontSize:11, fontWeight:600, cursor:'pointer' }}>
              ⚠ PIN 오류 3회 시뮬레이션
            </button>
          </div>
        </div>

        {/* ── 우측: 처리 결과 + 알림 피드 ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* 이벤트 처리 결과 */}
          <div style={{ flex:1, overflow:'auto', padding:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
              이벤트 처리 결과
              {eventResults.length > 0 && (
                <button onClick={() => setEventResults([])}
                  style={{ marginLeft:10, padding:'1px 7px', borderRadius:4,
                    background:'var(--surface)', border:'1px solid var(--border)',
                    color:'var(--text3)', fontSize:10, cursor:'pointer', fontWeight:400 }}>
                  초기화
                </button>
              )}
            </div>

            {eventResults.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px 20px',
                color:'var(--text3)', fontSize:12 }}>
                <div style={{ fontSize:32, marginBottom:10, opacity:0.4 }}>🚪</div>
                도어락 열림 이벤트를 시뮬레이션하면<br/>처리 결과가 여기에 표시됩니다.
              </div>
            ) : (
              eventResults.map((r, i) => (
                <EventResultCard key={`${r.propId}-${r.time}-${i}`} result={r} />
              ))
            )}
          </div>

          {/* 알림 피드 */}
          <div style={{ height:220, borderTop:'1px solid var(--border)',
            display:'flex', flexDirection:'column', flexShrink:0 }}>
            <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border)',
              display:'flex', justifyContent:'space-between', alignItems:'center',
              background:'var(--surface)', flexShrink:0 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)',
                textTransform:'uppercase', letterSpacing:'0.05em' }}>
                알림 피드
                {alerts.length > 0 && (
                  <span style={{ marginLeft:6, background:'#dc2626', color:'#fff',
                    borderRadius:10, padding:'0 5px', fontSize:10, fontWeight:700 }}>
                    {alerts.length}
                  </span>
                )}
              </span>
              {alerts.length > 0 && (
                <button onClick={() => setAlerts([])}
                  style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg)',
                    border:'1px solid var(--border)', color:'var(--text3)',
                    fontSize:10, cursor:'pointer' }}>
                  전체 확인
                </button>
              )}
            </div>
            <div style={{ flex:1, overflow:'auto', padding:'8px 12px' }}>
              {alerts.length === 0 ? (
                <div style={{ textAlign:'center', padding:'20px', color:'var(--text3)', fontSize:11 }}>
                  알림 없음
                </div>
              ) : (
                alerts.map(a => <AlertItem key={a.id} alert={a} onAck={ackAlert} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
