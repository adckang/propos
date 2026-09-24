/**
 * FutureMatrixPanel — 미래 기간 운영 준비 현황 (Template-F)
 * 적용: next_week / tomorrow (기간 전체) + this_week / this_month 의 [예정] (지금 ~ 기간 끝)
 * → 대시보드(현황 대시보드) 화면의 "다음달" 탭에서도 이 컴포넌트가 그대로 쓰인다 (ReportPanel이 tense로 분기).
 *
 * 표시 항목 (2026-09-24 재구성 — 한 화면에 너무 많이 보여주지 않기 원칙, 팝업으로 세부 확인):
 *   체크인 예정 N건
 *   퇴실예정 N건        ← 예약 건수는 순차적으로 한 줄씩, 청소 배정과 섞지 않음 (클릭 없음)
 *   청소배정
 *     배정완료 M건
 *     미배정 K건 ›      ← 지금처럼 컬러(0보다 크면 빨강). 누르면 팝업으로 "배정 요청중 / 수동배정 필요"를
 *                          보여준다(배정완료는 이미 위에 보이므로 팝업엔 안 넣음). 각 줄을 또 누르면
 *                          그 상태의 숙소별 상세 목록(급한 순, 신호등 색)으로 팝업이 전환된다.
 *   공실률 NN% → 누르면 팝업으로 **공실률 높은 순 숙소 리스트**(각자 자기 공실률 %, 10개씩 다음 버튼으로 넘김)를
 *     보여준다. (합계 "체류 N·공실 N" 2줄로는 어느 숙소가 비어있는지 알 수 없다는 피드백으로 목록으로 교체)
 *
 * 디자인 변경 이력 (같은 날 다섯 번 수정 — 재작업 금지, 최종본이 아래):
 *   1차: 8줄을 3줄로 접되 인라인 아코디언으로 펼침
 *   2차: 퇴실예정 안에 청소 배정을 끼워 넣었는데 → "퇴실예정 건수는 따로, 청소배정은 별도로 세고 싶다"
 *   3차: 세부 데이터는 인라인 아코디언이 아니라 팝업(DrilldownSheet)으로 → 체크인/퇴실은 나란히 한 줄로
 *   4차: "체크인/퇴실예정은 나란히 말고 순차적으로. 배정완료/미배정도 각각 줄로 나누고, 미배정 팝업엔
 *        배정완료를 뺀다. 배정 요청중도 수동배정 필요처럼 눌러서 세부 목록 보이게"
 *   5차: 공실률 팝업의 "체류/공실" 합계 2줄 → 공실률 높은 숙소 순 리스트(10개 단위, 다음 버튼)로 교체
 *
 * "입실예정" 클릭 시 기기 상태(장치문제/장치상태)를 보여주는 안은 보류
 * (실제 기기가 연결된 숙소가 현재 1곳뿐이라 나머지는 값을 지어내야 함 — 나중에 별도 진행, D-019 참고).
 *
 * 데이터 소스:
 *   체크인/아웃, 공실/체류 → properties[].reservations (gantt와 동일)
 *   청소 배정 4분류 → /api/cleaning/stats?period=&items=true (DB, items=true 응답의 items[] 는 전체 잡을
 *   상태 그대로 담고 있어 "배정 요청중" 목록도 서버 추가 없이 여기서 상태로 걸러 쓴다)
 *
 * "수동배정 필요"·"배정 요청중" 상세 목록은 체크아웃이 가까운(급한) 건이 위로 오게 정렬하고, 줄마다
 * 구어체 한 줄로 무슨 상황인지 알려준다 (violationDetailDomain). 수동배정 필요는 급한 정도를 줄 색(빨강/주황)
 * 으로, 배정 요청중은 아직 문제가 아니라 회색(정보)으로만 표시한다.
 */

import { useState, useEffect, useMemo } from 'react';
import { periodToRemainingRange } from '../../../domain/periodDomain.js';
import {
  countWeekCheckIns,
  countWeekCheckOuts,
  getOccupancyForecast,
  getPropertyVacancyRates,
} from '../../../domain/futureWeekDomain.js';
import DrilldownSheet from './DrilldownSheet.jsx';
import ViolationRow from './ViolationRow.jsx';
import { resolvePropertyName } from '../../../domain/propertyNameDomain.js';
import { buildCleaningIssueRows, buildMixedCleaningIssueRows } from '../../../domain/violationDetailDomain.js';

// 서버 SQL(api/cleaning/[...slug].js)·MonthlyCalendar.jsx 와 같은 분류 — "아직 자동으로 진행 중"인 상태들
const REQUESTING_STATUSES = new Set([
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED',
]);

const VACANCY_PAGE_SIZE = 10;

// ── 스타일 상수 ──────────────────────────────────────────────────────────────
const ROW_BASE = {
  display: 'flex', alignItems: 'center',
  padding: '9px 0', fontSize: 13,
};
const LABEL_STYLE = { flex: 1, color: '#475569' };
const VAL_STYLE   = { fontWeight: 600, color: '#1e293b', textAlign: 'right' };
const DIVIDER     = { borderTop: '1px solid #e2e8f0', margin: '6px 0' };
const SECTION_HDR = { fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', marginBottom: 4, marginTop: 8 };

/** 한 줄 — 정보성(클릭 없음) 또는 팝업을 여는 줄(onClick 있으면 › 표시) */
function Row({ label, value, red = false, onClick, last = false }) {
  const base = { ...ROW_BASE, borderBottom: last ? 'none' : '1px solid #f1f5f9' };
  const valStyle = red ? { ...VAL_STYLE, color: '#dc2626' } : VAL_STYLE;
  if (!onClick) {
    return (
      <div style={base}>
        <span style={LABEL_STYLE}>{label}</span>
        <span style={valStyle}>{value}</span>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      style={{ background: 'none', border: 'none', ...base, cursor: 'pointer', width: '100%', textAlign: 'left' }}
    >
      <span style={LABEL_STYLE}>{label}</span>
      <span style={valStyle}>{value}</span>
      <span aria-hidden="true" style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>
    </button>
  );
}

/** 팝업 안의 한 줄 — 정보성(클릭 없음) 또는 다음 팝업으로 넘어가는 줄(onClick 있으면 › 표시) */
function StatRow({ label, value, red = false, onClick }) {
  const color = red ? '#dc2626' : '#1e293b';
  const content = (
    <>
      <span style={{ flex: 1, fontSize: 13, color: '#475569' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{value}</span>
      {onClick && <span aria-hidden="true" style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>›</span>}
    </>
  );
  if (!onClick) {
    return <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>{content}</div>;
  }
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', width: '100%',
        padding: '14px 16px',
        background: 'none', borderWidth: 0, borderBottomWidth: 1, borderStyle: 'solid', borderColor: '#f1f5f9',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}
    >{content}</button>
  );
}

/** 공실률 목록의 숙소 한 줄 — 이름 + 공실률, 누르면 그 숙소 상세로 */
function VacancyRow({ name, vacancyRate, occupiedNights, vacantNights, onClick }) {
  const pct = Math.round(vacancyRate * 100);
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', width: '100%',
        padding: '12px 16px',
        background: 'none', borderWidth: 0, borderBottomWidth: 1, borderStyle: 'solid', borderColor: '#f1f5f9',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}
    >
      <span style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', display: 'block' }}>{name}</span>
        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'block' }}>{`체류 ${occupiedNights}박 · 공실 ${vacantNights}박`}</span>
      </span>
      <span style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{pct}%</span>
      <span aria-hidden="true" style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>›</span>
    </button>
  );
}

/** 공실률 목록 하단 페이지 넘김 — 10개 단위 */
function VacancyPager({ page, totalPages, onPrev, onNext }) {
  if (totalPages <= 1) return null;
  const btnStyle = (enabled) => ({
    flex: 1, padding: '12px 0', background: '#fff', border: 'none',
    color: enabled ? '#1e293b' : '#cbd5e1', fontWeight: 700, fontSize: 13,
    cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button onClick={onPrev} disabled={page === 0} style={btnStyle(page > 0)}>‹ 이전</button>
      <span style={{ fontSize: 12, color: '#94a3b8', padding: '0 12px', flexShrink: 0 }}>{page + 1} / {totalPages}</span>
      <button onClick={onNext} disabled={page >= totalPages - 1} style={btnStyle(page < totalPages - 1)}>다음 ›</button>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function FutureMatrixPanel({ stats, period, properties = [], propertyIds = null, isMobile = false, onSelectRoom }) {
  const [cleaningStats,   setCleaningStats]   = useState(null);
  const [cleaningLoading, setCleaningLoading] = useState(true);
  const [cleaningError,   setCleaningError]   = useState(false);
  const [unassignedPopup,   setUnassignedPopup]   = useState(false); // 미배정 팝업 (배정요청중/수동배정필요)
  const [occupancyPopup,    setOccupancyPopup]    = useState(false); // 공실률 팝업 (숙소별 공실률 순위)
  const [vacancyPage,       setVacancyPage]       = useState(0);     // 공실률 팝업 — 10개 단위 페이지
  const [manualOpen,        setManualOpen]        = useState(false); // 수동배정 필요 상세 목록 팝업
  const [requestingOpen,    setRequestingOpen]    = useState(false); // 배정 요청중 상세 목록 팝업

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

  // 숙소별 공실률 — 공실률 팝업용. 높은 순으로 정렬해서 어느 숙소가 비어있는지 바로 보이게.
  const vacancyList = useMemo(() => (range
    ? [...getPropertyVacancyRates(properties, range.from, range.to)].sort((a, b) => b.vacancyRate - a.vacancyRate)
    : []),
  [properties, fromMs, toMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const vacancyTotalPages = Math.max(1, Math.ceil(vacancyList.length / VACANCY_PAGE_SIZE));
  const vacancyPageItems  = vacancyList.slice(vacancyPage * VACANCY_PAGE_SIZE, vacancyPage * VACANCY_PAGE_SIZE + VACANCY_PAGE_SIZE);

  // 수동배정 필요 상세 목록 — 배정 실패 + 배정 요청 필요를 하나로 합쳐 급한 순 정렬. 팝업이 열려 있을 때만 계산.
  const manualRows = useMemo(() => {
    if (!manualOpen) return [];
    const entries = [
      ...(cleaningStats?.failedItems ?? []).map(item => ({ kind: 'failed', item })),
      ...(cleaningStats?.needsRequestItems ?? []).map(item => ({ kind: 'needsRequest', item })),
    ];
    return buildMixedCleaningIssueRows(entries, Date.now());
  }, [manualOpen, cleaningStats]);

  // 배정 요청중 상세 목록 — items(전체 잡)에서 진행 중 상태만 걸러서 사용. 팝업이 열려 있을 때만 계산.
  const requestingRows = useMemo(() => {
    if (!requestingOpen) return [];
    const items = (cleaningStats?.items ?? []).filter(item => REQUESTING_STATUSES.has(item.status));
    return buildCleaningIssueRows('requesting', items, Date.now());
  }, [requestingOpen, cleaningStats]);

  // 훅 호출이 모두 끝난 뒤에만 조건부 return (Rules of Hooks)
  if (!stats) return null;

  // 청소 배정 4분류 값 — "배정완료" vs 그 나머지(="미배정" = 배정요청중 + 수동배정 필요)로 다시 묶는다
  const csAssigned   = cleaningStats?.assigned    ?? null;
  const csRequesting = cleaningStats?.requesting  ?? null;
  const csNeedsReq   = cleaningStats?.needsRequest ?? null;
  const csFailed     = cleaningStats?.failed      ?? null;
  const cleaningReady = !cleaningLoading && !cleaningError && csAssigned != null;
  const csManual     = cleaningReady ? (csNeedsReq ?? 0) + (csFailed ?? 0) : null;       // 수동배정 필요 (실패+재요청)
  const csUnassigned = cleaningReady ? (csManual ?? 0) + (csRequesting ?? 0) : null;      // 미배정 전체

  const fmtCleaning = (val) => {
    if (cleaningLoading) return '—';
    if (cleaningError)   return '오류';
    if (val == null)     return '—';
    return `${val}건`;
  };

  const unassignedClickable = cleaningReady && (csUnassigned ?? 0) > 0;
  const manualClickable     = cleaningReady && (csManual ?? 0) > 0;
  const requestingClickable = cleaningReady && (csRequesting ?? 0) > 0;

  // 공실률 — 기간 전체 박수 기준 (기존 "공실 예정" 줄의 %)
  const vacancyPct = forecast ? Math.round(forecast.vacancyRate * 100) : null;

  const pad = isMobile ? '10px 12px' : '14px 20px';

  return (
    <>
      <div style={{ padding: pad }}>

        {/* 예약 — 체크인/퇴실 예정 건수는 순차적으로 한 줄씩, 청소 배정과 섞지 않는다 (클릭 없음) */}
        <div style={SECTION_HDR}>예약</div>
        <Row label="체크인 예정" value={`${checkIns}건`} />
        <Row label="퇴실예정"   value={`${checkOuts}건`} last />

        <div style={DIVIDER} />

        {/* 청소배정 — 퇴실예정과는 다른 숫자(체크아웃엔 아직 청소 잡이 안 만들어진 경우도 있음). 별도 카운트 */}
        <div style={SECTION_HDR}>청소배정</div>
        <Row label="배정완료" value={fmtCleaning(csAssigned)} />
        <Row
          label="미배정"
          value={fmtCleaning(csUnassigned)}
          red={cleaningReady && csUnassigned > 0}
          onClick={unassignedClickable ? () => setUnassignedPopup(true) : undefined}
          last
        />

        <div style={DIVIDER} />

        {/* 점유 예측 */}
        <div style={SECTION_HDR}>점유 예측</div>
        <Row
          label="공실률"
          onClick={() => { setVacancyPage(0); setOccupancyPopup(true); }}
          value={vacancyPct != null ? `${vacancyPct}%` : '—'}
          last
        />
      </div>

      {/* 미배정 팝업 — 배정 요청중 / 수동배정 필요 (배정완료는 이미 위에 보이므로 여기 안 넣음) */}
      {unassignedPopup && (
        <DrilldownSheet
          metricLabel="미배정"
          staticItems={[
            { key: 'requesting', label: '배정 요청중',  value: fmtCleaning(csRequesting), clickable: requestingClickable },
            { key: 'manual',     label: '수동배정 필요', value: fmtCleaning(csManual), red: manualClickable, clickable: manualClickable },
          ]}
          renderItem={(row) => (
            <StatRow
              key={row.key}
              label={row.label}
              value={row.value}
              red={row.red}
              onClick={row.clickable ? () => {
                setUnassignedPopup(false);
                if (row.key === 'requesting') setRequestingOpen(true);
                else setManualOpen(true);
              } : undefined}
            />
          )}
          emptyMessage="해당 건 없음"
          emptyIcon="✅"
          onClose={() => setUnassignedPopup(false)}
        />
      )}

      {/* 공실률 팝업 — 공실률 높은 숙소 순 리스트, 10개씩 다음 버튼으로 넘김 */}
      {occupancyPopup && (
        <DrilldownSheet
          metricLabel={`공실률 ${vacancyPct != null ? vacancyPct : '—'}% · 공실률 높은 순`}
          staticItems={vacancyPageItems}
          renderItem={(row) => (
            <VacancyRow
              key={row.property_id}
              name={row.property_name}
              vacancyRate={row.vacancyRate}
              occupiedNights={row.occupiedNights}
              vacantNights={row.vacantNights}
              onClick={() => {
                setOccupancyPopup(false);
                onSelectRoom?.(row.property_id);
              }}
            />
          )}
          emptyMessage="숙소가 없음"
          emptyIcon="🏠"
          footer={
            <VacancyPager
              page={vacancyPage}
              totalPages={vacancyTotalPages}
              onPrev={() => setVacancyPage(p => Math.max(0, p - 1))}
              onNext={() => setVacancyPage(p => Math.min(vacancyTotalPages - 1, p + 1))}
            />
          }
          onClose={() => setOccupancyPopup(false)}
        />
      )}

      {/* 수동배정 필요 상세 목록 팝업 — 숙소별, 급한 순, 신호등 색 */}
      {manualOpen && (
        <DrilldownSheet
          metricLabel="수동배정 필요"
          staticItems={manualRows}
          renderItem={({ item, view }) => (
            <ViolationRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              view={view}
              dateLabel={view.when}
              onClick={() => {
                setManualOpen(false);
                onSelectRoom?.(item.property_id);
              }}
            />
          )}
          emptyMessage="해당 건 없음"
          emptyIcon="✅"
          onClose={() => setManualOpen(false)}
        />
      )}

      {/* 배정 요청중 상세 목록 팝업 — 숙소별, 진행 단계 문장 (회색·정보성, 아직 문제 아님) */}
      {requestingOpen && (
        <DrilldownSheet
          metricLabel="배정 요청중"
          staticItems={requestingRows}
          renderItem={({ item, view }) => (
            <ViolationRow
              key={`${item.property_id}-${item.checkout_at}`}
              name={resolvePropertyName(properties, item.property_id, item.property_name)}
              view={view}
              dateLabel={view.when}
              onClick={() => {
                setRequestingOpen(false);
                onSelectRoom?.(item.property_id);
              }}
            />
          )}
          emptyMessage="해당 건 없음"
          emptyIcon="✅"
          onClose={() => setRequestingOpen(false)}
        />
      )}
    </>
  );
}
