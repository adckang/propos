import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/* ── 타자기 인트로: 한 글자씩 타이핑, 띄어쓰기/개행에서 뜸들임 ──
   글쓰는 걸 따라 읽듯이. ms 상수만 바꾸면 속도 조절 가능 */
const CHAR_MS = 100;     // 일반 글자 간격
const SPACE_MS = 210;   // 띄어쓰기에서 잠깐 뜸
const SYMBOL_MS = 300;  // 기호(. ? !) 한 박자씩
const LINE_MS = 620;    // 개행에서 더 길게 뜸
const INITIAL_MS = 450; // 시작 전 대기

/* 상단 타이핑 타이틀 — 한 글자씩 천천히 찍힌 뒤 개행하여 "!" 하나 */
const TITLE_TEXT = "숙소가 스스로";
const TITLE_CHAR_MS = 155;   // 타이틀 글자 간격(천천히)
const TITLE_SPACE_MS = 320;  // 띄어쓰기 뜸
const BANG_GAP = 460;        // 타이핑 끝 → "!" 찍힘까지

const RAW_LINES = [
  { text: "상황을 판단하고",      symbol: "!", count: 0, kind: "promise" },
  { text: "공간을 관리하는",      symbol: "!", count: 0, kind: "promise" },
  { text: "지능형 IoT",    symbol: "",  count: 0, kind: "promise", highlight: true },
];

/* 기호 색상 — 망설임(뮤트) → 혼란(앰버) → 확신(시안) 감정 아크 */
function symbolColorFor(symbol) {
  if (symbol === "?") return "#fbbf24";
  if (symbol === "!") return "#22d3ee";
  return "rgba(226,232,240,0.5)";
}

/* 줄별 글자 배열(색 포함) + 전역 시작 인덱스 계산 */
function buildLineData(lines) {
  let start = 0;
  return lines.map((line, gi) => {
    const textColor = line.kind === "context"
      ? "rgba(226,232,240,0.72)"
      : (line.highlight ? "#67e8f9" : "#F8FAFC");
    const chars = [];
    for (const ch of line.text) chars.push({ ch, color: textColor, sym: false });
    const symColor = symbolColorFor(line.symbol);
    for (const ch of line.symbol.repeat(line.count)) chars.push({ ch, color: symColor, sym: true });
    const data = { ...line, gi, chars, start, len: chars.length };
    start += chars.length;
    return data;
  });
}

const LINE_DATA = buildLineData(RAW_LINES);
const CONTEXT_LINES = LINE_DATA.filter((l) => l.kind === "context");
const PROMISE_LINES = LINE_DATA.filter((l) => l.kind === "promise");

/* 타이핑은 컨텍스트(질문) 줄만. 프로미스(답) 줄은 우측에서 날아옴 */
const FLAT = [];
CONTEXT_LINES.forEach((ld) => ld.chars.forEach((c) => FLAT.push({ ch: c.ch, line: ld.gi, sym: c.sym })));
const TOTAL = FLAT.length;

/* index k 글자를 찍기 전 대기시간(ms) — 개행 > 기호 > 띄어쓰기 > 일반 */
function delayBefore(k) {
  if (k <= 0) return INITIAL_MS;
  const prev = FLAT[k - 1];
  const cur = FLAT[k];
  if (prev.line !== cur.line) return LINE_MS;
  if (cur.sym || prev.sym) return SYMBOL_MS;
  if (prev.ch === " ") return SPACE_MS;
  return CHAR_MS;
}

/* 상단 타이틀 타이핑 + "!" 까지 총 소요(ms) → 이후 프로미스/브랜드 타이밍 기준 */
const TITLE_TYPE_MS = (() => {
  let sum = INITIAL_MS;
  for (let k = 1; k < TITLE_TEXT.length; k += 1) {
    sum += TITLE_TEXT[k - 1] === " " ? TITLE_SPACE_MS : TITLE_CHAR_MS;
  }
  return sum;
})();
const TITLE_TOTAL_MS = TITLE_TYPE_MS + BANG_GAP + 320;

const SECOND_PAGE_COMPARE = [
  { from: "설치 2천만원?", to: "설치 49만원", color: "#F8FAFC" },
  { from: "시스템 운영은 알아서 하세요?", to: "월 5만원으로 시스템 안정화 유지", color: "#67e8f9" },
];

/* 컨텍스트 타이핑이 끝난 뒤, 프로미스 줄이 우측에서 하나씩 날아와 박힘 */
const PROMISE_GAP = 0.5;     // 타이핑 종료 후 첫 프로미스까지(초)
const PROMISE_STEP = 0.85;   // 프로미스 줄 간격(초)
const PROMISE_START = TITLE_TOTAL_MS / 1000 + PROMISE_GAP;

const BRAND_DELAY = PROMISE_START + (PROMISE_LINES.length - 1) * PROMISE_STEP + 1.3;

/* 깜빡이는 커서 */
function Caret({ reduced }) {
  if (reduced) return null;
  return (
    <motion.span
      aria-hidden="true"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
      style={{
        display: "inline-block",
        width: "0.06em",
        height: "0.95em",
        background: "#67e8f9",
        marginLeft: "0.08em",
        borderRadius: 1,
        transform: "translateY(0.08em)",
        verticalAlign: "baseline",
      }}
    />
  );
}

/* 한 줄 — revealed 까지만 표시(나머지는 minHeight 로 자리 예약 → 세로 흔들림 방지) */
function TypeLine({ line, revealed, isActive, reduced, fontSize, fontWeight }) {
  const shown = Math.max(0, Math.min(revealed - line.start, line.len));
  return (
    <div
      style={{
        minHeight: "1.2em",
        fontSize,
        fontWeight,
        lineHeight: 1.2,
        letterSpacing: "-0.025em",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "pre",
      }}
    >
      <span>
        {line.chars.slice(0, shown).map((c, j) => (
          <span key={`${line.gi}-${j}`} style={{ color: c.color }}>{c.ch}</span>
        ))}
      </span>
      {isActive && <Caret reduced={reduced} />}
    </div>
  );
}

/* 프로미스(답) 한 줄 — 우측에서 통째로 날아와 박힘 */
function PromiseLine({ line, reduced, delay }) {
  const textColor = line.highlight ? "#67e8f9" : "#F8FAFC";
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 92 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{ duration: reduced ? 0.22 : 0.72, delay: reduced ? 0.12 : delay, ease: [0.16, 1, 0.3, 1] }}
      style={{
        fontSize: "clamp(28px, 5.6vw, 70px)",
        fontWeight: 900,
        lineHeight: 1.12,
        letterSpacing: "-0.03em",
        color: textColor,
        whiteSpace: "pre",
        willChange: "transform, opacity",
      }}
    >
      {line.text}
      {line.count > 0 && (
        <span style={{ color: symbolColorFor(line.symbol) }}>
          {line.symbol.repeat(line.count)}
        </span>
      )}
    </motion.div>
  );
}

function LogoIcon() {
  return (
    <svg width="78" height="78" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <path d="M16 44V24L36 8L56 24V56H16V44Z" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 55V37H46V55" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 31H46" stroke="#1E6BFF" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function IntroBrand({ reduced }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: reduced ? 0.2 : 0.88,
        delay: reduced ? BRAND_DELAY * 0.35 : BRAND_DELAY,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        filter: "drop-shadow(0 12px 28px rgba(34,211,238,0.10))",
        willChange: "transform, opacity",
      }}
    >
      <LogoIcon />
      <div
        style={{
          fontSize: "clamp(34px, 4.6vw, 52px)",
          fontWeight: 800,
          letterSpacing: "0.16em",
          color: "#F8FAFC",
          textTransform: "uppercase",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        SPACE HOST
      </div>
    </motion.div>
  );
}

/* 상단 타이핑 타이틀 — "숙소가 스스로" 한 글자씩 → 개행 → "!" 딱 */
function TypedHeroTitle({ reduced }) {
  const [n, setN] = useState(reduced ? TITLE_TEXT.length : 0);
  const [bang, setBang] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setN(TITLE_TEXT.length);
      setBang(true);
      return undefined;
    }
    let i = 0;
    let bangTimer;
    let timer = setTimeout(function tick() {
      i += 1;
      setN(i);
      if (i >= TITLE_TEXT.length) {
        bangTimer = setTimeout(() => setBang(true), BANG_GAP);
        return;
      }
      const prevChar = TITLE_TEXT[i - 1];
      timer = setTimeout(tick, prevChar === " " ? TITLE_SPACE_MS : TITLE_CHAR_MS);
    }, INITIAL_MS);
    return () => {
      clearTimeout(timer);
      if (bangTimer) clearTimeout(bangTimer);
    };
  }, [reduced]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(4px, 1vh, 12px)" }}>
      {/* 타이핑 본문 (30% 키운 제목) */}
      <div
        style={{
          fontSize: "clamp(40px, 8.4vw, 104px)",
          fontWeight: 900,
          lineHeight: 1.08,
          letterSpacing: "-0.035em",
          color: "#F8FAFC",
          whiteSpace: "pre",
          minHeight: "1.1em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span>{TITLE_TEXT.slice(0, n)}</span>
        {n < TITLE_TEXT.length && <Caret reduced={reduced} />}
      </div>

      {/* 개행 후 "!" 딱 */}
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3, y: 6 }}
        animate={bang ? { opacity: 1, scale: 1, y: 0 } : {}}
        transition={{ type: "spring", stiffness: 460, damping: 15 }}
        style={{
          fontSize: "clamp(44px, 9vw, 112px)",
          fontWeight: 900,
          lineHeight: 1,
          color: "#22d3ee",
          textShadow: "0 0 28px rgba(34,211,238,0.35)",
        }}
      >
        !
      </motion.div>
    </div>
  );
}

export default function IntroScene() {
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(reduced ? TOTAL : 0);

  useEffect(() => {
    if (reduced) {
      setRevealed(TOTAL);
      return undefined;
    }
    let i = 0;
    let timer = setTimeout(function tick() {
      i += 1;
      setRevealed(i);
      if (i >= TOTAL) return;
      timer = setTimeout(tick, delayBefore(i));
    }, delayBefore(0));
    return () => clearTimeout(timer);
  }, [reduced]);

  // 커서가 위치할 줄(현재 타이핑 중인 줄). 끝나면 -1 → 커서 사라짐
  const caretLine = revealed < TOTAL ? FLAT[revealed].line : -1;

  return (
    <section
      style={{
        position: "relative",
        minHeight: "min(92svh, 980px)",
        overflow: "hidden",
        background: "#04101f",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(circle at 18% 18%, rgba(34,211,238,0.18) 0%, transparent 26%),
            radial-gradient(circle at 82% 22%, rgba(37,99,235,0.16) 0%, transparent 28%),
            radial-gradient(circle at 50% 78%, rgba(14,165,233,0.12) 0%, transparent 30%),
            linear-gradient(180deg, rgba(4,16,31,0.88) 0%, rgba(4,16,31,0.76) 52%, rgba(2,8,19,0.94) 100%)
          `,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: `
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), rgba(0,0,0,0.24))",
          opacity: 0.18,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            minHeight: "min(92svh, 980px)",
            padding: "clamp(32px, 5vw, 56px) 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 980,
              minHeight: "min(76svh, 760px)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingTop: "clamp(36px, 8vh, 96px)",
              gap: "clamp(24px, 4vh, 44px)",
            }}
          >
            {/* 상단 타이핑 타이틀: "숙소가 스스로" → 개행 → "!" */}
            <TypedHeroTitle reduced={reduced} />

            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "clamp(12px, 2vh, 18px)",
                marginTop: "clamp(12px, 2vh, 24px)",
              }}
            >
              {PROMISE_LINES.map((line, i) => (
                <PromiseLine
                  key={line.text}
                  line={line}
                  reduced={reduced}
                  delay={PROMISE_START + i * PROMISE_STEP}
                />
              ))}
            </div>

            <IntroBrand reduced={reduced} />
          </div>
        </div>

        <div
          style={{
            minHeight: "min(92svh, 980px)",
            padding: "clamp(40px, 6vw, 72px) 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: `
                radial-gradient(circle at 22% 18%, rgba(103,232,249,0.10) 0%, transparent 26%),
                radial-gradient(circle at 78% 24%, rgba(255,255,255,0.08) 0%, transparent 24%),
                linear-gradient(180deg, rgba(11,20,36,0.96) 0%, rgba(9,18,31,0.98) 42%, rgba(6,12,24,1) 100%)
              `,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: `
                linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)
              `,
              backgroundSize: "72px 72px",
              opacity: 0.14,
              maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.55))",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              maxWidth: 860,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "clamp(18px, 2.8vh, 28px)",
            }}
          >
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
              whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{
                duration: reduced ? 0.2 : 0.8,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                width: "min(100%, 760px)",
                borderRadius: 28,
                padding: "24px 24px 22px",
                background: "linear-gradient(135deg, rgba(255,255,255,0.11), rgba(103,232,249,0.08))",
                border: "1px solid rgba(103,232,249,0.24)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "0 22px 54px rgba(2,6,23,0.24)",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              {SECOND_PAGE_COMPARE.map((item, index) => (
                <div
                  key={item.to}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    paddingBottom: index === SECOND_PAGE_COMPARE.length - 1 ? 0 : 18,
                    borderBottom:
                      index === SECOND_PAGE_COMPARE.length - 1
                        ? "none"
                        : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "clamp(14px, 2vw, 18px)",
                      fontWeight: 700,
                      color: "rgba(226,232,240,0.68)",
                      letterSpacing: "-0.01em",
                      lineHeight: 1.2,
                    }}
                  >
                    {item.from}
                  </div>
                  <div
                    style={{
                      fontSize:
                        index === 0
                          ? "clamp(30px, 5vw, 58px)"
                          : "clamp(22px, 3.2vw, 36px)",
                      fontWeight: 900,
                      color: item.color,
                      letterSpacing: index === 0 ? "-0.03em" : "-0.025em",
                      lineHeight: 1.08,
                      textWrap: "balance",
                    }}
                  >
                    {item.to}
                  </div>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
              whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{
                duration: reduced ? 0.2 : 0.72,
                delay: reduced ? 0.05 : 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                maxWidth: 720,
                fontSize: "clamp(14px, 1.7vw, 17px)",
                fontWeight: 700,
                color: "rgba(226,232,240,0.84)",
                lineHeight: 1.72,
                letterSpacing: "-0.012em",
              }}
            >
              <span style={{ display: "block" }}>단순 원격제어가 아닙니다.</span>
              <span style={{ display: "block", color: "#cbd5e1" }}>상황 정보까지 종합 판단해</span>
              <span style={{ display: "block", color: "#67e8f9" }}>
                숙소가 스스로 운영되는 Smart IoT 시스템입니다.
              </span>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
