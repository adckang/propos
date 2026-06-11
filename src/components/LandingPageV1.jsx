import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Home, Volume2, Zap, ClipboardCheck, Settings,
  CheckCircle2, ChevronDown, ChevronUp,
  MessageCircle, FileCheck2, Package, Wrench, BellRing,
} from "lucide-react";
import { trackEvent } from "../lib/analytics.js";
import IntroScene from "./IntroScene";
import HeroScene from "./HeroScene";
import Scene2NoisePrevention from "./Scene2NoisePrevention";
import Scene3EnergySaving from "./Scene3EnergySaving";
import Scene4CleaningMonitor from "./Scene4CleaningMonitor";
import Scene5AIEngine from "./Scene5AIEngine";

/* ── animation presets ── */
const up = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },        /* y: 32→24: 더 절제된 세로 이동 */
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px 0px" },  /* 60px 이상 진입 후 실행 */
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});
const reveal = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.97, y: 20 },
  whileInView: { opacity: 1, scale: 1, y: 0 },
  viewport: { once: true, margin: "-40px 0px" },
  transition: { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] },
});
/* D7: 씬 이미지 좌우 교차 등장 — 스크롤 리듬 형성
   dir=1 → 오른쪽에서 진입, dir=-1 → 왼쪽에서 진입
   짝수 씬(0,2): 오른쪽, 홀수 씬(1,3): 왼쪽 */
const revealDir = (dir = 1, delay = 0) => ({
  initial: { opacity: 0, x: dir * 32, y: 8 },
  whileInView: { opacity: 1, x: 0, y: 0 },
  viewport: { once: true, margin: "-40px 0px" },
  transition: { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] },
});

/* ── 5 core scenes ── */
const SCENES = [
  {
    id: "01",
    icon: Home,
    eyebrow: "체크인 완벽 준비",
    img: "/images/scene-1-mobile-bg.png",
    accent: "#67e8f9",
    points: [
      "입실 전 온도·환기·조명·음악까지 자동 세팅",
      "완벽한 첫인상이 별점과 수익을 결정합니다",
      "별점 1점 상승 시 예약률 최대 20% 증가",
    ],
  },
  {
    id: "02",
    icon: Volume2,
    eyebrow: "소음 민원 사전 예방",
    img: "/images/scene-2-desktop-bg.png",
    imgMobile: "/images/scene-2-mobile-bg.png",
    accent: "#f87171",
    points: [
      "소음 기준 초과 시 호스트에게 즉시 경고",
      "녹음 없이 dB 수준만 감지 — 프라이버시 보호",
      "발생 전 차단, 사후 수습 비용 제로",
    ],
  },
  {
    id: "03",
    icon: Zap,
    eyebrow: "에너지 자동 절전",
    img: "/images/scene-3.png",
    accent: "#fcd34d",
    points: [
      "에어컨·조명·대기전력 퇴실 후 자동 OFF",
      "창문·현관 열림 상태 실시간 감지",
      "하루 평균 4,320원 · 한 달 13만원 에너지 절감",
    ],
  },
  {
    id: "04",
    icon: ClipboardCheck,
    eyebrow: "청소 현황 실시간 파악",
    img: "/images/scene-4.png",
    accent: "#86efac",
    points: [
      "현관 출입 기록 자동 저장 — 청소 시작 즉시 알림",
      "퇴실 → 청소 시작 → 완료까지 자동 타임라인",
      "신뢰할 수 있는 청소 담당자 활동 기록",
    ],
  },
  {
    id: "05",
    icon: Settings,
    eyebrow: "AI 통합 관리 엔진",
    img: "/images/scene-5.png",
    accent: "#c4b5fd",
    points: [
      "센서·예약·날씨 정보를 AI가 종합 판단하여 자동 처리",
      "주간 리포트로 비용 패턴 및 이상 징후 감지",
      "당신의 편안한 순간, AI가 지능적으로 운영합니다",
    ],
  },
];

/* ── pricing ── */
const PACKAGES = [
  {
    name: "시작형",
    eventPlan: "pilot",
    tag: "1개 숙소 시작",
    price: "기기 구매 50만원 전후",
    monthly: "월 운영비 없이 시작 가능",
    desc: "해외 직구와 셀프 설치를 기준으로, 1개 숙소에서 자동화의 핵심 기능을 가장 가볍게 시작하는 방식입니다.",
    includes: ["직구 구매 가이드", "셀프 설치 체크리스트", "체크인/퇴실 자동 알림", "에너지 자동 절전", "청소 타임라인"],
    cta: "시작 비용 문의",
    highlight: false,
  },
  {
    name: "운영 지원형",
    eventPlan: "operation",
    tag: "추천",
    price: "기기 구매 + 월 3만원",
    monthly: "설정 · 장애 · 알림 · 리포트 지원",
    desc: "복잡한 설정과 운영 관리를 직접 붙잡고 있지 않도록, 필요한 순간만 확인하면 되는 운영 지원형 구성입니다.",
    includes: ["시작형 전체 포함", "시스템 설정 지원", "장애 대응 및 알림 설정", "주간 운영 리포트", "문제 발생 시 우선 안내"],
    cta: "운영 지원 상담",
    highlight: true,
  },
  {
    name: "확장형",
    eventPlan: "multi",
    tag: "2개 이상 / 다호점",
    price: "별도 견적",
    monthly: "",
    desc: "숙소 수가 늘어나거나 건물 단위로 관리해야 할 때, 동선과 운영 구조에 맞춰 센서 구성과 지원 범위를 다시 설계합니다.",
    includes: ["운영 지원형 전체 포함", "숙소별 운영 구조 설계", "다호점 통합 리포트", "현장 조건별 맞춤 구성"],
    cta: "확장 견적 문의",
    highlight: false,
  },
];

const VALUE_EXPLAINERS = [
  {
    icon: Package,
    eyebrow: "왜 이런 가격이 가능한가",
    title: "해외 직구 지원으로 거품을 뺐습니다",
    body: "필요한 기기를 해외 직구로 안내하고, 셀프 설치가 가능하도록 도와드려 불필요한 시공 마진을 줄였습니다.",
    points: ["직구 구매 가이드 제공", "숙소 구조별 추천 구성 안내"],
    accent: "#22d3ee",
  },
  {
    icon: Wrench,
    eyebrow: "설치가 어렵지 않은가",
    title: "배터리 넣고, 양면테이프로 붙이면 끝",
    body: "센서 대부분은 공구 없이 부착할 수 있어 처음 설치하는 분도 부담이 적습니다. 어렵게 느껴지는 부분만 체크리스트로 따라가면 됩니다.",
    points: ["설치 순서 안내", "누구나 따라 하는 셀프 설치"],
    accent: "#67e8f9",
  },
  {
    icon: BellRing,
    eyebrow: "설정과 관리도 맡길 수 있나",
    title: "월 3만원이면 설정·장애·알림·리포트를 지원합니다",
    body: "복잡한 시스템을 직접 운영하실 필요 없습니다. 문제 있을 때만 알림을 받고, 주간 리포트로 운영 상태만 확인하시면 됩니다.",
    points: ["시스템 설정 지원", "장애 대응·알림 설정·주간 리포트"],
    accent: "#38bdf8",
  },
];

const PROOF_CARDS = [
  {
    icon: Wrench,
    title: "설치는 대부분 공구 없이 시작됩니다",
    body: "배터리와 양면테이프 중심의 센서 구성이라, 복잡한 시공 없이도 첫 도입이 가능합니다.",
    accent: "#67e8f9",
  },
  {
    icon: Volume2,
    title: "소음은 녹음 없이 기준만 감지합니다",
    body: "대화 내용을 저장하지 않고 dB 수준과 기준 초과 여부만 확인해 프라이버시 불안을 줄입니다.",
    accent: "#f87171",
  },
  {
    icon: ClipboardCheck,
    title: "청소 흐름은 센서 기준으로 바로 확인합니다",
    body: "퇴실 이후 청소 시작과 완료 흐름을 기록으로 확인해, CCTV 없이도 운영 상황을 빠르게 파악할 수 있습니다.",
    accent: "#86efac",
  },
  {
    icon: FileCheck2,
    title: "주간 리포트와 알림만 보면 됩니다",
    body: "매번 앱을 열어보지 않아도 필요한 순간의 알림과 요약 리포트로 운영 상태를 확인할 수 있습니다.",
    accent: "#38bdf8",
  },
];

/* ── faq ── */
const FAQS = [
  {
    id: "faq_1",
    q: "왜 이렇게 낮은 비용으로 시작할 수 있나요?",
    a: "SPACE HOST는 해외 직구와 셀프 설치를 기준으로 안내해 불필요한 시공 마진을 줄입니다. 그래서 기기 구매를 50만원 전후에서 시작하고, 필요할 때만 운영 지원을 추가하는 방식이 가능합니다.",
  },
  {
    id: "faq_2",
    q: "설치가 정말 어렵지 않나요?",
    a: "대부분의 센서는 배터리를 넣고 양면테이프로 부착하는 방식이라 공구 없이도 설치할 수 있습니다. 숙소 구조에 맞는 설치 순서와 체크리스트를 함께 안내해드리므로 처음 해보는 분도 따라가기 어렵지 않습니다.",
  },
  {
    id: "faq_3",
    q: "월 3만원 운영 지원에는 무엇이 포함되나요?",
    a: "기본 설정 지원, 장애 대응, 알림 세팅, 주간 리포트 안내가 포함됩니다. 복잡한 시스템을 직접 계속 들여다보지 않아도, 필요한 순간의 알림과 운영 상태만 확인하실 수 있도록 돕는 서비스입니다.",
  },
  {
    id: "faq_4",
    q: "소음 감지는 녹음인가요?",
    a: "아닙니다. 대화 내용을 녹음하지 않고 dB 수준과 기준 초과 여부만 감지합니다. 게스트 프라이버시를 해치지 않으면서도 민원 가능성을 미리 파악하도록 설계되어 있습니다.",
  },
  {
    id: "faq_5",
    q: "청소 완료를 자동으로 보장해주나요?",
    a: "자동 보장은 아닙니다. 대신 퇴실 이후 청소 시작부터 완료까지의 흐름을 센서와 출입 기록 기준으로 추적해, 호스트가 현재 상태를 훨씬 더 빠르게 파악할 수 있도록 도와드립니다.",
  },
  {
    id: "faq_6",
    q: "숙소가 여러 개여도 적용할 수 있나요?",
    a: "가능합니다. 1개 숙소에서 먼저 시작한 뒤, 2개 이상이나 다호점 구조에서는 숙소별 동선과 운영 방식에 맞춰 센서 구성, 알림 기준, 리포트 구조를 확장형으로 다시 설계해드립니다.",
  },
];

/* ── SceneCard: SCENES 02-05 각 섹션 (m prop 수신 → 복잡도 분산) ── */
function SceneCard({ id, icon: Icon, eyebrow, img, imgMobile, accent, points, i, m }) {
  return (
    <section style={{
      padding: m ? "56px 16px" : "96px 40px",
      background: i % 2 === 0 ? "#04081a" : "#020617",
      borderTop: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <motion.div {...up(0)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: m ? 24 : 36 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            border: `1px solid ${accent}40`, background: `${accent}12`,
            borderRadius: 999, padding: m ? "6px 14px" : "7px 20px",
            fontSize: m ? 12 : 13, fontWeight: 700, color: accent,
          }}>
            <Icon size={13} />{id} · {eyebrow}
          </div>
        </motion.div>
        {/* D7: 씬 인덱스 기준 교차 방향 — 짝수 오른쪽, 홀수 왼쪽 */}
        <motion.div {...revealDir(i % 2 === 0 ? 1 : -1, 0.08)} style={{
          marginBottom: m ? 24 : 40,
          ...(m ? { marginLeft: -16, marginRight: -16, width: "calc(100% + 32px)" } : {}),
        }}>
          {/* imgMobile 있으면 picture 태그로 반응형 이미지 제공
              모바일 portrait 이미지는 objectFit cover + 고정 높이로 비율 제어 */}
          <picture>
            {imgMobile && <source media="(max-width: 768px)" srcSet={imgMobile} />}
            <img
              src={img}
              alt={eyebrow}
              style={{
                width: "100%",
                display: "block",
                borderRadius: m ? 0 : 20,
                boxShadow: `0 ${m ? 20 : 40}px ${m ? 40 : 80}px rgba(0,0,0,0.6), 0 0 60px ${accent}18`,
                ...(imgMobile && m
                  ? { height: 440, objectFit: "cover", objectPosition: "center 25%" }
                  : { height: "auto" }),
              }}
            />
          </picture>
        </motion.div>
        <motion.div {...up(0.15)} style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3, 1fr)", gap: m ? 10 : 16 }}>
          {points.map((text) => (
            <div key={text} style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: m ? "14px 16px" : "20px 22px",
              display: "flex", gap: 12, alignItems: "flex-start",
            }}>
              <CheckCircle2 size={15} color={accent} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: m ? 14 : 15, color: "#cbd5e1", lineHeight: 1.7 }}>{text}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ── PricingCard: 요금제 카드 1개 (m prop 수신 → 복잡도 분산) ── */
function PricingCard({ pkg, i, m, onCtaClick }) {
  const cardStyle = pkg.highlight
    ? { background: "linear-gradient(160deg, #0d62e8 0%, #0891b2 52%, #06b6d4 100%)", boxShadow: "0 0 0 1px rgba(103,232,249,0.8), 0 26px 54px rgba(6,182,212,0.28)" }
    : { border: "1px solid rgba(255,255,255,0.09)", background: "linear-gradient(180deg, rgba(15,23,42,0.84), rgba(8,15,30,0.74))", boxShadow: "0 18px 40px rgba(2,6,23,0.22)" };
  const btnStyle = pkg.highlight
    ? { background: "#fff", color: "#0891b2", border: "none" }
    : { background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" };
  return (
    <motion.div {...up(i * 0.1)}>
      <div style={{ borderRadius: 24, padding: m ? 24 : 32, height: "100%", boxSizing: "border-box", position: "relative", ...cardStyle }}>
        {pkg.highlight && (
          <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "#fff", color: "#0891b2", borderRadius: 999, padding: "4px 16px", fontSize: 11, fontWeight: 800 }}>
            {pkg.tag}
          </div>
        )}
        {!pkg.highlight && <span style={{ fontSize: 11, color: "rgba(148,163,184,0.82)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>{pkg.tag}</span>}
        <h3 style={{ fontSize: 24, fontWeight: 800, margin: "10px 0 6px" }}>{pkg.name}</h3>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{pkg.price}</div>
        {pkg.monthly && <div style={{ fontSize: 14, color: pkg.highlight ? "rgba(255,255,255,0.80)" : "rgba(226,232,240,0.66)", marginTop: 2 }}>{pkg.monthly}</div>}
        <p style={{ fontSize: 14, color: pkg.highlight ? "rgba(255,255,255,0.86)" : "rgba(226,232,240,0.72)", margin: "14px 0 22px", lineHeight: 1.75 }}>{pkg.desc}</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 26px", display: "flex", flexDirection: "column", gap: 10 }}>
          {pkg.includes.map((item) => (
            <li key={item} style={{ display: "flex", gap: 9, fontSize: 14, alignItems: "flex-start" }}>
              <CheckCircle2 size={15} color={pkg.highlight ? "#fff" : "#22d3ee"} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: pkg.highlight ? "#fff" : "#E2E8F0" }}>{item}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={() => onCtaClick(pkg.eventPlan)}
          style={{ width: "100%", borderRadius: 14, padding: "13px", fontSize: 15, fontWeight: 800, cursor: "pointer", ...btnStyle }}
        >
          {pkg.cta}
        </button>
      </div>
    </motion.div>
  );
}

function FAQItem({ q, a, faqId, onOpen }) {
  const [open, setOpen] = useState(false);
  const trackedOpenRef = useRef(false);

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen && !trackedOpenRef.current) {
      trackedOpenRef.current = true;
      onOpen?.(faqId);
    }
  };

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", borderRadius: 18, padding: "0 18px", boxShadow: "0 14px 28px rgba(2,6,23,0.16)" }}>
      <button
        onClick={handleToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "22px 0",
          background: "transparent", border: "none",
          cursor: "pointer", color: "#fff", textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.5, paddingRight: 24 }}>{q}</span>
        {open
          ? <ChevronUp size={18} color="#94a3b8" style={{ flexShrink: 0 }} />
          : <ChevronDown size={18} color="#94a3b8" style={{ flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{ paddingBottom: 22, color: "rgba(226,232,240,0.74)", fontSize: 15, lineHeight: 1.85 }}>
          {a}
        </div>
      )}
    </div>
  );
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

export default function LandingPageV1({ onEnterApp, onSwitchVersion }) {
  const m = useIsMobile();
  const inquiryMailHref = "mailto:hello@propos.kr?subject=SPACE%20HOST%20운영진단%20문의&body=숙소%20수:%0A숙소%20지역:%0A현재%20가장%20불편한%20운영%20문제:%0A연락%20가능한%20방법:";
  const pricingSectionRef = useRef(null);
  const priceViewTrackedRef = useRef(false);

  const scrollToSection = (id) => {
    if (typeof window === "undefined") return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleHeroPrimaryClick = () => {
    trackEvent("hero_cta_click", { location: "hero" });
    scrollToSection("consultation");
  };

  const handleHeroSecondaryClick = () => {
    scrollToSection("pricing");
  };

  const handlePriceCtaClick = (plan) => {
    trackEvent("price_cta_click", { plan });
    scrollToSection("consultation");
  };

  const handleFaqOpen = (faqId) => {
    trackEvent("faq_open", { question: faqId });
  };

  const openInquiryMail = () => {
    if (typeof window === "undefined") return;
    window.location.href = inquiryMailHref;
  };

  useEffect(() => {
    const root = document.getElementById("root");
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
    if (root) { root.style.overflow = "auto"; root.style.height = "auto"; }
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      if (root) { root.style.overflow = ""; root.style.height = ""; }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !pricingSectionRef.current || priceViewTrackedRef.current) {
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || priceViewTrackedRef.current) return;

        priceViewTrackedRef.current = true;
        trackEvent("price_view", { section: "pricing" });
        observer.disconnect();
      },
      { threshold: 0.35 },
    );

    observer.observe(pricingSectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#020617", color: "#fff", minHeight: "100vh" }}>

      {/* ════════════════ NAV ════════════════ */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(2,6,23,0.92)", backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: m ? "0 16px" : "0 40px", height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: m ? 16 : 18, letterSpacing: "0.02em" }}>
          SPACE <span style={{ color: "#22d3ee" }}>HOST</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!m && onSwitchVersion && (
            <button onClick={onSwitchVersion} style={{ background: "transparent", color: "#475569", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
              다른 버전
            </button>
          )}
          {!m && onEnterApp && (
            <button onClick={onEnterApp} style={{ background: "none", border: "none", color: "#475569", fontSize: 13, cursor: "pointer" }}>
              운영 콘솔 →
            </button>
          )}
          <button
            onClick={() => scrollToSection("consultation")}
            style={{ background: "#06b6d4", color: "#fff", border: "none", borderRadius: 10, padding: m ? "7px 14px" : "8px 20px", fontSize: m ? 12 : 13, fontWeight: 700, cursor: "pointer" }}
          >
            {m ? "무료 진단" : "무료 운영진단 신청"}
          </button>
        </div>
      </nav>

      {/* ════════════════ INTRO — 서비스 정의/가격 인트로 ════════════════ */}
      <IntroScene />

      {/* ════════════════ HERO — 기존 Scene 01 유지 ════════════════ */}
      <HeroScene
        onPrimaryClick={handleHeroPrimaryClick}
        onSecondaryClick={handleHeroSecondaryClick}
      />

      {/* ════════════════ SCENE 02 — 레이어 분리형 소음 방어 ════════════════ */}
      <Scene2NoisePrevention />

      {/* ════════════════ SCENE 03 — 레이어 분리형 에너지 절전 ════════════════ */}
      <Scene3EnergySaving />

      {/* ════════════════ SCENE 04 — 레이어 분리형 청소 모니터 ════════════════ */}
      <Scene4CleaningMonitor />

      {/* ════════════════ SCENE 05 — 레이어 분리형 AI 엔진 ════════════════ */}
      <Scene5AIEngine />

      {/* ════════════════ VALUE BRIDGE — 4 모드 요약 + 가격 충격 ════════════════ */}
      <section style={{ padding: m ? "60px 20px" : "96px 40px", background: "linear-gradient(180deg, #071120 0%, #050c19 100%)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {/* 헤드라인 */}
          <motion.div {...up()} style={{ textAlign: "center", marginBottom: m ? 32 : 48 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(34,211,238,0.25)", background: "rgba(34,211,238,0.07)", borderRadius: 999, padding: "7px 18px", marginBottom: 18, fontSize: 12, color: "#a5f3fc", fontWeight: 700, letterSpacing: "0.08em" }}>
              운영 문제 4가지
            </div>
            <h2 style={{ fontSize: "clamp(26px, 3.6vw, 44px)", fontWeight: 900, margin: 0, lineHeight: 1.25, letterSpacing: "-0.02em", color: "#fff" }}>
              숙소 운영의 반복 문제를<br />
              4가지 자동화로 줄입니다.
            </h2>
          </motion.div>

          {/* 4 모드 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: m ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: m ? 12 : 18, marginBottom: m ? 28 : 40 }}>
            {[
              { icon: Home, mode: "자동 웰컴 모드", benefit: "첫인상과 리뷰 경험 관리", accent: "#67e8f9" },
              { icon: Volume2, mode: "소음 감지 모드", benefit: "민원 발생 전 대응", accent: "#f87171" },
              { icon: Zap, mode: "자동 절전 모드", benefit: "퇴실 후 낭비 자동 차단", accent: "#fcd34d" },
              { icon: ClipboardCheck, mode: "청소 기록 모드", benefit: "청소 누락 확인 속도 향상", accent: "#86efac" },
            ].map(({ icon: Icon, mode, benefit, accent }, i) => (
              <motion.div key={mode} {...up(i * 0.08)} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: m ? "18px 16px" : "24px 22px", boxShadow: "0 16px 34px rgba(2,6,23,0.18)" }}>
                <div style={{ width: m ? 40 : 46, height: m ? 40 : 46, borderRadius: 13, background: `${accent}1a`, border: `1px solid ${accent}40`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: m ? 12 : 16 }}>
                  <Icon size={m ? 20 : 24} color={accent} />
                </div>
                <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: m ? 15 : 18, fontWeight: 800, color: "#fff", marginBottom: 4, letterSpacing: "-0.01em" }}>{mode}</div>
                <div style={{ fontSize: m ? 12.5 : 14, color: "rgba(226,232,240,0.7)", lineHeight: 1.5 }}>{benefit}</div>
              </motion.div>
            ))}
          </div>

          {/* 가격 충격 밴드 — ⚠ 법적/광고 검증 필요: 'OO%' / '~OOO만원' / 'No마진' 은 임시 문구. 실제 시중 견적 근거 확보 후 교체 필수 */}
          <motion.div {...reveal(0.1)} style={{
            position: "relative",
            borderRadius: 24,
            padding: m ? "26px 22px" : "36px 44px",
            background: "linear-gradient(135deg, rgba(8,145,178,0.16), rgba(6,182,212,0.08))",
            border: "1px solid rgba(34,211,238,0.3)",
            boxShadow: "0 0 0 1px rgba(34,211,238,0.08), 0 24px 60px rgba(6,182,212,0.18)",
            display: "flex",
            flexDirection: m ? "column" : "row",
            alignItems: m ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: m ? 20 : 36,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: m ? 22 : 30, fontWeight: 900, color: "#fff", lineHeight: 1.3, letterSpacing: "-0.02em" }}>
                처음부터 큰 구축비를 들이지 마세요.<br />
                <span style={{ color: "#22d3ee" }}>기기 구매 50만원 전후</span>로 시작하고,<br />
                필요할 때만 <span style={{ color: "#22d3ee" }}>월 3만원 운영 지원</span>을 더하면 됩니다.
              </div>
              <div style={{ fontSize: 11, color: "rgba(226,232,240,0.46)", marginTop: 10, lineHeight: 1.7 }}>
                * 해외 직구와 셀프 설치 기준입니다. 숙소 구조, 센서 수량, 호환 조건에 따라 실제 비용은 달라질 수 있습니다.
              </div>
            </div>
            <button
              onClick={() => scrollToSection("pricing")}
              style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "rgba(255,255,255,0.05)", color: "#E2E8F0", borderRadius: 14,
              padding: m ? "13px 22px" : "16px 30px", fontSize: m ? 15 : 16, fontWeight: 800,
              boxShadow: "0 12px 28px rgba(2,6,23,0.18)", whiteSpace: "nowrap",
              alignSelf: m ? "stretch" : "auto", justifyContent: "center",
              border: "1px solid rgba(165,243,252,0.18)", cursor: "pointer",
            }}
            >
              요금 구조 보기 ↓
            </button>
          </motion.div>

          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3, 1fr)", gap: m ? 14 : 18, marginTop: m ? 18 : 22 }}>
            {VALUE_EXPLAINERS.map(({ icon: Icon, eyebrow, title, body, points, accent }, i) => (
              <motion.div
                key={title}
                {...up(0.08 + i * 0.08)}
                style={{
                  borderRadius: 20,
                  padding: m ? "18px 16px" : "22px 20px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 16px 32px rgba(2,6,23,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div
                    style={{
                      width: m ? 42 : 46,
                      height: m ? 42 : 46,
                      borderRadius: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `${accent}18`,
                      border: `1px solid ${accent}40`,
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={m ? 20 : 22} color={accent} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: 4 }}>
                      {eyebrow}
                    </div>
                    <div style={{ fontSize: m ? 17 : 19, fontWeight: 800, lineHeight: 1.35, letterSpacing: "-0.01em", color: "#fff" }}>
                      {title}
                    </div>
                  </div>
                </div>

                <p style={{ margin: "0 0 16px", fontSize: m ? 13.5 : 14.5, color: "rgba(226,232,240,0.76)", lineHeight: 1.75 }}>
                  {body}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {points.map((point) => (
                    <div key={point} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <CheckCircle2 size={15} color={accent} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: m ? 13 : 14, color: "#E2E8F0", lineHeight: 1.6 }}>
                        {point}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

        </div>
      </section>

      <section style={{ padding: m ? "44px 20px 18px" : "64px 40px 28px", background: "linear-gradient(180deg, #050d1a 0%, #030913 100%)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.div
            {...reveal(0.04)}
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: m ? 24 : 32,
              padding: m ? "26px 22px 24px" : "42px 46px 40px",
              border: "1px solid rgba(56,189,248,0.16)",
              background: "linear-gradient(145deg, rgba(8,15,30,0.88), rgba(4,10,22,0.96))",
              boxShadow: "0 24px 60px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background: "radial-gradient(circle at 18% 24%, rgba(34,211,238,0.12), transparent 34%), radial-gradient(circle at 82% 74%, rgba(14,165,233,0.12), transparent 30%)",
              }}
            />

            <div style={{ position: "relative", zIndex: 1 }}>
              <div
                style={{
                  marginBottom: m ? 14 : 18,
                  fontSize: m ? 11 : 12,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  color: "#7dd3fc",
                  textTransform: "uppercase",
                }}
              >
                운영 지원
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: m ? "clamp(28px, 8vw, 40px)" : "clamp(40px, 4.6vw, 62px)",
                  fontWeight: 900,
                  lineHeight: 1.16,
                  letterSpacing: "-0.03em",
                  color: "#fff",
                  maxWidth: m ? "100%" : 860,
                }}
              >
                <span style={{ color: "#38bdf8" }}>월 3만원</span>으로,<br />
                스스로 작동하고 상태를 먼저 알려주는 운영 시스템을 누리세요.
              </h2>

              <p
                style={{
                  margin: m ? "16px 0 0" : "18px 0 0",
                  maxWidth: 720,
                  fontSize: m ? 14 : 17,
                  lineHeight: 1.8,
                  color: "rgba(226,232,240,0.74)",
                }}
              >
                복잡한 설정과 장애 대응은 맡기고, 필요한 순간의 알림과 주간 리포트만 받아보세요.
                숙소가 늘어나도 운영 스트레스는 늘지 않도록 설계해드립니다.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <section style={{ padding: m ? "26px 20px 8px" : "34px 40px 18px", background: "linear-gradient(180deg, #030913 0%, #020617 100%)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.div {...up()} style={{ textAlign: m ? "center" : "left", marginBottom: m ? 22 : 30 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(34,211,238,0.22)", background: "rgba(34,211,238,0.07)", borderRadius: 999, padding: "7px 16px", marginBottom: 16, fontSize: 12, color: "#a5f3fc", fontWeight: 700, letterSpacing: "0.08em" }}>
              작동 증거
            </div>
            <h2 style={{ fontSize: "clamp(26px, 3.2vw, 40px)", fontWeight: 900, margin: "0 0 12px", lineHeight: 1.25, letterSpacing: "-0.02em" }}>
              실제 운영에서 바로 체감되는 변화만 남겼습니다.
            </h2>
            <p style={{ margin: m ? "0 auto" : "0", maxWidth: 620, color: "rgba(226,232,240,0.72)", fontSize: 15, lineHeight: 1.8 }}>
              설치 방식, 프라이버시 보호, 청소 확인, 주간 리포트까지 지금 페이지에서 약속한 내용이 실제로 어떤 운영 변화로 이어지는지 먼저 보여드립니다.
            </p>
          </motion.div>

          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(2, 1fr)", gap: m ? 14 : 18 }}>
            {PROOF_CARDS.map(({ icon: Icon, title, body, accent }, i) => (
              <motion.div
                key={title}
                {...up(0.06 + i * 0.08)}
                style={{
                  borderRadius: 20,
                  padding: m ? "18px 16px" : "22px 20px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 16px 32px rgba(2,6,23,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: `${accent}18`, border: `1px solid ${accent}40`, flexShrink: 0 }}>
                    <Icon size={20} color={accent} />
                  </div>
                  <div style={{ fontSize: m ? 17 : 19, fontWeight: 800, color: "#fff", lineHeight: 1.35, letterSpacing: "-0.01em" }}>
                    {title}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: m ? 13.5 : 14.5, color: "rgba(226,232,240,0.74)", lineHeight: 1.75 }}>
                  {body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ PRICING ════════════════ */}
      <section ref={pricingSectionRef} id="pricing" style={{ padding: m ? "64px 20px" : "96px 40px", background: "linear-gradient(180deg, #030913 0%, #020617 100%)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.div {...up()} style={{ textAlign: "center", marginBottom: m ? 36 : 56 }}>
            <h2 style={{ fontSize: "clamp(28px, 3.5vw, 42px)", fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
              요금제
            </h2>
            <p style={{ color: "rgba(226,232,240,0.72)", fontSize: 16, maxWidth: 500, margin: "0 auto", lineHeight: 1.8 }}>
              기기 구매만으로 가볍게 시작할 수도 있고, 월 3만원 운영 지원으로 더 편하게 맡길 수도 있습니다.
            </p>
          </motion.div>

          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3, 1fr)", gap: m ? 16 : 20 }}>
            {PACKAGES.map((pkg, i) => (
              <PricingCard key={pkg.name} pkg={pkg} i={i} m={m} onCtaClick={handlePriceCtaClick} />
            ))}
          </div>

          <motion.div {...up(0.1)} style={{ marginTop: 24, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", borderRadius: 18, padding: "20px 24px", boxShadow: "0 16px 32px rgba(2,6,23,0.16)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <FileCheck2 size={16} color="#67e8f9" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, color: "rgba(226,232,240,0.68)", fontSize: 13, lineHeight: 1.85 }}>
                실제 비용은 숙소 구조, 도어락 호환, 센서 수량에 따라 달라질 수 있습니다.
                기본 방향은 "기기는 50만원 전후로 직접 구매하고, 필요하면 월 3만원 운영 지원을 붙이는 방식"입니다.
                특수 도어락, 추가 센서, 네트워크 보강, 현장 출동은 별도 비용이 발생할 수 있습니다.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ FAQ ════════════════ */}
      <section style={{ padding: m ? "60px 20px" : "80px 40px", background: "linear-gradient(180deg, #050c19 0%, #04081a 100%)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <motion.div {...up()} style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
              자주 묻는 질문
            </h2>
          </motion.div>
          <motion.div {...up(0.08)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {FAQS.map((faq) => <FAQItem key={faq.id} q={faq.q} a={faq.a} faqId={faq.id} onOpen={handleFaqOpen} />)}
          </motion.div>
        </div>
      </section>

      {/* ════════════════ CTA ════════════════ */}
      <section id="consultation" style={{ padding: m ? "72px 20px" : "120px 40px", textAlign: "center", position: "relative", overflow: "hidden", background: "linear-gradient(180deg, #030913 0%, #020617 100%)" }}>
        {/* If an actual input form is added here later, add data-clarity-mask to the input wrapper. */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(34,211,238,0.16) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
          <motion.div {...up()} style={{ position: "relative", zIndex: 1, maxWidth: 860, margin: "0 auto", padding: m ? "28px 18px" : "38px 40px", borderRadius: 28, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", boxShadow: "0 24px 56px rgba(2,6,23,0.20)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
            <h2 style={{ fontSize: "clamp(30px, 5vw, 56px)", fontWeight: 900, margin: "0 0 20px", lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            숙소가 늘어나도<br />
            <span style={{ color: "#22d3ee" }}>관리 부담은 늘지 않습니다.</span>
          </h2>
          <p style={{ color: "rgba(226,232,240,0.76)", fontSize: 18, maxWidth: 520, margin: "0 auto 40px", lineHeight: 1.8 }}>
            30분 무료 운영진단으로 내 숙소에 적용 가능한<br />
            자동화 범위와 예상 비용을 먼저 확인하세요.
          </p>
          <div style={{ display: "flex", flexDirection: m ? "column" : "row", gap: m ? 12 : 14, justifyContent: "center", alignItems: "center", width: m ? "100%" : "auto" }}>
            <button
              onClick={openInquiryMail}
              style={{
              background: "#06b6d4", color: "#fff", border: "none",
              borderRadius: 16, padding: m ? "15px 24px" : "18px 40px", fontSize: m ? 15 : 17, fontWeight: 800,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9,
              boxShadow: "0 0 40px rgba(6,182,212,0.4)",
              width: m ? "100%" : "auto", justifyContent: "center",
            }}
            >
              <MessageCircle size={19} /> 운영진단 요청 메일 보내기
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              style={{
              background: "rgba(255,255,255,0.05)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16, padding: m ? "14px 24px" : "18px 40px", fontSize: m ? 15 : 17, cursor: "pointer",
              width: m ? "100%" : "auto",
            }}
            >
              요금제 다시 보기
            </button>
          </div>
          <p style={{ marginTop: 22, fontSize: 13, color: "rgba(148,163,184,0.74)" }}>
            이메일 한 통만 보내주시면, 적용 가능한 자동화 범위와 예상 비용을 먼저 정리해드립니다.
            </p>
          </motion.div>
      </section>

      {/* ════════════════ FOOTER ════════════════ */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)", padding: m ? "28px 20px" : "36px 40px",
        display: "flex", flexDirection: m ? "column" : "row",
        justifyContent: "space-between", alignItems: m ? "flex-start" : "center",
        gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 16 }}>
            SPACE <span style={{ color: "#22d3ee" }}>HOST</span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(148,163,184,0.74)", margin: "4px 0 0" }}>AI 기반 단기임대 자동 운영 시스템</p>
        </div>
        <div style={{ fontSize: 12, color: "rgba(148,163,184,0.74)", textAlign: m ? "left" : "right", lineHeight: 1.8 }}>
          <div>이메일: hello@propos.kr</div>
          <div>© 2026 Space Host. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
