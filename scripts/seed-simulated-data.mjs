/**
 * 실제 데이터와 동일한 DB 계약으로 가상 숙소 데이터를 시드한다.
 *
 * 기본 실행은 읽기 전용 미리보기다.
 *   node scripts/seed-simulated-data.mjs
 * 실제 DB 반영은 명시적으로 --apply를 붙인다.
 *   node scripts/seed-simulated-data.mjs --apply
 *
 * 이 스크립트는 property_cleaning_config / property_reservations / cleaning_jobs /
 * events에 SIMULATED 행만 upsert한다. cleaning_notifs는 생성하지 않는다.
 * REAL 행과 관계없는 데이터는 건드리지 않는다. 기존 SIMULATED 잔여 행을 삭제하지 않는
 * 비파괴 upsert-only 동작이다. 저장값은 data_origin = 'SIMULATED'로 명시한다.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { PROPERTIES } from '../src/data/roomStateMockData.js';
import { buildSimulatedDataset } from '../src/data/dataSimulator.js';

const { Pool } = pg;
const APPLY = process.argv.includes('--apply');

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
} catch { /* 환경변수가 이미 주입된 실행 환경 */ }

if (!process.env.POSTGRES_URL) {
  console.error('POSTGRES_URL 없음');
  process.exit(1);
}

const rows = buildSimulatedDataset(PROPERTIES);
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  properties: rows.properties.length,
  reservations: rows.reservations.length,
  jobs: rows.jobs.length,
  events: rows.events.length,
  origin: 'SIMULATED',
}, null, 2));

if (!APPLY) process.exit(0);

const db = new Pool({ connectionString: process.env.POSTGRES_URL });
try {
  await db.query('BEGIN');

  // 대상 property_id 또는 name이 이미 REAL이면 하위 행을 절대 쓰지 않는다.
  // 이름 충돌도 함께 막아 REAL 숙소에 SIMULATED 예약/작업이 섞이지 않게 한다.
  const targetPropertyIds = rows.properties.map(row => row.property_id);
  const targetPropertyNames = rows.properties.map(row => row.name);
  const existingProperties = await db.query(
    `SELECT property_id, name, data_origin
       FROM property_cleaning_config
      WHERE property_id = ANY($1::text[])
         OR name = ANY($2::text[])
      FOR UPDATE`,
    [targetPropertyIds, targetPropertyNames],
  );
  const targetIdSet = new Set(targetPropertyIds);
  const unsafeProperties = existingProperties.rows.filter(row => (
    !targetIdSet.has(row.property_id) || row.data_origin !== 'SIMULATED'
  ));
  if (unsafeProperties.length > 0) {
    const details = unsafeProperties.map(row => `${row.property_id}/${row.name}:${row.data_origin}`).join(', ');
    throw new Error(`REAL 또는 충돌 숙소가 있어 SIMULATED seed를 중단합니다: ${details}`);
  }

  for (const p of rows.properties) {
    await db.query(
      `INSERT INTO property_cleaning_config
        (property_id, name, checkout_hour, cleaning_duration_hours, data_origin, source_system, source_ref, source_updated_at)
       VALUES ($1,$2,$3,$4,'SIMULATED',$5,$6,NOW())
       ON CONFLICT (property_id) DO UPDATE SET
         name=EXCLUDED.name, checkout_hour=EXCLUDED.checkout_hour,
         cleaning_duration_hours=EXCLUDED.cleaning_duration_hours,
         data_origin='SIMULATED', source_system=EXCLUDED.source_system,
         source_ref=EXCLUDED.source_ref, source_updated_at=NOW(), updated_at=NOW()
       WHERE property_cleaning_config.data_origin='SIMULATED'`,
      [p.property_id, p.name, p.checkout_hour, p.cleaning_duration_hours, p.source_system, p.source_ref],
    );
  }

  for (const r of rows.reservations) {
    await db.query(
      `INSERT INTO property_reservations
        (property_id,reservation_uid,guest_name,platform,check_in,check_out,source_system,source_ref,raw_data,data_origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SIMULATED')
       ON CONFLICT (property_id,reservation_uid) DO UPDATE SET
         guest_name=EXCLUDED.guest_name, platform=EXCLUDED.platform,
         check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
         source_system=EXCLUDED.source_system, source_ref=EXCLUDED.source_ref,
         raw_data=EXCLUDED.raw_data, data_origin='SIMULATED',
         last_seen_at=NOW(), updated_at=NOW()
       WHERE property_reservations.data_origin='SIMULATED'`,
      [r.property_id, r.reservation_uid, r.guest_name, r.platform, r.check_in, r.check_out, r.source_system, r.source_ref, r.raw_data],
    );
  }

  for (const j of rows.jobs) {
    await db.query(
      `INSERT INTO cleaning_jobs
        (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,status,google_event_id,source,source_ref,data_origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SIMULATED')
       ON CONFLICT (property_id,checkout_at) DO UPDATE SET
         reservation_uid=EXCLUDED.reservation_uid, cleaning_start_at=EXCLUDED.cleaning_start_at,
         cleaning_end_at=EXCLUDED.cleaning_end_at, status=EXCLUDED.status,
         google_event_id=EXCLUDED.google_event_id, source=EXCLUDED.source,
         source_ref=EXCLUDED.source_ref, data_origin='SIMULATED', updated_at=NOW()
       WHERE cleaning_jobs.data_origin='SIMULATED'`,
      [j.property_id, j.reservation_uid, j.checkout_at, j.cleaning_start_at, j.cleaning_end_at, j.status, j.google_event_id, j.source, j.source_ref],
    );
  }

  for (const e of rows.events) {
    await db.query(
      `INSERT INTO events (property_id,type,is_soft,device_time,data,source_system,source_ref,data_origin,status)
       VALUES ($1,$2,false,$3,$4,'SIMULATED_FIXTURE',$5,'SIMULATED','complete')
       ON CONFLICT DO NOTHING`,
      [e.property_id, e.type, e.device_time, e.data, e.source_ref],
    );
  }

  await db.query('COMMIT');
  console.log('✅ SIMULATED 데이터 저장 완료');
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('❌ 시드 실패:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
