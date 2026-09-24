/**
 * FutureMatrixPanel — 미래 기간 운영 준비 현황 (Template-F)
 * 적용: next_week / tomorrow (기간 전체) + this_week / this_month 의 [예정] (지금 ~ 기간 끝)
 *
 * 표시 항목:
 *   체크인 예정 / 체크아웃 예정
 *   청소 배정완료 / 배정 요청 필요(🔴) / 배정 요청중 / 배정 실패(🔴)
 *   공실 예정 (N숙소, N박, 공실율%)
 *   체류 예정 (N숙소, N박, 체류율%)
 *
 * 데이터 소스:
 *   체크인/아웃, 공실/체류 → properties[].reservations (gantt와 동일)
 *   청소 배정 4분류 → /api/cleaning/stats?period=&items=true (DB)
 *
 * 배정 실패 / 배정 요청 필요 건수를 누르면 뜨는 목록은 체크아웃이 가까운(급한) 건이 위로 오게 정렬하고,
 * 줄마다 "체크아웃까지 남은 시간 · 청소자 요청/거절 현황 · 취소 경과"를 구어체 한 줄로 알려준다 (violationDetailDomain).
 * 급한 정도는 글자 없이 줄 색(빨강/주황/초록)으로만 알린다.
 */

import { useState, useEffect, useMemo } from 'react';
import { periodToRemainingRange } from '../../../domain/periodDomain.js';
import {
  countWeekCheckIns,
  countWeekCheckOuts,
  getOccupancyForecast,
} from '../../../domain/futureWeekDomain.js';
import DrilldownSheet from './DrilldownSheet.jsx';
import ViolationRow from './ViolationRow.jsx';
import { resolvePropertyName } from '../../../domain/propertyNameDomain.js';
import { buildCleaningIssueRows } from '../../../domain/violationDetailDomain.js';

// ── 스타일 상수 ──────────────────────────────────────────────────────────────
const ROW_BASE = {
  display: 'flex', alignItems: 'center',
  padding: '7px 0', fontSize: 13,
};
const LABEL_STYLE = { flex: 1, color: '#475569' };
const VAL_STYLE   = { fontWeight: 600, color: '#1e293b', textAlign: 'right' };
const VAL_RED     = { fontWeight: 600, color: '#dc2626', textAlign: 'right' };
const VAL_GRAY    = { fontWeight: 600, color: '#94a3b8', textAlign: 'right' };
const DIVIDER     = { borderTop: '1px solid #e2e8f0', margin: '6px 0' };
const SECTION_HDR = { fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', marginBottom: 4, marginTop: 8 };

function Row({ label, value, red = false, gray = false, last = false, onClick }) {
  let valStyle = VAL_STYLE;
  if (red)  valStyle = VAL_RED;
  if (gray) valStyle = VAL_GRAY;

  const base = { ...ROW_BASE, borderBottom: last ? 'none' : '1px solid #f1f5f9' };

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={{ background: 'none', border: 'none', ...base, cursor: 'pointer', width: '100%', textAlign: 'left' }}
      >
        <span style={LABEL_STYLE}>{label}</span>
        <span style={valStyle}>{value}</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>
      </button>
    );
  }

  return (
    <div style={base}>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={valStyle}>{value}</span>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function FutureMatrixPanel({ stats, period, properties = [], propertyIds = null, isMobile = false, onSelectRoom }) {
  const [cleaningStats,   setCleaningStats]   = useState(null);
  const [cleaningLoading, setCleaningLoading] = useState(true);
  const [cleaningError,   setCleaningError]   = useState(false);
  const [drilldown, setDrilldown] = useState(null); // null | 'needsRequest' | 'failed'

  // 청소 배정 4분류 + 드릴다운 아이템 — DB
  // propertyIds: null=전체, [...]= 선택 숙소 필터
  const idsKey = Array.isArray(propertyIds) ? propertyIds.join(',') : null;
  useEffect(() => {
    if (!period) return;
    let cancelled = false; // 선택이 빠르게 바뀔 때 늦게 도착한 이전 응답이 최신 값을 덮지 않도록
    setCleaningLoading(true);
    setCleaningError(false);
    const params = new URLSearchParams({ period, items: 'true' });
    if (idsKey) params.set('property_ids', idsKey);
    fetch(`/api/cleaning/stats?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { if (cancelled) return; setCleaningStats(d); setCleaningLoading(false); })
      .catch(() => { if (cancelled) return; setCleaningError(true); setCleaningLoading(false); });
    return () => { cancelled = true; };
  }, [period, idsKey]);

  // 예정 구간 — 미래 기간은 기간 전체, 진행 중 기간(이번 주·이번 달)은 "지금 ~ 기간 끝".
  // 지금이 하한이라 렌더마다 갱신 (지난 체크인이 [완료]와 [예정]에 이중으로 잡히지 않게)
  const range  = periodToRemainingRange(period);
  const fromMs = range?.from.getTime();
  const toMs   = range?.to.getTime();

  // 체크인 / 체크아웃 예정 — properties[].reservations 직접 계산
  const checkIns  = useMemo(() => range ? countWeekCheckIns(properties,  range.from, range.to) : 0, [properties, fromMs, toMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkOuts = useMemo(() => range ? countWeekCheckOuts(properties, range.from, range.to) : 0, [properties, fromMs, toMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // 공실/체류 예측 — properties[].reservations 직접 계산
  const forecast = useMemo(() => range
    ? getOccupancyForecast(properties, range.from, range.to)
    : null,
  [properties, fromMs, toMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // 훅 호출이 모두 끝난 뒤에만 조건부 return (Rules of Hooks)
  if (!stats) return null;

  // 청소 배정 4분류 값
  const csAssigned    = cleaningStats?.assigned    ?? null;
  const csNeedsReq    = cleaningStats?.needsRequest ?? null;
  const csRequesting  = cleaningStats?.requesting  ?? null;
  const csFailed      = cleaningStats?.failed      ?? null;

  const fmtCleaning = (val) => {
    if (cleaningLoading) return '—';
    if (cleaningError)   return '오류';
    if (val == null)     return '—';
    return `${val}건`;
  };

  const fmtOccupancy = (rooms, nights, rate) => {
    if (!forecast) return '—';
    const pct = Math.round(rate * 100);
    return `${rooms}숙소 · ${nights}박 (${pct}%)`;
  };

  const needsReqClickable = !cleaningLoading && !cleaningError && (csNeedsReq ?? 0) > 0;
  const failedClickable   = !cleaningLoading && !cleaningError && (csFailed ?? 0) > 0;

  // 급한 건이 위로 (체크아웃이 가까운 순) 정렬된 행
  const drilldownRows = drilldown
    ? buildCleaningIssueRows(
        drilldown,
        drilldown === 'failed' ? (cleaningStats?.failedItems ?? []) : (cleaningStats?.needsRequestItems ?? []),
        Date.now(),
      )
    : [];
  const drilldownLabel = drilldown === 'failed' ? '배정 실패' : '배정 요청 필요';

  const pad = isMobile ? '10px 12px' : '14px 20px';

  return (
    <>
      <div style={{ padding: pad }}>

        {/* 예약 현황 */}
        <div style={SECTION_HDR}>예약</div>
        <Row label="체크인 예정"  value={`${checkIns}건`} />
        <Row label="체크아웃 예정" value={`${checkOuts}건`} />

        <div style={DIVIDER} />

        {/* 청소 배정 */}
        <div style={SECTION_HDR}>{cleaningError ? '청소 배정 ⚠' : '청소 배정'}</div>
        <Row label="배정완료"      value={fmtCleaning(csAssigned)}   />
        <Row
          label="배정 요청 필요"
          value={fmtCleaning(csNeedsReq)}
          red={needsReqClickable}
          onClick={needsReqClickable ? () => setDrilldown('needsRequest') : undefined}
        />
        <Row label="배정 요청중"    value={fmtCleaning(csRequesting)} />
        <Row
          label="배정 실패"
          value={fmtCleaning(csFailed)}
          red={failedClickable}
          onClick={failedClickable ? () => setDrilldown('failed') : undefined}
        />

        <div style={DIVIDER} />

        {/* 공실/체류 예측 */}
        <div style={SECTION_HDR}>점유 예측</div>
        <Row
          label="공실 예정"
          value={forecast ? fmtOccupancy(forecast.vacantRooms, forecast.vacantNights, forecast.vacancyRate) : '—'}
          gray={forecast?.vacantRooms === 0}
        />
        <Row
          label="체류 예정"
          value={forecast ? fmtOccupancy(forecast.occupiedRooms, forecast.occupiedNights, forecast.occupancyRate) : '—'}
          last
        />
      </div>

      {drilldown && (
        <DrilldownSheet
          metricLabel={drilldownLabel}
          staticItems={drilldownRows}
          renderItem={({ item, view }) => (
            <ViolationRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              view={view}
              dateLabel={view.when}
              onClick={() => {
                setDrilldown(null);
                onSelectRoom?.(item.property_id);
              }}
            />
          )}
          emptyMessage="해당 건 없음"
          emptyIcon="✅"
          onClose={() => setDrilldown(null)}
        />
      )}
    </>
  );
}
