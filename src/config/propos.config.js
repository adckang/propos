'use strict';

// ============================================================
// propos.config.js — PROPOS 전체 설정 중앙 관리
//
// 이 파일 하나만 수정하면 모든 UC에 반영됩니다.
// dist/index.html 배포 시: 파일 상단의 PROPOS_CONFIG 블록을
// 이 파일 내용과 동기화하세요.
// ============================================================

const PROPOS_CONFIG = {

  // ── Home Assistant 연결 설정 ──────────────────────────────
  // HA Long-Lived Access Token: HA → 프로필 → 장기 액세스 토큰
  ha: {
    baseUrl : 'http://192.168.45.76:8123',
    wsUrl   : 'ws://192.168.45.76:8123/api/websocket',
    token   : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyZThiNWNlY2U0MmU0ZjQ1ODc5ZjE1NDc4NTJkNjgyZCIsImlhdCI6MTc3NDk3MjM2OSwiZXhwIjoyMDkwMzMyMzY5fQ.fGrvj0ah1GenARULOtYrplDzlvgPl-injAB5Yqh2Zlw',
  },

  // ── HA Entity ID 매핑 ─────────────────────────────────────
  // HA → 개발자 도구 → 상태 탭에서 entity_id 확인
  entities: {
    // [UC-001] 체크인 씬 — TV방 실제 연동 기기
    tvLight : 'light.rgbcct_8002',
    tvPlug  : 'switch.tv_smart_plug_socket_1',

    // [UC-003] 센서 모니터링 — 실제 연동된 센서
    tempSensor     : 'sensor.temperature_humidity_sensor_temperature',
    humiditySensor : 'sensor.temperature_humidity_sensor_humidity',
    // 아래 두 센서는 현재 미연동 (하드웨어 없음)
    // 센서 추가 시 entity_id 입력하고 haClient.js의 getSensorStates도 수정
    noiseSensor    : null,  // 예: 'sensor.noise_level_p042'
    powerSensor    : null,  // 예: 'sensor.power_monitor_p042'
  },

  // ── 센서 이상 감지 임계값 ─────────────────────────────────
  // 이 값을 초과하면 경고(warn) / 긴급(critical) 알림 발생
  sensorThresholds: {
    temp:     { warn: 30, critical: 35 },   // 섭씨 °C
    humidity: { warn: 80, critical: 90 },   // 상대습도 %
    noise:    { warn: 60, critical: 75 },   // 데시벨 dB (센서 없으면 Mock에서만 사용)
    power:    { warn: 3000, critical: 5000 }, // 전력 W (센서 없으면 Mock에서만 사용)
  },

  // ── 기본 숙소 설정 ────────────────────────────────────────
  // UI 설정 탭에서 변경 가능 (localStorage 'propos_prop_configs'에 저장됨)
  // icalUrl: Airbnb 숙소 관리 → 예약 캘린더 → iCal 내보내기 URL 붙여넣기
  defaultProps: [
    {
      propId      : 'P-042',
      propName    : '해운대 오션뷰 펜트하우스',
      icalUrl     : '',          // Airbnb iCal URL 입력 시 실제 예약 데이터 사용
      checkInTime : '15:00:00',
      checkOutTime: '11:00:00',
      wifi: { ssid: 'ProposGuest_5G', pw: '1234567890' },
    },
    {
      propId      : 'P-007',
      propName    : '강남 럭셔리 스위트',
      icalUrl     : '',
      checkInTime : '14:00:00',
      checkOutTime: '11:00:00',
      wifi: { ssid: 'ProposGuest_7', pw: 'abcde12345' },
    },
    {
      propId      : 'P-015',
      propName    : '제주 한옥 스테이',
      icalUrl     : '',
      checkInTime : '16:00:00',
      checkOutTime: '11:00:00',
      wifi: { ssid: 'JejuGuest_2G', pw: 'jeju5678' },
    },
    {
      propId      : 'P-031',
      propName    : '마포 모던 스튜디오',
      icalUrl     : '',
      checkInTime : '15:00:00',
      checkOutTime: '11:00:00',
      wifi: { ssid: 'ProposGuest_3G', pw: 'mapo9999' },
    },
  ],

  // ── 폴링 설정 ─────────────────────────────────────────────
  polling: {
    sensorIntervalSec: 30,  // [UC-003] 센서 폴링 주기 (초)
  },
};

module.exports = PROPOS_CONFIG;
