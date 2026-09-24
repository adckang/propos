/**
 * DrilldownSheet — 지표 실패 건 바텀 시트
 * Props:
 *   metric      — 지표 키 (cleaning_time 등)
 *   metricLabel — 지표명 (한국어)
 *   period      — 기간 키
 *   onClose     — 닫기 콜백
 *   onSelectRoom — (property_id) => void  숙소 선택 콜백
 *   properties  — 화면의 숙소 목록. 항목의 property_id 를 리스트 화면과 같은 숙소 이름으로 바꿔 표시
 *
 * async 모드의 각 줄은 [숙소 이름] [무슨 문제가 어떻게 있었는지 구어체 한 줄] [시간] — 심각도는 줄 색으로만 알리고
 * 심한 건이 위로 오게 정렬한다 (계산: violationDetailDomain, 그리기: ViolationRow).
 */

import { useState, useEffect, useMemo } from 'react';
import { resolvePropertyName } from '../../../domain/propertyNameDomain.js';
import { buildViolationRows, formatKstDateTime } from '../../../domain/violationDetailDomain.js';
import ViolationRow from './ViolationRow.jsx';

const METRIC_LABELS = {
  cleaning_time:          '청소 시간 초과',
  post_checkout_energy:   '퇴실후 절전 위반',
  post_checkout_security: '퇴실후 보안 위반',
  vacant_energy:          '공실 에너지낭비',
  post_cleaning_security: '청소후 보안 위반',
  pre_stay_optimization:  '입실전 최적화 미완료',
};

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
  metric, metricLabel, period, propertyIds, onSelectRoom, properties = [],
  // static 모드
  staticItems, renderItem, staticLoading = false, staticError = false,
  emptyMessage = '실패 건 없음', emptyIcon = '✅',
  // 공통
  onClose,
}) {
  const isStatic = staticItems !== undefined;
  const idsKey = Array.isArray(propertyIds) ? propertyIds.join(',') : '';

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(!isStatic);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    if (isStatic) return;
    if (!metric || !period) return;
    setLoading(true);
    setData(null);
    setError(false);
    const params = new URLSearchParams({ period, metric });
    if (Array.isArray(propertyIds) && propertyIds.length > 0) {
      params.set('property_ids', propertyIds.join(','));
    }
    fetch(`/api/stats/drilldown?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [metric, period, isStatic, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = isStatic
    ? (metricLabel ?? '')
    : (METRIC_LABELS[metric] ?? metricLabel);

  const activeLoading = isStatic ? staticLoading : loading;
  const activeError   = isStatic ? staticError   : error;
  const activeItems   = isStatic ? (staticItems ?? []) : (data?.items ?? []);

  // async 모드: 항목마다 문장·심각도를 계산해 심한 건이 위로 오게 정렬 (데이터가 바뀔 때만 다시 계산)
  const violationRows = useMemo(
    () => (isStatic ? [] : buildViolationRows(metric, data?.items ?? [], Date.now())),
    [isStatic, metric, data],
  );

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

          {!activeLoading && !activeError && (
            renderItem
              ? activeItems.map((item, i) => renderItem(item, i))
              : violationRows.map(({ item, view }, i) => (
                <ViolationRow
                  key={`${item.property_id}-${item.occurred_at}-${i}`}
                  name={resolvePropertyName(properties, item.property_id)}
                  view={view}
                  dateLabel={formatKstDateTime(item.occurred_at)}
                  onClick={() => {
                    onClose();
                    onSelectRoom?.(item.property_id);
                  }}
                />
              ))
          )}
        </div>
      </div>
    </>
  );
}
