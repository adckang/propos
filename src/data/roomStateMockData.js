// roomStateMockData.js — Room State Machine UI 전용 목업 데이터

// daysOffset 기준 날짜 생성 (hourDecimal: 15.5 = 15:30)
function o(daysOffset, hourDecimal = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(Math.floor(hourDecimal), Math.round((hourDecimal % 1) * 60), 0, 0);
  return d;
}

// 요일 기반 상대 오프셋 사전 계산 (모듈 로드 시 1회)
const _d = (() => {
  const dow = new Date().getDay(); // 0=Sun, 6=Sat
  const pSat  = dow === 6 ? 0 : -(((dow + 1) % 7) || 7);
  const nSat  = dow === 6 ? 7 : (6 - dow);
  const pSun  = -dow;
  const nSun  = dow === 0 ? 7 : (7 - dow);
  const pFri  = -(((dow - 5 + 7) % 7) || 7);
  const nFri  = (5 - dow + 7) % 7 || 7;
  const nMon  = (1 - dow + 7) % 7 || 7;
  return {
    pSat, nSat, pSun, nSun, pFri, nFri, nMon,
    pSat2: pSat - 7,
    nSat2: nSat + 7,
    nSun2: nSun + 7,
    nFri2: nFri + 7,
    nMon2: nMon + 7,
  };
})();

export const STATE_META = {
  VACANT: {
    label: '공실', color: '#7e8f9c', lightColor: '#a8b8c4',
    bg: '#f5f7f9', border: '#cdd5da',
    subStates: {
      CLEANING_FINISHED: { label: '청소완료' },
      MAINTENANCE: { label: '기타정비' },
    },
  },
  PRE_STAY_READY: {
    label: '입실전', color: '#48a88a', lightColor: '#7ac4ad',
    bg: '#ecf5f1', border: '#9dd4c4',
    subStates: {
      OPTIMIZING: { label: '최적화중' },
      OPTIMIZED:  { label: '최적화완료' },
    },
  },
  OCCUPIED: {
    label: '체류중', color: '#5580c0', lightColor: '#80a4d8',
    bg: '#eaeff8', border: '#9ab8e0',
    subStates: {
      ISSUE_AND_ENERGY: { label: '민원+에너지낭비' },
      ISSUE_COMPLAINT:  { label: '민원발생' },
      ENERGY_WASTE:     { label: '에너지낭비' },
      GOOD_CONDITION:   { label: '상태좋음' },
    },
  },
  CLEANING: {
    label: '청소중', color: '#c86870', lightColor: '#e0989e',
    bg: '#f7edee', border: '#e0b0b4',
    subStates: {
      CLEANING_PENDING:     { label: '청소대기' },
      CLEANING_IN_PROGRESS: { label: '청소진행중' },
    },
  },
};

// ── 숙소 목록 (총 20개) ────────────────────────────────────────────────────────

export const PROPERTIES = [

  // ══════════════════════════════════════════════════════════════════════
  //  OCCUPIED — 체류중 (7개)
  // ══════════════════════════════════════════════════════════════════════

  // P001: 금→월 (2박) — 정상 체류, 모션 감지 중
  {
    id: 'P001', name: '서래마을 A호', district: '서초구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED', start: o(-5, 13),          end: o(_d.pFri - 1, 14) },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',        start: o(_d.pFri - 1, 14), end: o(_d.pFri, 15)     },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',         start: o(_d.pFri, 15),     end: o(_d.pFri, 16)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',    start: o(_d.pFri, 16),     end: null               },
    ],
    reservation: { guestName: '김민준', platform: 'Airbnb',
      checkIn: o(_d.pFri, 16), checkOut: o(_d.nMon, 11) },
    reservations: [
      { guestName: '이수진',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '박준혁 커플',     platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '최지우 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+11, 11) },
      { guestName: '정승현',          platform: 'Airbnb',      checkIn: o(_d.nFri+11, 15),   checkOut: o(_d.nFri+13, 11) },
      { guestName: '한미래 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '오태양',          platform: '여기어때',    checkIn: o(_d.nFri+22, 15),   checkOut: o(_d.nFri+25, 11) },
      { guestName: '류나래 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+25, 15),   checkOut: o(_d.nFri+28, 11) },
      { guestName: '문지훈',          platform: '야놀자',      checkIn: o(_d.nFri+29, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '서준호 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+32, 16),   checkOut: o(_d.nFri+36, 11) },
      { guestName: '임소율 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+36, 14),   checkOut: o(_d.nFri+43, 11) },
    ],
    sensors: { temp: 23.8, humidity: 56, noise: 32, power: 680, co2: 640,
      outdoorTemp: 28, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P002: 토→월 (2박) — 정상 체류
  {
    id: 'P002', name: '반포 B호', district: '서초구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 10),         end: o(-4, 12.5)         },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-4, 12.5),       end: o(_d.pSat - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pSat - 1, 13),end: o(_d.pSat, 13.5)    },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',            start: o(_d.pSat, 13.5),  end: o(_d.pSat, 14)      },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),    end: null                },
    ],
    reservation: { guestName: '강사랑', platform: '야놀자',
      checkIn: o(_d.pSat, 14), checkOut: o(_d.nMon, 11) },
    reservations: [
      { guestName: '윤미래 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri, 16),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '임지호 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+3, 16),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '배수아',          platform: 'Airbnb',      checkIn: o(_d.nFri+7, 15),    checkOut: o(_d.nFri+9, 11) },
      { guestName: '조현우',          platform: '야놀자',      checkIn: o(_d.nFri+10, 15),   checkOut: o(_d.nFri+13, 11) },
      { guestName: '황지민 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 15),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '신동엽',          platform: 'Airbnb',      checkIn: o(_d.nFri+22, 15),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '권미소 가족',     platform: '여기어때',    checkIn: o(_d.nFri+25, 14),   checkOut: o(_d.nFri+29, 11) },
      { guestName: '탁준서',          platform: '야놀자',      checkIn: o(_d.nFri+29, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '홍지연 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+32, 16),   checkOut: o(_d.nFri+37, 11) },
      { guestName: '오민규 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+37, 15),   checkOut: o(_d.nFri+44, 11) },
    ],
    sensors: { temp: 24.5, humidity: 53, noise: 38, power: 760, co2: 710,
      outdoorTemp: 29, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P003: 장기 비즈니스 체류 (4일째) — 다음 주 금 퇴실 예정
  {
    id: 'P003', name: '청담 C호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-7, 11),  end: o(-7, 13)   },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-7, 13),  end: o(-5, 14)   },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(-5, 14),  end: o(-4, 15)   },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',            start: o(-4, 15),  end: o(-4, 16)   },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(-4, 16),  end: null        },
    ],
    reservation: { guestName: '류미선 (비즈니스)', platform: 'Airbnb',
      checkIn: o(-4, 16), checkOut: o(_d.nFri, 11) },
    reservations: [
      { guestName: '문준서',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+1, 11) },
      { guestName: '백나래 커플',     platform: '야놀자',      checkIn: o(_d.nFri+2, 15),    checkOut: o(_d.nFri+5, 11) },
      { guestName: '이강현 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '오유진',          platform: 'Airbnb',      checkIn: o(_d.nFri+12, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '서민재 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '권도윤',          platform: '여기어때',    checkIn: o(_d.nFri+22, 15),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '정하은 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+25, 16),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '강민서',          platform: 'Airbnb',      checkIn: o(_d.nFri+30, 15),   checkOut: o(_d.nFri+32, 11) },
      { guestName: '윤승호 커플',     platform: '야놀자',      checkIn: o(_d.nFri+33, 15),   checkOut: o(_d.nFri+36, 11) },
      { guestName: '한지수 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+36, 14),   checkOut: o(_d.nFri+43, 11) },
    ],
    sensors: { temp: 23.3, humidity: 55, noise: 28, power: 550, co2: 620,
      outdoorTemp: 27, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P004: 금→다음주 일 (9박 — 장기 가족여행)
  {
    id: 'P004', name: '방배 D호', district: '서초구',
    checkInHour: 14, checkOutHour: 11, cleaningDurationHours: 2.5,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-8, 10),          end: o(-8, 12.5)         },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-8, 12.5),        end: o(_d.pFri - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pFri - 1, 13), end: o(_d.pFri, 15.5)    },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',            start: o(_d.pFri, 15.5),   end: o(_d.pFri, 17)      },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pFri, 17),     end: null                },
    ],
    reservation: { guestName: '최준서 가족', platform: 'Airbnb',
      checkIn: o(_d.pFri, 17), checkOut: o(_d.nSun, 11) },
    reservations: [
      { guestName: '홍미나',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+3, 11) },
      { guestName: '남지현 커플',     platform: '야놀자',      checkIn: o(_d.nFri+4, 15),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '이도현 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '장수현',          platform: 'Airbnb',      checkIn: o(_d.nFri+12, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '방소희 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '설민재',          platform: '여기어때',    checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '조태준 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+24, 16),   checkOut: o(_d.nFri+29, 11) },
      { guestName: '김나래 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+29, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '박서윤',          platform: '야놀자',      checkIn: o(_d.nFri+32, 15),   checkOut: o(_d.nFri+34, 11) },
      { guestName: '이현우 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+35, 14),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 25.2, humidity: 50, noise: 44, power: 1150, co2: 750,
      outdoorTemp: 30, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P005: 토→화 (3박) — 에너지낭비 감지 (에어컨 켜놓고 외출, 모션 없음)
  {
    id: 'P005', name: '논현 E호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ENERGY_WASTE' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-5, 13),          end: o(_d.pSat - 1, 13) },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pSat - 1, 13), end: o(_d.pSat, 13)     },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',            start: o(_d.pSat, 13),     end: o(_d.pSat, 14)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),     end: o(0, 4)            },
      { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE',         start: o(0, 4),            end: null               },
    ],
    reservation: { guestName: '정수아', platform: '야놀자',
      checkIn: o(_d.pSat, 14), checkOut: o(2, 11) },
    reservations: [
      { guestName: '탁민준',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '감사랑',          platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '염지수 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+7, 14),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '김한솔',          platform: '에어클라우드', checkIn: o(_d.nFri+15, 16),   checkOut: o(_d.nFri+19, 11) },
      { guestName: '이수진 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '박준혁',          platform: '여기어때',    checkIn: o(_d.nFri+23, 15),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '최유리',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '정미래 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+31, 16),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '한도윤 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+35, 14),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 27.4, humidity: 42, noise: 45, power: 3240, co2: 780,
      outdoorTemp: 33, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P006: 금→월 — 새벽 소음 민원 (파티 추정)
  {
    id: 'P006', name: '신사 F호', district: '강남구',
    checkInHour: 16, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_COMPLAINT' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED', start: o(-6, 14),          end: o(_d.pFri - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',        start: o(_d.pFri - 1, 13), end: o(_d.pFri, 15)      },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',         start: o(_d.pFri, 15),     end: o(_d.pFri, 16)      },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',    start: o(_d.pFri, 16),     end: o(_d.pSat, 2.5)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT',   start: o(_d.pSat, 2.5),    end: null                },
    ],
    reservation: { guestName: '한서진', platform: '야놀자',
      checkIn: o(_d.pFri, 16), checkOut: o(_d.nMon, 11) },
    reservations: [
      { guestName: '오태양',          platform: 'Airbnb',      checkIn: o(_d.nFri, 16),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '강미래',          platform: '야놀자',      checkIn: o(_d.nFri+3, 16),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '윤준서 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '임소율',          platform: 'Airbnb',      checkIn: o(_d.nFri+14, 16),   checkOut: o(_d.nFri+16, 11) },
      { guestName: '배도현 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+17, 16),   checkOut: o(_d.nFri+20, 11) },
      { guestName: '조유나',          platform: '여기어때',    checkIn: o(_d.nFri+21, 16),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '서진아 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '최민호',          platform: '야놀자',      checkIn: o(_d.nFri+31, 16),   checkOut: o(_d.nFri+33, 11) },
      { guestName: '이채원 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+34, 16),   checkOut: o(_d.nFri+38, 11) },
      { guestName: '박다솜 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+38, 16),   checkOut: o(_d.nFri+40, 11) },
    ],
    sensors: { temp: 23.5, humidity: 62, noise: 78, power: 980, co2: 850,
      outdoorTemp: 29, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P007: 목→월 — 민원+에너지낭비 복합
  {
    id: 'P007', name: '역삼 G호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_AND_ENERGY' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED', start: o(-8, 14),      end: o(-4, 13)        },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',        start: o(-4, 13),      end: o(-3, 14.5)      },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',    start: o(-3, 14.5),    end: o(_d.pSat, 21)   },
      { mainStatus: 'OCCUPIED',       subStatus: 'ENERGY_WASTE',      start: o(_d.pSat, 21), end: o(0, 1.5)        },
      { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_AND_ENERGY',  start: o(0, 1.5),      end: null             },
    ],
    reservation: { guestName: '윤태민', platform: 'Airbnb',
      checkIn: o(-3, 14.5), checkOut: o(_d.nMon, 11) },
    reservations: [
      { guestName: '황지수',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '신미래',          platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+5, 11) },
      { guestName: '류준호 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+7, 14),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '문소연 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+14, 16),   checkOut: o(_d.nFri+19, 11) },
      { guestName: '백승호',          platform: 'Airbnb',      checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '이나래 커플',     platform: '여기어때',    checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '강현준',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '조미선',          platform: '야놀자',      checkIn: o(_d.nFri+35, 15),   checkOut: o(_d.nFri+37, 11) },
      { guestName: '임도현 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+38, 16),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 28.1, humidity: 38, noise: 83, power: 3450, co2: 1150,
      outdoorTemp: 32, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // ══════════════════════════════════════════════════════════════════════
  //  VACANT / PRE_STAY_READY — 곧 체크인 (4개)
  // ══════════════════════════════════════════════════════════════════════

  // P008: 내일 체크인 예정 — 공실 대기 중
  {
    id: 'P008', name: '압구정 H호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(-11, 15), end: o(-5, 11)  },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING',     start: o(-5, 11),  end: o(-5, 12)  },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 12),  end: o(-5, 14)  },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-5, 14),  end: null       },
    ],
    reservation: { guestName: '송유나', platform: 'Airbnb',
      checkIn: o(_d.nMon, 15), checkOut: o(_d.nMon + 2, 11) },
    reservations: [
      { guestName: '송유나',          platform: 'Airbnb',      checkIn: o(_d.nMon, 15),      checkOut: o(_d.nMon+2, 11) },
      { guestName: '강태양 커플',     platform: '야놀자',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '오지수',          platform: 'Airbnb',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '임현우 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+7, 14),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '배민서 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+14, 16),   checkOut: o(_d.nFri+19, 11) },
      { guestName: '조다솜 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '황민준',          platform: '여기어때',    checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '서아현',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '최태준 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+31, 16),   checkOut: o(_d.nFri+36, 11) },
      { guestName: '권다인 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+36, 14),   checkOut: o(_d.nFri+43, 11) },
    ],
    sensors: { temp: 22.4, humidity: 54, noise: 18, power: 290, co2: 420,
      outdoorTemp: 30, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P009: 내일 월요일 체크인 (비즈니스 4박)
  {
    id: 'P009', name: '대치 I호', district: '강남구',
    checkInHour: 16, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 10), end: o(-4, 12) },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-4, 12), end: null      },
    ],
    reservation: { guestName: '임지혁 (비즈)', platform: '에어클라우드',
      checkIn: o(_d.nMon, 16), checkOut: o(_d.nFri, 11) },
    reservations: [
      { guestName: '임지혁 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nMon, 16),      checkOut: o(_d.nFri, 11) },
      { guestName: '신지우',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '류하늘 커플',     platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '문태양 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+11, 11) },
      { guestName: '백나래',          platform: 'Airbnb',      checkIn: o(_d.nFri+11, 15),   checkOut: o(_d.nFri+13, 11) },
      { guestName: '이소연 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '강다현',          platform: '여기어때',    checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '정준혁 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+24, 16),   checkOut: o(_d.nFri+29, 11) },
      { guestName: '박소희 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+29, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '오민재',          platform: '야놀자',      checkIn: o(_d.nFri+32, 16),   checkOut: o(_d.nFri+35, 11) },
    ],
    sensors: { temp: 22.8, humidity: 52, noise: 16, power: 310, co2: 430,
      outdoorTemp: 30, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P010: 이틀 뒤 토요일 체크인 (2박)
  {
    id: 'P010', name: '삼성 J호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(-8, 15),      end: o(_d.pSat, 11)  },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING',     start: o(_d.pSat, 11), end: o(_d.pSat, 12)  },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(_d.pSat, 12), end: o(_d.pSat, 14)  },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(_d.pSat, 14), end: null            },
    ],
    reservation: { guestName: '강다솜 가족', platform: 'Airbnb',
      checkIn: o(2, 15), checkOut: o(_d.nSun, 11) },
    reservations: [
      { guestName: '강다솜 가족',     platform: 'Airbnb',      checkIn: o(2, 15),            checkOut: o(_d.nSun, 11) },
      { guestName: '오준혁 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+3, 16),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '서지안 커플',     platform: '야놀자',       checkIn: o(_d.nFri+7, 15),    checkOut: o(_d.nFri+9, 11) },
      { guestName: '임하나',          platform: 'Airbnb',      checkIn: o(_d.nFri+10, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '배준서 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '조민지',          platform: '에어클라우드', checkIn: o(_d.nFri+21, 16),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '황수연',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '탁나래',          platform: '여기어때',    checkIn: o(_d.nFri+31, 15),   checkOut: o(_d.nFri+34, 11) },
      { guestName: '남민준 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+35, 16),   checkOut: o(_d.nFri+40, 11) },
      { guestName: '이서아 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+40, 15),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 23.1, humidity: 56, noise: 17, power: 275, co2: 415,
      outdoorTemp: 29, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P011: 이틀 뒤 체크인 (2박)
  {
    id: 'P011', name: '도곡 K호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED', start: o(-5, 13), end: null },
    ],
    reservation: { guestName: '조민서', platform: '야놀자',
      checkIn: o(2, 15), checkOut: o(4, 11) },
    reservations: [
      { guestName: '조민서',          platform: '야놀자',      checkIn: o(2, 15),            checkOut: o(4, 11) },
      { guestName: '최태양 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri, 16),      checkOut: o(_d.nFri+3, 11) },
      { guestName: '정소희 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+4, 16),    checkOut: o(_d.nFri+9, 11) },
      { guestName: '한도현',          platform: 'Airbnb',      checkIn: o(_d.nFri+9, 15),    checkOut: o(_d.nFri+11, 11) },
      { guestName: '오미래 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '강준수',          platform: '야놀자',      checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '윤지현 커플',     platform: '여기어때',    checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '백서준',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '김아린 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+31, 16),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '류다솜',          platform: 'Airbnb',      checkIn: o(_d.nFri+35, 15),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 22.6, humidity: 55, noise: 19, power: 285, co2: 408,
      outdoorTemp: 28, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // ══════════════════════════════════════════════════════════════════════
  //  CLEANING — 청소중 (3개)
  // ══════════════════════════════════════════════════════════════════════

  // P012: 1박 퇴실 — 청소 대기 중 (청소팀 미도착, 모션 없음)
  {
    id: 'P012', name: '개포 L호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-3, 13),       end: o(_d.pSat, 13.5)   },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pSat, 13.5),end: o(_d.pSat, 14)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),  end: o(0, 11)           },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING',     start: o(0, 11),        end: null               },
    ],
    reservation: { guestName: '박지호', platform: 'Airbnb',
      checkIn: o(_d.nFri+1, 15), checkOut: o(_d.nFri+2, 11) },
    reservations: [
      { guestName: '박지호',          platform: 'Airbnb',      checkIn: o(_d.nFri+1, 15),    checkOut: o(_d.nFri+2, 11) },
      { guestName: '이현수 커플',     platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '최나래 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '정민준',          platform: 'Airbnb',      checkIn: o(_d.nFri+12, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '한수빈 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '오지훈',          platform: '여기어때',    checkIn: o(_d.nFri+21, 15),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '권유나 커플',     platform: '야놀자',      checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '서태준',          platform: 'Airbnb',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '남지수 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+35, 16),   checkOut: o(_d.nFri+40, 11) },
      { guestName: '홍민재',          platform: 'Airbnb',      checkIn: o(_d.nFri+40, 15),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 24.2, humidity: 60, noise: 22, power: 330, co2: 510,
      outdoorTemp: 30, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P013: 2박 퇴실 — 청소 진행 중 (청소팀 작업 중, 모션 감지, 청소기 전력)
  {
    id: 'P013', name: '수서 M호', district: '강남구',
    checkInHour: 16, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
    timeline: [
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 11),      end: o(-5, 13)       },
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-5, 13),      end: o(_d.pFri, 15)  },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pFri, 15), end: o(_d.pFri, 16)  },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZED',            start: o(_d.pFri, 16), end: o(_d.pFri, 17)  },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pFri, 17), end: o(0, 11)        },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING',     start: o(0, 11),       end: o(0, 11.5)      },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(0, 11.5),     end: null            },
    ],
    reservation: { guestName: '최유리', platform: 'Airbnb',
      checkIn: o(_d.nFri, 16), checkOut: o(_d.nFri+2, 11) },
    reservations: [
      { guestName: '최유리',          platform: 'Airbnb',      checkIn: o(_d.nFri, 16),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '강민호',          platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '윤서아 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '임지현 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 15),   checkOut: o(_d.nFri+16, 11) },
      { guestName: '배도윤 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+17, 14),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '조수현',          platform: '여기어때',    checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '박현아 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+27, 16),   checkOut: o(_d.nFri+32, 11) },
      { guestName: '문소율',          platform: 'Airbnb',      checkIn: o(_d.nFri+32, 15),   checkOut: o(_d.nFri+34, 11) },
      { guestName: '오승진 커플',     platform: '야놀자',      checkIn: o(_d.nFri+35, 15),   checkOut: o(_d.nFri+38, 11) },
      { guestName: '탁미래 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+38, 14),   checkOut: o(_d.nFri+45, 11) },
    ],
    sensors: { temp: 23.8, humidity: 65, noise: 54, power: 1280, co2: 540,
      outdoorTemp: 30, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // P014: 이슈 있던 숙소 — 청소 진행 중 (청소팀 작업 중)
  {
    id: 'P014', name: '자곡 N호', district: '강남구',
    checkInHour: 14, checkOutHour: 11, cleaningDurationHours: 2.5,
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
    timeline: [
      { mainStatus: 'VACANT',         subStatus: 'CLEANING_FINISHED',    start: o(-4, 14),       end: o(_d.pSat, 13.5)   },
      { mainStatus: 'PRE_STAY_READY', subStatus: 'OPTIMIZING',           start: o(_d.pSat, 13.5),end: o(_d.pSat, 14)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),  end: o(_d.pSat, 23)     },
      { mainStatus: 'OCCUPIED',       subStatus: 'ISSUE_COMPLAINT',      start: o(_d.pSat, 23),  end: o(0, 11)           },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_PENDING',     start: o(0, 11),        end: o(0, 12)           },
      { mainStatus: 'CLEANING',       subStatus: 'CLEANING_IN_PROGRESS', start: o(0, 12),        end: null               },
    ],
    reservation: { guestName: '김태양', platform: '야놀자',
      checkIn: o(_d.nFri+1, 14), checkOut: o(_d.nFri+2, 11) },
    reservations: [
      { guestName: '김태양',          platform: '야놀자',      checkIn: o(_d.nFri+1, 14),    checkOut: o(_d.nFri+2, 11) },
      { guestName: '이미래 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '박서준 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '최유진',          platform: 'Airbnb',      checkIn: o(_d.nFri+12, 14),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '정다은 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '한채원',          platform: '여기어때',    checkIn: o(_d.nFri+22, 15),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '강유진 커플',     platform: '야놀자',      checkIn: o(_d.nFri+25, 15),   checkOut: o(_d.nFri+29, 11) },
      { guestName: '윤현우 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+30, 16),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '임지나',          platform: 'Airbnb',      checkIn: o(_d.nFri+35, 14),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 24.5, humidity: 68, noise: 58, power: 1350, co2: 555,
      outdoorTemp: 31, doorOpen: false, motionDetected: true, smokeDetected: false },
  },

  // ══════════════════════════════════════════════════════════════════════
  //  VACANT — 공실 (6개) — 미래 예약이 Gantt에 표시됨
  // ══════════════════════════════════════════════════════════════════════

  // P015: 다음 금→일 예약 — AC 예열 중, 모션 없음
  {
    id: 'P015', name: '세곡 O호', district: '강남구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15),   end: o(-5, 11)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 11),   end: o(-5, 13.5) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-5, 13.5), end: null        },
    ],
    reservation: { guestName: '이서연', platform: 'Airbnb',
      checkIn: o(_d.nFri, 15), checkOut: o(_d.nFri+2, 11) },
    reservations: [
      { guestName: '이서연',          platform: 'Airbnb',      checkIn: o(_d.nFri, 15),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '박현아 커플',     platform: '야놀자',      checkIn: o(_d.nFri+3, 15),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '최준혁 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 16),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '정소율',          platform: 'Airbnb',      checkIn: o(_d.nFri+14, 15),   checkOut: o(_d.nFri+16, 11) },
      { guestName: '한도윤 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+17, 14),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '오수민',          platform: '여기어때',    checkIn: o(_d.nFri+24, 15),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '강하은',          platform: '야놀자',      checkIn: o(_d.nFri+28, 15),   checkOut: o(_d.nFri+31, 11) },
      { guestName: '류민서 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+32, 15),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '임진우 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+35, 16),   checkOut: o(_d.nFri+40, 11) },
      { guestName: '윤소현',          platform: 'Airbnb',      checkIn: o(_d.nFri+40, 15),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 24.2, humidity: 53, noise: 20, power: 850, co2: 425,
      outdoorTemp: 31, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P016: 다음 금→월 예약 (3박)
  {
    id: 'P016', name: '일원 P호', district: '강남구',
    checkInHour: 18, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-5, 14), end: o(-3, 11) },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 11), end: o(-3, 13) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 13), end: null      },
    ],
    reservation: { guestName: '정하늘', platform: 'Airbnb',
      checkIn: o(_d.nFri, 18), checkOut: o(_d.nFri+3, 11) },
    reservations: [
      { guestName: '정하늘',          platform: 'Airbnb',      checkIn: o(_d.nFri, 18),      checkOut: o(_d.nFri+3, 11) },
      { guestName: '강윤아',          platform: '야놀자',      checkIn: o(_d.nFri+4, 16),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '윤준혁 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 18),    checkOut: o(_d.nFri+12, 11) },
      { guestName: '임나래',          platform: 'Airbnb',      checkIn: o(_d.nFri+12, 18),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '배소현 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 16),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '조태민',          platform: '여기어때',    checkIn: o(_d.nFri+21, 18),   checkOut: o(_d.nFri+22, 11) },
      { guestName: '홍나현 커플',     platform: '야놀자',      checkIn: o(_d.nFri+24, 18),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '서민규 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+28, 18),   checkOut: o(_d.nFri+33, 11) },
      { guestName: '최다솜',          platform: 'Airbnb',      checkIn: o(_d.nFri+33, 18),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '박준호 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+35, 16),   checkOut: o(_d.nFri+42, 11) },
    ],
    sensors: { temp: 22.9, humidity: 56, noise: 16, power: 265, co2: 412,
      outdoorTemp: 30, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P017: 다음 주 화요일 체크인 예정 — 공실
  {
    id: 'P017', name: '문정 Q호', district: '송파구',
    checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15), end: o(-3, 11) },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 11), end: o(-3, 13) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 13), end: null      },
    ],
    reservation: { guestName: '윤혜진', platform: 'Airbnb',
      checkIn: o(_d.nFri+4, 15), checkOut: o(_d.nFri+7, 11) },
    reservations: [
      { guestName: '윤혜진',          platform: 'Airbnb',      checkIn: o(_d.nFri+4, 15),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '신준서 커플',     platform: '야놀자',      checkIn: o(_d.nFri+7, 15),    checkOut: o(_d.nFri+9, 11) },
      { guestName: '류미나 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+10, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '문현우 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '백지수',          platform: '에어클라우드', checkIn: o(_d.nFri+21, 16),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '이강민',          platform: '여기어때',    checkIn: o(_d.nFri+26, 15),   checkOut: o(_d.nFri+28, 11) },
      { guestName: '감재원',          platform: 'Airbnb',      checkIn: o(_d.nFri+29, 15),   checkOut: o(_d.nFri+32, 11) },
      { guestName: '탁현지 커플',     platform: '야놀자',      checkIn: o(_d.nFri+32, 15),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '염도현 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+36, 16),   checkOut: o(_d.nFri+41, 11) },
      { guestName: '강소영 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+41, 14),   checkOut: o(_d.nFri+45, 11) },
    ],
    sensors: { temp: 23.5, humidity: 54, noise: 18, power: 280, co2: 418,
      outdoorTemp: 29, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P018: 정비 후 청소완료. 다음 토 예약
  {
    id: 'P018', name: '잠실 R호', district: '송파구',
    checkInHour: 14, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-6, 14), end: o(-4, 10)  },
      { mainStatus: 'VACANT',   subStatus: 'MAINTENANCE',          start: o(-4, 10), end: o(-2, 16)  },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-2, 16), end: o(-2, 18)  },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-2, 18), end: null       },
    ],
    reservation: { guestName: '강지민', platform: '에어클라우드',
      checkIn: o(_d.nFri+1, 14), checkOut: o(_d.nFri+4, 11) },
    reservations: [
      { guestName: '강지민',          platform: '에어클라우드', checkIn: o(_d.nFri+1, 14),    checkOut: o(_d.nFri+4, 11) },
      { guestName: '오현아 커플',     platform: '야놀자',      checkIn: o(_d.nFri+7, 15),    checkOut: o(_d.nFri+9, 11) },
      { guestName: '서태준',          platform: 'Airbnb',      checkIn: o(_d.nFri+10, 15),   checkOut: o(_d.nFri+14, 11) },
      { guestName: '권미래 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+14, 14),   checkOut: o(_d.nFri+21, 11) },
      { guestName: '홍수연 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+21, 16),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '남도현',          platform: '여기어때',    checkIn: o(_d.nFri+26, 15),   checkOut: o(_d.nFri+28, 11) },
      { guestName: '임채영 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+29, 14),   checkOut: o(_d.nFri+32, 11) },
      { guestName: '최서율',          platform: '야놀자',      checkIn: o(_d.nFri+32, 15),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '배정민 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+36, 16),   checkOut: o(_d.nFri+41, 11) },
      { guestName: '조현아 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+41, 14),   checkOut: o(_d.nFri+48, 11) },
    ],
    sensors: { temp: 23.0, humidity: 52, noise: 14, power: 255, co2: 405,
      outdoorTemp: 28, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P019: 이번 금→일 예약
  {
    id: 'P019', name: '신천 S호', district: '송파구',
    checkInHour: 19, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15),   end: o(-3, 11)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING',     start: o(-3, 11),   end: o(-3, 12)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 12),   end: o(-3, 14.5) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 14.5), end: null        },
    ],
    reservation: { guestName: '배수현', platform: 'Airbnb',
      checkIn: o(_d.nFri, 19), checkOut: o(_d.nFri+2, 11) },
    reservations: [
      { guestName: '배수현',          platform: 'Airbnb',      checkIn: o(_d.nFri, 19),      checkOut: o(_d.nFri+2, 11) },
      { guestName: '장민준 커플',     platform: '야놀자',      checkIn: o(_d.nFri+3, 17),    checkOut: o(_d.nFri+6, 11) },
      { guestName: '설나래 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+7, 19),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '탁지수',          platform: 'Airbnb',      checkIn: o(_d.nFri+14, 19),   checkOut: o(_d.nFri+16, 11) },
      { guestName: '감현우 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+17, 18),   checkOut: o(_d.nFri+24, 11) },
      { guestName: '염지수',          platform: '여기어때',    checkIn: o(_d.nFri+24, 17),   checkOut: o(_d.nFri+26, 11) },
      { guestName: '홍재원',          platform: '야놀자',      checkIn: o(_d.nFri+28, 19),   checkOut: o(_d.nFri+30, 11) },
      { guestName: '이수아 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri+31, 19),   checkOut: o(_d.nFri+34, 11) },
      { guestName: '박준영 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+35, 19),   checkOut: o(_d.nFri+40, 11) },
      { guestName: '최민아 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+40, 18),   checkOut: o(_d.nFri+47, 11) },
    ],
    sensors: { temp: 23.4, humidity: 57, noise: 21, power: 300, co2: 430,
      outdoorTemp: 30, doorOpen: false, motionDetected: false, smokeDetected: false },
  },

  // P020: 이번 주 수~토 예약 (3박)
  {
    id: 'P020', name: '풍납 T호', district: '송파구',
    checkInHour: 18, checkOutHour: 11, cleaningDurationHours: 2,
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15), end: o(-4, 11) },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 11), end: o(-4, 13) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-4, 13), end: null      },
    ],
    reservation: { guestName: '임도현', platform: '야놀자',
      checkIn: o(3, 16), checkOut: o(6, 11) },
    reservations: [
      { guestName: '임도현',          platform: '야놀자',      checkIn: o(3, 16),            checkOut: o(6, 11) },
      { guestName: '권소율 커플',     platform: 'Airbnb',      checkIn: o(_d.nFri, 18),      checkOut: o(_d.nFri+3, 11) },
      { guestName: '홍민준',          platform: '야놀자',      checkIn: o(_d.nFri+4, 16),    checkOut: o(_d.nFri+7, 11) },
      { guestName: '남서아 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+7, 14),    checkOut: o(_d.nFri+14, 11) },
      { guestName: '이지훈 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+14, 18),   checkOut: o(_d.nFri+19, 11) },
      { guestName: '방현아',          platform: 'Airbnb',      checkIn: o(_d.nFri+21, 18),   checkOut: o(_d.nFri+23, 11) },
      { guestName: '조수민 커플',     platform: '여기어때',    checkIn: o(_d.nFri+24, 18),   checkOut: o(_d.nFri+27, 11) },
      { guestName: '서준하 (비즈)',   platform: '에어클라우드', checkIn: o(_d.nFri+28, 18),   checkOut: o(_d.nFri+33, 11) },
      { guestName: '최아현',          platform: '야놀자',      checkIn: o(_d.nFri+33, 16),   checkOut: o(_d.nFri+35, 11) },
      { guestName: '이민경 가족',     platform: 'Airbnb',      checkIn: o(_d.nFri+36, 14),   checkOut: o(_d.nFri+43, 11) },
    ],
    sensors: { temp: 23.2, humidity: 55, noise: 17, power: 270, co2: 410,
      outdoorTemp: 29, doorOpen: false, motionDetected: false, smokeDetected: false },
  },
];

// ── Detail View 서브 상태별 색상 ──────────────────────────────────────────────
export const SEGMENT_COLORS = {
  'VACANT/CLEANING_FINISHED':       '#c0cdd4',
  'VACANT/MAINTENANCE':             '#a8b8c4',
  'PRE_STAY_READY/OPTIMIZING':      '#7ac4ad',
  'PRE_STAY_READY/OPTIMIZED':       '#48a88a',
  'OCCUPIED/GOOD_CONDITION':        '#6898d0',
  'OCCUPIED/ENERGY_WASTE':          '#d4a844',
  'OCCUPIED/ISSUE_COMPLAINT':       '#d07848',
  'OCCUPIED/ISSUE_AND_ENERGY':      '#b85868',
  'CLEANING/CLEANING_PENDING':      '#e0a8ac',
  'CLEANING/CLEANING_IN_PROGRESS':  '#c86870',
};

// ── 미래 상태 예측 세그먼트 생성 (예약 데이터 기반) ───────────────────────────

function addResCycles(push, property, firstRes, cursor, windowEnd) {
  const cleanH = property.cleaningDurationHours ?? 2.5;
  const all    = property.reservations
    ? property.reservations.filter(r => r.checkIn > cursor && r.checkIn < windowEnd)
                           .sort((a, b) => a.checkIn - b.checkIn)
    : (firstRes && firstRes.checkIn > cursor ? [firstRes] : []);

  for (const r of all) {
    if (cursor >= windowEnd) break;
    const ci = r.checkIn;
    const co = r.checkOut;
    const prepAt = new Date(Math.max(cursor.getTime(), ci.getTime() - 3600000));
    const optEnd = new Date(ci.getTime() - 0.5 * 3600000);
    if (prepAt > cursor) { push('VACANT', 'CLEANING_FINISHED', cursor, prepAt); cursor = prepAt; }
    if (cursor < optEnd) { push('PRE_STAY_READY', 'OPTIMIZING', cursor, optEnd); cursor = optEnd; }
    if (cursor < ci)     { push('PRE_STAY_READY', 'OPTIMIZED',  cursor, ci);    cursor = new Date(ci); }
    if (co && co > cursor) { push('OCCUPIED', 'GOOD_CONDITION',         cursor, co);       cursor = new Date(co); }
    const cleanEnd = new Date(cursor.getTime() + cleanH * 3600000);
    push('CLEANING', 'CLEANING_IN_PROGRESS', cursor, cleanEnd);
    cursor = cleanEnd;
  }
  return cursor;
}

function buildFutureSegments(property, windowEnd) {
  const now = new Date();
  const { reservation, timeline } = property;
  const currentSeg = [...timeline].reverse().find(s => s.end === null);
  if (!currentSeg) return [];

  const segs = [];
  let cursor = new Date(now);
  const cleanH = property.cleaningDurationHours ?? 2.5;

  const push = (mainStatus, subStatus, start, end) => {
    const s = start < now ? now : start;
    const e = end > windowEnd ? windowEnd : end;
    if (s >= e) return;
    segs.push({ mainStatus, subStatus, start: new Date(s), end: new Date(e), isFuture: true });
  };

  switch (currentSeg.mainStatus) {
    case 'OCCUPIED': {
      const co = reservation?.checkOut;
      if (!co || co <= now) break;
      push('OCCUPIED', currentSeg.subStatus, cursor, co);
      cursor = new Date(co);
      const cleanEnd = new Date(cursor.getTime() + cleanH * 3600000);
      push('CLEANING', 'CLEANING_IN_PROGRESS', cursor, cleanEnd);
      cursor = cleanEnd;
      cursor = addResCycles(push, property, null, cursor, windowEnd);
      push('VACANT', 'CLEANING_FINISHED', cursor, windowEnd);
      break;
    }
    case 'CLEANING': {
      const cleanDone = new Date(now.getTime() + cleanH * 3600000);
      push('CLEANING', currentSeg.subStatus, cursor, cleanDone);
      cursor = cleanDone;
      const ci = reservation?.checkIn;
      const co = reservation?.checkOut;
      if (ci && ci > cursor && ci < windowEnd) {
        const prepAt = new Date(Math.max(cursor.getTime(), ci.getTime() - 3600000));
        const optEnd = new Date(ci.getTime() - 0.5 * 3600000);
        push('VACANT', 'CLEANING_FINISHED', cursor, prepAt);
        if (prepAt > cursor) cursor = prepAt;
        if (cursor < optEnd) { push('PRE_STAY_READY', 'OPTIMIZING', cursor, optEnd); cursor = optEnd; }
        if (cursor < ci)     { push('PRE_STAY_READY', 'OPTIMIZED', cursor, ci);      cursor = new Date(ci); }
        if (co && co > cursor) { push('OCCUPIED', 'GOOD_CONDITION', cursor, co); cursor = new Date(co); }
        const c2 = new Date(cursor.getTime() + cleanH * 3600000);
        push('CLEANING', 'CLEANING_IN_PROGRESS', cursor, c2);
        cursor = c2;
      }
      cursor = addResCycles(push, property, null, cursor, windowEnd);
      push('VACANT', 'CLEANING_FINISHED', cursor, windowEnd);
      break;
    }
    case 'PRE_STAY_READY': {
      const ci = reservation?.checkIn;
      if (!ci || ci <= now) break;
      push('PRE_STAY_READY', currentSeg.subStatus, cursor, ci);
      cursor = new Date(ci);
      const co = reservation?.checkOut;
      if (co && co > cursor) { push('OCCUPIED', 'GOOD_CONDITION', cursor, co); cursor = new Date(co); }
      const cleanEnd = new Date(cursor.getTime() + cleanH * 3600000);
      push('CLEANING', 'CLEANING_IN_PROGRESS', cursor, cleanEnd);
      cursor = cleanEnd;
      cursor = addResCycles(push, property, null, cursor, windowEnd);
      push('VACANT', 'CLEANING_FINISHED', cursor, windowEnd);
      break;
    }
    case 'VACANT': {
      const ci = reservation?.checkIn;
      if (!ci || ci <= now || ci >= windowEnd) {
        cursor = addResCycles(push, property, null, cursor, windowEnd);
        push('VACANT', currentSeg.subStatus, cursor, windowEnd);
        break;
      }
      const prepAt = new Date(Math.max(cursor.getTime(), ci.getTime() - 3600000));
      const optEnd = new Date(ci.getTime() - 0.5 * 3600000);
      push('VACANT', currentSeg.subStatus, cursor, prepAt);
      if (prepAt > cursor) cursor = prepAt;
      if (cursor < optEnd) { push('PRE_STAY_READY', 'OPTIMIZING', cursor, optEnd); cursor = optEnd; }
      if (cursor < ci)     { push('PRE_STAY_READY', 'OPTIMIZED', cursor, ci);      cursor = new Date(ci); }
      const co = reservation?.checkOut;
      if (co && co > cursor) { push('OCCUPIED', 'GOOD_CONDITION', cursor, co); cursor = new Date(co); }
      const cleanEnd = new Date(cursor.getTime() + cleanH * 3600000);
      push('CLEANING', 'CLEANING_IN_PROGRESS', cursor, cleanEnd);
      cursor = cleanEnd;
      cursor = addResCycles(push, property, null, cursor, windowEnd);
      push('VACANT', 'CLEANING_FINISHED', cursor, windowEnd);
      break;
    }
  }
  return segs;
}

// ── Detail View용: 과거 N시간 + 미래 M시간 세그먼트 ───────────────────────────
export function getWindowSegments(property, pastHours, futureHours) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - pastHours * 3600000);
  const windowEnd   = new Date(now.getTime() + futureHours * 3600000);

  const pastSegs = property.timeline
    .map(seg => {
      const s = seg.start < windowStart ? windowStart : seg.start;
      const e = seg.end ?? now;
      if (e <= s) return null;
      return { ...seg, start: s, end: e, isFuture: false };
    })
    .filter(Boolean);

  return [...pastSegs, ...buildFutureSegments(property, windowEnd)];
}

// ── List View Gantt용: windowStart~windowEnd 내 전체 세그먼트 ─────────────────
export function getGanttSegments(property, windowStart, windowEnd) {
  const now = new Date();

  const pastSegs = property.timeline
    .map(seg => {
      const s = seg.start < windowStart ? windowStart : seg.start;
      const e = seg.end ?? now;
      if (e <= s) return null;
      return { ...seg, start: s, end: e, isFuture: false };
    })
    .filter(Boolean);

  return [...pastSegs, ...buildFutureSegments(property, windowEnd)];
}
