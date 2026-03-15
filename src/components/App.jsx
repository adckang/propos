// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// 의존성: HomeAssistant.jsx, CommandCenter.jsx, styles/main.css
// 상태: screen ("landing" | "ha" | "cc"), now
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
          <div className="land-cards" style={{animation:"slideIn 0.4s ease 0.1s both"}}>
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
