// v2 — 개발 예정
export default function HomeAssistant({ onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f0f4f8", gap: 16 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 4, color: "#a0aec0" }}>v2 · COMING SOON</div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 22, fontWeight: 700, color: "#1a202c" }}>HomeAssistant — 새 UI</div>
      <div style={{ fontSize: 14, color: "#718096" }}>이 화면은 v2 UI 개발 예정입니다.</div>
      <button onClick={onBack} style={{ marginTop: 8, padding: "10px 24px", background: "#2563eb", color: "#fff", border: "2px solid #1d4ed8", borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontWeight: 600, cursor: "pointer" }}>
        돌아가기
      </button>
    </div>
  );
}
