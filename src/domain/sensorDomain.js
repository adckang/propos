/**
 * sensorDomain — 센서 이상 감지 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 기본 임계값 반환
 * @returns {Thresholds}
 */
export function getDefaultThresholds() {
  return {
    temp:     { warn: 30, critical: 35 },
    humidity: { warn: 80, critical: 90 },
    noise:    { warn: 60, critical: 75 },
    power:    { warn: 3000, critical: 5000 },
  };
}

/**
 * 센서 읽기가 임계값을 초과했는지 판별
 * @param {{ temp?, humidity?, noise?, power? }} reading
 * @param {Thresholds} thresholds
 * @returns {{ isAnomaly: boolean, severity: "warn"|"critical"|null, sensors: string[] }}
 */
export function isAnomaly(reading, thresholds) {
  if (!reading)    throw new Error('reading is required');
  if (!thresholds) throw new Error('thresholds is required');

  const SENSORS = ['temp', 'humidity', 'noise', 'power'];
  let highestSeverity = null;
  const anomalySensors = [];

  for (const key of SENSORS) {
    const val = reading[key];
    if (val == null) continue;

    const t = thresholds[key];
    if (!t) continue;

    if (val > t.critical) {
      anomalySensors.push(key);
      highestSeverity = 'critical';
    } else if (val > t.warn) {
      anomalySensors.push(key);
      if (highestSeverity !== 'critical') highestSeverity = 'warn';
    }
  }

  return {
    isAnomaly: anomalySensors.length > 0,
    severity:  highestSeverity,
    sensors:   anomalySensors,
  };
}

/**
 * 이상 감지 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {{ temp?, humidity?, noise?, power?, time? }} reading
 * @param {{ sensors: string[], severity: string }} anomaly
 * @returns {string}
 */
export function buildAnomalyAlert(propId, reading, anomaly) {
  if (!propId)  throw new Error('propId is required');
  if (!reading) throw new Error('reading is required');
  if (!anomaly) throw new Error('anomaly is required');
  if (!anomaly.sensors || anomaly.sensors.length === 0) throw new Error('anomaly.sensors must not be empty');

  const LABEL = { temp:'온도', humidity:'습도', noise:'소음', power:'전력' };
  const UNIT  = { temp:'°C',  humidity:'%',    noise:'dB',   power:'W'  };

  const lines = anomaly.sensors.map(key => {
    const val = reading[key];
    return `${LABEL[key] || key} ${val}${UNIT[key] || ''} 초과`;
  });

  const severity = anomaly.severity === 'critical' ? '[긴급]' : '[경고]';
  return `${severity} ${propId} — ${lines.join(', ')} — 확인 필요`;
}

export default { isAnomaly, buildAnomalyAlert, getDefaultThresholds };
