import { useEffect, useState } from "react";

import { ALL_PROPS, INIT_ALERTS, INTERVENTION_LABELS, SC, rand, randN } from "../data/mockData";
import { OPERATIONS_STAGES, getStageById } from "../config/operationsModel.js";
import Toast from "../utils/toast";

// ============================================================
// CommandCenter.jsx — 원격 숙소 자동운영 안정화 관제 센터
// 1차 축: 자동화 건강도 (failed → degraded → watch → healthy)
// 2차 축: 운영 시점 필터 (S01~S04, 선택적 드릴다운)
// ============================================================

const CC_STAGES = OPERATIONS_STAGES;

const HEALTH_META = {
  failed:   { color:"#dc2626", strong:"#b91c1c", bg:"#fef2f2", border:"#fecaca", label:"시스템 장애",    dot:"🔴" },
  degraded: { color:"#ea580c", strong:"#c2410c", bg:"#fff7ed", border:"#fdba74", label:"성능 저하",      dot:"🟠" },
  watch:    { color:"#d97706", strong:"#a16207", bg:"#fefce8", border:"#fde047", label:"주시",           dot:"🟡" },
  healthy:  { color:"#059669", strong:"#047857", bg:"#f0fdf4", border:"#a7f3d0", label:"자동 제어 정상", dot:"🟢" },
};

const TRIAGE_TONES = {
  critical: { color:"#dc2626", strong:"#b91c1c", bg:"#fef2f2", border:"#fecaca" },
  high:     { color:"#ea580c", strong:"#c2410c", bg:"#fff7ed", border:"#fdba74" },
  watch:    { color:"#ca8a04", strong:"#a16207", bg:"#fefce8", border:"#fde047" },
  normal:   { color:"#059669", strong:"#047857", bg:"#ecfdf5", border:"#a7f3d0" },
  neutral:  { color:"#111827", strong:"#111827", bg:"#ffffff", border:"#dbe4ee" },
  muted:    { color:"#475569", strong:"#334155", bg:"#f8fafc", border:"#e2e8f0" },
};

const INTERVENTION_TYPES = {
  시스템장애: { color:"#dc2626", bg:"#fef2f2", border:"#fecaca", label:"시스템 장애" },
  현장출동:   { color:"#ea580c", bg:"#fff7ed", border:"#fdba74", label:"현장 출동"   },
  게스트안내: { color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe", label:"게스트 안내" },
  청소확인:   { color:"#d97706", bg:"#fffbeb", border:"#fde68a", label:"청소 확인"   },
  원격제어:   { color:"#059669", bg:"#f0fdf4", border:"#a7f3d0", label:"원격 제어"   },
};

// ── 헬퍼 함수들 (로직 불변) ──────────────────────────────────

function hasUrgentSignal(prop) {
  return prop.priority === "HIGH" || prop.issues.length > 0
    || prop.doorLockStatus === "오프라인" || prop.sensorHealth === "미연결";
}

function getInterventionType(prop) {
  if (prop.sensorHealth === "미연결" || prop.doorLockStatus === "오프라인") return "시스템장애";
  if (prop.doorLockStatus === "배터리부족" || prop.doorLockStatus === "미응답"
    || (prop.issues || []).some(i => i.includes("온수") || i.includes("에어컨"))) return "현장출동";
  if (prop.unreadMsg > 0) return "게스트안내";
  if (prop.status === "청소중" || prop.status === "점검중") return "청소확인";
  return "원격제어";
}

function getIoTIssueSummary(prop) {
  const dl = prop.doorLockStatus;
  const sh = prop.sensorHealth;
  if (dl === "오프라인")   return "도어락 오프라인 — 현장 확인 필요";
  if (dl === "미응답")     return "도어락 미응답 — 원격 제어 불가";
  if (dl === "배터리부족") return "도어락 배터리 임계치 — 교체 예약 필요";
  if (sh === "미연결")     return "센서 전체 미연결 — IoT 허브 재부팅 필요";
  if (sh === "일부불량")   return "일부 센서 오프라인 — HA 엔티티 확인 필요";
  return null;
}

function getIssueSummary(issue = "") {
  if (issue.includes("WiFi") || issue.includes("Wi-Fi")) return "WiFi 허브 자동복구 실패 · 원격 재부팅 필요";
  if (issue.includes("에어컨"))   return "에어컨 자동제어 무응답 · HA 엔티티 재연동 필요";
  if (issue.includes("도어락"))   return "도어락 배터리 임계치 도달 · 현장 교체 예약 필요";
  if (issue.includes("온수"))     return "온수 센서 이상 감지 · 보일러 원격 상태 확인 필요";
  if (issue.includes("청소"))     return "청소 완료 신호 미수신 · 다음 체크인 전 확인 필요";
  if (issue.includes("소음"))     return "소음 임계치 초과 감지 · 자동 경보 발송 완료";
  if (issue.includes("PIN"))      return "PIN 자동 발급 실패 · D-1 자동화 재실행 필요";
  if (issue.includes("웰컴") || issue.includes("메시지")) return "웰컴 씬 자동 발송 실패 · 수동 트리거 필요";
  if (issue.includes("스마트홈") || issue.includes("초기화")) return "스마트홈 초기화 씬 실행 실패 · HA 재실행 필요";
  if (issue.includes("유지보수")) return "유지보수 항목 미처리 · 다음 체크인 전 완료 필요";
  if (issue.includes("청소팀"))   return "청소팀 자동 배정 실패 · 수동 배정 필요";
  if (issue.includes("충돌"))     return "청소 일정 ↔ 다음 체크인 충돌 · 일정 조율 필요";
  return issue || "자동화 이슈 확인";
}

function getActionBrief(prop, stageId) {
  const iotSummary = getIoTIssueSummary(prop);
  if (iotSummary) return iotSummary;
  if (prop.issues.length > 0) return getIssueSummary(prop.issues[0]);
  if (prop.unreadMsg > 0) return `게스트 미확인 메시지 ${prop.unreadMsg}건`;
  if (stageId === "d1")        return `${prop.checkIn || "예정"} 체크인 · D-1 자동화 점검`;
  if (stageId === "checkin")   return `${prop.checkIn || "오늘"} 입실 · 체크인 자동화 확인`;
  if (stageId === "checkout")  return prop.status === "점검중" ? "점검 지연 · 다음 예약 전 확인" : "청소 진행 중 · 완료 신호 대기";
  if (stageId === "settlement") return `매출 ${(prop.revenue / 10000).toFixed(0)}만원 · 평점 ${prop.rating}`;
  if (prop.humidity >= 60) return `습도 ${prop.humidity}% 임계치 초과 · 제습 자동화 확인`;
  if (prop.temp >= 27)     return `실내 온도 ${prop.temp}° 상승 · 에어컨 원격 가동 필요`;
  return `자동 모니터링 정상 · 온도 ${prop.temp}° · 습도 ${prop.humidity}%`;
}

function getActionToneKey(prop) {
  const dl = prop.doorLockStatus;
  const sh = prop.sensorHealth;
  if (dl === "오프라인" || sh === "미연결") return "critical";
  if (hasUrgentSignal(prop)) return "critical";
  if (prop.unreadMsg > 0 || prop.status === "청소중" || prop.status === "점검중") return "high";
  if (prop.status === "예약됨") return "watch";
  return "normal";
}

// ── CommandCenter 컴포넌트 ────────────────────────────────────

function CommandCenter({onBack, onOpenScenario, onOpenHomeAssistant, initialStage = null}) {
  // 1차: 건강도 필터 (primary axis)
  const [healthFilter, setHealthFilter] = useState("all");
  // 2차: 시점 필터 (secondary, toggleable)
  const [stage, setStage] = useState(null);
  const [props] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [now, setNow] = useState(new Date());
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [healthyExpanded, setHealthyExpanded] = useState(false);
  const [alertLogExpanded, setAlertLogExpanded] = useState(false);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    const alertFeed = setInterval(() => {
      if (Math.random() < 0.12) {
        const prop = props[randN(0, props.length - 1)];
        const liveMsg = rand([
          "IoT 허브 자동복구 완료","WiFi 허브 재부팅 완료","센서 응답 없음 감지",
          "도어락 배터리 부족","체크인 자동화 완료","청소 완료 신호 수신",
          "스마트홈 씬 자동 실행 완료","소음 임계치 초과 감지",
        ]);
        const liveAudience =
          liveMsg.includes("배터리") ? "owner" :
          liveMsg.includes("센서") || liveMsg.includes("WiFi") || liveMsg.includes("허브") || liveMsg.includes("소음") ? "admin" : "log";
        setAlerts(list => [
          {
            id: Date.now(),
            type: liveAudience === "owner" ? "error" : liveAudience === "admin" ? "warn" : "info",
            prop: prop.name,
            msg: liveMsg,
            audience: liveAudience,
            time: new Date().toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit"}),
            ack: false,
          },
          ...list.slice(0, 28),
        ]);
      }
    }, 9000);
    return () => { clearInterval(clock); clearInterval(alertFeed); };
  }, [props]);

  useEffect(() => {
    if (initialStage) setStage(initialStage);
  }, [initialStage]);

  useEffect(() => { setSelProp(null); }, [healthFilter, stage]);

  const ackAlert = id => setAlerts(list => list.map(a => a.id === id ? {...a, ack:true} : a));
  const ackAll   = () => setAlerts(list => list.map(a => ({...a, ack:true})));

  // ── 건강도 버킷 ──────────────────────────────────────────
  const healthBuckets = {
    failed:   props.filter(p => p.automationHealth === "failed"),
    degraded: props.filter(p => p.automationHealth === "degraded"),
    watch:    props.filter(p => p.automationHealth === "watch"),
    healthy:  props.filter(p => p.automationHealth === "healthy"),
  };
  const siteActionCount      = props.filter(p => p.siteActionRequired).length;
  const autoRecoveredCount   = props.filter(p => p.autoRecovery === "recovered").length;
  const unrecoveredCount     = props.filter(p => p.autoRecovery === "unrecovered").length;
  const preflightPassedCount = props.filter(p => p.preflightStatus === "passed").length;

  // ── 표시 숙소 (1차 건강도 필터 + 2차 시점 필터) ─────────
  const healthFiltered = healthFilter === "all"
    ? props
    : props.filter(p => p.automationHealth === healthFilter);

  const stageObj = stage ? getStageById(stage) : null;
  const displayProps = stageObj
    ? healthFiltered.filter(p => stageObj.filter(p))
    : healthFiltered;

  const needsAttentionProps = displayProps
    .filter(p => p.automationHealth === "failed" || p.automationHealth === "degraded")
    .sort((a, b) => {
      if (a.automationHealth === "failed" && b.automationHealth !== "failed") return -1;
      if (b.automationHealth === "failed" && a.automationHealth !== "failed") return 1;
      if (a.siteActionRequired && !b.siteActionRequired) return -1;
      if (!a.siteActionRequired && b.siteActionRequired) return 1;
      const ord = {HIGH:0, MED:1, OK:2};
      return (ord[a.priority] ?? 9) - (ord[b.priority] ?? 9);
    });
  const watchProps   = displayProps.filter(p => p.automationHealth === "watch");
  const healthyProps = displayProps.filter(p => p.automationHealth === "healthy");

  // ── 알림 그룹 ────────────────────────────────────────────
  const ownerAlerts = alerts.filter(a => a.audience === "owner" && !a.ack);
  const adminAlerts = alerts.filter(a => a.audience === "admin" && !a.ack);
  const logAlerts   = alerts.filter(a => a.audience === "log");
  const ackedAlerts = alerts.filter(a => a.ack && a.audience !== "log");
  const unack = ownerAlerts.length + adminAlerts.length;

  // ── 시점 필터별 개입 필요 카운트 ─────────────────────────
  const stageAttentionCounts = CC_STAGES.filter(s => s.id !== "settlement").reduce((acc, s) => {
    acc[s.id] = props.filter(s.filter).filter(p =>
      p.automationHealth === "failed" || p.automationHealth === "degraded"
    ).length;
    return acc;
  }, {});

  // ── 액션 핸들러 ─────────────────────────────────────────
  const focusProperty = prop => setSelProp(prop);

  const openPropertyWorkspace = prop => {
    focusProperty(prop);
    onOpenHomeAssistant?.(stage || "stay", {
      source: "command-center",
      stage: stage || "stay",
      property: prop,
      headline: INTERVENTION_LABELS[prop.interventionReason] || HEALTH_META[prop.automationHealth]?.label || "상태 확인",
      reason: getActionBrief(prop, stage || "stay"),
    });
    Toast.show(`${prop.name.split("#")[0].trim()} · 대표 숙소 보드로 넘깁니다.`, "i");
  };

  // ── IoT 건강 도트 ────────────────────────────────────────
  const IoTHealthDot = ({prop: p}) => {
    const dl = p.doorLockStatus;
    const sh = p.sensorHealth;
    if (dl === "오프라인" || sh === "미연결")
      return <span title="IoT 오프라인" style={{width:7,height:7,borderRadius:"50%",background:"#dc2626",display:"inline-block",flexShrink:0}} />;
    if (dl === "미응답" || dl === "배터리부족" || sh === "일부불량")
      return <span title="IoT 일부 이상" style={{width:7,height:7,borderRadius:"50%",background:"#d97706",display:"inline-block",flexShrink:0}} />;
    return <span title="IoT 정상" style={{width:7,height:7,borderRadius:"50%",background:"#059669",display:"inline-block",flexShrink:0}} />;
  };

  // ── 개입 필요 카드 ───────────────────────────────────────
  const AttentionCard = ({p}) => {
    const isSel = selProp?.id === p.id;
    const hm    = HEALTH_META[p.automationHealth] || HEALTH_META.watch;
    const iType = getInterventionType(p);
    const iMeta = INTERVENTION_TYPES[iType];
    const brief = getActionBrief(p, stage || "stay");

    return (
      <div
        onClick={() => focusProperty(p)}
        style={{
          background: isSel ? hm.bg : "#ffffff",
          border: `1.5px solid ${isSel ? hm.color : hm.border}`,
          borderLeft: `4px solid ${hm.color}`,
          borderRadius: 10,
          padding: "11px 13px",
          marginBottom: 8,
          cursor: "pointer",
          transition: "box-shadow 0.15s",
          boxShadow: isSel ? `0 0 0 2px ${hm.border}` : "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        {/* Top row: health badge + intervention type */}
        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:7}}>
          <span style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:20,background:hm.color,color:"#fff",letterSpacing:"0.04em"}}>
            {hm.label.toUpperCase()}
          </span>
          <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:20,background:iMeta.bg,color:iMeta.color,border:`1px solid ${iMeta.border}`,marginLeft:"auto"}}>
            {iMeta.label}
          </span>
        </div>

        {/* Name */}
        <div style={{fontSize:12,fontWeight:700,color:"#1e293b",lineHeight:"1.4",marginBottom:5}}>{p.name}</div>

        {/* Issue brief */}
        <div style={{fontSize:11,color:hm.strong,lineHeight:"1.5",marginBottom:6}}>{brief}</div>

        {/* Badge row */}
        <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:20,background:"#f8fafc",color:"#475569",border:"1px solid #e2e8f0"}}>{p.status}</span>
          {p.autoRecovery === "unrecovered" && (
            <span style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:20,background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca"}}>
              복구 실패 {p.recoveryAttempts > 0 ? `${p.recoveryAttempts}회` : ""}
            </span>
          )}
          {p.autoRecovery === "recovered" && (
            <span style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:20,background:"#f0fdf4",color:"#059669",border:"1px solid #a7f3d0"}}>자동 복구 완료</span>
          )}
          {p.siteActionRequired && (
            <span style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:20,background:"#fef2f2",color:"#b91c1c",border:"1px solid #fecaca"}}>현장 조치 필요</span>
          )}
          <span style={{marginLeft:"auto"}}><IoTHealthDot prop={p} /></span>
        </div>

        <button
          style={{
            width:"100%", padding:"6px 0", borderRadius:7, border:`1.5px solid ${hm.color}`,
            background: hm.color, color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif",
          }}
          onClick={e => { e.stopPropagation(); openPropertyWorkspace(p); }}
        >
          원격 조치
        </button>
      </div>
    );
  };

  // ── 주시 / 정상 행 ───────────────────────────────────────
  const WatchRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    const brief = getActionBrief(p, stage || "stay");
    return (
      <div
        onClick={() => focusProperty(p)}
        style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"9px 12px", borderRadius:8, marginBottom:4,
          background: isSel ? "#fefce8" : "#fffef0",
          border:`1px solid ${isSel ? "#d97706" : "#fde047"}`,
          cursor:"pointer", fontSize:11,
        }}
      >
        <span style={{width:7,height:7,borderRadius:"50%",background:"#d97706",flexShrink:0}} />
        <IoTHealthDot prop={p} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontWeight:700,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
          <div style={{fontSize:10,color:"#a16207",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{brief}</div>
        </div>
        <span style={{fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:20,background:"#f8fafc",color:"#64748b",border:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{p.status}</span>
        <button
          style={{fontSize:10,padding:"3px 10px",borderRadius:20,border:"1.5px solid #d97706",background:"#fffbeb",color:"#d97706",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,whiteSpace:"nowrap"}}
          onClick={e => { e.stopPropagation(); focusProperty(p); }}
        >
          상세
        </button>
      </div>
    );
  };

  const HealthyRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    return (
      <div
        onClick={() => focusProperty(p)}
        style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"7px 12px", borderRadius:8, marginBottom:3,
          background: isSel ? "#f0fdf4" : "#f8fffe",
          border:`1px solid ${isSel ? "#059669" : "#d1fae5"}`,
          cursor:"pointer",
        }}
      >
        <span style={{width:6,height:6,borderRadius:"50%",background:"#059669",flexShrink:0}} />
        <div style={{flex:1,minWidth:0}}>
          <span style={{fontSize:11,fontWeight:600,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{p.name}</span>
        </div>
        <span style={{fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:20,background:"#d1fae5",color:"#047857",border:"1px solid #a7f3d0",whiteSpace:"nowrap"}}>{p.status}</span>
        <span style={{fontSize:9,color:"#94a3b8",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{p.temp}° {p.humidity}%</span>
      </div>
    );
  };

  // ── 상세 패널 (자동화 상태 중심) ─────────────────────────
  const DetailPanel = () => {
    if (!selProp) {
      return (
        <div className="no-sel">
          <div style={{fontSize:40,opacity:0.15,marginBottom:12}}>🛰</div>
          <div style={{fontSize:13,fontWeight:700,color:"#334155",marginBottom:6}}>개입이 필요한 숙소를 선택하세요</div>
          <div style={{fontSize:11,color:"#94a3b8",lineHeight:"1.7",textAlign:"center",marginBottom:16}}>
            선택하면 자동화 상태, 복구 이력,<br />원격 조치 방법이 바로 나옵니다
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6,width:"100%",padding:"0 8px"}}>
            {[
              {label:"개입 필요", count: needsAttentionProps.length, color:"#dc2626", bg:"#fef2f2", border:"#fecaca"},
              {label:"주시",      count: watchProps.length,          color:"#d97706", bg:"#fffbeb", border:"#fde68a"},
              {label:"정상 운영", count: healthyProps.length,        color:"#059669", bg:"#f0fdf4", border:"#a7f3d0"},
            ].map(s => (
              <div key={s.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderRadius:8,background:s.bg,border:`1px solid ${s.border}`}}>
                <span style={{fontSize:11,fontWeight:700,color:s.color}}>{s.label}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:800,color:s.color}}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const p = selProp;
    const hm = HEALTH_META[p.automationHealth] || HEALTH_META.watch;
    const iType = getInterventionType(p);
    const iMeta = INTERVENTION_TYPES[iType];
    const brief = getActionBrief(p, stage || "stay");
    const intLabel = INTERVENTION_LABELS[p.interventionReason] || null;

    return (
      <>
        {/* 헤더 */}
        <div style={{padding:"14px 16px",borderBottom:"1.5px solid #e2e8f0",flexShrink:0,background:"#fff"}}>
          <div style={{fontSize:10,color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:3}}>#{String(p.id).padStart(3,"0")} · {p.type}</div>
          <div style={{fontSize:14,fontWeight:800,color:"#1e293b",lineHeight:"1.3",marginBottom:8}}>{p.name}</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <span style={{fontSize:9,fontWeight:800,padding:"3px 9px",borderRadius:20,background:hm.color,color:"#fff"}}>{hm.label}</span>
            <span style={{fontSize:9,fontWeight:700,padding:"3px 9px",borderRadius:20,background:iMeta.bg,color:iMeta.color,border:`1px solid ${iMeta.border}`}}>{iMeta.label}</span>
            <span style={{fontSize:9,fontWeight:600,padding:"3px 9px",borderRadius:20,background:"#f8fafc",color:"#475569",border:"1px solid #e2e8f0"}}>{p.status}</span>
          </div>
        </div>

        <div className="dbody">
          {/* 자동화 상태 */}
          <div className="d-label">자동화 상태</div>

          {intLabel && (
            <div style={{padding:"8px 11px",borderRadius:8,background:hm.bg,border:`1.5px solid ${hm.border}`,marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:hm.strong}}>{intLabel}</div>
              <div style={{fontSize:11,color:"#475569",marginTop:3,lineHeight:"1.5"}}>{brief}</div>
            </div>
          )}

          {[
            ["사전 점검",
              p.preflightStatus === "passed" ? "✓ 통과" : p.preflightStatus === "failed" ? "✗ 실패" : "대기 중",
              p.preflightStatus === "passed" ? "#059669" : p.preflightStatus === "failed" ? "#dc2626" : "#d97706"],
            ["마지막 점검",   p.lastTestAt,   "#475569"],
            ["마지막 재부팅", p.lastRebootAt, "#475569"],
          ].map(([k,v,c]) => (
            <div className="d-row" key={k}>
              <span className="d-k">{k}</span>
              <span className="d-v" style={{color:c}}>{v}</span>
            </div>
          ))}

          {/* 자동 복구 이력 */}
          {p.autoRecovery !== "none" && (
            <>
              <div className="d-label" style={{marginTop:12}}>자동 복구 이력</div>
              <div style={{
                padding:"9px 11px", borderRadius:8, marginBottom:4,
                background: p.autoRecovery === "unrecovered" ? "#fef2f2" : "#f0fdf4",
                border: `1px solid ${p.autoRecovery === "unrecovered" ? "#fecaca" : "#a7f3d0"}`,
              }}>
                <div style={{fontSize:11,fontWeight:700,color:p.autoRecovery==="unrecovered"?"#dc2626":"#059669"}}>
                  {p.autoRecovery === "unrecovered"
                    ? `자동 복구 실패 — ${p.recoveryAttempts}회 시도 후 미완료`
                    : `자동 복구 완료 — ${p.recoveryAttempts}회 시도 후 정상화`}
                </div>
                <div style={{fontSize:10,color:"#64748b",marginTop:3}}>
                  {p.autoRecovery === "unrecovered"
                    ? "원격 조치 또는 현장 출동이 필요합니다"
                    : "현재 자동 모니터링 중입니다"}
                </div>
              </div>
            </>
          )}

          {/* IoT 물리 상태 */}
          <div className="d-label" style={{marginTop:12}}>IoT 물리 상태</div>
          {[["도어락", p.doorLockStatus], ["센서", p.sensorHealth]].map(([k, v]) => (
            <div className="d-row" key={k}>
              <span className="d-k">{k}</span>
              <span className="d-v" style={{
                color: v === "정상" ? "#059669" : v && v !== "—" ? "#dc2626" : "#94a3b8",
                fontWeight: v !== "정상" && v ? 700 : 500,
              }}>{v || "—"}</span>
            </div>
          ))}
          {p.vacancyMode && (
            <div style={{marginTop:6,padding:"5px 10px",borderRadius:8,background:"#f1f5f9",border:"1px solid #cbd5e1",fontSize:10,color:"#475569",fontWeight:600}}>
              🏠 공실 모드 — HVAC OFF · 침입 감지 ON
            </div>
          )}

          {/* 원격 조치 버튼 */}
          <div style={{display:"flex",flexDirection:"column",gap:7,marginTop:16}}>
            <button
              className="act-btn"
              style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontSize:12,fontWeight:700,padding:"9px 0",width:"100%"}}
              onClick={() => openPropertyWorkspace(p)}
            >
              대표 숙소 보드 열기
            </button>
            <button
              className="act-btn"
              style={{color:"#64748b",borderColor:"#e2e8f0",background:"#f8fafc",fontSize:11,width:"100%"}}
              onClick={() => setSelProp(null)}
            >
              선택 해제
            </button>
          </div>
        </div>
      </>
    );
  };

  // ── 알림 항목 렌더 ───────────────────────────────────────
  const AlertItem = ({alert, compact = false}) => {
    const typeTone = {
      error: {border:"#dc2626", bg:"#fef2f2", nameColor:"#dc2626"},
      warn:  {border:"#ea580c", bg:"#fff7ed", nameColor:"#ea580c"},
      info:  {border:"#059669", bg:"#f0fdf4", nameColor:"#059669"},
    }[alert.type] || {border:"#cbd5e1", bg:"#f8fafc", nameColor:"#64748b"};
    return (
      <div className={`aitem ${alert.ack ? "acked" : ""}`} style={{borderLeftColor:typeTone.border,background:compact?"#fafbfc":typeTone.bg}}>
        <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
          <span style={{fontSize:10,fontWeight:700,color:typeTone.nameColor,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{alert.prop}</span>
          {alert.audience === "owner" && <span style={{fontSize:8,fontWeight:700,background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca",borderRadius:10,padding:"1px 5px",whiteSpace:"nowrap"}}>현장조치</span>}
          {alert.audience === "admin" && <span style={{fontSize:8,fontWeight:700,background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:10,padding:"1px 5px",whiteSpace:"nowrap"}}>원격처리</span>}
          {alert.audience === "log"   && <span style={{fontSize:8,fontWeight:600,background:"#f8fafc",color:"#94a3b8",border:"1px solid #e2e8f0",borderRadius:10,padding:"1px 5px",whiteSpace:"nowrap"}}>기록</span>}
        </div>
        <div style={{fontSize:11,color:compact?"#94a3b8":"#4a5568",fontWeight:500,lineHeight:"1.4"}}>{alert.msg}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:3}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#a0aec0"}}>{alert.time}</span>
          {!alert.ack && <button style={{fontSize:9,padding:"2px 8px",borderRadius:20,border:`1px solid ${typeTone.border}`,cursor:"pointer",background:"#fff",color:typeTone.nameColor,fontFamily:"'DM Sans',sans-serif",fontWeight:700}} onClick={() => ackAlert(alert.id)}>확인</button>}
        </div>
      </div>
    );
  };

  // ── RENDER ───────────────────────────────────────────────
  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>

      {/* ── 헤더 바 ── */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"10px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",minHeight:54}}>
        <button onClick={onBack} style={{padding:"6px 14px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>← 뒤로</button>
        <div style={{width:1,height:26,background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:17,fontWeight:800,color:"#2563eb",whiteSpace:"nowrap",letterSpacing:"-0.5px"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div className="cc-hdr-title" style={{fontSize:11,color:"#94a3b8",fontWeight:500,whiteSpace:"nowrap",paddingTop:1}}>자동운영 안정화 관제 센터</div>
        <div className="cc-hdr-title" style={{width:1,height:26,background:"#e2e8f0",flexShrink:0}} />
        <div className="cc-hdr-clock" style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:"#475569",fontWeight:600,flexShrink:0}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:"auto",flexShrink:0}}>
          <button className="cc-hdr-ha-btn" onClick={() => onOpenHomeAssistant?.(stage || "stay")} style={{padding:"6px 13px",borderRadius:8,background:"#fff",border:"1.5px solid #e2e8f0",color:"#475569",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🏠 대표 숙소</button>
          <div style={{padding:"5px 12px",borderRadius:20,background:unack>0?"#fef2f2":"#f0fdf4",border:`1.5px solid ${unack>0?"#fecaca":"#a7f3d0"}`,display:"flex",alignItems:"center",gap:5,fontSize:11,color:unack>0?"#dc2626":"#059669",fontWeight:700,position:"relative"}}>
            🔔 {unack}
            {unack > 0 && <div style={{position:"absolute",top:-2,right:-2,width:7,height:7,background:"#dc2626",borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
        </div>
      </div>

      {/* ── 자동화 건강도 보드 (1차 축 · 인터랙티브 필터) ── */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 18px",flexShrink:0}}>
        {/* 필터 버튼 + 비율 바 */}
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
          {[
            {key:"all",      label:"전체",          count:props.length,                 color:"#475569", activeBg:"#475569", bg:"#f8fafc", border:"#e2e8f0"},
            {key:"failed",   label:"시스템 장애",   count:healthBuckets.failed.length,   color:"#dc2626", activeBg:"#dc2626", bg:"#fef2f2", border:"#fecaca"},
            {key:"degraded", label:"성능 저하",     count:healthBuckets.degraded.length, color:"#ea580c", activeBg:"#ea580c", bg:"#fff7ed", border:"#fdba74"},
            {key:"watch",    label:"주시",          count:healthBuckets.watch.length,    color:"#d97706", activeBg:"#d97706", bg:"#fffbeb", border:"#fde068"},
            {key:"healthy",  label:"정상",          count:healthBuckets.healthy.length,  color:"#059669", activeBg:"#059669", bg:"#f0fdf4", border:"#a7f3d0"},
          ].map(b => {
            const active = healthFilter === b.key;
            return (
              <button
                key={b.key}
                onClick={() => setHealthFilter(b.key)}
                style={{
                  display:"flex", alignItems:"center", gap:5,
                  padding:"4px 12px", borderRadius:20, cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif", fontWeight:700, border:"none",
                  background: active ? b.activeBg : b.bg,
                  outline: active ? `2px solid ${b.color}` : "none",
                  outlineOffset: 1,
                  color: active ? "#fff" : b.color,
                  transition:"all 0.15s",
                }}
              >
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>{b.count}</span>
                <span style={{fontSize:10,whiteSpace:"nowrap"}}>{b.label}</span>
              </button>
            );
          })}
          <div className="cc-health-bar" style={{flex:1,height:6,borderRadius:4,overflow:"hidden",background:"#f1f5f9",display:"flex",minWidth:60,marginLeft:6}}>
            {[
              {count:healthBuckets.failed.length,   color:"#dc2626"},
              {count:healthBuckets.degraded.length,  color:"#ea580c"},
              {count:healthBuckets.watch.length,     color:"#d97706"},
              {count:healthBuckets.healthy.length,   color:"#059669"},
            ].map((seg, i) => (
              <div key={i} style={{height:"100%",width:`${(seg.count/props.length)*100}%`,background:seg.color,transition:"width 0.3s"}} />
            ))}
          </div>
        </div>
        {/* 요약 통계 */}
        <div className="cc-stats-row" style={{display:"flex",gap:16,alignItems:"center"}}>
          {[
            {label:"현장 조치 필요", value:siteActionCount,      valueColor: siteActionCount > 0 ? "#dc2626" : "#059669"},
            {label:"자동복구 실패",  value:unrecoveredCount,     valueColor: unrecoveredCount > 0 ? "#dc2626" : "#059669"},
            {label:"자동복구 성공",  value:autoRecoveredCount,   valueColor:"#059669"},
            {label:"점검 통과",      value:`${preflightPassedCount}/${props.length}`, valueColor:"#059669"},
          ].map(s => (
            <div key={s.label} style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:10,color:"#94a3b8"}}>{s.label}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:800,color:s.valueColor}}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 바디 ── */}
      <div className="cc-body">
        <div className="cc-main">

          {/* ── 좌: 숙소 목록 (건강도 정렬) ── */}
          <div className="prop-panel">

            {/* 2차 시점 필터 (토글) */}
            <div style={{padding:"9px 14px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",background:"#fafbfc",flexShrink:0}}>
              <span style={{fontSize:9,color:"#94a3b8",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap",alignSelf:"center"}}>시점 필터</span>
              {CC_STAGES.filter(s => s.id !== "settlement").map(s => {
                const cnt = stageAttentionCounts[s.id];
                const active = stage === s.id;
                return (
                  <button
                    key={s.id}
                    data-active={active ? "true" : "false"}
                    onClick={() => setStage(stage === s.id ? null : s.id)}
                    style={{
                      display:"flex", alignItems:"center", gap:4,
                      padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:700,
                      cursor:"pointer", fontFamily:"'DM Sans',sans-serif",
                      background: active ? s.bg : "#fff",
                      border: `1.5px solid ${active ? s.color : "#e2e8f0"}`,
                      color: active ? s.color : "#64748b",
                    }}
                  >
                    {s.emoji} {s.code} {s.label}
                    {cnt > 0 && <span style={{fontSize:9,fontWeight:800,background: active ? s.color : "#fef2f2",color: active ? "#fff" : "#dc2626",borderRadius:10,padding:"0 5px",fontFamily:"'DM Mono',monospace"}}>{cnt}</span>}
                  </button>
                );
              })}
            </div>

            <div className="cc-scroll-sections">
              {/* 필터 결과 0건 */}
              {displayProps.length === 0 && (
                <div style={{padding:"32px 20px",textAlign:"center",color:"#94a3b8"}}>
                  <div style={{fontSize:24,marginBottom:10}}>✓</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#475569",marginBottom:4}}>해당 조건의 숙소 없음</div>
                  <div style={{fontSize:11}}>필터를 변경하거나 전체 보기를 선택하세요.</div>
                </div>
              )}
              {/* 개입 필요 (failed + degraded) */}
              <div style={{padding:"10px 12px 4px",borderBottom: needsAttentionProps.length > 0 ? "1px solid #fed7aa" : "none", background: needsAttentionProps.length > 0 ? "#fff7ed" : "#fff"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:needsAttentionProps.length > 0 ? 10 : 0}}>
                  <span style={{fontSize:10,fontWeight:800,color: needsAttentionProps.length > 0 ? "#ea580c" : "#94a3b8",letterSpacing:"0.06em",textTransform:"uppercase"}}>개입 필요</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:800,color: needsAttentionProps.length > 0 ? "#dc2626" : "#94a3b8"}}>{needsAttentionProps.length}</span>
                  {needsAttentionProps.length === 0 && <span style={{fontSize:10,color:"#94a3b8"}}>— 현재 자동 운영 정상</span>}
                </div>
                {needsAttentionProps.map(p => <AttentionCard key={p.id} p={p} />)}
              </div>

              {/* 주시 (watch, 토글 가능) */}
              <div style={{padding:"0",borderBottom:"1px solid #fde047",background:"#fffef5"}}>
                <div
                  style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",cursor:watchProps.length>0?"pointer":"default"}}
                  onClick={() => watchProps.length > 0 && setWatchExpanded(v => !v)}
                >
                  <span style={{fontSize:10,fontWeight:800,color:"#a16207",letterSpacing:"0.06em",textTransform:"uppercase"}}>주시</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:800,color:"#d97706"}}>{watchProps.length}</span>
                  <span style={{fontSize:10,color:"#a16207",marginLeft:2}}>— 자동화 이상 징후 · 개입 불필요</span>
                  {watchProps.length > 0 && <span style={{marginLeft:"auto",fontSize:10,color:"#d97706"}}>{watchExpanded?"▲":"▼"}</span>}
                </div>
                {watchExpanded && (
                  <div style={{padding:"0 10px 10px"}}>
                    {watchProps.map(p => <WatchRow key={p.id} p={p} />)}
                  </div>
                )}
              </div>

              {/* 정상 운영 (healthy, 기본 접힘) */}
              <div style={{background:"#f8fffe"}}>
                <div
                  style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",cursor:healthyProps.length>0?"pointer":"default"}}
                  onClick={() => healthyProps.length > 0 && setHealthyExpanded(v => !v)}
                >
                  <span style={{fontSize:10,fontWeight:800,color:"#047857",letterSpacing:"0.06em",textTransform:"uppercase"}}>자동 운영 정상</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:800,color:"#059669"}}>{healthyProps.length}</span>
                  <span style={{fontSize:10,color:"#047857",marginLeft:2}}>— 개입 없음</span>
                  {healthyProps.length > 0 && <span style={{marginLeft:"auto",fontSize:10,color:"#059669"}}>{healthyExpanded?"▲":"▼"}</span>}
                </div>
                {healthyExpanded && (
                  <div style={{padding:"0 10px 10px"}}>
                    {healthyProps.map(p => <HealthyRow key={p.id} p={p} />)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 중앙: 상세 패널 ── */}
          <div className="detail-panel">
            <DetailPanel />
          </div>

          {/* ── 우: 자동화 알림 (audience 그룹) ── */}
          <div className="alert-panel">
            <div className="alert-hdr">
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:3,height:13,background:"#dc2626",borderRadius:2,display:"inline-block",flexShrink:0}} />
                <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.06em",color:"#475569",textTransform:"uppercase"}}>자동화 알림</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"1px 6px",fontWeight:700}}>LIVE</span>
              </div>
              <button onClick={ackAll} style={{fontSize:10,color:"#718096",background:"none",border:"1.5px solid #e2e8f0",borderRadius:20,padding:"3px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>전체 확인</button>
            </div>

            <div className="alert-list-wrap">
              {/* 현장 조치 필요 */}
              {ownerAlerts.length > 0 && (
                <div style={{padding:"7px 10px 2px",background:"#fef2f2",borderBottom:"1px solid #fecaca"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#dc2626",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>🚨 현장 조치 필요 {ownerAlerts.length}</div>
                  {ownerAlerts.map(a => <AlertItem key={a.id} alert={a} />)}
                </div>
              )}

              {/* 원격 처리 */}
              {adminAlerts.length > 0 && (
                <div style={{padding:"7px 10px 2px",background:"#eff6ff",borderBottom:"1px solid #bfdbfe"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#2563eb",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>🔧 원격 처리 {adminAlerts.length}</div>
                  {adminAlerts.map(a => <AlertItem key={a.id} alert={a} />)}
                </div>
              )}

              {/* 확인된 알림 */}
              {ackedAlerts.length > 0 && (
                <div style={{padding:"7px 10px 2px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#94a3b8",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>확인 완료</div>
                  {ackedAlerts.slice(0,4).map(a => <AlertItem key={a.id} alert={a} compact />)}
                </div>
              )}

              {/* 자동 기록 (접힘 토글) */}
              <div style={{padding:"7px 10px",borderTop:"1px solid #e2e8f0"}}>
                <button
                  onClick={() => setAlertLogExpanded(v => !v)}
                  style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif"}}
                >
                  <span style={{fontSize:9,fontWeight:700,color:"#94a3b8",letterSpacing:"0.06em",textTransform:"uppercase"}}>자동 기록 {logAlerts.length}</span>
                  <span style={{fontSize:10,color:"#94a3b8"}}>{alertLogExpanded?"▲":"▼"}</span>
                </button>
                {alertLogExpanded && (
                  <div style={{marginTop:6}}>
                    {logAlerts.map(a => <AlertItem key={a.id} alert={a} compact />)}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}

export default CommandCenter;
