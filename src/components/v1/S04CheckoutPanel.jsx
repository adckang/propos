import React from "react";

import checkoutService from "../../application/checkoutService.js";
import haBrowserClient from "../../infrastructure/haBrowserClient.js";
import { createStatePollingConnection } from "../../infrastructure/haBrowserPolling.js";
import { ALL_PROPS } from "../../data/mockData.js";
import { setOverride } from "../../data/propStateStore.js";

// ============================================================
// S04CheckoutPanel.jsx — UC-004 체크아웃 & 청소 자동화 UI
// 시나리오: 퇴실 감지 → PIN 즉시 만료 → 청소팀 자동 배정 → 체크리스트
// ============================================================

// ── 도메인 함수 (인라인) ─────────────────────────────────────
const _s04 = (() => {
  function getCheckoutWindow(checkOut) {
    const d = new Date(checkOut);
    const from  = new Date(d.getTime() - 2 * 60 * 60 * 1000);
    const until = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    const fmt = (dt) =>
      dt.getHours().toString().padStart(2, '0') + ':' +
      dt.getMinutes().toString().padStart(2, '0');
    return { from: fmt(from), until: fmt(until) };
  }

  function isCheckoutEvent(event, booking, now) {
    const validEvents = ['door_locked', 'manual_checkout'];
    if (!validEvents.includes(event.event)) return false;
    if (!['confirmed', 'occupied'].includes(booking.status)) return false;
    const w = getCheckoutWindow(booking.checkOut);
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const n = toMin(now), f = toMin(w.from), u = toMin(w.until);
    return n >= f && n <= u;
  }

  function assignCleaner(cleaners, propId, checkoutTime) {
    const available = cleaners.filter(c => c.available);
    if (available.length === 0) throw new Error('가용 청소팀 없음');
    const selected = available.reduce((min, c) => c.activeJobs < min.activeJobs ? c : min, available[0]);
    const [h, m] = checkoutTime.split(':').map(Number);
    const total = h * 60 + m + 30;
    const arrival = `${Math.floor(total / 60) % 24}`.padStart(2, '0') + ':' + `${total % 60}`.padStart(2, '0');
    return { propId, cleanerId: selected.id, cleanerName: selected.name, assignedAt: checkoutTime, estimatedArrival: arrival, status: 'assigned' };
  }

  function buildChecklist(propId) {
    return [
      { id: `${propId}-cl-01`, label: '침구 교체',              done: false, priority: 'required' },
      { id: `${propId}-cl-02`, label: '화장실 청소',             done: false, priority: 'required' },
      { id: `${propId}-cl-03`, label: '주방 청소',               done: false, priority: 'required' },
      { id: `${propId}-cl-04`, label: '바닥 청소',               done: false, priority: 'required' },
      { id: `${propId}-cl-05`, label: '쓰레기 비우기',           done: false, priority: 'required' },
      { id: `${propId}-cl-06`, label: '도어락 PIN 초기화 확인',  done: false, priority: 'required' },
      { id: `${propId}-cl-07`, label: '에어컨 필터 청소',        done: false, priority: 'optional' },
      { id: `${propId}-cl-08`, label: '창문 닦기',               done: false, priority: 'optional' },
    ];
  }

  function hhmm() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  return { isCheckoutEvent, assignCleaner, buildChecklist, hhmm };
})();

// ── Mock HA Infrastructure ───────────────────────────────────
const _haMockS04 = {
  async expirePin(entityId) {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
    // Mock: 항상 성공
  },
};

const _haRealS04 = (() => {
  async function expirePin(entityId) {
    await haBrowserClient.callService('persistent_notification', 'create', {
      message: `[PROPOS] PIN 만료 처리: ${entityId}`,
      title: 'PIN 만료',
    });
  }

  return { expirePin };
})();

function toLockEntityId(propId) {
  return `lock.front_door_${propId.toLowerCase().replace("-", "_")}`;
}

// ── 목업 숙소/청소팀 데이터 ─────────────────────────────────
// checkOut = 현재 시각 +30분 → 시간창(checkOut -2h ~ +3h) 안에 항상 포함되어 데모 시간 무관
function _mockCheckOut(offsetMin) {
  const d = new Date(Date.now() + offsetMin * 60 * 1000);
  return d.toISOString().slice(0, 19);
}

// ALL_PROPS에서 체크아웃/청소 관련 숙소 추출 → S04 처리 대상
// 스토어 오버라이드 시 CC 필터에도 즉시 반영됩니다
const _checkoutCandidates = ALL_PROPS.filter(p =>
  p.status === "입실중" || p.status === "청소중" || p.status === "점검중"
).slice(0, 3);

const _S04_PROPS = (_checkoutCandidates.length >= 3 ? _checkoutCandidates : ALL_PROPS.slice(0, 3))
  .map((p, i) => ({
    propId:     String(p.id),
    allPropsId: p.id,
    propName:   p.name,
    guestName:  p.guest || `게스트 ${i + 1}`,
    guestId:    `g-${p.id}`,
    checkIn:    new Date(Date.now() - (2 + i) * 3600000).toISOString().slice(0, 19),
    checkOut:   _mockCheckOut(30 + i * 30),
    status:     p.status === "청소중" || p.status === "점검중" ? "cleaning" : "occupied",
  }));

const _S04_CLEANERS = [
  { id: 'C-01', name: '김청소', available: true,  activeJobs: 1, phone: '010-1111-0001' },
  { id: 'C-02', name: '이청소', available: true,  activeJobs: 0, phone: '010-1111-0002' },
  { id: 'C-03', name: '박청소', available: false, activeJobs: 0, phone: '010-1111-0003' },
  { id: 'C-04', name: '최청소', available: true,  activeJobs: 2, phone: '010-1111-0004' },
];

// ============================================================
// PropStatusBadge — 숙소 상태 뱃지
// ============================================================
function PropStatusBadge({ status }) {
  const statusMap = {
    occupied: { label: '입실 중',  bg: '#dbeafe', color: '#1d4ed8' },
    cleaning: { label: '청소 중',  bg: '#fef9c3', color: '#a16207' },
    vacant:   { label: '준비 완료', bg: '#dcfce7', color: '#15803d' },
  };
  const s = statusMap[status] || { label: status, bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 700,
    }}>
      {s.label}
    </span>
  );
}

// ============================================================
// PinExpireCountdown — PIN 만료 5초 카운트다운
// ============================================================
function PinExpireCountdown({ active, onDone }) {
  const [count, setCount] = React.useState(5);

  React.useEffect(() => {
    if (!active) return;
    setCount(5);
    const interval = setInterval(() => {
      setCount(prev => {
        if (prev <= 1) { clearInterval(interval); onDone(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  if (!active && count === 0) return null;
  if (!active) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#fef2f2', border: '2px solid #fca5a5',
      borderRadius: 10, padding: '10px 16px',
    }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 32, fontWeight: 700, color: '#dc2626', minWidth: 36, textAlign: 'center' }}>
        {count}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>PIN 만료 처리 중</div>
        <div style={{ fontSize: 11, color: '#991b1b' }}>도어락 PIN이 {count}초 내 비활성화됩니다</div>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 0.8s infinite' }} />
      </div>
    </div>
  );
}

// ============================================================
// CleaningChecklist — 청소 체크리스트
// ============================================================
function CleaningChecklist({ items, onToggle, onFinalize, propStatus }) {
  if (!items || items.length === 0) return null;

  const required = items.filter(i => i.priority === 'required');
  const optional = items.filter(i => i.priority === 'optional');
  const doneCount = items.filter(i => i.done).length;
  const requiredDone = required.every(i => i.done);
  const progress = Math.round((doneCount / items.length) * 100);

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>📋</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>청소 체크리스트</span>
        <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#64748b' }}>
          {doneCount}/{items.length}
        </span>
      </div>

      {/* 진행률 바 */}
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, marginBottom: 14 }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: progress === 100 ? '#16a34a' : '#2563eb',
          borderRadius: 3, transition: 'width 0.4s ease',
        }} />
      </div>

      {/* 필수 항목 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          필수 항목
        </div>
        {required.map(item => (
          <ChecklistRow key={item.id} item={item} onToggle={onToggle} />
        ))}
      </div>

      {/* 선택 항목 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          선택 항목
        </div>
        {optional.map(item => (
          <ChecklistRow key={item.id} item={item} onToggle={onToggle} />
        ))}
      </div>

      {/* 청소 완료 버튼 */}
      {propStatus === 'cleaning' && (
        <button
          onClick={onFinalize}
          disabled={!requiredDone}
          style={{
            width: '100%', padding: '10px 0',
            borderRadius: 8, border: `1.5px solid ${requiredDone ? '#16a34a' : '#e2e8f0'}`,
            background: requiredDone ? '#16a34a' : '#f8fafc',
            color: requiredDone ? '#ffffff' : '#94a3b8',
            fontSize: 13, fontWeight: 700, cursor: requiredDone ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          {requiredDone ? '✓ 청소 완료 — 숙소 준비 완료 처리' : `필수 항목 ${required.filter(i => !i.done).length}개 남음`}
        </button>
      )}
    </div>
  );
}

function ChecklistRow({ item, onToggle }) {
  return (
    <div
      onClick={() => onToggle(item.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
        background: item.done ? '#f0fdf4' : 'transparent',
        transition: 'background 0.2s',
        marginBottom: 2,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 4,
        border: `2px solid ${item.done ? '#16a34a' : '#cbd5e1'}`,
        background: item.done ? '#16a34a' : '#ffffff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'all 0.15s',
      }}>
        {item.done && <span style={{ color: '#ffffff', fontSize: 11, fontWeight: 700 }}>✓</span>}
      </div>
      <span style={{
        fontSize: 13, color: item.done ? '#16a34a' : '#1e293b',
        textDecoration: item.done ? 'line-through' : 'none',
        fontWeight: item.done ? 400 : 500,
      }}>
        {item.label}
      </span>
    </div>
  );
}

// ============================================================
// AlertFeedS04 — 체크아웃/청소 알림 피드
// ============================================================
function AlertFeedS04({ alerts, onAck, onAckAll }) {
  if (alerts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>
        지금 바로 확인할 알림은 없어요.
      </div>
    );
  }

  const typeStyle = {
    error: { bg: '#fef2f2', border: '#fecaca', badge: '#dc2626', text: '[긴급]' },
    warn:  { bg: '#fffbeb', border: '#fde68a', badge: '#d97706', text: '[경고]' },
    info:  { bg: '#f0f9ff', border: '#bae6fd', badge: '#0284c7', text: '[정보]' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          onClick={onAckAll}
          style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 6,
            border: '1px solid #e2e8f0', background: '#f8fafc',
            color: '#64748b', cursor: 'pointer',
          }}
        >
          전체 확인
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
        {alerts.map((a, i) => {
          const s = typeStyle[a.type] || typeStyle.info;
          return (
            <div key={i} style={{
              background: s.bg, border: `1px solid ${s.border}`,
              borderRadius: 8, padding: '10px 12px',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.badge, whiteSpace: 'nowrap', paddingTop: 1 }}>
                {s.text}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 500 }}>{a.prop}</div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{a.msg}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: "'DM Mono', monospace" }}>{a.time}</span>
                <button
                  onClick={() => onAck(i)}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    border: '1px solid #e2e8f0', background: '#ffffff',
                    color: '#64748b', cursor: 'pointer',
                  }}
                >
                  확인
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// S04CheckoutPanel — 메인 컴포넌트
// ============================================================
function S04CheckoutPanel({ onBack }) {
  // ── 상태 ──
  const [haMode,       setHaMode]       = React.useState(false);
  const [wsStatus,     setWsStatus]     = React.useState('disconnected');
  const [selectedProp, setSelectedProp] = React.useState(_S04_PROPS[0].propId);
  const [propStatuses, setPropStatuses] = React.useState(() =>
    Object.fromEntries(_S04_PROPS.map(p => [p.propId, p.status]))
  );
  const [assignments,   setAssignments]  = React.useState({});
  const [checklists,    setChecklists]   = React.useState({});
  const [alerts,        setAlerts]       = React.useState([]);
  const [processing,    setProcessing]   = React.useState(false);
  const [pinCountdown,  setPinCountdown] = React.useState(false);
  const [pinDone,       setPinDone]      = React.useState({});
  const [notifSent,     setNotifSent]    = React.useState({});

  const wsConnRef        = React.useRef(null);
  const handleCheckoutRef = React.useRef(null);   // 최신 handleCheckoutEvent 참조

  const currentBooking = _S04_PROPS.find(p => p.propId === selectedProp);
  const currentStatus  = propStatuses[selectedProp] || 'occupied';
  const currentAssign  = assignments[selectedProp] || null;
  const currentItems   = checklists[selectedProp] || null;

  // ── 인프라 ──
  function getInfra() {
    return haMode ? _haRealS04 : _haMockS04;
  }

  // ── 알림 추가 ──
  function addAlert(alert) {
    setAlerts(prev => [alert, ...prev].slice(0, 50));
  }

  // ── 체크아웃 이벤트 처리 ──
  async function handleCheckoutEvent(eventType, targetPropId = selectedProp) {
    if (processing) return;
    setProcessing(true);

    const now = _s04.hhmm();
    const event = { event: eventType, propId: targetPropId, time: now };
    const booking = _S04_PROPS.find(item => item.propId === targetPropId);

    try {
      const infra = getInfra();
      const result = await checkoutService.handleCheckout(
        event,
        _S04_PROPS,
        _S04_CLEANERS,
        {
          expirePin: async entityId => {
            if (targetPropId === selectedProp) {
              setPinCountdown(true);
            }
            await infra.expirePin(entityId);
            setPinDone(prev => ({ ...prev, [targetPropId]: true }));
          },
          addAlert: alert => {
            const booking = _S04_PROPS.find(item => item.propId === alert.prop);
            addAlert({
              ...alert,
              prop: booking?.propName || alert.prop,
            });
          },
          updateStatus: (propId, newStatus) => {
            setPropStatuses(prev => ({ ...prev, [propId]: newStatus }));
            // CC 재진입 시 필터에 반영되도록 스토어에도 기록
            const allPropsId = _S04_PROPS.find(p => p.propId === propId)?.allPropsId;
            if (allPropsId !== undefined) {
              const allPropsStatus =
                newStatus === "cleaning" ? "청소중" :
                newStatus === "vacant"   ? "공실"   : "입실중";
              const newHealth =
                newStatus === "vacant"   ? "healthy" :
                newStatus === "cleaning" ? "watch"   : "degraded";
              setOverride(allPropsId, { status: allPropsStatus, automationHealth: newHealth });
            }
          },
          setAssignment: (propId, assignment) => {
            setAssignments(prev => ({ ...prev, [propId]: assignment }));
          },
          setChecklist: (propId, items) => {
            setChecklists(prev => ({ ...prev, [propId]: items }));
          },
        },
        now
      );

      if (result.status === "failed") {
        addAlert({
          type: "warn",
          prop: booking?.propName || targetPropId,
          msg: result.error || "체크아웃 이벤트 아님",
          time: now,
        });
      }
    } catch (err) {
      addAlert({ type: 'error', prop: booking?.propName || targetPropId, msg: `체크아웃 자동화 오류: ${err.message}`, time: _s04.hhmm() });
    } finally {
      setProcessing(false);
    }
  }

  // ── 청소 항목 토글 ──
  function toggleChecklistItem(itemId) {
    const items = checklists[selectedProp] || [];
    const target = items.find(item => item.id === itemId);
    if (!target || target.done) return;

    checkoutService.completeChecklistItem(selectedProp, itemId, {
      updateChecklistItem: (propId, id, done) => {
        setChecklists(prev => {
          const nextItems = (prev[propId] || []).map(item =>
            item.id === id ? { ...item, done } : item
          );
          return { ...prev, [propId]: nextItems };
        });
      },
    });
  }

  // ── 청소 완료 처리 ──
  function handleFinalizeClean() {
    checkoutService.finalizeClean(selectedProp, {
      updateStatus: (propId, status) => {
        setPropStatuses(prev => ({ ...prev, [propId]: status }));
      },
      addAlert: alert => {
        addAlert({
          ...alert,
          prop: currentBooking?.propName || alert.prop,
        });
      },
    });
  }

  // ── 알림 ACK ──
  function ackAlert(idx)  { setAlerts(prev => prev.filter((_, i) => i !== idx)); }
  function ackAllAlerts() { setAlerts([]); }

  // ── handleCheckoutRef: 연결 콜백이 항상 최신 함수 호출하도록 ──
  handleCheckoutRef.current = handleCheckoutEvent;

  // ── HA 상태 폴링 — haMode 켤 때만 연결 ──
  React.useEffect(() => {
    if (!haMode) {
      if (wsConnRef.current) { wsConnRef.current.disconnect(); wsConnRef.current = null; }
      setWsStatus('disconnected');
      return;
    }
    const lastStates = {};
    const entityIds = _S04_PROPS.map(prop => toLockEntityId(prop.propId));

    wsConnRef.current = createStatePollingConnection({
      entityIds,
      onStatusChange: setWsStatus,
      onStates: states => {
        for (const [entityId, nextState] of Object.entries(states)) {
          const prevState = lastStates[entityId];
          const oldValue = prevState?.state ?? null;
          const newValue = nextState?.state ?? null;

          if (newValue === 'locked' && oldValue === 'unlocked') {
            const match = entityId?.match(/p[_-](\d+)/i);
            const propId = match ? `P-${match[1].padStart(3,'0')}` : selectedProp;
            handleCheckoutRef.current('door_locked', propId);
          }

          lastStates[entityId] = nextState;
        }
      },
    });

    return () => { if (wsConnRef.current) { wsConnRef.current.disconnect(); wsConnRef.current = null; } };
  }, [haMode, selectedProp]);

  const errorCount = alerts.filter(a => a.type === 'error').length;
  const warnCount = alerts.filter(a => a.type === 'warn').length;
  const infoCount  = alerts.filter(a => a.type === 'info').length;
  const occupiedProps = _S04_PROPS.filter(prop => (propStatuses[prop.propId] || 'occupied') === 'occupied');
  const cleaningProps = _S04_PROPS.filter(prop => (propStatuses[prop.propId] || 'occupied') === 'cleaning');
  const readyProps = _S04_PROPS.filter(prop => (propStatuses[prop.propId] || 'occupied') === 'vacant');
  const assignedCount = Object.keys(assignments).length;
  const activeChecklistCount = Object.values(checklists).filter(items =>
    Array.isArray(items) && items.some(item => !item.done)
  ).length;
  const nextOccupiedProp = occupiedProps.find(prop => prop.propId !== selectedProp) || occupiedProps[0] || null;
  const firstPendingItem = currentItems?.find(item => !item.done) || null;
  const latestAlert = alerts[0] || null;
  const focusTone = errorCount > 0
    ? { bg:'#fef2f2', border:'#fecaca', text:'#dc2626' }
    : warnCount > 0
    ? { bg:'#fffbeb', border:'#fde68a', text:'#d97706' }
    : currentStatus === 'occupied'
    ? { bg:'#fff7ed', border:'#fed7aa', text:'#c2410c' }
    : currentStatus === 'cleaning'
    ? { bg:'#eff6ff', border:'#bfdbfe', text:'#2563eb' }
    : { bg:'#ecfdf5', border:'#a7f3d0', text:'#059669' };
  const focusTitle = errorCount > 0
    ? `긴급 알림 ${errorCount}건부터 처리해야 합니다.`
    : warnCount > 0
    ? `청소 진행 중 경고 ${warnCount}건을 먼저 확인하세요.`
    : currentStatus === 'occupied'
    ? `${currentBooking?.propName}의 퇴실 감지를 먼저 확인하세요.`
    : currentStatus === 'cleaning'
    ? `${currentBooking?.propName} 청소 마감만 끝나면 다음 예약 준비가 끝납니다.`
    : occupiedProps.length > 0
    ? `준비 완료된 숙소는 ${readyProps.length}곳이고, 다음 퇴실 대기는 ${occupiedProps.length}곳입니다.`
    : '현재 선택 숙소는 다음 예약을 받을 준비가 끝났습니다.';
  const focusDesc = errorCount > 0
    ? 'PIN 만료, 청소 배정, 체크리스트 흐름 중 멈춘 지점을 알림 피드에서 바로 확인해 주세요.'
    : warnCount > 0
    ? '수동 확인이 필요한 경고가 남아 있습니다. 누락된 청소 단계나 예외 알림을 먼저 정리하는 편이 안전합니다.'
    : currentStatus === 'occupied'
    ? '퇴실 이벤트만 들어오면 PIN 만료와 청소팀 배정이 자동으로 이어집니다. 실제 운영에서는 이 첫 이벤트 확인이 가장 중요합니다.'
    : currentStatus === 'cleaning'
    ? firstPendingItem
    ? `현재 남아 있는 다음 작업은 "${firstPendingItem.label}"입니다. 필수 항목이 모두 끝나면 숙소 상태가 바로 준비 완료로 바뀝니다.`
    : '필수 청소 항목이 모두 끝났습니다. 마지막 완료 처리만 하면 숙소가 다시 판매 가능한 상태로 전환됩니다.'
    : occupiedProps.length > 0
    ? `지금은 ${readyProps.length}곳이 준비 완료 상태입니다. 다음으로는 ${nextOccupiedProp?.propName || occupiedProps[0]?.propName}의 퇴실 예정 흐름을 챙기면 됩니다.`
    : '현재 예외나 미완료 작업이 없어서, 알림과 청소팀 상태만 가볍게 확인하면 됩니다.';
  const summaryCards = [
    { label:'퇴실 대기', value:`${occupiedProps.length}곳`, desc:'체크아웃 이벤트 확인 필요', tone:{ bg:'#fff7ed', border:'#fed7aa', text:'#c2410c' } },
    { label:'청소 진행', value:`${cleaningProps.length}곳`, desc:'체크리스트 마감 대기', tone:{ bg:'#eff6ff', border:'#bfdbfe', text:'#2563eb' } },
    { label:'청소 배정', value:`${assignedCount}건`, desc:'담당자 배정 완료', tone:{ bg:'#fefce8', border:'#fde68a', text:'#ca8a04' } },
    { label:'준비 완료', value:`${readyProps.length}곳`, desc:'다음 예약 수용 가능', tone:{ bg:'#ecfdf5', border:'#a7f3d0', text:'#059669' } },
  ];

  // HA 연결 상태 뱃지 텍스트
  const wsLabel = {
    connected: '● HA 연결됨', connecting: '◌ 연결 중', reconnecting: '◌ 재연결 중',
    disconnected: '○ 연결 해제', error: '✕ 연결 오류',
  }[wsStatus] || '○ Mock';

  // ── 렌더 ──
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin   { from{transform:rotate(0)} to{transform:rotate(360deg)} }
      `}</style>

      {/* 헤더 */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'12px 20px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 12px', fontSize:12, color:'#64748b', cursor:'pointer', fontWeight:600 }}>← 커맨드 센터</button>}
        {onBack && <div style={{ width:1, height:22, background:'#e2e8f0' }} />}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>S04 · 퇴실·청소 · 같은 단계 예외를 묶어서 처리</div>
          <div style={{ fontWeight:800, fontSize:16, color:'#1e293b', marginTop:2 }}>퇴실 감지 → PIN 만료 → 청소 배정 → 체크리스트</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {haMode && <div style={{ fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20, background: wsStatus==='connected'?'#dcfce7':'#fffbeb', border:`1px solid ${wsStatus==='connected'?'#86efac':'#fde68a'}`, color: wsStatus==='connected'?'#059669':'#d97706' }}>{wsLabel}</div>}
          <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#94a3b8' }}>
            Mock
            <div onClick={() => setHaMode(m => !m)} style={{ width:36, height:18, borderRadius:9, background: haMode?'#2563eb':'#e2e8f0', cursor:'pointer', position:'relative', transition:'background 0.2s' }}>
              <div style={{ position:'absolute', top:2, left: haMode?18:2, width:14, height:14, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
            </div>
            <span style={{ color: haMode?'#2563eb':'#94a3b8', fontWeight: haMode?700:400 }}>HA</span>
          </div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>

        {/* ── 히어로 카드: 빨강(처리필요) / 녹색(안정) ── */}
        {(occupiedProps.length > 0 || errorCount > 0) ? (
          <div style={{ background:'#fef2f2', border:'2px solid #fecaca', borderRadius:16, padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'#dc2626', marginBottom:6 }}>지금 처리해야 할 것</div>
              <div style={{ fontSize:18, fontWeight:800, color:'#b91c1c', lineHeight:1.3, marginBottom:10 }}>
                {errorCount > 0
                  ? `자동화 오류 ${errorCount}건 — 수동 확인이 필요합니다`
                  : `퇴실 대기 ${occupiedProps.length}곳 — 체크아웃 이벤트를 확인하세요`}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {occupiedProps.slice(0,3).map(prop => (
                  <div key={prop.propId} onClick={() => setSelectedProp(prop.propId)}
                    style={{ display:'flex', gap:8, alignItems:'center', padding:'7px 10px', background:'#fff', border:'1.5px solid #fecaca', borderRadius:8, cursor:'pointer' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626', flexShrink:0, animation:'pulse 1.5s ease-in-out infinite' }} />
                    <span style={{ fontSize:12, color:'#7f1d1d', fontWeight:600, flex:1 }}>{prop.propName} — {prop.guestName}님</span>
                    <span style={{ fontSize:10, fontWeight:700, color:'#dc2626', background:'#fff', border:'1px solid #fca5a5', borderRadius:4, padding:'2px 6px', flexShrink:0 }}>퇴실 대기</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
              <button onClick={() => handleCheckoutEvent('door_locked')} disabled={processing}
                style={{ padding:'10px 18px', borderRadius:10, background:'#dc2626', border:'1.5px solid #b91c1c', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                {processing ? '처리 중...' : '퇴실 흐름 다시 확인'}
              </button>
              {alerts.length > 0 && <button onClick={ackAllAlerts} style={{ padding:'8px 18px', borderRadius:10, background:'#fff', border:'1.5px solid #fecaca', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>알림 전체 확인</button>}
            </div>
          </div>
        ) : (
          <div style={{ background:'#f0fdf4', border:'2px solid #a7f3d0', borderRadius:16, padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:16 }}>
            <div>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'#059669', marginBottom:6 }}>
                {readyProps.length === _S04_PROPS.length ? '전체 준비 완료' : '청소 진행 중'}
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:'#047857', lineHeight:1.3 }}>
                {readyProps.length === _S04_PROPS.length
                  ? `${readyProps.length}개 숙소 다음 예약 준비 완료`
                  : `청소 진행 ${cleaningProps.length}곳 · 준비 완료 ${readyProps.length}곳`}
              </div>
            </div>
            <button onClick={() => nextOccupiedProp && setSelectedProp(nextOccupiedProp.propId)} disabled={!nextOccupiedProp}
              style={{ padding:'10px 18px', borderRadius:10, background:'#059669', border:'1.5px solid #047857', color:'#fff', fontSize:13, fontWeight:700, cursor: nextOccupiedProp ? 'pointer' : 'default', flexShrink:0, opacity: nextOccupiedProp ? 1 : 0.5 }}>
              다음 숙소 확인
            </button>
          </div>
        )}

        {/* ── 숙소별 상태: 빨강(처리필요) / 녹색(완료) ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div style={{ background:'#fef2f2', border:'1.5px solid #fecaca', borderRadius:12, padding:'14px' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.06em', color:'#dc2626', marginBottom:10, textTransform:'uppercase' }}>
              처리 필요 · {occupiedProps.length + cleaningProps.length}곳
            </div>
            {occupiedProps.length === 0 && cleaningProps.length === 0
              ? <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'12px 0' }}>없음</div>
              : <>
                {occupiedProps.map(prop => (
                  <div key={prop.propId} onClick={() => setSelectedProp(prop.propId)}
                    style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #fecaca', cursor:'pointer' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626', flexShrink:0, animation:'pulse 1.2s ease-in-out infinite' }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#7f1d1d', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prop.propName}</div>
                      <div style={{ fontSize:10, color:'#dc2626' }}>{prop.guestName} · 퇴실 이벤트 대기</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:'#dc2626', background:'#fff', border:'1px solid #fca5a5', borderRadius:4, padding:'2px 6px', flexShrink:0 }}>퇴실 대기</span>
                  </div>
                ))}
                {cleaningProps.map(prop => {
                  const items = checklists[prop.propId] || [];
                  const done = items.filter(i => i.done).length;
                  return (
                    <div key={prop.propId} onClick={() => setSelectedProp(prop.propId)}
                      style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #fecaca', cursor:'pointer' }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:'#d97706', flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#92400e', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prop.propName}</div>
                        <div style={{ fontSize:10, color:'#d97706' }}>{assignments[prop.propId]?.cleanerName || '배정 중'} · {done}/{items.length} 완료</div>
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, color:'#d97706', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:4, padding:'2px 6px', flexShrink:0 }}>청소 중</span>
                    </div>
                  );
                })}
              </>
            }
          </div>
          <div style={{ background:'#f0fdf4', border:'1.5px solid #a7f3d0', borderRadius:12, padding:'14px' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.06em', color:'#059669', marginBottom:10, textTransform:'uppercase' }}>
              준비 완료 · {readyProps.length}곳
            </div>
            {readyProps.length === 0
              ? <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'12px 0' }}>아직 없음</div>
              : readyProps.map(prop => (
                  <div key={prop.propId} style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #a7f3d0' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#059669', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#065f46', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prop.propName}</div>
                      <div style={{ fontSize:10, color:'#059669' }}>다음 예약 수용 가능</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:'#059669', background:'#dcfce7', border:'1px solid #86efac', borderRadius:4, padding:'2px 6px', flexShrink:0 }}>완료</span>
                  </div>
                ))
            }
          </div>
        </div>

        {/* ── 청소팀 배정 + 알림 발송 ── */}
        {currentAssign && (
          <div style={{ background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.06em', color:'#475569', textTransform:'uppercase', marginBottom:12 }}>청소팀 배정 완료</div>
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', background:'#f8fafc', borderRadius:10, marginBottom:12 }}>
              <div style={{ width:36, height:36, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>🧹</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#1e293b' }}>{currentAssign.cleanerName}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                  {currentAssign.cleanerPhone} · 도착 예정 {currentAssign.estimatedArrival}
                </div>
              </div>
              <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20, background:'#dcfce7', color:'#15803d', border:'1px solid #86efac', whiteSpace:'nowrap' }}>배정 완료</span>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button
                onClick={() => {
                  setNotifSent(prev => ({ ...prev, [`${selectedProp}-kakao`]: true }));
                  addAlert({ type:'info', prop: currentBooking?.propName || selectedProp, msg:`${currentAssign.cleanerName}님께 카카오 알림톡 발송 완료`, time: _s04.hhmm() });
                }}
                disabled={notifSent[`${selectedProp}-kakao`]}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:'1.5px solid #fde047', background: notifSent[`${selectedProp}-kakao`] ? '#fefce8' : '#fefce8', color: notifSent[`${selectedProp}-kakao`] ? '#a16207' : '#ca8a04', fontSize:12, fontWeight:700, cursor: notifSent[`${selectedProp}-kakao`] ? 'default' : 'pointer', opacity: notifSent[`${selectedProp}-kakao`] ? 0.6 : 1 }}
              >
                {notifSent[`${selectedProp}-kakao`] ? '✓ 카카오 발송 완료' : '💬 카카오 알림톡 발송'}
              </button>
              <button
                onClick={() => {
                  setNotifSent(prev => ({ ...prev, [`${selectedProp}-sms`]: true }));
                  addAlert({ type:'info', prop: currentBooking?.propName || selectedProp, msg:`${currentAssign.cleanerName}님께 문자(SMS) 발송 완료`, time: _s04.hhmm() });
                }}
                disabled={notifSent[`${selectedProp}-sms`]}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:'1.5px solid #bfdbfe', background:'#eff6ff', color: notifSent[`${selectedProp}-sms`] ? '#64748b' : '#2563eb', fontSize:12, fontWeight:700, cursor: notifSent[`${selectedProp}-sms`] ? 'default' : 'pointer', opacity: notifSent[`${selectedProp}-sms`] ? 0.6 : 1 }}
              >
                {notifSent[`${selectedProp}-sms`] ? '✓ 문자 발송 완료' : '📱 문자(SMS) 발송'}
              </button>
            </div>
          </div>
        )}

        {/* ── 선택 숙소 자동화 흐름 ── */}
        <div style={{ background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.06em', color:'#475569', textTransform:'uppercase', flex:1 }}>
              청소 체크리스트 — {currentBooking?.propName}
            </div>
            <PropStatusBadge status={currentStatus} />
          </div>
          {currentStatus === 'occupied' ? (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => handleCheckoutEvent('door_locked')} disabled={processing}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:`1.5px solid ${processing?'#e2e8f0':'#dc2626'}`, background: processing?'#f8fafc':'#dc2626', color: processing?'#94a3b8':'#fff', fontSize:13, fontWeight:700, cursor: processing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                {processing ? <><div style={{ width:13, height:13, border:'2px solid #94a3b8', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />처리 중...</> : '🔒 도어락 잠금 (퇴실 감지)'}
              </button>
              <button onClick={() => handleCheckoutEvent('manual_checkout')} disabled={processing}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:`1.5px solid ${processing?'#e2e8f0':'#d97706'}`, background: processing?'#f8fafc':'#fffbeb', color: processing?'#94a3b8':'#d97706', fontSize:13, fontWeight:700, cursor: processing?'default':'pointer' }}>
                📋 수동 체크아웃
              </button>
            </div>
          ) : currentItems ? (
            <CleaningChecklist items={currentItems} onToggle={toggleChecklistItem} onFinalize={handleFinalizeClean} propStatus={currentStatus} />
          ) : (
            <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'16px 0' }}>퇴실 감지 후 체크리스트가 자동 생성됩니다</div>
          )}
        </div>

        {/* ── 알림 ── */}
        {alerts.length > 0 && (
          <div style={{ background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <span style={{ fontSize:10, fontWeight:800, letterSpacing:'0.06em', color:'#dc2626', textTransform:'uppercase', flex:1 }}>실시간 알림 {alerts.length}건</span>
              <button onClick={ackAllAlerts} style={{ padding:'3px 9px', borderRadius:5, background:'#f8fafc', border:'1px solid #e2e8f0', color:'#64748b', fontSize:10, cursor:'pointer', fontWeight:600 }}>전체 확인</button>
            </div>
            <AlertFeedS04 alerts={alerts} onAck={ackAlert} onAckAll={ackAllAlerts} />
          </div>
        )}

      </div>
    </div>
  );
}

export default S04CheckoutPanel;
