import { useCallback, useEffect, useState } from "react";

// 운영자 로그인 문지기 (D-033). 서버가 로그인을 요구(enforce)할 때만 로그인 화면을 보여준다.
// off/log 모드이거나 /api/auth/me 가 없으면(로컬 개발 서버) 앱이 그대로 열린다 — 배포해도 동작이 바뀌지 않는다.
// 인증은 HttpOnly 쿠키라 기존 fetch 호출은 고치지 않아도 되고, 어느 API 든 401 이 오면 로그인 화면으로 돌아온다.

const AUTH_EVENT = "propos:auth-required";

let patched = false;
function patchFetchOnce() {
  if (patched || typeof window === "undefined" || !window.fetch) return;
  patched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (response.status === 401 && url.includes("/api/") && !url.includes("/api/auth/")) {
      window.dispatchEvent(new Event(AUTH_EVENT));
    }
    return response;
  };
}

async function fetchAuthState() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return { required: false };
    return await res.json();
  } catch {
    return { required: false }; // 개발 서버 등 인증 API 가 없는 환경
  }
}

const S = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8", fontFamily: "'DM Sans','Nunito',sans-serif", padding: 16 },
  card: { width: "100%", maxWidth: 360, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 12, padding: 24, boxShadow: "0 2px 12px rgba(15,23,42,0.06)" },
  title: { fontSize: 20, fontWeight: 800, color: "#1a202c", margin: "0 0 4px" },
  sub: { fontSize: 13, color: "#64748b", margin: "0 0 18px" },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 15, border: "1px solid #94a3b8", borderRadius: 8, background: "#fff", color: "#1a202c", marginBottom: 10 },
  btn: { width: "100%", padding: "11px 12px", fontSize: 15, fontWeight: 700, color: "#ffffff", background: "#1a202c", border: "1px solid #1a202c", borderRadius: 8, cursor: "pointer" },
  btnOff: { opacity: 0.6, cursor: "default" },
  error: { color: "#b91c1c", fontSize: 13, margin: "0 0 10px" },
  logout: { position: "fixed", right: 10, bottom: 10, zIndex: 9999, padding: "6px 10px", fontSize: 12, fontWeight: 700, color: "#334155", background: "#ffffff", border: "1px solid #94a3b8", borderRadius: 8, cursor: "pointer" },
};

function LoginScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) { setPassword(""); onDone(); return; }
      const body = await res.json().catch(() => ({}));
      setError(body.error || "로그인에 실패했어요");
    } catch {
      setError("서버에 연결할 수 없어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <form style={S.card} onSubmit={submit}>
        <h1 style={S.title}>PROPOS 운영자 로그인</h1>
        <p style={S.sub}>운영자만 접근할 수 있어요.</p>
        <input
          style={S.input} type="password" autoComplete="current-password" autoFocus
          placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)}
          aria-label="비밀번호" maxLength={200}
        />
        {error ? <p style={S.error} role="alert">{error}</p> : null}
        <button type="submit" style={{ ...S.btn, ...(busy || !password ? S.btnOff : null) }} disabled={busy || !password}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [state, setState] = useState("checking"); // checking | login | open
  const [required, setRequired] = useState(false);
  const [epoch, setEpoch] = useState(0); // 로그인 직후 화면을 새로 마운트해 데이터를 다시 받는다

  useEffect(() => {
    patchFetchOnce();
    let alive = true;
    fetchAuthState().then((s) => {
      if (!alive) return;
      setRequired(!!s.required);
      setState(s.required && !s.authenticated ? "login" : "open");
    });
    const onAuthRequired = () => setState("login");
    window.addEventListener(AUTH_EVENT, onAuthRequired);
    return () => { alive = false; window.removeEventListener(AUTH_EVENT, onAuthRequired); };
  }, []);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* 쿠키는 만료로도 사라짐 */ }
    setState("login");
  }, []);

  if (state === "checking") return null;
  if (state === "login") return <LoginScreen onDone={() => { setRequired(true); setEpoch((n) => n + 1); setState("open"); }} />;
  return (
    <div key={epoch}>
      {children}
      {required ? <button type="button" style={S.logout} onClick={logout}>로그아웃</button> : null}
    </div>
  );
}
