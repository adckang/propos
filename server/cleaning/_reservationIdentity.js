/**
 * RF-25 — 외부 예약 UID와 분리된 내부 숙박·청소 의무 발급.
 * 예약 저장, 기존 의무 종료, 현재 의무 발급은 반드시 같은 DB 트랜잭션에서 한다.
 */

function asIso(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 시각이 올바르지 않습니다`);
  return date.toISOString();
}

async function transaction(pool, work) {
  if (typeof pool?.connect !== 'function') throw new Error('예약 신원 저장에는 트랜잭션 연결이 필요합니다');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function saveReservationIdentity(pool, input) {
  const {
    propertyId, reservationUid, guestName = null, platform = 'Airbnb',
    checkIn, checkOut, sourceRef = null, rawData = null, dataOrigin,
  } = input ?? {};
  if (!propertyId || !reservationUid) throw new Error('숙소와 예약 번호가 필요합니다');
  if (!['REAL', 'SIMULATED'].includes(dataOrigin)) throw new Error('예약 데이터 출처가 올바르지 않습니다');
  const checkInIso = asIso(checkIn, '입실');
  const checkOutIso = asIso(checkOut, '퇴실');
  if (Date.parse(checkOutIso) <= Date.parse(checkInIso)) throw new Error('퇴실은 입실 뒤여야 합니다');

  return transaction(pool, async db => {
    const { rows: [existing] } = await db.query(
      `SELECT stay_id FROM property_reservations
        WHERE property_id=$1 AND reservation_uid=$2
        FOR UPDATE`,
      [propertyId, reservationUid],
    );

    let stayId = existing?.stay_id ?? null;
    if (!stayId) {
      const { rows: [stay] } = await db.query(
        `INSERT INTO property_stays(property_id,initial_check_in,initial_check_out,data_origin)
         VALUES($1,$2,$3,$4)
         ON CONFLICT (property_id,initial_check_in,initial_check_out)
         DO UPDATE SET property_id=EXCLUDED.property_id
         RETURNING id`,
        [propertyId, checkInIso, checkOutIso, dataOrigin],
      );
      stayId = stay.id;
    }

    const { rows: [savedReservation] } = await db.query(
      `INSERT INTO property_reservations
         (property_id,reservation_uid,stay_id,guest_name,platform,check_in,check_out,status,
          source_system,source_ref,raw_data,data_origin,last_seen_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE','AIRBNB_ICAL',$8,$9,$10,NOW(),NOW())
       ON CONFLICT (property_id,reservation_uid) DO UPDATE SET
         stay_id=COALESCE(property_reservations.stay_id,EXCLUDED.stay_id),
         guest_name=EXCLUDED.guest_name,
         platform=EXCLUDED.platform,
         check_in=EXCLUDED.check_in,
         check_out=EXCLUDED.check_out,
         status='ACTIVE',
         source_system=EXCLUDED.source_system,
         source_ref=EXCLUDED.source_ref,
         raw_data=EXCLUDED.raw_data,
         data_origin=EXCLUDED.data_origin,
         last_seen_at=NOW(),
         updated_at=NOW()
       RETURNING stay_id`,
      [propertyId, reservationUid, stayId, guestName, platform, checkInIso, checkOutIso,
       sourceRef, rawData, dataOrigin],
    );
    stayId = savedReservation.stay_id;

    const { rows: [active] } = await db.query(
      `SELECT id,checkout_at FROM cleaning_obligations
        WHERE stay_id=$1 AND status='ACTIVE'
        FOR UPDATE`,
      [stayId],
    );
    if (active && new Date(active.checkout_at).getTime() !== Date.parse(checkOutIso)) {
      await db.query(
        `UPDATE cleaning_obligations
            SET status='TARGET_REMOVED',ended_at=NOW(),end_reason='CHECKOUT_CHANGED'
          WHERE id=$1 AND status='ACTIVE'`,
        [active.id],
      );
    }

    let cleaningObligationId = active && new Date(active.checkout_at).getTime() === Date.parse(checkOutIso)
      ? active.id
      : null;
    if (!cleaningObligationId) {
      const { rows: [obligation] } = await db.query(
        `INSERT INTO cleaning_obligations(property_id,stay_id,checkout_at,status,data_origin)
         VALUES($1,$2,$3,'ACTIVE',$4)
         ON CONFLICT (stay_id) WHERE status='ACTIVE'
         DO UPDATE SET stay_id=EXCLUDED.stay_id
         RETURNING id,checkout_at`,
        [propertyId, stayId, checkOutIso, dataOrigin],
      );
      if (new Date(obligation.checkout_at).getTime() !== Date.parse(checkOutIso)) {
        throw new Error('동시에 저장된 다른 퇴실 의무가 있습니다');
      }
      cleaningObligationId = obligation.id;
    }

    return { stayId, cleaningObligationId };
  });
}
