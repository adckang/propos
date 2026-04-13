import { useEffect, useState } from "react";

import CommandCenter from "./CommandCenter";
import D1AutomationPanel from "./D1AutomationPanel";
import HomeAssistant from "./HomeAssistant";
import S02CheckinPanel from "./S02CheckinPanel";
import S03MonitoringPanel from "./S03MonitoringPanel";
import S04CheckoutPanel from "./S04CheckoutPanel";
import S05RevenuePanel from "./S05RevenuePanel";
import { ALL_PROPS, INIT_ALERTS } from "../data/mockData";

// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// 상태: screen ("landing" | "ha" | "cc" | "d1" | "s02" | "s03" | "s04" | "s05"), now
// ============================================================

function App() {
  const [screen, setScreen] = useState("landing");
  const [ccStage, setCcStage] = useState("stay");
  const [now, setNow] = useState(new Date());

  const reservedCount = ALL_PROPS.filter((prop) => prop.status === "예약됨").length;
  const urgentCount = ALL_PROPS.filter((prop) => prop.priority === "HIGH").length;
  const unreadCount = ALL_PROPS.reduce((sum, prop) => sum + prop.unreadMsg, 0);
  const checkoutRiskCount = ALL_PROPS.filter((prop) => prop.status === "청소중" || prop.issues.length > 0).length;
  const openCC = (stage = "stay") => {
    setCcStage(stage);
    setScreen("cc");
  };
  const openHA = () => setScreen("ha");
  const workflowGuides = [
    {
      step: "1",
      title: "전체에서 예외 찾기",
      desc: "긴급 숙소, 병목 단계, 미응답 메시지를 먼저 찾습니다.",
      tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
    },
    {
      step: "2",
      title: "대표 숙소 해결",
      desc: "한 숙소의 현재 단계와 멈춘 지점을 확인하고 바로 제어합니다.",
      tone: { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" },
    },
    {
      step: "3",
      title: "단계별 상세 처리",
      desc: "체크인 당일, 체류 중, 퇴실·청소, 수익 정산 패널에서 깊게 처리합니다.",
      tone: { bg: "#fffbeb", border: "#fde68a", text: "#d97706" },
    },
  ];
  const nextActionCards = [
    {
      title: "체류 중 대응",
      value: `${urgentCount}건`,
      desc: "센서 이상, 유지보수, 도어락 문제를 먼저 확인하세요.",
      action: "체류 중 숙소 보기",
      onClick: () => openCC("stay"),
      tone: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
    },
    {
      title: "D-1 준비",
      value: `${reservedCount}곳`,
      desc: "내일 체크인 숙소의 준비 상태를 한 번에 확인하세요.",
      action: "D-1 단계 열기",
      onClick: () => openCC("d1"),
      tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
    },
    {
      title: "메시지 응답",
      value: `${unreadCount}건`,
      desc: "게스트 응답이 필요한 숙소를 먼저 줄이세요.",
      action: "응답 대기 보기",
      onClick: () => openCC("stay"),
      tone: { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" },
    },
    {
      title: "퇴실·청소",
      value: `${checkoutRiskCount}곳`,
      desc: "다음 예약 준비가 막힐 수 있는 숙소예요.",
      action: "청소 상태 보기",
      onClick: () => openCC("checkout"),
      tone: { bg: "#fffbeb", border: "#fde68a", text: "#d97706" },
    },
  ];
  const leadAlert = INIT_ALERTS.find((alert) => !alert.ack) || INIT_ALERTS[0];

  useEffect(()=>{
    const timer = setInterval(()=>setNow(new Date()), 1000);
    return ()=>clearInterval(timer);
  },[]);

  if(screen==="ha") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <HomeAssistant
        onBack={()=>setScreen("landing")}
        onOpenScenario={setScreen}
        onOpenCommandCenter={(stage)=>openCC(stage || "stay")}
      />
    </div>
  );

  if(screen==="cc") return (
    <CommandCenter
      onBack={()=>setScreen("landing")}
      onOpenScenario={setScreen}
      onOpenHomeAssistant={openHA}
      initialStage={ccStage}
    />
  );

  if(screen==="d1") return (
    <D1AutomationPanel onBack={()=>setScreen("landing")} />
  );

  if(screen==="s02") return <S02CheckinPanel onBack={()=>setScreen("landing")} />;

  if(screen==="s03") return <S03MonitoringPanel onBack={()=>setScreen("landing")} />;

  if(screen==="s04") return <S04CheckoutPanel onBack={()=>setScreen("landing")} />;

  if(screen==="s05") return <S05RevenuePanel onBack={()=>setScreen("landing")} />;

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
              <div className="land-ops-title">전체에서 예외를 찾고, 숙소 하나는 바로 해결하면 됩니다</div>
              <div className="land-ops-desc">
                커맨드 센터는 100개 숙소 전체에서 우선순위를 잡는 화면이고, 홈 어시스턴트는 대표 숙소 1곳을 끝까지 해결하는 화면입니다.
                지금은 체류 중 대응 {urgentCount}건, D-1 준비 {reservedCount}곳, 퇴실·청소 {checkoutRiskCount}곳을 먼저 보면 됩니다.
              </div>
            </div>
            <div className="land-ops-cta">
              <button className="land-primary-btn" onClick={()=>openCC("stay")}>커맨드 센터 열기</button>
              <button className="land-secondary-btn" onClick={openHA}>대표 숙소 상세 보기</button>
            </div>
          </div>

          <div className="land-flow-grid">
            {workflowGuides.map((item)=>(
              <div key={item.step} className="land-flow-card" style={{background:item.tone.bg,borderColor:item.tone.border}}>
                <div className="land-flow-head">
                  <span className="land-flow-step" style={{color:item.tone.text}}>STEP {item.step}</span>
                  <span className="land-flow-title">{item.title}</span>
                </div>
                <div className="land-flow-desc">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="land-status-grid">
            {nextActionCards.map((card)=>(
              <button
                key={card.title}
                className="land-status-card"
                onClick={card.onClick}
                style={{background:card.tone.bg,borderColor:card.tone.border}}
              >
                <div className="land-status-head">
                  <span className="land-status-title">{card.title}</span>
                  <span className="land-status-value" style={{color:card.tone.text}}>{card.value}</span>
                </div>
                <div className="land-status-desc">{card.desc}</div>
                <div className="land-status-action" style={{color:card.tone.text}}>{card.action} →</div>
              </button>
            ))}
          </div>

          <div className="land-alert-rail">
            <div className="land-alert-label">지금 뜬 알림</div>
            <div className="land-alert-card">
              <div className="land-alert-prop">{leadAlert.prop}</div>
              <div className="land-alert-msg">{leadAlert.msg}</div>
              <div className="land-alert-meta">{leadAlert.time} · 확인이 필요한 최신 이벤트</div>
              <button className="land-inline-link" onClick={()=>openCC("stay")}>알림에서 바로 확인</button>
            </div>
          </div>
        </div>

        <div style={{animation:"slideIn 0.35s ease 0.1s both",width:"100%",maxWidth:930,marginBottom:28}}>
          <div className="land-section-label">오늘의 운영 흐름 — 5단계</div>
          <div style={{display:"flex",alignItems:"flex-start",gap:6}}>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--blue)"}} onClick={()=>setScreen("d1")}>
              <span className="land-sc-icon">⚡</span>
              <div className="land-sc-title">D-1 자동화</div>
              <div className="land-sc-desc">PIN 발급<br />웰컴 메시지<br />스마트홈 초기화</div>
              <span className="land-sc-badge">내일 체크인 준비</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--green)"}} onClick={()=>setScreen("s02")}>
              <span className="land-sc-icon">🚪</span>
              <div className="land-sc-title">체크인 당일</div>
              <div className="land-sc-desc">입실 감지<br />IoT 씬 실행<br />채팅 오픈</div>
              <span className="land-sc-badge">비대면 입실 완료</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--yellow)"}} onClick={()=>setScreen("s03")}>
              <span className="land-sc-icon">📡</span>
              <div className="land-sc-title">체류 중</div>
              <div className="land-sc-desc">센서 LIVE<br />이상 감지<br />AI 답장 초안</div>
              <span className="land-sc-badge">실시간 모니터링</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--red)"}} onClick={()=>setScreen("s04")}>
              <span className="land-sc-icon">🧹</span>
              <div className="land-sc-title">퇴실·청소</div>
              <div className="land-sc-desc">PIN 즉시 만료<br />청소팀 배정<br />체크리스트</div>
              <span className="land-sc-badge">다음 예약 준비</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--purple)"}} onClick={()=>setScreen("s05")}>
              <span className="land-sc-icon">💰</span>
              <div className="land-sc-title">수익 정산</div>
              <div className="land-sc-desc">멀티플랫폼 통합<br />AI 가격 최적화<br />세금 리포트</div>
              <span className="land-sc-badge">월간 운영 정리</span>
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
