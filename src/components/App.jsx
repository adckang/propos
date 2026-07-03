import { useEffect, useState } from "react";

// Landing (공통 — 버전 무관)
import LandingPage from "./LandingPage";
import LandingPageV1 from "./LandingPageV1";
import LandingPageV2 from "./LandingPageV2";

// v1 앱 페이지
import HomeAssistantV1 from "./v1/HomeAssistant";
import CommandCenterV1 from "./v1/CommandCenter";
import D1AutomationPanelV1 from "./v1/D1AutomationPanel";
import S02CheckinPanelV1 from "./v1/S02CheckinPanel";
import S03MonitoringPanelV1 from "./v1/S03MonitoringPanel";
import S04CheckoutPanelV1 from "./v1/S04CheckoutPanel";
import S05RevenuePanelV1 from "./v1/S05RevenuePanel";

// v2 앱 페이지
import HomeAssistantV2 from "./v2/HomeAssistant";
import CommandCenterV2 from "./v2/CommandCenter";

import { ALL_PROPS, INIT_ALERTS } from "../data/mockData";
import { getPortalStageCards } from "../config/operationsModel.js";

// ============================================================
// App.jsx — 루트 라우터 + 랜딩 화면
// screen: "marketing" | "v1" | "v2" | "landing" | "ha" | "cc" | "d1" | "s02" | "s03" | "s04" | "s05"
// uiVersion: "v1" | "v2"  — 앱 페이지 UI 버전 전환
// ============================================================

const VERSION_TOGGLE_STYLE = {
  position: "fixed",
  top: 12,
  right: 16,
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "rgba(255,255,255,0.92)",
  border: "1.5px solid #e2e8f0",
  borderRadius: 20,
  padding: "4px 8px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  backdropFilter: "blur(8px)",
};

function VersionToggle({ uiVersion, onChange }) {
  return (
    <div style={VERSION_TOGGLE_STYLE}>
      <span style={{ color: "#a0aec0", marginRight: 4 }}>UI</span>
      {["v1", "v2"].map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            padding: "3px 10px",
            borderRadius: 12,
            border: uiVersion === v ? "1.5px solid #2563eb" : "1.5px solid transparent",
            background: uiVersion === v ? "#2563eb" : "transparent",
            color: uiVersion === v ? "#fff" : "#718096",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: 1,
            transition: "all 0.15s",
          }}
        >
          {v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("v1");
  const [uiVersion, setUiVersion] = useState("v1");
  const [ccStage, setCcStage] = useState("stay");
  const [haStage, setHaStage] = useState("stay");
  const [haContext, setHaContext] = useState(null);
  const [now, setNow] = useState(new Date());

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

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const closeHA = () => {
    if (haContext?.source === "command-center") {
      openCC(haStage || null);
      return;
    }
    setScreen("landing");
  };

  // 버전별 컴포넌트 선택
  const HomeAssistant = uiVersion === "v1" ? HomeAssistantV1 : HomeAssistantV2;
  const CommandCenter = uiVersion === "v1" ? CommandCenterV1 : CommandCenterV2;
  const D1AutomationPanel = D1AutomationPanelV1;   // v2 미구현 → v1 유지
  const S02CheckinPanel = S02CheckinPanelV1;
  const S03MonitoringPanel = S03MonitoringPanelV1;
  const S04CheckoutPanel = S04CheckoutPanelV1;
  const S05RevenuePanel = S05RevenuePanelV1;

  // 앱 내부 화면에서만 버전 토글 표시 (랜딩 계열 제외)
  const showVersionToggle = ["ha", "cc", "d1", "s02", "s03", "s04", "s05", "landing"].includes(screen);

  if (screen === "marketing") return (
    <LandingPageV2
      onEnterApp={() => setScreen("landing")}
      onSwitchVersion={() => setScreen("v1")}
    />
  );

  if (screen === "v1") return (
    <LandingPageV1
      onEnterApp={() => setScreen("landing")}
      onSwitchVersion={() => setScreen("v2")}
    />
  );

  if (screen === "v2") return (
    <LandingPage
      onEnterApp={() => setScreen("landing")}
      onSwitchVersion={() => setScreen("marketing")}
    />
  );

  if (screen === "ha") return (
    <div className="app" style={{ fontFamily: "'DM Sans',sans-serif" }}>
      {showVersionToggle && <VersionToggle uiVersion={uiVersion} onChange={setUiVersion} />}
      <HomeAssistant
        onBack={closeHA}
        onOpenCommandCenter={(stage) => openCC(stage || null)}
        initialStage={haStage}
        handoff={haContext}
      />
    </div>
  );

  if (screen === "cc") return (
    <>
      {showVersionToggle && <VersionToggle uiVersion={uiVersion} onChange={setUiVersion} />}
      <CommandCenter
        onBack={() => setScreen("landing")}
        onOpenScenario={setScreen}
        onOpenHomeAssistant={(stage, context) => openHA(stage || "stay", context || null)}
        initialStage={ccStage}
      />
    </>
  );

  if (screen === "d1") return <D1AutomationPanel onBack={() => openCC("d1")} />;
  if (screen === "s02") return <S02CheckinPanel onBack={() => openCC("checkin")} />;
  if (screen === "s03") return <S03MonitoringPanel onBack={() => openCC("stay")} />;
  if (screen === "s04") return <S04CheckoutPanel onBack={() => openCC("checkout")} />;
  if (screen === "s05") return <S05RevenuePanel onBack={() => openCC("settlement")} />;

  return (
    <div className="app">
      {showVersionToggle && <VersionToggle uiVersion={uiVersion} onChange={setUiVersion} />}
      <div className="landing">
        <div style={{ textAlign: "center", marginBottom: "32px", animation: "slideIn 0.4s ease" }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#a0aec0", letterSpacing: "4px", marginBottom: "10px", fontWeight: "500" }}>DEMO v0.1</div>
          <div className="land-title">PROP<span>OS</span></div>
          <div className="land-sub">에어비앤비 완전 관리 시스템</div>
        </div>

        <div className="land-ops-summary" style={{ animation: "slideIn 0.35s ease 0.05s both" }}>
          <div className="land-ops-hero">
            <div>
              <div className="land-section-label" style={{ marginBottom: 10 }}>현재 상태 대시보드</div>
              <div className="land-ops-title">지금 막힌 곳만 보면 됩니다</div>
              <div className="land-ops-desc">
                전체 숙소에서 사람이 봐야 할 단계만 먼저 고르고, 숙소 한 곳은 대표 숙소 상세 보기에서 끝까지 해결하면 됩니다.
                지금은 체류 중 대응 {portalStageCards.find(c => c.id === "stay")?.count || 0}건, 내일 체크인 준비 {portalStageCards.find(c => c.id === "d1")?.count || 0}곳, 퇴실·청소 {portalStageCards.find(c => c.id === "checkout")?.count || 0}곳을 먼저 보면 됩니다.
              </div>
            </div>
            <div className="land-ops-cta">
              <button className="land-primary-btn" onClick={() => openCC()}>커맨드 센터 열기</button>
              <button className="land-secondary-btn" onClick={() => openHA("stay")}>대표 숙소 상세 보기</button>
            </div>
          </div>

          <div className="land-flow-grid">
            {[
              { title: "어디가 막혔는지 찾기", desc: "먼저 어떤 단계와 어떤 숙소가 사람 손을 기다리는지 고릅니다.", tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" } },
              { title: "숙소 한 곳 끝내기", desc: "복잡한 예외는 대표 숙소 상세 보기에서 끝까지 처리합니다.", tone: { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" } },
              { title: "같은 문제 한 번에 처리", desc: "같은 종류의 예외가 여러 곳이면 각 단계 콘솔에서 묶어서 처리합니다.", tone: { bg: "#fffbeb", border: "#fde68a", text: "#d97706" } },
            ].map((item, index) => (
              <div key={item.title} className="land-flow-card" style={{ background: item.tone.bg, borderColor: item.tone.border }}>
                <div className="land-flow-head">
                  <span className="land-flow-step" style={{ color: item.tone.text }}>STEP {index + 1}</span>
                  <span className="land-flow-title">{item.title}</span>
                </div>
                <div className="land-flow-desc">{item.desc}</div>
              </div>
            ))}
          </div>

          <div className="land-status-grid">
            {portalStageCards.map((card) => (
              <button
                key={card.id}
                className="land-status-card"
                onClick={() => openCC(card.id)}
                style={{ background: card.bg, borderColor: card.border }}
              >
                <div className="land-status-head">
                  <span className="land-status-title">{card.code} · {card.portalTitle}</span>
                  <span className="land-status-value" style={{ color: card.color }}>{card.count}곳</span>
                </div>
                <div className="land-status-desc">{card.portalDescription}</div>
                <div className="land-status-action" style={{ color: card.color }}>커맨드 센터에서 보기 →</div>
              </button>
            ))}
          </div>

          <div className="land-alert-rail">
            <div className="land-alert-label">지금 뜬 알림</div>
            <div className="land-alert-card">
              <div className="land-alert-prop">{leadAlert.prop}</div>
              <div className="land-alert-msg">{leadAlert.msg}</div>
              <div className="land-alert-meta">{leadAlert.time} · 확인이 필요한 최신 이벤트</div>
              <button className="land-inline-link" onClick={() => openCC()}>알림에서 바로 확인</button>
            </div>
          </div>
        </div>

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "#c8d5e0", letterSpacing: "1px", textAlign: "center", animation: "slideIn 0.35s ease 0.18s both" }}>
          {now.toLocaleString("ko-KR")}
        </div>
      </div>
    </div>
  );
}

export default App;
