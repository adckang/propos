// Durable record for a cleaner's first VIP request. External calls never run
// inside a DB transaction. Existing untracked notification rows stay legacy.
import { randomUUID } from 'node:crypto';

const RETRY_LIMIT = 3;
const IN_FLIGHT_MS = 120_000;
function storageError(error) {
  // PostgreSQL DETAIL can contain the entire private request snapshot.
  if (!error.severity) return error;
  return Object.assign(new Error('INITIAL_DELIVERY_STORAGE_FAILED'), {
    code: error.code, constraint: error.constraint,
  });
}
async function transaction(pool, fn) {
  const client = await pool.connect();
  let discardConnection;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { discardConnection = rollbackError; }
    throw storageError(error);
  } finally { client.release(discardConnection); }
}

const trackedColumns = 'id, token, initial_delivery_state, initial_delivery_data, initial_accepted_at';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomToken() {
  return Array.from({ length: 6 }, () => TOKEN_CHARS[Math.floor(Math.random() * 36)]).join('');
}

export async function createNotif(db, { jobId, cleanerId, tier, dataOrigin = 'REAL', initialDelivery }) {
  const columns = initialDelivery ? trackedColumns : 'id, token';
  const existing = async () => (await db.query(
    `SELECT ${columns} FROM cleaning_notifs WHERE job_id=$1 AND cleaner_id=$2`, [jobId, cleanerId]
  )).rows[0];
  const found = await existing();
  if (found) return found;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const token = randomToken();
      const saved = initialDelivery && { ...initialDelivery,
        payload: typeof initialDelivery.payload === 'function' ? initialDelivery.payload({ token }) : initialDelivery.payload };
      const { rows } = await db.query(initialDelivery
        ? `INSERT INTO cleaning_notifs (job_id, cleaner_id, tier, token, data_origin, initial_delivery_state, initial_delivery_data)
           VALUES ($1,$2,$3,$4,$5,'READY',$6::jsonb) ON CONFLICT DO NOTHING RETURNING ${columns}`
        : `INSERT INTO cleaning_notifs (job_id, cleaner_id, tier, token, data_origin)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING ${columns}`,
      [jobId, cleanerId, tier, token, dataOrigin, ...(initialDelivery ? [JSON.stringify(saved)] : [])]);
      if (rows.length) return rows[0];
      // ON CONFLICT keeps the transaction usable for both unique constraints.
      const collided = await existing();
      if (collided) return collided;
    } catch (error) {
      if (error.code !== '23505') throw error;
      if (error.constraint === 'cleaning_notifs_job_id_cleaner_id_key') {
        const collided = await existing();
        if (collided) return collided;
        throw error;
      }
      if (error.constraint && error.constraint !== 'cleaning_notifs_token_key') throw error;
    }
  }
  throw new Error(`토큰 생성 실패 (job=${jobId}, cleaner=${cleanerId})`);
}

function stopped(state, errorCode) { return { state, ok: false, errorCode }; }
export async function prepareInitialDelivery(pool, { job, cleaner, nextStatus, payload }) {
  return transaction(pool, async client => {
    const { rows: [current] } = await client.query(
      `SELECT j.*, p.data_origin AS property_data_origin, p.name AS property_name,
        p.google_calendar_booking_url AS booking_url, p.host_phone AS host_phone FROM cleaning_jobs j
       JOIN property_cleaning_config p ON p.property_id=j.property_id WHERE j.id=$1 FOR UPDATE OF j,p`, [job.id]);
    if (!current || current.data_origin !== 'REAL' || current.property_data_origin !== 'REAL') return stopped('CANCELLED', 'DELIVERY_NOT_REAL');
    if (['CANCELLED','ASSIGNED','COMPLETED','ESCALATED'].includes(current.status)) return stopped('CANCELLED', 'JOB_NO_LONGER_REQUESTING');
    if (current.status !== job.status) return stopped('STALE', 'JOB_STATE_CHANGED');
    if (current.property_id !== job.property_id) return stopped('STALE', 'JOB_PROPERTY_CHANGED');
    const { rows: [saved] } = await client.query(`SELECT ${trackedColumns} FROM cleaning_notifs WHERE job_id=$1 AND cleaner_id=$2`, [job.id, cleaner.id]);
    if (saved?.initial_delivery_state === 'SENDING') {
      if (Date.now() - Date.parse(saved.initial_delivery_data.attemptedAt) < IN_FLIGHT_MS) return { ...saved, state: 'SENDING', ok: false };
      await client.query(`UPDATE cleaning_notifs SET initial_delivery_state='UNKNOWN',
        initial_delivery_data=initial_delivery_data || $2::jsonb WHERE id=$1 AND initial_delivery_state='SENDING'`,
      [saved.id, JSON.stringify({ errorCode: 'DELIVERY_OUTCOME_NOT_RECORDED' })]);
      return stopped('UNKNOWN', 'DELIVERY_OUTCOME_NOT_RECORDED');
    }
    if (saved?.initial_delivery_state && (saved.initial_delivery_data.propertyId !== current.property_id ||
        Date.parse(saved.initial_delivery_data.checkoutAt) !== new Date(current.checkout_at).getTime() ||
        Date.parse(saved.initial_delivery_data.cleaningStartAt) !== new Date(current.cleaning_start_at).getTime())) {
      if (['READY','RETRYABLE'].includes(saved.initial_delivery_state)) await client.query(
        `UPDATE cleaning_notifs SET initial_delivery_state='FAILED', initial_delivery_data=initial_delivery_data || $2::jsonb WHERE id=$1`,
        [saved.id, JSON.stringify({ errorCode: 'JOB_SCHEDULE_CHANGED' })]);
      return stopped('STALE', 'JOB_SCHEDULE_CHANGED');
    }
    if (saved?.initial_delivery_state === 'ACCEPTED') return { ...saved, state: 'ACCEPTED', ok: true };
    if (saved && !saved.initial_delivery_state) return stopped('LEGACY', 'LEGACY_DELIVERY_UNCONFIRMED');
    if (saved && !['READY','RETRYABLE'].includes(saved.initial_delivery_state)) return stopped(saved.initial_delivery_state, saved.initial_delivery_data?.errorCode ?? saved.initial_delivery_data?.result?.errorCode);
    const { rows: [recipient] } = await client.query('SELECT * FROM cleaners WHERE id=$1 FOR UPDATE', [cleaner.id]);
    if (!recipient?.active || recipient.tier !== cleaner.tier) {
      if (saved) await client.query(`UPDATE cleaning_notifs SET initial_delivery_state='FAILED',
        initial_delivery_data=initial_delivery_data || $2::jsonb WHERE id=$1`, [saved.id, JSON.stringify({ errorCode: 'RECIPIENT_CHANGED' })]);
      return stopped('FAILED', 'RECIPIENT_CHANGED');
    }
    const { rows: busy } = await client.query(
      `SELECT 1 FROM cleaning_jobs j JOIN cleaning_notifs n ON n.job_id=j.id
       WHERE n.cleaner_id=$1 AND j.checkout_at::date=$2::date
       AND j.status NOT IN ('ASSIGNED','COMPLETED','ESCALATED','CANCELLED') AND j.id!=$3 LIMIT 1`,
    [cleaner.id, new Date(current.checkout_at).toISOString().slice(0,10), current.id]);
    if (busy.length) return stopped('FAILED', 'RECIPIENT_UNAVAILABLE');
    const snapshot = { kind: 'INITIAL_REQUEST', expectedStatus: current.status, nextStatus,
      propertyId: current.property_id, checkoutAt: current.checkout_at, cleaningStartAt: current.cleaning_start_at,
      attempts: 0, cleaner: { id: recipient.id, name: recipient.name, tier: recipient.tier,
        active: recipient.active, phone: recipient.phone, fcm_token: recipient.fcm_token, fcm_status: recipient.fcm_status },
      payload: typeof payload === 'function' ? n => payload(n, current) : payload };
    const notif = saved ?? await createNotif(client, { jobId: current.id, cleanerId: recipient.id, tier: recipient.tier,
      dataOrigin: current.data_origin, initialDelivery: snapshot });
    const data = notif.initial_delivery_data;
    if (!notif.initial_delivery_state) return stopped('LEGACY', 'LEGACY_DELIVERY_UNCONFIRMED');
    if (notif.initial_delivery_state === 'ACCEPTED') return { ...notif, state: 'ACCEPTED', ok: true };
    if (!['READY','RETRYABLE'].includes(notif.initial_delivery_state)) return stopped(notif.initial_delivery_state, data?.result?.errorCode);
    if (data.nextAttemptAt && Date.parse(data.nextAttemptAt) > Date.now()) return stopped('RETRYABLE', 'DELIVERY_RETRY_NOT_DUE');
    if (data.attempts >= RETRY_LIMIT) return stopped('FAILED', 'DELIVERY_RETRY_LIMIT');
    // Keep the original recipient/body; never silently change a saved request.
    const fallbackStatus = { UNREGISTERED: 'unregistered', INVALID_ARGUMENT: 'invalid' }[data.result?.fcmFailureCode];
    const verifiedFallback = data.result?.attemptedChannel === 'SMS_FALLBACK' && fallbackStatus === recipient.fcm_status;
    if (recipient.phone !== data.cleaner.phone || recipient.fcm_token !== data.cleaner.fcm_token ||
        (recipient.fcm_status !== data.cleaner.fcm_status && !verifiedFallback)) {
      await client.query(`UPDATE cleaning_notifs SET initial_delivery_state='FAILED',
        initial_delivery_data=initial_delivery_data || $2::jsonb WHERE id=$1`, [notif.id, JSON.stringify({ errorCode: 'RECIPIENT_CHANGED' })]);
      return stopped('FAILED', 'RECIPIENT_CHANGED');
    }
    const attempt = { ...data, cleaner: { ...data.cleaner, fcm_status: recipient.fcm_status },
      attemptId: randomUUID(), attempts: data.attempts + 1, attemptedAt: new Date().toISOString() };
    const { rows: [claimed] } = await client.query(`UPDATE cleaning_notifs SET initial_delivery_state='SENDING', initial_delivery_data=$2::jsonb
      WHERE id=$1 AND initial_delivery_state IN ('READY','RETRYABLE') RETURNING ${trackedColumns}`, [notif.id, JSON.stringify(attempt)]);
    return claimed ? { ...claimed, state: 'CLAIMED', ok: false } : stopped('SENDING', 'DELIVERY_ALREADY_CLAIMED');
  });
}

export async function maySendInitialDelivery(pool, notif) {
  const { rows } = await pool.query(`SELECT n.id FROM cleaning_notifs n JOIN cleaning_jobs j ON j.id=n.job_id
    JOIN property_cleaning_config p ON p.property_id=j.property_id JOIN cleaners c ON c.id=n.cleaner_id
    WHERE n.id=$1 AND n.initial_delivery_state='SENDING' AND n.initial_delivery_data->>'attemptId'=$2
      AND j.status=n.initial_delivery_data->>'expectedStatus' AND j.data_origin='REAL' AND p.data_origin='REAL'
      AND j.property_id=n.initial_delivery_data->>'propertyId'
      AND j.checkout_at=(n.initial_delivery_data->>'checkoutAt')::timestamptz
      AND j.cleaning_start_at=(n.initial_delivery_data->>'cleaningStartAt')::timestamptz
      AND c.active=true AND c.tier=n.tier AND c.phone IS NOT DISTINCT FROM n.initial_delivery_data->'cleaner'->>'phone'
      AND c.fcm_token IS NOT DISTINCT FROM n.initial_delivery_data->'cleaner'->>'fcm_token'
      AND c.fcm_status IS NOT DISTINCT FROM n.initial_delivery_data->'cleaner'->>'fcm_status'`,
  [notif.id, notif.initial_delivery_data.attemptId]);
  return rows.length > 0;
}

export async function recordInitialResult(pool, notif, result) {
  const acceptedAt = result.outcome === 'ACCEPTED' ? new Date().toISOString() : null;
  const retryable = result.outcome === 'RETRYABLE' && notif.initial_delivery_data.attempts < RETRY_LIMIT;
  const state = result.outcome === 'RETRYABLE' && !retryable ? 'FAILED' : result.outcome;
  const delay = Math.max(60_000 * notif.initial_delivery_data.attempts, result.retryAfterMs ?? 0);
  const details = { result, results: [...(notif.initial_delivery_data.results ?? []), {
    ...result, attemptId: notif.initial_delivery_data.attemptId, recordedAt: new Date().toISOString(),
  }].slice(-RETRY_LIMIT), ...(retryable ? { nextAttemptAt: new Date(Date.now() + delay).toISOString() } : {}) };
  // A failed projection is recoverable from this durable receipt. A failed
  // receipt must never be "repaired" by sending the external action again.
  let error;
  for (let i = 0; i < 2; i++) {
    try {
      const { rows } = await pool.query(`UPDATE cleaning_notifs SET initial_delivery_state=$3,
        initial_delivery_data=initial_delivery_data || $4::jsonb, initial_accepted_at=$5,
        channel=CASE WHEN $3='ACCEPTED' THEN $6 ELSE channel END
        WHERE id=$1 AND initial_delivery_data->>'attemptId'=$2
          AND initial_delivery_state IN ('SENDING','UNKNOWN') RETURNING ${trackedColumns}`,
      [notif.id, notif.initial_delivery_data.attemptId, state, JSON.stringify(details), acceptedAt, result.channel === 'NONE' ? null : result.channel]);
      if (!rows.length) throw new Error('DELIVERY_RECEIPT_OWNERSHIP_CHANGED');
      return { ...rows[0], state, ok: state === 'ACCEPTED', errorCode: result.errorCode };
    } catch (caught) { error = caught; }
  }
  throw storageError(error);
}

export async function projectAcceptedDelivery(pool, notif) {
  const { rows } = await pool.query(`UPDATE cleaning_jobs SET status=$2, updated_at=NOW()
    WHERE id=(SELECT job_id FROM cleaning_notifs WHERE id=$1 AND initial_delivery_state='ACCEPTED')
      AND status=$3 AND data_origin='REAL'
      AND property_id=$4 AND checkout_at=$5 AND cleaning_start_at=$6
      AND EXISTS (SELECT 1 FROM property_cleaning_config p WHERE p.property_id=cleaning_jobs.property_id AND p.data_origin='REAL')
    RETURNING id`, [notif.id, notif.initial_delivery_data.nextStatus, notif.initial_delivery_data.expectedStatus,
      notif.initial_delivery_data.propertyId, notif.initial_delivery_data.checkoutAt, notif.initial_delivery_data.cleaningStartAt]);
  return { ok: true, state: 'ACCEPTED', jobAdvanced: rows.length > 0 };
}

export async function findInitialDelivery(pool, job) {
  const { rows: [row] } = await pool.query(`SELECT ${trackedColumns} FROM cleaning_notifs
    WHERE job_id=$1 AND initial_delivery_state IS NOT NULL AND initial_delivery_data->>'expectedStatus'=$2
    ORDER BY sent_at DESC LIMIT 1`, [job.id, job.status]);
  return row;
}

export function getVipFollowupJobs(pool) {
  return pool.query(`SELECT j.*, n.response_started_at AS notif_sent_at FROM cleaning_jobs j
    JOIN LATERAL (
      SELECT CASE WHEN c.initial_delivery_state IS NULL THEN c.sent_at
        WHEN c.initial_delivery_state='ACCEPTED' THEN c.initial_accepted_at END AS response_started_at
      FROM cleaning_notifs c WHERE c.job_id=j.id ORDER BY c.sent_at DESC LIMIT 1
    ) n ON true
    WHERE j.data_origin='REAL' AND j.status IN ('NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3')
      AND n.response_started_at < NOW() - INTERVAL '1 hour'`);
}

export function getInitialRecoveryJobs(pool) {
  return pool.query(`SELECT DISTINCT j.* FROM cleaning_jobs j JOIN cleaning_notifs n ON n.job_id=j.id
    JOIN property_cleaning_config p ON p.property_id=j.property_id
    WHERE j.data_origin='REAL' AND p.data_origin='REAL'
      AND j.status=n.initial_delivery_data->>'expectedStatus'
      AND (n.initial_delivery_state='READY'
        OR (n.initial_delivery_state='ACCEPTED' AND j.property_id=n.initial_delivery_data->>'propertyId'
          AND j.checkout_at=(n.initial_delivery_data->>'checkoutAt')::timestamptz
          AND j.cleaning_start_at=(n.initial_delivery_data->>'cleaningStartAt')::timestamptz)
        OR (n.initial_delivery_state='RETRYABLE' AND (n.initial_delivery_data->>'nextAttemptAt')::timestamptz<=NOW())
        OR (n.initial_delivery_state='SENDING' AND (n.initial_delivery_data->>'attemptedAt')::timestamptz<NOW()-INTERVAL '2 minutes'))
    ORDER BY j.dispatch_after LIMIT 20`);
}
