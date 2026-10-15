import { Fragment, useCallback, useEffect, useState } from "react";
import OperatorManager from "./OperatorManager";


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
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, password }), // 이메일이 비어 있으면 관리자 로그인
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
          style={S.input} type="email" autoComplete="username" placeholder="이메일 (관리자는 비워 두세요)"
          value={email} onChange={(e) => setEmail(e.target.value)} aria-label="이메일" maxLength={254}
        />
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
  const [role, setRole] = useState("admin");
  const [managing, setManaging] = useState(false);
  const [epoch, setEpoch] = useState(0); // 로그인 직후 화면을 새로 마운트해 데이터를 다시 받는다

  useEffect(() => {
    patchFetchOnce();
    let alive = true;
    fetchAuthState().then((s) => {
      if (!alive) return;
      setRequired(!!s.required);
      setRole(s.role === "operator" ? "operator" : "admin");
      setState(s.required && !s.authenticated ? "login" : "open");
    });
    const onAuthRequired = () => { setManaging(false); setState("login"); }; // 세션이 끝나면 관리 창도 닫는다(다음 로그인 사람에게 남지 않게)
    window.addEventListener(AUTH_EVENT, onAuthRequired);
    return () => { alive = false; window.removeEventListener(AUTH_EVENT, onAuthRequired); };
  }, []);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* 쿠키는 만료로도 사라짐 */ }
    setManaging(false);
    setState("login");
  }, []);

  if (state === "checking") return null;
  if (state === "login") {
    return <LoginScreen onDone={async () => {
      const s = await fetchAuthState(); // 방금 로그인한 사람이 관리자인지 운영자인지
      setRequired(true); setRole(s.role === "admin" ? "admin" : "operator"); // 확인에 실패하면 최소 권한(운영자)으로 본다
      setEpoch((n) => n + 1); setState("open");
    }} />;
  }
  return (
    <>
      {/* div 로 감싸지 않는다 — 앱 레이아웃(height:100% 등)을 바꾸지 않기 위해 Fragment */}
      <Fragment key={epoch}>
        {children}
        {/* 로그인이 필수일 때만(= 인증을 켠 뒤) 보인다. off/log 상태에서는 화면이 전혀 바뀌지 않는다. */}
        {required && role === "admin" ? <button type="button" style={{ ...S.logout, right: 90 }} onClick={() => setManaging(true)}>운영자 관리</button> : null}
        {required ? <button type="button" style={S.logout} onClick={logout}>로그아웃</button> : null}
        {managing && required && role === "admin" ? <OperatorManager onClose={() => setManaging(false)} /> : null}
      </Fragment>
    </>
  );
}
