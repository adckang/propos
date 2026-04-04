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
  const BASE  = 'http://192.168.45.76:8123';
  const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw';

  async function expirePin(entityId) {
    const res = await fetch(`${BASE}/api/services/persistent_notification/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `[PROPOS] PIN 만료 처리: ${entityId}`, title: 'PIN 만료' }),
    });
    if (!res.ok) throw new Error(`HA PIN 만료 실패 (${res.status})`);
  }

  return { expirePin };
})();

// ── 목업 숙소/청소팀 데이터 ─────────────────────────────────
// checkOut = 현재 시각 +30분 → 시간창(checkOut -2h ~ +3h) 안에 항상 포함되어 데모 시간 무관
function _mockCheckOut(offsetMin) {
  const d = new Date(Date.now() + offsetMin * 60 * 1000);
  return d.toISOString().slice(0, 19);
}

const _S04_PROPS = [
  { propId: 'P-001', propName: '해운대 오션뷰',    guestName: '김민준', guestId: 'g-001', checkIn: '2026-04-05T15:00:00', checkOut: _mockCheckOut(30),  status: 'occupied' },
  { propId: 'P-002', propName: '광안리 스튜디오', guestName: '이지수', guestId: 'g-002', checkIn: '2026-04-04T16:00:00', checkOut: _mockCheckOut(60),  status: 'occupied' },
  { propId: 'P-003', propName: '남포동 투룸',      guestName: '박서준', guestId: 'g-003', checkIn: '2026-04-03T14:00:00', checkOut: _mockCheckOut(120), status: 'occupied' },
];

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
// CleanerAssignCard — 청소팀 배정 카드
// ============================================================
function CleanerAssignCard({ assignment }) {
  if (!assignment) return null;

  const statusStyle = {
    assigned:    { bg: '#fffbeb', border: '#fde68a', badge: '#d97706', text: '배정됨' },
    in_progress: { bg: '#eff6ff', border: '#bfdbfe', badge: '#2563eb', text: '청소 중' },
    done:        { bg: '#f0fdf4', border: '#bbf7d0', badge: '#16a34a', text: '완료' },
  };
  const s = statusStyle[assignment.status] || statusStyle.assigned;

  return (
    <div style={{
      background: s.bg, border: `2px solid ${s.border}`,
      borderRadius: 12, padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>🧹</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>청소팀 배정 완료</span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: s.badge,
          background: '#ffffff', border: `1px solid ${s.border}`,
          padding: '2px 8px', borderRadius: 20,
        }}>
          {s.text}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>담당자</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>{assignment.cleanerName}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>예상 도착</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: s.badge }}>
            {assignment.estimatedArrival}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>배정 시각</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#475569' }}>{assignment.assignedAt}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>숙소</div>
          <div style={{ fontSize: 13, color: '#475569' }}>{assignment.propId}</div>
        </div>
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
        알림 없음 — 대기 중
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
  const [selectedProp, setSelectedProp] = React.useState(_S04_PROPS[0].propId);
  const [propStatuses, setPropStatuses] = React.useState(() =>
    Object.fromEntries(_S04_PROPS.map(p => [p.propId, p.status]))
  );
  const [assignments,   setAssignments]  = React.useState({});   // propId → CleanerAssignment
  const [checklists,    setChecklists]   = React.useState({});   // propId → ChecklistItem[]
  const [alerts,        setAlerts]       = React.useState([]);
  const [processing,    setProcessing]   = React.useState(false);
  const [pinCountdown,  setPinCountdown] = React.useState(false);
  const [pinDone,       setPinDone]      = React.useState({});   // propId → bool

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
  async function handleCheckoutEvent(eventType) {
    if (processing) return;
    setProcessing(true);

    const now = _s04.hhmm();
    const event = { event: eventType, propId: selectedProp, time: now };
    const booking = currentBooking;

    if (!booking) {
      addAlert({ type: 'warn', prop: selectedProp, msg: '예약 정보 없음', time: now });
      setProcessing(false);
      return;
    }

    // 체크아웃 이벤트 판별
    if (!_s04.isCheckoutEvent(event, booking, now)) {
      addAlert({
        type: 'warn', prop: booking.propName,
        msg: `체크아웃 이벤트 아님 — 현재 시각(${now})이 체크아웃 시간창 밖이거나 상태 불일치`,
        time: now,
      });
      setProcessing(false);
      return;
    }

    // PIN 만료 카운트다운 시작
    setPinCountdown(true);

    try {
      // PIN 만료
      const infra = getInfra();
      await infra.expirePin(`lock.front_door_${selectedProp.toLowerCase().replace('-', '_')}`);
      setPinDone(prev => ({ ...prev, [selectedProp]: true }));
      addAlert({ type: 'info', prop: booking.propName, msg: `PIN 만료 완료 — 도어락 비활성화`, time: _s04.hhmm() });

      // 청소팀 배정
      const assignment = _s04.assignCleaner(_S04_CLEANERS, selectedProp, now);
      setAssignments(prev => ({ ...prev, [selectedProp]: assignment }));
      addAlert({
        type: 'info', prop: booking.propName,
        msg: `청소팀 배정 완료 — ${assignment.cleanerName} 도착예정 ${assignment.estimatedArrival}`,
        time: _s04.hhmm(),
      });

      // 체크리스트 생성
      const items = _s04.buildChecklist(selectedProp);
      setChecklists(prev => ({ ...prev, [selectedProp]: items }));

      // 숙소 상태 → 청소 중
      setPropStatuses(prev => ({ ...prev, [selectedProp]: 'cleaning' }));

      // 체크아웃 완료 알림
      addAlert({
        type: 'info', prop: booking.propName,
        msg: `${selectedProp} 체크아웃 완료 — ${booking.guestName}님 퇴실 (${now})`,
        time: now,
      });

    } catch (err) {
      addAlert({ type: 'error', prop: booking.propName, msg: `체크아웃 자동화 오류: ${err.message}`, time: _s04.hhmm() });
    } finally {
      setProcessing(false);
    }
  }

  // ── 청소 항목 토글 ──
  function toggleChecklistItem(itemId) {
    setChecklists(prev => {
      const items = prev[selectedProp] || [];
      return {
        ...prev,
        [selectedProp]: items.map(i => i.id === itemId ? { ...i, done: !i.done } : i),
      };
    });
  }

  // ── 청소 완료 처리 ──
  function handleFinalizeClean() {
    setPropStatuses(prev => ({ ...prev, [selectedProp]: 'vacant' }));
    addAlert({
      type: 'info', prop: currentBooking ? currentBooking.propName : selectedProp,
      msg: `${selectedProp} 청소 완료 — 숙소 준비 완료`,
      time: _s04.hhmm(),
    });
  }

  // ── 알림 ACK ──
  function ackAlert(idx)  { setAlerts(prev => prev.filter((_, i) => i !== idx)); }
  function ackAllAlerts() { setAlerts([]); }

  const errorCount = alerts.filter(a => a.type === 'error').length;
  const infoCount  = alerts.filter(a => a.type === 'info').length;

  // ── 렌더 ──
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: "'DM Sans', 'Nunito', sans-serif" }}>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin   { from{transform:rotate(0)} to{transform:rotate(360deg)} }
      `}</style>

      {/* 헤더 */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={onBack}
          style={{ padding: '6px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← 뒤로
        </button>

        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#1e293b' }}>
            UC-004 — 체크아웃 & 청소 자동화
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            퇴실 감지 · PIN 즉시 만료 · 청소팀 자동 배정 · 체크리스트
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 알림 수 */}
          {errorCount > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
              긴급 {errorCount}
            </div>
          )}
          {infoCount > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#2563eb', fontWeight: 600 }}>
              알림 {infoCount}
            </div>
          )}

          {/* Mock/HA 모드 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '5px 12px' }}>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Mock</span>
            <div
              onClick={() => setHaMode(m => !m)}
              style={{
                width: 36, height: 18, borderRadius: 9, cursor: 'pointer',
                background: haMode ? '#2563eb' : '#cbd5e1',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2,
                left: haMode ? 20 : 2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#ffffff', transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 12, color: haMode ? '#2563eb' : '#64748b', fontWeight: haMode ? 700 : 500 }}>HA</span>
          </div>
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 340px', gap: 20, padding: 24, maxWidth: 1400, margin: '0 auto' }}>

        {/* 왼쪽: 숙소 목록 */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            숙소 현황
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {_S04_PROPS.map(prop => {
              const status   = propStatuses[prop.propId] || 'occupied';
              const selected = selectedProp === prop.propId;
              const hasAssign = !!assignments[prop.propId];
              return (
                <div
                  key={prop.propId}
                  onClick={() => setSelectedProp(prop.propId)}
                  style={{
                    background: selected ? '#eff6ff' : '#ffffff',
                    border: `2px solid ${selected ? '#2563eb' : '#e2e8f0'}`,
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{prop.propName}</span>
                    <PropStatusBadge status={status} />
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{prop.guestName}님</div>
                  {hasAssign && (
                    <div style={{ fontSize: 11, color: '#d97706', marginTop: 4, fontWeight: 600 }}>
                      🧹 {assignments[prop.propId].cleanerName} 배정됨
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 청소팀 현황 */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              청소팀 현황
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {_S04_CLEANERS.map(c => (
                <div key={c.id} style={{
                  background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: c.available ? '#16a34a' : '#94a3b8',
                    animation: c.available ? 'pulse 2s infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500 }}>{c.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
                    {c.available ? `진행 ${c.activeJobs}건` : '비가용'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 가운데: 체크아웃 제어 & 체크리스트 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 현재 숙소 정보 */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#1e293b' }}>{currentBooking?.propName}</span>
              <PropStatusBadge status={currentStatus} />
              {pinDone[selectedProp] && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#dc2626',
                  background: '#fef2f2', border: '1px solid #fecaca',
                  padding: '2px 8px', borderRadius: 20,
                }}>
                  🔒 PIN 만료됨
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>게스트</div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{currentBooking?.guestName}님</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>체크아웃</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#1e293b' }}>
                  {currentBooking?.checkOut?.slice(11, 16) || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>가능 시간창</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#475569' }}>
                  {currentBooking ? (() => { try { const w = _s04.isCheckoutEvent && (() => { const d = new Date(currentBooking.checkOut); const f = new Date(d.getTime()-7200000); const u = new Date(d.getTime()+10800000); return `${f.getHours().toString().padStart(2,'0')}:${f.getMinutes().toString().padStart(2,'0')} ~ ${u.getHours().toString().padStart(2,'0')}:${u.getMinutes().toString().padStart(2,'0')}`; })(); return w; } catch(_) { return '—'; } })() : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* PIN 만료 카운트다운 */}
          <PinExpireCountdown
            active={pinCountdown && !pinDone[selectedProp]}
            onDone={() => setPinCountdown(false)}
          />

          {/* 이벤트 시뮬레이터 */}
          {currentStatus === 'occupied' && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🎮</span> 이벤트 시뮬레이터
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>테스트용</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleCheckoutEvent('door_locked')}
                  disabled={processing}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8,
                    border: `1.5px solid ${processing ? '#e2e8f0' : '#dc2626'}`,
                    background: processing ? '#f8fafc' : '#dc2626',
                    color: processing ? '#94a3b8' : '#ffffff',
                    fontSize: 13, fontWeight: 700, cursor: processing ? 'default' : 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {processing ? (
                    <>
                      <div style={{ width: 14, height: 14, border: '2px solid #94a3b8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      처리 중...
                    </>
                  ) : '🔒 도어락 잠금 (퇴실 감지)'}
                </button>
                <button
                  onClick={() => handleCheckoutEvent('manual_checkout')}
                  disabled={processing}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8,
                    border: `1.5px solid ${processing ? '#e2e8f0' : '#d97706'}`,
                    background: processing ? '#f8fafc' : '#fffbeb',
                    color: processing ? '#94a3b8' : '#d97706',
                    fontSize: 13, fontWeight: 700, cursor: processing ? 'default' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  📋 수동 체크아웃
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
                * 실제 환경에서는 HA WebSocket 이벤트로 자동 수신됩니다
              </div>
            </div>
          )}

          {/* 청소팀 배정 카드 */}
          {currentAssign && (
            <CleanerAssignCard assignment={currentAssign} />
          )}

          {/* 청소 체크리스트 */}
          {currentItems && (
            <CleaningChecklist
              items={currentItems}
              onToggle={toggleChecklistItem}
              onFinalize={handleFinalizeClean}
              propStatus={currentStatus}
            />
          )}

          {/* 청소 완료 상태 */}
          {currentStatus === 'vacant' && (
            <div style={{
              background: '#f0fdf4', border: '2px solid #bbf7d0',
              borderRadius: 12, padding: '20px 24px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#15803d' }}>숙소 준비 완료</div>
              <div style={{ fontSize: 13, color: '#16a34a', marginTop: 4 }}>다음 게스트 입실 대기 중</div>
            </div>
          )}
        </div>

        {/* 오른쪽: 알림 피드 */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            자동화 알림
          </div>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
            <AlertFeedS04 alerts={alerts} onAck={ackAlert} onAckAll={ackAllAlerts} />
          </div>
        </div>
      </div>
    </div>
  );
}
