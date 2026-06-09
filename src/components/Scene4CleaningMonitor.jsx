/**
 * Scene4CleaningMonitor — 청소 현황 실시간 파악
 *
 * 레이어 구조:
 *   z:0  배경 이미지 (picture · object-fit:cover)
 *   z:1  그래디언트 오버레이 (가독성 + 인물 노출 창)
 *   z:2  콘텐츠 (브랜드 · 카피 · 기능 아이콘)
 *   z:3  센서 비컨 레이어 (현관 / 천장 감지 시각화)
 *   z:4  Activity Timeline (glass card, 독립 레이어)
 *
 * 2차 목표:
 *   - 배경 settle
 *   - 카피 stagger
 *   - 센서 ripple
 *   - 타임라인 순차 등장 + 노드 pulse
 *   - scroll exit transform
 */

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  useInView,
} from "framer-motion";

/* ── 모바일 감지 ── */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => globalThis.window !== undefined && globalThis.window.innerWidth <= 768,
  );
  useEffect(() => {
    const h = () => setMobile(globalThis.window.innerWidth <= 768);
    globalThis.window.addEventListener("resize", h);
    return () => globalThis.window.removeEventListener("resize", h);
  }, []);
  return mobile;
}

function revealInView(reduced, {
  delay = 0,
  x = 0,
  y = 18,
  scale = 1,
  duration = 0.7,
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

/* ── 색상 토큰 ── */
const BLUE = "#60a5fa";
const BLUE_SOFT = "rgba(96,165,250,0.42)";
const GREEN = "#34d399";
const TIMELINE_NODE_SRC = "/icons/timeline-node.svg";
/* ── 정적 데이터 ── */
const FEATURES = [
  { iconSrc: "/icons/checkin-record.svg", line1: "현관 출입 기록", line2: "자동 저장" },
  { iconSrc: "/icons/staff-detection.svg", line1: "청소 담당자 활동", line2: "실시간 감지" },
  { iconSrc: "/icons/trusted-operation.svg", line1: "신뢰할 수 있는", line2: "운영 관리" },
];

const COPY_LINES = [
  { key: "line-1", text: "청소 누락, 지각 걱정없이" },
  { key: "line-2", accent: "실시간 현황을", suffix: "" },
  { key: "line-3", text: "확인 하세요" },
];

const TIMELINE = [
  {
    time: "10:30 AM",
    label: "Guest Checked Out",
    status: "blue",
  },
  {
    time: "11:30 AM",
    label: "Cleaning Started",
    status: "green",
  },
  {
    time: "2:30 PM",
    label: "Cleaning Completed",
    status: "check",
  },
];

const SENSOR_POSITIONS = {
  mobile: [
    {
      key: "ceiling",
      iconSrc: "/icons/motion-sensor.svg",
      label: "Ceiling Sensor",
      hint: "activity wave",
      top: "20%",
      left: "70%",
    },
    {
      key: "door",
      iconSrc: "/icons/door-sensor.svg",
      label: "Door Sensor",
      hint: "entry log",
      top: "49%",
      left: "82%",
    },
  ],
  desktop: [
    {
      key: "ceiling",
      iconSrc: "/icons/motion-sensor.svg",
      label: "Ceiling Sensor",
      hint: "activity wave",
      top: "17%",
      left: "70%",
    },
    {
      key: "door",
      iconSrc: "/icons/door-sensor.svg",
      label: "Door Sensor",
      hint: "entry log",
      top: "52%",
      left: "64%",
    },
  ],
};

const timelineVariants = (reduced) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: reduced ? 0.08 : 0.2,
      delayChildren: reduced ? 0.1 : 0.22,
    },
  },
});

const timelineItemVariants = (reduced) => (
  reduced
    ? {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.24 } },
    }
    : {
      hidden: { opacity: 0, y: 20 },
      visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
      },
    }
);

/* ─────────────────────────────────────
   센서 비컨 레이어
───────────────────────────────────── */
function SensorBeacon({ sensor, m, reduced, index }) {
  const ringSize = m ? 52 : 62;

  return (
    <div
      style={{
        position: "absolute",
        top: sensor.top,
        left: sensor.left,
        transform: "translate(-50%, -50%)",
        zIndex: 3,
        pointerEvents: "none",
      }}
    >
      <motion.div
        {...revealInView(reduced, { delay: 0.28 + index * 0.16, y: 14, scale: 0.96 })}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
      >
        <div style={{ position: "relative", width: ringSize, height: ringSize }}>
          {[0, 1].map((ripple) => (
            <motion.div
              key={ripple}
              whileInView={
                reduced
                  ? {}
                  : { scale: [0.88, 1.75], opacity: [0.28, 0] }
              }
              transition={{
                duration: 2.6,
                delay: ripple * 1.15,
                repeat: 0,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "1px solid rgba(96,165,250,0.42)",
                background: "radial-gradient(circle, rgba(96,165,250,0.18) 0%, rgba(96,165,250,0.04) 45%, transparent 72%)",
              }}
            />
          ))}

          <motion.div
            whileInView={reduced ? {} : { scale: [1, 1.06, 1] }}
            transition={{ duration: 2.8, repeat: 0, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: m ? 8 : 10,
              borderRadius: "50%",
              background: "rgba(6,8,14,0.62)",
              border: "1px solid rgba(255,255,255,0.14)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 26px rgba(96,165,250,0.18)",
            }}
          >
            <img
              src={sensor.iconSrc}
              alt={sensor.label}
              width={m ? 20 : 24}
              height={m ? 20 : 24}
              style={{ display: "block" }}
            />
          </motion.div>
        </div>

        {!m && (
          <div style={{
            background: "rgba(6,8,14,0.44)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 999,
            padding: "7px 12px",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 12px 24px rgba(0,0,0,0.18)",
            textAlign: "center",
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}>
              {sensor.label}
            </div>
            <div style={{
              marginTop: 2,
              fontSize: 9,
              color: "rgba(255,255,255,0.55)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              {sensor.hint}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ─────────────────────────────────────
   Activity Timeline — Glass Card
───────────────────────────────────── */
function TimelineItem({ item, index, isLast, m, reduced }) {
  const palette = (
    item.status === "green"
      ? {
        node: GREEN,
        nodeFill: "rgba(52,211,153,0.18)",
        line: "rgba(52,211,153,0.28)",
        time: "rgba(52,211,153,0.82)",
        glow: "0 0 18px rgba(52,211,153,0.22)",
      }
      : {
        node: BLUE,
        nodeFill: item.status === "check" ? "rgba(96,165,250,0.22)" : "rgba(96,165,250,0.14)",
        line: "rgba(96,165,250,0.22)",
        time: "rgba(255,255,255,0.62)",
        glow: item.status === "check" ? "0 0 24px rgba(96,165,250,0.34)" : "0 0 14px rgba(96,165,250,0.18)",
      }
  );

  const nodeSize = item.status === "check"
    ? (m ? 18 : 20)
    : item.status === "green"
      ? (m ? 12 : 14)
      : (m ? 14 : 16);
  const usesSvgNode = item.status !== "green";

  return (
    <motion.div
      variants={timelineItemVariants(reduced)}
      style={{ display: "flex", gap: m ? 10 : 14 }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <motion.div
          whileInView={
            reduced
              ? {}
              : {
                scale: item.status === "check" ? [1, 1.14, 1] : [1, 1.1, 1],
                boxShadow: [palette.glow, item.status === "check" ? "0 0 32px rgba(96,165,250,0.42)" : palette.glow, palette.glow],
              }
          }
          transition={{
            duration: 2,
            delay: reduced ? 0 : index * 0.12,
            repeat: 0,
            ease: "easeInOut",
          }}
          style={{
            width: nodeSize,
            height: nodeSize,
            borderRadius: "50%",
            background: usesSvgNode ? "transparent" : palette.nodeFill,
            border: usesSvgNode ? "none" : `1.5px solid ${palette.node}`,
            boxShadow: palette.glow,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 4,
            flexShrink: 0,
            position: "relative",
          }}
        >
          {usesSvgNode && (
            <img
              src={TIMELINE_NODE_SRC}
              alt=""
              aria-hidden="true"
              width={nodeSize}
              height={nodeSize}
              style={{
                display: "block",
                filter: item.status === "check"
                  ? "drop-shadow(0 0 8px rgba(96,165,250,0.42))"
                  : "drop-shadow(0 0 6px rgba(96,165,250,0.26))",
              }}
            />
          )}
          {item.status === "check" && (
            <div style={{
              position: "absolute",
              width: m ? 7 : 8,
              height: m ? 4 : 5,
              borderLeft: "2px solid #fff",
              borderBottom: "2px solid #fff",
              transform: "translateY(-1px) rotate(-45deg)",
            }} />
          )}
        </motion.div>

        {!isLast && (
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0.3, scaleY: 0 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, scaleY: 1 }}
            viewport={{ once: true, amount: 0.65 }}
            transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.18 + index * 0.18 }}
            style={{
              width: 2,
              flex: 1,
              minHeight: m ? 28 : 44,
              background: `linear-gradient(to bottom, ${palette.line}, rgba(255,255,255,0.06))`,
              margin: "6px 0",
              borderRadius: 1,
              transformOrigin: "top",
            }}
          />
        )}
      </div>

      <div style={{ paddingBottom: isLast ? 0 : (m ? 10 : 20), minWidth: 0 }}>
        <div style={{ marginBottom: m ? 4 : 8 }}>
          <div style={{
            fontSize: m ? 9 : 11,
            fontFamily: "'DM Mono', monospace",
            color: palette.time,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: m ? 2 : 4,
          }}>
            {item.time}
          </div>
          <div style={{
            fontSize: m ? 12 : 15,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1.35,
          }}>
            {item.label}
          </div>
        </div>

        <div style={{
          fontSize: m ? 11 : 12,
          color: "rgba(255,255,255,0.52)",
          lineHeight: 1.55,
          maxWidth: m ? 220 : 232,
        }}>
          {!m && item.note}
        </div>
      </div>
    </motion.div>
  );
}

function ActivityTimeline({ m, reduced }) {
  return (
    <motion.div
      {...revealInView(reduced, {
        delay: m ? 0.26 : 0.34,
        x: m ? 0 : 18,
        y: 24,
        scale: 0.98,
        duration: 0.6,
      })}
      whileHover={reduced ? undefined : { y: -4, scale: 1.01 }}
      style={{
        background: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: m ? 20 : 28,
        padding: m ? "10px 10px 8px" : "16px 15px 12px",
        width: m ? "fit-content" : "fit-content",
        minWidth: m ? 0 : 150,
        maxWidth: m ? "min(58vw, 214px)" : 268,
        boxSizing: "border-box",
        boxShadow: m ? "0 14px 36px rgba(0,0,0,0.22)" : "0 18px 54px rgba(0,0,0,0.26)",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: m ? 14 : 16,
        paddingBottom: m ? 10 : 12,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{
            width: m ? 22 : 24,
            height: m ? 32 : 34,
            borderRadius: m ? 12 : 14,
            background: "rgba(96,165,250,0.12)",
            border: "1px solid rgba(96,165,250,0.24)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <img
              src="/icons/trusted-operation.svg"
              alt="Trusted operation"
              width={m ? 18 : 18}
              height={m ? 18 : 18}
              style={{ display: "block" }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: m ? 10 : 11,
              color: BLUE_SOFT,
              fontFamily: "'DM Mono', monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: m ? 3 : 5,
            }}>
              In/Out Log
            </div>
            <div style={{
              fontSize: m ? 11 : 12,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              lineHeight: 1.35,
            }}>
              
            </div>
          </div>
        </div>

        {!m && (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            padding: "5px 10px",
            background: "rgba(52,211,153,0.12)",
            border: "1px solid rgba(52,211,153,0.28)",
            flexShrink: 0,
          }}>
            <motion.div
              whileInView={reduced ? {} : { opacity: [0.55, 1, 0.55], scale: [1, 1.15, 1] }}
              transition={{ duration: 1.8, repeat: 0, ease: "easeInOut" }}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: GREEN,
              }}
            />
            <span style={{
              fontSize: 10,
              color: GREEN,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}>
              LIVE
            </span>
          </div>
        )}
      </div>

      <motion.div
        variants={timelineVariants(reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.55 }}
      >
        {TIMELINE.map((item, index) => (
          <TimelineItem
            key={item.label}
            item={item}
            index={index}
            isLast={index === TIMELINE.length - 1}
            m={m}
            reduced={reduced}
          />
        ))}
      </motion.div>

      {!m && (
        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}>
          {["Sensor-Based Detection", "Privacy Friendly"].map((text) => (
            <div
              key={text}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                borderRadius: 999,
                padding: "6px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: text === "Privacy Friendly" ? GREEN : BLUE,
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.68)",
                letterSpacing: "0.03em",
              }}>
                {text}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────
   기능 아이콘 필
───────────────────────────────────── */
function FeaturePill({ iconSrc, line1, line2, m, reduced, index }) {
  return (
    <motion.div
      {...revealInView(reduced, {
        delay: 0.42 + index * 0.1,
        y: 16,
        scale: 0.98,
        duration: 0.6,
      })}
      whileHover={reduced ? undefined : { y: -3, scale: 1.015 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: m ? 10 : 12,
        background: m ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.06)",
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: m ? 12 : 14,
        padding: m ? "9px 10px" : "13px 16px",
        minWidth: 0,
        boxShadow: "0 12px 24px rgba(0,0,0,0.10)",
      }}
    >
      <motion.div
        whileInView={reduced ? {} : { boxShadow: ["0 0 0 rgba(96,165,250,0)", "0 0 22px rgba(96,165,250,0.18)", "0 0 0 rgba(96,165,250,0)"] }}
        transition={{ duration: 4.2, delay: index * 0.28, repeat: 0, ease: "easeInOut" }}
        style={{
          width: m ? 32 : 44,
          height: m ? 32 : 44,
          flexShrink: 0,
          borderRadius: m ? 10 : 12,
          background: "rgba(96,165,250,0.1)",
          border: "1px solid rgba(96,165,250,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={iconSrc}
          alt={line2}
          width={m ? 26 : 32}
          height={m ? 26 : 32}
          style={{ display: "block" }}
        />
      </motion.div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: m ? 9 : 11,
          color: "rgba(255,255,255,0.42)",
          marginBottom: 2,
        }}>
          {line1}
        </div>
        <div style={{
          fontFamily: "'Nunito', sans-serif",
          fontSize: m ? 11.5 : 13,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          color: "#fff",
          lineHeight: 1.3,
        }}>
          {line2}
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────
   카피 블록
───────────────────────────────────── */
function CopyBlock({ m, reduced, inView }) {
  const headSize = m ? "clamp(28px, 7.6vw, 42px)" : "clamp(42px, 4.4vw, 64px)";

  return (
    <div style={{ margin: m ? "12px 0 0" : "0 0 30px", maxWidth: m ? "min(100%, 350px)" : 560 }}>
      {COPY_LINES.map((line, index) => (
        <div key={line.key} style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 1, y: "110%" }}
            animate={inView ? (reduced ? { opacity: 1 } : { opacity: 1, y: "0%" }) : (reduced ? { opacity: 0 } : { opacity: 1, y: "110%" })}
            transition={{
              delay: reduced ? (0.12 + index * 0.08) * 0.35 : 0.12 + index * 0.11,
              duration: reduced ? 0.22 : 0.6,
              ease: [0.16, 1, 0.3, 1],
            }}
            style={{
              fontSize: headSize,
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: "-0.025em",
              color: "#fff",
              whiteSpace: m ? "nowrap" : "normal",
            }}
          >
            {line.accent ? (
              <span style={{ display: "block" }}>
                <motion.span
                  whileInView={reduced ? {} : { textShadow: ["0 0 0 rgba(34,211,238,0)", "0 0 22px rgba(34,211,238,0.28)", "0 0 0 rgba(34,211,238,0)"] }}
                  transition={{ duration: 4.4, delay: 1, repeat: 0, ease: "easeInOut" }}
                  style={{ color: "#22d3ee" }}
                >
                  {line.accent}
                </motion.span>
                <span style={{ color: "#fff" }}>{line.suffix}</span>
              </span>
            ) : (
              <span style={{ display: "block" }}>{line.text}</span>
            )}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

function EffectCard({ m, reduced }) {
  return (
    <motion.div
      {...revealInView(reduced, { delay: 0.54, y: 14, duration: 0.6, amount: 0.7 })}
      style={{
        marginTop: m ? 12 : 16,
        width: m ? "100%" : "min(100%, 560px)",
        background: "rgba(8,18,37,0.44)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: "1px solid rgba(248,250,252,0.10)",
        borderRadius: m ? 16 : 18,
        padding: m ? "12px 14px" : "14px 16px",
        boxShadow: "0 18px 36px rgba(2,6,23,0.22)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
        <img
          src="/icons/value-badge-gold.svg"
          alt=""
          role="presentation"
          style={{ width: m ? 30 : 36, height: m ? 30 : 36, flexShrink: 0 }}
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
          상태를 추적하는 청소 기록 모드
        </div>
      </div>
      
    </motion.div>
  );
}

/* ─────────────────────────────────────
   Scene4CleaningMonitor 메인 컴포넌트
───────────────────────────────────── */
export default function Scene4CleaningMonitor() {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const visibleFeatures = m ? [] : FEATURES;
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { amount: 0.2, once: true });
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const exitOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);
  const exitScale = useTransform(scrollYProgress, [0, 1], [1, 0.97]);
  const exitY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const sensors = m ? SENSOR_POSITIONS.mobile : SENSOR_POSITIONS.desktop;

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        minHeight: m ? "100svh" : "92vh",
        overflow: "hidden",
        background: "#06080e",
      }}
    >
      <motion.div
        style={{
          position: "relative",
          minHeight: m ? "100svh" : "92vh",
          opacity: reduced ? 1 : exitOpacity,
          scale: reduced ? 1 : exitScale,
          y: reduced ? 0 : exitY,
          willChange: "transform, opacity",
        }}
      >
        {/* ════════ Layer 0 · 배경 이미지 ════════ */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}
        >
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 1, scale: 1.03 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.55 }}
            transition={{ duration: reduced ? 0.28 : 1.35, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: "absolute", inset: 0, willChange: "transform, opacity" }}
          >
            <picture style={{ display: "block", width: "100%", height: "100%" }}>
              <source media="(max-width: 768px)" srcSet="/images/scene-4-mobile-bg.png" />
              <img
                src="/images/scene-4-desktop-bg.png"
                alt=""
                role="presentation"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: m ? "center 35%" : "center",
                  display: "block",
                }}
              />
            </picture>
          </motion.div>
        </div>

        {/* ════════ Layer 1 · 그래디언트 오버레이 ════════ */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background: m
              ? "linear-gradient(to bottom, rgba(6,8,14,0.88) 0%, rgba(6,8,14,0.14) 26%, rgba(6,8,14,0.0) 42%, rgba(6,8,14,0.0) 60%, rgba(6,8,14,0.48) 74%, rgba(6,8,14,0.76) 90%, rgba(6,8,14,0.88) 100%)"
              : "linear-gradient(to bottom, rgba(6,8,14,0.72) 0%, rgba(6,8,14,0.0) 28%, rgba(6,8,14,0.0) 55%, rgba(6,8,14,0.88) 100%)",
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
              background: "linear-gradient(to right, rgba(6,8,14,0.92) 0%, rgba(6,8,14,0.68) 26%, rgba(6,8,14,0.22) 50%, transparent 68%)",
            }}
          />
        )}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "28%",
            zIndex: 1,
            pointerEvents: "none",
            background: "linear-gradient(to top, rgba(96,165,250,0.06) 0%, transparent 100%)",
          }}
        />

        {/* ════════ Layer 2 · 센서 비컨 ════════ */}
        {sensors.map((sensor, index) => (
          <SensorBeacon
            key={sensor.key}
            sensor={sensor}
            m={m}
            reduced={reduced}
            index={index}
          />
        ))}

        {/* ════════ Layer 3 · 콘텐츠 ════════ */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            justifyContent: m ? "flex-start" : "space-between",
            minHeight: m ? "100svh" : "92vh",
            padding: m ? "24px 20px 28px" : "52px 60px 60px",
            ...(m ? {} : { maxWidth: 640 }),
          }}
        >
          <motion.header initial={false}>
            <img
              src="/icons/spacehost-logo.svg"
              alt="SPACE HOST"
              style={{ height: m ? 26 : 30, display: "block", marginBottom: 8 }}
            />
          </motion.header>

          {m && <CopyBlock m={m} reduced={reduced} inView={inView} />}

          <div style={{ marginTop: m ? "auto" : 0 }}>
            {!m && <CopyBlock m={m} reduced={reduced} inView={inView} />}

          {m && (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-start" }}>
                <ActivityTimeline m={m} reduced={reduced} />
              </div>
            </>
          )}

            {visibleFeatures.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 14,
                alignItems: "stretch",
              }}>
                {visibleFeatures.map((feature, index) => (
                  <FeaturePill
                    key={feature.line2}
                    {...feature}
                    m={m}
                    reduced={reduced}
                    index={index}
                  />
                ))}
              </div>
            )}
            <EffectCard m={m} reduced={reduced} />
          </div>
        </div>

        {/* ════════ Layer 4 · Activity Timeline (PC 우측 절대 배치) ════════ */}
        {!m && (
          <div style={{
            position: "absolute",
            right: 570,
            bottom: 58,
            zIndex: 4,
          }}>
            <ActivityTimeline m={false} reduced={reduced} />
          </div>
        )}
      </motion.div>
    </section>
  );
}
