import { useCallback, useEffect, useState } from "react";

// 운영자 관리 (D-034, 관리자 전용): 계정 추가·정지·비밀번호 재설정·숙소 배정.
// 숙소를 배정받은 운영자는 그 숙소만 본다 — 배정이 없으면 아무것도 안 보인다(기본 거부).

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 },
  modal: { width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "auto", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, fontFamily: "'DM Sans','Nunito',sans-serif", color: "#1a202c" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  h: { fontSize: 18, fontWeight: 800, margin: 0 },
  btn: { padding: "7px 12px", fontSize: 13, fontWeight: 700, color: "#1a202c", background: "#fff", border: "1px solid #94a3b8", borderRadius: 8, cursor: "pointer" },
  primary: { padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#fff", background: "#1a202c", border: "1px solid #1a202c", borderRadius: 8, cursor: "pointer" },
  danger: { padding: "7px 12px", fontSize: 13, fontWeight: 700, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, cursor: "pointer" },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 10px", fontSize: 14, border: "1px solid #94a3b8", borderRadius: 8, marginBottom: 8, background: "#fff", color: "#1a202c" },
  row: { border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 10, background: "#f8fafc" },
  muted: { fontSize: 12, color: "#64748b" },
  err: { color: "#b91c1c", fontSize: 13, margin: "0 0 8px" },
  badge: (on) => ({ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, border: `1px solid ${on ? "#86efac" : "#fca5a5"}`, background: on ? "#f0fdf4" : "#fef2f2", color: on ? "#166534" : "#b91c1c" }),
  checks: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6, margin: "8px 0", maxHeight: 180, overflow: "auto", padding: 8, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" },
};

async function api(path, options) {
  const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
  return body;
}
const notify = (msg, type = "s") => { try { window.Toast?.show?.(msg, type); } catch { /* 토스트 없음 */ } };

function PropertyChecklist({ properties, selected, onChange }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  if (!properties.length) return <p style={S.muted}>등록된 숙소가 없어요.</p>;
  return (
    <div style={S.checks}>
      {properties.map((p) => (
        <label key={p.property_id} style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={selected.includes(p.property_id)} onChange={() => toggle(p.property_id)} />
          <span>{p.name || p.property_id}</span>
        </label>
      ))}
    </div>
  );
}

function OperatorRow({ op, properties, onChanged }) {
  const [mode, setMode] = useState(null); // null | "props" | "pw"
  const [selected, setSelected] = useState(op.property_ids);
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameOf = (id) => properties.find((p) => p.property_id === id)?.name || id;

  const patch = async (body, okMsg) => {
    setBusy(true); setError("");
    try {
      await api(`/api/cleaning/operators/${op.id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify(okMsg); setMode(null); setPw(""); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={S.row}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <strong>{op.email}</strong> {op.name ? <span style={S.muted}>· {op.name}</span> : null}{" "}
          <span style={S.badge(op.active)}>{op.active ? "사용 중" : "정지"}</span>
          <div style={S.muted}>
            {op.property_ids.length ? `숙소 ${op.property_ids.length}개: ${op.property_ids.map(nameOf).join(", ")}` : "배정된 숙소 없음 — 아무것도 보이지 않아요"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={S.btn} onClick={() => { setSelected(op.property_ids); setMode(mode === "props" ? null : "props"); }}>숙소 배정</button>
          <button type="button" style={S.btn} onClick={() => setMode(mode === "pw" ? null : "pw")}>비밀번호 재설정</button>
          <button type="button" style={op.active ? S.danger : S.btn} disabled={busy}
            onClick={() => patch({ active: !op.active }, op.active ? "정지했어요" : "다시 사용하도록 했어요")}>
            {op.active ? "정지" : "복구"}
          </button>
        </div>
      </div>
      {mode === "props" ? (
        <div style={{ marginTop: 10 }}>
          <PropertyChecklist properties={properties} selected={selected} onChange={setSelected} />
          <button type="button" style={S.primary} disabled={busy} onClick={() => patch({ property_ids: selected }, "숙소 배정을 저장했어요")}>저장</button>
        </div>
      ) : null}
      {mode === "pw" ? (
        <div style={{ marginTop: 10 }}>
          <input style={S.input} type="password" autoComplete="new-password" placeholder="새 임시 비밀번호 (10자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} maxLength={200} />
          <button type="button" style={S.primary} disabled={busy || pw.length < 10} onClick={() => patch({ password: pw }, "비밀번호를 바꿨어요")}>비밀번호 변경</button>
        </div>
      ) : null}
      {error ? <p style={{ ...S.err, marginTop: 8 }} role="alert">{error}</p> : null}
    </div>
  );
}

function AddForm({ properties, onDone, onCancel }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/api/cleaning/operators", { method: "POST", body: JSON.stringify({ email, name, password, property_ids: selected }) });
      notify("운영자를 추가했어요"); onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form style={S.row} onSubmit={submit}>
      <input style={S.input} type="email" placeholder="이메일 (로그인 ID)" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
      <input style={S.input} type="text" placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <input style={S.input} type="password" autoComplete="new-password" placeholder="임시 비밀번호 (10자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} />
      <div style={S.muted}>볼 수 있는 숙소 (선택하지 않으면 아무것도 보이지 않아요)</div>
      <PropertyChecklist properties={properties} selected={selected} onChange={setSelected} />
      {error ? <p style={S.err} role="alert">{error}</p> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={S.primary} disabled={busy || !email || password.length < 10}>추가</button>
        <button type="button" style={S.btn} onClick={onCancel}>취소</button>
      </div>
    </form>
  );
}

export default function OperatorManager({ onClose }) {
  const [operators, setOperators] = useState(null);
  const [properties, setProperties] = useState([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ops, props] = await Promise.all([api("/api/cleaning/operators"), api("/api/cleaning/properties?view=names")]);
      setOperators(ops); setProperties(props); setError("");
    } catch (e) { setError(e.message); setOperators([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label="운영자 관리">
      <div style={S.modal}>
        <div style={S.head}>
          <h2 style={S.h}>운영자 관리</h2>
          <button type="button" style={S.btn} onClick={onClose}>닫기</button>
        </div>
        <p style={{ ...S.muted, marginTop: 0 }}>운영자는 배정된 숙소만 볼 수 있어요. 숙소 설정·담당자 추가·스마트홈·CCTV는 관리자만 쓸 수 있어요.</p>
        {error ? <p style={S.err} role="alert">{error}</p> : null}
        {adding ? (
          <AddForm properties={properties} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
        ) : (
          <button type="button" style={{ ...S.primary, marginBottom: 12 }} onClick={() => setAdding(true)}>+ 운영자 추가</button>
        )}
        {operators === null ? <p style={S.muted}>불러오는 중…</p> : null}
        {operators?.length === 0 && !error ? <p style={S.muted}>아직 운영자가 없어요.</p> : null}
        {operators?.map((op) => <OperatorRow key={op.id} op={op} properties={properties} onChanged={load} />)}
      </div>
    </div>
  );
}
