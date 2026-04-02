// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// 의존성: HomeAssistant.jsx, CommandCenter.jsx, D1AutomationPanel.jsx, S02CheckinPanel.jsx, S03MonitoringPanel.jsx, styles/main.css
// 상태: screen ("landing" | "ha" | "cc" | "d1" | "s02" | "s03"), now
// ============================================================

function App() {
  const [screen, setScreen] = useState("landing");
  const [now, setNow]       = useState(new Date());

  useEffect(()=>{
    const t = setInterval(()=>setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── 홈 어시스턴트 화면 ──────────────────────────────────
  if(screen === "ha") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div className="topnav">
        <button className="back-btn" onClick={()=>setScreen("landing")}>← 홈</button>
        <div style={{width:"1px",height:"22px",background:"#e2e8f0"}} />
        <div className="nav-title">HOME<span>OS</span> · 개별 숙소 어시스턴트</div>
        <div className="topnav-clock">{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      <HomeAssistant onBack={()=>setScreen("landing")}/>
    </div>
  );

  // ── 커맨드 센터 화면 ────────────────────────────────────
  if(screen === "cc") return <CommandCenter onBack={()=>setScreen("landing")}/>;

  // ── D-1 자동화 화면 ─────────────────────────────────────
  if(screen === "d1") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div className="topnav">
        <button className="back-btn" onClick={()=>setScreen("landing")}>← 홈</button>
        <div style={{width:"1px",height:"22px",background:"#e2e8f0"}} />
        <div className="nav-title">PROP<span style={{color:"var(--red)"}}>OS</span> · D-1 체크인 전날 자동화</div>
        <div className="topnav-clock">{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      <D1AutomationPanel onBack={()=>setScreen("landing")}/>
    </div>
  );

  // ── S02 체크인 당일 자동화 화면 ─────────────────────────
  if(screen === "s02") return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif", display:"flex", flexDirection:"column"}}>
      <div className="topnav">
        <button className="back-btn" onClick={()=>setScreen("landing")}>← 홈</button>
        <div style={{width:"1px",height:"22px",background:"#e2e8f0"}} />
        <div className="nav-title">PROP<span style={{color:"var(--green)"}}>OS</span> · S02 체크인 당일 자동화</div>
        <div className="topnav-clock">{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      <div style={{flex:1, overflow:"hidden"}}>
        <S02CheckinPanel />
      </div>
    </div>
  );

  // ── S03 체류 중 모니터링 화면 ───────────────────────────
  if(screen === "s03") return (
    <S03MonitoringPanel onBack={()=>setScreen("landing")}/>
  );

  // ── 랜딩 화면 ───────────────────────────────────────────
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="app">
        <div className="landing">
          <div style={{textAlign:"center",marginBottom:"20px",animation:"slideIn 0.4s ease"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#a0aec0",letterSpacing:"4px",marginBottom:"12px",fontWeight:"500"}}>DEMO v0.1</div>
            <div className="land-title">PROP<span>OS</span></div>
            <div className="land-sub">에어비앤비 완전 관리 시스템</div>
          </div>
          <div className="land-cards" style={{animation:"slideIn 0.4s ease 0.1s both",display:"flex",gap:"16px",flexWrap:"wrap",justifyContent:"center"}}>
            <div className="land-card" onClick={()=>setScreen("ha")}>
              <span className="land-card-icon">🏠</span>
              <div className="land-card-title">홈 어시스턴트</div>
              <div className="land-card-desc">개별 숙소 관리 · 체크인/아웃<br/>스마트홈 IoT 제어 · 게스트 메시지 · 수익 분석</div>
              <div className="land-badge">HOME ASSISTANT →</div>
            </div>
            <div className="land-card" onClick={()=>setScreen("cc")}>
              <span className="land-card-icon">🛰️</span>
              <div className="land-card-title">커맨드 센터</div>
              <div className="land-card-desc">48개+ 숙소 동시 관제 · 일괄 IoT 제어<br/>실시간 알림 · 자동화 · 수익 분석 · 청소 배정</div>
              <div className="land-badge">COMMAND CENTER →</div>
            </div>
            <div className="land-card" onClick={()=>setScreen("d1")}
              style={{borderTop:"3px solid var(--blue)"}}>
              <span className="land-card-icon">⚡</span>
              <div className="land-card-title">D-1 자동화</div>
              <div className="land-card-desc">체크인 전날 자동화 · PIN 발급<br/>웰컴 메시지 · 스마트홈 초기화</div>
              <div className="land-badge">UC-001 →</div>
            </div>
            <div className="land-card" onClick={()=>setScreen("s02")}
              style={{borderTop:"3px solid var(--green)"}}>
              <span className="land-card-icon">🚪</span>
              <div className="land-card-title">체크인 당일 자동화</div>
              <div className="land-card-desc">입실 감지 · IoT 씬 실행<br/>게스트 채팅 오픈 · 숙소 상태 갱신</div>
              <div className="land-badge">UC-002 →</div>
            </div>
            <div className="land-card" onClick={()=>setScreen("s03")}
              style={{borderTop:"3px solid var(--yellow)"}}>
              <span className="land-card-icon">📡</span>
              <div className="land-card-title">체류 중 모니터링</div>
              <div className="land-card-desc">센서 LIVE 폴링 · 이상 감지<br/>AI 답장 초안 · 긴급 알림</div>
              <div className="land-badge">UC-003 →</div>
            </div>
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#c8d5e0",letterSpacing:"1px",textAlign:"center",animation:"slideIn 0.4s ease 0.2s both"}}>
            {now.toLocaleString("ko-KR")}
          </div>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
