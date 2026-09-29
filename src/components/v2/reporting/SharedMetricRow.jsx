import { computeMetricRowDisplay } from '../../../domain/metricRowDomain.js';

// 고정 그리드 — 라벨(가변) | 건수 | 성공률 | 실패배지 | 드릴다운 화살표.
// flex였을 때는 배지·화살표가 "있는 행만" 뒤에 붙어서, 행마다 라벨(flex:1)이 차지하는 폭이
// 달라지고 그만큼 건수·성공률 칼럼의 시작 X좌표가 행마다 밀렸다(실사용 중 발견된 버그,
// 2026-09-26: "세로 선이 안 맞아, 같은 항목끼리는 좌측에 맞춰야지"). 그리드는 칼럼 폭을
// 컨테이너가 고정으로 정하므로, 각 칸의 내용이 비어 있어도(배지 없음/화살표 없음) 다음 칸이
// 그 자리로 당겨오지 않는다 — EventMatrixPanel의 헤더 행도 이 값을 그대로 가져다 쓴다.
export const ROW_GRID_TEMPLATE = '1fr 64px 50px 76px 16px';
// 모바일 — 고정 칼럼 예산을 줄여 라벨(1fr)에 더 많은 폭을 준다. 그대로 두면 건수·성공률·배지·
// 화살표 네 칸이 206px를 고정으로 먹어, 좁은 화면에서 라벨이 한두 글자씩 줄바꿈되며 "세로쓰기"
// 처럼 보였다(실사용 중 발견, 2026-09-28: "운영지표가 세로쓰기처럼 나오고... 우측 작은
// 화살표들은 공간을 많이 차지하고 있어").
export const ROW_GRID_TEMPLATE_MOBILE = '1fr 38px 34px 54px 12px';

export default function SharedMetricRow({
  label,
  numerator,
  denominator,
  isCount  = false,
  noData   = false,
  isLast   = false,
  isMobile = false,
  onDrilldown,
}) {
  const { countText, ratioText, ratioColor, ratioBg, failCount } =
    computeMetricRowDisplay({ numerator, denominator, isCount, noData });

  // 배지 = 실패가 하나라도 있으면 표시 (사용자 지시: "11/12건인데 왜 실패건이 없냐, 숫자가
  // 비잖아" — 잘된 건 조용히 두되, 완벽하지 않은 건 전부 눈에 띄어야 한다는 뜻으로 되돌림).
  // "완벽해요"(요약 문장, D-026)는 실패 총건수 0을 직접 판정하므로 이 배지 기준과 절대 어긋나지
  // 않는다 — 배지가 하나라도 뜨면 요약은 이미 "완벽해요"가 아니다.
  const showBadge = failCount > 0;
  const tappable  = failCount > 0 && !!onDrilldown;

  const rowContent = (
    <>
      <div style={{ gridColumn: 1, fontSize: 12, color: noData ? '#94a3b8' : '#4a5568', fontWeight: 500, minWidth: 0 }}>
        {label}
      </div>
      <div style={{ gridColumn: 2, fontSize: isMobile ? 10 : 11, color: '#64748b', fontFamily: "'DM Mono', monospace", textAlign: 'right' }}>
        {countText}
      </div>
      <div style={{ gridColumn: 3, justifySelf: 'center' }}>
        <span style={{
          fontSize: isMobile ? 11 : 12, fontWeight: 700, color: ratioColor, background: ratioBg,
          fontFamily: "'DM Mono', monospace",
          borderRadius: 5, padding: isMobile ? '1px 4px' : '2px 6px', whiteSpace: 'nowrap',
        }}>
          {ratioText}
        </span>
      </div>
      <div style={{ gridColumn: 4 }}>
        {showBadge && (
          <span style={{
            fontSize: isMobile ? 9 : 10, fontWeight: 700, color: '#fff', background: '#dc2626',
            fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap',
            borderRadius: 5, padding: isMobile ? '1px 4px' : '2px 6px',
          }}>
            실패 {failCount}건
          </span>
        )}
      </div>
      <div style={{ gridColumn: 5, fontSize: isMobile ? 11 : 12, color: '#94a3b8', textAlign: 'center' }}>
        {tappable && '›'}
      </div>
    </>
  );

  const baseStyle = {
    display: 'grid', gridTemplateColumns: isMobile ? ROW_GRID_TEMPLATE_MOBILE : ROW_GRID_TEMPLATE,
    columnGap: isMobile ? 4 : 6, alignItems: 'center',
    padding: '9px 0',
    borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
  };

  if (tappable) {
    return (
      <button
        onClick={onDrilldown}
        style={{ ...baseStyle, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
      >
        {rowContent}
      </button>
    );
  }
  return <div style={baseStyle}>{rowContent}</div>;
}
