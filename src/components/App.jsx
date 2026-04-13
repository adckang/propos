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
  const [now, setNow] = useState(new Date());

  const occupiedCount = ALL_PROPS.filter((prop) => prop.status === "입실중").length;
  const reservedCount = ALL_PROPS.filter((prop) => prop.status === "예약됨").length;
  const cleaningCount = ALL_PROPS.filter((prop) => prop.status === "청소중").length;
  const urgentCount = ALL_PROPS.filter((prop) => prop.priority === "HIGH").length;
  const unreadCount = ALL_PROPS.reduce((sum, prop) => sum + prop.unreadMsg, 0);
  const checkoutRiskCount = ALL_PROPS.filter((prop) => prop.status === "청소중" || prop.issues.length > 0).length;
  const nextActionCards = [
    {
      title: "지금 대응",
      value: `${urgentCount}건`,
      desc: "센서 이상, 유지보수, 도어락 문제를 먼저 확인하세요.",
      action: "긴급 숙소 보기",
      onClick: () => setScreen("cc"),
      tone: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
    },
    {
      title: "체크인 준비",
      value: `${reservedCount}곳`,
      desc: "내일 체크인 숙소의 준비 상태를 한 번에 확인하세요.",
      action: "체크인 흐름 열기",
      onClick: () => setScreen("cc"),
      tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
    },
    {
      title: "메시지 미응답",
      value: `${unreadCount}건`,
      desc: "게스트 응답이 필요한 숙소를 먼저 줄이세요.",
      action: "메시지 확인",
      onClick: () => setScreen("cc"),
      tone: { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" },
    },
    {
      title: "퇴실·청소",
      value: `${checkoutRiskCount}곳`,
      desc: "다음 예약 준비가 막힐 수 있는 숙소예요.",
      action: "청소 상태 보기",
      onClick: () => setScreen("cc"),
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
      <HomeAssistant onBack={()=>setScreen("landing")} />
    </div>
  );

  if(screen==="cc") return <CommandCenter onBack={()=>setScreen("landing")} />;

  if(screen==="d1") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div className="topnav">
        <button className="back-btn" onClick={()=>setScreen("landing")}>← 홈</button>
        <div style={{width:"1px",height:"22px",background:"#e2e8f0"}} />
        <div className="nav-title">PROP<span style={{color:"var(--red)"}}>OS</span> · D-1 체크인 전날 자동화</div>
        <div className="topnav-clock">{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      <D1AutomationPanel onBack={()=>setScreen("landing")} />
    </div>
  );

  if(screen==="s02") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif",display:"flex",flexDirection:"column"}}>
      <div className="topnav">
        <button className="back-btn" onClick={()=>setScreen("landing")}>← 홈</button>
        <div style={{width:"1px",height:"22px",background:"#e2e8f0"}} />
        <div className="nav-title">PROP<span style={{color:"var(--green)"}}>OS</span> · S02 체크인 당일 자동화</div>
        <div className="topnav-clock">{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      <div style={{flex:1,overflow:"hidden"}}>
        <S02CheckinPanel />
      </div>
    </div>
  );

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
              <div className="land-ops-title">지금 먼저 볼 것은 긴급 {urgentCount}건이에요</div>
              <div className="land-ops-desc">
                체크인 대기 {reservedCount}곳, 입실 중 {occupiedCount}곳, 청소 중 {cleaningCount}곳을 한 흐름으로 보면서
                예외 숙소부터 바로 처리할 수 있게 구성했습니다.
              </div>
            </div>
            <div className="land-ops-cta">
              <button className="land-primary-btn" onClick={()=>setScreen("cc")}>커맨드 센터 열기</button>
              <button className="land-secondary-btn" onClick={()=>setScreen("ha")}>대표 숙소 상세 보기</button>
            </div>
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
              <button className="land-inline-link" onClick={()=>setScreen("cc")}>알림에서 바로 확인</button>
            </div>
          </div>
        </div>

        <div style={{animation:"slideIn 0.35s ease 0.1s both",width:"100%",maxWidth:1080,marginBottom:28}}>
          <div className="land-section-label">운영 화면</div>
          <div style={{display:"flex",gap:16}}>
            <div className="land-tool-card" style={{flex:1}} onClick={()=>setScreen("cc")}>
              <span className="land-tool-icon">🛰️</span>
              <div className="land-tool-title">커맨드 센터</div>
              <div className="land-tool-desc">예외 숙소 우선 발견 · 긴급 액션 바로 실행<br />실시간 알림 · 단계별 병목 확인 · 일괄 제어</div>
              <div className="land-tool-badge">지금 가장 먼저 봐야 하는 화면 →</div>
            </div>
            <div className="land-tool-card" style={{flex:1}} onClick={()=>setScreen("ha")}>
              <span className="land-tool-icon">🏠</span>
              <div className="land-tool-title">홈 어시스턴트</div>
              <div className="land-tool-desc">개별 숙소의 시간축 운영 화면<br />현재 단계 · 멈춘 지점 · 바로 할 액션 확인</div>
              <div className="land-tool-badge">단일 숙소 해결 화면 →</div>
            </div>
          </div>
        </div>

        <div style={{animation:"slideIn 0.35s ease 0.16s both",width:"100%",maxWidth:930,marginBottom:28}}>
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
              <div className="land-sc-title">체류 중 모니터링</div>
              <div className="land-sc-desc">센서 LIVE<br />이상 감지<br />AI 답장 초안</div>
              <span className="land-sc-badge">이상 징후 빠른 대응</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--red)"}} onClick={()=>setScreen("s04")}>
              <span className="land-sc-icon">🧹</span>
              <div className="land-sc-title">체크아웃 & 청소</div>
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
