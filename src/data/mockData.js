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
const ISSUES_POOL      = ["Wi-Fi 불안정","에어컨 오류","도어락 배터리 부족","온수 문제","청소 미완료","소음 민원"];
const STATUSES         = ["입실중","입실중","입실중","예약됨","예약됨","공실","청소중","점검중"];
const DOOR_LOCK_STATUS = ["정상","정상","정상","정상","정상","배터리부족","미응답","오프라인"];
const SENSOR_HEALTH    = ["정상","정상","정상","정상","일부불량","일부불량","미연결"];
const LAST_CONTROL     = ["방금","방금","5분 전","1시간 전","미기록"];

// ── 전체 숙소 목록 (CommandCenter용) ─────────────────────
export const ALL_PROPS = Array.from({length: 48}, (_, i) => {
  const status = rand(STATUSES);
  const hasG   = status === "입실중" || status === "예약됨";
  return {
    id:        i + 1,
    name:      `${rand(CITIES)} ${rand(TYPES)} #${String(i+1).padStart(3,"0")}`,
    city:      rand(CITIES),
    type:      rand(TYPES),
    status,
    guest:     hasG ? rand(GUESTS_LIST) : null,
    checkIn:   hasG ? `03/${String(randN(1,8)).padStart(2,"0")}` : null,
    checkOut:  hasG ? `03/${String(randN(9,20)).padStart(2,"0")}` : null,
    revenue:   randN(80, 950) * 1000,
    rating:    (4.0 + Math.random()).toFixed(2),
    temp:      randN(17, 25),
    humidity:  randN(40, 70),
    smartLock: Math.random() > 0.2,
    lockOpen:  false,
    acOn:      status === "입실중" && Math.random() > 0.3,
    acTemp:    randN(20, 26),
    lightsOn:  status === "입실중",
    issues:          Math.random() < 0.18 ? [rand(ISSUES_POOL)] : [],
    cleaning:        status === "청소중" ? "진행중" : "완료",
    priority:        Math.random() < 0.18 ? "HIGH" : Math.random() < 0.25 ? "MED" : "OK",
    unreadMsg:       Math.random() < 0.25 ? randN(1, 4) : 0,
    platform:        rand(["Airbnb","Booking","직접예약"]),
    doorLockStatus:  rand(DOOR_LOCK_STATUS),
    sensorHealth:    rand(SENSOR_HEALTH),
    vacancyMode:     status === "공실",
    lastControlAt:   rand(LAST_CONTROL),
    cleanerDetected: status === "청소중" && Math.random() > 0.4,
  };
});

// ── 상태 컬러 맵 (공용) ──────────────────────────────────
export const SC = {"입실중":"#059669","예약됨":"#2563eb","공실":"#94a3b8","청소중":"#d97706","점검중":"#dc2626"};
export const PC = {HIGH:"#dc2626", MED:"#d97706", OK:"#059669"};

// ── 실시간 알림 초기값 (CommandCenter용) ─────────────────
export const INIT_ALERTS = [
  {id:1, type:"error", prop:"서울 강남 아파트 #007",          msg:"도어락 배터리 위험 (5%)",         time:"00:32", ack:false},
  {id:2, type:"warn",  prop:"제주 서귀포 한옥 #019",          msg:"Wi-Fi 연결 끊김 감지",             time:"01:14", ack:false},
  {id:3, type:"warn",  prop:"부산 해운대 펜트하우스 #003",     msg:"에어컨 설정 온도 미달",            time:"01:45", ack:false},
  {id:4, type:"info",  prop:"서울 마포 스튜디오 #011",         msg:"체크아웃 완료 — 청소 배정 필요",  time:"02:00", ack:false},
  {id:5, type:"error", prop:"인천 연수 아파트 #024",           msg:"온수 보일러 응답 없음",            time:"02:18", ack:false},
];

// ── 자동화 규칙 (CommandCenter > 자동화 탭) ───────────────
export const AUTO_RULES = [
  {id:1, name:"체크아웃 후 자동 청소 배정",     trigger:"체크아웃 감지",      action:"청소팀 알림 발송",    active:true},
  {id:2, name:"도어락 배터리 < 20% 알림",       trigger:"배터리 임계값",      action:"관리자 긴급 알림",    active:true},
  {id:3, name:"체크인 2시간 전 PIN 발급",        trigger:"체크인 D-0 13:00",  action:"게스트 자동 문자",    active:true},
  {id:4, name:"미응답 메시지 30분 자동 답변",   trigger:"메시지 미읽음 30분", action:"AI 자동 답변",         active:false},
  {id:5, name:"공실 3일 이상 가격 자동 조정",   trigger:"공실 72h 초과",      action:"플랫폼 가격 10% 인하",active:true},
  {id:6, name:"비정상 온도 감지 → 에어컨 ON",  trigger:"실내 온도 > 30°C",   action:"에어컨 자동 ON",       active:true},
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
};

export const BOOKING = {
  guest:          {name:"田中 花子", avatar:"🇯🇵", phone:"+81-90-1234-5678"},
  checkIn:        "2026-03-07T15:00:00",
  checkOut:       "2026-03-12T11:00:00",
  guests:         2,
  nights:         5,
  totalPaid:      1250000,
  platform:       "Airbnb",
  reservationId:  "HMC-20260307-4821",
  specialRequests:"조용한 층 선호, 늦은 체크아웃 희망",
};

export const DEVICES_INIT = [
  {id:"lock",    label:"현관 도어락", icon:"🔒", type:"lock",    state:false, category:"security"},
  {id:"ac_l",    label:"거실 에어컨", icon:"❄️", type:"ac",      state:true,  temp:22,        category:"climate"},
  {id:"ac_b",    label:"침실 에어컨", icon:"❄️", type:"ac",      state:false, temp:24,        category:"climate"},
  {id:"light",   label:"메인 조명",   icon:"💡", type:"light",   state:true,  brightness:80,  category:"lighting"},
  {id:"mood",    label:"무드 조명",   icon:"🕯️", type:"light",   state:false, brightness:40,  category:"lighting"},
  {id:"tv",      label:"스마트 TV",   icon:"📺", type:"toggle",  state:false, category:"entertainment"},
  {id:"curtain", label:"전동 커튼",   icon:"🪟", type:"curtain", state:true,  open:60,        category:"comfort"},
];

export const EXPENSES = [
  {date:"03/07", desc:"객실 요금 (5박)",        amount: 1150000, type:"income"},
  {date:"03/07", desc:"청소비",                  amount:   50000, type:"income"},
  {date:"03/07", desc:"플랫폼 수수료 (Airbnb)", amount: -138000, type:"expense"},
  {date:"03/07", desc:"청소 직원 비용",          amount:  -85000, type:"expense"},
  {date:"03/07", desc:"소모품 보충",             amount:  -12000, type:"expense"},
];

export default {
  ALL_PROPS,
  AUTO_RULES,
  BOOKING,
  CLEANERS,
  DEVICES_INIT,
  EXPENSES,
  INIT_ALERTS,
  PC,
  SC,
  SINGLE_PROP,
  rand,
  randN,
};
