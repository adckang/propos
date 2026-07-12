import { ALL_PROPS, INIT_ALERTS } from "../../data/mockData";
import { getPortalStageCards } from "../../config/operationsModel.js";

const S = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'DM Sans', sans-serif",
    color: "#1e293b",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 100,
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "0 24px",
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logoMark: {
    width: 28,
    height: 28,
    background: "#2563eb",
    borderRadius: 7,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "-0.5px",
    fontFamily: "'DM Mono', monospace",
  },
  logoText: {
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: "-0.3px",
    color: "#1e293b",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
    color: "#94a3b8",
  },
  totalBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 20,
    padding: "3px 10px",
  },
  body: {
    maxWidth: 780,
    margin: "0 auto",
    padding: "24px 20px 48px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
};

function UrgentSection({ alerts, onOpenCC }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{
      background: "#fff",
      border: "1.5px solid #fecaca",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(220,38,38,0.07)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        background: "#fff5f5",
        borderBottom: "1px solid #fecaca",
      }}>
        <span style={{ fontSize: 14 }}>🚨</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: "#dc2626" }}>즉시 확인 필요</span>
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 700,
          color: "#dc2626",
          background: "#fee2e2",
          border: "1px solid #fecaca",
          borderRadius: 20,
          padding: "2px 9px",
        }}>{alerts.length}건</span>
      </div>
      <div>
        {alerts.map((alert, i) => (
          <div key={alert.id} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "14px 16px",
            borderBottom: i < alerts.length - 1 ? "1px solid #f1f5f9" : "none",
          }}>
            <div style={{
              width: 4,
              minHeight: 36,
              borderRadius: 2,
              background: "#dc2626",
              flexShrink: 0,
              marginTop: 2,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b", marginBottom: 2 }}>{alert.prop}</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{alert.msg}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, fontFamily: "'DM Mono', monospace" }}>{alert.time}</div>
            </div>
            <button
              onClick={() => onOpenCC()}
              style={{
                flexShrink: 0,
                padding: "7px 12px",
                background: "#dc2626",
                color: "#fff",
                border: "1.5px solid #b91c1c",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              확인하기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WarnSection({ alerts, onOpenCC }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{
      background: "#fff",
      border: "1.5px solid #fde68a",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(217,119,6,0.06)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        background: "#fffbeb",
        borderBottom: "1px solid #fde68a",
      }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: "#d97706" }}>원격 처리 필요</span>
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 700,
          color: "#d97706",
          background: "#fef3c7",
          border: "1px solid #fde68a",
          borderRadius: 20,
          padding: "2px 9px",
        }}>{alerts.length}건</span>
      </div>
      <div>
        {alerts.map((alert, i) => (
          <div key={alert.id} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 16px",
            borderBottom: i < alerts.length - 1 ? "1px solid #f1f5f9" : "none",
          }}>
            <div style={{
              width: 4,
              minHeight: 32,
              borderRadius: 2,
              background: "#d97706",
              flexShrink: 0,
              marginTop: 2,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b", marginBottom: 2 }}>{alert.prop}</div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{alert.msg}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, fontFamily: "'DM Mono', monospace" }}>{alert.time}</div>
            </div>
            <button
              onClick={() => onOpenCC()}
              style={{
                flexShrink: 0,
                padding: "6px 11px",
                background: "#fff",
                color: "#d97706",
                border: "1.5px solid #fde68a",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              확인하기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageGrid({ stages, onOpenCC }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        단계별 현황
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {stages.map(stage => (
          <button
            key={stage.id}
            onClick={() => onOpenCC(stage.id)}
            style={{
              background: "#fff",
              border: `1.5px solid ${stage.border}`,
              borderTop: `3px solid ${stage.color}`,
              borderRadius: 12,
              padding: "14px 12px",
              textAlign: "left",
              cursor: "pointer",
              transition: "box-shadow 0.15s, transform 0.1s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <div style={{ fontSize: 16, marginBottom: 6 }}>{stage.emoji}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: stage.color, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3, fontFamily: "'DM Mono', monospace" }}>
              {stage.code}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", lineHeight: 1.3, marginBottom: 8 }}>
              {stage.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: stage.color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
              {stage.count}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>곳</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CTABar({ onOpenCC, onOpenHA }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <button
        onClick={() => onOpenCC()}
        style={{
          padding: "14px",
          background: "#2563eb",
          color: "#fff",
          border: "1.5px solid #1d4ed8",
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        커맨드 센터 열기
      </button>
      <button
        onClick={() => onOpenHA("stay")}
        style={{
          padding: "14px",
          background: "#fff",
          color: "#1e293b",
          border: "1.5px solid #e2e8f0",
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        대표 숙소 상세 보기
      </button>
    </div>
  );
}

function AlertFeed({ alerts }) {
  const typeStyle = {
    error: { dot: "#dc2626", bg: "#fee2e2" },
    warn:  { dot: "#d97706", bg: "#fef3c7" },
    info:  { dot: "#94a3b8", bg: "#f1f5f9" },
  };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        최근 알림
      </div>
      <div style={{
        background: "#fff",
        border: "1.5px solid #e2e8f0",
        borderRadius: 14,
        overflow: "hidden",
      }}>
        {alerts.map((alert, i) => {
          const ts = typeStyle[alert.type] || typeStyle.info;
          return (
            <div key={alert.id} style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: i < alerts.length - 1 ? "1px solid #f1f5f9" : "none",
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: ts.dot,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: "#475569" }}>{alert.prop} </span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{alert.msg}</span>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                {alert.time}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OperationsPortal({ onOpenCC, onOpenHA, now }) {
  const portalStageCards = getPortalStageCards(ALL_PROPS);
  const mainStages = portalStageCards.filter(c => c.id !== "settlement");

  const urgentAlerts = INIT_ALERTS.filter(a => a.type === "error");
  const warnAlerts   = INIT_ALERTS.filter(a => a.type === "warn" && a.audience === "admin");
  const feedAlerts   = INIT_ALERTS.slice(0, 6);

  const timeStr = now
    ? now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";
  const dateStr = now
    ? now.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    : "";

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logoMark}>P</div>
          <div style={S.logoText}>PROPOS</div>
        </div>
        <div style={S.headerRight}>
          <span>{dateStr}</span>
          <span style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>{timeStr}</span>
          <span style={S.totalBadge}>숙소 {ALL_PROPS.length}개</span>
        </div>
      </header>

      <div style={S.body}>
        <UrgentSection alerts={urgentAlerts} onOpenCC={onOpenCC} />
        <WarnSection   alerts={warnAlerts}   onOpenCC={onOpenCC} />
        <StageGrid     stages={mainStages}   onOpenCC={onOpenCC} />
        <CTABar        onOpenCC={onOpenCC}   onOpenHA={onOpenHA} />
        <AlertFeed     alerts={feedAlerts} />
      </div>
    </div>
  );
}
