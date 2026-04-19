import { useEffect, useState } from "react";

import CommandCenter from "./CommandCenter";
import D1AutomationPanel from "./D1AutomationPanel";
import HomeAssistant from "./HomeAssistant";
import S02CheckinPanel from "./S02CheckinPanel";
import S03MonitoringPanel from "./S03MonitoringPanel";
import S04CheckoutPanel from "./S04CheckoutPanel";
import S05RevenuePanel from "./S05RevenuePanel";
import { ALL_PROPS, INIT_ALERTS } from "../data/mockData";
import { getPortalStageCards } from "../config/operationsModel.js";

// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// 상태: screen ("landing" | "ha" | "cc" | "d1" | "s02" | "s03" | "s04" | "s05"), now
// ============================================================

function App() {
  const [screen, setScreen] = useState("landing");
  const [ccStage, setCcStage] = useState("stay");
  const [haStage, setHaStage] = useState("stay");
  const [haContext, setHaContext] = useState(null);
  const [now, setNow] = useState(new Date());

  const reservedCount = ALL_PROPS.filter((prop) => prop.status === "예약됨").length;
  const urgentCount = ALL_PROPS.filter((prop) => prop.priority === "HIGH").length;
  const checkoutRiskCount = ALL_PROPS.filter((prop) => prop.status === "청소중" || prop.issues.length > 0).length;
  const openCC = (stage = null) => {
    setCcStage(stage);
    setScreen("cc");
  };
  const openHA = (stage = "stay", context = null) => {
    setHaStage(stage);
    setHaContext(context);
    setScreen("ha");
  };
  const portalStageCards = getPortalStageCards(ALL_PROPS);
  const leadAlert = INIT_ALERTS.find((alert) => !alert.ack) || INIT_ALERTS[0];

  useEffect(()=>{
    const timer = setInterval(()=>setNow(new Date()), 1000);
    return ()=>clearInterval(timer);
  },[]);

  const closeHA = () => {
    if(haContext?.source === "command-center"){
      openCC(haStage || null);
      return;
    }
    setScreen("landing");
  };

  if(screen==="ha") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <HomeAssistant
        onBack={closeHA}
        onOpenCommandCenter={(stage)=>openCC(stage || null)}
        initialStage={haStage}
        handoff={haContext}
      />
    </div>
  );

  if(screen==="cc") return (
    <CommandCenter
      onBack={()=>setScreen("landing")}
      onOpenScenario={setScreen}
      onOpenHomeAssistant={(stage, context)=>openHA(stage || "stay", context || null)}
      initialStage={ccStage}
    />
  );

  if(screen==="d1") return (
    <D1AutomationPanel onBack={()=>openCC("d1")} />
  );

  if(screen==="s02") return <S02CheckinPanel onBack={()=>openCC("checkin")} />;

  if(screen==="s03") return <S03MonitoringPanel onBack={()=>openCC("stay")} />;

  if(screen==="s04") return <S04CheckoutPanel onBack={()=>openCC("checkout")} />;

  if(screen==="s05") return <S05RevenuePanel onBack={()=>openCC("settlement")} />;

  return (
    <div className="app">
      <div className="landing">
        <div style={{textAlign:"center",marginBottom:"32px",animation:"slideIn 0.4s ease"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#a0aec0",letterSpacing:"4px",marginBottom:"10px",fontWeight:"500"}}>DEMO v0.1</div>
          <div className="land-title">PROP<span>OS</span></div>
          <div className="land-sub">에어비앤비 완전 관리 시스템</div>
        </div>

        <div className="land-ops-summary" style={{animation:"slideIn 0.35s ease 0.05s both"}}>
          <div className="land-ops-hero">
            <div>
              <div className="land-section-label" style={{marginBottom:10}}>현재 상태 대시보드</div>
              <div className="land-ops-title">지금 막힌 곳만 보면 됩니다</div>
              <div className="land-ops-desc">
                전체 숙소에서 사람이 봐야 할 단계만 먼저 고르고, 숙소 한 곳은 대표 숙소 상세 보기에서 끝까지 해결하면 됩니다.
                지금은 체류 중 대응 {urgentCount}건, 내일 체크인 준비 {reservedCount}곳, 퇴실·청소 {checkoutRiskCount}곳을 먼저 보면 됩니다.
              </div>
            </div>
            <div className="land-ops-cta">
              <button className="land-primary-btn" onClick={()=>openCC()}>커맨드 센터 열기</button>
              <button className="land-secondary-btn" onClick={()=>openHA("stay")}>대표 숙소 상세 보기</button>
            </div>
          </div>

          <div className="land-flow-grid">
            {[
              {
                title: "어디가 막혔는지 찾기",
                desc: "먼저 어떤 단계와 어떤 숙소가 사람 손을 기다리는지 고릅니다.",
                tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
              },
              {
                title: "숙소 한 곳 끝내기",
                desc: "복잡한 예외는 대표 숙소 상세 보기에서 끝까지 처리합니다.",
                tone: { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" },
              },
              {
                title: "같은 문제 한 번에 처리",
                desc: "같은 종류의 예외가 여러 곳이면 각 단계 콘솔에서 묶어서 처리합니다.",
                tone: { bg: "#fffbeb", border: "#fde68a", text: "#d97706" },
              },
            ].map((item, index)=>(
              <div key={item.title} className="land-flow-card" style={{background:item.tone.bg,borderColor:item.tone.border}}>
                <div className="land-flow-head">
                  <span className="land-flow-step" style={{color:item.tone.text}}>STEP {index + 1}</span>
                  <span className="land-flow-title">{item.title}</span>
                </div>
                <div className="land-flow-desc">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="land-status-grid">
            {portalStageCards.map((card)=>(
              <button
                key={card.id}
                className="land-status-card"
                onClick={() => openCC(card.id)}
                style={{background:card.bg,borderColor:card.border}}
              >
                <div className="land-status-head">
                  <span className="land-status-title">{card.code} · {card.portalTitle}</span>
                  <span className="land-status-value" style={{color:card.color}}>{card.count}곳</span>
                </div>
                <div className="land-status-desc">{card.portalDescription}</div>
                <div className="land-status-action" style={{color:card.color}}>커맨드 센터에서 보기 →</div>
              </button>
            ))}
          </div>

          <div className="land-alert-rail">
            <div className="land-alert-label">지금 뜬 알림</div>
            <div className="land-alert-card">
              <div className="land-alert-prop">{leadAlert.prop}</div>
              <div className="land-alert-msg">{leadAlert.msg}</div>
              <div className="land-alert-meta">{leadAlert.time} · 확인이 필요한 최신 이벤트</div>
              <button className="land-inline-link" onClick={()=>openCC()}>알림에서 바로 확인</button>
            </div>
          </div>
        </div>

        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#c8d5e0",letterSpacing:"1px",textAlign:"center",animation:"slideIn 0.35s ease 0.18s both"}}>
          {now.toLocaleString("ko-KR")}
        </div>
      </div>
    </div>
  );
}

export default App;
