import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, CheckCircle2 } from "lucide-react";

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.55, delay },
});

const SCENES = [
  { src: "/images/scene-1.png", alt: "스마트 숙소 관리" },
  { src: "/images/scene-2.png", alt: "실시간 모니터링" },
  { src: "/images/scene-3.png", alt: "자동화 시스템" },
  { src: "/images/scene-4.png", alt: "원격 제어" },
  { src: "/images/scene-5.png", alt: "안심 운영" },
];

const PAINS = [
  {
    num: "01", tag: "체크인 실패",
    quote: "키 들고 급하게 집으로...",
    img: "/images/pain-1.png",
    desc: "문이 안 열린다는 연락. 게스트는 문 앞에서 화나고, 나는 지금 당장 달려가야 합니다.",
    impacts: ["환불·악성 리뷰", "매출 하락"],
  },
  {
    num: "02", tag: "청소 누락",
    quote: "청소가 안 됐다고요?",
    img: "/images/pain-2.png",
    desc: "시간이 지났는데도 오지 않고 연락도 안 됩니다. 다음 게스트 체크인 시간이 다가오는데, 아무것도 할 수 없어 속만 탑니다.",
    impacts: ["누락·재방문", "평점 하락"],
  },
  {
    num: "03", tag: "에너지 낭비",
    quote: "퇴실했는데 에어컨 18도...",
    img: "/images/pain-3.png",
    desc: "손님은 나갔는데 에어컨은 하루 종일 18도. 전기세는 계속 나가고, 조용히 수익이 사라집니다.",
    impacts: ["에너지 낭비", "비용 증가"],
  },
  {
    num: "04", tag: "소음/민원/파티",
    quote: "새벽에 경찰 연락, 민원 전화",
    img: "/images/pain-4.png",
    desc: "고객은 연락 두절이고, 이웃과 관계는 망가지고, 숙소 평점은 떨어집니다.",
    impacts: ["민원·파티", "평점 하락"],
  },
  {
    num: "05", tag: "거리의 한계",
    quote: "한 번 이동에 1~2시간...",
    img: "/images/pain-5.png",
    desc: "문제 생길 때마다 달려가야 해서 시간은 시간대로 쓰이고, 교통비·주차비까지 더해져 남는 게 없습니다.",
    impacts: ["이동 시간", "비용 손실"],
  },
];

const SOLUTIONS = [
  {
    num: "01", title: "자동 체크인 관리",
    sub: "비밀번호 자동 변경 & 체크인 알림",
    img: "/images/sol-1.png",
    desc: "게스트가 편하게 입실하고, 문제 발생 시 즉시 알림",
    outcomes: ["문제 발생↓", "출동 횟수↓"],
  },
  {
    num: "02", title: "청소 상태 자동 확인",
    sub: "청소 완료 사진 자동 수신 & 체크리스트 확인",
    img: "/images/sol-2.png",
    desc: "누락 여부를 즉시 확인하고, 다음 게스트 준비 완료",
    outcomes: ["누락↓", "재방문↓"],
  },
  {
    num: "03", title: "퇴실 후 자동 제어",
    sub: "퇴실 감지 시 에어컨, 전기, 보일러 자동 OFF",
    img: "/images/sol-3.png",
    desc: "에너지 낭비 원천 차단, 전기세 절약",
    outcomes: ["에너지 낭비↓", "비용↓"],
  },
  {
    num: "04", title: "소음·민원 즉시 감지",
    sub: "소음 실시간 감지(85dB) & 이상 상황 즉시 알림",
    img: "/images/sol-4.png",
    desc: "파티, 과도한 소음, 흡연 감지로 민원과 분쟁을 예방",
    outcomes: ["민원↓", "평점 방어↑"],
  },
  {
    num: "05", title: "원격 모니터링 대시보드",
    sub: "모든 숙소를 한눈에 실시간으로 확인",
    img: "/images/sol-5.png",
    desc: "여러 숙소의 상태를 한 화면에서 확인하고 제어",
    outcomes: ["관리 효율↑", "수익↑"],
  },
];

const CHECKS = [
  "더 이상 밤에 울리는 전화에 놀라지 않아도 됩니다",
  "현장 출동 없이도 문제를 빠르게 해결할 수 있습니다",
  "숙소 운영은 편해지고, 수익은 더 안정적이 됩니다",
  "무엇보다, 가족과의 소중한 시간을 지킬 수 있습니다",
];

const PLAYLIST = [
  { title: "River Flows In You", artist: "Yiruma", duration: "03:06" },
  { title: "Kiss The Rain", artist: "Yiruma", duration: "04:20" },
  { title: "May Be", artist: "Yiruma", duration: "03:51" },
  { title: "봄날은 간다", artist: "Yiruma", duration: "04:20" },
  { title: "처음부터 지금까지", artist: "신승훈 (Piano Ver.)", duration: "04:28" },
];

/* ── Scene Showcase: 5장 풀 화면 ── */
function SceneShowcase({ isMobile }) {
  const [active, setActive] = useState(0);
  const scrollRef = useRef(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.min(idx, SCENES.length - 1));
  };

  const goTo = (i) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" });
  };

  if (isMobile) {
    return (
      <div style={{ position: "relative" }}>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            display: "flex",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {SCENES.map((s, i) => (
            <div
              key={i}
              style={{
                flex: "0 0 100vw",
                scrollSnapAlign: "center",
                height: "62vw",
                minHeight: 220,
                maxHeight: 380,
              }}
            >
              <img
                src={s.src}
                alt={s.alt}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={e => { e.target.style.background = "#e2e8f0"; }}
              />
            </div>
          ))}
        </div>
        {/* dot 인디케이터 — 클릭으로도 이동 가능 */}
        <div style={{
          display: "flex", justifyContent: "center", gap: 8, padding: "10px 0 4px",
        }}>
          {SCENES.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              style={{
                width: i === active ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === active ? "#2563eb" : "#cbd5e1",
                border: "none", padding: 0, cursor: "pointer",
                transition: "width 0.25s, background 0.2s",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  /* 데스크탑: 큰 이미지 1장 + 오른쪽 썸네일 4장 */
  return (
    <div style={{ display: "flex", height: "min(52vw, 580px)", gap: 3, background: "#0f172a" }}>
      {/* 메인 큰 이미지 */}
      <div style={{ flex: "0 0 60%", overflow: "hidden", position: "relative" }}>
        <img
          src={SCENES[active].src}
          alt={SCENES[active].alt}
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            display: "block", transition: "opacity 0.3s",
          }}
          onError={e => { e.target.style.background = "#1e3a5f"; }}
        />
        {/* 이미지 위 텍스트 오버레이 */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.55))",
          padding: "32px 24px 20px",
        }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, opacity: 0.85 }}>
            {active + 1} / {SCENES.length}
          </div>
        </div>
      </div>
      {/* 오른쪽 썸네일 4장 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        {SCENES.filter((_, i) => i !== active).slice(0, 4).map((s, idx) => {
          const origIdx = SCENES.findIndex(sc => sc.src === s.src);
          return (
            <div
              key={origIdx}
              onClick={() => setActive(origIdx)}
              style={{
                flex: 1, overflow: "hidden", cursor: "pointer", position: "relative",
              }}
            >
              <img
                src={s.src}
                alt={s.alt}
                style={{
                  width: "100%", height: "100%", objectFit: "cover",
                  display: "block", transition: "transform 0.3s",
                  filter: "brightness(0.75)",
                }}
                onMouseEnter={e => { e.target.style.filter = "brightness(1)"; e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={e => { e.target.style.filter = "brightness(0.75)"; e.target.style.transform = "scale(1)"; }}
                onError={e => { e.target.style.background = "#1e3a5f"; }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 카드 캐러셀 래퍼 (모바일: 가로 스크롤, 데스크탑: flex row) ── */
function CardCarousel({ children, isMobile }) {
  if (!isMobile) {
    return (
      <div style={{ display: "flex", gap: 16 }}>
        {children}
      </div>
    );
  }
  return (
    <div style={{
      display: "flex",
      gap: 12,
      overflowX: "auto",
      scrollSnapType: "x mandatory",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
      paddingLeft: 20,
      paddingRight: 20,
      paddingBottom: 12,
    }}>
      {children}
    </div>
  );
}

function PainCard({ item, isMobile }) {
  return (
    <div style={{
      flex: isMobile ? "0 0 78vw" : "1 1 0",
      scrollSnapAlign: isMobile ? "start" : undefined,
      minWidth: 0,
      background: "#fff",
      borderRadius: 16,
      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ position: "relative" }}>
        <img
          src={item.img}
          alt={item.tag}
          style={{ width: "100%", height: isMobile ? 200 : 260, objectFit: "cover", display: "block" }}
          onError={e => { e.target.style.background = "#f1f5f9"; }}
        />
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "#1e3a5f", color: "#fff",
          borderRadius: 20, padding: "3px 12px",
          fontSize: 12, fontWeight: 700, letterSpacing: 1,
        }}>{item.num}</div>
      </div>
      <div style={{ padding: "16px 18px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#1e3a5f", marginBottom: 6 }}>{item.tag}</div>
        <div style={{ fontStyle: "italic", color: "#64748b", fontSize: 13, marginBottom: 10 }}>"{item.quote}"</div>
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, flex: 1 }}>{item.desc}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {item.impacts.map(imp => (
            <span key={imp} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "#fff5f5", border: "1px solid #fecaca",
              borderRadius: 20, padding: "3px 10px",
              fontSize: 11, color: "#dc2626", fontWeight: 600,
            }}>⚠ {imp}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SolutionCard({ item, isMobile }) {
  return (
    <div style={{
      flex: isMobile ? "0 0 78vw" : "1 1 0",
      scrollSnapAlign: isMobile ? "start" : undefined,
      minWidth: 0,
      background: "#fff",
      borderRadius: 16,
      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ position: "relative" }}>
        <img
          src={item.img}
          alt={item.title}
          style={{ width: "100%", height: isMobile ? 200 : 260, objectFit: "cover", display: "block" }}
          onError={e => { e.target.style.background = "#eff6ff"; }}
        />
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "#2563eb", color: "#fff",
          borderRadius: 20, padding: "3px 12px",
          fontSize: 12, fontWeight: 700, letterSpacing: 1,
        }}>{item.num}</div>
      </div>
      <div style={{ padding: "16px 18px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#1e3a5f", marginBottom: 4 }}>{item.title}</div>
        <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 600, marginBottom: 10 }}>{item.sub}</div>
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, flex: 1 }}>{item.desc}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {item.outcomes.map(o => (
            <span key={o} style={{
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 20, padding: "3px 10px",
              fontSize: 11, color: "#1d4ed8", fontWeight: 600,
            }}>{o}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaylistItem({ item, idx, playing, onToggle }) {
  const isPlaying = playing === idx;
  return (
    <button
      onClick={() => onToggle(idx)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 0", width: "100%",
        cursor: "pointer", background: "none",
        border: "none",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: isPlaying ? "#fff" : "rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {isPlaying ? <Pause size={12} color="#1e3a5f" /> : <Play size={12} color="#fff" />}
      </div>
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ color: isPlaying ? "#fff" : "#cbd5e1", fontSize: 13, fontWeight: 500 }}>{item.title}</div>
        <div style={{ color: "#64748b", fontSize: 11 }}>{item.artist}</div>
      </div>
      <div style={{ color: "#64748b", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>{item.duration}</div>
    </button>
  );
}

export default function LandingPage({ onEnterApp, onSwitchVersion }) {
  const [playing, setPlaying] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const root = document.getElementById("root");
    const prev = { body: document.body.style.overflow, html: document.documentElement.style.overflow };
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
    if (root) { root.style.overflow = "auto"; root.style.height = "auto"; }
    return () => {
      document.body.style.overflow = prev.body;
      document.documentElement.style.overflow = prev.html;
      if (root) { root.style.overflow = ""; root.style.height = ""; }
    };
  }, []);

  const px = isMobile ? 20 : 24;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#f8fafc", color: "#1e293b" }}>

      {/* ── Nav ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e2e8f0",
        padding: `0 ${px}px`, height: isMobile ? 52 : 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: isMobile ? 16 : 18, color: "#1e3a5f" }}>
          PROP<span style={{ color: "#2563eb" }}>OS</span>
        </div>
        <div style={{ display: "flex", gap: isMobile ? 8 : 12, alignItems: "center" }}>
          {!isMobile && onSwitchVersion && (
            <button onClick={onSwitchVersion} style={{
              background: "none", border: "1px solid #e2e8f0", borderRadius: 8,
              padding: "6px 14px", fontSize: 12, color: "#94a3b8", cursor: "pointer",
            }}>
              🔀 V1 보기
            </button>
          )}
          {!isMobile && onEnterApp && (
            <button onClick={onEnterApp} style={{
              background: "none", border: "1px solid #e2e8f0", borderRadius: 8,
              padding: "6px 14px", fontSize: 13, color: "#64748b", cursor: "pointer",
            }}>
              운영 콘솔 →
            </button>
          )}
          {isMobile && onEnterApp && (
            <button onClick={onEnterApp} style={{
              background: "none", border: "1px solid #e2e8f0", borderRadius: 7,
              padding: "5px 10px", fontSize: 11, color: "#64748b", cursor: "pointer",
            }}>
              콘솔
            </button>
          )}
          <button style={{
            background: "#2563eb", color: "#fff",
            border: "2px solid #1d4ed8",
            borderRadius: 8, padding: isMobile ? "6px 14px" : "7px 18px",
            fontSize: isMobile ? 12 : 13, fontWeight: 600, cursor: "pointer",
          }}>
            무료 진단 받기
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ background: "#fff", padding: isMobile ? "36px 20px 32px" : "52px 24px 48px", textAlign: "center" }}>
        <motion.div {...fade(0)}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ color: "#dc2626", fontSize: isMobile ? 18 : 22, fontWeight: 500, lineHeight: 1.9, display: "block" }}>
              손님이 체크인 하신건가? &nbsp;
              진상 고객은 아니겠지? &nbsp;
              에어컨을 켜놓고 체크아웃 하지는 않았겠지?
            </span>
            <span style={{ color: "#94a3b8", fontSize: isMobile ? 15 : 17, fontWeight: 500 }}>신경 쓰이시죠?</span>
          </div>
          <h1 style={{
            fontSize: isMobile ? "clamp(24px, 7vw, 34px)" : "clamp(30px, 4.5vw, 46px)",
            fontWeight: 800, lineHeight: 1.25, color: "#0f172a", margin: "0 0 16px",
          }}>
            <span style={{ color: "#dc2626" }}>숙소가 스스로 센싱하고 관리합니다</span>
          </h1>
          <p style={{
            fontSize: isMobile ? 14 : 16, color: "#64748b",
            margin: "0 auto 28px", maxWidth: 480, lineHeight: 1.7,
          }}>
            시간도, 돈도, 정신도 모두 소진됩니다. 매출도 떨어집니다.
          </p>
          <button style={{
            background: "#2563eb", color: "#fff",
            border: "2px solid #1d4ed8",
            borderRadius: 12, padding: isMobile ? "12px 28px" : "14px 36px",
            fontSize: isMobile ? 15 : 16, fontWeight: 700, cursor: "pointer",
          }}>
            무료 진단 받기 →
          </button>
        </motion.div>
      </section>

      {/* ── Scene Showcase (풀 화면 이미지) ── */}
      <section>
        <SceneShowcase isMobile={isMobile} />
      </section>

      {/* ── Pain Points ── */}
      <section style={{ padding: isMobile ? "44px 0 32px" : "60px 24px", background: "#f8fafc" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <motion.div {...fade()} style={{ textAlign: "center", marginBottom: 32, padding: isMobile ? `0 ${px}px` : 0 }}>
            <h2 style={{
              fontSize: isMobile ? "clamp(20px, 5.5vw, 28px)" : "clamp(22px, 3.5vw, 34px)",
              fontWeight: 800, color: "#0f172a", margin: "0 0 10px",
            }}>
              숙소 운영이 이렇게 힘든 이유
            </h2>
            <p style={{ color: "#64748b", fontSize: isMobile ? 13 : 15 }}>혼자 감당하는 숙소 운영의 5가지 현실</p>
          </motion.div>
          <CardCarousel isMobile={isMobile}>
            {PAINS.map(item => <PainCard key={item.num} item={item} isMobile={isMobile} />)}
          </CardCarousel>
        </div>
      </section>

      {/* ── Solutions ── */}
      <section style={{ padding: isMobile ? "44px 0 32px" : "60px 24px", background: "#fff" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <motion.div {...fade()} style={{ textAlign: "center", marginBottom: 32, padding: isMobile ? `0 ${px}px` : 0 }}>
            <h2 style={{
              fontSize: isMobile ? "clamp(20px, 5.5vw, 28px)" : "clamp(22px, 3.5vw, 34px)",
              fontWeight: 800, color: "#0f172a", margin: "0 0 10px",
            }}>
              시스템이 24시간 대신 확인하고,{" "}
              <span style={{ color: "#2563eb" }}>필요한 순간만 알려드립니다</span>
            </h2>
          </motion.div>
          <CardCarousel isMobile={isMobile}>
            {SOLUTIONS.map(item => <SolutionCard key={item.num} item={item} isMobile={isMobile} />)}
          </CardCarousel>
        </div>
      </section>

      {/* ── Emotional ── */}
      <section style={{ padding: isMobile ? "44px 20px" : "60px 24px", background: "#f8fafc" }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "flex", gap: isMobile ? 28 : 40,
          flexDirection: isMobile ? "column" : "row",
          alignItems: "center", flexWrap: "wrap",
        }}>
          <motion.div {...fade()} style={{ flex: "1 1 300px" }}>
            <h2 style={{
              fontSize: isMobile ? "clamp(20px, 5vw, 26px)" : "clamp(22px, 3vw, 30px)",
              fontWeight: 800, color: "#0f172a", lineHeight: 1.4, margin: "0 0 24px",
            }}>
              이제, 숙소는 시스템이 지키고<br />
              당신은 <span style={{ color: "#dc2626" }}>가족의 시간</span>을 지키세요
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {CHECKS.map(c => (
                <div key={c} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <CheckCircle2 size={18} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: isMobile ? 13 : 14, color: "#334155", lineHeight: 1.6 }}>{c}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: isMobile ? 13 : 14, color: "#64748b", lineHeight: 1.8 }}>
              우리 가족의 저녁 식사, 주말 산책, 아이와의 시간...<br />
              이제는 함께하세요.
            </p>
          </motion.div>
          <motion.div {...fade(0.1)} style={{ flex: "1 1 300px" }}>
            <img
              src="https://images.unsplash.com/photo-1606787366850-de6330128bfc?auto=format&fit=crop&w=700&h=440&q=80"
              alt="가족과의 시간"
              style={{ width: "100%", borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", display: "block" }}
            />
          </motion.div>
          {!isMobile && (
            <motion.div {...fade(0.15)} style={{ flex: "0 0 220px" }}>
              <div style={{
                background: "#fff", borderRadius: 16, padding: 20,
                boxShadow: "0 4px 20px rgba(0,0,0,0.10)", border: "1px solid #e2e8f0",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#059669" }} />
                  <span style={{ fontSize: 12, color: "#059669", fontWeight: 700 }}>모든 숙소 정상 운영 중</span>
                </div>
                <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 600, marginBottom: 4 }}>문제 없음</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>마음 편한 하루가 시작됩니다.</div>
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── CTA + Playlist ── */}
      <section style={{ background: "#0f172a", padding: isMobile ? "44px 20px" : "60px 24px" }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "flex", gap: isMobile ? 36 : 48,
          flexDirection: isMobile ? "column" : "row",
          flexWrap: "wrap", alignItems: "flex-start",
        }}>
          <motion.div {...fade()} style={{ flex: "1 1 320px" }}>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
              숙소 운영의 스트레스는 줄이고, 수익은 지키고, 삶은 더 여유롭게.
            </p>
            <h2 style={{
              fontSize: isMobile ? "clamp(20px, 5vw, 26px)" : "clamp(22px, 3vw, 30px)",
              fontWeight: 800, color: "#fff", lineHeight: 1.4, margin: "0 0 28px",
            }}>
              지금 바로 시작하세요!
            </h2>
            <button style={{
              display: "inline-block", background: "#2563eb", color: "#fff",
              border: "2px solid #1d4ed8",
              borderRadius: 12, padding: isMobile ? "12px 28px" : "14px 32px",
              fontSize: isMobile ? 15 : 16, fontWeight: 700, cursor: "pointer", marginBottom: 32,
            }}>
              무료 진단 받기 →
            </button>
            <div style={{ display: "flex", gap: isMobile ? 20 : 28, flexWrap: "wrap" }}>
              {["간편 설치", "지속적인 관리 & 지원", "전문가 상담"].map(label => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 8px", fontSize: 18,
                  }}>
                    {{ "간편 설치": "🔧", "지속적인 관리 & 지원": "📊", "전문가 상담": "💬" }[label]}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div {...fade(0.1)} style={{ flex: "1 1 280px" }}>
            <div style={{
              background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 24,
              border: "1px solid rgba(255,255,255,0.08)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 16 }}>♪</span>
                <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
                  지친 하루, 당신을 위한 피아노 플레이리스트
                </span>
              </div>
              {PLAYLIST.map((item, idx) => (
                <PlaylistItem
                  key={item.title}
                  item={item}
                  idx={idx}
                  playing={playing}
                  onToggle={i => setPlaying(prev => prev === i ? null : i)}
                />
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        background: "#0a0f1a", borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "24px", textAlign: "center",
      }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 6 }}>
          PROP<span style={{ color: "#2563eb" }}>OS</span>
        </div>
        <p style={{ fontSize: 12, color: "#475569" }}>© 2026 PROPOS. 단기임대 원격운영 안정화 패키지.</p>
      </footer>

    </div>
  );
}
