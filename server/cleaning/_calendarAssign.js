/**
 * 담당자가 구글 예약 캘린더에서 청소 칸을 예약한 일정(이벤트)으로 청소 일정을 배정한다 — RF-14(2026-11-13).
 *
 * 흐름: 담당자가 예약 링크에서 그날 칸 예약 → 구글이 "캘린더가 바뀌었다" 알림 → 바뀐 일정을 읽어 이 함수로 배정.
 * 담당자가 예약했는데 자동 배정이 안 됐을 때 운영자가 쓰는 "캘린더 다시 확인"(수동 스캔)도 같은 함수를 쓴다.
 * 예전엔 두 곳이 같은 판단을 각자 복사해 갖고 있었고, 수동 스캔은 요청 받은 나머지 담당자에게 "배정 완료" 안내를 빠뜨렸다
 * (시나리오 문서 S22: 수동 스캔 배정도 안내 + Slack).
 *
 * @param {{ query: Function }} db
 * @param {{ property: { property_id: string, name?: string }, events: object[], onlyDate?: string|null }} input
 *   events = 구글 캘린더 일정, onlyDate = 이 한국 날짜의 일정만(수동 스캔에서 날짜를 지정했을 때)
 * @param {{ calendarCleaningTimes: Function, resolveCalendarCleaner: Function, sendCompletionSmsToRest: Function,
 *   postAssignmentSlack: Function, alertUnregisteredCleaner: (eventId: string, text: string) => Promise<void>, goneAlertDeps: object }} deps
 *   alertUnregisteredCleaner = 같은 예약 일정의 미등록 담당자 경고를 하루 한 번만 보내는 운영자 알림
 * @returns {Promise<Array<{ eventDate: string, attendeeEmail: string, cleaner?: string, result: string }>>}
 */
export async function assignFromCalendarEvents(db, { property, events, onlyDate = null }, deps) {
  const { calendarCleaningTimes, resolveCalendarCleaner, sendCompletionSmsToRest, postAssignmentSlack, alertUnregisteredCleaner, goneAlertDeps } = deps;
  const results = [];
  for (const evt of events ?? []) {
    // PROPOS 가 칸을 막으려고 만든 블로커, 참석자(예약한 담당자)가 없는 일정은 예약이 아니다
    if (evt.extendedProperties?.private?.propos === "blocker" || !evt.attendees?.length) continue;
    const times = calendarCleaningTimes(evt);
    if (!times?.date) continue;
    if (onlyDate && times.date !== onlyDate) continue;
    const { attendeeEmail, cleaner } = await resolveCalendarCleaner(evt);
    if (!attendeeEmail) continue;
    const eventDate = times.date;
    // 그날 퇴실의 청소 일정 — 요청 중·배정 실패·요청 전, 또는 이미 이 예약으로 배정된 것(시각 고침)
    const { rows: [job] } = await db.query(
      `SELECT * FROM cleaning_jobs WHERE property_id=$1
       AND to_char(checkout_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2
       AND data_origin='REAL'
       AND (
         status IN ('PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED')
         OR (status = 'ASSIGNED' AND (assigned_cleaner_id IS NULL OR google_event_id=$3))
       )
       LIMIT 1`,
      [property.property_id, eventDate, evt.id]
    );
    if (!job) { results.push({ eventDate, attendeeEmail, result: "job 없음" }); continue; }
    if (!cleaner) {
      results.push({ eventDate, attendeeEmail, result: "미등록 담당자" });
      await alertUnregisteredCleaner(evt.id, `[PROPOS] ⚠️ 미등록 청소 담당자 이메일: ${attendeeEmail} — 수동 확인 필요`);
      continue;
    }
    // 예약 시각이 그날 퇴실 뒤여야 한다(퇴실 11시 전 청소 예약은 배정하지 않음)
    if (!calendarCleaningTimes(evt, job.checkout_at)) continue;
    // 이미 다른 담당자·다른 예약으로 배정된 일정은 바꾸지 않는다
    if (job.status === 'ASSIGNED' && job.assigned_cleaner_id
        && (job.assigned_cleaner_id !== cleaner.id || job.google_event_id !== evt.id)) continue;
    const { rows: updated } = await db.query(
      `UPDATE cleaning_jobs SET status='ASSIGNED',assigned_cleaner_id=$1,google_event_id=$2,
         cleaning_start_at=$4,cleaning_end_at=$5,updated_at=NOW()
       WHERE id=$3 AND data_origin='REAL' AND status=$6
         AND (status!='ASSIGNED' OR assigned_cleaner_id IS NULL OR (assigned_cleaner_id=$1 AND google_event_id=$2))
         AND checkout_at <= $4::timestamptz
         AND (status!='ASSIGNED' OR assigned_cleaner_id IS DISTINCT FROM $1 OR google_event_id IS DISTINCT FROM $2
              OR cleaning_start_at IS DISTINCT FROM $4::timestamptz OR cleaning_end_at IS DISTINCT FROM $5::timestamptz)
       RETURNING id`,
      [cleaner.id, evt.id, job.id, times.cleaning_start_at, times.cleaning_end_at, job.status]
    );
    if (!updated.length) { results.push({ eventDate, attendeeEmail, result: "이미 ASSIGNED" }); continue; }
    results.push({ eventDate, attendeeEmail, cleaner: cleaner.name, result: "ASSIGNED" });
    // 새 배정일 때만(같은 예약의 시각 고침은 조용히) — 요청 받은 나머지 담당자에게 "배정 완료" 안내 + 운영자 Slack
    // (그날 퇴실이 없어졌으면 Slack 은 "배정 완료" 대신 경고, RF-16)
    if (job.status !== 'ASSIGNED' || !job.assigned_cleaner_id) {
      await sendCompletionSmsToRest(db, job.id, cleaner.id)
        .catch(e => console.error(`[calendar-assign] 나머지 담당자 "배정 완료" 안내 실패 (${job.id}):`, e.message));
      await postAssignmentSlack(db, { job, propertyName: property.name ?? property.property_id, cleanerName: cleaner.name, ...goneAlertDeps,
        normalText: `[PROPOS] ✅ ${property.name ?? property.property_id} ${eventDate} 청소 배정 완료 (${cleaner.name})` });
    }
  }
  return results;
}
