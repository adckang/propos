import { computeMetricRowDisplay } from '../../../domain/metricRowDomain.js';

export default function SharedMetricRow({
  label,
  numerator,
  denominator,
  isCount  = false,
  noData   = false,
  isLast   = false,
  onDrilldown,
}) {
  const { countText, ratioText, ratioColor, ratioBg, failCount } =
    computeMetricRowDisplay({ numerator, denominator, isCount, noData });

  const tappable = failCount > 0 && !!onDrilldown;

  const rowContent = (
    <>
      <div style={{ flex: 1, fontSize: 12, color: noData ? '#94a3b8' : '#4a5568', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', fontFamily: "'DM Mono', monospace", minWidth: 64, textAlign: 'right', marginRight: 10 }}>
        {countText}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: ratioColor, background: ratioBg,
        fontFamily: "'DM Mono', monospace", minWidth: 46, textAlign: 'center',
        borderRadius: 5, padding: '2px 6px',
      }}>
        {ratioText}
      </div>
      {tappable && <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>}
    </>
  );

  const baseStyle = {
    display: 'flex', alignItems: 'center',
    padding: '9px 0',
    borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
  };

  if (tappable) {
    return (
      <button
        onClick={onDrilldown}
        style={{ ...baseStyle, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        {rowContent}
      </button>
    );
  }
  return <div style={baseStyle}>{rowContent}</div>;
}
