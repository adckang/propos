/** RF-25 안정화 시간 설정 — DB 버전은 추가만 하고 과거 버전은 고치지 않는다. */
import { ANOMALY_TYPES, resolveAnomalyPolicy } from '../src/domain/anomalyPolicyDomain.js';

function asIso(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 시각이 올바르지 않습니다`);
  return date.toISOString();
}

function validateValues(values, { complete, label }) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${label} 설정값이 없습니다`);
  const entries = Object.entries(values);
  for (const [type, value] of entries) {
    if (!ANOMALY_TYPES.includes(type)) throw new Error(`알 수 없는 이상 유형: ${type}`);
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      throw new Error(`${label} 설정의 ${type} 값이 올바르지 않습니다`);
    }
  }
  if (complete) {
    for (const type of ANOMALY_TYPES) {
      if (!Object.hasOwn(values, type)) throw new Error(`${label} 설정의 ${type} 값이 없습니다`);
    }
  }
  return Object.fromEntries(ANOMALY_TYPES.filter(type => Object.hasOwn(values, type)).map(type => [type, values[type]]));
}

function versionFromRows(rows) {
  if (!rows.length) return null;
  return {
    versionId: rows[0].version_id,
    effectiveFrom: new Date(rows[0].effective_from).toISOString(),
    values: Object.fromEntries(rows
      .filter(row => row.anomaly_type != null)
      .map(row => [row.anomaly_type, Number(row.stabilization_minutes)])),
  };
}

async function latestVersion(db, { scope, propertyId = null, at }) {
  const propertyWhere = scope === 'MASTER' ? 'property_id IS NULL' : 'property_id=$3';
  const params = scope === 'MASTER' ? [scope, at] : [scope, at, propertyId];
  const { rows } = await db.query(
    `SELECT v.id AS version_id,v.effective_from,p.anomaly_type,p.stabilization_minutes
       FROM automation_policy_versions v
       LEFT JOIN automation_policy_values p ON p.policy_version_id=v.id
      WHERE v.id=(
        SELECT id FROM automation_policy_versions
         WHERE scope=$1 AND effective_from<=$2 AND ${propertyWhere}
         ORDER BY effective_from DESC,id DESC LIMIT 1
      )
      ORDER BY p.anomaly_type`,
    params,
  );
  return versionFromRows(rows);
}

async function requireProperty(db, propertyId) {
  if (typeof propertyId !== 'string' || !propertyId.trim()) throw new Error('숙소가 필요합니다');
  const { rows } = await db.query('SELECT property_id FROM property_cleaning_config WHERE property_id=$1', [propertyId]);
  if (!rows.length) throw Object.assign(new Error(`숙소 설정 없음: ${propertyId}`), { status: 404 });
}

function sameValues(a, b) {
  return ANOMALY_TYPES.every(type => a[type] === b[type])
    && Object.keys(a).length === Object.keys(b).length;
}

export async function getAnomalyPolicySettings(db, { propertyId, at = null }) {
  await requireProperty(db, propertyId);
  const effectiveAt = at == null
    ? new Date((await db.query('SELECT NOW() AS now')).rows[0].now).toISOString()
    : asIso(at, '설정 조회');
  const master = await latestVersion(db, { scope: 'MASTER', at: effectiveAt });
  const property = await latestVersion(db, { scope: 'PROPERTY', propertyId, at: effectiveAt });
  const effective = {};
  for (const type of ANOMALY_TYPES) {
    effective[type] = resolveAnomalyPolicy({ type, master, property }).stabilizationMinutes;
  }
  return { master, property, effective };
}

async function insertVersion(db, { scope, propertyId, effectiveFrom, values }) {
  const { rows: [version] } = await db.query(
    `INSERT INTO automation_policy_versions(scope,property_id,effective_from)
     VALUES($1,$2,$3) RETURNING id,effective_from`,
    [scope, scope === 'MASTER' ? null : propertyId, effectiveFrom],
  );
  for (const [type, minutes] of Object.entries(values)) {
    await db.query(
      `INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes)
       VALUES($1,$2,$3)`,
      [version.id, type, minutes],
    );
  }
  return version.id;
}

export async function saveAnomalyPolicySettings(pool, { propertyId, masterValues, propertyValues }) {
  const masterNext = validateValues(masterValues, { complete: true, label: '마스터' });
  const propertyNext = validateValues(propertyValues ?? {}, { complete: false, label: '숙소' });
  if (typeof pool?.connect !== 'function') throw new Error('설정 저장에는 트랜잭션 연결이 필요합니다');
  const db = await pool.connect();
  let changed;
  try {
    await db.query('BEGIN');
    await requireProperty(db, propertyId);
    const { rows: [clock] } = await db.query('SELECT NOW() AS now');
    const effectiveFrom = new Date(clock.now).toISOString();
    const master = await latestVersion(db, { scope: 'MASTER', at: effectiveFrom });
    const property = await latestVersion(db, { scope: 'PROPERTY', propertyId, at: effectiveFrom });
    // 완전한 저장 요청 자체가 새 DB 정본이다. 현재 마스터가 없거나 불완전해 런타임 조회가
    // 설정 오류인 상태도 이 경로에서 복구할 수 있으며, 코드 기본값으로 대신하지 않는다.
    changed = { master: !sameValues(master?.values ?? {}, masterNext), property: !sameValues(property?.values ?? {}, propertyNext) };
    if (changed.master) await insertVersion(db, { scope: 'MASTER', effectiveFrom, values: masterNext });
    if (changed.property) await insertVersion(db, { scope: 'PROPERTY', propertyId, effectiveFrom, values: propertyNext });
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.release();
  }
  return { changed, ...(await getAnomalyPolicySettings(pool, { propertyId })) };
}
