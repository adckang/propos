/**
 * OccupancyMonitor — 체류중 상태 감시 엔진 (Layer 3 통합)
 * 상태 머신 문서: docs/room-state-machine.md 섹션 8·9
 * 이벤트 감지 설계: docs/event-detection-design.md
 *
 * 설계 원칙:
 * - process()를 30초마다 호출하면 events[] 반환
 * - Layer 1 SensorEventGenerator → Layer 2 SuspicionTracker → Layer 3 통합
 * - getNextRoomState() / isValidTransition() 은 호출자(occupancyWatcher)가 담당
 * - 순수 타이머 기반: Date.now() 주입 → 테스트 가능
 *
 * 임계값 수정: src/config/monitoringThresholds.js
 */

import { THRESHOLDS as CFG } from '../config/monitoringThresholds.js';
import { SensorEventGenerator } from './sensorEventGenerator.js';
import { SuspicionTracker }     from './suspicionTracker.js';

const MIN = 60_000;

// config → ms 단위로 변환
const T = {
  SUMMER_OUT: CFG.SUMMER_OUT,
  WINTER_OUT: CFG.WINTER_OUT,
  SUM_TEMP_MAX: CFG.SUM_TEMP_MAX,
  SUM_TEMP_MIN: CFG.SUM_TEMP_MIN,
  SUM_HUM_MAX:  CFG.SUM_HUM_MAX,
  WIN_TEMP_MIN: CFG.WIN_TEMP_MIN,
  WIN_TEMP_MAX: CFG.WIN_TEMP_MAX,
  WIN_HUM_MIN:  CFG.WIN_HUM_MIN,
  AC_ON:        CFG.AC_ON,
  AC_HIGH:      CFG.AC_HIGH,
  ENERGY_DETECT:   CFG.ENERGY_DETECT_MIN  * MIN,
  ENERGY_RESOLVE:  CFG.ENERGY_RESOLVE_MIN * MIN,
  NO_MOTION_AWAY:  CFG.NO_MOTION_AWAY_MIN * MIN,
  DOOR_OPEN:       CFG.DOOR_OPEN_MIN      * MIN,
  CHECKOUT_GRACE:  CFG.CHECKOUT_GRACE_MIN * MIN,
  FALLBACK_TEMP_DIFF_SUMMER: CFG.FALLBACK_SUMMER_DIFF,
  FALLBACK_TEMP_DIFF_WINTER: CFG.FALLBACK_WINTER_DIFF,
};

// SensorEventGenerator 설정 (ms)
const SENSOR_CFG = {
  EXIT_LOOKBACK_MS:   CFG.EXIT_LOOKBACK_MIN   * MIN,
  EXIT_NO_MOTION_MS:  CFG.EXIT_NO_MOTION_MIN  * MIN,
  ENTRY_SUSTAINED_MS: CFG.ENTRY_SUSTAINED_MIN * MIN,
};

// SuspicionTracker 설정 (ms)
const SUSPICION_CFG = {
  CHECKOUT_GRACE_MS:         CFG.CHECKOUT_GRACE_MIN         * MIN,
  EARLY_CHECKOUT_QUIET_MS:   CFG.EARLY_CHECKOUT_QUIET_MIN   * MIN,
  SUSPICION_EXPIRE_MS:       CFG.SUSPICION_EXPIRE_MIN       * MIN,
  CLEANING_SUSTAINED_MS:     CFG.CLEANING_SUSTAINED_MIN     * MIN,
  CLEANING_DONE_QUIET_MS:    CFG.CLEANING_DONE_QUIET_MIN    * MIN,
  NO_SHOW_WINDOW_MS:         CFG.NO_SHOW_WINDOW_MIN         * MIN,
  NOISE_QUIET_DB:            CFG.NOISE_QUIET_DB,
  AC_ON:                     CFG.AC_ON,
};

// ── 유틸 ────────────────────────────────────────────────────────────────────
function season(outdoorTemp) {
  if (outdoorTemp === null) return 'unknown';
  if (outdoorTemp >= T.SUMMER_OUT) return 'summer';
  if (outdoorTemp <= T.WINTER_OUT) return 'winter';
  return 'transition';
}

function indoorTemp(snap) {
  // AC 내장 센서 우선, 없으면 영역 센서 평균
  if (snap.acTemp !== null) return snap.acTemp;
  const temps = snap.indoorTemps ?? [];
  if (!temps.length) return null;
  return temps.reduce((s, r) => s + r.val, 0) / temps.length;
}

function indoorHum(snap) {
  if (snap.acHumidity !== null) return snap.acHumidity;
  const hums = snap.indoorHumidities ?? [];
  if (!hums.length) return null;
  return hums.reduce((s, r) => s + r.val, 0) / hums.length;
}

// start=0 도 유효한 타임스탬프이므로 != null 로 체크 (falsy 판별 금지)
function elapsed(start, now) { return start != null ? now - start : Infinity; }

// ── 환경 이슈 분류 헬퍼 (cognitive complexity 분산) ─────────────────────────
function summerReasons(iTemp, iHum) {
  const r = [];
  if (iTemp > T.SUM_TEMP_MAX)
    r.push(`여름 실내 ${iTemp.toFixed(1)}°C (기준 ${T.SUM_TEMP_MAX}°C 초과 — 너무 더움)`);
  if (iHum !== null && iHum > T.SUM_HUM_MAX)
    r.push(`여름 실내 습도 ${iHum}% (기준 ${T.SUM_HUM_MAX}% 초과 — 너무 습함)`);
  return r;
}

function winterReasons(iTemp, iHum) {
  const r = [];
  if (iTemp < T.WIN_TEMP_MIN)
    r.push(`겨울 실내 ${iTemp.toFixed(1)}°C (기준 ${T.WIN_TEMP_MIN}°C 미만 — 너무 추움)`);
  if (iHum !== null && iHum < T.WIN_HUM_MIN)
    r.push(`겨울 실내 습도 ${iHum}% (기준 ${T.WIN_HUM_MIN}% 미만 — 너무 건조)`);
  return r;
}

// ── 소음 가중치 (스펙 섹션 9) ────────────────────────────────────────────────
// CRITICAL(>85dB)×8 / HIGH(>75dB)×3 / WARN(>65dB)×1 / 이하 0
function noiseWeight(dB) {
  if (dB > 85) return 8;
  if (dB > 75) return 3;
  if (dB > 65) return 1;
  return 0;
}

// ── 에너지 낭비 분류 헬퍼 ───────────────────────────────────────────────────
function powerWasteReasons(snap, awayMs) {
  const r = [];
  if (snap.acPower > T.AC_ON && awayMs >= T.NO_MOTION_AWAY) {
    r.push(`외출 중 냉난방 가동 (${Math.round(awayMs / MIN)}분 재실 없음, 전력 ${snap.acPower}W 확인)`);
  }
  if (snap.acPower > T.AC_HIGH) {
    r.push(`고전력 냉난방 (${snap.acPower}W — 기준 ${T.AC_HIGH}W 초과)`);
  }
  return r;
}

function fallbackWasteReasons(snap, seas, iTemp) {
  if (iTemp === null || snap.outdoorTemp === null) return [];
  const diff = snap.outdoorTemp - iTemp;
  if (seas === 'summer' && iTemp < T.SUM_TEMP_MIN && diff > T.FALLBACK_TEMP_DIFF_SUMMER) {
    return [`⚠ 전력센서 없음 (추정) — 실외 ${snap.outdoorTemp}°C 대비 실내 ${iTemp.toFixed(1)}°C, 온도차 ${diff.toFixed(1)}°C → 과냉방 추정`];
  }
  if (seas === 'winter' && iTemp > T.WIN_TEMP_MAX && -diff > T.FALLBACK_TEMP_DIFF_WINTER) {
    return [`⚠ 전력센서 없음 (추정) — 실외 ${snap.outdoorTemp}°C 대비 실내 ${iTemp.toFixed(1)}°C, 온도차 ${(-diff).toFixed(1)}°C → 과난방 추정`];
  }
  return [];
}

// ── 메인 클래스 ─────────────────────────────────────────────────────────────
export class OccupancyMonitor {
  // 기존 추적 상태 (에너지·환경·소음 감지에 사용)
  energyWasteStart  = null;
  energyNormalStart = null;
  envIssueStart     = null;
  envNormalStart    = null;
  doorOpenStart          = null;
  doorOpenedAt           = null;  // 문 마지막으로 닫힌 시각 (장시간 열림 감지에 유지)
  doorOpenComplaintActive = false; // door_open complaint_detected 발화됨 → resolved 발화 조건 추적
  noMotionStart          = null;
  lastSmoke         = false;
  noiseWindow       = [];    // [{ dB, timestamp }] — 10분 슬라이딩 윈도우
  noiseSilentStart  = null;  // 소음 score 0 유지 시작 시각

  // Layer 1/2 — 새 아키텍처
  _sensorGen = new SensorEventGenerator();
  _suspicion = new SuspicionTracker();

  /**
   * @param {object} p
   * @param {object} p.snap           - 센서 스냅샷
   * @param {{ mainStatus, subStatus }} p.roomState
   * @param {object|null} p.reservation - { checkIn?: Date, checkOut?: Date }
   * @param {number} p.now            - Date.now()
   * @returns {{ type, subType?, severity?, reason, timestamp }[]}
   */
  process({ snap, roomState, reservation, now }) {
    // 모션·도어는 상태와 무관하게 항상 추적 (에너지낭비·문열림 감지용)
    this._trackMotion(snap.motionDetected, now);
    this._trackDoor(snap.doorOpen, now);

    const main = roomState?.mainStatus;
    const sub  = roomState?.subStatus;

    // Layer 1: EXIT/ENTRY 시맨틱 이벤트 감지
    const sensorResult = this._sensorGen.update(snap, now, SENSOR_CFG);

    // Layer 2: 의심 → 확신 (체크인/아웃, 청소 시작/완료)
    const occupancyEvents = this._suspicion.evaluate({
      sensorResult,
      roomState,
      reservation,
      motionNow:  !!snap.motionDetected,
      acPower:    snap.acPower    ?? null,
      noiseLevel: snap.noiseLevel ?? null,
      now,
      cfg: SUSPICION_CFG,
    });

    // PRE_STAY_READY/OPTIMIZED: 체크인 감지만
    if (main === 'PRE_STAY_READY' && sub === 'OPTIMIZED') {
      return occupancyEvents; // check_in_detected or []
    }

    // CLEANING: 청소 시작/완료 감지만
    if (main === 'CLEANING') {
      return occupancyEvents; // cleaning_started, cleaning_finished or []
    }

    // OCCUPIED: 체크아웃(새 로직) + 기존 이벤트 통합
    if (main === 'OCCUPIED') {
      const seas  = season(snap.outdoorTemp);
      const iTemp = indoorTemp(snap);
      const iHum  = indoorHum(snap);

      return [
        ...occupancyEvents,   // check_out_detected (먼저 배치 — 우선 상태 전환)
        ...this._smoke(snap, sub, now),
        ...this._noise(snap, sub, now),
        ...this._environment(seas, iTemp, iHum, sub, now),
        ...this._energyWaste(snap, sub, seas, iTemp, now),
        ...this._doorOpen(sub, now),
      ];
    }

    return [];
  }

  // ── 1. 연기 감지 ─────────────────────────────────────────────────────────
  _smoke(snap, sub, now) {
    const on = snap.smokeDetected;
    const was = this.lastSmoke;
    this.lastSmoke = on;

    if (on && !was) {
      return [{ type: 'complaint_detected', subType: 'smoke', severity: 'CRITICAL',
        reason: '연기 감지기 작동 — 화재 또는 연기 발생', timestamp: now }];
    }
    if (!on && was && (sub === 'ISSUE_COMPLAINT' || sub === 'ISSUE_AND_ENERGY')) {
      return [{ type: 'complaint_resolved', subType: 'smoke',
        reason: '연기 감지 해제', timestamp: now }];
    }
    return [];
  }

  // ── 2. 소음 민원 (슬라이딩 윈도우 10분, 가중치 점수) ──────────────────────
  _noise(snap, sub, now) {
    if (snap.noiseLevel === null || snap.noiseLevel === undefined) return [];

    const WINDOW_MS     = 10 * MIN;
    const SCORE_TRIGGER = 8;
    const hasComplaint  = sub === 'ISSUE_COMPLAINT' || sub === 'ISSUE_AND_ENERGY';

    // 슬라이딩 윈도우 갱신: 현재 측정값 추가 후 10분 초과 항목 제거
    this.noiseWindow.push({ dB: snap.noiseLevel, timestamp: now });
    this.noiseWindow = this.noiseWindow.filter(e => now - e.timestamp < WINDOW_MS);

    const score = this.noiseWindow.reduce((s, e) => s + noiseWeight(e.dB), 0);

    if (score >= SCORE_TRIGGER) {
      this.noiseSilentStart = null;
      if (!hasComplaint) {
        const maxDB    = Math.max(...this.noiseWindow.map(e => e.dB));
        const severity = maxDB > 85 ? 'CRITICAL' : maxDB > 75 ? 'HIGH' : 'WARN';
        return [{ type: 'complaint_detected', subType: 'noise', severity,
          reason: `소음 민원 — ${Math.round(maxDB)}dB (10분 누적 점수 ${score})`,
          timestamp: now }];
      }
    } else {
      if (score === 0) {
        if (this.noiseSilentStart === null) this.noiseSilentStart = now;
        if (hasComplaint && elapsed(this.noiseSilentStart, now) >= WINDOW_MS) {
          return [{ type: 'complaint_resolved', subType: 'noise',
            reason: '소음 10분간 정상 범위(65dB 미만) 유지', timestamp: now }];
        }
      } else {
        // score > 0 이지만 임계값 미달 — 침묵 타이머 리셋
        this.noiseSilentStart = null;
      }
    }
    return [];
  }

  // ── 4. 실내 환경 (온습도 적정범위) ────────────────────────────────────────
  _environment(seas, iTemp, iHum, sub, now) {
    if (iTemp === null || seas === 'unknown') return [];

    let reasons = [];
    if (seas === 'summer')      reasons = summerReasons(iTemp, iHum);
    else if (seas === 'winter') reasons = winterReasons(iTemp, iHum);

    const isIssue     = reasons.length > 0;
    const hasComplaint = sub === 'ISSUE_COMPLAINT' || sub === 'ISSUE_AND_ENERGY';

    if (isIssue) {
      if (this.envIssueStart === null) this.envIssueStart = now;
      this.envNormalStart = null;
      if (!hasComplaint && elapsed(this.envIssueStart, now) >= T.ENERGY_DETECT) {
        return [{ type: 'complaint_detected', subType: 'environment', severity: 'HIGH',
          reason: reasons.join(' / '), timestamp: now }];
      }
    } else {
      this.envIssueStart = null;
      if (this.envNormalStart === null) this.envNormalStart = now;
      if (hasComplaint && elapsed(this.envNormalStart, now) >= T.ENERGY_RESOLVE) {
        return [{ type: 'complaint_resolved', subType: 'environment',
          reason: '실내 온습도 정상 범위 복귀', timestamp: now }];
      }
    }
    return [];
  }

  // ── 5. 에너지 낭비 ────────────────────────────────────────────────────────
  _energyWaste(snap, sub, seas, iTemp, now) {
    // noMotionStart=null 은 "모션 있음"을 의미 → 0ms 로 처리
    const awayMs  = this.noMotionStart !== null ? elapsed(this.noMotionStart, now) : 0;
    const reasons = snap.acPower !== null
      ? powerWasteReasons(snap, awayMs)
      : fallbackWasteReasons(snap, seas, iTemp);

    const isWaste  = reasons.length > 0;
    const hasWaste = sub === 'ENERGY_WASTE' || sub === 'ISSUE_AND_ENERGY';

    this._tickWasteTimers(isWaste, now);

    if (isWaste && !hasWaste && elapsed(this.energyWasteStart, now) >= T.ENERGY_DETECT) {
      return [{ type: 'energy_waste_detected', reason: reasons.join(' / '), timestamp: now }];
    }
    if (!isWaste && hasWaste && elapsed(this.energyNormalStart, now) >= T.ENERGY_RESOLVE) {
      return [{ type: 'energy_waste_resolved', reason: '에너지 낭비 조건 해소', timestamp: now }];
    }
    return [];
  }

  _tickWasteTimers(isWaste, now) {
    if (isWaste) {
      if (this.energyWasteStart === null) this.energyWasteStart = now;
      this.energyNormalStart = null;
    } else {
      this.energyWasteStart = null;
      if (this.energyNormalStart === null) this.energyNormalStart = now;
    }
  }

  // ── 6. 장시간 문열림 ─────────────────────────────────────────────────────
  _doorOpen(sub, now) {
    const open = elapsed(this.doorOpenStart, now);
    const hasComplaint = sub === 'ISSUE_COMPLAINT' || sub === 'ISSUE_AND_ENERGY';

    if (!hasComplaint && this.doorOpenStart !== null && open >= T.DOOR_OPEN) {
      this.doorOpenComplaintActive = true;
      const min = Math.round(open / MIN);
      return [{ type: 'complaint_detected', subType: 'door_open', severity: 'WARN',
        reason: `현관문 ${min}분 이상 열림`, timestamp: now }];
    }
    // door_open으로 complaint가 발생했고, 문이 닫혔으며, 민원 상태가 유지 중 → 해소
    if (this.doorOpenComplaintActive && hasComplaint && this.doorOpenStart === null) {
      this.doorOpenComplaintActive = false;
      return [{ type: 'complaint_resolved', subType: 'door_open',
        reason: '현관문 닫힘', timestamp: now }];
    }
    return [];
  }

  // ── 내부 트래킹 ──────────────────────────────────────────────────────────
  _trackMotion(detected, now) {
    if (detected) { this.noMotionStart = null; }
    else if (this.noMotionStart === null) { this.noMotionStart = now; }
  }

  _trackDoor(open, now) {
    if (open) {
      if (this.doorOpenStart === null) this.doorOpenStart = now;
    } else {
      if (this.doorOpenStart !== null) this.doorOpenedAt = now; // 닫힌 시각 기록
      this.doorOpenStart = null;
    }
  }
}
