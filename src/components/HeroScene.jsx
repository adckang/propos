/**
 * HeroScene — scene-01 레이어 분리형 히어로
 *
 * 레이어:
 *   z:0  배경 이미지 (picture · object-fit:cover · scale settle 애니메이션)
 *   z:1  그래디언트 오버레이 (정적)
 *   z:2  콘텐츠 (브랜드 · 카피 · 아이콘 · 통계 카드)
 *
 * 애니메이션 원칙:
 *   - transform / opacity 만 사용, layout 속성(width,height,top,left) 변경 없음
 *   - blur 은 정적 적용 (filter 애니메이션은 compositor thrash 유발)
 *   - useReducedMotion = true 이면 opacity-only + 단축 딜레이
 *   - 모바일은 y/x 진폭을 PC의 50%로 축소
 *   - 스크롤 exit: opacity·y·scale MotionValue, 정적값과 타입 불일치 없도록 조건 분기
 *
 * CLS 방지: section minHeight 명시, 이미지 wrapper 는 position:absolute
 */

import { useRef, useEffect, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";

/* ─────────────────────────────────────
   모바일 감지 (768px 기준)
───────────────────────────────────── */
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

/* ─────────────────────────────────────
   Entrance 애니메이션 props 생성 헬퍼
   framer-motion motion.* 컴포넌트에 스프레드하여 사용
   { initial, animate, transition } 반환

   reduced=true  → opacity 만, delay 35% 단축
   mobile=true   → y/x 진폭 50% 축소
───────────────────────────────────── */
function entrance(delay, {
  yFrom = 0,
  xFrom = 0,
  duration = 0.65,
  reduced = false,
  mobile = false,
} = {}) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.22, delay: delay * 0.35 },
    };
  }
  const yAmp = mobile ? 0.5 : 1;
  const xAmp = mobile ? 0.5 : 1;
  return {
    initial: {
      opacity: 0,
      ...(yFrom !== 0 && { y: yFrom * yAmp }),
      ...(xFrom !== 0 && { x: xFrom * xAmp }),
    },
    animate: {
      opacity: 1,
      ...(yFrom !== 0 && { y: 0 }),
      ...(xFrom !== 0 && { x: 0 }),
    },
    transition: { duration, delay, ease: [0.22, 1, 0.36, 1] },
  };
}

/* ─────────────────────────────────────
   기능 아이콘 필 (img 태그로 아이콘 분리)
───────────────────────────────────── */
function FeaturePill({ iconSrc, label, sublabel }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        minWidth: 52,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          background: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {/* SVG/img 태그로 분리 — 이미지 안에 그래픽 포함 금지 */}
        <img src={iconSrc} alt={label} width={22} height={22} style={{ display: "block" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", textAlign: "center", lineHeight: 1.3 }}>
        {label}
      </span>
      
        <span style={{ fontSize: 12, color: "#22d3ee", textAlign: "center", lineHeight: 1.3 }}>
        
        {sublabel}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────
   파란 웨이브 구분선 서브컴포넌트 (CSS only, 이미지 없음)
   메인 라인: 정적
   글로우 레이어: opacity + scaleX pulse (reduced=true 시 정지)
   HeroScene에서 분리 → cognitive complexity -1
───────────────────────────────────── */
function WaveLine({ reduced }) {
  return (
    <div
      aria-hidden="true"
      style={{ position: "relative", height: 14, margin: "0 0 20px" }}
    >
      {/* 정적 메인 라인 */}
      <div
        style={{
          position: "absolute",
          top: 5,
          left: 0,
          right: 0,
          height: 1.5,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.45) 10%, rgba(34,211,238,0.9) 50%, rgba(34,211,238,0.45) 90%, transparent 100%)",
          borderRadius: 999,
        }}
      />
      {/* 펄스 글로우 레이어
          blur 는 정적 (blur 애니메이션 → compositor thrash 방지)
          reduced=true : animate={} → 정지 */}
      <motion.div
        animate={
          reduced
            ? {}
            : { opacity: [0.18, 0.52, 0.18], scaleX: [0.82, 1, 0.82] }
        }
        transition={{ duration: 2.8, delay: 0.65, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          top: 1,
          left: "6%",
          right: "6%",
          height: 9,
          background:
            "linear-gradient(90deg, transparent, rgba(34,211,238,0.3), transparent)",
          borderRadius: 999,
          filter: "blur(4px)",
          transformOrigin: "center",
          opacity: 0.18,
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────
   그래디언트 오버레이 서브컴포넌트
   HeroScene에서 분리 → cognitive complexity 절감
───────────────────────────────────── */
function GradientOverlays({ m }) {
  return (
    <>
      {/* 상하 그래디언트 — 상단/하단 텍스트 가독성 */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          /* 모바일: 인물이 있는 40-65% 구간을 투명하게 열어둠
             상단(로고+헤드라인)·하단(기능+통계+CTA) 은 가독성 위해 어둡게 */
          background: m
            ? "linear-gradient(to bottom, rgba(2,6,23,0.82) 0%, rgba(2,6,23,0.22) 30%, rgba(2,6,23,0.0) 40%, rgba(2,6,23,0.0) 65%, rgba(2,6,23,0.38) 75%, rgba(2,6,23,0.62) 88%, rgba(2,6,23,0.78) 100%)"
            : "linear-gradient(to bottom, rgba(2,6,23,0.65) 0%, rgba(2,6,23,0.0) 28%, rgba(2,6,23,0.0) 48%, rgba(2,6,23,0.72) 78%, rgba(2,6,23,0.97) 100%)",
        }}
      />
      {/* PC 전용 — 좌측 카피 영역 어둡게 */}
      {!m && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "linear-gradient(to right, rgba(2,6,23,0.85) 0%, rgba(2,6,23,0.62) 28%, rgba(2,6,23,0.18) 52%, transparent 72%)",
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────
   헤드라인 마스크 리빌 서브컴포넌트
   mobile: 외부 flex child (3-way layout) → 인물이 보이는 중단 공간 확보
   desktop: 하단 콘텐츠 블록 내부
───────────────────────────────────── */
function HeadlineBlock({ m, reduced }) {
  return (
    <h2
      style={{
        fontSize: m ? "clamp(30px, 8.5vw, 48px)" : "clamp(46px, 4.8vw, 70px)",
        fontWeight: 900,
        lineHeight: 1.15,
        margin: m ? "-300px 0 0" : "-28px 0 24px",
        letterSpacing: "-0.025em",
      }}
    >
      {COPY_LINES.map((line, i) => (
        <div key={line.text} style={{ overflow: "hidden", paddingBottom: "0.1em" }}>
          <motion.span
            style={{ display: "block", color: line.cyan ? "#22d3ee" : "#fff" }}
            initial={{ y: reduced ? "0%" : "110%", opacity: reduced ? 0 : 1 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              delay: reduced ? (0.25 + i * 0.22) * 0.35 : 0.25 + i * 0.22,
              duration: reduced ? 0.22 : 0.8,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {line.text}
          </motion.span>
        </div>
      ))}
    </h2>
  );
}

/* ─────────────────────────────────────
   CTA 버튼 서브컴포넌트 (HeroScene에서 분리 → cognitive complexity 절감)
   entrance 헬퍼는 모듈 레벨 함수라 직접 호출 가능
───────────────────────────────────── */
function CTAButtons({ m, reduced }) {
  const entryProps = entrance(1.75, { yFrom: 14, duration: 0.6, reduced, mobile: m });
  return (
    <motion.div
      {...entryProps}
      style={{ display: "flex", gap: m ? 10 : 14, marginTop: 28, flexWrap: "wrap" }}
    >
      <button style={{
        background: "#06b6d4", color: "#fff", border: "none",
        borderRadius: 12, padding: m ? "13px 22px" : "14px 28px",
        fontSize: m ? 14 : 15, fontWeight: 800, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 8,
        boxShadow: "0 0 24px rgba(6,182,212,0.45)",
        width: m ? "100%" : "auto", justifyContent: "center",
      }}>
        무료 운영진단 신청 →
      </button>
      <button style={{
        background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 12, padding: m ? "13px 22px" : "14px 28px",
        fontSize: m ? 14 : 15, fontWeight: 600, cursor: "pointer",
        width: m ? "100%" : "auto", justifyContent: "center",
      }}>
        기능 살펴보기
      </button>
    </motion.div>
  );
}

/* ─────────────────────────────────────
   스크롤 힌트 서브컴포넌트
   reduced=true 이면 화살표 바운스 정지
───────────────────────────────────── */
function ScrollHint({ reduced }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 2.2, duration: 0.8 }}
      style={{
        position: "absolute", bottom: 28, left: "50%",
        transform: "translateX(-50%)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        zIndex: 3, pointerEvents: "none",
      }}
    >
      <span style={{
        fontSize: 10, color: "rgba(255,255,255,0.28)",
        letterSpacing: "0.18em", textTransform: "uppercase",
        fontFamily: "'DM Mono', monospace",
      }}>
        scroll
      </span>
      <motion.div
        animate={reduced ? {} : { y: [0, 6, 0] }}
        transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        style={{
          width: 10, height: 10,
          borderRight: "2px solid rgba(255,255,255,0.28)",
          borderBottom: "2px solid rgba(255,255,255,0.28)",
          transform: "rotate(45deg)",
        }}
      />
    </motion.div>
  );
}

/* ─────────────────────────────────────
   정적 데이터 (컴포넌트 외부 — 재생성 없음)
───────────────────────────────────── */
const COPY_LINES = [
  { text: "숙소를",           cyan: false },
  { text: "들어서는 순간에",  cyan: true  },
  { text: "리뷰는 결정됩니다.", cyan: false },
];

const FEATURES = [
    { iconSrc: "/icons/temp.svg",        label: "쾌적한",  sublabel: "온습도"    },
  { iconSrc: "/icons/ventilation.svg", label: "신선한",  sublabel: "공기"      },
  { iconSrc: "/icons/music.svg",       label: "기분좋은",  sublabel: "음악"      },
  { iconSrc: "/icons/light.svg",       label: "로맨틱한",  sublabel: "조명"  },
/*  { iconSrc: "/icons/temp.svg",        label: "온도",  sublabel: "최적화"    },
  { iconSrc: "/icons/ventilation.svg", label: "환기",  sublabel: "완료"      },
  { iconSrc: "/icons/music.svg",       label: "음악",  sublabel: "재생"      },
  { iconSrc: "/icons/light.svg",       label: "조명",  sublabel: "은은하게"  },
   */
];

/* ─────────────────────────────────────
   HeroScene 메인 컴포넌트
───────────────────────────────────── */
export default function HeroScene() {
  const m       = useIsMobile();
  const reduced = useReducedMotion() ?? false;
  const sectionRef = useRef(null);

  /* ── 스크롤 exit 변환 ──
     섹션이 viewport 상단을 통과하기 시작하면 전체 히어로가
     opacity·y·scale 로 부드럽게 퇴장.
     훅은 항상 호출 (조건부 호출 금지) → reduced 여부는 style 적용 시 분기 */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  /* D6 fix:
     scale  0.96 → 0.92  : 4%→8% 축소, 인지 임계값(5%) 초과
     scrollY range +25%  : 시차 효과 더 뚜렷 */
  const scrollOpacity = useTransform(scrollYProgress, [0, 0.45], [1, 0.2]);
  const scrollY       = useTransform(scrollYProgress, [0, 0.45], [0, m ? -55 : -110]);
  const scrollScale   = useTransform(scrollYProgress, [0, 0.45], [1, 0.92]);

  /* reduced-motion 시 MotionValue 대신 정적 값 사용 */
  const exitStyle = reduced
    ? { opacity: 1,           y: 0,       scale: 1           }
    : { opacity: scrollOpacity, y: scrollY, scale: scrollScale };

  /* entrance 헬퍼 단축 — reduced, mobile 고정 바인딩 */
  const e = (delay, opts = {}) => entrance(delay, { ...opts, reduced, mobile: m });

  return (
    <section
      ref={sectionRef}
      className="hero-scene"
      style={{
        position: "relative",
        /* CLS 방지: min-height 는 .hero-scene CSS 클래스가 담당 (100vh / 100svh 이중 선언)
           여기서 인라인으로 minHeight 를 중복 선언하지 않음 */
        overflow: "hidden",
        background: "#020617",
      }}
    >

      {/* ══════════════════════════════════════════
          스크롤 exit wrapper
          position:absolute · inset:0 → 섹션 공간(min-height) 유지하면서
          내부만 opacity·y·scale 로 퇴장
          transformOrigin: "top center" → 자연스럽게 위로 수축
      ══════════════════════════════════════════ */}
      <motion.div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          transformOrigin: "top center",
          /* MotionValue 또는 정적값 — 타입 일치 보장됨 */
          ...exitStyle,
        }}
      >

        {/* ════════════════════════
            Layer 0 · 배경 이미지
            scale 1.03 → 1.0 (0.0s, 2.2s)
            "settle in" 효과 — 카메라가 포커스 잡는 느낌
            transform-origin: center center (기본값)
        ════════════════════════ */}
        <motion.div
          aria-hidden="true"
          initial={{ scale: reduced ? 1 : 1.06 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            /* D4 fix: 50% 45% → 카메라가 위에서 내려다보듯 settle */
            transformOrigin: "50% 45%",
          }}
        >
          {/*
            picture 태그: 디바이스별 최적 이미지
            ≤768px → scene-1-mobile-bg.png (9:16 세로형)
            ≥769px → scene-1-desktop-bg.png (16:9 가로형)
          */}
          <picture style={{ display: "block", width: "100%", height: "100%" }}>
            <source media="(max-width: 768px)" srcSet="/images/scene-1-mobile-bg-v3.png" />
            <img
              src="/images/scene-1-desktop-bg-v3.png"
              alt=""
              role="presentation"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                /* 모바일: bottom 기준 — 이미지 하단(여성)이 항상 보임
                   데스크톱: center — 가로 이미지 중앙 기준 */
                objectPosition: m ? "center bottom" : "center",
                display: "block",
              }}
            />
          </picture>
        </motion.div>

        {/* ════════════════════════
            Layer 1 · 그래디언트 오버레이 (정적)
            GradientOverlays 서브컴포넌트로 분리
        ════════════════════════ */}
        <GradientOverlays m={m} />

        {/* ════════════════════════
            Layer 2 · 콘텐츠
            justify-content: space-between
              → 브랜드 헤더 상단 / 메인 블록 하단
        ════════════════════════ */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: m ? "28px 20px 48px" : "52px 60px 60px",
            ...(m ? {} : { maxWidth: 680 }),
          }}
        >

          {/* ── 브랜드 헤더 ──
              delay: 0.2s · y 12→0 · opacity 0→1 */}
          <motion.header {...e(0.2, { yFrom: 12, duration: 0.6 })}>
            <img
              src="/icons/spacehost-logo.svg"
              alt="SPACE HOST"
              style={{ height: m ? 26 : 30, display: "block", marginBottom: 8 }}
            />
            <p
              style={{
                margin: 0,
                fontSize: m ? 10 : 11,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              
            </p>
          </motion.header>

          {/* ── 모바일: 헤드라인을 독립 flex item 으로 → 3-way space-between
                로고(상) / 헤드라인(중) / 기능+통계+CTA(하)
                인물이 중단 공간에 드러남 ── */}
          {m && <HeadlineBlock m={m} reduced={reduced} />}

          {/* ── 하단 콘텐츠 블록 ── */}
          <div>
            {/* PC 전용: 헤드라인이 하단 블록 상단에 위치 */}
            {!m && <HeadlineBlock m={m} reduced={reduced} />}

            {/* 기능 아이콘 4개 — stagger start 1.0s, +0.1s per icon
                각 아이콘: y 20→0 (mobile 10→0) + opacity 0→1
                motion.div 래퍼로 분리 (FeaturePill 내부 구조 불변) */}
            <div
              style={{
                display: "flex",
                gap: m ? 16 : 22,
                marginBottom: 26,
                flexWrap: "nowrap",
              }}
            >
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.label}
                  {...e(0.82 + i * 0.1, { yFrom: 20, duration: 0.5 })}
                >
                  <FeaturePill {...f} />
                </motion.div>
              ))}
            </div>

            {/* 파란 웨이브 구분선 — WaveLine 서브컴포넌트 */}
            {/* 
            <WaveLine reduced={reduced} />
            */}

            {/* 서브 카피
                D1 fix: 1.18s — 피처 아이콘(0.82~1.12s) 이후로 이동
                D5 fix: xFrom:-16 → yFrom:16 — 모든 요소 동일 방향(아래→위)으로 통일 */}
            <motion.p
              style={{
                margin: "0 0 20px",
                fontSize: m ? 14 : 16,
                color: "rgba(255,255,255,0.65)",
                lineHeight: 1.8,
              }}
              {...e(1.18, { yFrom: 16, duration: 0.65 })}
            >
              
            </motion.p>

            {/* 통계 카드 — delay 1.45s · y 28→0 (mobile 14→0) · opacity 0→1
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                ⚠ 법적/광고 검증 필요
                "평점 1점 상승 시 예약률 최대 20% 증가" 수치와
                아래 출처 문구는 임시 문구입니다.
                실제 서비스 출시 전 법적 기준 및 광고 규정에 따른
                검토가 반드시 필요합니다.
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <motion.div
              {...e(1.5, { yFrom: 22, duration: 0.7 })}
              style={{
                /* 모바일: 0.35 → 인물이 카드 뒤로 비침 / 데스크톱: 0.58 */
                background: m ? "rgba(2,6,23,0.35)" : "rgba(2,6,23,0.58)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(34,211,238,0.22)",
                borderRadius: 16,
                padding: m ? "16px 18px" : "18px 24px",
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                maxWidth: m ? "100%" : 460,
              }}
            >
              <img
                src="/icons/revenue-up.svg"
                alt=""
                role="presentation"
                style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }}
              />
              <div>
                <p
                  style={{
                    margin: "0 0 5px",
                    fontSize: m ? 14 : 15,
                    fontWeight: 800,
                    color: "#fff",
                    lineHeight: 1.35,
                  }}
                >
                  {"숙소의 가치를 극대화 시키는 스마트 시스템"}                  
                </p>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: m ? 13 : 14,
                    color: "#22d3ee",
                    fontWeight: 700,
                    lineHeight: 1.4,
                  }}
                >
                  
                </p>
               
              </div>
            </motion.div>


            
            {/* CTA 버튼 — CTAButtons 서브컴포넌트 (복잡도 분산) */}
            {/*
            <CTAButtons m={m} reduced={reduced} />
            */}

          </div>
        </div>

      </motion.div>

      {/* ── 스크롤 힌트 — ScrollHint 서브컴포넌트 (복잡도 분산) ── */}
      <ScrollHint reduced={reduced} />

    </section>
  );
}
