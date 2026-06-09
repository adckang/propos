import { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  useInView,
} from "framer-motion";

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => globalThis.window !== undefined && globalThis.window.innerWidth <= 768,
  );

  useEffect(() => {
    const handler = () => setMobile(globalThis.window.innerWidth <= 768);
    globalThis.window.addEventListener("resize", handler);
    return () => globalThis.window.removeEventListener("resize", handler);
  }, []);

  return mobile;
}

const NAVY = "#0B1F4D";
const BLUE = "#2563EB";

/* 공통 진입 속도 — 모든 씬/요소 동일 (상단 문장·중간 그래픽·결론 일관성) */
const STD_DUR = 0.6;

function entranceProps(reduced, {
  delay = 0,
  x = 0,
  y = 18,
  scale = 1,
  duration = 0.72,
  amount = 0.45,
} = {}) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      viewport: { once: true, amount },
      transition: { duration: 0.24, delay: delay * 0.35 },
    };
  }

  return {
    initial: { opacity: 0, x, y, scale },
    whileInView: { opacity: 1, x: 0, y: 0, scale: 1 },
    viewport: { once: true, amount },
    transition: { duration, delay, ease: [0.22, 1, 0.36, 1] },
  };
}

/* 모든 노드를 같은 방식(균일 팝)으로 — 거리차로 인한 속도 불일치 제거.
   각 노드는 제자리에서 scale 0.7→1 로 동일 속도(0.6s)로 등장, 순서만 delay 로 제어 */
function nodeEntrance(key, reduced, m) {
  return entranceProps(reduced, {
    delay: nodeOrderDelay(key),
    y: m ? 8 : 10,
    scale: 0.7,
    duration: STD_DUR,
    amount: m ? 0.4 : 0.3,
  });
}

const NODES = [
  {
    key: "sensor",
    iconSrc: "/icons/sensor-info.svg",
    title: "센서 정보",
    desc: "온도, 습도, 조도, 문열림 등",
    desktop: { top: "12%", left: "18%" },
  },
  {
    key: "reservation",
    iconSrc: "/icons/reservation-info.svg",
    title: "예약 정보",
    desc: "체크인/아웃, 예약 일정 등",
    desktop: { top: "6%", left: "50%" },
  },
  {
    key: "weather",
    iconSrc: "/icons/weather-info.svg",
    title: "날씨 정보",
    desc: "기온, 강수 확률, 미세먼지 등",
    desktop: { top: "12%", left: "82%" },
  },
  {
    key: "auto-control",
    iconSrc: "/icons/auto-control.svg",
    title: "자동 숙소 제어",
    desc: "조명, 에어컨, 전기 등 자동 제어",
    desktop: { top: "44%", left: "11%" },
  },
  {
    key: "mode-switch",
    iconSrc: "/icons/mode-switch.svg",
    title: "웰컴/공실모드 변경",
    desc: "입실·퇴실 감지하여 자동 전환",
    desktop: { top: "44%", left: "89%" },
  },
  {
    key: "emergency",
    iconSrc: "/icons/emergency-alert.svg",
    title: "실시간 긴급 알람",
    desc: "이상 상황 발생 시 즉시 알림",
    desktop: { top: "80%", left: "72%" },
  },
  {
    key: "weekly",
    iconSrc: "/icons/weekly-report.svg",
    title: "주간 리포트 생성",
    desc: "숙소 운영 현황 리포트",
    desktop: { top: "80%", left: "28%" },
  },
];

/* 방사형 — 중앙(50,46)에서 7개 노드로. NODES 순서와 1:1 대응
   [sensor, reservation, weather, auto-control, mode-switch, emergency, weekly] */
const DESKTOP_LINES = [
  { x1: 50, y1: 46, x2: 18, y2: 16 },  // 센서 (상단-좌)
  { x1: 50, y1: 46, x2: 50, y2: 11 },  // 예약 (상단-중)
  { x1: 50, y1: 46, x2: 82, y2: 16 },  // 날씨 (상단-우)
  { x1: 50, y1: 46, x2: 14, y2: 45 },  // 자동제어 (중단-좌)
  { x1: 50, y1: 46, x2: 86, y2: 45 },  // 웰컴모드 (중단-우)
  { x1: 50, y1: 46, x2: 71, y2: 76 },  // 긴급알람 (하단-우)
  { x1: 50, y1: 46, x2: 29, y2: 76 },  // 주간리포트 (하단-좌)
];

/* 모바일 방사형 — 중앙 엔진(50,50) 기준 7개 노드 위치 (사진 위에 떠 있는 형태) */
const MOBILE_RADIAL = {
  sensor:         { left: "20%", top: "6%" },
  reservation:    { left: "52%", top: "2%" },
  weather:        { left: "84%", top: "6%" },
  "auto-control": { left: "8%",  top: "47%" },
  "mode-switch":  { left: "92%", top: "47%" },
  weekly:         { left: "22%", top: "90%" },
  emergency:      { left: "80%", top: "90%" },
};

/* 모바일 압축 라벨 (좁은 폭에 맞춰 다이어트) */
const SHORT_LABELS = {
  sensor: "센서",
  reservation: "예약",
  weather: "날씨",
  "auto-control": "자동제어",
  "mode-switch": "모드전환",
  weekly: "리포트",
  emergency: "긴급알람",
};

/* 노드 등장 순서 — 사람이 눈으로 따라갈 수 있게 하나씩 (시계방향 스윕)
   센서 → 예약 → 날씨 → 모드전환 → 긴급알람 → 리포트 → 자동제어 */
const NODE_ORDER = ["sensor", "reservation", "weather", "mode-switch", "emergency", "weekly", "auto-control"];
const NODE_START = 0.3;    // 중심(SPACE HOST)은 항상 표시 / 첫 노드 시작
const NODE_STEP = 0.3;     // 노드 간격(또렷하지만 너무 느리지 않게)
function nodeOrderDelay(key) {
  const i = NODE_ORDER.indexOf(key);
  return NODE_START + (i < 0 ? 0 : i) * NODE_STEP;
}
/* 모든 노드 등장 직후 하단 결론 문구 (너무 늦지 않게) */
const NODES_DONE_DELAY = NODE_START + (NODE_ORDER.length - 1) * NODE_STEP + 0.4;

function NodeCard({ node, m, reduced, index }) {
  return (
    <motion.div
      {...nodeEntrance(node.key, reduced, m)}
      style={{ minWidth: 0 }}
    >
      <motion.div
        whileInView={
          reduced
            ? {}
            : {
              scale: [1, 1.012, 1],
              boxShadow: [
                "0 18px 42px rgba(11,31,77,0.08)",
                "0 22px 48px rgba(37,99,235,0.12)",
                "0 18px 42px rgba(11,31,77,0.08)",
              ],
            }
        }
        transition={{
          duration: 3.4 + (index % 3) * 0.7,
          delay: 1 + index * 0.18,
          repeat: 0,
          ease: "easeInOut",
        }}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: m ? 10 : 12,
          background: m ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.42)",
          backdropFilter: m ? "blur(12px)" : "blur(16px)",
          WebkitBackdropFilter: m ? "blur(12px)" : "blur(16px)",
          border: "1px solid rgba(11,31,77,0.09)",
          borderRadius: m ? 16 : 18,
          padding: m ? "10px 11px" : "14px 16px",
          boxShadow: m ? "0 12px 24px rgba(11,31,77,0.06)" : "0 16px 36px rgba(11,31,77,0.07)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: m ? 34 : 46,
            height: m ? 34 : 46,
            borderRadius: m ? 12 : 14,
            background: "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(34,211,238,0.12))",
            border: "1px solid rgba(37,99,235,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src={node.iconSrc}
            alt={node.title}
            width={m ? 20 : 28}
            height={m ? 20 : 28}
            style={{ display: "block" }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: m ? 11 : 13,
              fontWeight: 800,
              color: NAVY,
              lineHeight: 1.28,
              marginBottom: m ? 0 : 4,
            }}
          >
            {node.title}
          </div>
          {!m && (
            <div
              style={{
                fontSize: 12,
                color: "rgba(11,31,77,0.68)",
                lineHeight: 1.5,
              }}
            >
              {node.desc}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function AIEngineCore({ m, reduced }) {
  const size = m ? 118 : 232;
  const inner = m ? 88 : 174;

  return (
    <motion.div
      /* 중심 SPACE HOST = 처음부터 항상 표시(애니메이션 없음) */
      initial={false}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "radial-gradient(circle at 50% 50%, rgba(37,99,235,0.10), rgba(37,99,235,0.02) 60%, transparent 72%)",
          border: "1px solid rgba(37,99,235,0.10)",
          boxShadow: "0 18px 42px rgba(11,31,77,0.08)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: m ? 14 : 16,
          borderRadius: "50%",
          border: "1px dashed rgba(37,99,235,0.18)",
        }}
      />

      <motion.div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: inner,
          height: inner,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: "linear-gradient(160deg, rgba(255,255,255,0.92), rgba(232,242,255,0.86))",
          border: "1px solid rgba(11,31,77,0.09)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          boxShadow: "0 22px 46px rgba(11,31,77,0.10)",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "16% 16% auto",
            height: "34%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(37,99,235,0.20) 0%, rgba(34,211,238,0.10) 48%, transparent 78%)",
            filter: "blur(10px)",
          }}
        />
        {/* 중앙 = 파란 하우스 마크 + 네이비 SPACE HOST (밝은 코어 위에서 또렷하게) */}
        <svg
          aria-hidden="true"
          width={m ? 24 : 38}
          height={m ? 24 : 38}
          viewBox="10 4 52 56"
          fill="none"
          style={{ position: "relative", zIndex: 1, display: "block", marginBottom: m ? 5 : 9 }}
        >
          <path d="M16 44V24L36 8L56 24V56H16V44Z" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M29 55V37H46V55" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M27 31H46" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 800,
            fontSize: m ? 12.5 : 20,
            letterSpacing: m ? "0.02em" : "0.04em",
            color: NAVY,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          SPACE HOST
        </div>
      </motion.div>
    </motion.div>
  );
}

function DesktopNetwork({ reduced }) {
  return (
    <div
      style={{
        position: "relative",
        width: 592,
        height: 596,
        maxWidth: "100%",
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: "8% 5% 6%",
          width: "90%",
          height: "86%",
          overflow: "visible",
        }}
      >
        <defs>
          <linearGradient id="scene5-line" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(37,99,235,0.14)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.32)" />
          </linearGradient>
        </defs>
        {DESKTOP_LINES.map((line, index) => (
          <motion.line
            key={`${line.x2}-${line.y2}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="url(#scene5-line)"
            strokeWidth="0.7"
            strokeLinecap="round"
            initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0.28 }}
            whileInView={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: reduced ? 0.24 : STD_DUR,
              delay: reduced ? nodeOrderDelay(NODES[index].key) * 0.35 : nodeOrderDelay(NODES[index].key),
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        ))}
      </svg>

      {DESKTOP_LINES.map((line, index) => (
        <motion.img
          key={`node-${line.x2}-${line.y2}`}
          src="/icons/connection-node.svg"
          alt=""
          aria-hidden="true"
          width={18}
          height={18}
          {...entranceProps(reduced, {
            delay: nodeOrderDelay(NODES[index].key),
            scale: 0.9,
            duration: STD_DUR,
            amount: 0.4,
          })}
          style={{
            position: "absolute",
            left: `calc(${line.x2}% - 9px)`,
            top: `calc(${line.y2}% - 9px)`,
            display: "block",
            opacity: 0.92,
          }}
        />
      ))}

      <div
        style={{
          position: "absolute",
          top: "46%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 2,
        }}
      >
        <AIEngineCore m={false} reduced={reduced} />
      </div>

      {NODES.map((node, index) => (
        <div
          key={node.key}
          style={{
            position: "absolute",
            top: node.desktop.top,
            left: node.desktop.left,
            transform: "translate(-50%, -50%)",
            width: node.key === "weekly" ? 208 : 176,
          }}
        >
          <NodeCard node={node} m={false} reduced={reduced} index={index} />
        </div>
      ))}
    </div>
  );
}

/* 모바일 방사형 노드 칩 — 아이콘 + 압축 라벨 (사진 위에 떠 있음, 솔리드 패널 없음) */
function MobileChip({ node }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: 58 }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 13,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(11,31,77,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 16px rgba(11,31,77,0.14)",
      }}>
        <img src={node.iconSrc} alt={node.title} width={23} height={23} style={{ display: "block" }} />
      </div>
      {/* 솔루션명 — Nunito 로 예쁘게 */}
      <span style={{
        fontFamily: "'Nunito', sans-serif",
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: "-0.01em",
        color: NAVY,
        whiteSpace: "nowrap",
        textShadow: "0 1px 4px rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.9)",
      }}>
        {SHORT_LABELS[node.key]}
      </span>
    </div>
  );
}

function MobileNetwork({ reduced }) {
  return (
    <div style={{ position: "relative", width: "66%", maxWidth: 248, aspectRatio: "1 / 1", marginLeft: "auto", marginTop: 10, marginBottom: 10 }}>
      {/* 연결선 — 중앙(50,50)에서 각 노드로 */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="scene5-mobile-line" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(37,99,235,0.20)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.32)" />
          </linearGradient>
        </defs>
        {NODES.map((node, index) => {
          const p = MOBILE_RADIAL[node.key];
          return (
            <motion.line
              key={node.key}
              x1="50"
              y1="50"
              x2={Number.parseFloat(p.left)}
              y2={Number.parseFloat(p.top)}
              stroke="url(#scene5-mobile-line)"
              strokeWidth="0.8"
              strokeLinecap="round"
              initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0.3 }}
              whileInView={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{
                duration: reduced ? 0.22 : STD_DUR,
                delay: reduced ? nodeOrderDelay(node.key) * 0.35 : nodeOrderDelay(node.key),
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          );
        })}
      </svg>

      {/* 중앙 엔진 */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2 }}>
        <AIEngineCore m reduced={reduced} />
      </div>

      {/* 노드 칩 (방사형) */}
      {NODES.map((node, index) => {
        const p = MOBILE_RADIAL[node.key];
        return (
          <div
            key={node.key}
            style={{ position: "absolute", top: p.top, left: p.left, transform: "translate(-50%, -50%)", zIndex: 3 }}
          >
            <motion.div
              {...entranceProps(reduced, { delay: nodeOrderDelay(node.key), x: 0, y: 0, scale: 0.82, duration: STD_DUR, amount: 0.3 })}
            >
              <MobileChip node={node} />
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

export default function Scene5AIEngine() {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { amount: 0.2, once: true });
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const exitOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.25]);
  const exitScale = useTransform(scrollYProgress, [0, 1], [1, 0.97]);
  const exitY = useTransform(scrollYProgress, [0, 1], [0, -70]);

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        minHeight: m ? "100svh" : "96vh",
        overflow: "hidden",
        background: "#f4ede2",
      }}
    >
      <motion.div
        style={{
          position: "relative",
          minHeight: m ? "100svh" : "96vh",
          opacity: reduced ? 1 : exitOpacity,
          scale: reduced ? 1 : exitScale,
          y: reduced ? 0 : exitY,
          willChange: "transform, opacity",
        }}
      >
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}
        >
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 1, scale: 1.03 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: reduced ? 0.28 : 1.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: "absolute", inset: 0, willChange: "transform, opacity" }}
          >
            <picture style={{ display: "block", width: "100%", height: "100%" }}>
              <source media="(max-width: 768px)" srcSet="/images/scene-5-mobile-bg.png" />
              <img
                src="/images/scene-5-desktop-bg.png"
                alt=""
                role="presentation"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: m ? "50% 50%" : "60% 50%",
                  display: "block",
                }}
              />
            </picture>
          </motion.div>
        </div>

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background: m
              ? "linear-gradient(to bottom, rgba(252,248,242,0.16) 0%, rgba(252,248,242,0.04) 18%, rgba(252,248,242,0.0) 42%, rgba(252,248,242,0.02) 76%, rgba(252,248,242,0.12) 100%)"
              : "linear-gradient(to bottom, rgba(252,248,242,0.22) 0%, rgba(252,248,242,0.06) 26%, rgba(252,248,242,0.0) 56%, rgba(252,248,242,0.14) 100%)",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            /* 좌측: 텍스트 가독용 옅은 라이트 / 중앙: 투명(인물 노출) / 우측: 흰 캔버스(도식 전용)
               → scene-5.png 처럼 도식이 인물 위가 아닌 깨끗한 흰 배경 위에 뜨도록 */
            background: m
              ? "linear-gradient(to right, rgba(252,248,242,0.30) 0%, rgba(252,248,242,0.08) 24%, rgba(252,248,242,0.0) 40%, transparent 54%)"
              : "linear-gradient(to right, rgba(252,248,242,0.42) 0%, rgba(252,248,242,0.10) 20%, transparent 36%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0.68) 68%, rgba(255,255,255,0.80) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 2,
            minHeight: m ? "100svh" : "96vh",
            padding: m ? "28px 20px 24px" : "48px 64px 40px",
            display: "flex",
            flexDirection: "column",
            justifyContent: m ? "flex-start" : "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: m ? "flex-start" : "space-between",
              alignItems: m ? "stretch" : "flex-start",
              gap: m ? 18 : 28,
              flexDirection: m ? "column" : "row",
            }}
          >
            <div
              style={{
                width: m ? "100%" : "min(46%, 520px)",
                paddingTop: m ? 0 : 10,
              }}
            >
              <motion.img
                initial={false}
                src="/icons/spacehost-logo.svg"
                alt="SPACE HOST"
                style={{
                  height: m ? 26 : 30,
                display: "block",
                marginBottom: 10,
                  filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.20))",
                }}
              />
              <div style={{ marginTop: m ? 26 : 34 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: m ? "clamp(30px, 8.5vw, 48px)" : "clamp(46px, 4.8vw, 70px)",
                    fontWeight: 900,
                    lineHeight: 1.15,
                    letterSpacing: "-0.025em",
                    color: NAVY,
                  }}
                >
                  {[
                    "많은 알림으로 괴롭히는",                    
                  ].map((line, index) => (
                    <div key={line} style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
                      <motion.span
                        initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                        animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }) : (reduced ? { opacity: 0 } : { opacity: 1, y: "110%" })}
                        transition={{
                          delay: reduced ? (0.2 + index * 0.08) * 0.35 : 0.2 + index * 0.12,
                          duration: reduced ? 0.22 : STD_DUR,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        style={{ display: "block", whiteSpace: m ? "normal" : "nowrap" }}
                      >
                        {line}
                      </motion.span>
                    </div>
                  ))}

                  <div style={{ overflow: "hidden", paddingBottom: "0.08em", marginTop: m ? 14 : 18 }}>
                    <motion.span
                      initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                      animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }) : (reduced ? { opacity: 0 } : { opacity: 1, y: "110%" })}
                      transition={{
                        delay: reduced ? 0.34 * 0.35 : 0.46,
                        duration: reduced ? 0.22 : STD_DUR,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{ display: "block" }}
                    >
                      <motion.span
                        whileInView={
                          reduced
                            ? {}
                            : {
                              textShadow: [
                                "0 0 0 rgba(37,99,235,0)",
                                "0 0 18px rgba(37,99,235,0.22)",
                                "0 0 0 rgba(37,99,235,0)",
                              ],
                            }
                        }
                        transition={{ duration: 4.2, delay: 1.2, repeat: 0, ease: "easeInOut" }}
                        style={{ color: BLUE }}
                      >
                        단순제어 시스템
                      </motion.span>
                      <span>이 <br/>아닙니다.</span>
                    </motion.span>
                  </div>
                </h2>

                
              </div>
            </div>

            <div
              style={{
                width: m ? "100%" : "min(52%, 620px)",
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: m ? 8 : 20,
                marginTop: 0,
              }}
            >
              {m ? <MobileNetwork reduced={reduced} /> : <DesktopNetwork reduced={reduced} />}
            </div>
          </div>

          {!m && (
            <motion.div
              {...entranceProps(reduced, { delay: NODES_DONE_DELAY, y: 32, duration: STD_DUR, amount: 0.55 })}
              style={{
                marginTop: 18,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                background: "rgba(255,255,255,0.58)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: "1px solid rgba(11,31,77,0.09)",
                borderRadius: 20,
                padding: "16px 28px 18px",
                boxShadow: "0 12px 28px rgba(11,31,77,0.06)",
              }}
            >
              <img
                src="/icons/spacehost-logo-on-light.svg"
                alt="SPACE HOST"
                style={{ height: 28, display: "block", flexShrink: 0 }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                <img
                  src="/icons/laurel-gold.svg"
                  alt=""
                  aria-hidden="true"
                  style={{ width: 36, height: 56, display: "block", flexShrink: 0, transform: "scaleX(-1)" }}
                />
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: NAVY,
                    lineHeight: 1.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  상황을 종합 판단하여 스스로 행동하는 <span style={{ color: BLUE }}>지능형 시스템</span>입니다.
                </div>
                <img
                  src="/icons/laurel-gold.svg"
                  alt=""
                  aria-hidden="true"
                  style={{ width: 36, height: 56, display: "block", flexShrink: 0 }}
                />
              </div>
            </motion.div>
          )}

          {/* 모바일 값 카드 — 마무리 문구 (하단에 안정 배치: marginTop auto) */}
          {m && (
            <motion.div
              {...entranceProps(reduced, { delay: NODES_DONE_DELAY, y: 18, duration: STD_DUR, amount: 0.4 })}
              style={{
                marginTop: "auto",
                paddingTop: 0,
                marginBottom: 4,
                width: "100%",
                background: "rgba(255,255,255,0.62)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                border: "1px solid rgba(11,31,77,0.08)",
                borderRadius: 16,
                padding: "12px 14px",
                boxShadow: "0 10px 22px rgba(11,31,77,0.05)",
              }}
            >
              <div style={{ fontSize: m ? 17 : 22, fontWeight: 800, color: NAVY, lineHeight: 1.45, marginBottom: 4 }}>
                "종합 판단"하여 "행동"하는 <span style={{ color: BLUE }}>지능형 시스템</span>
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(11,31,77,0.66)", lineHeight: 1.6 }}>
                당신의 일상을 되돌려 드립니다
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </section>
  );
}
