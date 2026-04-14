import React, { useEffect, useRef, useState } from "react";

import checkinService from "../application/checkinService.js";
import BatchConsoleGuide from "./BatchConsoleGuide";
import haBrowserClient from "../infrastructure/haBrowserClient.js";
import { createStatePollingConnection } from "../infrastructure/haBrowserPolling.js";

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
  async function activateScene(entityId) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      title:'[PROPOS S02] 체크인 씬 실행',
      message:`씬: ${entityId}\n시각: ${_s02.hhmm()}`,
      notification_id:`propos_s02_scene_${entityId.replace(/\W/g,'_')}`,
    });
  }
  async function openChannel(booking) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      title:`[PROPOS S02] 채팅 채널 오픈 — ${booking.guestName}`,
      message:`숙소: ${booking.propId}\n체크인: ${booking.checkIn?.slice(0,16).replace('T',' ')}`,
      notification_id:`propos_s02_ch_${booking.propId}`,
    });
  }
  async function sendMessage(guestId, text) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      title:`[PROPOS S02] 입실 확인 메시지 — ${guestId}`,
      message:text,
      notification_id:`propos_s02_msg_${guestId}`,
    });
  }
  return { activateScene, openChannel, sendMessage };
})();

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

function toLockEntityId(propId) {
  return `lock.front_door_${propId.toLowerCase().replace("-", "_")}`;
}

// ── HA 연결 상태 표시 ─────────────────────────────────────────
function WsStatusBadge({ status }) {
  const MAP = {
    connected:    { color:'#059669', bg:'#dcfce7', border:'#86efac', label:'HA 연결됨', dot: true },
    connecting:   { color:'#d97706', bg:'#fffbeb', border:'#fde68a', label:'연결 중...',          dot: true },
    reconnecting: { color:'#d97706', bg:'#fffbeb', border:'#fde68a', label:'재연결 중...',        dot: true },
    disconnected: { color:'#64748b', bg:'#f8fafc', border:'#e2e8f0', label:'연결 해제됨',         dot: false },
    error:        { color:'#dc2626', bg:'#fee2e2', border:'#fca5a5', label:'연결 오류',            dot: false },
    simulating:   { color:'#7c3aed', bg:'#ede9fe', border:'#c4b5fd', label:'시뮬레이션 모드',     dot: false },
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
function S02CheckinPanel({ bookings: propBookings, onBack }) {
  const bookings = propBookings || DEFAULT_S02_BOOKINGS;

  // ── 상태 ──
  const [wsStatus,      setWsStatus]      = useState('simulating');
  const [propStatuses,  setPropStatuses]  = useState(() =>
    Object.fromEntries(bookings.map(b => [b.propId, 'vacant']))
  );
  const [eventResults,  setEventResults]  = useState([]);
  const [alerts,        setAlerts]        = useState([]);
  const [running,       setRunning]       = useState(false);
  const [devOpen,       setDevOpen]       = useState(false);

  // 시뮬레이터 설정
  const [simPropId,     setSimPropId]     = useState('P-042');
  const [simContext,    setSimContext]     = useState('guest_checkin');
  const [simTime,       setSimTime]       = useState('15:12');
  const [sceneFail,     setSceneFail]     = useState(false);
  const [channelFail,   setChannelFail]   = useState(false);
  const [useRealHA,     setUseRealHA]     = useState(false);
  const wsConnRef  = useRef(null);   // HA 상태 폴링 연결 핸들
  const handleEventRef = useRef(null); // 최신 handleEvent 참조 (연결 콜백용)

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
      const result = await checkinService.handleDoorUnlocked(
        haEvent,
        bookings,
        deps,
        haEvent.time,
        { onStepUpdate }
      );

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
    checkinService.handlePinLockout({ propId, failCount, time: _s02.hhmm() }, { addAlert });
  };

  // ── handleEventRef: 연결 콜백에서 항상 최신 handleEvent 호출 ──
  handleEventRef.current = handleEvent;

  // ── 실제 HA 상태 폴링 — useRealHA 켤 때만 연결 ──
  useEffect(() => {
    if (!useRealHA) {
      if (wsConnRef.current) { wsConnRef.current.disconnect(); wsConnRef.current = null; }
      setWsStatus('simulating');
      return;
    }
    const lastStates = {};
    const entityIds = bookings.map(booking => toLockEntityId(booking.propId));

    wsConnRef.current = createStatePollingConnection({
      entityIds,
      onStatusChange: setWsStatus,
      onStates: states => {
        for (const [entityId, nextState] of Object.entries(states)) {
          const prevState = lastStates[entityId];
          const oldValue = prevState?.state ?? null;
          const newValue = nextState?.state ?? null;

          if (newValue === 'unlocked' && oldValue === 'locked') {
            const match = entityId?.match(/p[_-](\d+)/i);
            const propId = match ? `P-${match[1].padStart(3,'0')}` : simPropId;
            handleEventRef.current({
              event: 'door_unlocked',
              propId,
              context: 'guest_checkin',
              time: _s02.hhmm(),
            });
          }

          lastStates[entityId] = nextState;
        }
      },
    });

    return () => { if (wsConnRef.current) { wsConnRef.current.disconnect(); wsConnRef.current = null; } };
  }, [bookings, simPropId, useRealHA]);

  // ── 체크인 시뮬레이션 (수동) ──
  const simulate = () => {
    const event = { event:'door_unlocked', propId:simPropId, time:simTime, context:simContext, failCount:0 };
    handleEvent(event);
  };

  // ── HA 연결/해제 버튼 핸들러 ──
  const connectWS    = () => setUseRealHA(true);
  const disconnectWS = () => setUseRealHA(false);

  const _inp = { border:'1px solid var(--border)', borderRadius:6, padding:'5px 8px',
    fontSize:11, background:'var(--surface)', color:'var(--text)',
    fontFamily:"'DM Sans',sans-serif", outline:'none' };

  const checkinBook  = bookings.find(b => b.propId === simPropId);
  const simWindow    = checkinBook ? _s02.getCheckinWindow(checkinBook.checkIn) : null;
  const timeInWindow = simWindow && simTime >= simWindow.from && simTime <= simWindow.until;

  // ── 자동화 단계 상태 ──
  const lr        = eventResults[0] || null;
  const step1done = lr !== null;
  const s2run     = running && step1done && lr?.steps.scene == null;
  const step2done = lr?.steps.scene === true;
  const step2fail = lr?.steps.scene === false;
  const s3run     = running && step2done && lr?.steps.channel == null;
  const step3done = lr?.steps.channel === true;
  const step3fail = lr?.steps.channel === false;
  const s4run     = running && step3done && lr?.steps.message == null;
  const step4done = lr?.steps.message === true;
  const step4fail = lr?.steps.message === false;

  function getSC(done, fail, isRun, num) {
    if (done)   return { b:'#86efac', hBg:'#f0fdf4', cBg:'#16a34a', cFg:'#fff', tc:'#15803d', lbl:'✓' };
    if (fail)   return { b:'#fca5a5', hBg:'#fff1f2', cBg:'#dc2626', cFg:'#fff', tc:'#b91c1c', lbl:'✕' };
    if (isRun)  return { b:'#93c5fd', hBg:'#eff6ff', cBg:'#2563eb', cFg:'#fff', tc:'#2563eb', lbl:'↻' };
    return             { b:'#e2e8f0', hBg:'#f8fafc', cBg:'#e2e8f0', cFg:'#64748b', tc:'#94a3b8', lbl:String(num) };
  }
  const sc1 = step1done ? { b:'#86efac', hBg:'#f0fdf4', cBg:'#16a34a', cFg:'#fff', tc:'#15803d', lbl:'✓' }
                        : { b:'#e2e8f0', hBg:'#f8fafc', cBg:'#e2e8f0', cFg:'#64748b', tc:'#94a3b8', lbl:'1' };
  const sc2 = getSC(step2done, step2fail, s2run, 2);
  const sc3 = getSC(step3done, step3fail, s3run, 3);
  const sc4 = getSC(step4done, step4fail, s4run, 4);
  const selectedBooking = bookings.find(b => b.propId === simPropId) || bookings[0];
  const occupiedCount = Object.values(propStatuses).filter(status => status === 'occupied').length;
  const checkingInCount = Object.values(propStatuses).filter(status => status === 'checking_in').length;
  const vacantCount = Object.values(propStatuses).filter(status => status === 'vacant').length;
  const resultCount = eventResults.length;
  const failedCount = eventResults.filter(result => result.status === 'failed' || result.status === 'partial').length;
  const latestError = alerts.find(alert => alert.type === 'error') || alerts[0] || null;
  const currentStatus = propStatuses[simPropId] || 'vacant';
  const focusTone = running
    ? { bg:'#eff6ff', border:'#bfdbfe', text:'#2563eb' }
    : lr?.status === 'failed'
    ? { bg:'#fef2f2', border:'#fecaca', text:'#dc2626' }
    : lr?.status === 'partial'
    ? { bg:'#fffbeb', border:'#fde68a', text:'#d97706' }
    : currentStatus === 'occupied'
    ? { bg:'#ecfdf5', border:'#a7f3d0', text:'#059669' }
    : { bg:'#f8fafc', border:'#e2e8f0', text:'#475569' };
  const focusTitle = running
    ? `${selectedBooking.propName} 체크인 자동화를 진행 중입니다.`
    : lr?.status === 'failed'
    ? `${lr.propName} 체크인 자동화가 실패했습니다.`
    : lr?.status === 'partial'
    ? `${lr.propName} 체크인은 일부만 완료되어 후속 확인이 필요합니다.`
    : currentStatus === 'occupied'
    ? `${selectedBooking.propName} 입실이 완료되어 후속 안내만 확인하면 됩니다.`
    : timeInWindow
    ? `${selectedBooking.propName} 체크인 시간이에요. 입실 이벤트만 확인하면 자동화가 이어집니다.`
    : `${selectedBooking.propName}의 체크인 시간 전입니다. 다음 입실 가능 구간을 확인하세요.`;
  const focusDesc = running
    ? '씬 실행, 채널 오픈, 메시지 발송이 순서대로 이어지고 있어요. 단계 카드에서 멈춘 지점을 바로 확인할 수 있습니다.'
    : lr?.status === 'failed'
    ? lr.error || '실패 원인을 확인한 뒤 다시 처리해야 합니다.'
    : lr?.status === 'partial'
    ? '게스트 입실은 감지됐지만 일부 후속 작업이 남아 있습니다. 채널 오픈과 메시지 발송 결과를 먼저 보세요.'
    : timeInWindow
    ? `현재 선택 숙소의 체크인 가능 시간은 ${simWindow?.from} ~ ${simWindow?.until}입니다.`
    : `현재 선택 숙소의 체크인 가능 시간은 ${simWindow?.from} ~ ${simWindow?.until}이며, 시간창 밖 이벤트는 자동으로 무시됩니다.`;
  const summaryCards = [
    { label:'입실 완료', value:`${occupiedCount}곳`, desc:'후속 안내만 확인', tone:{ bg:'#ecfdf5', border:'#a7f3d0', text:'#059669' } },
    { label:'처리 중', value:`${checkingInCount}곳`, desc:'자동화 진행 중', tone:{ bg:'#eff6ff', border:'#bfdbfe', text:'#2563eb' } },
    { label:'대기 중', value:`${vacantCount}곳`, desc:'입실 이벤트 대기', tone:{ bg:'#f8fafc', border:'#e2e8f0', text:'#475569' } },
    { label:'주의 필요', value:`${failedCount || alerts.length}건`, desc:'실패 또는 알림 확인', tone:{ bg:'#fffbeb', border:'#fde68a', text:'#d97706' } },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', fontFamily:"'DM Sans',sans-serif" }}>

      <style>{`
        @keyframes s02spin  { to { transform: rotate(360deg); } }
        @keyframes s02pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* ── 헤더 ── */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0', padding:'16px 24px', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {onBack && <button onClick={onBack} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 12px', fontSize:12, color:'#64748b', cursor:'pointer', fontWeight:600 }}>← 커맨드 센터</button>}
          {onBack && <div style={{ width:1, height:22, background:'#e2e8f0' }} />}
          <div>
            <div style={{ fontSize:10, color:'#94a3b8', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>S02 · 체크인 당일</div>
            <div style={{ fontWeight:800, fontSize:18, color:'#1e293b' }}>입실 이벤트 확인</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>입실 감지부터 IoT 씬 실행, 채널 오픈, 상태 반영까지 한 흐름으로 처리합니다.</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <WsStatusBadge status={wsStatus} />
          {wsStatus === 'simulating' || wsStatus === 'disconnected' ? (
            <button onClick={connectWS} style={{ padding:'7px 16px', borderRadius:8, background:'#2563eb', border:'1.5px solid #1d4ed8', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>HA 연결</button>
          ) : (
            <button onClick={disconnectWS} style={{ padding:'7px 16px', borderRadius:8, background:'#fee2e2', border:'1.5px solid #fca5a5', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>연결 해제</button>
          )}
        </div>
      </div>

      <BatchConsoleGuide stageId="checkin" onBack={onBack} />

      <div style={{ padding:'18px 20px 0', background:'#f0f4f8', flexShrink:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1.7fr 1fr', gap:14, marginBottom:14 }}>
          <div style={{ background:focusTone.bg, border:`1.5px solid ${focusTone.border}`, borderRadius:16, padding:'18px 20px', boxShadow:'0 10px 28px rgba(15,23,42,0.04)' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'#94a3b8', marginBottom:8 }}>지금 할 일</div>
            <div style={{ fontSize:20, fontWeight:800, color:focusTone.text, lineHeight:1.45, letterSpacing:'-0.3px' }}>{focusTitle}</div>
            <div style={{ fontSize:13, color:'#64748b', lineHeight:1.7, marginTop:8 }}>{focusDesc}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', background:'rgba(255,255,255,0.85)', border:'1px solid rgba(226,232,240,0.9)', borderRadius:999, padding:'6px 10px' }}>
                선택 숙소 · {selectedBooking.propId}
              </span>
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', background:'rgba(255,255,255,0.85)', border:'1px solid rgba(226,232,240,0.9)', borderRadius:999, padding:'6px 10px' }}>
                최근 처리 {resultCount}건
              </span>
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', background:'rgba(255,255,255,0.85)', border:'1px solid rgba(226,232,240,0.9)', borderRadius:999, padding:'6px 10px' }}>
                미확인 알림 {alerts.length}건
              </span>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={simulate} disabled={running} style={{ padding:'10px 16px', borderRadius:10, border:'1.5px solid #1d4ed8', background:running ? '#dbeafe' : '#2563eb', color:running ? '#2563eb' : '#fff', fontSize:12, fontWeight:700, cursor:running ? 'default' : 'pointer' }}>
                {running ? '입실 흐름 확인 중' : '선택 숙소 다시 확인'}
              </button>
              <button onClick={() => setDevOpen(true)} style={{ padding:'10px 16px', borderRadius:10, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                개발용 시뮬레이터 열기
              </button>
            </div>
          </div>

          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:16, padding:'16px 18px' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'#94a3b8', marginBottom:10 }}>방금 뜬 알림</div>
            {latestError ? (
              <>
                <div style={{ fontSize:14, fontWeight:800, color:latestError.type === 'error' ? '#dc2626' : '#d97706', lineHeight:1.5 }}>{latestError.prop}</div>
                <div style={{ fontSize:12, color:'#475569', lineHeight:1.65, marginTop:6 }}>{latestError.msg}</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:10, fontFamily:"'DM Mono',monospace" }}>{latestError.time}</div>
              </>
            ) : (
              <div style={{ fontSize:12, color:'#64748b', lineHeight:1.7 }}>지금 바로 확인할 알림은 없어요. 체크인 가능 시간에 맞춰 입실 이벤트만 보면 자동화가 이어집니다.</div>
            )}
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:10, marginBottom:14 }}>
          {summaryCards.map(card => (
            <div key={card.label} style={{ background:card.tone.bg, border:`1.5px solid ${card.tone.border}`, borderRadius:14, padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', letterSpacing:'0.05em', textTransform:'uppercase' }}>{card.label}</span>
                <strong style={{ fontFamily:"'DM Mono',monospace", fontSize:18, fontWeight:800, color:card.tone.text }}>{card.value}</strong>
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginTop:10, lineHeight:1.55 }}>{card.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 본문 3열 ── */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'260px 1fr 340px', gap:20, padding:'6px 20px 20px', overflow:'hidden' }}>

        {/* 좌측: 숙소 현황 + 개발 옵션 */}
        <div style={{ display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>

          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'16px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, paddingBottom:8, borderBottom:'1.5px solid #e2e8f0' }}>
              <span style={{ width:3, height:13, background:'#059669', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>한 번에 볼 숙소</span>
            </div>
            {bookings.map(b => <PropStatusCard key={b.propId} booking={b} status={propStatuses[b.propId] || 'vacant'} />)}
          </div>

          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
            <button onClick={() => setDevOpen(v => !v)}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background: devOpen ? '#fefce8' : '#fafafa', border:'none', cursor:'pointer', borderBottom: devOpen ? '1px solid #e2e8f0' : 'none' }}>
              <span style={{ width:3, height:13, background:'#7c3aed', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1, textAlign:'left' }}>🔧 개발 모드 · 시뮬레이터</span>
              <span style={{ fontSize:10, color:'#7c3aed', fontWeight:600 }}>{devOpen ? '▲ 접기' : '▼ 펼치기'}</span>
            </button>
            {devOpen && (
              <div style={{ padding:'12px 14px', background:'#fefce8', display:'flex', flexDirection:'column', gap:10 }}>
                <div>
                  <div style={{ fontSize:10, color:'#92400e', marginBottom:3, fontWeight:600 }}>테스트 숙소</div>
                  <select value={simPropId} onChange={e => setSimPropId(e.target.value)} style={{ ..._inp, width:'100%', background:'#fffbeb' }}>
                    {bookings.map(b => <option key={b.propId} value={b.propId}>{b.propId} — {b.propName}</option>)}
                  </select>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:'#92400e', marginBottom:3, fontWeight:600 }}>이벤트 context</div>
                    <select value={simContext} onChange={e => setSimContext(e.target.value)} style={{ ..._inp, width:'100%', background:'#fffbeb' }}>
                      <option value="guest_checkin">guest_checkin</option>
                      <option value="manual">manual (무시됨)</option>
                      <option value="maintenance">maintenance (무시됨)</option>
                    </select>
                  </div>
                  <div style={{ width:72 }}>
                    <div style={{ fontSize:10, color:'#92400e', marginBottom:3, fontWeight:600 }}>시각</div>
                    <input type="time" value={simTime} onChange={e => setSimTime(e.target.value)} style={{ ..._inp, width:'100%', fontFamily:"'DM Mono',monospace", background:'#fffbeb' }} />
                  </div>
                </div>
                {simWindow && (
                  <div style={{ fontSize:10, padding:'4px 8px', borderRadius:5, background: timeInWindow ? '#f0fdf4' : '#fff7ed', border: `1px solid ${timeInWindow ? '#86efac' : '#fed7aa'}`, color: timeInWindow ? '#166534' : '#92400e', fontFamily:"'DM Mono',monospace" }}>
                    체크인 가능: {simWindow.from} ~ {simWindow.until}{timeInWindow ? ' ✓' : ' ← 시간창 외'}
                  </div>
                )}
                <div style={{ display:'flex', gap:6 }}>
                  {[{ key:'sceneFail', label:'씬 실패', val:sceneFail, set:setSceneFail }, { key:'channelFail', label:'채널 실패', val:channelFail, set:setChannelFail }].map(({ key, label, val, set }) => (
                    <button key={key} onClick={() => set(v => !v)} style={{ flex:1, padding:'4px 6px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background: val ? '#fee2e2' : '#fffbeb', border: `1.5px solid ${val ? '#fca5a5' : '#fde68a'}`, color: val ? '#dc2626' : '#92400e' }}>
                      {val ? '✕ ' : ''}{label}
                    </button>
                  ))}
                </div>
                <button onClick={() => setUseRealHA(v => !v)} style={{ padding:'5px 8px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background: useRealHA ? '#ede9fe' : '#fafafa', border: `1.5px solid ${useRealHA ? '#c4b5fd' : '#e2e8f0'}`, color: useRealHA ? '#7c3aed' : '#64748b' }}>
                  {useRealHA ? '⚡ 실제 HA 모드' : '○ Mock 모드'}
                </button>
                <button onClick={() => handlePinLockout(simPropId, 3)} style={{ padding:'6px', borderRadius:6, background:'#fff7ed', border:'1.5px solid #fed7aa', color:'#92400e', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  ⚠ PIN 오류 3회 시뮬
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 중앙: 자동화 흐름 */}
        <div style={{ display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>

          <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10, borderBottom:'1.5px solid #e2e8f0' }}>
            <span style={{ width:3, height:13, background:'#2563eb', borderRadius:2, flexShrink:0 }} />
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>처리 흐름</span>
            {eventResults.length > 0 && (
              <button onClick={() => setEventResults([])} style={{ marginLeft:'auto', padding:'3px 9px', borderRadius:5, background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b', fontSize:10, cursor:'pointer', fontWeight:600 }}>초기화</button>
            )}
          </div>

          {/* STEP 1 */}
          <div style={{ background:'#ffffff', border:`2px solid ${sc1.b}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ background:sc1.hBg, borderBottom:'1px solid #e2e8f0', padding:'10px 14px', display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:22, height:22, borderRadius:'50%', background:sc1.cBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ color:sc1.cFg, fontWeight:800, fontSize:12 }}>{sc1.lbl}</span>
              </div>
              <span style={{ fontWeight:700, fontSize:13, color:sc1.tc }}>STEP 1 · 도어락 열림 감지</span>
            </div>
            <div style={{ padding:'14px 16px' }}>
              {step1done && (
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color:'#1e293b', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:4, padding:'2px 7px' }}>{lr.propId}</span>
                  <span style={{ fontSize:13, color:'#1e293b', fontWeight:600 }}>{lr.propName}</span>
                  <span style={{ fontSize:12, color:'#64748b' }}>— {lr.guestName}님</span>
                  <span style={{ marginLeft:'auto', fontFamily:"'DM Mono',monospace", fontSize:12, color:'#64748b' }}>{lr.time}</span>
                </div>
              )}
              {!step1done && <div style={{ color:'#94a3b8', fontSize:13, marginBottom:10, textAlign:'center' }}>아직 들어온 입실 이벤트가 없어요.</div>}
              <button onClick={simulate} disabled={running} style={{ width:'100%', padding:'10px', borderRadius:8, background: running ? '#e2e8f0' : 'linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%)', border:`2px solid ${running ? '#cbd5e1' : '#1e40af'}`, color: running ? '#94a3b8' : '#ffffff', fontSize:13, fontWeight:700, cursor: running ? 'not-allowed' : 'pointer', boxShadow: running ? 'none' : '0 4px 12px rgba(37,99,235,0.35)' }}>
                {running ? <><span style={{ animation:'s02spin 1s linear infinite', display:'inline-block' }}>↻</span> 확인 중...</> : '🚪 입실 이벤트 다시 확인'}
              </button>
            </div>
          </div>

          {/* STEP 2 */}
          <div style={{ background:'#ffffff', border:`2px solid ${sc2.b}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ background:sc2.hBg, borderBottom:'1px solid #e2e8f0', padding:'10px 14px', display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:22, height:22, borderRadius:'50%', background:sc2.cBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ color:sc2.cFg, fontWeight:800, fontSize:12, animation: s2run ? 's02spin 1s linear infinite' : 'none', display:'inline-block' }}>{sc2.lbl}</span>
              </div>
              <span style={{ fontWeight:700, fontSize:13, color:sc2.tc }}>STEP 2 · IoT 체크인 씬 실행</span>
            </div>
            <div style={{ padding:'14px 16px', fontSize:13 }}>
              {step2done ? <span style={{ color:'#059669' }}>체크인 웰컴 씬 실행 완료 — 조명 켜짐, 에어컨 설정 완료</span>
              : step2fail ? <span style={{ color:'#dc2626' }}>{lr?.error || 'IoT 씬 실행 실패'}</span>
              : s2run    ? <span style={{ color:'#2563eb' }}>씬 실행 중... (HA REST API 호출)</span>
              :             <span style={{ color:'#94a3b8' }}>입실 감지 후 자동 실행됩니다</span>}
            </div>
          </div>

          {/* STEP 3 */}
          <div style={{ background:'#ffffff', border:`2px solid ${sc3.b}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ background:sc3.hBg, borderBottom:'1px solid #e2e8f0', padding:'10px 14px', display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:22, height:22, borderRadius:'50%', background:sc3.cBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ color:sc3.cFg, fontWeight:800, fontSize:12, animation: s3run ? 's02spin 1s linear infinite' : 'none', display:'inline-block' }}>{sc3.lbl}</span>
              </div>
              <span style={{ fontWeight:700, fontSize:13, color:sc3.tc }}>STEP 3 · 게스트 채팅 채널 오픈</span>
            </div>
            <div style={{ padding:'14px 16px', fontSize:13 }}>
              {step3done ? <span style={{ color:'#059669' }}>게스트 채팅 채널 오픈 완료</span>
              : step3fail ? <span style={{ color:'#dc2626' }}>채팅 채널 오픈 실패 (부분 완료로 계속 진행)</span>
              : s3run    ? <span style={{ color:'#2563eb' }}>채팅 채널 오픈 중...</span>
              :             <span style={{ color:'#94a3b8' }}>씬 실행 완료 후 자동 오픈됩니다</span>}
            </div>
          </div>

          {/* STEP 4 */}
          <div style={{ background:'#ffffff', border:`2px solid ${sc4.b}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ background:sc4.hBg, borderBottom:'1px solid #e2e8f0', padding:'10px 14px', display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:22, height:22, borderRadius:'50%', background:sc4.cBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ color:sc4.cFg, fontWeight:800, fontSize:12, animation: s4run ? 's02spin 1s linear infinite' : 'none', display:'inline-block' }}>{sc4.lbl}</span>
              </div>
              <span style={{ fontWeight:700, fontSize:13, color:sc4.tc }}>STEP 4 · 입실 확인 메시지 발송</span>
            </div>
            <div style={{ padding:'14px 16px', fontSize:13 }}>
              {step4done ? (
                <div>
                  <div style={{ color:'#059669', marginBottom:6 }}>입실 확인 메시지 발송 완료</div>
                  <div style={{ fontSize:11, color:'#475569', fontFamily:"'DM Mono',monospace", background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:6, padding:'8px 10px', whiteSpace:'pre-wrap', lineHeight:1.5 }}>
                    {_s02.buildCheckinConfirmMessage(bookings.find(b => b.propId === lr?.propId) || bookings[0], lr?.time || _s02.hhmm())}
                  </div>
                </div>
              )
              : step4fail ? <span style={{ color:'#dc2626' }}>메시지 발송 실패 (부분 완료)</span>
              : s4run    ? <span style={{ color:'#2563eb' }}>입실 확인 메시지 발송 중...</span>
              :             <span style={{ color:'#94a3b8' }}>채팅 채널 오픈 후 자동 발송됩니다</span>}
            </div>
          </div>

          {/* 처리 이력 */}
          {eventResults.length > 1 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:8, borderBottom:'1.5px solid #e2e8f0', marginBottom:10 }}>
                <span style={{ width:3, height:13, background:'#94a3b8', borderRadius:2, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>처리 이력</span>
              </div>
              {eventResults.slice(1).map((r, i) => (
                <EventResultCard key={`${r.propId}-${r.time}-${i}`} result={r} />
              ))}
            </div>
          )}
        </div>

        {/* 우측: 알림 피드 */}
        <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', flexShrink:0 }}>
            <span style={{ width:3, height:13, background:'#d97706', borderRadius:2, flexShrink:0 }} />
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1 }}>실시간 알림</span>
            {alerts.length > 0 && <span style={{ background:'#dc2626', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{alerts.length}</span>}
            {alerts.length > 0 && (
              <button onClick={() => setAlerts([])} style={{ padding:'3px 9px', borderRadius:5, background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b', fontSize:10, cursor:'pointer', fontWeight:600 }}>전체 확인</button>
            )}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'8px 10px' }}>
            {alerts.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px 20px', color:'#94a3b8', fontSize:13 }}>
                <div style={{ fontSize:28, marginBottom:8, opacity:0.4 }}>🔔</div>
                지금 바로 확인할 알림은 없어요.
              </div>
            ) : (
              alerts.map(a => <AlertItem key={a.id} alert={a} onAck={ackAlert} />)
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default S02CheckinPanel;
