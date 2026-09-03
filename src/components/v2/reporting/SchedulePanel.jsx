/**
 * Template-F — Schedule
 * 적용: FUTURE 기간 (next_week / tomorrow / next_hour / next_month)
 * report-architecture.md 섹션 4 Template-F 참조.
 */

const PERIOD_LABELS = {
  next_week:  '다음 주',
  tomorrow:   '내일',
  next_hour:  '다음 예정',
  next_month: '다음 달',
};

export default function SchedulePanel({ stats, period, isMobile = false }) {
  const periodLabel = PERIOD_LABELS[period] || period;
  const checkIns    = stats?.checkIns ?? 0;
  const checkOuts   = stats?.checkOuts ?? 0;
  const noSchedule  = checkIns === 0 && checkOuts === 0;

  return (
    <div style={{ padding: isMobile ? '14px 12px' : '18px 20px' }}>
      {/* 헤더 */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 14, letterSpacing: 0.3 }}>
        {periodLabel} 일정
      </div>

      {/* 일정 없음 */}
      {noSchedule && (
        <div style={{
          padding: '16px',
          background: '#f8fafc',
          border: '1.5px solid #e2e8f0',
          borderRadius: 10,
          fontSize: 12, color: '#94a3b8', textAlign: 'center',
        }}>
          {periodLabel} 예약된 일정이 없어요
        </div>
      )}

      {/* 일정 있음 — 카드 */}
      {!noSchedule && (
        <div style={{ display: 'flex', gap: isMobile ? 8 : 10, marginBottom: 12 }}>
          {checkIns > 0 && (
            <div style={{
              flex: 1, padding: isMobile ? '10px' : '12px 14px',
              background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#1d4ed8', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                체크인 예정
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8', fontFamily: "'DM Mono', monospace" }}>
                {checkIns}건
              </div>
            </div>
          )}
          {checkOuts > 0 && (
            <div style={{
              flex: 1, padding: isMobile ? '10px' : '12px 14px',
              background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 10,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#059669', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                체크아웃 예정
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#059669', fontFamily: "'DM Mono', monospace" }}>
                {checkOuts}건
              </div>
            </div>
          )}
        </div>
      )}

      {/* 청소 배정 상태 — 서버 연동 후 */}
      <div style={{
        padding: '10px 12px',
        background: '#fafafa',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        fontSize: 10, color: '#94a3b8', textAlign: 'center',
      }}>
        청소 배정 상태 및 상세 일정 — 실제 배포 후 확인 가능합니다
      </div>
    </div>
  );
}
