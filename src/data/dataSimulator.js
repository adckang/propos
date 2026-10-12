/**
 * PROPOS 데이터 계약 검수·생성 코어.
 *
 * 이 파일은 Node 내장 기능이나 DB 드라이버를 사용하지 않는 순수 모듈이다.
 * DB 연결은 scripts/data-simulator.mjs가 어댑터로 담당하고, 이 모듈은 동일한
 * 행 집합을 로컬 파일·테스트·운영 DB 어디서든 같은 규칙으로 검사한다.
 */

export const DATA_ORIGINS = Object.freeze({
  REAL: 'REAL',
  SIMULATED: 'SIMULATED',
});

export const VALID_JOB_STATUSES = Object.freeze([
  'PENDING', 'NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3',
  'NOTIFYING_BULK', 'BULK_REMINDED', 'ESCALATED', 'ASSIGNED', 'COMPLETED', 'CANCELLED',
]);

export const VALID_JOB_SOURCES = Object.freeze(['MONTHLY_BATCH', 'SHORT_NOTICE']);
export const VALID_RESERVATION_STATUSES = Object.freeze(['ACTIVE', 'CANCELLED', 'BLOCKED']);

const VALID_ORIGIN_SET = new Set(Object.values(DATA_ORIGINS));
const VALID_JOB_STATUS_SET = new Set(VALID_JOB_STATUSES);
const VALID_JOB_SOURCE_SET = new Set(VALID_JOB_SOURCES);
const VALID_RESERVATION_STATUS_SET = new Set(VALID_RESERVATION_STATUSES);

const asArray = value => (Array.isArray(value) ? value : []);
const text = value => (value == null ? '' : String(value).trim());
const hasValue = value => text(value).length > 0;
const keyOf = (propertyId, value) => `${text(propertyId)}\u0000${text(value)}`;

function addIssue(list, code, table, key, message, detail = {}) {
  list.push({ severity: 'error', code, table, key, message, detail });
}

function addWarning(list, code, table, key, message, detail = {}) {
  list.push({ severity: 'warning', code, table, key, message, detail });
}

function asDate(value) {
  if (value instanceof Date) return value;
  if (!hasValue(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value) {
  const date = asDate(value);
  if (!date) throw new Error(`유효하지 않은 날짜: ${value}`);
  return date.toISOString();
}

function originOf(row, fallback = DATA_ORIGINS.REAL) {
  return text(row?.data_origin || row?.dataOrigin) || fallback;
}

function sourceSystemOf(row) {
  return text(row?.source_system || row?.sourceSystem);
}

function sourceRefOf(row) {
  return text(row?.source_ref || row?.sourceRef);
}

function reservationUidOf(row) {
  return text(row?.reservation_uid || row?.reservationUid || row?.uid);
}

function propertyIdOf(row) {
  return text(row?.property_id || row?.propertyId || row?.id);
}

function buildIndex(rows, idOf) {
  const index = new Map();
  for (const row of asArray(rows)) {
    const id = idOf(row);
    if (id) index.set(id, row);
  }
  return index;
}

function countByOrigin(rows) {
  return asArray(rows).reduce((counts, row) => {
    const origin = originOf(row, 'UNKNOWN');
    counts[origin] = (counts[origin] || 0) + 1;
    return counts;
  }, {});
}

/**
 * 관계형 행 집합을 검수한다.
 *
 * 기본 모드는 레거시 REAL 청소작업의 미매칭을 warning으로 허용한다.
 * 실제 예약을 현재 iCal 창에서 복원할 수 없는 과거 작업을 삭제하거나
 * 임의의 예약으로 연결하지 않기 위한 정책이다. --strict에서는 warning도 실패다.
 */
export function validateDataset(dataset = {}, options = {}) {
  const issues = [];
  const warnings = [];
  const properties = asArray(dataset.properties ?? dataset.property_cleaning_config);
  const reservations = asArray(dataset.reservations ?? dataset.property_reservations);
  const jobs = asArray(dataset.jobs ?? dataset.cleaning_jobs);
  const events = asArray(dataset.events);
  const notifs = asArray(dataset.notifs ?? dataset.cleaning_notifs);
  const blockers = asArray(dataset.blockers ?? dataset.property_calendar_blockers);
  const cleaners = asArray(dataset.cleaners);
  const allowLegacyRealJobs = options.allowLegacyRealJobs !== false;

  const propertyIndex = new Map();
  const propertyNameIndex = new Map();
  const reservationIndex = new Map();
  const jobKeyIndex = new Map();
  const jobIndex = new Map();
  const eventKeyIndex = new Map();
  const eventIdIndex = new Map();
  const blockerKeyIndex = new Map();
  const notifKeyIndex = new Map();
  const notifTokenIndex = new Map();
  const cleanerIndex = buildIndex(cleaners, row => text(row.id));

  for (const row of properties) {
    const propertyId = propertyIdOf(row);
    const name = text(row.name);
    const key = propertyId || name || '<missing>';
    if (!propertyId) addIssue(issues, 'PROPERTY_ID_REQUIRED', 'property_cleaning_config', key, 'property_id가 없습니다.');
    if (!name) addIssue(issues, 'PROPERTY_NAME_REQUIRED', 'property_cleaning_config', key, '숙소 이름이 없습니다.');
    if (propertyId && propertyIndex.has(propertyId)) {
      addIssue(issues, 'PROPERTY_ID_DUPLICATE', 'property_cleaning_config', propertyId, 'property_id가 중복됩니다.');
    }
    if (name && propertyNameIndex.has(name)) {
      addIssue(issues, 'PROPERTY_NAME_DUPLICATE', 'property_cleaning_config', name, '숙소 이름이 중복됩니다.');
    }
    if (propertyId) propertyIndex.set(propertyId, row);
    if (name) propertyNameIndex.set(name, row);

    const origin = originOf(row, '');
    if (!VALID_ORIGIN_SET.has(origin)) {
      addIssue(issues, 'PROPERTY_ORIGIN_INVALID', 'property_cleaning_config', key, `data_origin이 잘못됐습니다: ${origin}`);
    }
    if (!hasValue(sourceSystemOf(row))) addIssue(issues, 'PROPERTY_SOURCE_REQUIRED', 'property_cleaning_config', key, 'source_system이 없습니다.');
    if (!hasValue(sourceRefOf(row))) addIssue(issues, 'PROPERTY_TRACE_REQUIRED', 'property_cleaning_config', key, 'source_ref가 없습니다.');
    if (!Number.isFinite(Number(row.checkout_hour)) || Number(row.checkout_hour) < 0 || Number(row.checkout_hour) > 23) {
      addIssue(issues, 'CHECKOUT_HOUR_INVALID', 'property_cleaning_config', key, 'checkout_hour가 0~23 범위를 벗어났습니다.');
    }
    if (!Number.isFinite(Number(row.cleaning_duration_hours)) || Number(row.cleaning_duration_hours) <= 0) {
      addIssue(issues, 'CLEANING_DURATION_INVALID', 'property_cleaning_config', key, '청소 소요시간이 0보다 커야 합니다.');
    }
    if (origin === DATA_ORIGINS.SIMULATED && sourceSystemOf(row) !== 'SIMULATED_FIXTURE') {
      addWarning(warnings, 'SIMULATED_SOURCE_UNEXPECTED', 'property_cleaning_config', key, 'SIMULATED 숙소의 source_system이 표준값이 아닙니다.');
    }
    if (origin === DATA_ORIGINS.REAL && sourceSystemOf(row) === 'SIMULATED_FIXTURE') {
      addIssue(issues, 'REAL_SIMULATED_SOURCE_MISMATCH', 'property_cleaning_config', key, 'REAL 숙소가 SIMULATED_FIXTURE 출처를 사용합니다.');
    }
  }

  for (const row of reservations) {
    const propertyId = propertyIdOf(row);
    const uid = reservationUidOf(row);
    const key = `${propertyId || '<missing>'}/${uid || '<missing>'}`;
    const property = propertyIndex.get(propertyId);
    if (!property) addIssue(issues, 'RESERVATION_PROPERTY_MISSING', 'property_reservations', key, '예약의 숙소가 존재하지 않습니다.');
    if (!uid) addIssue(issues, 'RESERVATION_UID_REQUIRED', 'property_reservations', key, 'reservation_uid가 없습니다.');
    const compositeKey = keyOf(propertyId, uid);
    if (reservationIndex.has(compositeKey)) addIssue(issues, 'RESERVATION_DUPLICATE', 'property_reservations', key, '숙소·예약 UID 조합이 중복됩니다.');
    reservationIndex.set(compositeKey, row);
    const checkIn = asDate(row.check_in ?? row.checkIn);
    const checkOut = asDate(row.check_out ?? row.checkOut);
    if (!checkIn || !checkOut) addIssue(issues, 'RESERVATION_DATE_INVALID', 'property_reservations', key, 'check_in/check_out 날짜가 유효하지 않습니다.');
    else if (checkOut <= checkIn) addIssue(issues, 'RESERVATION_DATE_ORDER', 'property_reservations', key, 'check_out은 check_in보다 뒤여야 합니다.');
    const status = text(row.status) || 'ACTIVE';
    if (!VALID_RESERVATION_STATUS_SET.has(status)) addIssue(issues, 'RESERVATION_STATUS_INVALID', 'property_reservations', key, `예약 상태가 잘못됐습니다: ${status}`);
    if (!hasValue(sourceSystemOf(row))) addIssue(issues, 'RESERVATION_SOURCE_REQUIRED', 'property_reservations', key, 'source_system이 없습니다.');
    if (!hasValue(sourceRefOf(row))) addIssue(issues, 'RESERVATION_TRACE_REQUIRED', 'property_reservations', key, 'source_ref가 없습니다.');
    if (row.raw_data == null) addWarning(warnings, 'RESERVATION_RAW_DATA_MISSING', 'property_reservations', key, '원본 raw_data가 없습니다.');
    if (property && originOf(row) !== originOf(property)) {
      addIssue(issues, 'RESERVATION_ORIGIN_MISMATCH', 'property_reservations', key, '예약과 숙소의 data_origin이 다릅니다.');
    }
  }

  for (const row of jobs) {
    const propertyId = propertyIdOf(row);
    const uid = reservationUidOf(row);
    const key = `${propertyId || '<missing>'}/${text(row.id) || text(row.checkout_at) || '<missing>'}`;
    const property = propertyIndex.get(propertyId);
    if (!property) addIssue(issues, 'JOB_PROPERTY_MISSING', 'cleaning_jobs', key, '청소작업의 숙소가 존재하지 않습니다.');
    const jobId = text(row.id);
    if (jobId && jobIndex.has(jobId)) addIssue(issues, 'JOB_ID_DUPLICATE', 'cleaning_jobs', key, '청소작업 id가 중복됩니다.');
    if (jobId) jobIndex.set(jobId, row);
    const checkout = asDate(row.checkout_at ?? row.checkoutAt);
    const start = asDate(row.cleaning_start_at ?? row.cleaningStartAt);
    const end = asDate(row.cleaning_end_at ?? row.cleaningEndAt);
    if (!checkout || !start) addIssue(issues, 'JOB_DATE_INVALID', 'cleaning_jobs', key, 'checkout_at/cleaning_start_at 날짜가 유효하지 않습니다.');
    else if (start < checkout) addIssue(issues, 'JOB_START_BEFORE_CHECKOUT', 'cleaning_jobs', key, '청소 시작은 체크아웃보다 빠를 수 없습니다.');
    if (end && start && end <= start) addIssue(issues, 'JOB_END_BEFORE_START', 'cleaning_jobs', key, 'cleaning_end_at은 시작 이후여야 합니다.');
    const jobKey = keyOf(propertyId, row.checkout_at ?? row.checkoutAt);
    if (jobKeyIndex.has(jobKey)) addIssue(issues, 'JOB_DUPLICATE_CHECKOUT', 'cleaning_jobs', key, '숙소·체크아웃 조합이 중복됩니다.');
    jobKeyIndex.set(jobKey, row);
    const status = text(row.status);
    if (!VALID_JOB_STATUS_SET.has(status)) addIssue(issues, 'JOB_STATUS_INVALID', 'cleaning_jobs', key, `청소작업 상태가 잘못됐습니다: ${status}`);
    const source = text(row.source);
    if (!VALID_JOB_SOURCE_SET.has(source)) addIssue(issues, 'JOB_SOURCE_INVALID', 'cleaning_jobs', key, `청소작업 source가 잘못됐습니다: ${source}`);
    if (!hasValue(sourceRefOf(row))) addIssue(issues, 'JOB_TRACE_REQUIRED', 'cleaning_jobs', key, 'source_ref가 없습니다.');
    const origin = originOf(row);
    if (property && origin !== originOf(property)) addIssue(issues, 'JOB_ORIGIN_MISMATCH', 'cleaning_jobs', key, '청소작업과 숙소의 data_origin이 다릅니다.');
    if (uid) {
      const reservation = reservationIndex.get(keyOf(propertyId, uid));
      if (!reservation) {
        const legacy = origin === DATA_ORIGINS.REAL && sourceRefOf(row).startsWith('legacy:');
        if (legacy && allowLegacyRealJobs) addWarning(warnings, 'REAL_LEGACY_RESERVATION_UNMATCHED', 'cleaning_jobs', key, '현재 예약 원본에 없는 레거시 REAL 작업입니다.');
        else addIssue(issues, 'JOB_RESERVATION_MISSING', 'cleaning_jobs', key, '청소작업의 예약 관계가 없습니다.');
      }
    } else if (origin === DATA_ORIGINS.SIMULATED) {
      addIssue(issues, 'SIMULATED_JOB_RESERVATION_REQUIRED', 'cleaning_jobs', key, 'SIMULATED 청소작업은 예약과 연결돼야 합니다.');
    } else {
      addWarning(warnings, 'REAL_LEGACY_JOB_UID_MISSING', 'cleaning_jobs', key, 'REAL 레거시 작업에 reservation_uid가 없습니다.');
    }
    if (hasValue(row.assigned_cleaner_id) && cleanerIndex.size && !cleanerIndex.has(text(row.assigned_cleaner_id))) {
      addIssue(issues, 'JOB_CLEANER_MISSING', 'cleaning_jobs', key, '청소작업의 assigned_cleaner_id가 cleaners에 없습니다.');
    }
    if (['ASSIGNED', 'COMPLETED'].includes(status) && !hasValue(row.assigned_cleaner_id) && !hasValue(row.google_event_id)) {
      addWarning(warnings, 'JOB_ASSIGNMENT_TRACE_MISSING', 'cleaning_jobs', key, '배정 완료 상태지만 담당자 또는 Google 이벤트 추적키가 없습니다.');
    }
  }

  for (const row of events) {
    const propertyId = propertyIdOf(row);
    const key = `${propertyId || '<missing>'}/${text(row.type) || '<missing>'}/${text(row.device_time) || '<missing>'}`;
    const property = propertyIndex.get(propertyId);
    if (!property) addIssue(issues, 'EVENT_PROPERTY_MISSING', 'events', key, '이벤트의 숙소가 존재하지 않습니다.');
    const eventId = text(row.id);
    if (eventId && eventIdIndex.has(eventId)) addIssue(issues, 'EVENT_ID_DUPLICATE', 'events', key, '이벤트 id가 중복됩니다.');
    if (eventId) eventIdIndex.set(eventId, row);
    const eventKey = keyOf(`${propertyId}/${text(row.type)}`, row.device_time);
    if (eventKeyIndex.has(eventKey)) addIssue(issues, 'EVENT_DUPLICATE', 'events', key, '숙소·이벤트 종류·device_time 조합이 중복됩니다.');
    eventKeyIndex.set(eventKey, row);
    if (!asDate(row.device_time)) addIssue(issues, 'EVENT_DATE_INVALID', 'events', key, 'device_time이 유효하지 않습니다.');
    if (!hasValue(text(row.type))) addIssue(issues, 'EVENT_TYPE_REQUIRED', 'events', key, '이벤트 type이 없습니다.');
    if (!hasValue(sourceSystemOf(row))) addIssue(issues, 'EVENT_SOURCE_REQUIRED', 'events', key, 'source_system이 없습니다.');
    if (!hasValue(sourceRefOf(row))) addIssue(issues, 'EVENT_TRACE_REQUIRED', 'events', key, 'source_ref가 없습니다.');
    if (property && originOf(row) !== originOf(property)) addIssue(issues, 'EVENT_ORIGIN_MISMATCH', 'events', key, '이벤트와 숙소의 data_origin이 다릅니다.');
  }

  for (const row of notifs) {
    const key = text(row.id) || `${text(row.job_id)}/${text(row.cleaner_id)}`;
    const jobId = text(row.job_id);
    const cleanerId = text(row.cleaner_id);
    if (!jobId) addIssue(issues, 'NOTIF_JOB_REQUIRED', 'cleaning_notifs', key, '알림의 job_id가 없습니다.');
    if (!cleanerId) addIssue(issues, 'NOTIF_CLEANER_REQUIRED', 'cleaning_notifs', key, '알림의 cleaner_id가 없습니다.');
    const job = jobId ? jobIndex.get(jobId) : null;
    if (jobId && !job) addIssue(issues, 'NOTIF_JOB_MISSING', 'cleaning_notifs', key, '알림의 청소작업이 없습니다.');
    if (cleanerId && cleanerIndex.size && !cleanerIndex.has(cleanerId)) addIssue(issues, 'NOTIF_CLEANER_MISSING', 'cleaning_notifs', key, '알림의 청소자가 없습니다.');
    if (job && originOf(row) !== originOf(job)) addIssue(issues, 'NOTIF_ORIGIN_MISMATCH', 'cleaning_notifs', key, '알림과 청소작업의 data_origin이 다릅니다.');
    const relationKey = keyOf(jobId, cleanerId);
    if (jobId && cleanerId && notifKeyIndex.has(relationKey)) addIssue(issues, 'NOTIF_DUPLICATE_RELATION', 'cleaning_notifs', key, '청소작업·청소자 조합이 중복됩니다.');
    if (jobId && cleanerId) notifKeyIndex.set(relationKey, row);
    const token = text(row.token);
    if (token && notifTokenIndex.has(token)) addIssue(issues, 'NOTIF_TOKEN_DUPLICATE', 'cleaning_notifs', key, '알림 token이 중복됩니다.');
    if (token) notifTokenIndex.set(token, row);
    // cleaning_notifs는 source_ref를 별도로 저장하지 않는다. job_id와 cleaner_id,
    // 그리고 job의 source_ref가 알림의 관계형 추적성을 구성한다.
  }

  for (const row of blockers) {
    const propertyId = propertyIdOf(row);
    const key = `${propertyId || '<missing>'}/${text(row.block_date)}`;
    const property = propertyIndex.get(propertyId);
    if (!property) addIssue(issues, 'BLOCKER_PROPERTY_MISSING', 'property_calendar_blockers', key, '블로커의 숙소가 존재하지 않습니다.');
    const blockerKey = keyOf(propertyId, row.block_date);
    if (blockerKeyIndex.has(blockerKey)) addIssue(issues, 'BLOCKER_DUPLICATE', 'property_calendar_blockers', key, '숙소·차단일 조합이 중복됩니다.');
    blockerKeyIndex.set(blockerKey, row);
    if (!hasValue(row.event_id)) addIssue(issues, 'BLOCKER_EVENT_REQUIRED', 'property_calendar_blockers', key, '블로커 event_id가 없습니다.');
    if (property && originOf(row) !== originOf(property)) addIssue(issues, 'BLOCKER_ORIGIN_MISMATCH', 'property_calendar_blockers', key, '블로커와 숙소의 data_origin이 다릅니다.');
  }

  const summary = {
    properties: properties.length,
    reservations: reservations.length,
    jobs: jobs.length,
    events: events.length,
    notifs: notifs.length,
    blockers: blockers.length,
    cleaners: cleaners.length,
    origins: {
      properties: countByOrigin(properties),
      reservations: countByOrigin(reservations),
      jobs: countByOrigin(jobs),
      events: countByOrigin(events),
      notifs: countByOrigin(notifs),
      blockers: countByOrigin(blockers),
    },
    errors: issues.length,
    warnings: warnings.length,
  };
  return {
    ok: issues.length === 0,
    strictOk: issues.length === 0 && warnings.length === 0,
    issues,
    warnings,
    summary,
  };
}

function deterministicNumber(value) {
  return [...String(value)].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) % 1_000_003, 7);
}

function keySuffix(index) {
  return index > 0 ? `:${index}` : '';
}

function generatedReservationUid(propertyId, checkIn, occurrence) {
  return `sim:${propertyId}:${iso(checkIn).replace(/[^0-9]/g, '')}${keySuffix(occurrence)}`;
}

function generatedEventId(propertyId, reservationUid, type) {
  return `sim:${type}:${propertyId}:${reservationUid.split(':').slice(2).join(':')}`;
}

function generatedStatus(propertyId, reservationUid, seed) {
  const bucket = deterministicNumber(`${seed}|${propertyId}|${reservationUid}`) % 20;
  if (bucket < 12) return 'ASSIGNED';
  if (bucket < 17) return 'PENDING';
  if (bucket < 19) return 'ESCALATED';
  return 'CANCELLED';
}

/**
 * 기존 roomState fixture 또는 동일한 shape의 숙소 정의를 정규 DB 행 집합으로 변환한다.
 * 결과는 seed script와 오프라인 검수기가 공유하므로 생성·저장·검수 계약이 갈라지지 않는다.
 */
export function buildSimulatedDataset(properties = [], options = {}) {
  const sourceRef = options.sourceRef || 'src/data/roomStateMockData.js';
  const seed = options.seed || 'propos-simulator-v1';
  const rows = { properties: [], reservations: [], jobs: [], events: [], notifs: [], blockers: [], cleaners: [] };
  for (const property of asArray(properties)) {
    const propertyId = propertyIdOf(property);
    if (!propertyId) continue;
    rows.properties.push({
      property_id: propertyId,
      name: text(property.name) || propertyId,
      checkout_hour: Number(property.checkOutHour ?? property.checkout_hour ?? 11),
      cleaning_duration_hours: Number(property.cleaningDurationHours ?? property.cleaning_duration_hours ?? 2.5),
      data_origin: DATA_ORIGINS.SIMULATED,
      source_system: 'SIMULATED_FIXTURE',
      source_ref: sourceRef,
    });
    const occurrences = new Map();
    for (const reservation of asArray(property.reservations)) {
      const checkIn = iso(reservation.checkIn ?? reservation.check_in);
      const checkOut = iso(reservation.checkOut ?? reservation.check_out);
      const occurrence = occurrences.get(checkIn) || 0;
      occurrences.set(checkIn, occurrence + 1);
      const uid = generatedReservationUid(propertyId, checkIn, occurrence);
      const status = generatedStatus(propertyId, uid, seed);
      const durationHours = Number(property.cleaningDurationHours ?? property.cleaning_duration_hours ?? 2.5);
      rows.reservations.push({
        property_id: propertyId,
        reservation_uid: uid,
        guest_name: reservation.guestName ?? reservation.guest_name ?? null,
        platform: reservation.platform ?? 'Airbnb',
        check_in: checkIn,
        check_out: checkOut,
        status: 'ACTIVE',
        source_system: 'SIMULATED_FIXTURE',
        source_ref: sourceRef,
        raw_data: reservation,
        data_origin: DATA_ORIGINS.SIMULATED,
      });
      const cleaningEnd = new Date(new Date(checkOut).getTime() + durationHours * 3_600_000).toISOString();
      rows.jobs.push({
        property_id: propertyId,
        reservation_uid: uid,
        checkout_at: checkOut,
        cleaning_start_at: checkOut,
        cleaning_end_at: cleaningEnd,
        status,
        source: 'MONTHLY_BATCH',
        source_ref: uid,
        google_event_id: status === 'ASSIGNED' ? generatedEventId(propertyId, uid, 'calendar') : null,
        data_origin: DATA_ORIGINS.SIMULATED,
      });
      rows.events.push(
        { id: generatedEventId(propertyId, uid, 'checkin'), property_id: propertyId, type: 'check_in_detected', device_time: checkIn, source_ref: uid, data: reservation, source_system: 'SIMULATED_FIXTURE', data_origin: DATA_ORIGINS.SIMULATED, status: 'complete' },
        { id: generatedEventId(propertyId, uid, 'checkout'), property_id: propertyId, type: 'check_out_detected', device_time: checkOut, source_ref: uid, data: reservation, source_system: 'SIMULATED_FIXTURE', data_origin: DATA_ORIGINS.SIMULATED, status: 'complete' },
      );
      if (status === 'ASSIGNED' || status === 'COMPLETED') {
        rows.events.push({
          id: generatedEventId(propertyId, uid, 'cleaning'),
          property_id: propertyId,
          type: 'cleaning_finished',
          device_time: cleaningEnd,
          source_ref: uid,
          data: { reservation_uid: uid, simulated: true },
          source_system: 'SIMULATED_FIXTURE',
          data_origin: DATA_ORIGINS.SIMULATED,
          status: 'complete',
        });
      }
    }
  }
  return rows;
}

export function generateSyntheticProperties(options = {}) {
  const count = Math.max(1, Number(options.propertyCount ?? 5));
  const reservationsPerProperty = Math.max(1, Number(options.reservationsPerProperty ?? 8));
  const start = asDate(options.startDate) || new Date();
  const properties = [];
  for (let propertyIndex = 0; propertyIndex < count; propertyIndex += 1) {
    const propertyId = `SIM_${String(propertyIndex + 1).padStart(3, '0')}`;
    const reservations = [];
    for (let reservationIndex = 0; reservationIndex < reservationsPerProperty; reservationIndex += 1) {
      const checkIn = new Date(start.getTime() + (propertyIndex * 2 + reservationIndex * 4) * 86_400_000);
      const nights = 1 + ((propertyIndex + reservationIndex) % 6);
      const checkOut = new Date(checkIn.getTime() + nights * 86_400_000);
      reservations.push({
        guestName: `시뮬레이션 게스트 ${propertyIndex + 1}-${reservationIndex + 1}`,
        platform: ['Airbnb', '야놀자', '여기어때'][reservationIndex % 3],
        checkIn,
        checkOut,
      });
    }
    properties.push({
      id: propertyId,
      name: `시뮬레이션 숙소 ${propertyIndex + 1}`,
      checkOutHour: 11,
      cleaningDurationHours: 2 + (propertyIndex % 2) * 0.5,
      reservations,
    });
  }
  return properties;
}
