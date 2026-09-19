/**
 * TodayStatusPanel — 오늘 실시간 상태 요약 (Detail View 전용)
 * 데이터: 이벤트 기록으로 계산한 현재 상태 → { occupied, preStayReady, vacant, cleaning, anomalyCount, total }
 *
 * ActiveHybridPanel(this_week)과 별도 분리 — 포맷이 다르기 때문.
 */

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

export default function TodayStatusPanel({ stats, isMobile = false }) {
  const now    = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} 기준`;
  const hasAnomaly = (stats?.anomalyCount ?? 0) > 0;

  return (
    <div style={{ padding: isMobile ? '12px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 현재 상태 섹션 */}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {stats ? `현재 상태 · 전체 ${stats.total ?? 0}개` : '현재 상태'}
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{`오늘 ${timeStr}`}</span>
        </div>

        {!stats ? (
          <div style={{ height: 52, background: '#dcfce7', borderRadius: 8 }} />
        ) : (
          <>
            {[
              { label: '체류중',   value: stats.occupied     },
              { label: '입실전',   value: stats.preStayReady },
              { label: '공실',     value: stats.vacant       },
              { label: '청소중',   value: stats.cleaning  },
              { label: '이상감지', value: stats.anomalyCount, warn: true },
            ].map(({ label, value, warn }) => {
              const isZero = (value ?? 0) === 0;
              return (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center',
                  padding: '5px 0', borderBottom: '1px solid #f1f5f9',
                }}>
                  <span style={{ flex: 1, fontSize: 12, color: '#4a5568', fontWeight: 500 }}>{label}</span>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: warn && !isZero ? '#dc2626' : isZero ? '#cbd5e1' : '#1a202c',
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {value ?? 0}건
                  </span>
                </div>
              );
            })}
            {hasAnomaly && (
              <div style={{
                marginTop: 8, padding: '6px 10px',
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7,
                fontSize: 11, color: '#dc2626', fontWeight: 600,
              }}>
                ⚠ 이상 {stats.anomalyCount}건 감지 — 자동처리 여부 확인 필요
              </div>
            )}
          </>
        )}
      </div>

      {/* 예정 섹션 — placeholder */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
          예정
        </div>
        <div style={{
          padding: '8px 10px',
          background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 7,
          fontSize: 11, color: '#3b82f6', textAlign: 'center', lineHeight: 1.6,
        }}>
          캘린더 연동 후 체크인 예정 · 청소 배정 현황이 표시됩니다
        </div>
      </div>
    </div>
  );
}
