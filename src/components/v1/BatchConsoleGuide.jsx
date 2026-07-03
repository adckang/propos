import React from "react";

import { getStageById } from "../../config/operationsModel.js";

function BatchConsoleGuide({ stageId, onBack }) {
  const stage = getStageById(stageId);
  const cards = [
    {
      label: "이 화면의 역할",
      value: "같은 단계 예외를 묶어서 처리",
      desc: `${stage.batchActionLabel} 기준으로 여러 숙소를 한 번에 정리합니다.`,
    },
    {
      label: "언제 들어오나",
      value: stage.portalTitle,
      desc: stage.decisionHint,
    },
    {
      label: "단건 처리 기준",
      value: "숙소 1건은 대표 숙소",
      desc: "메시지, IoT, 청소 맥락을 한 숙소에서 끝까지 해결해야 하면 커맨드 센터에서 대표 숙소 상세 보기로 넘깁니다.",
    },
  ];

  return (
    <div style={{ padding: "14px 20px 0", background: "#f0f4f8", flexShrink: 0 }}>
      <div
        style={{
          background: "#ffffff",
          border: `1.5px solid ${stage.border}`,
          borderTop: `4px solid ${stage.color}`,
          borderRadius: 16,
          padding: "16px 18px",
          boxShadow: "0 10px 28px rgba(15,23,42,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#94a3b8",
                marginBottom: 6,
              }}
            >
              {stage.code} Batch Console
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#1e293b",
                lineHeight: 1.4,
                letterSpacing: "-0.2px",
              }}
            >
              이 화면은 {stage.portalTitle} 단계의 여러 숙소를 한 번에 정리하는 배치 콘솔입니다.
            </div>
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginTop: 8 }}>
              같은 종류의 예외가 여러 숙소에 쌓였을 때는 여기서 선별, 재실행, 일괄 확인까지 처리하고,
              숙소 1건을 끝까지 해결하는 일은 대표 숙소 상세 보기에서 맡습니다.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: stage.color,
                background: stage.bg,
                border: `1px solid ${stage.border}`,
                borderRadius: 999,
                padding: "7px 12px",
                whiteSpace: "nowrap",
              }}
            >
              {stage.batchActionLabel}
            </span>
            {onBack && (
              <button
                onClick={onBack}
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1.5px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#475569",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                ← 커맨드 센터
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {cards.map((card) => (
            <div
              key={card.label}
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#94a3b8",
                  marginBottom: 6,
                }}
              >
                {card.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b", lineHeight: 1.45 }}>
                {card.value}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.65, marginTop: 6 }}>
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BatchConsoleGuide;
