/**
 * REAL 숙소의 Airbnb iCal 원본을 property_reservations에 백필한다.
 * 기존 REAL cleaning_jobs는 삭제·상태변경하지 않고, 같은 예약 UID에만 추적 필드를 보강한다.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { parseVEvents, airbnbEventsToReservations } from '../src/domain/room-state/icalParser.js';
import { calcCleaningTimes } from '../server/cleaning/_dispatch.js';

for (const line of (() => { try { return readFileSync('.env.local', 'utf8').split('\n'); } catch { return []; } })()) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
}
if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL 없음');

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
const iso = value => new Date(value).toISOString();
let reservationCount = 0;
let jobCount = 0;
let legacyJobCount = 0;

try {
  const { rows: properties } = await pool.query(
    `SELECT * FROM property_cleaning_config
      WHERE data_origin='REAL' AND ical_url IS NOT NULL AND ical_url <> ''`
  );
  for (const property of properties) {
    const response = await fetch(property.ical_url);
    if (!response.ok) throw new Error(`${property.property_id}: iCal HTTP ${response.status}`);
    const events = parseVEvents(await response.text());
    const reservations = airbnbEventsToReservations(events, 15, property.checkout_hour ?? 11);
    for (const reservation of reservations) {
      const uid = reservation.uid;
      const checkIn = iso(reservation.checkIn);
      const checkOut = iso(reservation.checkOut);
      await pool.query(
        `INSERT INTO property_reservations
          (property_id,reservation_uid,guest_name,platform,check_in,check_out,status,source_system,source_ref,raw_data,data_origin,last_seen_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','AIRBNB_ICAL',$7,$8,'REAL',NOW(),NOW())
         ON CONFLICT (property_id,reservation_uid) DO UPDATE SET
           guest_name=EXCLUDED.guest_name, platform=EXCLUDED.platform,
           check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
           status='ACTIVE', source_system=EXCLUDED.source_system,
           source_ref=EXCLUDED.source_ref, raw_data=EXCLUDED.raw_data,
           data_origin='REAL', last_seen_at=NOW(), updated_at=NOW()`,
        [property.property_id, uid, reservation.guestName ?? null, reservation.platform ?? 'Airbnb', checkIn, checkOut, `ical:${property.property_id}`, reservation],
      );
      reservationCount++;

      const date = new Date(checkOut).toISOString().slice(0, 10);
      const times = calcCleaningTimes(date, property.checkout_hour ?? 11, property.cleaning_duration_hours ?? 2.5);
      const source = (times.cleaning_start_at.getTime() - Date.now()) / 86_400_000 <= 14
        ? 'SHORT_NOTICE' : 'MONTHLY_BATCH';
      const result = await pool.query(
        `INSERT INTO cleaning_jobs
          (property_id,reservation_uid,checkout_at,cleaning_start_at,cleaning_end_at,source,source_ref,data_origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'REAL')
         ON CONFLICT (property_id,checkout_at) DO UPDATE SET
           reservation_uid=COALESCE(cleaning_jobs.reservation_uid, EXCLUDED.reservation_uid),
           source_ref=COALESCE(cleaning_jobs.source_ref, EXCLUDED.source_ref),
           data_origin='REAL', updated_at=NOW()`,
        [property.property_id, uid, checkOut, times.cleaning_start_at.toISOString(), times.cleaning_end_at.toISOString(), source, `ical:${property.property_id}:${uid}`],
      );
      if (result.rowCount) jobCount += result.rowCount;
    }

    // 현재 iCal 창에 더 이상 존재하지 않는 과거 REAL 작업은 임의의 예약을
    // 만들어 연결하지 않는다. 대신 기존 작업 ID를 source_ref로 남겨 추적성을
    // 보존하고, 예약 미매칭 상태는 감사 쿼리에서 확인할 수 있게 한다.
    const legacy = await pool.query(
      `UPDATE cleaning_jobs j
          SET source_ref='legacy:cleaning_job:'||j.id, updated_at=NOW()
        WHERE j.property_id=$1
          AND j.data_origin='REAL'
          AND j.source_ref IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM property_reservations r
             WHERE r.property_id=j.property_id
               AND r.reservation_uid=j.reservation_uid
          )`,
      [property.property_id],
    );
    legacyJobCount += legacy.rowCount;
  }
  console.log(JSON.stringify({ ok: true, properties: properties.length, reservations: reservationCount, jobsUpserted: jobCount, legacyJobsTracked: legacyJobCount }));
} finally {
  await pool.end();
}
