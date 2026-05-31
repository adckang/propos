/**
 * Scene2NoisePrevention — 소음 방어 씬 (레이어 분리형)
 *
 * 레이어:
 *   z:0  배경 이미지 (picture · object-fit:cover)
 *   z:1  그래디언트 오버레이 (가독성 + 인물 노출 창)
 *   z:2  콘텐츠 (브랜드 · 카피 · NoiseRingUI · 기능 아이콘)
 *
 * 1차 목표: 정적 레이아웃 완성도 (애니메이션 준비 구조 포함, 실행 없음)
 * 2차: Framer Motion 애니메이션 추가 예정
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/* ── 모바일 감지 (768px 기준) ── */
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

/* ── 색상 토큰 ── */
const RED   = "#f87171";
const ORANGE = "#fb923c";
const CYAN  = "#22d3ee";

/* ── 정적 데이터 ── */
const COPY_LINES = [
  { text: "소음 민원,",         accent: false },
  { text: "발생하면 늦습니다.", accent: false },
  { text: "예방이 필수입니다.", accent: true  },
];

const FEATURES = [
  { iconSrc: "/icons/noise-alert.svg",        line1: "매너시간",   line2: "소음 발생 센싱하여 손님에게 자동 안내"   },
  { iconSrc: "/icons/manner-mode.svg",         line1: "적정소음", line2: "손님 스스로 파악 가능한 친절한 가이드"          },
  { iconSrc: "/icons/stress-reduction.svg",    line1: "민원 예방으로",  line2: "운영 스트레스 감소" },
];

/* ─────────────────────────────────────
   소음 경고 슬림 핀 (dB Pill)
   기존 큰 원형 HUD → 배경의 실제 빨간 디바이스와 중복되어
   Scene-1 "1줄 카드" 무게의 슬림 핀으로 축소.
   소음 dB 수치는 Scene-2의 정체성이므로 유지.
───────────────────────────────────── */
function DbPill({ m }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: m ? 9 : 11,
      background: "rgba(4,4,14,0.42)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      border: "1px solid rgba(248,113,113,0.4)",
      borderRadius: 999,
      padding: m ? "8px 14px" : "10px 18px",
      boxShadow: "0 0 22px rgba(248,113,113,0.16)",
      alignSelf: "flex-start",
    }}>
      {/* 경고 도트 (정적) */}
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: RED, boxShadow: `0 0 8px ${RED}`, flexShrink: 0,
      }} />
      {/* dB 수치 — Scene-2 정체성 */}
      <span style={{
        fontFamily: "'DM Mono', monospace", fontWeight: 900,
        fontSize: m ? 18 : 22, color: RED,
        letterSpacing: "-0.02em", lineHeight: 1,
      }}>
        72<span style={{ fontSize: m ? 11 : 13, marginLeft: 2, fontWeight: 700 }}>dB</span>
      </span>
      {/* 구분선 */}
      <span style={{ width: 1, height: m ? 14 : 18, background: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
      {/* 라벨 */}
      <span style={{ fontSize: m ? 12 : 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
        경고 수준 감지
      </span>
    </div>
  );
}

/* ─────────────────────────────────────
   기능 아이콘 필 (3개 항목)
───────────────────────────────────── */
function FeaturePill({ iconSrc, line1, line2, m }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: m ? 10 : 12,
      background: m ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.06)",
      backdropFilter: "blur(11px)",
      WebkitBackdropFilter: "blur(11px)",
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: m ? 12 : 14,
      padding: m ? "9px 11px" : "14px 16px",
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{
        width: m ? 32 : 44,
        height: m ? 32 : 44,
        flexShrink: 0,
        borderRadius: m ? 10 : 12,
        background: "rgba(248,113,113,0.1)",
        border: "1px solid rgba(248,113,113,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <img
          src={iconSrc}
          alt={line2}
          width={m ? 26 : 32}
          height={m ? 26 : 32}
          style={{ display: "block" }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: m ? 9 : 11,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>{line1}</div>
        <div style={{
          fontFamily: "'Nunito', sans-serif",
          fontSize: m ? 11.5 : 13,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          color: "#fff",
          lineHeight: 1.3,
        }}>{line2}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────
   헤드라인 블록
   mobile: 독립 flex item (3-way layout)
   desktop: 하단 콘텐츠 블록 내부
   (2차: 마스크 리빌 애니메이션 추가 예정)
───────────────────────────────────── */
function HeadlineBlock({ m }) {
  return (
    <h2 style={{
      fontSize: m ? "clamp(30px, 8.5vw, 48px)" : "clamp(46px, 4.8vw, 70px)",
      fontWeight: 900,
      lineHeight: 1.15,
      margin: m ? "30px 0 0" : "-28px 0 24px",
      letterSpacing: "-0.025em",
      maxWidth: m ? "min(100%, 394px)" : 560,
    }}>
      {COPY_LINES.map((line) => (
        /* overflow:hidden + motion.span = 2차 마스크 리빌 준비 구조 */
        <div key={line.text} style={{ overflow: "hidden", paddingBottom: "0.1em" }}>
          <motion.span style={{
            display: "block",
            color: line.accent ? CYAN : "#fff",
          }}>
            {line.text}
          </motion.span>
        </div>
      ))}
    </h2>
  );
}

/* ─────────────────────────────────────
   Scene2NoisePrevention 메인 컴포넌트
───────────────────────────────────── */
export default function Scene2NoisePrevention() {
  const m = useIsMobile();
  const visibleFeatures = m ? FEATURES.slice(0, 3) : FEATURES;

  return (
    <section
      style={{
        position: "relative",
        minHeight: m ? "100svh" : "100vh",
        overflow: "hidden",
        background: "#060204",
      }}
    >

      {/* ════════════════ Layer 0 · 배경 이미지 ════════════════ */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      >
        <picture style={{ display: "block", width: "100%", height: "100%" }}>
          <source media="(max-width: 768px)" srcSet="/images/scene-2-mobile-bg.png" />
          <img
            src="/images/scene-2-desktop-bg.png"
            alt=""
            role="presentation"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: m ? "center 30%" : "center",
              display: "block",
            }}
          />
        </picture>
      </div>

      {/* ════════════════ Layer 1 · 그래디언트 오버레이 ════════════════ */}
      {/* 상하 그래디언트 — 상단(로고+텍스트)·하단(기능) 가독성, 중단에 인물 노출 창 */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          background: m
            ? "linear-gradient(to bottom, rgba(4,2,6,0.86) 0%, rgba(4,2,6,0.18) 26%, rgba(4,2,6,0.0) 40%, rgba(4,2,6,0.0) 62%, rgba(4,2,6,0.45) 75%, rgba(4,2,6,0.72) 90%, rgba(4,2,6,0.84) 100%)"
            : "linear-gradient(to bottom, rgba(4,2,6,0.70) 0%, rgba(4,2,6,0.0) 30%, rgba(4,2,6,0.0) 55%, rgba(4,2,6,0.82) 100%)",
        }}
      />
      {/* PC 전용 — 좌측 콘텐츠 영역 어둡게, 우측 인물/장면 노출 */}
      {!m && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "linear-gradient(to right, rgba(4,2,6,0.92) 0%, rgba(4,2,6,0.72) 28%, rgba(4,2,6,0.24) 52%, transparent 70%)",
          }}
        />
      )}
      {/* 적색 경고 바이브 — 하단 엣지 글로우 */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "30%",
          zIndex: 1,
          pointerEvents: "none",
          background:
            "linear-gradient(to top, rgba(248,113,113,0.08) 0%, transparent 100%)",
        }}
      />

      {/* ════════════════ Layer 2 · 콘텐츠 ════════════════ */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          justifyContent: m ? "flex-start" : "space-between",
          minHeight: m ? "100svh" : "100vh",
          padding: m ? "18px 20px 28px" : "52px 60px 60px",
          ...(m ? {} : { maxWidth: 680 }),
        }}
      >

        {/* ── 브랜드 헤더 (motion.header = 2차 entrance 준비) ── */}
        <motion.header>
          <img
            src="/icons/spacehost-logo.svg"
            alt="SPACE HOST"
            style={{ height: m ? 26 : 30, display: "block", marginBottom: 8 }}
          />
          <p style={{
            margin: 0,
            fontSize: m ? 10 : 11,
            color: "rgba(255,255,255,0.38)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono', monospace",
          }}>
            Smart. Carefree. Anywhere.
          </p>
        </motion.header>

        {/* ── 모바일: 헤드라인 독립 flex item (3-way space-between) ── */}
        {m && <HeadlineBlock m={m} />}

        {/* ── 하단 콘텐츠 블록 ── */}
        <div style={{ marginTop: m ? "auto" : 0 }}>
          {/* PC: 헤드라인은 하단 블록 상단 */}
          {!m && <HeadlineBlock m={m} />}

          {/* 모바일: dB 슬림핀(정체성) + 기능 아이콘 (Scene-1 구조: 카드 1개 + 아이콘) */}
          {m && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginBottom: 30,
            }}>
              <DbPill m={m} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleFeatures.map((f) => (
                  <FeaturePill key={f.line2} {...f} m={m} />
                ))}
              </div>
            </div>
          )}

          {/* PC: dB 슬림핀 + 기능 아이콘 가로 배열 */}
          {!m && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <DbPill m={false} />
              <div style={{ display: "flex", gap: 14 }}>
                {visibleFeatures.map((f) => (
                  <FeaturePill key={f.line2} {...f} m={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </section>
  );
}
