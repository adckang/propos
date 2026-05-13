// ============================================================
// mockData.js — 목업 데이터 전체
// 의존성: 없음 (순수 데이터)
// 사용처: HomeAssistant, CommandCenter
// ============================================================

// ── 공통 유틸 ──────────────────────────────────────────────
export const rand  = a => a[Math.floor(Math.random() * a.length)];
export const randN = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ── 풀 데이터 ──────────────────────────────────────────────
const CITIES      = ["서울 강남","서울 마포","서울 용산","서울 성동","서울 종로",
                     "부산 해운대","부산 수영","제주 서귀포","제주 한림",
                     "인천 연수","대구 중구","경기 성남"];
const TYPES       = ["펜트하우스","아파트","스튜디오","한옥","빌라","원룸","게스트하우스","복층"];
const GUESTS_LIST = ["김민준","이지수","박도현","Sarah M.","田中花子",
                     "Mike J.","Emma C.","최현아","정준호","王芳","Ana S.","David K."];
const STATUSES         = ["입실중","입실중","입실중","예약됨","예약됨","공실","청소중","점검중"];
const DOOR_LOCK_STATUS = ["정상","정상","정상","정상","정상","배터리부족","미응답","오프라인"];
const SENSOR_HEALTH    = ["정상","정상","정상","정상","일부불량","일부불량","미연결"];
const LAST_CONTROL     = ["방금","방금","5분 전","1시간 전","미기록"];
const LAST_TEST        = ["방금","30분 전","1시간 전","3시간 전","6시간 전","어제"];
const LAST_REBOOT      = ["오늘 06:00","오늘 03:00","어제 06:00","2일 전","3일 전","미기록"];

// 스테이지별 이슈 풀 — 자동화 실패/지연 언어로 정의
const STAGE_ISSUES = {
  예약됨:   ["PIN 자동 발급 실패","웰컴 씬 미발송","스마트홈 초기화 실패","입실 안내 자동화 누락"],
  입실중:   ["WiFi 허브 자동복구 실패","에어컨 자동제어 무응답","소음 임계치 초과","온수 센서 이상","도어락 배터리 임계치 도달"],
  청소중:   ["청소 완료 신호 미수신","청소팀 자동 배정 실패","청소 일정 지연","유지보수 항목 미처리"],
  점검중:   ["유지보수 자동화 미완료","청소 일정 지연","다음 예약 일정 충돌"],
  공실:     [],
};

// 개입 이유 → UI 레이블 매핑
export const INTERVENTION_LABELS = {
  lock_unreachable:    "도어락 원격 불가",
  offline:             "IoT 허브 오프라인",
  battery:             "배터리 교체 필요",
  sensor_unavailable:  "센서 부분 오프라인",
  scene_failed:        "자동화 씬 실행 실패",
  schedule_conflict:   "청소·일정 전환 지연",
};

// 숙소 운영 모드 — status에서 파생
function deriveMode(status) {
  if (status === "입실중") return "stay";
  if (status === "공실")   return "vacant";
  if (status === "청소중" || status === "점검중") return "cleaning";
  if (status === "예약됨") return "welcome";
  return "vacant";
}

// 자동화 건강도 — doorLock + sensor + issues 기반으로 파생
function deriveAutomationHealth(doorLockStatus, sensorHealth, issues, priority) {
  if (doorLockStatus === "오프라인" || sensorHealth === "미연결") return "failed";
  if (doorLockStatus === "미응답" || sensorHealth === "일부불량" || (issues.length > 0 && priority === "HIGH")) return "degraded";
  if (doorLockStatus === "배터리부족" || issues.length > 0) return "watch";
  return "healthy";
}

// 개입 이유 — 가장 심각한 원인 1개
function deriveInterventionReason(doorLockStatus, sensorHealth, issues) {
  if (doorLockStatus === "오프라인")   return "lock_unreachable";
  if (sensorHealth   === "미연결")     return "offline";
  if (doorLockStatus === "미응답")     return "lock_unreachable";
  if (doorLockStatus === "배터리부족") return "battery";
  if (sensorHealth   === "일부불량")   return "sensor_unavailable";
  if (issues.some(i => i.includes("초기화") || i.includes("씬"))) return "scene_failed";
  if (issues.some(i => i.includes("청소") || i.includes("일정") || i.includes("충돌"))) return "schedule_conflict";
  if (issues.length > 0) return "scene_failed";
  return null;
}

function derivePriority() {
  if (Math.random() < 0.18) return "HIGH";
  if (Math.random() < 0.25) return "MED";
  return "OK";
}

function deriveIssues(status) {
  if (Math.random() >= 0.18) return [];
  const pool = STAGE_ISSUES[status];
  return pool?.length ? [rand(pool)] : [];
}

function deriveAutoRecovery(automationHealth) {
  if (automationHealth === "failed")   return { status: "unrecovered", attempts: randN(2, 4) };
  if (automationHealth === "degraded" && Math.random() > 0.5) return { status: "recovered", attempts: randN(1, 2) };
  return { status: "none", attempts: 0 };
}

function derivePreflightStatus(automationHealth) {
  if (automationHealth === "healthy")  return "passed";
  if (automationHealth === "failed")   return "failed";
  if (automationHealth === "degraded") return "pending";
  return Math.random() > 0.3 ? "passed" : "pending";
}

// 체크인/체크아웃 날짜 — 오늘 기준 상대 날짜 생성
function deriveCheckDates(status) {
  const today = new Date();
  const fmt = d => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  if (status === "입실중") {
    const ci = new Date(today); ci.setDate(ci.getDate() - randN(1, 3));
    const co = new Date(today); co.setDate(co.getDate() + randN(1, 5));
    return { checkIn: fmt(ci), checkOut: fmt(co) };
  }
  if (status === "예약됨") {
    const ci = new Date(today); ci.setDate(ci.getDate() + randN(1, 7));
    const co = new Date(today); co.setDate(co.getDate() + randN(8, 14));
    return { checkIn: fmt(ci), checkOut: fmt(co) };
  }
  return { checkIn: null, checkOut: null };
}

// ── 전체 숙소 목록 (CommandCenter용) ─────────────────────
export const ALL_PROPS = Array.from({length: 48}, (_, i) => {
  const status         = rand(STATUSES);
  const hasG           = status === "입실중" || status === "예약됨";
  const doorLockStatus = rand(DOOR_LOCK_STATUS);
  const sensorHealth   = rand(SENSOR_HEALTH);
  const priority       = derivePriority();
  const issues         = deriveIssues(status);
  const dates          = deriveCheckDates(status);

  const automationHealth      = deriveAutomationHealth(doorLockStatus, sensorHealth, issues, priority);
  const interventionReason    = deriveInterventionReason(doorLockStatus, sensorHealth, issues);
  const manualInterventionReq = automationHealth === "failed" || automationHealth === "degraded";
  const siteActionRequired    = interventionReason === "battery"
    || (interventionReason === "lock_unreachable" && doorLockStatus === "오프라인");
  const recovery              = deriveAutoRecovery(automationHealth);
  const preflightStatus       = derivePreflightStatus(automationHealth);

  return {
    id:        i + 1,
    name:      `${rand(CITIES)} ${rand(TYPES)} #${String(i+1).padStart(3,"0")}`,
    city:      rand(CITIES),
    type:      rand(TYPES),
    status,
    guest:     hasG ? rand(GUESTS_LIST) : null,
    checkIn:   dates.checkIn,
    checkOut:  dates.checkOut,
    revenue:   randN(80, 950) * 1000,
    rating:    (4 + Math.random()).toFixed(2),
    temp:      randN(17, 25),
    humidity:  randN(40, 70),
    smartLock: Math.random() > 0.2,
    lockOpen:  false,
    acOn:      status === "입실중" && Math.random() > 0.3,
    acTemp:    randN(20, 26),
    lightsOn:  status === "입실중",
    issues,
    cleaning:        status === "청소중" ? "진행중" : "완료",
    priority,
    unreadMsg:       Math.random() < 0.25 ? randN(1, 4) : 0,
    platform:        rand(["Airbnb","Booking","직접예약"]),
    doorLockStatus,
    sensorHealth,
    vacancyMode:     status === "공실",
    lastControlAt:   rand(LAST_CONTROL),
    cleanerDetected: status === "청소중" && Math.random() > 0.4,
    // ── Health Model ──────────────────────────────────────
    automationHealth,
    preflightStatus,
    autoRecovery:            recovery.status,
    recoveryAttempts:        recovery.attempts,
    currentMode:             deriveMode(status),
    manualInterventionRequired: manualInterventionReq,
    interventionReason,
    siteActionRequired,
    lastTestAt:    rand(automationHealth === "healthy" ? ["방금","30분 전","1시간 전"] : LAST_TEST),
    lastRebootAt:  rand(LAST_REBOOT),
  };
});

// ── 상태 컬러 맵 (공용) ──────────────────────────────────
export const SC = {"입실중":"#059669","예약됨":"#2563eb","공실":"#94a3b8","청소중":"#d97706","점검중":"#dc2626"};
export const PC = {HIGH:"#dc2626", MED:"#d97706", OK:"#059669"};

// ── 실시간 알림 (알림 정책: owner=현장조치필요, admin=원격처리가능, log=기록만)
export const INIT_ALERTS = [
  {id:1, type:"error", audience:"owner", prop:"서울 강남 아파트 #007",       msg:"도어락 배터리 5% — 현장 배터리 교체 필요",              time:"06:01", ack:false},
  {id:2, type:"info",  audience:"log",   prop:"전체 시스템",                  msg:"정기 재부팅 완료 — IoT 허브 48개 정상 복귀",             time:"06:00", ack:false},
  {id:3, type:"warn",  audience:"admin", prop:"제주 서귀포 한옥 #019",        msg:"WiFi 허브 자동복구 실패 (2회) — 원격 재부팅 필요",        time:"05:47", ack:false},
  {id:4, type:"warn",  audience:"admin", prop:"부산 해운대 펜트하우스 #003",  msg:"에어컨 자동제어 무응답 — HA 엔티티 재연동 필요",          time:"04:32", ack:false},
  {id:5, type:"info",  audience:"log",   prop:"서울 마포 스튜디오 #011",      msg:"체크아웃 감지 — PIN 만료, 공실 모드 자동 전환 완료",      time:"11:02", ack:false},
  {id:6, type:"error", audience:"owner", prop:"인천 연수 아파트 #024",        msg:"온수 보일러 오프라인 — 자동복구 3회 실패, 현장 점검 필요", time:"03:18", ack:false},
  {id:7, type:"info",  audience:"log",   prop:"서울 용산 한옥 #031",          msg:"D-1 사전 점검 통과 — PIN 발급, 웰컴 씬, 초기화 정상",    time:"09:00", ack:false},
  {id:8, type:"info",  audience:"log",   prop:"제주 한림 빌라 #042",          msg:"체크인 감지 — 웰컴 씬 자동 실행 완료",                    time:"15:23", ack:false},
  {id:9, type:"warn",  audience:"admin", prop:"서울 성동 복층 #017",          msg:"소음 임계치 초과 감지 — 자동 경보 발송 완료, 상황 확인",  time:"23:41", ack:false},
];

// ── 자동화 규칙 ───────────────────────────────────────────
export const AUTO_RULES = [
  // 예방형 — 시스템이 알아서 실행
  {id:1,  name:"IoT 허브 정기 재부팅",          trigger:"매일 06:00",            action:"스마트 플러그 전원 사이클",     active:true,  type:"preventive"},
  {id:2,  name:"D-1 사전 점검 자동 실행",       trigger:"체크인 D-1 09:00",      action:"PIN·웰컴 씬·초기화 순차 검증", active:true,  type:"preventive"},
  {id:3,  name:"주간 스마트홈 통합 테스트",     trigger:"매주 월요일 07:00",      action:"전 디바이스 응답 체크",         active:true,  type:"preventive"},
  // 반응형 — 이벤트 감지 시 자동 대응
  {id:4,  name:"체크인 감지 → 웰컴 씬 실행",   trigger:"도어락 해제 이벤트",     action:"에어컨·조명·메시지 자동 실행", active:true,  type:"reactive"},
  {id:5,  name:"체크아웃 감지 → 전환 체인",    trigger:"체크아웃 시간 도달",     action:"PIN 만료·공실 모드·청소 배정", active:true,  type:"reactive"},
  {id:6,  name:"온도 임계치 → 에어컨 자동 ON", trigger:"실내 온도 > 28°C",       action:"에어컨 24°C 자동 가동",         active:true,  type:"reactive"},
  {id:7,  name:"소음 임계치 → 자동 경보",       trigger:"소음 > 65dB 10분 지속",  action:"관리자 알림 발송",              active:true,  type:"reactive"},
  {id:8,  name:"도어락 배터리 < 20% 알림",      trigger:"배터리 임계값 도달",     action:"owner 알림 + 교체 일정 등록",  active:true,  type:"reactive"},
  // 복구형 — 자동화 실패 시 재시도
  {id:9,  name:"씬 실행 실패 → 자동 재시도",   trigger:"automation 실패 감지",   action:"최대 3회 재시도 후 admin 알림",active:true,  type:"recovery"},
  {id:10, name:"허브 오프라인 → 재부팅 시도",   trigger:"허브 미응답 5분",        action:"스마트 플러그 재부팅 2회 시도",active:true,  type:"recovery"},
  {id:11, name:"공실 48h 이상 → 가격 조정",    trigger:"공실 48시간 초과",       action:"플랫폼 가격 10% 인하",          active:true,  type:"reactive"},
  {id:12, name:"미응답 메시지 30분 AI 답변",    trigger:"메시지 미읽음 30분",     action:"Claude AI 자동 답변",           active:false, type:"reactive"},
];

// ── 청소 인력 (공용) ─────────────────────────────────────
export const CLEANERS = [
  {id:1, name:"김청소", status:"가용",   assigned:0, rating:4.9, zone:"서울 강남/마포"},
  {id:2, name:"이정비", status:"작업중", assigned:2, rating:4.7, zone:"서울 용산/종로"},
  {id:3, name:"박미화", status:"가용",   assigned:0, rating:4.8, zone:"부산 전역"},
  {id:4, name:"최관리", status:"작업중", assigned:1, rating:4.6, zone:"제주 전역"},
  {id:5, name:"정세탁", status:"오프",   assigned:0, rating:4.5, zone:"인천/경기"},
];

// ── 개별 숙소 고정 데이터 (HomeAssistant용) ───────────────
export const SINGLE_PROP = {
  id:      "hj-001",
  name:    "해운대 오션뷰 펜트하우스",
  address: "부산시 해운대구 해운대해변로 298, 32F",
  emoji:   "🏠",
  status:  "입실중",
  guest:   "田中 花子",
  checkIn:  "04/19",
  checkOut: "04/24",
  temp:     23,
  humidity: 52,
  doorLockStatus: "정상",
  sensorHealth:   "정상",
  issues:   [],
  priority: "OK",
  platform: "Airbnb",
  // Health Model
  automationHealth:           "healthy",
  preflightStatus:            "passed",
  autoRecovery:               "none",
  recoveryAttempts:           0,
  currentMode:                "stay",
  manualInterventionRequired: false,
  interventionReason:         null,
  siteActionRequired:         false,
  lastTestAt:                 "방금",
  lastRebootAt:               "오늘 06:00",
};

// 스마트 스위치 — 재부팅 가능한 허브/콘센트 목록 (HomeAssistant용)
export const SMART_SWITCHES = [
  {id:"hub_main",   label:"메인 IoT 허브",       type:"usb",    status:"정상", lastReboot:"오늘 06:00", uptime:"18시간"},
  {id:"hub_sensor", label:"센서 허브",             type:"usb",    status:"정상", lastReboot:"오늘 06:00", uptime:"18시간"},
  {id:"plug_ac",    label:"에어컨 스마트 플러그",  type:"콘센트", status:"정상", lastReboot:"어제 06:00", uptime:"42시간"},
  {id:"plug_wifi",  label:"공유기 스마트 플러그",  type:"콘센트", status:"주의", lastReboot:"3일 전",     uptime:"72시간+"},
];

// 운영 이벤트 로그 — 자동화 실행 이력 (HomeAssistant용)
// status: ok=정상완료, warn=복구시도, fail=실패·개입필요
export const HEALTH_LOG = [
  {time:"06:00", type:"auto",   status:"ok",   msg:"정기 재부팅 완료 — 메인 IoT 허브, 센서 허브 정상 복귀"},
  {time:"06:05", type:"test",   status:"ok",   msg:"시스템 사전 점검 통과 — 도어락·센서·에어컨 응답 정상"},
  {time:"09:00", type:"test",   status:"ok",   msg:"D-1 사전 점검 통과 — PIN 발급, 웰컴 씬, 스마트홈 초기화 정상"},
  {time:"09:03", type:"auto",   status:"ok",   msg:"PIN 4821 자동 발급 완료 — 유효기간 04/19 15:00 ~ 04/24 11:00"},
  {time:"14:11", type:"auto",   status:"warn",  msg:"에어컨 자동제어 1회 실패 — 재시도 후 정상 복구"},
  {time:"15:21", type:"event",  status:"ok",   msg:"도어락 해제 이벤트 감지 — 체크인 확인 (田中 花子)"},
  {time:"15:22", type:"auto",   status:"ok",   msg:"웰컴 씬 자동 실행 — 에어컨 24°C, 조명 환영 모드, 메시지 발송"},
  {time:"18:00", type:"test",   status:"ok",   msg:"주요 시점 점검 — 체류 중 센서 전체 응답 정상"},
];

export const BOOKING = {
  guest:          {name:"田中 花子", avatar:"🇯🇵", phone:"+81-90-1234-5678"},
  checkIn:        "2026-04-19T15:00:00",
  checkOut:       "2026-04-24T11:00:00",
  guests:         2,
  nights:         5,
  totalPaid:      1250000,
  platform:       "Airbnb",
  reservationId:  "HMC-20260419-4821",
  specialRequests:"조용한 층 선호, 늦은 체크아웃 희망",
};

export const DEVICES_INIT = [
  {id:"lock",    label:"현관 도어락",     icon:"🔒", type:"lock",    state:false, category:"security",       automationControlled:false},
  {id:"ac_l",    label:"거실 에어컨",     icon:"❄️", type:"ac",      state:true,  temp:22, category:"climate",  automationControlled:true},
  {id:"ac_b",    label:"침실 에어컨",     icon:"❄️", type:"ac",      state:false, temp:24, category:"climate",  automationControlled:false},
  {id:"light",   label:"메인 조명",       icon:"💡", type:"light",   state:true,  brightness:80, category:"lighting",  automationControlled:true},
  {id:"mood",    label:"작은 스탠드",      icon:"🕯️", type:"switch",  state:false,              category:"lighting",  automationControlled:false},
  {id:"tv",      label:"스마트 TV",       icon:"📺", type:"toggle",  state:false, category:"entertainment",  automationControlled:false},
  {id:"curtain", label:"전동 커튼",       icon:"🪟", type:"curtain", state:true,  open:60, category:"comfort",   automationControlled:true},
];

export const EXPENSES = [
  {date:"04/19", desc:"객실 요금 (5박)",        amount: 1150000, type:"income"},
  {date:"04/19", desc:"청소비",                  amount:   50000, type:"income"},
  {date:"04/19", desc:"플랫폼 수수료 (Airbnb)", amount: -138000, type:"expense"},
  {date:"04/19", desc:"청소 직원 비용",          amount:  -85000, type:"expense"},
  {date:"04/19", desc:"소모품 보충",             amount:  -12000, type:"expense"},
];

export default {
  ALL_PROPS,
  AUTO_RULES,
  BOOKING,
  CLEANERS,
  DEVICES_INIT,
  EXPENSES,
  HEALTH_LOG,
  INIT_ALERTS,
  INTERVENTION_LABELS,
  PC,
  SC,
  SINGLE_PROP,
  SMART_SWITCHES,
  rand,
  randN,
};
