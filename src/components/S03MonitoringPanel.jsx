// ============================================================
// S03MonitoringPanel.jsx — UC-003 체류 중 실시간 모니터링 UI
// 시나리오: 센서 LIVE 폴링 → 이상 감지 → AI 답장 초안 생성
// ============================================================

// ── 도메인 함수 (인라인) ─────────────────────────────────────
const _s03 = (() => {
  function getDefaultThresholds() {
    return {
      temp:     { warn: 30, critical: 35 },
      humidity: { warn: 80, critical: 90 },
      noise:    { warn: 60, critical: 75 },
      power:    { warn: 3000, critical: 5000 },
    };
  }

  function isAnomaly(reading, thresholds) {
    const SENSORS = ['temp', 'humidity', 'noise', 'power'];
    let highestSeverity = null;
    const anomalySensors = [];
    for (const key of SENSORS) {
      const val = reading[key]; if (val == null) continue;
      const t = thresholds[key]; if (!t) continue;
      if (val > t.critical) {
        anomalySensors.push(key); highestSeverity = 'critical';
      } else if (val > t.warn) {
        anomalySensors.push(key);
        if (highestSeverity !== 'critical') highestSeverity = 'warn';
      }
    }
    return { isAnomaly: anomalySensors.length > 0, severity: highestSeverity, sensors: anomalySensors };
  }

  function buildAnomalyAlert(propId, reading, anomaly) {
    const LABEL = { temp:'온도', humidity:'습도', noise:'소음', power:'전력' };
    const UNIT  = { temp:'°C',  humidity:'%',    noise:'dB',   power:'W' };
    const lines = anomaly.sensors.map(k => `${LABEL[k]||k} ${reading[k]}${UNIT[k]||''} 초과`);
    const badge = anomaly.severity === 'critical' ? '[긴급]' : '[경고]';
    return `${badge} ${propId} — ${lines.join(', ')} — 확인 필요`;
  }

  const REPLY_TEMPLATES = [
    { keywords:['wifi','와이파이','인터넷','wi-fi'],
      build:(b)=>`안녕하세요 ${b.guestName}님!\nWiFi 관련 문의 감사합니다.\nSSID와 비밀번호를 다시 안내드릴게요. 잠시만 기다려 주세요.` },
    { keywords:['덥','뜨겁','더워','춥','cold','hot','온도','에어컨','냉방','난방'],
      build:(b)=>`안녕하세요 ${b.guestName}님!\n실내 온도 불편 사항을 전달해 주셔서 감사합니다.\n에어컨/난방 조절 방법을 안내해 드리겠습니다.` },
    { keywords:['청소','clean','더럽','냄새','쓰레기'],
      build:(b)=>`안녕하세요 ${b.guestName}님!\n불편을 드려 죄송합니다.\n청소 담당자가 신속하게 방문하도록 조치하겠습니다.` },
    { keywords:['체크아웃','checkout','퇴실','떠나','나가'],
      build:(b)=>`안녕하세요 ${b.guestName}님!\n키는 현관에 두시고 문만 닫아 주시면 됩니다. 즐거운 여행 되셨길 바랍니다!` },
  ];

  function buildReplyDraft(msg, booking) {
    const lower = msg.toLowerCase();
    for (const tpl of REPLY_TEMPLATES) {
      if (tpl.keywords.some(kw => lower.includes(kw))) return tpl.build(booking);
    }
    return `안녕하세요 ${booking.guestName}님!\n문의 주셔서 감사합니다.\n확인 후 빠르게 답변 드리겠습니다.`;
  }

  function hhmm() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  return { getDefaultThresholds, isAnomaly, buildAnomalyAlert, buildReplyDraft, hhmm };
})();

// ── Mock Infrastructure ──────────────────────────────────────
// [R1] haMode 파라미터 제거 — 내부에서 미사용이었음
function makeMockSensorInfra() {
  // Mock: 폴링 횟수를 누적해 5번째마다 이상값 주입
  const base = { temp: 24, humidity: 62, noise: 42, power: 850 };
  let callCount = 0;

  async function getSensorStates(propId) {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
    callCount++;
    // 시뮬레이션: 5번째 폴링마다 이상값 주입 (callCount가 누적되어야 발동)
    const anomalyMode = callCount % 5 === 0;
    return {
      propId,
      time: _s03.hhmm(),
      temp:     base.temp     + (anomalyMode ? 8 : (Math.random() * 4 - 2)),
      humidity: base.humidity + (anomalyMode ? 0 : (Math.random() * 6 - 3)),
      noise:    base.noise    + (Math.random() * 10 - 5),
      power:    base.power    + (Math.random() * 200 - 100),
    };
  }
  return { getSensorStates };
}

// [R2] getDefaultThresholds() 반환값은 상수 — 렌더마다 재생성 방지
const _DEFAULT_THRESHOLDS = _s03.getDefaultThresholds();

// ── Real HA Infrastructure — haClient.getSensorStates 위임 ───
// haClient.js에 온도+습도 동시 조회 구현 완료 (temperature + humidity entity)
// 브라우저 환경에서는 window._haClientS03 또는 전역 haClient 참조
// 단일 HTML 번들에서 haClient.js 내용이 전역 스코프에 포함되면 직접 사용 가능
const _haS03 = {
  async getSensorStates(propId) {
    const HA_BASE  = 'http://192.168.45.76:8123';
    const HA_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw';

    async function getState(entityId) {
      try {
        const res = await fetch(`${HA_BASE}/api/states/${entityId}`, {
          headers: { 'Authorization': `Bearer ${HA_TOKEN}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const v = parseFloat(data.state);
        return isNaN(v) ? null : v;
      } catch (_) { return null; }
    }

    const [temp, humidity] = await Promise.all([
      getState('sensor.temperature_humidity_sensor_temperature'),
      getState('sensor.temperature_humidity_sensor_humidity'),
    ]);
    return { propId, time: _s03.hhmm(), temp, humidity, noise: null, power: null };
  },
};

// ============================================================
// SensorCard — 개별 센서 실시간 표시
// ============================================================
function SensorCard({ label, value, unit, warn, critical, icon }) {
  let statusColor = '#059669'; // green — normal
  let bgColor = '#f0fdf4';
  let statusText = '정상';

  if (value != null) {
    if (value > critical) {
      statusColor = '#dc2626'; bgColor = '#fef2f2'; statusText = '긴급';
    } else if (value > warn) {
      statusColor = '#d97706'; bgColor = '#fffbeb'; statusText = '경고';
    }
  }

  const displayValue = value != null ? value.toFixed(1) : '—';

  return (
    <div style={{
      background: bgColor,
      border: `2px solid ${statusColor}`,
      borderRadius: 12,
      padding: '16px 20px',
      minWidth: 140,
      flex: 1,
      transition: 'all 0.4s ease',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 700, color: statusColor, lineHeight: 1 }}>
        {displayValue}
        <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4, color: '#94a3b8' }}>{unit}</span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, animation: value != null ? 'pulse 2s infinite' : 'none' }} />
        <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusText}</span>
        {value != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>임계: {warn}/{critical}</span>}
      </div>
    </div>
  );
}

// ============================================================
// PropStatusBadge — 숙소별 모니터링 상태
// ============================================================
function PropMonitorBadge({ prop, readings, onSelect, selected }) {
  const r = readings[prop.propId];
  // [R2] 모듈 레벨 상수 _DEFAULT_THRESHOLDS 사용 — 렌더마다 재생성 방지
  let anomaly = null;
  if (r) {
    const a = _s03.isAnomaly(r, _DEFAULT_THRESHOLDS);
    if (a.isAnomaly) anomaly = a;
  }

  const borderColor = anomaly
    ? (anomaly.severity === 'critical' ? '#dc2626' : '#d97706')
    : '#e2e8f0';
  const bgColor = selected ? '#eff6ff' : '#ffffff';

  return (
    <div
      onClick={() => onSelect(prop.propId)}
      style={{
        border: `2px solid ${selected ? '#2563eb' : borderColor}`,
        borderRadius: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        background: bgColor,
        transition: 'all 0.2s',
        minWidth: 140,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', marginBottom: 4 }}>{prop.propName}</div>
      {r ? (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#64748b' }}>
          {r.temp != null && <span>🌡 {r.temp.toFixed(1)}°C </span>}
          {r.humidity != null && <span>💧 {r.humidity.toFixed(0)}% </span>}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>대기 중...</div>
      )}
      {anomaly && (
        <div style={{
          marginTop: 4,
          fontSize: 10,
          fontWeight: 700,
          color: anomaly.severity === 'critical' ? '#dc2626' : '#d97706',
          background: anomaly.severity === 'critical' ? '#fef2f2' : '#fffbeb',
          borderRadius: 4,
          padding: '2px 6px',
          display: 'inline-block',
        }}>
          {anomaly.severity === 'critical' ? '긴급' : '경고'} — {anomaly.sensors.join(', ')}
        </div>
      )}
    </div>
  );
}

// ============================================================
// GuestMessagePanel — AI 답장 초안
// ============================================================
function GuestMessagePanel({ booking, draft, onDraftApply, onNewMessage }) {
  const [inputMsg, setInputMsg] = React.useState('');
  const [sending, setSending] = React.useState(false);

  function handleSimulate() {
    if (!inputMsg.trim()) return;
    onNewMessage(inputMsg.trim());
    setInputMsg('');
  }

  async function handleSend() {
    if (!draft) return;
    setSending(true);
    try {
      await new Promise(r => setTimeout(r, 500));
      onDraftApply(draft);
    } finally {
      // [B3] 예외 발생 시에도 반드시 "발송 중..." 상태 해제
      setSending(false);
    }
  }

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>💬</span> AI 답장 초안
        {booking && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b', fontWeight: 400 }}>{booking.guestName}님</span>}
      </div>

      {/* 게스트 메시지 시뮬레이터 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>게스트 메시지 시뮬레이터</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={inputMsg}
            onInput={e => setInputMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSimulate()}
            placeholder="예: wifi 비밀번호 알려주세요"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              border: '1.5px solid #e2e8f0', fontSize: 13, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSimulate}
            disabled={!inputMsg.trim()}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1.5px solid #2563eb',
              background: inputMsg.trim() ? '#2563eb' : '#e2e8f0',
              color: inputMsg.trim() ? '#ffffff' : '#94a3b8',
              fontSize: 13, fontWeight: 600, cursor: inputMsg.trim() ? 'pointer' : 'default',
              transition: 'all 0.2s',
            }}
          >
            수신
          </button>
        </div>
      </div>

      {/* AI 초안 */}
      {draft ? (
        <div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>AI 생성 답장 초안</div>
          <div style={{
            background: '#f8fafc',
            border: '1.5px solid #dbeafe',
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 13,
            color: '#1e293b',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
            marginBottom: 12,
          }}>
            {draft}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSend}
              disabled={sending}
              style={{
                padding: '8px 20px', borderRadius: 8, border: '1.5px solid #059669',
                background: sending ? '#d1fae5' : '#059669',
                color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: sending ? 'default' : 'pointer',
                flex: 1,
              }}
            >
              {sending ? '발송 중...' : '확인 후 발송'}
            </button>
            <button
              onClick={() => onDraftApply(null)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0',
                background: '#f8fafc', color: '#64748b',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              초안 취소
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
          게스트 메시지를 시뮬레이션하면 AI 초안이 생성됩니다
        </div>
      )}
    </div>
  );
}

// ============================================================
// AlertFeedS03 — 이상 감지 알림 피드
// ============================================================
function AlertFeedS03({ alerts, onAck }) {
  if (alerts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>
        이상 감지 없음 — 정상 운영 중
      </div>
    );
  }

  const typeStyle = {
    error: { bg: '#fef2f2', border: '#fecaca', badge: '#dc2626', text: '[긴급]' },
    warn:  { bg: '#fffbeb', border: '#fde68a', badge: '#d97706', text: '[경고]' },
    info:  { bg: '#f0f9ff', border: '#bae6fd', badge: '#0284c7', text: '[정보]' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
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
  );
}

// ============================================================
// S03MonitoringPanel — 메인 컴포넌트
// ============================================================
function S03MonitoringPanel({ onBack }) {
  // ── 목업 숙소 목록 ──
  const PROPS = [
    { propId: 'P-001', propName: '해운대 오션뷰', guestName: '김민준', guestId: 'g-001', checkIn: '2026-04-05T15:00:00', checkOut: '2026-04-07T11:00:00', status: 'confirmed', wifi: { ssid: 'PROPOS_G1', pw: 'pw1234' } },
    { propId: 'P-002', propName: '광안리 스튜디오', guestName: '이지수', guestId: 'g-002', checkIn: '2026-04-04T16:00:00', checkOut: '2026-04-08T11:00:00', status: 'confirmed', wifi: { ssid: 'PROPOS_G2', pw: 'pw5678' } },
    { propId: 'P-003', propName: '남포동 투룸', guestName: '박서준', guestId: 'g-003', checkIn: '2026-04-03T14:00:00', checkOut: '2026-04-06T11:00:00', status: 'confirmed', wifi: { ssid: 'PROPOS_G3', pw: 'pw9012' } },
  ];

  // ── 상태 ──
  const [haMode, setHaMode]             = React.useState(false);
  const [polling, setPolling]           = React.useState(false);
  const [pollInterval, setPollInterval] = React.useState(30);   // 초 (UI에서 5~60 조정 가능)
  const [selectedProp, setSelectedProp] = React.useState(PROPS[0].propId);
  const [readings, setReadings]         = React.useState({});   // propId → SensorReading
  const [alerts, setAlerts]             = React.useState([]);
  const [drafts, setDrafts]             = React.useState({});   // propId → draftText
  const [lastPoll, setLastPoll]         = React.useState(null);
  const [countdown, setCountdown]       = React.useState(0);
  const [networkError, setNetworkError] = React.useState(false);

  const timerRef    = React.useRef(null);
  const countRef    = React.useRef(null);
  // [B1] Mock 인스턴스를 ref로 유지 — 매 pollAll 호출마다 새 인스턴스 생성 방지
  // haMode 변경 시에만 재생성 (useEffect로 관리)
  const infraRef    = React.useRef(makeMockSensorInfra());

  const currentProp = PROPS.find(p => p.propId === selectedProp) || PROPS[0];

  // ── haMode 변경 시 인프라 교체 ──
  React.useEffect(() => {
    infraRef.current = haMode ? _haS03 : makeMockSensorInfra();
  }, [haMode]);

  // ── 알림 추가 ──
  function addAlert(alert) {
    setAlerts(prev => [alert, ...prev].slice(0, 50));
  }

  // ── 센서 업데이트 ──
  function updateReadings(propId, reading) {
    setReadings(prev => ({ ...prev, [propId]: reading }));
  }

  // ── 단일 숙소 폴링 ──
  async function pollOneProp(prop, infra) {
    try {
      const reading = await infra.getSensorStates(prop.propId);
      updateReadings(prop.propId, reading);

      const anomaly = _s03.isAnomaly(reading, _DEFAULT_THRESHOLDS);
      if (anomaly.isAnomaly) {
        const msg = _s03.buildAnomalyAlert(prop.propId, reading, anomaly);
        addAlert({
          type: anomaly.severity === 'critical' ? 'error' : 'warn',
          prop: prop.propName,
          msg,
          time: reading.time,
        });
      }
      setNetworkError(false);
    } catch (err) {
      setNetworkError(true);
      addAlert({
        type: 'warn',
        prop: prop.propName,
        msg:  `센서 폴링 실패 — 마지막 정상값 유지 (${err.message})`,
        time: _s03.hhmm(),
      });
    }
  }

  // ── 전체 숙소 일괄 폴링 ──
  async function pollAll() {
    const infra = infraRef.current;  // [B1] 유지된 인스턴스 사용
    for (const prop of PROPS) {
      await pollOneProp(prop, infra);
    }
    setLastPoll(_s03.hhmm());
    setCountdown(pollInterval);
  }

  // ── 폴링 시작/중지 ──
  function startPolling() {
    setPolling(true);
    pollAll();

    timerRef.current = setInterval(() => pollAll(), pollInterval * 1000);

    countRef.current = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
  }

  function stopPolling() {
    setPolling(false);
    clearInterval(timerRef.current);
    clearInterval(countRef.current);
    timerRef.current = null;
    countRef.current = null;
  }

  React.useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      clearInterval(countRef.current);
    };
  }, []);

  // 폴링 간격 변경 시 재시작
  React.useEffect(() => {
    if (polling) {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => pollAll(), pollInterval * 1000);
      setCountdown(pollInterval);
    }
  }, [pollInterval]);

  // ── 게스트 메시지 처리 ──
  function handleGuestMessage(msgText) {
    const booking = PROPS.find(p => p.propId === selectedProp);
    // [B2] msg.text 검증 — 빈 문자열이면 buildReplyDraft에서 throw 발생하므로 조기 종료
    if (!booking || !msgText || !msgText.trim()) return;

    addAlert({
      type: 'info',
      prop: booking.propName,
      msg:  `게스트 메시지 수신: "${msgText.slice(0, 30)}${msgText.length > 30 ? '...' : ''}"`,
      time: _s03.hhmm(),
    });

    const draft = _s03.buildReplyDraft(msgText, booking);
    setDrafts(prev => ({ ...prev, [selectedProp]: draft }));

    addAlert({
      type: 'info',
      prop: booking.propName,
      msg:  `AI 답장 초안 생성 완료`,
      time: _s03.hhmm(),
    });
  }

  function handleDraftApply(text) {
    if (text) {
      addAlert({
        type: 'info',
        prop: currentProp.propName,
        msg:  `답장 발송 완료 — ${currentProp.guestName}님`,
        time: _s03.hhmm(),
      });
    }
    setDrafts(prev => ({ ...prev, [selectedProp]: null }));
  }

  function ackAlert(idx) {
    setAlerts(prev => prev.filter((_, i) => i !== idx));
  }

  function ackAllAlerts() {
    setAlerts([]);
  }

  const currentReading = readings[selectedProp];
  const errorCount  = alerts.filter(a => a.type === 'error').length;
  const warnCount   = alerts.filter(a => a.type === 'warn').length;

  // ── 렌더 ──
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: "'DM Sans', 'Nunito', sans-serif" }}>

      {/* CSS pulse animation */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
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
            UC-003 — 체류 중 실시간 모니터링
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            센서 LIVE 폴링 · 이상 감지 · AI 답장 초안
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 폴링 상태 */}
          {polling && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#059669', fontWeight: 600 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669', animation: 'pulse 1.5s infinite' }} />
              폴링 중 ({countdown}s)
            </div>
          )}

          {/* 네트워크 오류 배지 */}
          {networkError && (
            <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px' }}>
              HA 연결 오류 — stale 값 표시 중
            </div>
          )}

          {/* 알림 카운터 */}
          {(errorCount > 0 || warnCount > 0) && (
            <div style={{ display: 'flex', gap: 6 }}>
              {errorCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: '#dc2626', color: '#ffffff', borderRadius: 10, padding: '2px 8px' }}>긴급 {errorCount}</span>}
              {warnCount  > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: '#d97706', color: '#ffffff', borderRadius: 10, padding: '2px 8px' }}>경고 {warnCount}</span>}
            </div>
          )}

          {/* HA 모드 토글 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
            <span>Mock</span>
            <div
              onClick={() => setHaMode(v => !v)}
              style={{
                width: 44, height: 24, borderRadius: 12,
                background: haMode ? '#2563eb' : '#e2e8f0',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2,
                left: haMode ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%',
                background: '#ffffff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <span style={{ color: haMode ? '#2563eb' : '#94a3b8', fontWeight: haMode ? 700 : 400 }}>HA 실제</span>
          </div>

          {/* 폴링 간격 */}
          <select
            value={pollInterval}
            onChange={e => setPollInterval(Number(e.target.value))}
            disabled={polling}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1.5px solid #e2e8f0', fontSize: 12, color: '#475569', background: '#f8fafc' }}
          >
            <option value={5}>5초</option>
            <option value={10}>10초</option>
            <option value={30}>30초</option>
            <option value={60}>60초</option>
          </select>

          {/* 폴링 시작/중지 버튼 */}
          <button
            onClick={polling ? stopPolling : startPolling}
            style={{
              padding: '8px 20px', borderRadius: 8,
              border: `1.5px solid ${polling ? '#dc2626' : '#2563eb'}`,
              background: polling ? '#dc2626' : '#2563eb',
              color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {polling ? '■ 폴링 중지' : '▶ 폴링 시작'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 65px)' }}>

        {/* 좌측: 숙소 목록 + 알림 피드 */}
        <div style={{ width: 280, background: '#ffffff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          {/* 숙소 목록 */}
          <div style={{ padding: '16px', borderBottom: '1.5px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1.5px solid #e2e8f0' }}>
              <span style={{ width: 3, height: 13, background: '#2563eb', borderRadius: 2, flexShrink: 0 }} />
              모니터링 중 ({PROPS.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PROPS.map(prop => (
                <PropMonitorBadge
                  key={prop.propId}
                  prop={prop}
                  readings={readings}
                  selected={selectedProp === prop.propId}
                  onSelect={setSelectedProp}
                />
              ))}
            </div>
          </div>

          {/* 알림 피드 */}
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1.5px solid #e2e8f0' }}>
              <span style={{ width: 3, height: 13, background: '#d97706', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>알림 피드</span>
              {alerts.length > 0 && (
                <button
                  onClick={ackAllAlerts}
                  style={{ fontSize: 10, padding: '3px 9px', borderRadius: 5,
                    border: '1.5px solid #e2e8f0', background: '#f8fafc',
                    color: '#64748b', cursor: 'pointer', fontWeight: 600 }}
                >
                  전체 확인
                </button>
              )}
            </div>
            <AlertFeedS03 alerts={alerts} onAck={ackAlert} />
          </div>
        </div>

        {/* 우측: 센서 상세 */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* 선택된 숙소 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#1e293b' }}>{currentProp.propName}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                게스트: {currentProp.guestName} &nbsp;·&nbsp;
                체크인: {currentProp.checkIn?.slice(0,10)} &nbsp;·&nbsp;
                체크아웃: {currentProp.checkOut?.slice(0,10)}
              </div>
            </div>
            {lastPoll && (
              <div style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontFamily: "'DM Mono', monospace" }}>
                마지막 폴링: {lastPoll}
              </div>
            )}
          </div>

          {/* 센서 카드 그리드 */}
          <div style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 14, paddingBottom: 8, borderBottom: '1.5px solid #e2e8f0' }}>
              <span style={{ width: 3, height: 13, background: '#2563eb', borderRadius: 2, flexShrink: 0 }} />
              실시간 센서 현황
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <SensorCard
                label="온도" icon="🌡"
                value={currentReading?.temp}
                unit="°C"
                warn={T.temp.warn} critical={T.temp.critical}
              />
              <SensorCard
                label="습도" icon="💧"
                value={currentReading?.humidity}
                unit="%"
                warn={T.humidity.warn} critical={T.humidity.critical}
              />
              <SensorCard
                label="소음" icon="🔊"
                value={currentReading?.noise}
                unit="dB"
                warn={T.noise.warn} critical={T.noise.critical}
              />
              <SensorCard
                label="전력" icon="⚡"
                value={currentReading?.power}
                unit="W"
                warn={T.power.warn} critical={T.power.critical}
              />
            </div>

            {!polling && !currentReading && (
              <div style={{
                marginTop: 16, textAlign: 'center', padding: '32px 0',
                color: '#94a3b8', fontSize: 13,
                border: '1.5px dashed #e2e8f0', borderRadius: 12,
              }}>
                폴링 시작 버튼을 눌러 센서 모니터링을 시작하세요
              </div>
            )}
          </div>

          {/* 임계값 안내 */}
          <div style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 700, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1.5px solid #e2e8f0' }}>
              <span style={{ width: 3, height: 13, background: '#d97706', borderRadius: 2, flexShrink: 0 }} />
              이상 감지 임계값
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                { label:'온도', warn:`${T.temp.warn}°C`, critical:`${T.temp.critical}°C` },
                { label:'습도', warn:`${T.humidity.warn}%`, critical:`${T.humidity.critical}%` },
                { label:'소음', warn:`${T.noise.warn}dB`, critical:`${T.noise.critical}dB` },
                { label:'전력', warn:`${T.power.warn}W`, critical:`${T.power.critical}W` },
              ].map(item => (
                <div key={item.label} style={{ fontSize: 12, color: '#64748b' }}>
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  &nbsp;
                  <span style={{ color: '#d97706' }}>경고 &gt;{item.warn}</span>
                  &nbsp;/&nbsp;
                  <span style={{ color: '#dc2626' }}>긴급 &gt;{item.critical}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI 답장 패널 */}
          <GuestMessagePanel
            booking={currentProp}
            draft={drafts[selectedProp] || null}
            onDraftApply={handleDraftApply}
            onNewMessage={handleGuestMessage}
          />

        </div>
      </div>
    </div>
  );
}
