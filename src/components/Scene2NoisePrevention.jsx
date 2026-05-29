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
  { iconSrc: "/icons/noise-alert.svg",        line1: "소음 감지 시",   line2: "즉시 경고"           },
  { iconSrc: "/icons/manner-mode.svg",         line1: "스스로 조성하는", line2: "매너 문화"          },
  { iconSrc: "/icons/stress-reduction.svg",    line1: "민원 예방으로",  line2: "운영 스트레스 감소" },
];

/* ─────────────────────────────────────
   소음 감지 원형 UI — CSS/HTML 레이어
   배경 이미지 위에 floating HUD 형태로 배치
   (2차에서 pulse 애니메이션 추가 예정)
───────────────────────────────────── */
function NoiseRingUI({ m }) {
  const size  = m ? 148 : 220;
  const inner = m ? 132 : 200;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>

      {/* 외부 글로우 링 */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: -16,
          borderRadius: "50%",
          boxShadow: `0 0 48px rgba(248,113,113,0.38), 0 0 96px rgba(248,113,113,0.16)`,
          pointerEvents: "none",
        }}
      />

      {/* 중간 링 — pulse 준비 (motion.div, 현재 정적) */}
      <motion.div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `1.5px solid rgba(248,113,113,0.28)`,
        }}
      />

      {/* 메인 원 */}
      <div
        style={{
          position: "absolute",
          inset: (size - inner) / 2,
          borderRadius: "50%",
          border: `3px solid rgba(248,113,113,0.85)`,
          background: "rgba(4,4,14,0.78)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: m ? 3 : 5,
        }}
      >
        {/* 상태 레이블 */}
        <div style={{
          fontSize: m ? 9 : 10,
          fontFamily: "'DM Mono', monospace",
          color: "rgba(255,255,255,0.4)",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}>소음 감지</div>

        {/* dB 수치 — Framer Motion 준비 래퍼 */}
        <motion.div style={{
          fontSize: m ? 40 : 56,
          fontWeight: 900,
          color: RED,
          fontFamily: "'DM Mono', monospace",
          lineHeight: 1,
          letterSpacing: "-0.03em",
        }}>
          72
        </motion.div>

        {/* 단위 */}
        <div style={{
          fontSize: m ? 11 : 13,
          fontFamily: "'DM Mono', monospace",
          color: `rgba(248,113,113,0.65)`,
          letterSpacing: "0.12em",
        }}>dB</div>

        {/* 경고 뱃지 */}
        <div style={{
          marginTop: m ? 2 : 4,
          background: "rgba(248,113,113,0.15)",
          border: "1px solid rgba(248,113,113,0.45)",
          borderRadius: 999,
          padding: m ? "2px 9px" : "3px 12px",
          fontSize: m ? 9 : 10,
          color: RED,
          fontWeight: 700,
          letterSpacing: "0.04em",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          <span>⚠</span>
          <span>경고 수준</span>
        </div>
      </div>

      {/* 하단 레이블 */}
      <div style={{
        position: "absolute",
        bottom: m ? -22 : -28,
        left: "50%",
        transform: "translateX(-50%)",
        fontSize: m ? 9 : 10,
        fontFamily: "'DM Mono', monospace",
        color: "rgba(255,255,255,0.32)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}>
        거실 · 감지 중
      </div>
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
      background: "rgba(255,255,255,0.06)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: m ? 12 : 14,
      padding: m ? "10px 12px" : "14px 16px",
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{
        width: m ? 36 : 44,
        height: m ? 36 : 44,
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
          fontSize: m ? 10 : 11,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>{line1}</div>
        <div style={{
          fontSize: m ? 12 : 13,
          fontWeight: 700,
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
      fontSize: m ? "clamp(28px, 8vw, 44px)" : "clamp(42px, 4.4vw, 64px)",
      fontWeight: 900,
      lineHeight: 1.15,
      margin: m ? 0 : "0 0 28px",
      letterSpacing: "-0.025em",
    }}>
      {COPY_LINES.map((line) => (
        /* overflow:hidden + motion.span = 2차 마스크 리빌 준비 구조 */
        <div key={line.text} style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
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
          justifyContent: "space-between",
          minHeight: m ? "100svh" : "100vh",
          padding: m ? "28px 20px 48px" : "52px 60px 60px",
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
        <div>
          {/* PC: 헤드라인은 하단 블록 상단 */}
          {!m && <HeadlineBlock m={m} />}

          {/* 모바일: NoiseRing + 기능 아이콘 나란히 */}
          {m && (
            <div style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              marginBottom: 28,
            }}>
              <NoiseRingUI m={m} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {FEATURES.map((f) => (
                  <FeaturePill key={f.line2} {...f} m={m} />
                ))}
              </div>
            </div>
          )}

          {/* PC: 기능 아이콘 가로 배열 */}
          {!m && (
            <div style={{ display: "flex", gap: 14 }}>
              {FEATURES.map((f) => (
                <FeaturePill key={f.line2} {...f} m={false} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ════════════════ PC 전용: NoiseRing 우측 절대 배치 ════════════════ */}
      {!m && (
        <div style={{
          position: "absolute",
          right: 80,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 2,
        }}>
          <NoiseRingUI m={false} />
        </div>
      )}

    </section>
  );
}
