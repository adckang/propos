/**
 * InsightDrilldownSheet — "발견된 패턴"(insightDomain) 한 건을 눌렀을 때 뜨는 상세 팝업 (D-028).
 *
 * 기존 DrilldownSheet(딤 배경 + 바텀시트 + footer 슬롯)를 그대로 재사용하고, 인사이트의 모양
 * (insightActionGuideDomain.insightDrilldownShape)에 따라 안에 넣을 내용만 바꾼다:
 *   - property_items      — 그 숙소·그 지표의 실제 실패 목록 (기존 async 드릴다운 그대로)
 *   - property_no_history — 건별 기록이 없는 지표(cleaning_assign) — 정직하게 "기록 없음"만 표시
 *   - scope_comparison    — 숙소 특정이 안 되는 패턴 — 기간별 비교 수치만 표시
 * 어느 모양이든 하단엔 "해야 할 일"(타입 힌트 + 지표 체크리스트)을 고정으로 보여준다.
 */

import DrilldownSheet from './DrilldownSheet.jsx';
import { insightDrilldownShape, describeInsightAction, buildScopeComparisonRows, describeScopeComparisonTitle } from '../../../domain/insightActionGuideDomain.js';

function ActionFooter({ insight, propertyName }) {
  return (
    <div style={{ padding: '12px 16px', background: '#f8fafc' }}>
      {propertyName && (
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          📍 {propertyName}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>해야 할 일 </span>
        {describeInsightAction(insight)}
      </div>
    </div>
  );
}

function ComparisonRow({ label, text }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 13,
    }}>
      <span style={{ fontWeight: 700, color: '#1e293b' }}>{label}</span>
      <span style={{ color: '#475569', fontFamily: "'DM Mono', monospace" }}>{text}</span>
    </div>
  );
}

export default function InsightDrilldownSheet({ insight, onClose, onSelectRoom, properties = [] }) {
  const shape = insightDrilldownShape(insight);

  if (shape === 'property_items') {
    return (
      <DrilldownSheet
        metric={insight.metricKey}
        metricLabel={insight.metricLabel}
        period={insight.periodKey}
        propertyIds={[insight.propertyId]}
        properties={properties}
        onSelectRoom={onSelectRoom}
        footer={<ActionFooter insight={insight} />}
        onClose={onClose}
      />
    );
  }

  if (shape === 'property_no_history') {
    return (
      <DrilldownSheet
        metricLabel={insight.metricLabel}
        staticItems={['no-history']}
        renderItem={(_item, i) => (
          <div key={i} style={{ padding: '28px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>건별 상세 기록은 없어요</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              이 지표는 집계 수치만 확인할 수 있어요 (표 참고)
            </div>
          </div>
        )}
        footer={<ActionFooter insight={insight} propertyName={insight.propertyName} />}
        onClose={onClose}
      />
    );
  }

  // scope_comparison — MONTH_OVER_MONTH/CONSECUTIVE, 숙소 특정 안 됨
  const rows = buildScopeComparisonRows(insight);
  return (
    <DrilldownSheet
      metricLabel={`${insight.metricLabel}${describeScopeComparisonTitle(insight)}`}
      staticItems={rows}
      renderItem={(row, i) => <ComparisonRow key={i} label={row.label} text={row.text} />}
      emptyMessage="비교할 데이터가 없어요"
      footer={<ActionFooter insight={insight} />}
      onClose={onClose}
    />
  );
}
