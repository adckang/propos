import { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
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

function nodeEntrance(index, reduced, m) {
  if (m) {
    const mobileOrigins = [
      { x: -24, y: -18 },
      { x: 24, y: -18 },
      { x: -20, y: 6 },
      { x: 20, y: 6 },
      { x: -18, y: 22 },
      { x: 18, y: 22 },
      { x: 0, y: 28 },
    ];
    return entranceProps(reduced, {
      delay: 0.52 + index * 0.08,
      x: mobileOrigins[index]?.x || 0,
      y: mobileOrigins[index]?.y || 18,
      scale: 0.94,
      duration: 0.6,
      amount: 0.45,
    });
  }

  const desktopOrigins = [
    { x: -40, y: -34 },
    { x: 40, y: -34 },
    { x: -52, y: -8 },
    { x: 52, y: -8 },
    { x: -40, y: 28 },
    { x: 40, y: 28 },
    { x: 0, y: 42 },
  ];

  return entranceProps(reduced, {
    delay: 0.52 + index * 0.08,
    x: desktopOrigins[index]?.x || 0,
    y: desktopOrigins[index]?.y || 18,
    scale: 0.94,
    duration: 0.64,
    amount: 0.35,
  });
}

const NODES = [
  {
    key: "sensor",
    iconSrc: "/icons/sensor-info.svg",
    title: "센서 정보",
    desc: "온도, 습도, 조도, 문열림 등",
    desktop: { top: "18%", left: "26%" },
  },
  {
    key: "reservation",
    iconSrc: "/icons/reservation-info.svg",
    title: "예약 정보",
    desc: "체크인/아웃, 예약 일정 등",
    desktop: { top: "16%", left: "79%" },
  },
  {
    key: "weather",
    iconSrc: "/icons/weather-info.svg",
    title: "날씨 정보",
    desc: "기온, 강수 확률, 미세먼지 등",
    desktop: { top: "44%", left: "16%" },
  },
  {
    key: "auto-control",
    iconSrc: "/icons/auto-control.svg",
    title: "자동 숙소 제어",
    desc: "조명, 에어컨, 전기 등 자동 제어",
    desktop: { top: "43%", left: "88%" },
  },
  {
    key: "mode-switch",
    iconSrc: "/icons/mode-switch.svg",
    title: "웰컴/공실모드 변경",
    desc: "입실·퇴실 감지하여 자동 전환",
    desktop: { top: "74%", left: "26%" },
  },
  {
    key: "emergency",
    iconSrc: "/icons/emergency-alert.svg",
    title: "실시간 긴급 알람",
    desc: "이상 상황 발생 시 즉시 알림",
    desktop: { top: "73%", left: "80%" },
  },
  {
    key: "weekly",
    iconSrc: "/icons/weekly-report.svg",
    title: "주간 리포트 생성",
    desc: "숙소 운영 현황 리포트",
    desktop: { top: "87%", left: "56%" },
  },
];

const DESKTOP_LINES = [
  { x1: 56, y1: 47, x2: 27, y2: 22 },
  { x1: 56, y1: 47, x2: 80, y2: 21 },
  { x1: 56, y1: 47, x2: 19, y2: 45 },
  { x1: 56, y1: 47, x2: 87, y2: 44 },
  { x1: 56, y1: 47, x2: 27, y2: 74 },
  { x1: 56, y1: 47, x2: 80, y2: 73 },
  { x1: 56, y1: 47, x2: 56, y2: 84 },
];

function NodeCard({ node, m, reduced, index }) {
  return (
    <motion.div
      {...nodeEntrance(index, reduced, m)}
      style={{ minWidth: 0 }}
    >
      <motion.div
        animate={
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
          repeat: reduced ? 0 : Infinity,
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
  const size = m ? 144 : 232;
  const inner = m ? 104 : 174;

  return (
    <motion.div
      {...entranceProps(reduced, {
        delay: 0.38,
        y: 22,
        scale: 0.92,
        duration: 0.72,
        amount: 0.35,
      })}
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
          background: "linear-gradient(160deg, rgba(255,255,255,0.64), rgba(235,244,255,0.50))",
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
        <motion.div
          animate={reduced ? {} : { scale: [1, 1.045, 1] }}
          transition={{ duration: 3.2, repeat: reduced ? 0 : Infinity, ease: "easeInOut" }}
          style={{
            position: "relative",
            zIndex: 1,
            width: m ? 46 : 60,
            height: m ? 46 : 60,
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(34,211,238,0.12))",
            border: "1px solid rgba(37,99,235,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: m ? 10 : 16,
          }}
        >
          <img
            src="/icons/ai-brain.svg"
            alt="AI Brain"
            width={m ? 26 : 38}
            height={m ? 26 : 38}
            style={{ display: "block" }}
          />
        </motion.div>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            fontSize: m ? 10 : 11,
            color: "rgba(11,31,77,0.58)",
            letterSpacing: "0.14em",
            fontFamily: "'DM Mono', monospace",
            marginBottom: m ? 6 : 8,
          }}
        >
          SPACE HOST
        </div>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            fontSize: m ? 20 : 28,
            fontWeight: 900,
            letterSpacing: "-0.03em",
            color: NAVY,
            lineHeight: 1.05,
          }}
        >
          AI ENGINE
        </div>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: m ? 8 : 12,
            fontSize: m ? 10 : 12,
            color: "rgba(11,31,77,0.60)",
            lineHeight: 1.5,
          }}
        >
          데이터를 종합 판단해
          <br />
          행동으로 연결합니다.
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
              duration: reduced ? 0.24 : 0.52,
              delay: reduced ? (0.2 + index * 0.05) * 0.35 : 0.36 + index * 0.08,
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
            delay: 0.5 + index * 0.08,
            scale: 0.9,
            duration: 0.42,
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
          top: "47%",
          left: "56%",
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

function MobileNetwork({ reduced }) {
  const mobileNodes = [NODES[0], NODES[3]];
  return (
    <div style={{ width: "100%", maxWidth: 176, marginLeft: "auto" }}>
      <div
        style={{
          position: "relative",
          height: 146,
          marginBottom: 10,
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        >
          <defs>
            <linearGradient id="scene5-mobile-line" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(37,99,235,0.14)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.28)" />
            </linearGradient>
          </defs>
          {[
            { x2: 36, y2: 58 },
            { x2: 84, y2: 58 },
          ].map((line, index) => (
            <motion.line
              key={`${line.x2}-${line.y2}`}
              x1="50"
              y1="22"
              x2={line.x2}
              y2={line.y2}
              stroke="url(#scene5-mobile-line)"
              strokeWidth="0.9"
              strokeLinecap="round"
              initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0.28 }}
              whileInView={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
              viewport={{ once: true, amount: 0.45 }}
              transition={{
                duration: reduced ? 0.22 : 0.48,
                delay: reduced ? (0.34 + index * 0.06) * 0.35 : 0.38 + index * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          ))}
        </svg>

        {[
          { left: "36%", top: "58%" },
          { left: "84%", top: "58%" },
        ].map((pos, index) => (
          <motion.img
            key={`${pos.left}-${pos.top}`}
            src="/icons/connection-node.svg"
            alt=""
            aria-hidden="true"
            width={16}
            height={16}
            {...entranceProps(reduced, {
              delay: 0.46 + index * 0.08,
              scale: 0.9,
              duration: 0.4,
              amount: 0.45,
            })}
            style={{
              position: "absolute",
              left: `calc(${pos.left} - 8px)`,
              top: `calc(${pos.top} - 8px)`,
              display: "block",
              opacity: 0.94,
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            top: 2,
            left: "78%",
            transform: "translateX(-50%)",
          }}
        >
          <AIEngineCore m reduced={reduced} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 6,
        }}
      >
        {mobileNodes.map((node, index) => (
          <div
            key={node.key}
          >
            <NodeCard node={node} m reduced={reduced} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Scene5AIEngine() {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const sectionRef = useRef(null);
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
            background: m
              ? "linear-gradient(to right, rgba(252,248,242,0.30) 0%, rgba(252,248,242,0.08) 24%, rgba(252,248,242,0.0) 40%, transparent 54%)"
              : "linear-gradient(to right, rgba(252,248,242,0.62) 0%, rgba(252,248,242,0.34) 24%, rgba(252,248,242,0.08) 42%, transparent 60%)",
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
              display: m ? "grid" : "flex",
              justifyContent: m ? undefined : "space-between",
              gridTemplateColumns: m ? "minmax(0, 1fr) minmax(0, 176px)" : undefined,
              alignItems: "flex-start",
              gap: m ? 12 : 28,
              flexDirection: m ? "column" : "row",
              ...(m ? {} : { }),
            }}
          >
            <div
              style={{
                width: m ? "100%" : "min(40%, 440px)",
                paddingTop: m ? 0 : 10,
              }}
            >
              <motion.img
                {...entranceProps(reduced, { delay: 0.06, y: 12, duration: 0.56, amount: 0.5 })}
                src="/icons/spacehost-logo.svg"
                alt="SPACE HOST"
                style={{
                  height: m ? 26 : 30,
                display: "block",
                marginBottom: 10,
                  filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.20))",
                }}
              />
              <motion.p
                {...entranceProps(reduced, { delay: 0.12, y: 12, duration: 0.56, amount: 0.5 })}
                style={{
                  margin: 0,
                  fontSize: m ? 10 : 11,
                  color: "rgba(11,31,77,0.68)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                Smart. Carefree. Anywhere.
              </motion.p>

              <div style={{ marginTop: m ? 26 : 34 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: m ? "clamp(30px, 8.8vw, 46px)" : "clamp(46px, 4.8vw, 68px)",
                    fontWeight: 900,
                    lineHeight: 1.08,
                    letterSpacing: "-0.035em",
                    color: NAVY,
                  }}
                >
                  {[
                    "하루종일 알림으로",
                    "괴로운",
                  ].map((line, index) => (
                    <div key={line} style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
                      <motion.span
                        initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                        animate={reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }}
                        transition={{
                          delay: reduced ? (0.2 + index * 0.08) * 0.35 : 0.2 + index * 0.12,
                          duration: reduced ? 0.22 : 0.82,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        style={{ display: "block" }}
                      >
                        {line}
                      </motion.span>
                    </div>
                  ))}

                  <div style={{ overflow: "hidden", paddingBottom: "0.08em", marginTop: m ? 14 : 18 }}>
                    <motion.span
                      initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }}
                      transition={{
                        delay: reduced ? 0.34 * 0.35 : 0.46,
                        duration: reduced ? 0.22 : 0.82,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{ display: "block" }}
                    >
                      <motion.span
                        animate={
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
                        transition={{ duration: 4.2, delay: 1.2, repeat: reduced ? 0 : Infinity, ease: "easeInOut" }}
                        style={{ color: BLUE }}
                      >
                        단순 원격제어
                      </motion.span>
                      <span>가 아닙니다.</span>
                    </motion.span>
                  </div>
                </h2>

                {!m && (
                  <motion.p
                    {...entranceProps(reduced, { delay: 0.62, y: 16, duration: 0.62, amount: 0.6 })}
                    style={{
                      margin: "22px 0 0",
                      maxWidth: 380,
                      fontSize: 15,
                      color: "rgba(11,31,77,0.70)",
                      lineHeight: 1.72,
                    }}
                  >
                    센서, 예약, 날씨, 제어 이벤트가 따로 오는 것이 아니라
                    하나의 엔진이 종합 판단해서 숙소를 움직입니다.
                  </motion.p>
                )}
              </div>
            </div>

            <div
              style={{
                width: m ? "100%" : "min(52%, 620px)",
                display: "flex",
                justifyContent: m ? "flex-end" : "flex-end",
                paddingTop: m ? 92 : 20,
                marginTop: 0,
              }}
            >
              {m ? <MobileNetwork reduced={reduced} /> : <DesktopNetwork reduced={reduced} />}
            </div>
          </div>

          {!m && (
            <motion.div
              {...entranceProps(reduced, { delay: 0.94, y: 32, duration: 0.64, amount: 0.55 })}
              style={{
                marginTop: 12,
                width: "min(36%, 420px)",
                alignSelf: "flex-start",
                background: "rgba(255,255,255,0.54)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                border: "1px solid rgba(11,31,77,0.09)",
                borderRadius: 22,
                padding: "18px 20px",
                boxShadow: "0 16px 34px rgba(11,31,77,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: NAVY,
                  lineHeight: 1.5,
                  marginBottom: 8,
                }}
              >
                종합 판단하여 행동하는 지능형 시스템입니다.
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "rgba(11,31,77,0.66)",
                  lineHeight: 1.7,
                }}
              >
                당신이 편안한 순간, SPACE HOST가 지능적으로 운영합니다.
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </section>
  );
}
