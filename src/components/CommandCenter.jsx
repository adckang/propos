import { useEffect, useState } from "react";

import { ALL_PROPS, INIT_ALERTS, SC, rand, randN } from "../data/mockData";
import { OPERATIONS_STAGES, getStageById } from "../config/operationsModel.js";
import Toast from "../utils/toast";

// ============================================================
// CommandCenter.jsx — 전체 숙소 지휘 센터
// 시나리오 1~5를 기준으로 100개 숙소를 한눈에 보는 운영 화면
// ============================================================

const CC_STAGES = OPERATIONS_STAGES;
const TRIAGE_TONES = {
  critical: { color:"#dc2626", strong:"#b91c1c", bg:"#fef2f2", border:"#fecaca" },
  high: { color:"#ea580c", strong:"#c2410c", bg:"#fff7ed", border:"#fdba74" },
  watch: { color:"#ca8a04", strong:"#a16207", bg:"#fefce8", border:"#fde047" },
  normal: { color:"#059669", strong:"#047857", bg:"#ecfdf5", border:"#a7f3d0" },
  neutral: { color:"#111827", strong:"#111827", bg:"#ffffff", border:"#dbe4ee" },
  muted: { color:"#475569", strong:"#334155", bg:"#f8fafc", border:"#e2e8f0" },
};

const STATUS_BADGE_TONE = {
  color:"#334155",
  bg:"#f8fafc",
  border:"#cbd5e1",
};

function hasUrgentSignal(prop) {
  return prop.priority === "HIGH" || prop.issues.length > 0
    || prop.doorLockStatus === "오프라인" || prop.sensorHealth === "미연결";
}

const INTERVENTION_TYPES = {
  시스템장애: { color:"#dc2626", bg:"#fef2f2", border:"#fecaca", label:"시스템 장애" },
  현장출동:   { color:"#ea580c", bg:"#fff7ed", border:"#fdba74", label:"현장 출동" },
  게스트안내: { color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe", label:"게스트 안내" },
  청소확인:   { color:"#d97706", bg:"#fffbeb", border:"#fde68a", label:"청소 확인" },
  원격제어:   { color:"#059669", bg:"#f0fdf4", border:"#a7f3d0", label:"원격 제어" },
};

function getInterventionType(prop) {
  if (prop.sensorHealth === "미연결" || prop.doorLockStatus === "오프라인") return "시스템장애";
  if (prop.doorLockStatus === "배터리부족" || prop.doorLockStatus === "미응답"
    || (prop.issues || []).some(i => i.includes("온수") || i.includes("에어컨"))) return "현장출동";
  if (prop.unreadMsg > 0) return "게스트안내";
  if (prop.status === "청소중" || prop.status === "점검중") return "청소확인";
  return "원격제어";
}

function isActionableForStage(stageId, prop) {
  if(stageId === "d1"){
    return prop.status === "예약됨";
  }
  if(stageId === "checkin"){
    return prop.status === "예약됨" && (hasUrgentSignal(prop) || prop.unreadMsg > 0);
  }
  if(stageId === "stay"){
    return prop.status === "입실중" && (hasUrgentSignal(prop) || prop.unreadMsg > 0);
  }
  if(stageId === "checkout"){
    return prop.status === "청소중" || prop.status === "점검중" || prop.issues.length > 0;
  }
  if(stageId === "settlement"){
    return Number(prop.rating) < 4.3 || prop.revenue >= 500000;
  }
  return false;
}

function getStageSummary(stageId, matched) {
  const urgent = matched.filter(hasUrgentSignal).length;
  const actionable = matched.filter(prop=>!hasUrgentSignal(prop) && isActionableForStage(stageId, prop)).length;
  const watch = Math.max(matched.length - urgent - actionable, 0);

  if(urgent > 0){
    return {
      toneKey: "critical",
      label: "긴급",
      focusCount: urgent,
      text: "즉시 확인 필요",
      urgent,
      actionable,
      watch,
    };
  }

  if(actionable > 0){
    return {
      toneKey: "high",
      label: "처리",
      focusCount: actionable,
      text: "우선 정리 필요",
      urgent,
      actionable,
      watch,
    };
  }

  if(watch > 0){
    return {
      toneKey: "watch",
      label: "주시",
      focusCount: watch,
      text: "흐름 확인 필요",
      urgent,
      actionable,
      watch,
    };
  }

  return {
    toneKey: "normal",
    label: "정상",
    focusCount: 0,
    text: "사람 개입 없음",
    urgent,
    actionable,
    watch,
  };
}

function getIoTIssueSummary(prop) {
  const dl = prop.doorLockStatus;
  const sh = prop.sensorHealth;
  if (dl === "오프라인") return "도어락이 완전히 오프라인이에요. 현장 확인이 필요합니다.";
  if (dl === "미응답") return "도어락이 응답하지 않아요. 원격 제어가 불가능한 상태입니다.";
  if (dl === "배터리부족") return "도어락 배터리가 부족해요. 교체 전 게스트 안내가 필요해요.";
  if (sh === "미연결") return "센서 전체가 미연결이에요. IoT 허브 상태를 확인해야 해요.";
  if (sh === "일부불량") return "일부 센서가 끊겼어요. 어떤 센서인지 확인이 필요해요.";
  return null;
}

function getIssueSummary(issue = "") {
  if(issue.includes("Wi-Fi")){
    return "WiFi 허브 자동복구 실패 · 원격 재부팅 필요";
  }
  if(issue.includes("에어컨")){
    return "에어컨 자동제어 무응답 · HA 엔티티 재연동 필요";
  }
  if(issue.includes("도어락")){
    return "도어락 배터리 임계치 도달 · 현장 교체 예약 필요";
  }
  if(issue.includes("온수")){
    return "온수 센서 이상 감지 · 보일러 원격 상태 확인 필요";
  }
  if(issue.includes("청소")){
    return "청소 완료 신호 미수신 · 다음 체크인 전 확인 필요";
  }
  if(issue.includes("소음")){
    return "소음 임계치 초과 감지 · 자동 경보 발송 완료 · 추가 조치 확인";
  }
  if(issue.includes("PIN")){
    return "PIN 자동 발급 실패 · D-1 자동화 재실행 필요";
  }
  if(issue.includes("웰컴") || issue.includes("메시지")){
    return "웰컴 씬 자동 발송 실패 · 수동 트리거 필요";
  }
  if(issue.includes("스마트홈") || issue.includes("초기화")){
    return "스마트홈 초기화 씬 실행 실패 · HA에서 재실행 필요";
  }
  if(issue.includes("유지보수")){
    return "유지보수 항목 미처리 · 다음 체크인 전 완료 필요";
  }
  if(issue.includes("청소팀")){
    return "청소팀 자동 배정 실패 · 수동 배정 필요";
  }
  if(issue.includes("충돌")){
    return "청소 일정 ↔ 다음 체크인 시간 충돌 · 일정 조율 필요";
  }
  return issue || "자동화 이슈 확인";
}

function getMessageTopic(prop, stageId) {
  const topicMap = {
    d1: ["사전 안내 확인", "입실 준비 확인", "PIN 안내 요청", "체크인 안내 확인"],
    checkin: ["입실 방법 문의", "PIN 재안내 요청", "주차 위치 문의", "체크인 시간 문의"],
    stay: ["체크아웃 시간 문의", "와이파이 안내 요청", "온도 조절 요청", "주차 문의"],
    checkout: ["체크아웃 절차 문의", "짐 보관 문의", "분실물 문의", "청소 시간 문의"],
    settlement: ["리뷰 정산 문의", "할인 반영 문의", "가격 변경 확인", "수익 내역 점검"],
  };
  const topics = topicMap[stageId] || topicMap.stay;
  return topics[prop.id % topics.length];
}

function getActionBrief(prop, stageId) {
  // IoT 물리 상태 이상이 최우선
  const iotSummary = getIoTIssueSummary(prop);
  if(iotSummary) return iotSummary;

  if(prop.issues.length > 0){
    return getIssueSummary(prop.issues[0]);
  }

  if(prop.unreadMsg > 0){
    return `문의: ${getMessageTopic(prop, stageId)}`;
  }

  if(stageId === "d1"){
    return `${prop.checkIn || "내일"} 체크인 · PIN/메시지 확인`;
  }

  if(stageId === "checkin"){
    return `${prop.checkIn || "오늘"} 입실 · 체크인 흐름 확인`;
  }

  if(stageId === "checkout"){
    return prop.status === "점검중"
      ? "점검 지연 · 다음 예약 전 확인"
      : "청소 진행 중 · 마감 확인";
  }

  if(stageId === "settlement"){
    return `매출 ${(prop.revenue / 10000).toFixed(0)}만원 · 평점 ${prop.rating}`;
  }

  if(prop.humidity >= 60){
    return `습도 ${prop.humidity}% 임계치 초과 · 제습 자동화 확인 필요`;
  }

  if(prop.temp >= 27){
    return `실내 온도 ${prop.temp}° 상승 · 에어컨 원격 가동 필요`;
  }

  return `자동 모니터링 정상 · 온도 ${prop.temp}° · 습도 ${prop.humidity}%`;
}

function getActionInstruction(prop, stageId) {
  const issue = prop.issues[0] || "";
  const topic = getMessageTopic(prop, stageId);

  // IoT 물리 상태 해결책 우선
  const dl = prop.doorLockStatus;
  const sh = prop.sensorHealth;
  if(dl === "오프라인") return "HA에서 도어락 엔티티 상태를 확인하고, 오프라인이면 현장 방문 또는 배터리 교체 기사를 바로 잡아주세요.";
  if(dl === "미응답") return "HA에서 도어락에 원격 명령을 한 번 보내보고 응답이 없으면 배터리 또는 허브 연결을 확인해주세요.";
  if(dl === "배터리부족") return "배터리 교체 기사를 먼저 잡고, 게스트에겐 배터리 교체 예정 시간과 비상 연락처를 바로 안내해주세요.";
  if(sh === "미연결") return "HA 허브(라즈베리파이) 전원과 Tailscale 연결을 먼저 확인해주세요. 전체 센서가 끊겼을 때는 허브 재시작이 가장 빠릅니다.";
  if(sh === "일부불량") return "HA 대시보드에서 unavailable 엔티티부터 찾고, 해당 기기 전원과 Wi-Fi 연결을 확인해주세요.";

  if(issue.includes("Wi-Fi")){
    return "HA → 스마트 플러그 엔티티에서 WiFi 허브 전원을 원격 재부팅하세요. 재연결 실패 시 현장 출동으로 전환합니다.";
  }
  if(issue.includes("에어컨")){
    return "HA에서 climate 엔티티 상태를 확인 후 24°C로 원격 재설정하세요. 엔티티 자체가 unavailable이면 허브 재부팅이 필요합니다.";
  }
  if(issue.includes("도어락")){
    return "도어락 배터리 교체 일정을 잡고, 다음 체크인 전 완료되도록 현장 조치를 예약하세요.";
  }
  if(issue.includes("온수")){
    return "HA에서 보일러 엔티티 상태를 확인하고, unavailable이면 스마트 플러그 재부팅으로 보일러를 재시작하세요.";
  }
  if(issue.includes("청소")){
    return "청소팀 앱에서 완료 상태를 확인하세요. 미완료면 다음 체크인까지 완료 가능한지 확인 후 일정을 재조정합니다.";
  }
  if(issue.includes("소음")){
    return "HA 소음 센서 로그에서 발생 시간대와 수치를 확인하세요. 임계치 초과 알림은 자동 발송 완료됩니다.";
  }
  if(issue.includes("PIN")){
    return "D-1 자동화 패널에서 PIN 발급을 수동으로 재실행하세요. 발급 완료 후 HA persistent_notification에서 PIN을 확인할 수 있습니다.";
  }
  if(issue.includes("웰컴") || issue.includes("메시지")){
    return "D-1 패널에서 웰컴 씬을 수동 트리거하세요. HA에서 automation 실행 로그를 확인해 실패 원인을 파악합니다.";
  }
  if(issue.includes("스마트홈") || issue.includes("초기화")){
    return "HA에서 스마트홈 초기화 씬을 수동으로 재실행하세요. 조명·에어컨·도어락 초기화 순서로 각 엔티티 응답을 확인합니다.";
  }
  if(issue.includes("청소팀")){
    return "청소 인력 목록에서 가용 인원을 확인하고 수동 배정하세요. 가용 인원이 없으면 외부 업체에 긴급 배정을 요청합니다.";
  }
  if(issue.includes("유지보수")){
    return "유지보수 항목을 확인하고, 다음 체크인 전 완료 가능한 일정인지 판단하세요. 불가능하면 예약 조정이 필요합니다.";
  }
  if(issue.includes("충돌")){
    return "청소 완료 예정 시간과 다음 체크인 시간을 비교하세요. 충돌이 확정되면 다음 예약에 지연 안내를 선제적으로 발송합니다.";
  }

  if(prop.unreadMsg > 0){
    if(topic.includes("와이파이") || topic.includes("WiFi")){
      return "HA에서 WiFi AP 상태를 확인 후 원격 재부팅하세요. 복구 완료 후 게스트에게 재연결 안내를 발송합니다.";
    }
    if(topic.includes("온도")){
      return "HA에서 현재 실내 온도를 확인하고 에어컨 설정값을 원격으로 조정하세요.";
    }
    if(topic.includes("PIN") || topic.includes("입실 방법")){
      return "HA 자동화 로그에서 PIN 발급 이력을 확인하세요. 발급 실패면 D-1 패널에서 수동 재발급합니다.";
    }
    return `게스트 미확인 메시지 ${prop.unreadMsg}건 · HA 자동 답장 로그를 먼저 확인하세요.`;
  }

  if(stageId === "d1"){
    return "D-1 자동화 체크리스트 — PIN 발급, 웰컴 씬, 스마트홈 초기화 상태를 순서대로 확인하세요.";
  }

  if(stageId === "checkin"){
    return "HA 입실 자동화 실행 로그를 확인하세요. 씬 실행 실패 항목이 있으면 수동으로 재트리거합니다.";
  }

  if(stageId === "checkout"){
    return prop.status === "점검중"
      ? "점검 항목 완료 여부를 확인하고, 다음 체크인 전까지 완료 가능한 일정인지 판단하세요."
      : "청소 완료 신호를 확인하세요. 신호가 없으면 청소팀 앱에서 수동으로 완료 처리합니다.";
  }

  if(stageId === "settlement"){
    return "이달 수익 정산 내역을 검토하세요. AI 가격 최적화 추천이 적용됐는지 확인합니다.";
  }

  if(prop.humidity >= 60){
    return `현재 습도 ${prop.humidity}% — HA에서 에어컨 제습 모드를 원격으로 실행하세요.`;
  }

  if(prop.temp >= 27){
    return `현재 온도 ${prop.temp}° — HA에서 에어컨을 24°C로 원격 가동하세요.`;
  }

  return `센서 정상 · 온도 ${prop.temp}° / 습도 ${prop.humidity}% — 자동 모니터링 중`;
}

function getActionToneKey(prop) {
  if(hasUrgentSignal(prop)){
    return "critical";
  }
  if(prop.unreadMsg > 0 || prop.status === "청소중" || prop.status === "점검중"){
    return "high";
  }
  if(prop.status === "예약됨"){
    return "watch";
  }
  return "normal";
}

function getIoTRisk(prop) {
  if (prop.doorLockStatus === "오프라인" || prop.sensorHealth === "미연결") return 0;
  if (prop.doorLockStatus === "미응답" || prop.sensorHealth === "일부불량") return 1;
  if (prop.doorLockStatus === "배터리부족") return 2;
  return 3;
}

function getUrgencyRank(prop, stageId) {
  const iotRisk = getIoTRisk(prop);
  if (iotRisk < 2) return iotRisk;

  if(hasUrgentSignal(prop)){
    return 2;
  }

  if(prop.unreadMsg > 0){
    return 3;
  }

  if(stageId === "checkout" && (prop.status === "청소중" || prop.status === "점검중")){
    return 4;
  }

  if(stageId === "checkin"){
    return 5;
  }

  if(stageId === "d1"){
    return 6;
  }

  return 7;
}

function comparePropsByUrgency(a, b, stageId) {
  const priorityOrder = { HIGH: 0, MED: 1, OK: 2 };
  const rankDiff = getUrgencyRank(a, stageId) - getUrgencyRank(b, stageId);
  if(rankDiff !== 0) return rankDiff;

  const priorityDiff = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  if(priorityDiff !== 0) return priorityDiff;

  if(a.issues.length !== b.issues.length){
    return b.issues.length - a.issues.length;
  }

  if(a.unreadMsg !== b.unreadMsg){
    return b.unreadMsg - a.unreadMsg;
  }

  if(stageId === "d1" || stageId === "checkin"){
    return String(a.checkIn || "").localeCompare(String(b.checkIn || ""), "ko");
  }

  if(stageId === "stay" || stageId === "checkout"){
    return String(a.checkOut || "").localeCompare(String(b.checkOut || ""), "ko");
  }

  return String(a.name || "").localeCompare(String(b.name || ""), "ko");
}

function CommandCenter({onBack, onOpenScenario, onOpenHomeAssistant, initialStage = "stay"}) {
  const [stage, setStage] = useState("stay");
  const [props] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [now, setNow] = useState(new Date());
  const [stableExpanded, setStableExpanded] = useState(false);

  useEffect(()=>{
    const clock = setInterval(()=>setNow(new Date()),1000);
    const alertFeed = setInterval(()=>{
      if(Math.random() < 0.12){
        const prop = props[randN(0, props.length - 1)];
        const liveMsg = rand(["게스트 메시지 수신","청소 완료 보고","체크인 완료","Wi-Fi 신호 약화","허브 재부팅 완료","센서 응답 없음","도어락 배터리 부족"]);
        const liveAudience = liveMsg === "게스트 메시지 수신" || liveMsg === "도어락 배터리 부족" ? "owner"
          : liveMsg === "허브 재부팅 완료" || liveMsg === "센서 응답 없음" ? "admin" : "log";
        setAlerts(list=>[
          {
            id: Date.now(),
            type: rand(["warn","info"]),
            prop: prop.name,
            msg: liveMsg,
            audience: liveAudience,
            time: new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}),
            ack: false,
          },
          ...list.slice(0,28),
        ]);
      }
    }, 9000);
    return ()=>{
      clearInterval(clock);
      clearInterval(alertFeed);
    };
  },[props]);

  useEffect(()=>{
    setStage(initialStage || "stay");
  },[initialStage]);

  useEffect(()=>{
    setSelProp(null);
    setStableExpanded(false);
  },[stage]);

  const ackAlert = id => setAlerts(list=>list.map(item=>item.id===id ? {...item, ack:true} : item));
  const ackAll = () => setAlerts(list=>list.map(item=>({...item, ack:true})));

  const currentStage = getStageById(stage);
  const focusProperty = prop => {
    setSelProp(prop);
  };

  // ── 자동화 건강도 버킷 (automationHealth 기반) ──────────────
  const healthBuckets = {
    failed:   props.filter(p => p.automationHealth === "failed"),
    degraded: props.filter(p => p.automationHealth === "degraded"),
    watch:    props.filter(p => p.automationHealth === "watch"),
    healthy:  props.filter(p => p.automationHealth === "healthy"),
  };
  const siteActionCount     = props.filter(p => p.siteActionRequired).length;
  const autoRecoveredCount  = props.filter(p => p.autoRecovery === "recovered").length;
  const preflightPassedCount = props.filter(p => p.preflightStatus === "passed").length;

  const stageMatchedProps = props.filter(prop=>currentStage.filter(prop));
  const actionableProps = stageMatchedProps
    .filter(prop=>isActionableForStage(stage, prop))
    .sort((a, b)=>comparePropsByUrgency(a, b, stage));
  const stableProps = stageMatchedProps
    .filter(prop=>!isActionableForStage(stage, prop))
    .sort((a, b)=>String(a.name).localeCompare(String(b.name), "ko"));
  const unack = alerts.filter(alert=>!alert.ack).length;
  const stageInsights = CC_STAGES.map(item=>{
    const matched = props.filter(item.filter);
    const count = matched.length;
    const actionable = matched.filter(prop=>isActionableForStage(item.id, prop)).length;
    const urgent = matched.filter(prop=>hasUrgentSignal(prop)).length;
    const unread = matched.reduce((sum, prop)=>sum + prop.unreadMsg, 0);
    const summary = getStageSummary(item.id, matched);
    return {
      id: item.id,
      code: item.code,
      label: item.label,
      count,
      actionable,
      urgent,
      unread,
      score: actionable * 3 + urgent + unread,
      summary,
      tone: TRIAGE_TONES[summary.toneKey],
    };
  });
  const currentDrilldown = currentStage?.scenarioScreen
    ? { screen: currentStage.scenarioScreen, label: currentStage.batchActionLabel }
    : null;
  const currentInsight = stageInsights.find(item=>item.id===stage) || stageInsights[0];
  const currentTone = currentInsight?.tone || TRIAGE_TONES.normal;

  const getPrimaryAction = prop => {
    const toneKey = getActionToneKey(prop);
    const tone = TRIAGE_TONES[toneKey];
    const actionBrief = getActionBrief(prop, stage);
    const instruction = getActionInstruction(prop, stage);

    if(prop.priority==="HIGH" || prop.issues.length > 0){
      return {
        label:"긴급 이슈",
        detail: actionBrief,
        instruction,
        tab:"info",
        color:tone.strong,
        bg:tone.bg,
        border:tone.border,
        toast:"긴급 이슈 상세를 열었습니다.",
        tone:"e",
      };
    }
    if(prop.unreadMsg > 0){
      return {
        label:"메시지 확인",
        detail: actionBrief,
        instruction,
        tab:"msg",
        color:tone.strong,
        bg:tone.bg,
        border:tone.border,
        toast:"메시지 탭으로 이동했습니다.",
        tone:"w",
      };
    }
    if(prop.status==="예약됨"){
      return {
        label:"체크인 준비",
        detail: actionBrief,
        instruction,
        tab:"info",
        color:tone.strong,
        bg:tone.bg,
        border:tone.border,
        toast:"D-1 준비 상태를 확인합니다.",
        tone:"w",
      };
    }
    if(prop.status==="청소중" || prop.status==="점검중"){
      return {
        label:"청소 확인",
        detail: actionBrief,
        instruction,
        tab:"clean",
        color:tone.strong,
        bg:tone.bg,
        border:tone.border,
        toast:"청소 배정 탭으로 이동했습니다.",
        tone:"w",
      };
    }
    return {
      label:"운영 점검",
      detail: actionBrief,
      instruction,
      tab:"iot",
      color:tone.strong,
      bg:tone.bg,
      border:tone.border,
      toast:"숙소 상태 확인 화면을 열었습니다.",
      tone:"s",
    };
  };

  const openPropertyWorkspace = prop => {
    focusProperty(prop);
    const primaryAction = getPrimaryAction(prop);
    const routeReason = prop.issues.length > 0
      ? prop.issues[0]
      : prop.unreadMsg > 0
      ? `미읽음 메시지 ${prop.unreadMsg}건`
      : primaryAction.detail;
    onOpenHomeAssistant?.(stage, {
      source: "command-center",
      stage,
      property: prop,
      headline: primaryAction.label,
      reason: routeReason,
      nextActionLabel: primaryAction.label,
    });
    Toast.show(`${prop.name.split("#")[0].trim()} · 대표 숙소 보드로 넘깁니다.`, "i");
  };

  const openBatchWorkspace = () => {
    if(!currentDrilldown) return;
    onOpenScenario?.(currentDrilldown.screen);
  };

  const openAlertsPanel = () => {
    Toast.show("오른쪽 실시간 알림 패널에서 바로 확인할 수 있습니다.", "i");
  };

  const stageActionQueue = actionableProps.map(prop=>({
    prop,
    action: getPrimaryAction(prop),
  }));

  const renderStageKPI = (prop, stageId) => {
    if(stageId==="d1"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:prop.priority!=="HIGH"?"#059669":"#dc2626"}}>{prop.priority!=="HIGH"?"✓ PIN준비":"✗ PIN미발급"}</span>
          <span className="pcard-kpi-item" style={{color:"#718096"}}>체크인 {prop.checkIn || "내일"}</span>
        </div>
      );
    }
    if(stageId==="checkin"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#475569"}}>🚪 입실 대응</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>체크인 {prop.checkIn || "오늘"}</span>
        </div>
      );
    }
    if(stageId==="stay"){
      return (
        <div className="pcard-kpi">
          {prop.unreadMsg > 0 && <span className="pcard-kpi-item" style={{color:TRIAGE_TONES.high.strong,fontWeight:700}}>💬 미읽 {prop.unreadMsg}</span>}
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>퇴실 {prop.checkOut || "—"}</span>
        </div>
      );
    }
    if(stageId==="checkout"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#d97706"}}>🧹 청소중</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>퇴실완료</span>
        </div>
      );
    }
    if(stageId==="settlement"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#111827",fontWeight:700}}>{(prop.revenue / 10000).toFixed(0)}만원</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>★ {prop.rating}</span>
        </div>
      );
    }
    return (
      <div className="pcard-kpi">
        <span className="pcard-kpi-item" style={{color:"#718096"}}>🌡 {prop.temp}°</span>
        <span className="pcard-kpi-item" style={{color:"#111827",fontWeight:600}}>{(prop.revenue / 10000).toFixed(0)}만</span>
        <span className="pcard-kpi-item" style={{color:"#718096"}}>★{prop.rating}</span>
      </div>
    );
  };

  const IoTHealthDot = ({prop}) => {
    const dl = prop.doorLockStatus;
    const sh = prop.sensorHealth;
    if (dl === "오프라인" || sh === "미연결") return <span title="IoT 오프라인" style={{width:"7px",height:"7px",borderRadius:"50%",background:"#dc2626",display:"inline-block",flexShrink:0}} />;
    if (dl === "미응답" || dl === "배터리부족" || sh === "일부불량") return <span title="IoT 일부 이상" style={{width:"7px",height:"7px",borderRadius:"50%",background:"#d97706",display:"inline-block",flexShrink:0}} />;
    return <span title="IoT 정상" style={{width:"7px",height:"7px",borderRadius:"50%",background:"#059669",display:"inline-block",flexShrink:0}} />;
  };

  const PCard = ({p}) => {
    const isSel = selProp?.id === p.id;
    const primaryAction = getPrimaryAction(p);

    return (
      <div className={`pcard ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p)} style={{borderTopColor: primaryAction.color}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
            <div style={{width:"8px",height:"8px",borderRadius:"50%",background:primaryAction.color}} />
            <IoTHealthDot prop={p} />
          </div>
          <div style={{display:"flex",gap:"4px"}}>
            {p.unreadMsg > 0 && <span style={{fontSize:"10px",background:TRIAGE_TONES.high.strong,color:"#fff",borderRadius:"10px",padding:"1px 6px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>💬{p.unreadMsg}</span>}
            {p.issues.length > 0 && <span style={{fontSize:"10px",background:TRIAGE_TONES.critical.strong,color:"#fff",borderRadius:"10px",padding:"1px 6px",fontWeight:"700"}}>⚠</span>}
          </div>
        </div>
        <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",lineHeight:"1.4",marginBottom:"5px"}}>{p.name}</div>
        <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
          <span className="badge-sm" style={{background:STATUS_BADGE_TONE.bg,color:STATUS_BADGE_TONE.color,border:`1px solid ${STATUS_BADGE_TONE.border}`}}>{p.status}</span>
          {p.guest && <span style={{fontSize:"10px",color:"#718096",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:80}}>{p.guest}</span>}
        </div>
        {renderStageKPI(p, stage)}
        {p.issues.length > 0 && <div style={{fontSize:"10px",color:TRIAGE_TONES.critical.strong,background:TRIAGE_TONES.critical.bg,border:`1px solid ${TRIAGE_TONES.critical.border}`,padding:"3px 8px",borderRadius:"4px",marginTop:"5px",display:"inline-block",fontWeight:"600"}}>⚠ {p.issues[0]}</div>}
        {p.vacancyMode && <div style={{fontSize:"10px",color:"#475569",background:"#f1f5f9",border:"1px solid #cbd5e1",padding:"2px 7px",borderRadius:"4px",marginTop:"4px",display:"inline-block",fontWeight:"600"}}>🏠 공실 모드</div>}
        {(p.doorLockStatus !== "정상" && p.doorLockStatus) && <div style={{fontSize:"10px",color:TRIAGE_TONES.high.strong,background:TRIAGE_TONES.high.bg,border:`1px solid ${TRIAGE_TONES.high.border}`,padding:"2px 7px",borderRadius:"4px",marginTop:"4px",display:"inline-block",fontWeight:"600",marginLeft:"4px"}}>🔒 {p.doorLockStatus}</div>}
        <div className="pcard-action">
          <div className="pcard-action-text">
            <span className="pcard-action-label" style={{color:primaryAction.color}}>{primaryAction.label}</span>
            <span className="pcard-action-detail">{primaryAction.detail}</span>
          </div>
          <button
            className="pcard-action-btn"
            style={{background:primaryAction.bg,borderColor:primaryAction.border,color:primaryAction.color}}
            onClick={event=>{
              event.stopPropagation();
              openPropertyWorkspace(p);
            }}
          >
            대표 숙소 보기
          </button>
        </div>
      </div>
    );
  };

  const LRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    const primaryAction = getPrimaryAction(p);
    return (
      <div className={`lrow ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p)}>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:primaryAction.color,flexShrink:0}} />
        <IoTHealthDot prop={p} />
        <div style={{flex:2,minWidth:0}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
          <div style={{fontSize:"10px",color:"#a0aec0"}}>{p.type}</div>
        </div>
        <span className="badge-sm" style={{background:STATUS_BADGE_TONE.bg,color:STATUS_BADGE_TONE.color,border:`1px solid ${STATUS_BADGE_TONE.border}`,whiteSpace:"nowrap"}}>{p.status}</span>
        <div style={{flex:1,fontSize:"11px",color:"#4a5568",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.guest || "—"}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#718096",whiteSpace:"nowrap"}}>🌡{p.temp}° ★{p.rating}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#111827",fontWeight:"600",whiteSpace:"nowrap",minWidth:"45px"}}>{(p.revenue / 10000).toFixed(0)}만</div>
        <div style={{display:"flex",gap:"3px"}}>{p.issues.length>0 && <span style={{fontSize:"11px",color:TRIAGE_TONES.critical.strong}}>⚠️</span>}{p.unreadMsg>0 && <span style={{fontSize:"10px",background:TRIAGE_TONES.high.strong,color:"#fff",borderRadius:"8px",padding:"0 5px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>{p.unreadMsg}</span>}</div>
        <button
          className="cc-inline-action"
          style={{background:primaryAction.bg,borderColor:primaryAction.border,color:primaryAction.color}}
          onClick={event=>{
            event.stopPropagation();
            openPropertyWorkspace(p);
          }}
        >
          대표 숙소 보기
        </button>
      </div>
    );
  };

  const StableRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    const nextStep = stage==="d1"
      ? `${p.checkIn || "내일"} 체크인 준비 완료`
      : stage==="checkin"
      ? `${p.checkIn || "오늘"} 입실 대기`
      : stage==="stay"
      ? `${p.checkOut || "예정"} 퇴실 전까지 정상`
      : stage==="checkout"
      ? "청소·점검 이슈 없음"
      : `매출 ${(p.revenue / 10000).toFixed(0)}만원 · 안정`;

    return (
      <div className={`lrow ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p)} style={{background:"#f0fdf4",borderColor:"#a7f3d0"}}>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:"#059669",flexShrink:0}} />
        <div style={{flex:2,minWidth:0}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
          <div style={{fontSize:"10px",color:"#94a3b8"}}>{p.type}</div>
        </div>
        <span className="badge-sm" style={{background:"#d1fae5",color:"#047857",border:"1px solid #a7f3d0",whiteSpace:"nowrap"}}>{p.status}</span>
        <div style={{flex:1.2,fontSize:"11px",color:"#475569",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.guest || "게스트 없음"}</div>
        <div style={{flex:1.4,fontSize:"11px",color:"#059669",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextStep}</div>
        <button
          className="cc-inline-action"
          style={{background:"#ffffff",borderColor:"#a7f3d0",color:"#059669"}}
          onClick={event=>{
            event.stopPropagation();
            focusProperty(p);
          }}
        >
          상태 보기
        </button>
      </div>
    );
  };

  const DetailPanel = () => {
    if(!selProp){
      return (
        <div className="no-sel">
          <div style={{fontSize:"36px",opacity:0.2}}>🏠</div>
          <div>숙소를 하나 고르면 다음 할 일이 보입니다</div>
          <div style={{fontSize:"11px",color:"#cbd5e0",lineHeight:"1.7",textAlign:"center"}}>
            숙소 한 곳은 대표 숙소 화면으로 넘기고
            <br />
            같은 문제 숙소가 여러 곳이면 아래 버튼으로 묶어서 처리합니다
          </div>
          {currentDrilldown && (
            <button
              className="act-btn"
              style={{color:currentStage.color,borderColor:currentStage.border,background:currentStage.bg,fontSize:"11px",marginTop:"4px"}}
              onClick={openBatchWorkspace}
            >
              {currentDrilldown.label}
            </button>
          )}
        </div>
      );
    }

    const p = props.find(item=>item.id===selProp.id) || selProp;
    const primaryAction = getPrimaryAction(p);
    const routeReason = p.issues.length > 0
      ? p.issues[0]
      : p.unreadMsg > 0
      ? `미읽음 메시지 ${p.unreadMsg}건`
      : primaryAction.detail;

    return (
      <>
        <div style={{padding:"16px 18px",borderBottom:"1.5px solid #e2e8f0",flexShrink:0,background:"#ffffff"}}>
          <div style={{fontSize:"11px",color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:"4px",fontWeight:500}}>#{String(p.id).padStart(3,"0")} · {p.type}</div>
          <div style={{fontSize:"14px",fontWeight:"800",color:"#1e293b",lineHeight:"1.3"}}>{p.name}</div>
          <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
            <span className="badge-sm" style={{background:STATUS_BADGE_TONE.bg,color:STATUS_BADGE_TONE.color,border:`1.5px solid ${STATUS_BADGE_TONE.border}`}}>{p.status}</span>
            <span className="badge-sm" style={{background:primaryAction.bg,color:primaryAction.color,border:`1.5px solid ${primaryAction.border}`}}>{p.priority==="HIGH"?"🚨 긴급":p.priority==="MED"?"⚠ 우선":"✓ 안정"}</span>
          </div>
        </div>
        <div className="dbody">
          <div style={{padding:"14px",borderRadius:"12px",background:primaryAction.bg,border:`1.5px solid ${primaryAction.border}`,marginBottom:"14px"}}>
            <div style={{fontSize:"10px",fontWeight:"800",letterSpacing:"0.08em",textTransform:"uppercase",color:"#94a3b8",marginBottom:"8px"}}>왜 이 숙소를 봐야 하나</div>
            <div style={{fontSize:"16px",fontWeight:"800",color:primaryAction.color,lineHeight:"1.45"}}>{primaryAction.label}</div>
            <div style={{fontSize:"12px",color:"#475569",lineHeight:"1.7",marginTop:"6px"}}>{routeReason}</div>
          </div>

          <div className="d-label">현재 상태</div>
          {[["단계", `${currentStage.code} · ${currentStage.label}`],["숙소 상태", p.status],["게스트", p.guest || "없음"],["미읽음", `${p.unreadMsg}건`],["이슈", `${p.issues.length}건`],["도어락", p.doorLockStatus || "—"],["센서", p.sensorHealth || "—"],["체크인", p.checkIn || "—"],["체크아웃", p.checkOut || "—"]].map(([key, value])=>(
            <div className="d-row" key={key}><span className="d-k">{key}</span><span className="d-v" style={{color: (key==="도어락" && value!=="정상") || (key==="센서" && value!=="정상") ? "#dc2626" : undefined}}>{value}</span></div>
          ))}
          {p.vacancyMode && (
            <div style={{margin:"8px 0 0",padding:"6px 10px",borderRadius:"8px",background:"#f1f5f9",border:"1px solid #cbd5e1",display:"flex",gap:"8px",alignItems:"center"}}>
              <span style={{fontSize:"10px",fontWeight:700,color:"#475569"}}>🏠 공실 모드 활성</span>
              <span style={{fontSize:"10px",color:"#64748b"}}>HVAC OFF · 침입 감지 ON</span>
            </div>
          )}

          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginTop:"14px"}}>
            <button className="act-btn" style={{color:"#ffffff",borderColor:primaryAction.color,background:primaryAction.color,fontSize:"11px"}} onClick={()=>openPropertyWorkspace(p)}>대표 숙소 보드 열기</button>
            {currentDrilldown && (
              <button className="act-btn" style={{color:currentTone.strong,borderColor:currentTone.border,background:currentTone.bg,fontSize:"11px"}} onClick={openBatchWorkspace}>
                {currentDrilldown.label}
              </button>
            )}
            <button className="act-btn" style={{color:"#718096",borderColor:"#e2e8f0",background:"#f8fafc",fontSize:"11px"}} onClick={()=>setSelProp(null)}>선택 해제</button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"10px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",minHeight:54}}>
        <button onClick={onBack} style={{padding:"6px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>← 뒤로</button>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"17px",fontWeight:"800",color:"#2563eb",whiteSpace:"nowrap",letterSpacing:"-0.5px"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div style={{fontSize:"11px",color:"#94a3b8",fontWeight:500,whiteSpace:"nowrap",paddingTop:1}}>전체 관제 센터 · 지금 멈춘 숙소만 골라 넘기는 곳</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",color:"#475569",fontWeight:"600",flexShrink:0}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginLeft:"auto",flexShrink:0}}>
          <button onClick={()=>onOpenHomeAssistant?.(stage)} style={{padding:"7px 14px",borderRadius:8,background:"#ffffff",border:"1.5px solid #e2e8f0",color:"#475569",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🏠 대표 숙소 해결 보기</button>
          <div style={{position:"relative",cursor:"pointer",padding:"6px 12px",borderRadius:"20px",background:unack>0?TRIAGE_TONES.critical.bg:TRIAGE_TONES.normal.bg,border:`1.5px solid ${unack>0?TRIAGE_TONES.critical.border:TRIAGE_TONES.normal.border}`,display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:unack>0?TRIAGE_TONES.critical.strong:TRIAGE_TONES.normal.strong,fontWeight:"700"}} onClick={openAlertsPanel}>
            🔔 {unack}
            {unack>0 && <div style={{position:"absolute",top:"-2px",right:"-2px",width:"8px",height:"8px",background:TRIAGE_TONES.critical.strong,borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
        </div>
      </div>

      {/* ── 자동화 건강도 보드 (1차 축) ── */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 18px",flexShrink:0}}>
        <div style={{display:"flex",gap:"10px",alignItems:"center",marginBottom:"8px"}}>
          <span style={{fontSize:"10px",fontWeight:800,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>자동화 건강도</span>
          <div style={{flex:1,height:"6px",borderRadius:4,overflow:"hidden",background:"#f1f5f9",display:"flex"}}>
            {[
              {count:healthBuckets.failed.length,   color:"#dc2626"},
              {count:healthBuckets.degraded.length,  color:"#ea580c"},
              {count:healthBuckets.watch.length,     color:"#d97706"},
              {count:healthBuckets.healthy.length,   color:"#059669"},
            ].map((seg, i) => (
              <div key={i} style={{height:"100%",width:`${(seg.count/props.length)*100}%`,background:seg.color,transition:"width 0.3s"}} />
            ))}
          </div>
          <span style={{fontSize:"10px",color:"#94a3b8",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{props.length}개 전체</span>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          {[
            {label:"시스템 장애",    count:healthBuckets.failed.length,   color:"#dc2626", bg:"#fef2f2", border:"#fecaca"},
            {label:"성능 저하",      count:healthBuckets.degraded.length,  color:"#ea580c", bg:"#fff7ed", border:"#fdba74"},
            {label:"주시",          count:healthBuckets.watch.length,     color:"#d97706", bg:"#fffbeb", border:"#fde68a"},
            {label:"자동 제어 정상", count:healthBuckets.healthy.length,   color:"#059669", bg:"#f0fdf4", border:"#a7f3d0"},
          ].map(b => (
            <div key={b.label} style={{display:"flex",alignItems:"center",gap:"5px",padding:"3px 10px",borderRadius:"20px",background:b.bg,border:`1px solid ${b.border}`}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",fontWeight:800,color:b.color}}>{b.count}</span>
              <span style={{fontSize:"10px",color:b.color,fontWeight:600,whiteSpace:"nowrap"}}>{b.label}</span>
            </div>
          ))}
          <div style={{marginLeft:"auto",display:"flex",gap:"12px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <span style={{fontSize:"10px",color:"#94a3b8"}}>현장 조치 필요</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",fontWeight:800,color:siteActionCount>0?"#dc2626":"#059669"}}>{siteActionCount}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <span style={{fontSize:"10px",color:"#94a3b8"}}>자동 복구 성공</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",fontWeight:800,color:"#059669"}}>{autoRecoveredCount}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <span style={{fontSize:"10px",color:"#94a3b8"}}>점검 통과</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",fontWeight:800,color:"#059669"}}>{preflightPassedCount}/{props.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="cc-body">
        <div className="cc-main">
          <div className="prop-panel">
                <div className="pipeline-wrap">
                  {CC_STAGES.filter(item=>item.id !== "settlement").map(item=>{
                    const matched = props.filter(item.filter);
                    const summary = getStageSummary(item.id, matched);
                    const tone = TRIAGE_TONES[summary.toneKey];
                    const active = stage===item.id;
                    return (
                      <div
                        key={item.id}
                        className={`pipeline-card ${active ? "active" : ""}`}
                        style={{borderColor:active ? tone.color : tone.border,background:tone.bg}}
                        onClick={()=>setStage(item.id)}
                      >
                        <div className="pipeline-head">
                          <div className="pipeline-code">{item.code}</div>
                          <div style={{fontSize:"16px"}}>{item.emoji}</div>
                        </div>
                        <div className="pipeline-label" style={{color:"#111827"}}>{item.label}</div>
                        <div className="pipeline-status-line">
                          <div className="pipeline-status-head">
                            <span className="pipeline-status-pill" style={{background:"#ffffff",borderColor:tone.border,color:tone.strong}}>{summary.label}</span>
                            <span className="pipeline-ratio">
                              <span className="pipeline-ratio-focus" style={{color:tone.strong,fontWeight:800}}>{summary.urgent + summary.actionable}</span>
                              <span className="pipeline-ratio-divider" style={{color:"#cbd5e1",fontSize:"11px",margin:"0 2px"}}>/</span>
                              <span className="pipeline-ratio-total" style={{color:"#059669",fontWeight:700}}>{summary.watch}</span>
                            </span>
                          </div>
                          <div style={{display:"flex",gap:"8px",alignItems:"center",marginTop:"4px"}}>
                            <span style={{fontSize:"10px",color:tone.strong}}>처리 {summary.urgent + summary.actionable}</span>
                            <span style={{fontSize:"10px",color:"#059669"}}>안정 {summary.watch}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(()=>{
                    const s05 = CC_STAGES.find(item=>item.id==="settlement");
                    const active = stage==="settlement";
                    return (
                      <div
                        key="settlement"
                        className={`pipeline-card ${active ? "active" : ""}`}
                        style={{borderColor:active?"#0891b2":"#e2e8f0",background:active?"#ecfeff":"#f8fafc",opacity:0.85,minWidth:0,flex:"0 0 auto",width:"120px"}}
                        onClick={()=>setStage("settlement")}
                        title="월간 정산 — 실시간 IoT 파이프라인과 별개 작업"
                      >
                        <div className="pipeline-head">
                          <div className="pipeline-code" style={{color:"#64748b"}}>{s05.code}</div>
                          <div style={{fontSize:"12px",color:"#94a3b8"}}>월간</div>
                        </div>
                        <div className="pipeline-label" style={{color:"#64748b",fontSize:"11px"}}>{s05.label}</div>
                        <div style={{fontSize:"9px",color:"#94a3b8",marginTop:"4px",lineHeight:"1.4"}}>실시간 IoT 파이프라인과 별개</div>
                      </div>
                    );
                  })()}
                </div>

                <div className="cc-scroll-sections">
                  <div className="cc-action-queue" style={{background:currentTone.bg,borderBottom:`1px solid ${currentTone.border}`}}>
                    <div className="cc-section-header">
                      <div>
                        <div className="cc-section-eyebrow">처리할 숙소</div>
                        <div className="cc-section-title" style={{color:currentTone.strong}}>지금 처리할 {stageActionQueue.length}곳</div>
                      </div>
                      <div className="stage-bar-actions">
                        {currentDrilldown && (
                          <button className="stage-action-btn" style={{background:"#ffffff",borderColor:currentTone.border,color:currentTone.strong}} onClick={openBatchWorkspace}>
                            {currentDrilldown.label}
                          </button>
                        )}
                      </div>
                    </div>
                    {stageActionQueue.length > 0 ? (
                      <div className="cc-queue-grid">
                        {stageActionQueue.map(({prop, action})=>(
                          <div key={prop.id} className="cc-queue-card" style={{background:action.bg,borderColor:action.border}}>
                            <div className="cc-queue-top">
                              <span className="badge-sm" style={{background:STATUS_BADGE_TONE.bg,color:STATUS_BADGE_TONE.color,border:`1px solid ${STATUS_BADGE_TONE.border}`}}>{prop.status}</span>
                              {prop.guest && <span className="cc-queue-guest">{prop.guest}</span>}
                              {(()=>{
                                const iType = getInterventionType(prop);
                                const t = INTERVENTION_TYPES[iType];
                                return <span style={{fontSize:"9px",fontWeight:700,padding:"2px 7px",borderRadius:"20px",background:t.bg,color:t.color,border:`1px solid ${t.border}`,whiteSpace:"nowrap",marginLeft:"auto"}}>{t.label}</span>;
                              })()}
                            </div>
                            <div className="cc-queue-name" onClick={()=>focusProperty(prop)} style={{cursor:"pointer"}}>{prop.name}</div>
                            <div className="cc-queue-problem" style={{color:action.color}}>{action.detail}</div>
                            {/* 자동복구 이력 + 사전점검 상태 */}
                            <div style={{display:"flex",gap:"5px",marginTop:"5px",flexWrap:"wrap"}}>
                              {prop.autoRecovery === "unrecovered" && (
                                <span style={{fontSize:"9px",fontWeight:700,padding:"2px 6px",borderRadius:"10px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca"}}>
                                  자동 복구 실패{prop.recoveryAttempts > 0 ? ` ${prop.recoveryAttempts}회` : ""}
                                </span>
                              )}
                              {prop.autoRecovery === "recovered" && (
                                <span style={{fontSize:"9px",fontWeight:700,padding:"2px 6px",borderRadius:"10px",background:"#f0fdf4",color:"#059669",border:"1px solid #a7f3d0"}}>자동 복구 완료</span>
                              )}
                              {prop.preflightStatus === "failed" && (
                                <span style={{fontSize:"9px",fontWeight:700,padding:"2px 6px",borderRadius:"10px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fdba74"}}>점검 실패</span>
                              )}
                              {prop.siteActionRequired && (
                                <span style={{fontSize:"9px",fontWeight:700,padding:"2px 6px",borderRadius:"10px",background:"#fef2f2",color:"#b91c1c",border:"1px solid #fecaca"}}>현장 조치 필요</span>
                              )}
                            </div>
                            <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
                              <button
                                className="cc-queue-action-btn"
                                style={{background:action.color,borderColor:action.color,color:"#fff",flex:1}}
                                onClick={()=>openPropertyWorkspace(prop)}
                              >
                                바로 처리
                              </button>
                              <button
                                className="cc-queue-action-btn"
                                style={{background:"#fff",borderColor:action.border,color:action.color}}
                                onClick={()=>focusProperty(prop)}
                              >
                                상세
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="cc-empty-state">
                        <div className="cc-empty-title">{currentStage.label} 단계에서 지금 처리할 숙소는 없습니다</div>
                        <div className="cc-empty-desc">이 단계는 현재 정상 흐름입니다. 아래 문제없는 숙소만 확인하면 됩니다.</div>
                      </div>
                    )}
                  </div>

                  <div className="cc-stable-section" style={{background:"#f0fdf4",borderTop:"2px solid #a7f3d0"}}>
                    <div className="cc-section-header" style={{cursor:"pointer",background:"#f0fdf4"}} onClick={()=>setStableExpanded(v=>!v)}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                        <div>
                          <div className="cc-section-eyebrow" style={{color:"#047857"}}>문제없는 숙소</div>
                          <div className="cc-section-title" style={{color:"#047857"}}>
                            <span style={{fontSize:"22px",fontWeight:800,color:"#059669"}}>{stableProps.length}</span>
                            <span style={{fontSize:"14px",fontWeight:600,color:"#059669",marginLeft:4}}>곳 안정</span>
                            <span style={{fontSize:"13px",color:"#6ee7b7",marginLeft:8}}>{stableProps.length > 0 ? (stableExpanded ? "▲" : "▼") : ""}</span>
                          </div>
                        </div>
                      </div>
                      <div className="cc-section-meta" style={{color:"#059669"}}>지금 개입하지 않아도 되는 숙소입니다. 클릭해서 {stableExpanded ? "접기" : "펼치기"}</div>
                    </div>
                    {stableExpanded && (
                      stableProps.length > 0 ? (
                        <div className="prop-list" style={{background:"#f0fdf4"}}>
                          {stableProps.map(prop=><StableRow key={prop.id} p={prop} />)}
                        </div>
                      ) : (
                        <div className="cc-empty-state" style={{background:"#f0fdf4"}}>
                          <div className="cc-empty-title" style={{color:"#047857"}}>문제없는 숙소가 아직 없습니다</div>
                          <div className="cc-empty-desc">현재 이 단계의 숙소는 전부 확인이 필요한 상태입니다.</div>
                        </div>
                      )
                    )}
                  </div>
                </div>
          </div>

          <div className="detail-panel">
            <DetailPanel />
          </div>

          <div className="alert-panel">
            <div className="alert-hdr">
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:3,height:13,background:"#dc2626",borderRadius:2,display:"inline-block",flexShrink:0}} />
                <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",color:"#475569",textTransform:"uppercase"}}>실시간 알림</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"1px 7px",fontWeight:700,marginLeft:4}}>LIVE</span>
              </div>
              <button onClick={ackAll} style={{fontSize:"10px",color:"#718096",background:"none",border:"1.5px solid #e2e8f0",borderRadius:"20px",padding:"3px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"600"}}>전체 확인</button>
            </div>
            <div className="alert-list-wrap">
              {alerts.map(alert=>(
                <div
                  key={alert.id}
                  className={`aitem ${alert.acked ? "acked" : ""}`}
                  style={{
                    borderLeftColor:{error:TRIAGE_TONES.critical.strong,warn:TRIAGE_TONES.high.strong,info:TRIAGE_TONES.normal.strong}[alert.type],
                    background:{error:TRIAGE_TONES.critical.bg,warn:TRIAGE_TONES.high.bg,info:TRIAGE_TONES.normal.bg}[alert.type],
                  }}
                >
                  <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:"3px"}}>
                    <span style={{fontSize:"10px",fontWeight:"700",color:{error:TRIAGE_TONES.critical.strong,warn:TRIAGE_TONES.high.strong,info:TRIAGE_TONES.normal.strong}[alert.type]}}>{alert.prop}</span>
                    {alert.audience === "owner" && <span style={{fontSize:"9px",fontWeight:"700",background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca",borderRadius:"10px",padding:"1px 6px"}}>현장조치</span>}
                    {alert.audience === "admin" && <span style={{fontSize:"9px",fontWeight:"700",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:"10px",padding:"1px 6px"}}>원격처리</span>}
                    {alert.audience === "log" && <span style={{fontSize:"9px",fontWeight:"600",background:"#f8fafc",color:"#94a3b8",border:"1px solid #e2e8f0",borderRadius:"10px",padding:"1px 6px"}}>기록</span>}
                  </div>
                  <div style={{fontSize:"12px",color:"#4a5568",fontWeight:"500"}}>{alert.msg}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#a0aec0",marginTop:"3px"}}>{alert.time}</div>
                  {!alert.acked && <button style={{fontSize:"10px",padding:"3px 9px",borderRadius:"20px",border:`1.5px solid ${{error:TRIAGE_TONES.critical.border,warn:TRIAGE_TONES.high.border,info:TRIAGE_TONES.normal.border}[alert.type]}`,cursor:"pointer",background:"#fff",color:{error:TRIAGE_TONES.critical.strong,warn:TRIAGE_TONES.high.strong,info:TRIAGE_TONES.normal.strong}[alert.type],fontFamily:"'DM Sans',sans-serif",marginTop:"5px",fontWeight:"600"}} onClick={()=>ackAlert(alert.id)}>확인</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default CommandCenter;
