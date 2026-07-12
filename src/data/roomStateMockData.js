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
  const pSat  = dow === 6 ? 0 : -(((dow + 1) % 7) || 7);  // 지난 토 (음수)
  const nSat  = dow === 6 ? 7 : (6 - dow);                 // 다음 토 (양수)
  const pSun  = -dow;                                        // 지난/이번 일 (0=오늘이 일)
  const nSun  = dow === 0 ? 7 : (7 - dow);                 // 다음 일
  const pFri  = -(((dow - 5 + 7) % 7) || 7);               // 지난 금
  const nFri  = (5 - dow + 7) % 7 || 7;                    // 다음 금
  const nMon  = (1 - dow + 7) % 7 || 7;                    // 다음 월
  return {
    pSat, nSat, pSun, nSun, pFri, nFri, nMon,
    pSat2: pSat - 7,  // 2주 전 토
    nSat2: nSat + 7,  // 2주 후 토
    nSun2: nSun + 7,  // 2주 후 일
    nFri2: nFri + 7,  // 2주 후 금
    nMon2: nMon + 7,  // 2주 후 월
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
      CHECKIN_INQUIRY: { label: '체크인 예정시간 문의중' },
      OPTIMIZING:      { label: '최적화중' },
      OPTIMIZED:       { label: '최적화완료' },
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
// 패턴: 주말(금~일) 체크인 집중, 미래 예약이 Gantt에 파란 윤곽선으로 보임

export const PROPERTIES = [

  // ══════════════════════════════════════════════════════════════════════
  //  OCCUPIED — 체류중 (7개)
  // ══════════════════════════════════════════════════════════════════════

  // P001: 금→월 (2박) — 정상
  {
    id: 'P001', name: '서래마을 A호', district: '서초구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED', start: o(-5, 13),          end: o(_d.pFri - 1, 14) },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',        start: o(_d.pFri - 1, 14), end: o(_d.pFri, 15)     },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',         start: o(_d.pFri, 15),     end: o(_d.pFri, 16)     },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',    start: o(_d.pFri, 16),     end: null               },
    ],
    reservation: { guestName: '김민준', platform: 'Airbnb',
      checkIn: o(_d.pFri, 16), checkOut: o(_d.nMon, 11) },
    sensors: { temp: 23.8, humidity: 56, noise: 32, power: 680, co2: 640 },
  },

  // P002: 토→월 (2박) — 정상
  {
    id: 'P002', name: '반포 B호', district: '서초구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 10),         end: o(-4, 12.5)         },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-4, 12.5),        end: o(_d.pSat - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pSat - 1, 13), end: o(_d.pSat, 13.5)    },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',            start: o(_d.pSat, 13.5),   end: o(_d.pSat, 14)      },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),     end: null                },
    ],
    reservation: { guestName: '박지수', platform: 'Airbnb',
      checkIn: o(_d.pSat, 14), checkOut: o(_d.nMon, 11) },
    sensors: { temp: 24.5, humidity: 53, noise: 38, power: 760, co2: 710 },
  },

  // P003: 장기 비즈니스 체류 (수→다음주 금) — 미래 바 길게 표시
  {
    id: 'P003', name: '청담 C호', district: '강남구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-7, 11),  end: o(-7, 13)   },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-7, 13),  end: o(-5, 14)   },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(-5, 14),  end: o(-4, 15)   },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',            start: o(-4, 15),  end: o(-4, 16)   },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(-4, 16),  end: null        },
    ],
    reservation: { guestName: '이주영 (비즈니스)', platform: 'Airbnb',
      checkIn: o(-4, 16), checkOut: o(_d.nFri, 11) },
    sensors: { temp: 23.3, humidity: 55, noise: 28, power: 550, co2: 620 },
  },

  // P004: 금→다음주 일 (9박 — 장기 가족여행) — 미래 바 매우 길게 표시
  {
    id: 'P004', name: '방배 D호', district: '서초구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION' },
    timeline: [
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-8, 10),          end: o(-8, 12.5)         },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-8, 12.5),        end: o(_d.pFri - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pFri - 1, 13), end: o(_d.pFri, 15.5)    },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',            start: o(_d.pFri, 15.5),   end: o(_d.pFri, 17)      },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pFri, 17),     end: null                },
    ],
    reservation: { guestName: '최준서 가족', platform: 'Airbnb',
      checkIn: o(_d.pFri, 17), checkOut: o(_d.nSun, 11) },
    sensors: { temp: 25.2, humidity: 50, noise: 44, power: 1150, co2: 750 },
  },

  // P005: 토→화 (3박) — 에너지낭비 감지
  {
    id: 'P005', name: '논현 E호', district: '강남구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ENERGY_WASTE' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-5, 13),         end: o(_d.pSat - 1, 13) },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pSat - 1, 13),end: o(_d.pSat, 13)     },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',            start: o(_d.pSat, 13),    end: o(_d.pSat, 14)     },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14),    end: o(0, 4)            },
      { mainStatus: 'OCCUPIED',      subStatus: 'ENERGY_WASTE',         start: o(0, 4),           end: null               },
    ],
    reservation: { guestName: '정수아', platform: '야놀자',
      checkIn: o(_d.pSat, 14), checkOut: o(2, 11) },
    sensors: { temp: 27.4, humidity: 42, noise: 45, power: 3240, co2: 780 },
  },

  // P006: 금→월 — 새벽 소음 민원
  {
    id: 'P006', name: '신사 F호', district: '강남구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_COMPLAINT' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED', start: o(-6, 14),         end: o(_d.pFri - 1, 13)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',        start: o(_d.pFri - 1, 13),end: o(_d.pFri, 15)      },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',         start: o(_d.pFri, 15),    end: o(_d.pFri, 16)      },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',    start: o(_d.pFri, 16),    end: o(_d.pSat, 2.5)     },
      { mainStatus: 'OCCUPIED',      subStatus: 'ISSUE_COMPLAINT',   start: o(_d.pSat, 2.5),   end: null                },
    ],
    reservation: { guestName: '한서진', platform: '야놀자',
      checkIn: o(_d.pFri, 16), checkOut: o(_d.nMon, 11) },
    sensors: { temp: 23.5, humidity: 62, noise: 78, power: 980, co2: 850 },
  },

  // P007: 목→월 — 민원+에너지낭비 복합
  {
    id: 'P007', name: '역삼 G호', district: '강남구',
    currentState: { mainStatus: 'OCCUPIED', subStatus: 'ISSUE_AND_ENERGY' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED', start: o(-8, 14),      end: o(-4, 13)        },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',        start: o(-4, 13),      end: o(-3, 14.5)      },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',    start: o(-3, 14.5),    end: o(_d.pSat, 21)   },
      { mainStatus: 'OCCUPIED',      subStatus: 'ENERGY_WASTE',      start: o(_d.pSat, 21), end: o(0, 1.5)        },
      { mainStatus: 'OCCUPIED',      subStatus: 'ISSUE_AND_ENERGY',  start: o(0, 1.5),      end: null             },
    ],
    reservation: { guestName: '윤태민', platform: 'Airbnb',
      checkIn: o(-3, 14.5), checkOut: o(_d.nMon, 11) },
    sensors: { temp: 28.1, humidity: 38, noise: 83, power: 3450, co2: 1150 },
  },

  // ══════════════════════════════════════════════════════════════════════
  //  PRE_STAY_READY — 입실전 (4개) — 내일/모레 체크인
  // ══════════════════════════════════════════════════════════════════════

  // P008: 체크인 당일 11시부터 입실전 시작 (buildFutureSegments가 생성)
  {
    id: 'P008', name: '압구정 H호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(-11, 15), end: o(-5, 11)  },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING',     start: o(-5, 11),  end: o(-5, 12)  },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 12),  end: o(-5, 14)  },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-5, 14),  end: null       },
    ],
    reservation: { guestName: '송유나', platform: 'Airbnb',
      checkIn: o(_d.nMon, 15), checkOut: o(_d.nMon + 2, 11) },
    sensors: null,
  },

  // P009: 체크인 당일 11시부터 입실전 시작
  {
    id: 'P009', name: '대치 I호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 10), end: o(-4, 12) },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-4, 12), end: null      },
    ],
    reservation: { guestName: '임지혁', platform: '에어클라우드',
      checkIn: o(_d.nMon, 16), checkOut: o(_d.nFri, 11) },
    sensors: null,
  },

  // P010: 이틀 뒤 체크인 (48h 윈도우 안에서 입실전 구간 표시됨)
  {
    id: 'P010', name: '삼성 J호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(-8, 15),      end: o(_d.pSat, 11)  },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING',     start: o(_d.pSat, 11), end: o(_d.pSat, 12)  },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(_d.pSat, 12), end: o(_d.pSat, 14)  },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(_d.pSat, 14), end: null            },
    ],
    reservation: { guestName: '강다솜 가족', platform: 'Airbnb',
      checkIn: o(2, 16), checkOut: o(_d.nSun, 11) },
    sensors: null,
  },

  // P011: 이틀 뒤 체크인 (48h 윈도우 안에서 입실전 구간 표시됨)
  {
    id: 'P011', name: '도곡 K호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-5, 13), end: null },
    ],
    reservation: { guestName: '조민서', platform: '야놀자',
      checkIn: o(2, 15), checkOut: o(4, 11) },
    sensors: null,
  },

  // ══════════════════════════════════════════════════════════════════════
  //  CLEANING — 청소중 (3개) — 오늘 아침 체크아웃, 다음 주말 예약 대기
  // ══════════════════════════════════════════════════════════════════════

  // P012: 토→일 1박, 청소 대기 중. 다음 토 예약 있음
  {
    id: 'P012', name: '개포 L호', district: '강남구',
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-3, 13),      end: o(_d.pSat, 13.5)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pSat, 13.5),end: o(_d.pSat, 14)   },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14), end: o(0, 11)          },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING',     start: o(0, 11),       end: null              },
    ],
    reservation: { guestName: '박지호', platform: 'Airbnb',
      checkIn: o(_d.nSat, 15), checkOut: o(_d.nSun, 11) },
    sensors: null,
  },

  // P013: 금→일 2박, 청소 진행 중. 다음 금 예약
  {
    id: 'P013', name: '수서 M호', district: '강남구',
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
    timeline: [
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 11),     end: o(-5, 13)       },
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-5, 13),     end: o(_d.pFri, 15)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pFri, 15),end: o(_d.pFri, 16)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZED',            start: o(_d.pFri, 16),end: o(_d.pFri, 17)  },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pFri, 17),end: o(0, 11)        },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING',     start: o(0, 11),      end: o(0, 11.5)      },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(0, 11.5),    end: null            },
    ],
    reservation: { guestName: '최유리', platform: 'Airbnb',
      checkIn: o(_d.nFri, 16), checkOut: o(_d.nSun, 11) },
    sensors: null,
  },

  // P014: 토→일 1박, 이슈 있던 숙소. 다음 토 예약
  {
    id: 'P014', name: '자곡 N호', district: '강남구',
    currentState: { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS' },
    timeline: [
      { mainStatus: 'VACANT',        subStatus: 'CLEANING_FINISHED',    start: o(-4, 14),      end: o(_d.pSat, 13.5)  },
      { mainStatus: 'PRE_STAY_READY',subStatus: 'OPTIMIZING',           start: o(_d.pSat, 13.5),end: o(_d.pSat, 14)   },
      { mainStatus: 'OCCUPIED',      subStatus: 'GOOD_CONDITION',       start: o(_d.pSat, 14), end: o(_d.pSat, 23)    },
      { mainStatus: 'OCCUPIED',      subStatus: 'ISSUE_COMPLAINT',      start: o(_d.pSat, 23), end: o(0, 11)          },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_PENDING',     start: o(0, 11),       end: o(0, 12)          },
      { mainStatus: 'CLEANING',      subStatus: 'CLEANING_IN_PROGRESS', start: o(0, 12),       end: null              },
    ],
    reservation: { guestName: '김태양', platform: '야놀자',
      checkIn: o(_d.nSat, 14), checkOut: o(_d.nSun, 11) },
    sensors: null,
  },

  // ══════════════════════════════════════════════════════════════════════
  //  VACANT — 공실 (6개) — 미래 주말 예약이 파란 윤곽선으로 표시됨
  // ══════════════════════════════════════════════════════════════════════

  // P015: 다음 토→월 예약 (Sat Jul 11 → Mon Jul 13)
  {
    id: 'P015', name: '세곡 O호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15), end: o(-5, 11)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-5, 11), end: o(-5, 13.5) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-5, 13.5), end: null      },
    ],
    reservation: { guestName: '이서연', platform: 'Airbnb',
      checkIn: o(_d.nSat, 15), checkOut: o(_d.nMon2, 11) },
    sensors: null,
  },

  // P016: 이번 주 금→월 예약 (Fri Jul 10 → Mon Jul 13) — 연휴형 3박
  {
    id: 'P016', name: '일원 P호', district: '강남구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-5, 14), end: o(-3, 11) },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 11), end: o(-3, 13) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 13), end: null      },
    ],
    reservation: { guestName: '정하늘', platform: 'Airbnb',
      checkIn: o(_d.nFri, 18), checkOut: o(_d.nMon2, 11) },
    sensors: null,
  },

  // P017: 다다음 주말 토→일 예약 (Sat Jul 18 → Mon Jul 20)
  {
    id: 'P017', name: '문정 Q호', district: '송파구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15), end: o(-3, 11)  },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 11), end: o(-3, 13)  },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 13), end: null       },
    ],
    reservation: { guestName: '윤혜진', platform: 'Airbnb',
      checkIn: o(_d.nSat2, 15), checkOut: o(_d.nSat2 + 2, 11) },
    sensors: null,
  },

  // P018: 정비 후 청소완료. 다음 토 예약 (Sat Jul 11 → Tue Jul 14)
  {
    id: 'P018', name: '잠실 R호', district: '송파구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-6, 14), end: o(-4, 10)  },
      { mainStatus: 'VACANT',   subStatus: 'MAINTENANCE',          start: o(-4, 10), end: o(-2, 16)  },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-2, 16), end: o(-2, 18)  },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-2, 18), end: null       },
    ],
    reservation: { guestName: '강지민', platform: '에어클라우드',
      checkIn: o(_d.nSat, 14), checkOut: o(_d.nSat + 3, 11) },
    sensors: null,
  },

  // P019: 이번 주 금→일 예약 (Fri Jul 10 → Sun Jul 12)
  {
    id: 'P019', name: '신천 S호', district: '송파구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15),  end: o(-3, 11)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_PENDING',     start: o(-3, 11),  end: o(-3, 12)   },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-3, 12),  end: o(-3, 14.5) },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-3, 14.5),end: null        },
    ],
    reservation: { guestName: '배수현', platform: 'Airbnb',
      checkIn: o(_d.nFri, 19), checkOut: o(_d.nSun, 11) },
    sensors: null,
  },

  // P020: 2주 후 금→월 예약 (Fri Jul 17 → Mon Jul 20)
  {
    id: 'P020', name: '풍납 T호', district: '송파구',
    currentState: { mainStatus: 'VACANT', subStatus: 'CLEANING_FINISHED' },
    timeline: [
      { mainStatus: 'OCCUPIED', subStatus: 'GOOD_CONDITION',       start: o(-8, 15), end: o(-4, 11)  },
      { mainStatus: 'CLEANING', subStatus: 'CLEANING_IN_PROGRESS', start: o(-4, 11), end: o(-4, 13)  },
      { mainStatus: 'VACANT',   subStatus: 'CLEANING_FINISHED',    start: o(-4, 13), end: null       },
    ],
    reservation: { guestName: '임도현', platform: '야놀자',
      checkIn: o(_d.nFri2, 18), checkOut: o(_d.nFri2 + 3, 11) },
    sensors: null,
  },
];

// ── Detail View 서브 상태별 색상 ──────────────────────────────────────────────
export const SEGMENT_COLORS = {
  'VACANT/CLEANING_FINISHED':      '#c0cdd4',
  'VACANT/MAINTENANCE':            '#a8b8c4',
  'PRE_STAY_READY/CHECKIN_INQUIRY': '#a0d4c4',
  'PRE_STAY_READY/OPTIMIZING':     '#7ac4ad',
  'PRE_STAY_READY/OPTIMIZED':      '#48a88a',
  'OCCUPIED/GOOD_CONDITION':       '#6898d0',
  'OCCUPIED/ENERGY_WASTE':         '#d4a844',
  'OCCUPIED/ISSUE_COMPLAINT':      '#d07848',
  'OCCUPIED/ISSUE_AND_ENERGY':     '#b85868',
  'CLEANING/CLEANING_PENDING':     '#e0a8ac',
  'CLEANING/CLEANING_IN_PROGRESS': '#c86870',
};

// ── 미래 상태 예측 세그먼트 생성 (예약 데이터 기반) ───────────────────────────

// 커서 이후의 예약들을 순서대로 순환시켜 세그먼트를 생성.
// property.reservations 배열이 있으면 다중 예약 처리, 없으면 firstRes 단일 예약만.
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
    // 스펙: 체크인 1시간 전 PRE_STAY_READY 시작
    const prepAt = new Date(Math.max(cursor.getTime(), ci.getTime() - 3600000));
    const optEnd = new Date(ci.getTime() - 0.5 * 3600000); // 체크인 30분 전 → OPTIMIZED
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
        // 스펙: 체크인 1시간 전 PRE_STAY_READY 시작 (청소 끝나는 시각이 더 늦으면 청소 우선)
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
        // property.reservations 배열에서 미래 예약 찾기 (실데이터용)
        cursor = addResCycles(push, property, null, cursor, windowEnd);
        push('VACANT', currentSeg.subStatus, cursor, windowEnd);
        break;
      }
      // 스펙: 체크인 1시간 전 PRE_STAY_READY 시작
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
