import React, { useEffect, useRef, useState } from "react";

import {
  BOOKING, CLEANERS, DEVICES_INIT, EXPENSES, HEALTH_LOG,
  INTERVENTION_LABELS, SINGLE_PROP, SMART_SWITCHES,
} from "../data/mockData";
import Toast from "../utils/toast";

// ============================================================
// HomeAssistant.jsx — 개별 숙소 원격 자동화 조치 콘솔
// 흐름: 자동화 상태 확인 → 원격 조치 → 물리 상태 → 단계 상세
// ============================================================

function HomeAssistant({ onBack, onOpenCommandCenter, initialStage = "stay", handoff = null }) {
  const [devs, setDevs]       = useState(DEVICES_INIT);
  const [msgs, setMsgs]       = useState([
    { id: 1, from: "guest", text: "체크아웃 11시 맞죠?",                         time: "09:42" },
    { id: 2, from: "host",  text: "네, 맞습니다! 짐 보관 필요하시면 말씀해 주세요 😊", time: "09:45" },
    { id: 3, from: "guest", text: "아리가또! 뷰가 너무 아름다워요 🌊",            time: "10:12" },
  ]);
  const [msgIn, setMsgIn]             = useState("");
  const [now, setNow]                 = useState(new Date());
  const [haStage, setHaStage]         = useState("stay");
  const [switches, setSwitches]       = useState(SMART_SWITCHES);
  const [currentMode, setCurrentMode] = useState(SINGLE_PROP.currentMode);
  const [logExpanded, setLogExpanded] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setHaStage(initialStage || "stay"); }, [initialStage]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs]);

  // HA 실기기 초기 상태 동기화
  useEffect(() => {
    // 메인 조명 (light.rgbcct_8002)
    fetch("/api/ha/state?entityId=light.rgbcct_8002")
      .then(r => r.json())
      .then(({ state }) => {
        if (state) setDevs(list => list.map(d => d.id === "light" ? { ...d, state: state.state === "on" } : d));
      })
      .catch(() => {});
    // 작은 스탠드 (switch.3ch_wifi_usb_switch_module_cbu_switch_1)
    fetch("/api/ha/state?entityId=switch.3ch_wifi_usb_switch_module_cbu_switch_1")
      .then(r => r.json())
      .then(({ state }) => {
        if (state) setDevs(list => list.map(d => d.id === "mood" ? { ...d, state: state.state === "on" } : d));
      })
      .catch(() => {});
  }, []);

  const toggleDev = id => {
    if (id === "light") {
      setDevs(list => {
        const current = list.find(d => d.id === "light");
        const next = !current.state;
        fetch("/api/ha/service", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: "light", service: next ? "turn_on" : "turn_off", data: { entity_id: "light.rgbcct_8002" } }),
        }).catch(() => {});
        return list.map(d => d.id === "light" ? { ...d, state: next } : d);
      });
    } else if (id === "mood") {
      setDevs(list => {
        const current = list.find(d => d.id === "mood");
        const next = !current.state;
        fetch("/api/ha/service", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: "switch", service: next ? "turn_on" : "turn_off", data: { entity_id: "switch.3ch_wifi_usb_switch_module_cbu_switch_1" } }),
        }).catch(() => {});
        return list.map(d => d.id === "mood" ? { ...d, state: next } : d);
      });
    } else {
      setDevs(list => list.map(item => item.id === id ? { ...item, state: !item.state } : item));
    }
  };

  const checkOutDate = new Date(BOOKING.checkOut);
  const checkInDate  = new Date(BOOKING.checkIn);
  const diff         = checkOutDate - now;
  const countdown    = {
    days: Math.max(0, Math.floor(diff / 86400000)),
    hours: Math.max(0, Math.floor((diff % 86400000) / 3600000)),
    mins: Math.max(0, Math.floor((diff % 3600000) / 60000)),
    secs: Math.max(0, Math.floor((diff % 60000) / 1000)),
  };
  const progress   = Math.min(100, Math.max(0, ((now - checkInDate) / (checkOutDate - checkInDate)) * 100));
  const netRevenue = EXPENSES.reduce((sum, item) => sum + item.amount, 0);

  const sendMsg = text => {
    if (!(text || "").trim()) return;
    setMsgs(list => [...list, {
      id: Date.now(), from: "host", text,
      time: now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    }]);
    setMsgIn("");
  };

  // ── 스테이지 정의 ──────────────────────────────────────────
  const HA_STAGES = [
    { id: "d1",         emoji: "📅", label: "D-1 자동화", sub: "내일 체크인",   color: "#2563eb", done: true  },
    { id: "checkin",    emoji: "🏠", label: "체크인",      sub: "입실 완료",     color: "#059669", done: true  },
    { id: "stay",       emoji: "📡", label: "체류 중",     sub: "센서 모니터링", color: "#7c3aed", done: false },
    { id: "checkout",   emoji: "🚪", label: "퇴실·청소",   sub: "체크아웃 예정", color: "#d97706", done: false },
    { id: "settlement", emoji: "💰", label: "수익 정산",   sub: "이달 정산",     color: "#0891b2", done: false },
  ];
  const currentStage = HA_STAGES.find(s => s.id === haStage) || HA_STAGES[2];

  const stageEvents = {
    d1: [
      { time: "09:00", text: "체크인 전날 자동화 스케줄이 실행됐어요." },
      { time: "09:03", text: "도어락 PIN 4821 발급을 완료했어요." },
      { time: "09:05", text: "웰컴 메시지를 게스트에게 발송했어요." },
    ],
    checkin: [
      { time: "15:21", text: "도어락 해제 이벤트를 감지했어요." },
      { time: "15:23", text: "웰컴 씬과 냉방 설정이 적용됐어요." },
      { time: "15:25", text: "입실 완료 메시지를 자동 발송했어요." },
    ],
    stay: [
      { time: "09:42", text: "게스트가 체크아웃 시간을 문의했어요." },
      { time: "10:12", text: "게스트가 전망 만족 메시지를 남겼어요." },
      { time: "10:18", text: `현재 활성 기기 ${devs.filter(d => d.state).length}대, 확인 필요 ${devs.filter(d => !d.state).length}대예요.` },
    ],
    checkout: [
      { time: "10:55", text: "퇴실 예정 시간 5분 전 알림이 발송됐어요." },
      { time: "11:02", text: "청소팀 배정 가능 상태를 확인했어요." },
      { time: "11:06", text: "유지보수 접수 여부를 점검 중이에요." },
    ],
    settlement: [
      { time: "18:10", text: "이번 예약 매출과 청소비를 집계했어요." },
      { time: "18:14", text: "플랫폼 수수료와 소모품 비용을 반영했어요." },
      { time: "18:18", text: "최종 순수익 계산을 완료했어요." },
    ],
  };

  // ── Handoff 기반 자동화 상태 ───────────────────────────────
  const handoffProperty = handoff?.property || null;
  const displayPropertyName = handoffProperty?.name || SINGLE_PROP.name;
  const displayPropertyMeta = handoffProperty
    ? `${handoffProperty.city} · ${handoffProperty.type} · ${handoffProperty.status}${handoffProperty.guest ? ` · ${handoffProperty.guest}` : ""}`
    : SINGLE_PROP.address;

  const effectiveHealth        = handoffProperty?.automationHealth || SINGLE_PROP.automationHealth;
  const effectiveReason        = handoffProperty?.interventionReason || null;
  const effectiveRecovery      = handoffProperty?.recoveryAttempts  || 0;
  const effectiveDoorLock      = handoffProperty?.doorLockStatus    || SINGLE_PROP.doorLockStatus;
  const effectiveSensorHealth  = handoffProperty?.sensorHealth      || SINGLE_PROP.sensorHealth;

  const HEALTH_TONE = {
    healthy:  { label: "자동 제어 정상", color: "#059669", bg: "#f0fdf4", border: "#a7f3d0", headBg: "#dcfce7" },
    watch:    { label: "주시",          color: "#d97706", bg: "#fffbeb", border: "#fde68a", headBg: "#fef9c3" },
    degraded: { label: "성능 저하",     color: "#ea580c", bg: "#fff7ed", border: "#fdba74", headBg: "#ffedd5" },
    failed:   { label: "시스템 장애",   color: "#dc2626", bg: "#fef2f2", border: "#fecaca", headBg: "#fee2e2" },
  };
  const ht = HEALTH_TONE[effectiveHealth] || HEALTH_TONE.healthy;
  const isNormal = effectiveHealth === "healthy";

  const MODES = [
    { key: "stay",     label: "체류 모드",  color: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
    { key: "vacant",   label: "공실 모드",  color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
    { key: "welcome",  label: "웰컴 모드",  color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    { key: "cleaning", label: "청소 모드",  color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
    { key: "winter",   label: "겨울 모드",  color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
    { key: "summer",   label: "여름 모드",  color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  ];

  const connectedDevices    = devs.filter(d => d.state).length;
  const disconnectedDevices = devs.length - connectedDevices;

  // 트리아지 항목 산출
  const needItems = [];
  if (!isNormal && effectiveReason) needItems.push(INTERVENTION_LABELS[effectiveReason] || "자동화 점검 필요");
  if (!isNormal && !effectiveReason) needItems.push("자동화 점검 필요");
  if (disconnectedDevices > 0)  needItems.push(`기기 ${disconnectedDevices}대 연결 끊김`);
  if ((handoffProperty?.unreadMsg || 0) > 0) needItems.push(`미읽음 메시지 ${handoffProperty.unreadMsg}건`);
  if ((handoffProperty?.issues   || []).length > 0) needItems.push(...(handoffProperty.issues));
  const hasUrgent = needItems.length > 0;

  const rebootSwitch = id => {
    setSwitches(list => list.map(sw => sw.id === id ? { ...sw, status: "재부팅 중...", uptime: "0초" } : sw));
    Toast.show("스마트 스위치 재부팅 명령을 전송했습니다.", "i");
    setTimeout(() => {
      setSwitches(list => list.map(sw => sw.id === id ? { ...sw, status: "정상", lastReboot: "방금", uptime: "1분" } : sw));
    }, 3000);
  };

  const SCENES = [
    { label: "🌅 아침 모드",  action: "morning"  },
    { label: "🌙 취침 모드",  action: "sleep"    },
    { label: "🎬 영화 모드",  action: "movie"    },
    { label: "🏠 퇴실 모드",  action: "checkout" },
  ];

  return (
    <div className="ha-root">
      {/* ── 탑바 ──────────────────────────────────────────────── */}
      <div className="ha-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0, fontFamily: "'DM Sans',sans-serif" }}
            >
              ← 뒤로
            </button>
          )}
          {onBack && <div style={{ width: 1, height: 24, background: "#e2e8f0", flexShrink: 0 }} />}
          <span style={{ fontSize: 22, flexShrink: 0 }}>{SINGLE_PROP.emoji || "🏠"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>홈 어시스턴트 · 원격 자동화 조치 콘솔</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1e293b", lineHeight: 1.2 }}>{displayPropertyName}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{displayPropertyMeta}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span className="ha-topbar-badges" style={{ background: ht.bg, color: ht.color, border: `1px solid ${ht.border}`, fontSize: 11, padding: "4px 12px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" }}>
              ● {ht.label}
            </span>
            <span className="ha-topbar-badges" style={{ background: disconnectedDevices === 0 ? "#ecfdf5" : "#fffbeb", color: disconnectedDevices === 0 ? "#059669" : "#d97706", border: `1px solid ${disconnectedDevices === 0 ? "#a7f3d0" : "#fde68a"}`, fontSize: 11, padding: "4px 12px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" }}>
              ● 홈 어시스턴트 {disconnectedDevices === 0 ? "연결 정상" : "일부 확인 필요"}
            </span>
            <div className="ha-topbar-clock" style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, color: "#2563eb", fontWeight: 700 }}>
                {now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                {now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 타임라인 스테퍼 ───────────────────────────────────── */}
      <div className="ha-timeline">
        {HA_STAGES.map((stage, index) => (
          <React.Fragment key={stage.id}>
            <div
              className="ha-step"
              onClick={() => setHaStage(stage.id)}
              style={{ opacity: !stage.done && haStage !== stage.id ? 0.55 : 1 }}
            >
              <div
                className="ha-step-dot"
                style={{
                  background: stage.id === haStage ? stage.color : stage.done ? "#e2e8f0" : "#f1f5f9",
                  color: stage.id === haStage ? "#fff" : stage.done ? "#64748b" : "#94a3b8",
                  border: stage.id !== haStage && !stage.done ? `2px solid ${stage.color}` : "2px solid transparent",
                  boxShadow: stage.id === haStage ? `0 0 0 3px ${stage.color}33` : "none",
                }}
              >
                {stage.done && stage.id !== haStage ? "✓" : stage.emoji}
              </div>
              <div
                className="ha-step-label"
                style={{ color: stage.id === haStage ? stage.color : stage.done ? "#475569" : "#94a3b8", fontWeight: stage.id === haStage ? 800 : 600 }}
              >
                {stage.label}
              </div>
              <div className="ha-step-sub">{stage.sub}</div>
            </div>
            {index < HA_STAGES.length - 1 && (
              <div className="ha-step-line" style={{ background: stage.done ? "#059669" : "#e2e8f0" }} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="ha-content">

        {/* ═══════════════════════════════════════════════════════
            1순위 — 자동화 상태 카드 (handoff 기반, 가장 먼저 표시)
            ═══════════════════════════════════════════════════════ */}
        <div style={{
          background: ht.bg,
          border: `2px solid ${ht.border}`,
          borderRadius: 16,
          marginBottom: 14,
          overflow: "hidden",
        }}>
          {/* 헤더 */}
          <div className="ha-status-hdr" style={{ background: ht.headBg, padding: "14px 20px", borderBottom: `1px solid ${ht.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ht.color, marginBottom: 4 }}>
                {isNormal ? "지금 안정" : "지금 처리해야 할 것"}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: isNormal ? "#047857" : ht.color, lineHeight: 1.2 }}>
                {isNormal
                  ? `${displayPropertyName} — 개입이 필요한 이슈 없음`
                  : handoff?.headline || (INTERVENTION_LABELS[effectiveReason] || "자동화 점검이 필요합니다")}
              </div>
              {!isNormal && effectiveReason && (
                <div style={{ fontSize: 12, color: ht.color, marginTop: 6, fontWeight: 600 }}>
                  원인: {INTERVENTION_LABELS[effectiveReason] || effectiveReason}
                  {effectiveRecovery > 0 && ` · 자동 복구 ${effectiveRecovery}회 시도`}
                </div>
              )}
            </div>
            <div className="ha-status-hdr-actions" style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
              {!isNormal && (
                <button
                  onClick={() => Toast.show("시스템 점검을 실행했습니다. 결과는 로그에서 확인하세요.", "s")}
                  style={{ padding: "9px 18px", borderRadius: 8, border: `1.5px solid ${ht.border}`, background: ht.color, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap" }}
                >
                  점검 재실행
                </button>
              )}
              <button
                onClick={() => onOpenCommandCenter?.(haStage)}
                style={{ padding: "9px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap" }}
              >
                ← 커맨드 센터
              </button>
            </div>
          </div>
          {/* 상태 메타 행 */}
          <div style={{ padding: "12px 20px", display: "flex", gap: 24 }}>
            {[
              ["자동화 건강도", ht.label, ht.color],
              ["사전 점검",     SINGLE_PROP.preflightStatus === "passed" ? "통과" : SINGLE_PROP.preflightStatus === "pending" ? "대기" : "실패",
                               SINGLE_PROP.preflightStatus === "passed" ? "#059669" : "#d97706"],
              ["마지막 점검",   SINGLE_PROP.lastTestAt,  "#475569"],
              ["마지막 재부팅", SINGLE_PROP.lastRebootAt, "#475569"],
              ["도어락",        effectiveDoorLock, effectiveDoorLock === "정상" ? "#059669" : "#dc2626"],
              ["센서",          effectiveSensorHealth, effectiveSensorHealth === "정상" ? "#059669" : "#d97706"],
            ].map(([k, v, c]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 70 }}>
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>{k}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 처리 필요 / 완료 체크리스트 ── */}
        <div className="ha-checklist-grid">
          <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: "#dc2626", marginBottom: 10, textTransform: "uppercase" }}>처리 필요</div>
            {(needItems.length > 0 ? needItems : ["처리 필요 항목 없음"]).map(item => (
              <div key={item} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #fecaca" }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: "#fef2f2", border: "1.5px solid #dc2626", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: needItems.length > 0 ? "#7f1d1d" : "#94a3b8", fontWeight: 600 }}>{item}</span>
              </div>
            ))}
          </div>
          <div style={{ background: "#f0fdf4", border: "1.5px solid #a7f3d0", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: "#059669", marginBottom: 10, textTransform: "uppercase" }}>완료 / 정상</div>
            {[
              effectiveDoorLock === "정상" && "도어락 연결 정상",
              effectiveSensorHealth === "정상" && "센서 정상",
              connectedDevices > 0 && `기기 ${connectedDevices}대 ON`,
              SINGLE_PROP.preflightStatus === "passed" && "사전 점검 통과",
            ].filter(Boolean).map(item => (
              <div key={item} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #a7f3d0" }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, flexShrink: 0, fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 12, color: "#065f46", fontWeight: 600 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            2순위 — 빠른 제어: 스마트 스위치 재부팅 + 씬 실행
            ═══════════════════════════════════════════════════════ */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>빠른 제어</div>
            <div className="ha-scenes-row" style={{ display: "flex", gap: 6 }}>
              {SCENES.map(scene => (
                <button key={scene.action} onClick={() => Toast.show(`${scene.label} 씬을 실행했습니다.`, "s")} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 20, border: "1.5px solid #bfdbfe", background: "#eff6ff", color: "#2563eb", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 700 }}>
                  {scene.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {switches.map(sw => (
              <div key={sw.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: sw.status === "정상" ? "#f0fdf4" : sw.status === "주의" ? "#fffbeb" : "#eff6ff", border: `1px solid ${sw.status === "정상" ? "#a7f3d0" : sw.status === "주의" ? "#fde68a" : "#bfdbfe"}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1e293b" }}>{sw.label}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sw.type} · 업타임 {sw.uptime}</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>재부팅 {sw.lastReboot}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: sw.status === "정상" ? "#dcfce7" : sw.status === "주의" ? "#fef9c3" : "#eff6ff", color: sw.status === "정상" ? "#15803d" : sw.status === "주의" ? "#a16207" : "#2563eb" }}>{sw.status}</span>
                  <button onClick={() => rebootSwitch(sw.id)} style={{ fontSize: 10, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>재부팅</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 운영 모드 (useState 기반 실제 전환) ── */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 10 }}>운영 모드</div>
          <div className="ha-mode-grid">
            {MODES.map(m => {
              const isActive = currentMode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => { setCurrentMode(m.key); Toast.show(`${m.label}으로 전환했습니다.`, "s"); }}
                  style={{ padding: "8px 4px", borderRadius: 8, border: `1.5px solid ${isActive ? m.border : "#e2e8f0"}`, background: isActive ? m.bg : "#f8fafc", color: isActive ? m.color : "#94a3b8", fontSize: 10, fontWeight: isActive ? 800 : 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s" }}
                >
                  {m.label}
                  {isActive && <div style={{ fontSize: 8, marginTop: 2 }}>● 활성</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            3순위 — 물리 상태: 센서 수치 + 기기 현황 · 빠른 제어
            ═══════════════════════════════════════════════════════ */}
        {(() => {
          const categories = [
            { key: "security",      label: "보안",   color: "#dc2626" },
            { key: "climate",       label: "냉난방", color: "#2563eb" },
            { key: "lighting",      label: "조명",   color: "#d97706" },
            { key: "entertainment", label: "엔터",   color: "#7c3aed" },
            { key: "comfort",       label: "편의",   color: "#059669" },
          ];
          return (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#1e293b" }}>기기 현황</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>· 빠른 제어</span>
                  <span style={{ fontSize: 11, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", borderRadius: 20, padding: "2px 8px", fontWeight: 700 }}>ON {connectedDevices}</span>
                  <span style={{ fontSize: 11, background: "#f8fafc", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 20, padding: "2px 8px", fontWeight: 700 }}>OFF {disconnectedDevices}</span>
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  {[
                    { label: "온도", value: `${SINGLE_PROP.temp}°C`, color: "#2563eb" },
                    { label: "습도", value: `${SINGLE_PROP.humidity}%`, color: "#7c3aed" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0 }}>
                {categories.map(cat => {
                  const catDevs = devs.filter(d => d.category === cat.key);
                  if (catDevs.length === 0) return null;
                  return (
                    <div key={cat.key} style={{ borderRight: "1px solid #f1f5f9", padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{cat.label}</div>
                      {catDevs.map(dev => (
                        <div key={dev.id} onClick={() => toggleDev(dev.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: dev.state ? `${cat.color}10` : "#f8fafc", border: `1px solid ${dev.state ? `${cat.color}33` : "#f1f5f9"}`, transition: "all 0.15s" }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>{dev.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: dev.state ? cat.color : "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dev.label}</div>
                            {dev.temp && <div style={{ fontSize: 9, color: "#94a3b8", fontFamily: "'DM Mono',monospace" }}>{dev.temp}°C</div>}
                          </div>
                          <div style={{ width: 28, height: 16, borderRadius: 8, background: dev.state ? cat.color : "#e2e8f0", position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                            <div style={{ position: "absolute", top: 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", left: dev.state ? "calc(100% - 14px)" : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            4순위 — 단계별 상세 드릴다운
            ═══════════════════════════════════════════════════════ */}
        <div className="ha-stage-header">
          <span className="ha-stage-icon">{currentStage.emoji}</span>
          <div className="ha-stage-title" style={{ color: currentStage.color }}>{currentStage.label}</div>
          <div className="ha-stage-sub">— {currentStage.sub}</div>
        </div>

        <div className="ha-event-card" style={{ marginBottom: 14 }}>
          <div className="ha-label">최근 운영 이벤트</div>
          <div className="ha-event-list">
            {stageEvents[haStage].map(event => (
              <div key={`${event.time}-${event.text}`} className="ha-event-row">
                <div className="ha-event-time">{event.time}</div>
                <div className="ha-event-dot" style={{ background: currentStage.color }} />
                <div className="ha-event-text">{event.text}</div>
              </div>
            ))}
          </div>
        </div>

        {haStage === "d1" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div className="ha-card" style={{ borderTop: "3px solid #2563eb" }}>
                <div className="ha-label">도어락 PIN 발급</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 32, fontWeight: 700, color: "#2563eb", letterSpacing: 8 }}>4821</div>
                <div style={{ fontSize: 11, color: "#059669", marginTop: 6, fontWeight: 600 }}>✓ 발급 완료 · 체크인 1시간 전부터 유효</div>
              </div>
              <div className="ha-card" style={{ borderTop: "3px solid #059669" }}>
                <div className="ha-label">웰컴 메시지</div>
                <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.6, marginTop: 4 }}>
                  {BOOKING.guest.name}님, 내일 체크인을 환영합니다! PIN: 4821
                </div>
                <span style={{ display: "inline-block", marginTop: 10, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 700 }}>✓ 발송 완료</span>
              </div>
            </div>
            <div className="ha-card">
              <div className="ha-label">스마트홈 초기화</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[["🌡 에어컨","24°C 설정","#2563eb"],["💡 조명","환영 모드","#d97706"],["🔒 도어락","초기화 완료","#059669"]].map(([label, value, color]) => (
                  <div key={label} style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{label.split(" ")[0]}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label.split(" ").slice(1).join(" ")}</div>
                    <div style={{ fontSize: 12, color, fontWeight: 700, marginTop: 4 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button className="act-btn" style={{ color: "#2563eb", borderColor: "#bfdbfe", background: "#eff6ff" }} onClick={() => Toast.show("D-1 자동화를 재실행했습니다.", "s")}>⚡ D-1 자동화 재실행</button>
                <button className="act-btn" style={{ color: "#718096", borderColor: "#e2e8f0", background: "#f8fafc" }} onClick={() => Toast.show("PIN을 재발급했습니다.", "i")}>↻ PIN 재발급</button>
              </div>
            </div>
          </>
        )}

        {haStage === "checkin" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div className="ha-card" style={{ borderTop: "3px solid #059669" }}>
                <div className="ha-label">입실 확인</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 26, fontWeight: 700, color: "#059669" }}>15:23</div>
                <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>오늘 · 실제 입실</div>
                <span style={{ display: "inline-block", marginTop: 10, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", fontSize: 11, padding: "4px 12px", borderRadius: 20, fontWeight: 700 }}>✓ 도어락 감지 완료</span>
              </div>
              <div className="ha-card" style={{ borderTop: "3px solid #2563eb" }}>
                <div className="ha-label">체크아웃 예정</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 26, fontWeight: 700, color: "#2563eb" }}>{BOOKING.checkOut.slice(5, 10).replace("-", "/")}</div>
                <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>11:00 AM</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#a0aec0", marginTop: 12, marginBottom: 6 }}>
                  <span>{progress.toFixed(0)}% 경과</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
              </div>
            </div>
            <div className="ha-card">
              <div className="ha-label">체크인 씬 실행 결과</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["🎬 웰컴 씬 실행",true],["💡 조명 켜짐",true],["❄️ 에어컨 24°C",true],["💬 게스트 채팅 오픈",true],["📩 입실 확인 메시지",true],["🔓 도어락 해제 후 복원",true]].map(([item, done], index) => (
                  <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 12px", background: done ? "#f0fdf4" : "#f7f9fc", borderRadius: 8, border: `1px solid ${done ? "#a7f3d0" : "#e2e8f0"}` }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: done ? "#059669" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, flexShrink: 0, fontWeight: 700 }}>{done ? "✓" : ""}</div>
                    <span style={{ fontSize: 12, color: done ? "#065f46" : "#718096", fontWeight: done ? 600 : 400 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {haStage === "stay" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "온도", value: `${SINGLE_PROP.temp}°C`, icon: "🌡", color: "#2563eb", ok: true },
                { label: "습도", value: `${SINGLE_PROP.humidity}%`, icon: "💧", color: "#4a5568", ok: true },
                { label: "소음", value: "—", icon: "🔊", color: "#94a3b8", ok: false },
                { label: "전력", value: "—", icon: "⚡", color: "#94a3b8", ok: false },
              ].map(card => (
                <div key={card.label} className="ha-card" style={{ marginBottom: 0, borderTop: `3px solid ${card.ok && card.value !== "—" ? "#059669" : "#dc2626"}`, padding: 14 }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{card.icon}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700, color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, fontWeight: 600 }}>{card.label}</div>
                  <div style={{ fontSize: 9, color: card.ok && card.value !== "—" ? "#059669" : "#dc2626", fontWeight: 600, marginTop: 2 }}>
                    {card.ok && card.value !== "—" ? "정상" : "미연결"}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 14 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", maxHeight: 340 }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: "#f7f9fc" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a202c" }}>{BOOKING.guest.avatar} {BOOKING.guest.name} 님</div>
                  <span style={{ background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>● 온라인</span>
                </div>
                <div ref={chatRef} className="chat-msgs" style={{ flex: 1 }}>
                  {msgs.map(message => (
                    <div key={message.id} style={{ display: "flex", flexDirection: "column", alignItems: message.from === "host" ? "flex-end" : "flex-start" }}>
                      <div className={`chat-b chat-${message.from}`}>{message.text}</div>
                      <div style={{ fontSize: 10, color: "#a0aec0", marginBottom: 6, alignSelf: message.from === "host" ? "flex-end" : "flex-start" }}>{message.time}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "10px 12px", borderTop: "1px solid #e2e8f0", flexShrink: 0, background: "#f7f9fc" }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {["체크아웃 안내","와이파이 정보","불편사항 접수"].map(quick => (
                      <button key={quick} onClick={() => sendMsg(quick)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: "#fff", border: "1.5px solid #e2e8f0", color: "#4a5568", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>{quick}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="msg-in" placeholder="메시지 입력..." value={msgIn} onChange={e => setMsgIn(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg(msgIn.slice(0, 2000))} />
                    <button className="act-btn" style={{ color: "#fff", borderColor: "#2563eb", background: "#2563eb", fontWeight: 700, fontSize: 11, padding: "5px 12px" }} onClick={() => sendMsg(msgIn)}>전송</button>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="ha-card" style={{ marginBottom: 0 }}>
                  <div className="ha-label">특이사항</div>
                  <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.7 }}>{BOOKING.specialRequests}</div>
                </div>
                <div className="ha-card" style={{ marginBottom: 0 }}>
                  <div className="ha-label">체크아웃까지</div>
                  <div style={{ display: "flex", justifyContent: "space-around" }}>
                    {[[countdown.days,"일"],[countdown.hours,"시"],[countdown.mins,"분"],[countdown.secs,"초"]].map(([value, unit], index) => (
                      <div key={unit} style={{ display: "flex", alignItems: "center" }}>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color: "#2563eb" }}>{String(value).padStart(2, "0")}</div>
                          <div style={{ fontSize: 10, color: "#a0aec0", marginTop: 2 }}>{unit}</div>
                        </div>
                        {index < 3 && <span style={{ color: "#e2e8f0", margin: "0 3px", paddingBottom: 10, fontSize: 18 }}>:</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {haStage === "checkout" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "PIN 상태",  value: "만료 완료", color: "#059669" },
                { label: "청소 상태", value: "진행 중",   color: "#d97706" },
                { label: "퇴실 청소", value: "오늘",      color: "#2563eb" },
              ].map(card => (
                <div key={card.label} className="ha-card" style={{ marginBottom: 0, borderTop: `3px solid ${card.color}` }}>
                  <div className="ha-label">{card.label}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="ha-card">
                <div className="ha-label">청소 인력 배정</div>
                {CLEANERS.slice(0, 2).map(cleaner => (
                  <div key={cleaner.id} className="cleaner-card">
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: cleaner.status === "가용" ? "#059669" : cleaner.status === "작업중" ? "#d97706" : "#cbd5e0", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a202c" }}>{cleaner.name}</div>
                      <div style={{ fontSize: 11, color: "#718096", marginTop: 2 }}>{cleaner.zone} · {cleaner.status}</div>
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#d97706", fontWeight: 600 }}>★{cleaner.rating}</div>
                    {cleaner.status === "가용" && <button className="act-btn" style={{ color: "#059669", borderColor: "#a7f3d0", background: "#ecfdf5", fontSize: 10, padding: "4px 9px" }}>배정</button>}
                  </div>
                ))}
              </div>
              <div className="ha-card">
                <div className="ha-label">청소 체크리스트</div>
                {[["침구 교체",true],["화장실 청소",true],["주방 청소",true],["바닥 청소",false],["쓰레기 비우기",false]].map(([item, done], index) => (
                  <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: done ? "#059669" : "#f1f5f9", border: `1.5px solid ${done ? "#059669" : "#e2e8f0"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, flexShrink: 0, fontWeight: 700 }}>{done ? "✓" : ""}</div>
                    <span style={{ fontSize: 12, color: done ? "#065f46" : "#64748b", fontWeight: done ? 600 : 400, textDecoration: done ? "line-through" : "" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="ha-card" style={{ marginTop: 14 }}>
              <div className="ha-label">유지보수 이슈</div>
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "#fef2f2", border: "1.5px solid #fecaca", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>⚠ 욕실 샤워헤드 수압 약함 (게스트 보고)</span>
                <button className="act-btn" style={{ color: "#dc2626", borderColor: "#fecaca", background: "#fff", fontSize: 11, padding: "5px 10px" }}>처리</button>
              </div>
            </div>
          </>
        )}

        {haStage === "settlement" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "객실 매출", value: "1,250,000원", color: "#059669" },
                { label: "총 비용",   value: "235,000원",   color: "#dc2626" },
                { label: "순수익",    value: `${(netRevenue / 10000).toFixed(0)}만원`, color: "#2563eb" },
              ].map(card => (
                <div key={card.label} className="ha-card" style={{ marginBottom: 0, borderTop: `3px solid ${card.color}` }}>
                  <div className="ha-label">{card.label}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>
            <div className="ha-card">
              <div className="ha-label">이번 예약 수익 내역</div>
              {EXPENSES.map((expense, index) => (
                <div key={index} className="ha-drow">
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: expense.type === "income" ? "#059669" : "#dc2626" }} />
                    <span style={{ fontSize: 13, color: "#1a202c" }}>{expense.desc}</span>
                  </div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700, color: expense.type === "income" ? "#059669" : "#dc2626" }}>
                    {expense.type === "income" ? "+" : ""}{expense.amount.toLocaleString()}원
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 0 4px", borderTop: "2px solid #e2e8f0", marginTop: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1a202c" }}>최종 순수익</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: "#2563eb" }}>+{netRevenue.toLocaleString()}원</span>
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════
            5순위 — 자동화 실행 로그 (접기/펼치기)
            ═══════════════════════════════════════════════════════ */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, marginTop: 14, overflow: "hidden" }}>
          <button
            onClick={() => setLogExpanded(v => !v)}
            style={{ width: "100%", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
          >
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>자동화 실행 로그</span>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{logExpanded ? "▲ 접기" : "▼ 펼치기"}</span>
          </button>
          {logExpanded && (
            <div style={{ padding: "0 16px 12px" }}>
              {HEALTH_LOG.map((entry, idx) => (
                <div key={`${entry.time}-${idx}`} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#94a3b8", flexShrink: 0, paddingTop: 1, width: 36 }}>{entry.time}</span>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: entry.status === "ok" ? "#059669" : "#dc2626", flexShrink: 0, marginTop: 4 }} />
                  <span style={{ fontSize: 11, color: entry.status === "ok" ? "#374151" : "#dc2626", fontWeight: entry.type === "test" || entry.type === "auto" ? 600 : 400, flex: 1, lineHeight: 1.5 }}>{entry.msg}</span>
                  <span style={{ fontSize: 9, color: "#94a3b8", flexShrink: 0, fontWeight: 600 }}>{entry.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default HomeAssistant;
