// ── operationsModel.js ──────────────────────────────────────
// S01~S04는 자동화 건강도(automationHealth)의 2차 drill-down 필터입니다.
// 1차 축: 건강도 보드 (CommandCenter 상단)
// 2차 축: 운영 시점별 예외 숙소 필터 (아래 OPERATIONS_STAGES)
// S05 수익 정산은 실시간 IoT 파이프라인과 별개 — 서브 메뉴로 분리됩니다.

export const OPERATIONS_STAGES = [
  {
    id: "d1",
    code: "S01",
    emoji: "📅",
    label: "D-1 준비",
    portalTitle: "내일 체크인 준비",
    portalDescription: "체크인 전날 자동화 점검이 필요한 숙소를 봅니다. PIN, 웰컴 씬, 스마트홈 초기화가 정상인지 확인합니다.",
    desc: "체크인 D-1 시점 필터입니다. 자동화 점검이 필요한 예약 숙소를 찾아 사전에 안정화합니다.",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    scenarioScreen: "d1",
    filter: prop => prop.status === "예약됨" && prop.priority === "OK" && prop.unreadMsg === 0,
    portalFilter: prop => prop.status === "예약됨",
    batchActionLabel: "D-1 자동화 일괄 처리",
    decisionHint: "같은 단계 숙소가 여러 곳이면 D-1 일괄 처리로 넘깁니다.",
  },
  {
    id: "checkin",
    code: "S02",
    emoji: "🚪",
    label: "체크인 당일",
    portalTitle: "당일 입실 확인",
    portalDescription: "체크인 당일 자동화 이상 숙소를 봅니다. 도어락 응답, 웰컴 씬 실행 여부를 확인합니다.",
    desc: "체크인 당일 시점 필터입니다. 입실 자동화가 정상 실행됐는지 확인하고, 실패 시 즉시 복구합니다.",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    scenarioScreen: "s02",
    filter: prop => prop.status === "예약됨" && (prop.priority !== "OK" || prop.unreadMsg > 0),
    portalFilter: prop => prop.status === "예약됨" && (prop.priority !== "OK" || prop.unreadMsg > 0),
    batchActionLabel: "체크인 예외 일괄 처리",
    decisionHint: "입실 예외가 여러 건이면 체크인 당일 콘솔에서 묶어서 처리합니다.",
  },
  {
    id: "stay",
    code: "S03",
    emoji: "📡",
    label: "체류 중",
    portalTitle: "체류 중 대응",
    portalDescription: "체류 중 자동화 이상 숙소를 봅니다. 센서 미응답, 자동복구 실패, 원격 제어가 필요한 숙소를 확인합니다.",
    desc: "체류 중 시점 필터입니다. 자동 복구가 실패했거나 사람 개입이 필요한 숙소를 먼저 찾아 원격 대응합니다.",
    color: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
    scenarioScreen: "s03",
    filter: prop => prop.status === "입실중",
    portalFilter: prop => prop.status === "입실중" && (prop.priority === "HIGH" || prop.unreadMsg > 0 || prop.issues.length > 0),
    batchActionLabel: "체류 중 예외 일괄 처리",
    decisionHint: "센서 이상이나 메시지 예외가 여러 곳이면 체류 중 콘솔로 넘깁니다.",
  },
  {
    id: "checkout",
    code: "S04",
    emoji: "🧹",
    label: "퇴실·청소",
    portalTitle: "다음 예약 준비",
    portalDescription: "퇴실 이후 자동화 전환이 막힌 숙소를 봅니다. PIN 만료, 청소팀 배정, 스마트홈 초기화 완료 여부를 확인합니다.",
    desc: "퇴실·청소 시점 필터입니다. 자동 전환이 완료되지 않은 숙소를 찾아 다음 예약 준비를 안정화합니다.",
    color: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
    scenarioScreen: "s04",
    filter: prop => prop.status === "청소중" || prop.status === "점검중",
    portalFilter: prop => prop.status === "청소중" || prop.status === "점검중" || prop.issues.length > 0,
    batchActionLabel: "퇴실·청소 일괄 처리",
    decisionHint: "청소와 점검 정체가 여러 곳이면 퇴실·청소 콘솔에서 묶어 처리합니다.",
  },
  {
    id: "settlement",
    code: "S05",
    emoji: "💰",
    label: "수익 정산",
    portalTitle: "정산 검토",
    portalDescription: "IoT 파이프라인과 별개로 운영됩니다. 월 정산과 가격 판단에 사람이 검토할 숙소를 빠르게 모아 봅니다.",
    desc: "수익 정산은 실시간 자동화 파이프라인과 분리된 서브 메뉴입니다. 가격 추천과 정산 검토가 필요한 숙소를 확인합니다.",
    color: "#0891b2",
    bg: "#ecfeff",
    border: "#a5f3fc",
    scenarioScreen: "s05",
    filter: () => true,
    portalFilter: prop => Number(prop.rating) < 4.3 || prop.revenue >= 500000,
    batchActionLabel: "수익 정산 일괄 처리",
    decisionHint: "정산이나 가격 검토가 한 번에 필요할 때 정산 콘솔로 넘깁니다.",
  },
];

export function getStageById(stageId) {
  return OPERATIONS_STAGES.find(stage => stage.id === stageId) || OPERATIONS_STAGES[0];
}

export function getPortalStageCards(props) {
  return OPERATIONS_STAGES.map(stage => ({
    ...stage,
    count: props.filter(stage.portalFilter || stage.filter).length,
  }));
}
