import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  Check, ChevronDown, ArrowRight, Zap,
  Bell, BarChart3, MessageSquare, Calendar, Shield, Wifi,
  Star,
} from "lucide-react";

// ============================================================
// LandingPageV2.jsx — Guesty급 기업 홍보 랜딩 (PROPOS v2)
// ============================================================

const NAV_LINKS = [
  { label: "기능", href: "#features" },
  { label: "사용법", href: "#how-it-works" },
  { label: "요금제", href: "#pricing" },
  { label: "고객 사례", href: "#testimonials" },
];

const STATS = [
  { value: "14h", unit: "/월", label: "절감 가능한 반복 운영 시간" },
  { value: "100+", unit: "", label: "단일 대시보드 관리 가능 숙소" },
  { value: "5단계", unit: "", label: "체크인→정산 완전 자동화" },
  { value: "24/7", unit: "", label: "IoT 로컬 자동 동작" },
];

const FEATURES_MAIN = [
  {
    tag: "체크인 & 체크아웃",
    title: "비대면 입실부터\nPIN 자동 만료까지",
    desc: "예약이 확정되면 PIN이 자동 발급됩니다. 체크아웃 후에는 PIN이 자동으로 만료됩니다. 현장에 나가지 않아도 됩니다.",
    img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=640&h=420&q=80",
    points: ["예약 확인 → PIN 자동 발급", "체크아웃 직후 PIN 자동 만료", "입실 알림 실시간 수신"],
    reverse: false,
  },
  {
    tag: "실시간 IoT 모니터링",
    title: "집에 있는 것처럼\n모든 숙소를 봅니다",
    desc: "라즈베리파이 + Home Assistant로 온도, 습도를 실시간 감지합니다. 지원 센서에 따라 소음·전력 모니터링도 가능합니다.",
    img: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=640&h=420&q=80",
    points: ["온도·습도 실시간 센싱", "이상 감지 시 즉시 알림", "인터넷 없이도 로컬 자동 동작"],
    reverse: true,
  },
  {
    tag: "청소 & 운영 자동화",
    title: "청소팀 배정부터\n체크리스트까지 자동",
    desc: "퇴실 감지 즉시 청소팀에 알림이 가고, 숙소별 체크리스트가 자동 생성됩니다. 모든 숙소를 동일한 품질로.",
    img: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=640&h=420&q=80",
    points: ["퇴실 감지 → 청소팀 즉시 알림", "숙소별 맞춤 체크리스트", "완료 사진 업로드 및 확인"],
    reverse: false,
  },
];

const FEATURE_CARDS = [
  { Icon: Bell, title: "스마트 알림", desc: "중요한 이벤트만 골라 즉시 알림. 노이즈 없는 운영." },
  { Icon: BarChart3, title: "수익 분석", desc: "채널별 수익을 한눈에. 월별 추이와 플랫폼 비교 리포트 제공." },
  { Icon: MessageSquare, title: "메시지 관리", desc: "게스트 문의 이력을 한곳에. 빠른 응답 템플릿 지원." },
  { Icon: Calendar, title: "예약 캘린더", desc: "Airbnb iCal 실시간 동기화. 더블북 원천 차단." },
  { Icon: Shield, title: "보안 접근 제어", desc: "숙소마다 독립 PIN. 출입 히스토리 전체 기록." },
  { Icon: Zap, title: "5단계 자동화", desc: "체크인 전날 → 체크인 → 체류 → 체크아웃 → 정산까지 단계별 자동 실행." },
];

const STEPS = [
  {
    num: "01",
    title: "숙소 등록 & 연동",
    desc: "Airbnb iCal URL 붙여넣기. 스마트 기기를 Home Assistant에 연결합니다. 설정 가이드를 따라 첫 숙소를 등록합니다.",
  },
  {
    num: "02",
    title: "자동화 규칙 설정",
    desc: "체크인 시간, 청소팀 연락처, PIN 만료 규칙 등 숙소별 설정. 한 번 설정하면 이후엔 자동입니다.",
  },
  {
    num: "03",
    title: "관리자 혼자 100개 숙소 운영",
    desc: "알림이 올 때만 앱을 확인하면 됩니다. 나머지는 PROPOS가 처리합니다.",
  },
];

const PRICING = [
  {
    tier: "스타터",
    price: "29,000",
    period: "/월",
    desc: "소규모 운영자를 위한 시작 플랜",
    highlight: false,
    cta: "시작하기",
    features: [
      "숙소 최대 5개",
      "체크인/아웃 자동화",
      "기본 알림",
      "예약 캘린더 동기화",
      "이메일 지원",
    ],
  },
  {
    tier: "프로",
    price: "79,000",
    period: "/월",
    desc: "성장하는 호스트를 위한 완전 자동화",
    highlight: true,
    cta: "14일 무료 체험",
    features: [
      "숙소 무제한",
      "IoT 실시간 모니터링",
      "AI 메시지 자동 초안",
      "청소팀 자동 배정",
      "수익 분석 + AI 가격 최적화",
      "우선 지원",
    ],
  },
  {
    tier: "엔터프라이즈",
    price: "별도 문의",
    period: "",
    desc: "100개+ 대규모 운영사를 위한 맞춤형",
    highlight: false,
    cta: "문의하기",
    features: [
      "프로 플랜 전체 포함",
      "맞춤 IoT 연동 지원",
      "전담 매니저",
      "SLA 보장",
      "온보딩 교육",
    ],
  },
];

const TESTIMONIALS = [
  {
    name: "김현준",
    role: "에어비앤비 호스트 · 서울 14개 숙소 운영",
    quote: "전에는 하루에 두세 번 직접 숙소를 확인하러 갔어요. 지금은 앱 알림만 보면 됩니다. 반복 이동이 거의 없어졌어요.",
    metric: "반복 이동 제거",
    img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&h=80&q=80",
  },
  {
    name: "박지수",
    role: "숙박업 운영사 · 강남 28개 숙소 관리",
    quote: "청소팀 배정이 자동으로 되니까 퇴실 후 공백 시간이 줄었어요. 회전율이 올라가면서 수익에도 차이가 생겼습니다.",
    metric: "회전율 개선",
    img: "https://images.unsplash.com/photo-1494790108755-2616b612b786?auto=format&fit=crop&w=80&h=80&q=80",
  },
  {
    name: "이성민",
    role: "부동산 투자자 · 전국 20개 숙소 운영",
    quote: "숙소가 늘어날수록 관리 시간도 그만큼 늘 것 같아 걱정이었는데, 자동화 덕분에 운영 부담이 훨씬 덜해졌어요.",
    metric: "운영 부담 감소",
    img: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=80&h=80&q=80",
  },
];

const FAQS = [
  {
    q: "스마트 기기가 없어도 사용할 수 있나요?",
    a: "네. 스마트 기기 없이도 예약 관리, 청소 자동화, 수익 분석 기능은 모두 사용 가능합니다. IoT 연동은 기기 구매 후 언제든 추가할 수 있습니다.",
  },
  {
    q: "라즈베리파이 설치가 어렵지 않나요?",
    a: "기본 설정 가이드를 제공합니다. Home Assistant 설치부터 스마트 기기 연동까지 단계별 문서를 따라가면 기술 지식 없이도 설정 가능합니다.",
  },
  {
    q: "Airbnb 외 다른 플랫폼도 지원하나요?",
    a: "현재 Airbnb iCal을 지원하며, 야놀자·Booking.com·VRBO 연동을 순차적으로 추가할 예정입니다.",
  },
  {
    q: "숙소 수에 따라 요금이 달라지나요?",
    a: "스타터 플랜은 5개까지, 프로 플랜은 무제한입니다. 100개 이상 대형 운영은 엔터프라이즈로 별도 협의합니다.",
  },
  {
    q: "무료 체험 이후 자동 결제되나요?",
    a: "아닙니다. 14일 무료 체험은 신용카드 없이 시작할 수 있으며, 체험 종료 후 직접 플랜을 선택해야 합니다.",
  },
];

// ── Animation helpers ─────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

function Section({ children, style }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={staggerContainer}
      style={style}
    >
      {children}
    </motion.div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #e5e7eb" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "20px 0", background: "none",
          border: "none", cursor: "pointer", textAlign: "left",
          fontSize: 17, fontWeight: 600, color: "#111827",
        }}
      >
        <span>{q}</span>
        <ChevronDown
          size={20}
          style={{
            flexShrink: 0, marginLeft: 12, color: "#6b7280",
            transition: "transform 0.25s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{ overflow: "hidden" }}
      >
        <p style={{ paddingBottom: 20, color: "#6b7280", lineHeight: 1.75, fontSize: 15, margin: 0 }}>{a}</p>
      </motion.div>
    </div>
  );
}

// ── Dashboard mockup ──────────────────────────────────────────
function DashboardMockup() {
  const STATUS_GRID = [
    { id: "01", status: "g" }, { id: "02", status: "g" }, { id: "03", status: "r" },
    { id: "04", status: "g" }, { id: "05", status: "y" }, { id: "06", status: "g" },
    { id: "07", status: "g" }, { id: "08", status: "r" }, { id: "09", status: "g" },
    { id: "10", status: "g" }, { id: "11", status: "y" }, { id: "12", status: "g" },
    { id: "13", status: "g" }, { id: "14", status: "g" }, { id: "15", status: "g" },
    { id: "16", status: "r" }, { id: "17", status: "g" }, { id: "18", status: "g" },
  ];
  const palette = {
    g: { bg: "#dcfce7", border: "#86efac", dot: "#16a34a" },
    r: { bg: "#fee2e2", border: "#fca5a5", dot: "#dc2626" },
    y: { bg: "#fef3c7", border: "#fcd34d", dot: "#d97706" },
  };
  return (
    <div style={{
      background: "#fff", borderRadius: 20, overflow: "hidden",
      boxShadow: "0 32px 80px rgba(17,24,39,0.14), 0 0 0 1px rgba(0,0,0,0.06)",
      maxWidth: 900, margin: "0 auto",
    }}>
      {/* Browser chrome */}
      <div style={{ background: "#f3f4f6", padding: "10px 18px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ width: 11, height: 11, background: "#ef4444", borderRadius: "50%" }} />
        <div style={{ width: 11, height: 11, background: "#f59e0b", borderRadius: "50%" }} />
        <div style={{ width: 11, height: 11, background: "#22c55e", borderRadius: "50%" }} />
        <div style={{ flex: 1, background: "#e5e7eb", borderRadius: 5, height: 26, marginLeft: 10, display: "flex", alignItems: "center", paddingLeft: 10 }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>app.propos.io/command-center</span>
        </div>
      </div>
      {/* App layout */}
      <div style={{ display: "flex", height: 380 }}>
        {/* Sidebar */}
        <div style={{ width: 186, background: "#1e293b", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: "0.15em", marginBottom: 22, paddingLeft: 6 }}>
            PROP<span style={{ color: "#60a5fa" }}>OS</span>
          </div>
          {[
            ["커맨드 센터", true],
            ["IoT 모니터링", false],
            ["체크인/아웃", false],
            ["청소 관리", false],
            ["수익 분석", false],
          ].map(([label, active]) => (
            <div key={label} style={{
              padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: active ? 600 : 500,
              color: active ? "#fff" : "#94a3b8",
              background: active ? "rgba(255,255,255,0.12)" : "transparent",
            }}>{label}</div>
          ))}
        </div>
        {/* Main */}
        <div style={{ flex: 1, background: "#f8fafc", padding: "20px 22px", overflow: "hidden" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 14 }}>전체 숙소 현황</div>
          {/* Stat pills */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
            {[
              { label: "정상 운영", value: "41", bg: "#dcfce7", color: "#059669" },
              { label: "개입 필요", value: "3",  bg: "#fee2e2", color: "#dc2626" },
              { label: "청소 중",   value: "6",  bg: "#fef3c7", color: "#d97706" },
              { label: "체크인 예정", value: "8", bg: "#dbeafe", color: "#2563eb" },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Property grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 7 }}>
            {STATUS_GRID.map(({ id, status }) => {
              const c = palette[status];
              return (
                <div key={id} style={{
                  background: c.bg, border: `1px solid ${c.border}`,
                  borderRadius: 7, padding: "7px 8px",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#374151" }}>#{id}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Alert panel */}
        <div style={{ width: 200, background: "#fff", borderLeft: "1px solid #e5e7eb", padding: "16px 14px", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 1, marginBottom: 12 }}>LIVE 알림</div>
          {[
            { dot: "#dc2626", msg: "숙소 #03 PIN 실패 3회", time: "방금" },
            { dot: "#d97706", msg: "숙소 #05 온도 28°C 초과", time: "2분 전" },
            { dot: "#2563eb", msg: "숙소 #12 체크인 완료", time: "7분 전" },
            { dot: "#059669", msg: "숙소 #09 청소 완료", time: "14분 전" },
          ].map((a) => (
            <div key={a.msg} style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-start" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.dot, marginTop: 4, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.4 }}>{a.msg}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function LandingPageV2({ onEnterApp, onSwitchVersion }) {
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const saved = {
      htmlOverflow: html.style.overflow, htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow, bodyHeight: body.style.height,
      rootOverflow: root?.style.overflow ?? "", rootHeight: root?.style.height ?? "",
    };
    html.style.overflow = "auto"; html.style.height = "auto";
    body.style.overflow = "auto"; body.style.height = "auto";
    if (root) { root.style.overflow = "auto"; root.style.height = "auto"; }
    return () => {
      html.style.overflow = saved.htmlOverflow; html.style.height = saved.htmlHeight;
      body.style.overflow = saved.bodyOverflow; body.style.height = saved.bodyHeight;
      if (root) { root.style.overflow = saved.rootOverflow; root.style.height = saved.rootHeight; }
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#111827", background: "#fff", minHeight: "100vh" }}>

      {/* ─── NAV ─── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        background: navScrolled ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0)",
        borderBottom: navScrolled ? "1px solid #e5e7eb" : "1px solid transparent",
        backdropFilter: navScrolled ? "blur(14px)" : "none",
        transition: "all 0.3s ease",
      }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", height: 66, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 19, fontWeight: 700, letterSpacing: "0.14em", color: "#111827" }}>
            PROP<span style={{ color: "#1a56db" }}>OS</span>
          </div>

          <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {NAV_LINKS.map(l => (
              <a
                key={l.label} href={l.href}
                style={{ color: "#4b5563", fontSize: 14, fontWeight: 500, textDecoration: "none" }}
                onMouseEnter={e => e.currentTarget.style.color = "#1a56db"}
                onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}
              >{l.label}</a>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={onSwitchVersion}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 12, padding: "4px 8px" }}
            >V1 보기</button>
            <button
              onClick={onEnterApp}
              style={{ background: "none", border: "1.5px solid #d1d5db", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#1a56db"; e.currentTarget.style.color = "#1a56db"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.color = "#374151"; }}
            >로그인</button>
            <button
              onClick={onEnterApp}
              style={{ background: "#1a56db", border: "2px solid #1a56db", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#fff" }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e40af"}
              onMouseLeave={e => e.currentTarget.style.background = "#1a56db"}
            >무료 체험 시작</button>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section style={{ paddingTop: 148, paddingBottom: 96, background: "linear-gradient(175deg, #eff6ff 0%, #fff 55%)" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            style={{ textAlign: "center", maxWidth: 800, margin: "0 auto" }}
          >
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 20, padding: "5px 14px", marginBottom: 28,
              fontSize: 12, fontWeight: 700, color: "#1d4ed8", letterSpacing: "0.05em",
            }}>
              <Zap size={13} />완전 자동화 숙소 관리 시스템
            </div>

            <h1 style={{
              fontSize: "clamp(38px, 5.5vw, 64px)", fontWeight: 800,
              lineHeight: 1.13, color: "#111827", marginBottom: 24,
              fontFamily: "'Nunito', sans-serif",
            }}>
              숙소 100개,{" "}<br />
              <span style={{ color: "#1a56db" }}>관리자는 1명</span>으로 충분합니다
            </h1>

            <p style={{
              fontSize: "clamp(16px, 1.8vw, 20px)", color: "#6b7280", lineHeight: 1.75,
              marginBottom: 40, maxWidth: 540, margin: "0 auto 40px",
            }}>
              체크인부터 정산까지, 숙소 운영의 전 과정을 자동화합니다.<br />
              라즈베리파이 IoT 통합으로 인터넷 없이도 24시간 작동합니다.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={onEnterApp}
                style={{
                  background: "#1a56db", border: "2px solid #1a56db",
                  borderRadius: 10, padding: "14px 30px", fontSize: 16, fontWeight: 700,
                  cursor: "pointer", color: "#fff",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#1e40af"}
                onMouseLeave={e => e.currentTarget.style.background = "#1a56db"}
              >
                무료로 시작하기 <ArrowRight size={18} />
              </button>
              <button
                onClick={onEnterApp}
                style={{
                  background: "#fff", border: "2px solid #e5e7eb",
                  borderRadius: 10, padding: "14px 30px", fontSize: 16, fontWeight: 700,
                  cursor: "pointer", color: "#374151",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#9ca3af"; e.currentTarget.style.background = "#f9fafb"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "#fff"; }}
              >
                데모 앱 체험
              </button>
            </div>

            <div style={{ marginTop: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.12em" }}>연동 플랫폼</span>
              {["Airbnb", "야놀자", "Booking.com", "VRBO"].map(p => (
                <span key={p} style={{ fontSize: 14, fontWeight: 700, color: "#b0bad0" }}>{p}</span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 56, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.85, delay: 0.25, ease: "easeOut" }}
            style={{ marginTop: 64 }}
          >
            <DashboardMockup />
          </motion.div>
        </div>
      </section>

      {/* ─── STATS ─── */}
      <section style={{ background: "#111827" }}>
        <Section style={{ maxWidth: 1160, margin: "0 auto", padding: "56px 24px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {STATS.map((s, i) => (
            <motion.div key={s.label} variants={fadeUp} style={{
              textAlign: "center", padding: "20px 8px",
              borderRight: i < STATS.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none",
            }}>
              <div style={{ fontSize: "clamp(30px, 3.5vw, 46px)", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
                {s.value}<span style={{ fontSize: "0.52em", color: "#60a5fa", fontWeight: 700 }}>{s.unit}</span>
              </div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 8, fontWeight: 500 }}>{s.label}</div>
            </motion.div>
          ))}
        </Section>
      </section>

      {/* ─── ALTERNATING FEATURES ─── */}
      <section id="features" style={{ padding: "108px 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 84 }}>
            <motion.p variants={fadeUp} style={{ fontSize: 12, fontWeight: 700, color: "#1a56db", letterSpacing: "0.16em", marginBottom: 12 }}>FEATURES</motion.p>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              운영의 모든 순간을 자동화합니다
            </motion.h2>
          </Section>

          <div style={{ display: "flex", flexDirection: "column", gap: 112 }}>
            {FEATURES_MAIN.map((f) => (
              <Section key={f.tag} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72, alignItems: "center" }}>
                {f.reverse ? (
                  <>
                    <motion.div variants={fadeUp} style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 20px 56px rgba(0,0,0,0.11)", aspectRatio: "3/2", order: 1 }}>
                      <img src={f.img} alt={f.tag} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </motion.div>
                    <motion.div variants={fadeUp} style={{ order: 2 }}>
                      <FeatureText f={f} onEnterApp={onEnterApp} />
                    </motion.div>
                  </>
                ) : (
                  <>
                    <motion.div variants={fadeUp}>
                      <FeatureText f={f} onEnterApp={onEnterApp} />
                    </motion.div>
                    <motion.div variants={fadeUp} style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 20px 56px rgba(0,0,0,0.11)", aspectRatio: "3/2" }}>
                      <img src={f.img} alt={f.tag} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </motion.div>
                  </>
                )}
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURE GRID ─── */}
      <section style={{ background: "#f8fafc", padding: "100px 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 56 }}>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              필요한 건 모두 여기 있습니다
            </motion.h2>
          </Section>
          <Section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
            {FEATURE_CARDS.map(c => (
              <motion.div
                key={c.title} variants={fadeUp}
                whileHover={{ y: -5, boxShadow: "0 12px 36px rgba(0,0,0,0.09)" }}
                transition={{ duration: 0.2 }}
                style={{
                  background: "#fff", borderRadius: 16, padding: "28px",
                  border: "1px solid #e5e7eb",
                }}
              >
                <div style={{ width: 44, height: 44, background: "#eff6ff", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <c.Icon size={22} color="#1a56db" />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{c.title}</div>
                <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.65 }}>{c.desc}</div>
              </motion.div>
            ))}
          </Section>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how-it-works" style={{ padding: "100px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 72 }}>
            <motion.p variants={fadeUp} style={{ fontSize: 12, fontWeight: 700, color: "#1a56db", letterSpacing: "0.16em", marginBottom: 12 }}>HOW IT WORKS</motion.p>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              3단계로 시작하세요
            </motion.h2>
          </Section>
          <Section style={{ display: "flex", flexDirection: "column" }}>
            {STEPS.map((s, i) => (
              <motion.div key={s.num} variants={fadeUp} style={{ display: "flex", gap: 36, alignItems: "flex-start", paddingBottom: i < STEPS.length - 1 ? 52 : 0 }}>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{
                    width: 50, height: 50, background: "#1a56db", borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: "#fff",
                  }}>{s.num}</div>
                  {i < STEPS.length - 1 && (
                    <div style={{ width: 2, minHeight: 44, flex: 1, background: "#e5e7eb", marginTop: 6 }} />
                  )}
                </div>
                <div style={{ paddingTop: 11 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, color: "#111827", marginBottom: 10, fontFamily: "'Nunito', sans-serif" }}>{s.title}</div>
                  <div style={{ fontSize: 15, color: "#6b7280", lineHeight: 1.75 }}>{s.desc}</div>
                </div>
              </motion.div>
            ))}
          </Section>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" style={{ background: "#f8fafc", padding: "100px 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 56 }}>
            <motion.p variants={fadeUp} style={{ fontSize: 12, fontWeight: 700, color: "#1a56db", letterSpacing: "0.16em", marginBottom: 12 }}>PRICING</motion.p>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              규모에 맞는 요금제
            </motion.h2>
            <motion.p variants={fadeUp} style={{ fontSize: 16, color: "#6b7280", marginTop: 10 }}>
              14일 무료 체험 · 신용카드 불필요
            </motion.p>
          </Section>
          <Section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, alignItems: "start" }}>
            {PRICING.map((p) => (
              <motion.div
                key={p.tier} variants={fadeUp}
                style={{
                  background: p.highlight ? "#1a56db" : "#fff",
                  borderRadius: 20, padding: "36px 30px",
                  border: p.highlight ? "none" : "1px solid #e5e7eb",
                  boxShadow: p.highlight ? "0 24px 64px rgba(26,86,219,0.28)" : "none",
                  position: "relative",
                }}
              >
                {p.highlight && (
                  <div style={{
                    position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)",
                    background: "#f59e0b", color: "#fff",
                    borderRadius: 20, padding: "4px 16px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", whiteSpace: "nowrap",
                  }}>가장 인기</div>
                )}
                <div style={{ fontSize: 18, fontWeight: 800, color: p.highlight ? "#fff" : "#111827", marginBottom: 6 }}>{p.tier}</div>
                <div style={{ fontSize: 13, color: p.highlight ? "rgba(255,255,255,0.65)" : "#6b7280", marginBottom: 20, lineHeight: 1.5 }}>{p.desc}</div>
                <div style={{ marginBottom: 26 }}>
                  {p.price === "별도 문의" ? (
                    <span style={{ fontSize: 26, fontWeight: 800, color: p.highlight ? "#fff" : "#111827" }}>{p.price}</span>
                  ) : (
                    <>
                      <span style={{ fontSize: 36, fontWeight: 800, color: p.highlight ? "#fff" : "#111827" }}>₩{p.price}</span>
                      <span style={{ fontSize: 14, color: p.highlight ? "rgba(255,255,255,0.65)" : "#6b7280" }}>{p.period}</span>
                    </>
                  )}
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 30px", display: "flex", flexDirection: "column", gap: 11 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: p.highlight ? "rgba(255,255,255,0.9)" : "#374151" }}>
                      <Check size={15} color={p.highlight ? "#93c5fd" : "#1a56db"} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={onEnterApp}
                  style={{
                    width: "100%", borderRadius: 10, padding: "12px 0",
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    background: p.highlight ? "#fff" : "#1a56db",
                    border: p.highlight ? "2px solid #fff" : "2px solid #1a56db",
                    color: p.highlight ? "#1a56db" : "#fff",
                  }}
                >{p.cta}</button>
              </motion.div>
            ))}
          </Section>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section id="testimonials" style={{ padding: "100px 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 60 }}>
            <motion.p variants={fadeUp} style={{ fontSize: 12, fontWeight: 700, color: "#1a56db", letterSpacing: "0.16em", marginBottom: 12 }}>TESTIMONIALS</motion.p>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              이미 운영자들이 경험하고 있습니다
            </motion.h2>
          </Section>
          <Section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
            {TESTIMONIALS.map(t => (
              <motion.div key={t.name} variants={fadeUp} style={{
                background: "#fff", borderRadius: 20, padding: "30px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
              }}>
                <div style={{ display: "flex", gap: 3, marginBottom: 18 }}>
                  {[...Array(5)].map((_, i) => <Star key={i} size={15} fill="#f59e0b" color="#f59e0b" />)}
                </div>
                <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.75, marginBottom: 22, fontStyle: "italic", margin: "0 0 22px" }}>
                  "{t.quote}"
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={t.img} alt={t.name} style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>{t.role}</div>
                    </div>
                  </div>
                  <div style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {t.metric}
                  </div>
                </div>
              </motion.div>
            ))}
          </Section>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section style={{ background: "#f8fafc", padding: "100px 24px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <Section style={{ textAlign: "center", marginBottom: 56 }}>
            <motion.h2 variants={fadeUp} style={{ fontSize: "clamp(28px, 3.5vw, 40px)", fontWeight: 800, color: "#111827", fontFamily: "'Nunito', sans-serif" }}>
              자주 묻는 질문
            </motion.h2>
          </Section>
          {FAQS.map(f => <FAQItem key={f.q} q={f.q} a={f.a} />)}
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section style={{ background: "#0f172a", padding: "108px 24px" }}>
        <Section style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
          <motion.h2 variants={fadeUp} style={{
            fontSize: "clamp(28px, 4vw, 52px)", fontWeight: 800, color: "#fff",
            lineHeight: 1.18, marginBottom: 20, fontFamily: "'Nunito', sans-serif",
          }}>
            지금 시작하면<br />
            <span style={{ color: "#60a5fa" }}>다음 체크인은 자동입니다</span>
          </motion.h2>
          <motion.p variants={fadeUp} style={{ fontSize: 17, color: "#94a3b8", marginBottom: 42, lineHeight: 1.75 }}>
            14일 무료 체험. 신용카드 불필요.
          </motion.p>
          <motion.div variants={fadeUp}>
            <button
              onClick={onEnterApp}
              style={{
                background: "#1a56db", border: "2px solid #1a56db",
                borderRadius: 12, padding: "16px 40px", fontSize: 17, fontWeight: 700,
                cursor: "pointer", color: "#fff",
                display: "inline-flex", alignItems: "center", gap: 10,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e40af"}
              onMouseLeave={e => e.currentTarget.style.background = "#1a56db"}
            >
              무료로 시작하기 <ArrowRight size={20} />
            </button>
          </motion.div>
        </Section>
      </section>

      {/* ─── FOOTER ─── */}
      <footer style={{ background: "#020617", padding: "44px 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: "0.14em" }}>
            PROP<span style={{ color: "#3b82f6" }}>OS</span>
          </div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {["서비스 소개", "이용약관", "개인정보처리방침", "문의하기"].map(l => (
              <a key={l} href="#" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}
                onMouseEnter={e => e.currentTarget.style.color = "#94a3b8"}
                onMouseLeave={e => e.currentTarget.style.color = "#64748b"}
              >{l}</a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#334155" }}>© 2026 PROPOS. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}

function FeatureText({ f }) {
  return (
    <>
      <div style={{
        display: "inline-block", background: "#eff6ff", color: "#1d4ed8",
        borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 700,
        letterSpacing: "0.1em", marginBottom: 18,
      }}>{f.tag}</div>
      <h3 style={{
        fontSize: "clamp(22px, 2.8vw, 34px)", fontWeight: 800, color: "#111827",
        lineHeight: 1.25, marginBottom: 16,
        fontFamily: "'Nunito', sans-serif", whiteSpace: "pre-line",
      }}>{f.title}</h3>
      <p style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.75, marginBottom: 28 }}>{f.desc}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {f.points.map(pt => (
          <li key={pt} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "#374151" }}>
            <span style={{ width: 22, height: 22, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Check size={12} color="#16a34a" strokeWidth={3} />
            </span>
            {pt}
          </li>
        ))}
      </ul>
    </>
  );
}
