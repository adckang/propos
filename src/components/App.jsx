import { useEffect, useState } from "react";

import CommandCenter from "./CommandCenter";
import D1AutomationPanel from "./D1AutomationPanel";
import HomeAssistant from "./HomeAssistant";
import S02CheckinPanel from "./S02CheckinPanel";
import S03MonitoringPanel from "./S03MonitoringPanel";
import S04CheckoutPanel from "./S04CheckoutPanel";
import S05RevenuePanel from "./S05RevenuePanel";

// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// 상태: screen ("landing" | "ha" | "cc" | "d1" | "s02" | "s03" | "s04" | "s05"), now
// ============================================================

function App() {
  const [screen, setScreen] = useState("landing");
  const [now, setNow] = useState(new Date());

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

        <div style={{animation:"slideIn 0.35s ease 0.05s both",width:"100%",maxWidth:660,marginBottom:32}}>
          <div className="land-section-label">시스템</div>
          <div style={{display:"flex",gap:16}}>
            <div className="land-tool-card" style={{flex:1}} onClick={()=>setScreen("ha")}>
              <span className="land-tool-icon">🏠</span>
              <div className="land-tool-title">홈 어시스턴트</div>
              <div className="land-tool-desc">개별 숙소 관리 · 체크인/아웃<br />스마트홈 IoT 제어 · 게스트 메시지 · 수익 분석</div>
              <div className="land-tool-badge">HOME ASSISTANT →</div>
            </div>
            <div className="land-tool-card" style={{flex:1}} onClick={()=>setScreen("cc")}>
              <span className="land-tool-icon">🛰️</span>
              <div className="land-tool-title">커맨드 센터</div>
              <div className="land-tool-desc">48개+ 숙소 동시 관제 · 일괄 IoT 제어<br />실시간 알림 · 자동화 · 수익 분석 · 청소 배정</div>
              <div className="land-tool-badge">COMMAND CENTER →</div>
            </div>
          </div>
        </div>

        <div style={{animation:"slideIn 0.35s ease 0.12s both",width:"100%",maxWidth:930,marginBottom:28}}>
          <div className="land-section-label">자동화 시나리오 — 5단계</div>
          <div style={{display:"flex",alignItems:"flex-start",gap:6}}>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--blue)"}} onClick={()=>setScreen("d1")}>
              <span className="land-sc-icon">⚡</span>
              <div className="land-sc-title">D-1 자동화</div>
              <div className="land-sc-desc">PIN 발급<br />웰컴 메시지<br />스마트홈 초기화</div>
              <span className="land-sc-badge">UC-001</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--green)"}} onClick={()=>setScreen("s02")}>
              <span className="land-sc-icon">🚪</span>
              <div className="land-sc-title">체크인 당일</div>
              <div className="land-sc-desc">입실 감지<br />IoT 씬 실행<br />채팅 오픈</div>
              <span className="land-sc-badge">UC-002</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--yellow)"}} onClick={()=>setScreen("s03")}>
              <span className="land-sc-icon">📡</span>
              <div className="land-sc-title">체류 중 모니터링</div>
              <div className="land-sc-desc">센서 LIVE<br />이상 감지<br />AI 답장 초안</div>
              <span className="land-sc-badge">UC-003</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--red)"}} onClick={()=>setScreen("s04")}>
              <span className="land-sc-icon">🧹</span>
              <div className="land-sc-title">체크아웃 & 청소</div>
              <div className="land-sc-desc">PIN 즉시 만료<br />청소팀 배정<br />체크리스트</div>
              <span className="land-sc-badge">UC-004</span>
            </div>
            <div className="land-sc-arrow">›</div>
            <div className="land-sc-card" style={{borderTop:"3px solid var(--purple)"}} onClick={()=>setScreen("s05")}>
              <span className="land-sc-icon">💰</span>
              <div className="land-sc-title">수익 정산</div>
              <div className="land-sc-desc">멀티플랫폼 통합<br />AI 가격 최적화<br />세금 리포트</div>
              <span className="land-sc-badge">UC-005</span>
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
