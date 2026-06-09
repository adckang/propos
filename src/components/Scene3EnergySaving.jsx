import { useEffect, useRef, useState } from "react";
import {
  animate,
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

const NAVY = "#081225";
const BLUE = "#2563EB";
const CYAN = "#22D3EE";

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

function formatCount(value, decimals) {
  const rounded = decimals ? Number(value.toFixed(decimals)) : Math.round(value);
  return rounded.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const FEATURES = [
  { iconSrc: "/icons/ac-auto-off.svg", title: "에어컨", desc: "자동 OFF" },
  { iconSrc: "/icons/light-auto-off.svg", title: "조명", desc: "자동 OFF" },
  { iconSrc: "/icons/window-alert.svg", title: "창문/문열림", desc: "알림 감지" },
  { iconSrc: "/icons/standby-power-block.svg", title: "대기전력", desc: "차단" },
  { iconSrc: "/icons/energy-saving.svg", title: "에너지", desc: "절약 실현" },
];

const KPI_ITEMS = [
  {
    iconSrc: "/icons/savings-effect.svg",
    label: "예상 절감 효과",
    value: "1일 기준",
  },
  {
    iconSrc: "/icons/electricity-usage.svg",
    label: "전기 사용량",
    number: 28.6,
    decimals: 1,
    suffix: " kWh 절감",
  },
  {
    iconSrc: "/icons/operating-cost.svg",
    label: "운영비",
    number: 4300,
    decimals: 0,
    suffix: "원 절감",
  },
];

function CountUpValue({ value, decimals = 0, suffix = "", active, reduced }) {
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    if (reduced) {
      setDisplay(value);
      return undefined;
    }

    const controls = animate(0, value, {
      duration: decimals ? 1.28 : 1.18,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });

    return () => controls.stop();
  }, [active, decimals, reduced, value]);

  return (
    <>{`${formatCount(display, decimals)}${suffix}`}</>
  );
}

function FeaturePill({ item, index, m, reduced, full }) {
  return (
    <motion.div
      {...entranceProps(reduced, {
        delay: 0.62 + index * 0.08,
        y: m ? 16 : 20,
        duration: 0.6,
        amount: 0.48,
      })}
      style={{
        minWidth: 0,
        ...(full ? { gridColumn: "1 / -1" } : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: m ? 10 : 12,
          background: m ? "rgba(8,18,37,0.28)" : "rgba(8,18,37,0.24)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(248,250,252,0.09)",
          borderRadius: m ? 14 : 16,
          padding: m ? "10px 11px" : "13px 15px",
          boxShadow: "0 14px 28px rgba(2,6,23,0.20)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: m ? 38 : 46,
            height: m ? 38 : 46,
            borderRadius: m ? 12 : 14,
            background: "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(34,211,238,0.14))",
            border: "1px solid rgba(248,250,252,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src={item.iconSrc}
            alt={item.title}
            width={m ? 22 : 28}
            height={m ? 22 : 28}
            style={{ display: "block" }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: m ? 12 : 13,
              fontWeight: 800,
              color: "#F8FAFC",
              lineHeight: 1.25,
              marginBottom: 4,
            }}
          >
            {item.title}
          </div>
          <div
            style={{
              fontSize: m ? 11 : 12,
              color: "rgba(248,250,252,0.74)",
              lineHeight: 1.4,
            }}
          >
            {item.desc}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AirFlowLayer({ m, reduced }) {
  const waves = [
    {
      top: m ? 46 : 74,
      right: m ? 64 : 98,
      width: m ? 102 : 182,
      rotate: -7,
      opacity: m ? 0.58 : 0.72,
      duration: 9.2,
    },
    {
      top: m ? 72 : 114,
      right: m ? 82 : 124,
      width: m ? 128 : 238,
      rotate: -9,
      opacity: m ? 0.46 : 0.58,
      duration: 10.6,
    },
    {
      top: m ? 96 : 156,
      right: m ? 70 : 110,
      width: m ? 118 : 214,
      rotate: -6,
      opacity: m ? 0.36 : 0.46,
      duration: 11.4,
    },
  ];

  return (
    <motion.div
      {...entranceProps(reduced, {
        delay: 0.48,
        y: m ? 18 : 24,
        duration: 0.7,
        amount: 0.42,
      })}
      aria-hidden="true"
      style={{
        position: "relative",
        width: "100%",
        height: m ? 138 : 228,
        borderRadius: m ? 22 : 28,
        overflow: "hidden",
        background: m
          ? "linear-gradient(160deg, rgba(8,18,37,0.16), rgba(8,18,37,0.04))"
          : "linear-gradient(160deg, rgba(8,18,37,0.24), rgba(8,18,37,0.08))",
        border: "1px solid rgba(248,250,252,0.08)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: "0 16px 30px rgba(2,6,23,0.18)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: m ? "16% 12% auto auto" : "12% 10% auto auto",
          width: m ? 86 : 144,
          height: m ? 54 : 82,
          borderRadius: 999,
          background: "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(34,211,238,0.10))",
          filter: "blur(16px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: m ? 14 : 28,
          right: m ? 16 : 30,
          width: m ? 58 : 88,
          height: m ? 58 : 88,
          borderRadius: "50%",
          background: "linear-gradient(145deg, rgba(37,99,235,0.15), rgba(34,211,238,0.10))",
          border: "1px solid rgba(248,250,252,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 12px 24px rgba(2,6,23,0.18)",
        }}
      >
        <img
          src="/icons/ac-auto-off.svg"
          alt=""
          width={m ? 28 : 44}
          height={m ? 28 : 44}
          style={{ display: "block" }}
        />
      </div>

      {waves.map((wave, index) => (
        <motion.div
          key={wave.top}
          animate={
            reduced
              ? {}
              : {
                x: [0, -(m ? 9 : 14), -(m ? 18 : 28)],
                opacity: [wave.opacity * 0.56, wave.opacity * 0.88, wave.opacity * 0.62],
                scaleX: [0.96, 1.01, 0.98],
                filter: [
                  "blur(0.2px)",
                  `drop-shadow(0 0 ${m ? 7 : 10}px rgba(34,211,238,0.22))`,
                  "blur(0.2px)",
                ],
              }
          }
          transition={{
            duration: wave.duration,
            delay: index * 0.55,
            repeat: 0,
            ease: "easeInOut",
          }}
          style={{
            position: "absolute",
            top: wave.top,
            right: wave.right,
            width: wave.width,
            height: m ? 12 : 16,
            borderRadius: 999,
            background: "linear-gradient(90deg, rgba(34,211,238,0.0) 0%, rgba(34,211,238,0.34) 26%, rgba(96,165,250,0.62) 58%, rgba(34,211,238,0.0) 100%)",
            filter: "blur(0.2px)",
            opacity: wave.opacity * 0.9,
            transform: `rotate(${wave.rotate}deg)`,
            transformOrigin: "right center",
            willChange: "transform, opacity, filter",
          }}
        />
      ))}

      {!m && (
        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 24,
            display: "flex",
            gap: 9,
            flexWrap: "wrap",
            maxWidth: 228,
          }}
        >
          {[
          { src: "/icons/light-auto-off.svg", label: "조명 OFF" },
          { src: "/icons/window-alert.svg", label: "열림 감지" },
          { src: "/icons/standby-power-block.svg", label: "대기전력 차단" },
          ].map((badge, index) => (
            <motion.div
              key={badge.label}
              {...entranceProps(reduced, {
                delay: 0.78 + index * 0.08,
                y: 16,
                duration: 0.6,
                amount: 0.42,
              })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: "rgba(8,18,37,0.34)",
                border: "1px solid rgba(248,250,252,0.08)",
                borderRadius: 999,
                padding: "8px 11px",
              }}
            >
              <img
                src={badge.src}
                alt=""
                width={20}
                height={20}
                style={{ display: "block" }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(248,250,252,0.82)",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {badge.label}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function KpiCard({ m, reduced }) {
  const [countsActive, setCountsActive] = useState(false);

  if (m) {
    return (
      <motion.div
        {...entranceProps(reduced, {
          delay: 0.94,
          y: 24,
          duration: 0.6,
          amount: 0.5,
        })}
        onViewportEnter={() => setCountsActive(true)}
        style={{
          background: "rgba(8,18,37,0.44)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(248,250,252,0.10)",
          borderRadius: 18,
          padding: "14px 14px 13px",
          boxShadow: "0 22px 50px rgba(2,6,23,0.26)",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <img
            src="/icons/value-badge-gold.svg"
            alt=""
            role="presentation"
            style={{ width: 30, height: 30, flexShrink: 0 }}
          />
          <div
            style={{
                    margin: 0,
                    fontSize: m ? 17 : 22,
                    color: "#fff",
                    fontWeight: 900,
                    lineHeight: 1.3,
                    letterSpacing: "-0.02em",
                    textShadow: "0 8px 24px rgba(6,182,212,0.16)",
                    whiteSpace: "nowrap",
                  }}
          >
            퇴실 감지하여 자동 절전모드
          </div>
        </div>
        
      </motion.div>
    );
  }

  return (
    <motion.div
      {...entranceProps(reduced, {
        delay: 0.94,
        y: m ? 24 : 32,
        duration: 0.6,
        amount: 0.5,
      })}
      onViewportEnter={() => setCountsActive(true)}
      style={{
        background: "rgba(8,18,37,0.44)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: "1px solid rgba(248,250,252,0.10)",
        borderRadius: m ? 18 : 22,
        padding: m ? "14px 14px 13px" : "20px 22px",
        boxShadow: "0 22px 50px rgba(2,6,23,0.26)",
        width: "100%",
      }}
    >

           
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
        <img
          src="/icons/value-badge-gold.svg"
          alt=""
          role="presentation"
          style={{ width: m ? 30 : 36, height: m ? 30 : 36, flexShrink: 0 }}
        />
        <div
          style={{
            fontSize: m ? 14 : 20,
            fontWeight: 900,
            color: "#F8FAFC",
            lineHeight: m ? 1.45 : 1.4,
            textAlign: "left",
            width: "100%",
            maxWidth: m ? "100%" : 520,
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
          }}
        >
          스스로 감지하여 절전모드 자동 실행
        </div>
      </div>
      <div
        style={{
          fontSize: m ? 12 : 13,
          color: "rgba(248,250,252,0.72)",
          lineHeight: 1.65,
          textAlign: "left",
          width: "100%",
          maxWidth: m ? "100%" : 420,
        }}
      >
        걱정은 덜고, 효율은 더하는 스마트한 운영
      </div>
    </motion.div>
  );
}

export default function Scene3EnergySaving() {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { amount: 0.2, once: true });
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const exitOpacity = useTransform(scrollYProgress, [0, 1], [1, m ? 0.32 : 0.25]);
  const exitScale = useTransform(scrollYProgress, [0, 1], [1, m ? 0.98 : 0.97]);
  const exitY = useTransform(scrollYProgress, [0, 1], [0, m ? -56 : -70]);

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        minHeight: m ? "100svh" : "96vh",
        overflow: "hidden",
        background: "#050a15",
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
            transition={{ duration: reduced ? 0.28 : 1.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: "absolute", inset: 0, willChange: "transform, opacity" }}
          >
            <picture style={{ display: "block", width: "100%", height: "100%" }}>
              <source media="(max-width: 768px)" srcSet="/images/scene-3-mobile-bg.png" />
              <img
                src="/images/scene-3-desktop-bg.png"
                alt=""
                role="presentation"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: m ? "64% 38%" : "64% 50%",
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
              ? "linear-gradient(to bottom, rgba(5,10,21,0.76) 0%, rgba(5,10,21,0.34) 18%, rgba(5,10,21,0.06) 38%, rgba(5,10,21,0.18) 72%, rgba(5,10,21,0.52) 100%)"
              : "linear-gradient(to bottom, rgba(5,10,21,0.30) 0%, rgba(5,10,21,0.06) 24%, rgba(5,10,21,0.08) 56%, rgba(5,10,21,0.54) 100%)",
          }}
        />
        {!m && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              pointerEvents: "none",
              background: "linear-gradient(to right, rgba(5,10,21,0.82) 0%, rgba(5,10,21,0.56) 24%, rgba(5,10,21,0.16) 48%, transparent 66%)",
            }}
          />
        )}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background: `radial-gradient(circle at 72% 36%, rgba(37,99,235,0.12) 0%, rgba(34,211,238,0.06) 20%, transparent 46%),
              linear-gradient(135deg, rgba(34,211,238,0.04) 0%, transparent 38%)`,
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
              flexDirection: m ? "column" : "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: m ? 16 : 28,
              ...(m ? { flex: 1 } : {}),
              
            }}
          >
            <div
              style={{
                width: m ? "min(72%, 944px)" : "min(40%, 940px)",
                paddingTop: m ? 0 : 10,
              }}
            >
              <motion.img
                initial={false}
                src="/icons/spacehost-logo.svg"
                alt="SPACE HOST"
                style={{ height: m ? 26 : 30, display: "block", marginBottom: 10 }}
              />
              <div style={{ marginTop: m ? 22 : 34 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: m ? "clamp(30px, 8.5vw, 48px)" : "clamp(46px, 4.8vw, 70px)",
                    fontWeight: 900,
                    lineHeight: 1.15,
                    letterSpacing: "-0.025em",
                    color: "#F8FAFC",
                  }}
                >
                  {[
                    "다 켜놓고,",
                    "다 열어놓고 가도",
                    
                  ].map((line, index) => (
                    <div key={line} style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
                      <motion.span
                        initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                        animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }) : (reduced ? { opacity: 0 } : { opacity: 1, y: "110%" })}
                        transition={{
                          delay: reduced ? (0.2 + index * 0.08) * 0.35 : 0.2 + index * 0.12,
                          duration: reduced ? 0.22 : 0.6,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        style={{ display: "block" }}
                      >
                        {line}
                      </motion.span>
                    </div>
                  ))}

                  <div style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
                    <motion.span
                      initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
                      animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }) : (reduced ? { opacity: 0 } : { opacity: 1, y: "110%" })}
                      transition={{
                        delay: reduced ? 0.34 * 0.35 : 0.44,
                        duration: reduced ? 0.22 : 0.6,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{ display: "block", color: CYAN }}
                    >
                      <motion.span
                        whileInView={
                          reduced
                            ? {}
                            : {
                              textShadow: [
                                "0 0 0 rgba(34,211,238,0)",
                                `0 0 ${m ? 14 : 20}px rgba(34,211,238,0.30)`,
                                "0 0 0 rgba(34,211,238,0)",
                              ],
                            }
                        }
                        transition={{ duration: m ? 4.6 : 4, delay: 1.1, repeat: 0, ease: "easeInOut" }}
                      >
                        괜찮습니다.
                      </motion.span>
                    </motion.span>
                  </div>
                </h2>

              </div>
            </div>

            {/* 우측은 배경의 실제 커튼·바람(절전/환기 핵심 메시지)이 보이도록 비움
                — 합성 AirFlowLayer 제거 (배경 중복 방지) */}
          </div>

          {/* 하단: 기능 칩 row (Nunito) + KPI 카드 — Scene-5 수준 정돈, 하단 안정 배치 */}
          <div style={{ marginTop: m ? "auto" : 18, display: "flex", flexDirection: "column", gap: m ? 12 : 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: m ? 8 : 10 }}>
              {FEATURES.map((item, index) => (
                <motion.div
                  key={item.title}
                  {...entranceProps(reduced, { delay: 0.5 + index * 0.06, y: 12, duration: 0.6, amount: 0.4 })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: m ? 7 : 9,
                    background: "rgba(8,18,37,0.42)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(248,250,252,0.12)",
                    borderRadius: 999,
                    padding: m ? "7px 11px" : "9px 14px",
                    boxShadow: "0 10px 22px rgba(2,6,23,0.18)",
                  }}
                >
                  <img src={item.iconSrc} alt="" width={m ? 18 : 20} height={m ? 18 : 20} style={{ display: "block" }} />
                  <span style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 800, fontSize: m ? 12 : 13, color: "#F8FAFC", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                    {item.title}
                  </span>
                  <span style={{ fontSize: m ? 11 : 12, color: "rgba(248,250,252,0.66)", whiteSpace: "nowrap" }}>
                    {item.desc}
                  </span>
                </motion.div>
              ))}
            </div>

            <div style={{ width: m ? "100%" : "min(56%, 620px)", alignSelf: m ? "stretch" : "flex-start" }}>
              <KpiCard m={m} reduced={reduced} />
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
