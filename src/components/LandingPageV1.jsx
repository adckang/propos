import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Home, Volume2, Zap, ClipboardCheck, Settings,
  CheckCircle2, ChevronDown, ChevronUp,
  MessageCircle, FileCheck2,
} from "lucide-react";
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
    name: "파일럿",
    tag: "1개 숙소 검증",
    price: "설치비 49만원부터",
    monthly: "+ 월 9.9만원부터",
    desc: "1개 숙소에서 체크인·청소·에너지·소음 루틴을 먼저 검증",
    includes: ["체크인/퇴실 자동 알림", "에너지 자동 절전", "청소 타임라인", "월간 운영 리포트"],
    cta: "파일럿 신청",
    highlight: false,
  },
  {
    name: "운영형",
    tag: "추천",
    price: "설치비 79만원부터",
    monthly: "+ 월 14.9만원부터",
    desc: "5가지 기능 전부 + AI 통합 판단 엔진 풀 연동",
    includes: ["파일럿 전체 포함", "소음 실시간 예방", "AI 이상 감지", "청소 사진 증거화", "운영 이슈 우선 대응"],
    cta: "상담 신청",
    highlight: true,
  },
  {
    name: "다호점",
    tag: "3개 이상",
    price: "별도 견적",
    monthly: "",
    desc: "3개 이상 숙소 또는 건물 단위 운영 구조 설계",
    includes: ["운영형 전체 포함", "숙소별 대시보드", "다호점 통합 리포트", "표준 운영 매뉴얼"],
    cta: "견적 문의",
    highlight: false,
  },
];

/* ── faq ── */
const FAQS = [
  {
    q: "IoT 기기를 직접 구매해야 하나요?",
    a: "기본 패키지에는 필수 기기 구성이 포함됩니다. 숙소 구조, 도어락 종류, 센서 수량에 따라 추가 기기나 별도 비용이 발생할 수 있습니다.",
  },
  {
    q: "소음 감지는 녹음인가요?",
    a: "아닙니다. 대화 내용을 녹음하지 않고 dB 수준과 기준 초과 여부만 감지합니다. 게스트 프라이버시를 완전히 보호합니다.",
  },
  {
    q: "기존 스마트 도어락이 없어도 되나요?",
    a: "가능합니다. 모든 도어락이 동일하게 지원되는 것은 아니므로 방문 진단을 통해 교체 필요 여부와 호환성을 먼저 확인합니다.",
  },
  {
    q: "청소 완료를 자동으로 보장하나요?",
    a: "자동 보장은 아닙니다. 청소 담당자의 출입과 활동 기록을 실시간으로 알려드리는 시스템입니다. 확인과 증거화를 통해 운영 품질을 높입니다.",
  },
  {
    q: "현장 출동도 포함되나요?",
    a: "원격 확인과 원격 제어 가능한 범위를 먼저 지원합니다. 현장 출동이 필요한 경우 지역과 시간에 따라 별도 비용이 적용됩니다.",
  },
  {
    q: "계약 최소 기간이 있나요?",
    a: "기본 6개월 약정입니다. 1개 숙소 파일럿으로 운영 안정성을 확인한 뒤 확장하는 방식을 권장합니다.",
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
function PricingCard({ pkg, i, m }) {
  const cardStyle = pkg.highlight
    ? { background: "linear-gradient(135deg, #0891b2, #06b6d4)", boxShadow: "0 0 0 2px #22d3ee, 0 24px 48px rgba(6,182,212,0.3)" }
    : { border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)" };
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
        {!pkg.highlight && <span style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>{pkg.tag}</span>}
        <h3 style={{ fontSize: 24, fontWeight: 800, margin: "10px 0 6px" }}>{pkg.name}</h3>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{pkg.price}</div>
        {pkg.monthly && <div style={{ fontSize: 14, color: pkg.highlight ? "rgba(255,255,255,0.75)" : "#475569", marginTop: 2 }}>{pkg.monthly}</div>}
        <p style={{ fontSize: 14, color: pkg.highlight ? "rgba(255,255,255,0.8)" : "#475569", margin: "14px 0 22px", lineHeight: 1.75 }}>{pkg.desc}</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 26px", display: "flex", flexDirection: "column", gap: 10 }}>
          {pkg.includes.map((item) => (
            <li key={item} style={{ display: "flex", gap: 9, fontSize: 14, alignItems: "flex-start" }}>
              <CheckCircle2 size={15} color={pkg.highlight ? "#fff" : "#22d3ee"} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: pkg.highlight ? "#fff" : "#94a3b8" }}>{item}</span>
            </li>
          ))}
        </ul>
        <button style={{ width: "100%", borderRadius: 14, padding: "13px", fontSize: 15, fontWeight: 800, cursor: "pointer", ...btnStyle }}>
          {pkg.cta}
        </button>
      </div>
    </motion.div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "22px 0",
          background: "transparent", border: "none",
          cursor: "pointer", color: "#fff", textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.5, paddingRight: 24 }}>{q}</span>
        {open
          ? <ChevronUp size={18} color="#475569" style={{ flexShrink: 0 }} />
          : <ChevronDown size={18} color="#475569" style={{ flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{ paddingBottom: 22, color: "#64748b", fontSize: 15, lineHeight: 1.85 }}>
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
          PROP<span style={{ color: "#22d3ee" }}>OS</span>
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
          <button style={{ background: "#06b6d4", color: "#fff", border: "none", borderRadius: 10, padding: m ? "7px 14px" : "8px 20px", fontSize: m ? 12 : 13, fontWeight: 700, cursor: "pointer" }}>
            {m ? "무료 진단" : "무료 운영진단 신청"}
          </button>
        </div>
      </nav>

      {/* ════════════════ HERO — 레이어 분리형 HeroScene (첫 화면) ════════════════ */}
      <HeroScene />

      {/* ════════════════ SCENE 02 — 레이어 분리형 소음 방어 ════════════════ */}
      <Scene2NoisePrevention />

      {/* ════════════════ SCENE 03 — 레이어 분리형 에너지 절전 ════════════════ */}
      <Scene3EnergySaving />

      {/* ════════════════ SCENE 04 — 레이어 분리형 청소 모니터 ════════════════ */}
      <Scene4CleaningMonitor />

      {/* ════════════════ SCENE 05 — 레이어 분리형 AI 엔진 ════════════════ */}
      <Scene5AIEngine />

      {/* ════════════════ STATS STRIP ════════════════ */}
      <section style={{ padding: m ? "48px 20px" : "72px 40px", background: "#060d1e", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: m ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: m ? 20 : 24, textAlign: "center" }}>
          {[
            { val: "5가지", label: "운영 리스크 완전 커버" },
            { val: "24/7", label: "AI 실시간 모니터링" },
            { val: "4,320원", label: "하루 평균 에너지 절감" },
            { val: "20%↑", label: "별점 1점 상승 시 예약률" },
          ].map(({ val, label }) => (
            <motion.div key={label} {...up(0)}>
              <div style={{ fontSize: "clamp(26px, 3vw, 38px)", fontWeight: 900, color: "#22d3ee", marginBottom: 8 }}>{val}</div>
              <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.6 }}>{label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ════════════════ PRICING ════════════════ */}
      <section style={{ padding: m ? "64px 20px" : "96px 40px", background: "#020617" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.div {...up()} style={{ textAlign: "center", marginBottom: m ? 36 : 56 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(34,211,238,0.25)", background: "rgba(34,211,238,0.07)", borderRadius: 999, padding: "7px 20px", marginBottom: 20, fontSize: 13, color: "#a5f3fc", fontWeight: 700 }}>
              PRICING
            </div>
            <h2 style={{ fontSize: "clamp(28px, 3.5vw, 42px)", fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
              요금제
            </h2>
            <p style={{ color: "#334155", fontSize: 16, maxWidth: 500, margin: "0 auto", lineHeight: 1.8 }}>
              숙소 구조와 환경에 따라 최종 견적은 달라질 수 있습니다.
            </p>
          </motion.div>

          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "repeat(3, 1fr)", gap: m ? 16 : 20 }}>
            {PACKAGES.map((pkg, i) => (
              <PricingCard key={pkg.name} pkg={pkg} i={i} m={m} />
            ))}
          </div>

          <motion.div {...up(0.1)} style={{ marginTop: 24, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", borderRadius: 18, padding: "20px 24px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <FileCheck2 size={16} color="#67e8f9" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, color: "#475569", fontSize: 13, lineHeight: 1.85 }}>
                월 1회 현장 방문 감소, 체크인 오류 1건 예방, 퇴실 후 에너지 낭비 감소 중 하나라도 반복되는 숙소라면 도입 검토 가치가 있습니다. 특수 도어락, 추가 센서, 네트워크 보강, 현장 출동은 별도 비용이 발생할 수 있습니다.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════ FAQ ════════════════ */}
      <section style={{ padding: m ? "60px 20px" : "80px 40px", background: "#04081a", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <motion.div {...up()} style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>
              자주 묻는 질문
            </h2>
          </motion.div>
          <motion.div {...up(0.08)}>
            {FAQS.map((faq) => <FAQItem key={faq.q} {...faq} />)}
          </motion.div>
        </div>
      </section>

      {/* ════════════════ CTA ════════════════ */}
      <section style={{ padding: m ? "72px 20px" : "120px 40px", textAlign: "center", position: "relative", overflow: "hidden", background: "#020617" }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(34,211,238,0.12) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
        <motion.div {...up()} style={{ position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: "clamp(30px, 5vw, 56px)", fontWeight: 900, margin: "0 0 20px", lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            숙소가 늘어나도<br />
            <span style={{ color: "#22d3ee" }}>관리 부담은 늘지 않습니다.</span>
          </h2>
          <p style={{ color: "#334155", fontSize: 18, maxWidth: 520, margin: "0 auto 48px", lineHeight: 1.8 }}>
            30분 무료 운영진단으로 내 숙소에 적용 가능한<br />
            자동화 범위와 예상 비용을 먼저 확인하세요.
          </p>
          <div style={{ display: "flex", flexDirection: m ? "column" : "row", gap: m ? 12 : 14, justifyContent: "center", alignItems: "center", width: m ? "100%" : "auto" }}>
            <button style={{
              background: "#06b6d4", color: "#fff", border: "none",
              borderRadius: 16, padding: m ? "15px 24px" : "18px 40px", fontSize: m ? 15 : 17, fontWeight: 800,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9,
              boxShadow: "0 0 40px rgba(6,182,212,0.4)",
              width: m ? "100%" : "auto", justifyContent: "center",
            }}>
              <MessageCircle size={19} /> 카카오톡으로 문의하기
            </button>
            <button style={{
              background: "rgba(255,255,255,0.05)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16, padding: m ? "14px 24px" : "18px 40px", fontSize: m ? 15 : 17, cursor: "pointer",
              width: m ? "100%" : "auto",
            }}>
              전화 문의 · 010-0000-0000
            </button>
          </div>
          <p style={{ marginTop: 22, fontSize: 13, color: "#1e293b" }}>
            평일 10:00 – 18:00 응대 · 주말은 카카오톡 문의 권장
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
            PROP<span style={{ color: "#22d3ee" }}>OS</span>
          </div>
          <p style={{ fontSize: 12, color: "#1e293b", margin: "4px 0 0" }}>AI 기반 단기임대 자동 운영 시스템</p>
        </div>
        <div style={{ fontSize: 12, color: "#1e293b", textAlign: m ? "left" : "right", lineHeight: 1.8 }}>
          <div>이메일: hello@propos.kr</div>
          <div>© 2026 PropOS. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
