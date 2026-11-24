/**
 * Airbnb 예약 가져오기(iCal 동기화) — 청소 일정까지 한 번에.
 *
 * 흐름: Airbnb 예약 피드 → 우리 예약 목록(추가·날짜 변경 반영, 사라진 예약은 두 번 연속 안 보이면 취소 표시) → 퇴실마다 청소 일정
 * (요청 시각 = 청소 2주 전, 2주 안이면 지금) → 2주 안 신규 퇴실은 그날 칸을 열고 바로 첫 요청.
 *
 * 부르는 곳(RF-20, 2026-11-12): 매일 아침 8시·밤 10시 정기 작업(요청 작업 직전), 대시보드가 열려 있는 동안 15분마다,
 * Airbnb "예약 확정" 메일, 수동 버튼. 예전엔 정기 작업이 없어 화면을 안 열면 취소·날짜 변경이 반영되지 않았다.
 * 이 함수는 api/cleaning 에만 있었는데 정기 작업(api/cron)도 쓰도록 공용으로 옮겼다(내용은 그대로).
 *
 * @param {{ query: Function }} db
 * @param {{ kv: object, filterPropertyId?: string|null }} options  kv = Vercel KV(구글 토큰·동기화 기준 시각·알림 기록)
 */
import { openCleaningSlot } from './_calendar.js';
import { advanceJob, calcCleaningTimes, planJobDispatch, postSlack, toKstDateKey } from './_dispatch.js';
import { saveReservationIdentity } from './_reservationIdentity.js';
import { alertGoneCheckouts, isCompleteCalendar, reservationUidOf, retireAfterSync } from './_reservationSync.js';
import { airbnbEventsToReservations, parseVEvents } from '../../src/domain/room-state/icalParser.js';

export async function syncAllPropertiesIcal(db, { kv, filterPropertyId = null } = {}) {
  const goneAlertDeps = { store: kv, send: postSlack };
  const { rows: properties } = await db.query(
    filterPropertyId
      ? `SELECT * FROM property_cleaning_config WHERE data_origin='REAL' AND ical_url IS NOT NULL AND property_id=$1`
      : `SELECT * FROM property_cleaning_config WHERE data_origin='REAL' AND ical_url IS NOT NULL`,
    filterPropertyId ? [filterPropertyId] : []
  );
  if (!properties.length) return;

  const now = Date.now();

  // RF-16: 이번 동기화의 시작 시각(DB 시계, 어떤 피드보다 먼저) — 사라진 예약을 정리할 때 이 뒤에(그리고 그 전 한 시간 안에)
  // 확인된 예약은 건드리지 않는다. 겹쳐 돈 다른 동기화가 넣은 새 예약, 한 번 흔들린 피드로 잠깐 빠진 예약 보호
  let syncStartedAt = null;
  try { syncStartedAt = (await db.query('SELECT NOW() AS now')).rows[0]?.now ?? null; }
  catch (e) { console.error('[syncAllIcal] 동기화 시작 시각 조회 실패:', e.message); }

  for (const prop of properties) {
    try {
      await syncOneProperty(db, { prop, kv, now, syncStartedAt, goneAlertDeps });
    } catch (e) {
      // 숙소마다 따로 — 한 숙소의 오류(잘못된 날짜·저장 거절 등)가 다른 숙소의 예약 가져오기를 멈추지 않게(정기 작업이 하루 두 번 혼자 돈다)
      console.error(`[syncAllIcal] 예약 가져오기 실패 (${prop.property_id}):`, e.code ?? e.message);
    }
  }
}

/** 숙소 하나 — 피드 받기 → 예약 저장 → 사라진 예약 정리·알림 → 청소 일정(2주 안이면 칸 열고 바로 요청) */
async function syncOneProperty(db, { prop, kv, now, syncStartedAt, goneAlertDeps }) {
    let icalText;
    try {
      const r = await fetch(prop.ical_url);
      if (!r.ok) throw new Error(`iCal HTTP ${r.status}`);
      icalText = await r.text();
    } catch (e) {
      console.error(`[syncAllIcal] iCal 폴링 실패 (${prop.property_id}):`, e.message);
      return;
    }

    const parsedReservations = airbnbEventsToReservations(
      parseVEvents(icalText),
      prop.checkin_hour ?? 15,
      prop.checkout_hour ?? 11,
    );
    const checkouts = parsedReservations.filter(r => r.checkOut.getTime() >= now);

    const identities = new Map();
    for (const reservation of parsedReservations) {
      const reservationUid = reservationUidOf(prop.property_id, reservation);
      const identity = await saveReservationIdentity(db, {
        propertyId: prop.property_id,
        reservationUid,
        guestName: reservation.guestName,
        platform: reservation.platform,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        sourceRef: prop.ical_url,
        rawData: reservation,
        dataOrigin: 'REAL',
      });
      identities.set(reservationUid, identity);
    }

    // RF-16: 피드에서 사라진 미래 예약(취소·새 번호로 재발행)을 취소로 표시하고, 퇴실이 없어진 날(취소·같은 번호의 날짜 변경)의
    // 살아 있는 청소 작업은 운영자에게 한 번 알린다(작업은 바꾸지 않음). 정리 실패가 새 예약·청소 생성을 막지 않게 따로 잡는다.
    try {
      if (syncStartedAt) {
        const { skipped } = await retireAfterSync(db, {
          propertyId: prop.property_id,
          seenUids: parsedReservations.map(reservation => reservationUidOf(prop.property_id, reservation)),
          feedIsCalendar: isCompleteCalendar(icalText),
          syncStartedAt,
          now: new Date(now),
          store: kv,
        });
        if (skipped === 'MASS_VANISH') console.error(`[syncAllIcal] 예약이 한꺼번에 많이 사라져 정리하지 않음 — 피드 확인 필요 (${prop.property_id})`);
        if (skipped === 'INVALID_FEED') console.error(`[syncAllIcal] 피드가 온전한 달력이 아니라 사라진 예약을 정리하지 않음 (${prop.property_id})`);
      }
      await alertGoneCheckouts(db, { propertyId: prop.property_id, propertyName: prop.name, now: new Date(now), ...goneAlertDeps });
    } catch (e) {
      console.error(`[syncAllIcal] 사라진 예약 정리 실패 (${prop.property_id}):`, e.message);
    }

    for (const reservation of checkouts) {
      const { uid } = reservation;
      const reservationUid = reservationUidOf(prop.property_id, reservation);
      const identity = identities.get(reservationUid);
      if (!identity?.cleaningObligationId) throw new Error(`청소 의무 없음 (${prop.property_id}/${reservationUid})`);
      const date = toKstDateKey(reservation.checkOut);
      if (!date) {
        console.error(`[syncAllIcal] 잘못된 체크아웃 날짜 (${prop.property_id}/${uid ?? 'unknown'})`);
        continue;
      }
      const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes(
        date, prop.checkout_hour ?? 11, prop.cleaning_duration_hours ?? 2.5
      );
      // MONTHLY_BATCH: 청소 시작 14일 전에 요청 / SHORT_NOTICE: 지금 → 아래에서 즉시 advanceJob (작업을 만드는 곳 모두 같은 규칙)
      const { source, dispatchAfter } = planJobDispatch(cleaning_start_at, now);

      const { rowCount } = await db.query(
        `INSERT INTO cleaning_jobs
           (property_id,reservation_uid,cleaning_obligation_id,checkout_at,cleaning_start_at,cleaning_end_at,source,source_ref,data_origin,dispatch_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$2,'REAL',$8)
         ON CONFLICT (property_id,checkout_at) DO NOTHING`,
        // 예약 행과 같은 번호 규칙(RF-16) — 번호 없는 피드 예약도 저장된 예약을 가리키게
        [prop.property_id, reservationUid, identity.cleaningObligationId, cleaning_start_at.toISOString(),
         cleaning_start_at.toISOString(), cleaning_end_at.toISOString(), source, dispatchAfter.toISOString()]
      );

      // A→B→A로 퇴실이 돌아오면 같은 시각의 기존 실행 작업을 재사용하되, 끝난 옛 의무가 아니라 새 현재 의무를 가리킨다.
      if (rowCount === 0) {
        await db.query(
          `WITH updated AS (
             UPDATE cleaning_jobs j SET cleaning_obligation_id=$3,reservation_uid=$2,updated_at=NOW()
              WHERE j.property_id=$1 AND j.checkout_at=$4
                AND (j.cleaning_obligation_id IS NULL OR EXISTS (
                  SELECT 1 FROM cleaning_obligations o
                   WHERE o.id=j.cleaning_obligation_id AND o.status='TARGET_REMOVED'
                ))
              RETURNING j.id,j.property_id,j.cleaning_obligation_id,j.status,j.assigned_cleaner_id,j.updated_at
           )
           SELECT u.id,record_cleaning_assignment_history(
             u.property_id,u.cleaning_obligation_id,u.id,
             CASE WHEN u.status IN ('ASSIGNED','COMPLETED') AND u.assigned_cleaner_id IS NOT NULL
                  THEN 'ASSIGNED' ELSE 'UNASSIGNED' END,
             CASE WHEN u.status IN ('ASSIGNED','COMPLETED') THEN u.assigned_cleaner_id ELSE NULL END,
             'SYSTEM','JOB_REBOUND','job:'||u.id::text||':obligation-rebound:'||u.cleaning_obligation_id::text,
             u.updated_at,'{}'::jsonb
           ) AS assignment_history_recorded FROM updated u`,
          [prop.property_id, reservationUid, identity.cleaningObligationId, cleaning_start_at.toISOString()],
        );
      }

      if (rowCount > 0 && source === "SHORT_NOTICE") {
        // 새로 생긴 2주 안 일정 — 지금 칸을 열고 바로 요청한다(칸은 요청 날 연다, DEC-07). 이미 있던 일정은 여기서 열지 않는다:
        // 운영자가 취소하며 다시 막은 칸을 매 가져오기마다 다시 열면 안 되고, 요청할 일정은 매일 요청 작업이 칸을 열며 보낸다.
        // 구글에서 지워졌을 때만 기록을 지워, 실패하면 매일 요청 작업의 "다시 열기"가 재시도한다
        await openCleaningSlot(db, { propertyId: prop.property_id, date, kv }).catch(
          (e) => console.error(`[syncAllIcal] 칸 열기 실패 (${prop.property_id}/${date}):`, e.message)
        );
        // 즉시 발동 (followup 크론 대기 없이)
        const { rows: [newJob] } = await db.query(
          `SELECT * FROM cleaning_jobs WHERE property_id=$1 AND checkout_at=$2`,
          [prop.property_id, cleaning_start_at.toISOString()]
        );
        if (newJob) {
          await advanceJob(db, newJob).catch(
            (e) => console.error(`[syncAllIcal] advanceJob 실패 (${prop.property_id}/${date}):`, e.message)
          );
        }
        await postSlack(
          `[PROPOS] 🚀 SHORT_NOTICE 신규 예약: ${prop.name ?? prop.property_id} ${date} → 즉시 알림 발송`
        );
      }
    }
}
