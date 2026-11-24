/**
 * RF-25 자동화 개선율 정책 해석.
 * 시간 값은 DB의 버전 있는 마스터/숙소 설정에서만 받으며 런타임 기본값을 두지 않는다.
 */

export const ANOMALY_TYPES = Object.freeze([
  'noise',
  'vacant_energy_waste',
  'guest_complaint_sensor',
  'cleaning_unassigned',
  'device_offline',
]);

const TYPE_SET = new Set(ANOMALY_TYPES);

function validMinutes(value) {
  return Number.isInteger(value) && value >= 0;
}

function requireVersion(policy, label) {
  if (!policy || typeof policy !== 'object') throw new Error(`${label} 설정이 없습니다`);
  if (!policy.versionId) throw new Error(`${label} 설정 버전이 없습니다`);
  if (!policy.effectiveFrom || !Number.isFinite(Date.parse(policy.effectiveFrom))) {
    throw new Error(`${label} 설정 적용 시각이 올바르지 않습니다`);
  }
  if (!policy.values || typeof policy.values !== 'object' || Array.isArray(policy.values)) {
    throw new Error(`${label} 설정값이 없습니다`);
  }
}

function validateMaster(master) {
  requireVersion(master, '마스터');
  for (const type of ANOMALY_TYPES) {
    if (!validMinutes(master.values[type])) throw new Error(`마스터 설정의 ${type} 값이 올바르지 않습니다`);
  }
}

function validateProperty(property) {
  if (property == null) return;
  requireVersion(property, '숙소');
  for (const [type, value] of Object.entries(property.values)) {
    if (!TYPE_SET.has(type) || !validMinutes(value)) throw new Error(`숙소 설정의 ${type} 값이 올바르지 않습니다`);
  }
}

export function resolveAnomalyPolicy({ type, master, property = null }) {
  if (!TYPE_SET.has(type)) throw new Error(`알 수 없는 이상 유형: ${type}`);
  validateMaster(master);
  validateProperty(property);

  const hasOverride = property != null && Object.hasOwn(property.values, type);
  return {
    type,
    stabilizationMinutes: hasOverride ? property.values[type] : master.values[type],
    masterPolicyVersionId: master.versionId,
    propertyPolicyVersionId: hasOverride ? property.versionId : null,
    policyEffectiveFrom: hasOverride ? property.effectiveFrom : master.effectiveFrom,
  };
}

export function formatAnomalyTimingCriterion({ detectionMinutes, stabilizationMinutes }) {
  if (!validMinutes(detectionMinutes)) throw new Error('발생 기준 시간이 올바르지 않습니다');
  if (!validMinutes(stabilizationMinutes)) throw new Error('해결 기준 시간이 올바르지 않습니다');
  const detected = `기준: ${detectionMinutes}분 이상`;
  return stabilizationMinutes === 0
    ? `${detected} · 해결 확인: 즉시`
    : `${detected} · 정상 ${stabilizationMinutes}분 유지 시 해결`;
}
