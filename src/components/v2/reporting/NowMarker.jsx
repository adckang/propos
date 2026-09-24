/**
 * "지금" 표시 부품 — 리스트 화면(PropertyListView)의 현재 시각 표시와 같은 모양.
 *   NowCellMarker  캘린더 오늘 칸 안: 현재 시각 위치의 세로선 위에 "지금 PM 1:53" 표식 + 점
 *   NowPill        "지금" + 시각 표식
 *   NowLegendItem  범례의 "지금 (현재)"
 * 색·크기·글자 스타일은 리스트 화면과 같은 값을 쓴다 (#1a202c, 2px 선, 8/9px DM Mono).
 *
 * 칸이 좁아서 표식이 칸 밖으로 나가면 이웃 날짜를 가리므로, 표식은 칸 안에 가둔다 (선·점은 정확한 시각 위치).
 */

const NOW_COLOR = '#1a202c';
const MONO = "'DM Mono', monospace";

const CHIP_STYLE = {
  fontSize: 9, fontWeight: 700, color: '#fff', background: NOW_COLOR,
  padding: '1px 5px', borderRadius: 3, fontFamily: MONO,
};
// 모바일은 칸 너비(약 53px)가 좁아 "지금" 글자를 빼고 칩을 작게
const CHIP_STYLE_COMPACT = { ...CHIP_STYLE, fontSize: 8, padding: '1px 3px' };

/** 오늘 칸 위쪽에서 표식(시각+점)이 차지하는 높이(px). 날짜 숫자·배지는 이만큼 아래로 내린다. */
export function nowStripHeight(compact = false) {
  return compact ? 17 : 20;
}

export function NowPill({ label, compact = false }) {
  return (
    <span
      data-testid="now-marker-pill"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}
    >
      {!compact && (
        <span style={{ fontSize: 8, fontWeight: 800, color: NOW_COLOR, fontFamily: MONO, lineHeight: 1 }}>
          지금
        </span>
      )}
      <span style={compact ? CHIP_STYLE_COMPACT : CHIP_STYLE}>{label}</span>
    </span>
  );
}

/**
 * 부모가 position: relative 인 오늘 칸 안에서 하루 중 fraction(0~1) 위치에
 * [시각 표식] → [점] → [세로선(칸 바닥까지)] 을 그린다. 리스트 화면의 표식 → 점 → 선 순서와 같다.
 */
export function NowCellMarker({ fraction, label, compact = false }) {
  const pct = `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(2)}%`;
  const strip = nowStripHeight(compact);
  const half = compact ? 24 : 38; // 표식 폭의 절반(px) — 표식이 칸 밖으로 나가지 않게 가두는 여백

  return (
    <>
      <div
        data-testid="now-marker-line"
        aria-hidden="true"
        style={{
          position: 'absolute', left: pct, top: strip, bottom: 0,
          width: 2, marginLeft: -1, background: NOW_COLOR,
          zIndex: 20, pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', left: pct, top: strip - 4,
          width: 8, height: 8, marginLeft: -4, borderRadius: '50%', background: NOW_COLOR,
          zIndex: 21, pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute', top: compact ? 2 : 3,
          left: `clamp(${half}px, ${pct}, calc(100% - ${half}px))`,
          transform: 'translateX(-50%)',
          zIndex: 21, pointerEvents: 'none',
        }}
      >
        <NowPill label={label} compact={compact} />
      </div>
    </>
  );
}

export function NowLegendItem() {
  return (
    <div data-testid="now-legend" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 2.5, height: 14, background: NOW_COLOR, borderRadius: 1 }} />
      <span style={{ fontSize: 11, color: '#718096' }}>지금 (현재)</span>
    </div>
  );
}
