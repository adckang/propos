/**
 * DrilldownSheet — 지표 실패 건 바텀 시트
 * Props:
 *   metric      — 지표 키 (cleaning_time 등)
 *   metricLabel — 지표명 (한국어)
 *   period      — 기간 키
 *   onClose     — 닫기 콜백
 *   onSelectRoom — (property_id) => void  숙소 선택 콜백
 */

import { useState, useEffect } from 'react';

const METRIC_LABELS = {
  cleaning_time:          '청소 시간 초과',
  post_checkout_energy:   '퇴실후 절전 위반',
  post_checkout_security: '퇴실후 보안 위반',
  vacant_energy:          '공실 에너지낭비',
  post_cleaning_security: '청소후 보안 위반',
  pre_stay_optimization:  '입실전 최적화 미완료',
};

function formatDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function formatDetail(metric, detail) {
  if (metric === 'cleaning_time' && detail?.duration_hours != null) {
    const totalMin = Math.round(detail.duration_hours * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}시간 ${m}분 소요`;
  }
  return null;
}

function FailItem({ item, metric, onSelect }) {
  const detail = formatDetail(metric, item.detail);
  return (
    <button
      onClick={() => onSelect(item.property_id)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center',
        padding: '11px 16px', background: 'none', border: 'none',
        borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
      }}
    >
      <span style={{
        fontSize: 16, marginRight: 10,
        background: '#fee2e2', borderRadius: '50%',
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>❌</span>
      <span style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'block' }}>
          {item.property_id}
        </span>
        {detail && (
          <span style={{ fontSize: 11, color: '#dc2626', marginTop: 1, display: 'block' }}>
            {detail}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
        {formatDate(item.occurred_at)}
      </span>
      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>›</span>
    </button>
  );
}

/**
 * DrilldownSheet — 두 가지 모드로 사용:
 *   1. async 모드 (기존):  metric + period 제공 → /api/stats/drilldown 에서 fetch
 *   2. static 모드 (신규): staticItems 제공 → fetch 없이 items 직접 렌더링
 *
 * static 모드 추가 props:
 *   staticItems    — 직접 넘길 아이템 배열
 *   renderItem     — (item, i) => ReactNode  (제공 안 하면 FailItem 사용)
 *   staticLoading  — 외부 로딩 상태
 *   staticError    — 외부 에러 상태
 *   emptyMessage   — 아이템 없을 때 메시지 (기본 '실패 건 없음')
 *   emptyIcon      — 아이템 없을 때 아이콘 (기본 '✅')
 */
export default function DrilldownSheet({
  // async 모드
  metric, metricLabel, period, onSelectRoom,
  // static 모드
  staticItems, renderItem, staticLoading = false, staticError = false,
  emptyMessage = '실패 건 없음', emptyIcon = '✅',
  // 공통
  onClose,
}) {
  const isStatic = staticItems !== undefined;

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(!isStatic);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    if (isStatic) return;
    if (!metric || !period) return;
    setLoading(true);
    setData(null);
    setError(false);
    fetch(`/api/stats/drilldown?period=${period}&metric=${metric}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [metric, period, isStatic]);

  const title = isStatic
    ? (metricLabel ?? '')
    : (METRIC_LABELS[metric] ?? metricLabel);

  const activeLoading = isStatic ? staticLoading : loading;
  const activeError   = isStatic ? staticError   : error;
  const activeItems   = isStatic ? (staticItems ?? []) : (data?.items ?? []);

  return (
    <>
      {/* 딤 배경 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 100,
        }}
      />

      {/* 바텀 시트 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderRadius: '16px 16px 0 0',
        zIndex: 101, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
      }}>
        {/* 핸들 */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, background: '#e2e8f0', borderRadius: 2 }} />
        </div>

        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px 12px',
          borderBottom: '1px solid #e2e8f0',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{title}</div>
            {!isStatic && data && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                실패 {data.failCount}건
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#f1f5f9', border: 'none', borderRadius: '50%',
              width: 28, height: 28, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#64748b',
            }}
          >✕</button>
        </div>

        {/* 목록 */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {activeLoading && (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
              불러오는 중…
            </div>
          )}

          {!activeLoading && activeError && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>데이터를 불러오지 못했어요</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>잠시 후 다시 시도해주세요</div>
            </div>
          )}

          {!activeLoading && !activeError && activeItems.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{emptyIcon}</div>
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{emptyMessage}</div>
              {!isStatic && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>모든 건이 기준을 통과했어요</div>
              )}
            </div>
          )}

          {!activeLoading && !activeError && activeItems.map((item, i) =>
            renderItem
              ? renderItem(item, i)
              : (
                <FailItem
                  key={i}
                  item={item}
                  metric={metric}
                  onSelect={(propertyId) => {
                    onClose();
                    onSelectRoom?.(propertyId);
                  }}
                />
              )
          )}
        </div>
      </div>
    </>
  );
}
