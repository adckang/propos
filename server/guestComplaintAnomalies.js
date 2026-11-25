/** RF-25 다섯 번째 정본 감지기 — Gmail 게스트 온습도 불만 + 60분 내 센서 이상. */
import { extractAirbnbListingId } from '../src/domain/guestComplaintEmailDomain.js';
import { ENVIRONMENT_SENSOR_DETECTION_MINUTES } from '../src/application/environmentSensorAnomalyDetector.js';
import {
  buildAnomalyIncidentKey,
  confirmAnomalyStabilized,
  endAnomaly,
  markAnomalyConditionCleared,
  openAnomaly,
} from './anomalyRepository.js';

export const GUEST_SENSOR_MATCH_MINUTES = 60;
const MATCH_MS = GUEST_SENSOR_MATCH_MINUTES * 60_000;
const NORMAL_RECHECK_MS = 10 * 60_000;
const TOPICS = new Set(['temperature', 'humidity']);
const TOPIC_LABEL = { temperature: '온도', humidity: '습도' };

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}이 필요합니다`);
  return value.trim();
}

function iso(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} 시각이 올바르지 않습니다`);
  return new Date(time).toISOString();
}

function topics(value) {
  if (!Array.isArray(value)) throw new Error('온습도 주제가 올바르지 않습니다');
  const result = [...new Set(value.filter(topic => TOPICS.has(topic)))];
  if (!result.length) throw new Error('온습도 주제가 없습니다');
  return result;
}

function criterion(topic, stabilizationMinutes) {
  const resolution = Number(stabilizationMinutes) === 0
    ? '해결 확인: 즉시'
    : `정상 ${Number(stabilizationMinutes)}분 유지 시 해결`;
  return `게스트 ${TOPIC_LABEL[topic]} 불만 + 온습도 이상 · 기준: 메시지 전후 ${GUEST_SENSOR_MATCH_MINUTES}분 이내 · ${resolution}`;
}

function incidentKey(propertyId, stayId, topic) {
  return buildAnomalyIncidentKey({ type: 'guest_complaint_sensor', propertyId, stayId, targetRef: topic });
}

async function realPropertyForRoom(db, roomId) {
  const { rows } = await db.query(
    `SELECT property_id,ical_url FROM property_cleaning_config
      WHERE data_origin='REAL' AND ical_url IS NOT NULL`,
  );
  const matched = rows.filter(row => extractAirbnbListingId(row.ical_url) === roomId);
  return matched.length === 1 ? matched[0].property_id : null;
}

async function stayAt(db, propertyId, occurredAt) {
  const { rows } = await db.query(
    `SELECT stay_id FROM property_reservations
      WHERE property_id=$1 AND data_origin='REAL' AND status='ACTIVE' AND stay_id IS NOT NULL
        AND check_in<=$2 AND check_out>$2
      ORDER BY check_in DESC`,
    [propertyId, occurredAt],
  );
  return rows.length === 1 ? rows[0].stay_id : null;
}

async function openPair(pool, { propertyId, stayId, topic, messageId, messageAt, eventId, sensorAt }) {
  const occurredAt = new Date(Math.max(Date.parse(messageAt), Date.parse(sensorAt))).toISOString();
  const source = `gmail-sensor:${messageId}:${topic}:${eventId}`;
  const opened = await openAnomaly(pool, {
    propertyId, type: 'guest_complaint_sensor', stayId, targetRef: topic,
    sourceType: 'gmail_sensor_pair', sourceRef: source, sourceEventKey: source, occurredAt,
  });
  return {
    opened: opened.created,
    resumed: opened.resumed,
    anomalyId: opened.anomaly.id,
    alertLabel: opened.created || opened.resumed
      ? criterion(topic, opened.anomaly.stabilization_minutes)
      : null,
  };
}

async function nearestSensorEvent(db, signal) {
  const from = new Date(Date.parse(signal.occurred_at) - MATCH_MS).toISOString();
  const to = new Date(Date.parse(signal.occurred_at) + MATCH_MS).toISOString();
  const { rows } = await db.query(
    `SELECT id,device_time,data FROM events
      WHERE property_id=$1 AND type='environment_sensor_anomaly' AND device_time BETWEEN $2 AND $3
      ORDER BY ABS(EXTRACT(EPOCH FROM (device_time-$4::timestamptz))),device_time,id`,
    [signal.property_id, from, to, signal.occurred_at],
  );
  return rows.find(row => Array.isArray(row.data?.topics)
    && row.data.topics.includes(signal.topic)
    && typeof row.data?.stayId === 'string') ?? null;
}

async function replayNormalEvents(pool, { propertyId, stayId, topic, after, until }) {
  const { rows } = await pool.query(
    `SELECT id,device_time,data FROM events
      WHERE property_id=$1 AND type='environment_sensor_normal' AND device_time>$2 AND device_time<=$3
      ORDER BY device_time,id`,
    [propertyId, after, until],
  );
  let result = null;
  for (const row of rows) {
    if (!Array.isArray(row.data?.topics) || !row.data.topics.includes(topic) || row.data?.stayId !== stayId) continue;
    result = await reconcileNormalTopic(pool, {
      eventId: row.id, propertyId, stayId, topic, observedAt: new Date(row.device_time).toISOString(), data: row.data,
    });
  }
  return result;
}

async function pairStoredSignal(pool, signal, until) {
  const event = await nearestSensorEvent(pool, signal);
  if (!event) return [];
  const stayId = required(event.data.stayId, '내부 숙박');
  const opened = await openPair(pool, {
    propertyId: signal.property_id, stayId, topic: signal.topic,
    messageId: signal.gmail_message_id, messageAt: new Date(signal.occurred_at).toISOString(),
    eventId: event.id, sensorAt: new Date(event.device_time).toISOString(),
  });
  await replayNormalEvents(pool, {
    propertyId: signal.property_id, stayId, topic: signal.topic,
    after: new Date(event.device_time).toISOString(), until,
  });
  return opened.alertLabel ? [opened.alertLabel] : [];
}

/** Gmail 원문 대신 분류된 주제만 저장하고, 이미 도착한 센서 신호와 교차 확인한다. */
export async function recordGuestComplaintEmail(pool, complaint, { now = new Date() } = {}) {
  const messageId = required(complaint?.gmailMessageId, 'Gmail 메시지');
  const roomId = required(complaint?.airbnbRoomId, 'Airbnb 숙소');
  const threadId = required(complaint?.airbnbThreadId, 'Airbnb 대화');
  const occurredAt = iso(complaint?.occurredAt, '게스트 메시지');
  const propertyId = await realPropertyForRoom(pool, roomId);
  if (!propertyId) return { recorded: 0, paired: 0, ignored: 'PROPERTY_NOT_MAPPED', alerts: [] };
  const stayId = await stayAt(pool, propertyId, occurredAt);
  const saved = [];
  for (const topic of topics(complaint?.topics)) {
    const { rows } = await pool.query(
      `INSERT INTO guest_complaint_signals
        (gmail_message_id,topic,property_id,stay_id,airbnb_room_id,airbnb_thread_id,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (gmail_message_id,topic) DO NOTHING RETURNING *`,
      [messageId, topic, propertyId, stayId, roomId, threadId, occurredAt],
    );
    const signal = rows[0] ?? (await pool.query(
      `SELECT * FROM guest_complaint_signals WHERE gmail_message_id=$1 AND topic=$2`, [messageId, topic],
    )).rows[0];
    if (signal) saved.push(signal);
  }
  const alerts = [];
  for (const signal of saved) alerts.push(...await pairStoredSignal(pool, signal, now.toISOString()));
  return { propertyId, recorded: saved.length, paired: alerts.length, alerts };
}

async function openExisting(pool, { propertyId, stayId, topic, eventId, occurredAt }) {
  const key = incidentKey(propertyId, stayId, topic);
  const { rows } = await pool.query(
    `SELECT a.id FROM automation_open_incidents oi JOIN automation_anomalies a ON a.id=oi.anomaly_id
      WHERE oi.incident_key=$1`, [key],
  );
  if (!rows.length) return null;
  return openAnomaly(pool, {
    propertyId, type: 'guest_complaint_sensor', stayId, targetRef: topic,
    sourceType: 'event', sourceRef: eventId,
    sourceEventKey: `guest-sensor-recurred:${eventId}:${topic}`, occurredAt,
  });
}

async function pairSensorEvent(pool, { eventId, propertyId, stayId, topic, occurredAt }) {
  const from = new Date(Date.parse(occurredAt) - MATCH_MS).toISOString();
  const to = new Date(Date.parse(occurredAt) + MATCH_MS).toISOString();
  const { rows } = await pool.query(
    `SELECT * FROM guest_complaint_signals
      WHERE property_id=$1 AND topic=$2 AND occurred_at BETWEEN $3 AND $4
      ORDER BY ABS(EXTRACT(EPOCH FROM (occurred_at-$5::timestamptz))),occurred_at,gmail_message_id`,
    [propertyId, topic, from, to, occurredAt],
  );
  if (!rows.length) return [];
  const opened = await openPair(pool, {
    propertyId, stayId, topic, messageId: rows[0].gmail_message_id,
    messageAt: new Date(rows[0].occurred_at).toISOString(), eventId, sensorAt: occurredAt,
  });
  return opened.alertLabel ? [opened.alertLabel] : [];
}

async function reconcileNormalTopic(pool, { eventId, propertyId, stayId, topic, observedAt, data }) {
  const normalStartedAt = iso(data?.normalStartedAtByTopic?.[topic], '온습도 정상 시작');
  const detectedAt = iso(data?.detectedAtByTopic?.[topic], '온습도 이상 감지');
  const key = incidentKey(propertyId, stayId, topic);
  const cleared = await markAnomalyConditionCleared(pool, {
    incidentKey: key,
    sourceEventKey: `guest-environment-normal-start:${eventId}:${topic}`,
    occurredAt: normalStartedAt,
    restartStabilization: data?.restartTopics?.includes(topic) === true,
  });
  const windowEndsAt = new Date(Date.parse(detectedAt) + MATCH_MS).toISOString();
  if (!cleared.found) {
    return Date.parse(observedAt) >= Date.parse(windowEndsAt)
      ? { complete: true, resolved: false }
      : { complete: false, resolved: false, eligibleAt: new Date(Math.min(Date.parse(windowEndsAt), Date.parse(observedAt) + NORMAL_RECHECK_MS)).toISOString() };
  }
  const confirmed = await confirmAnomalyStabilized(pool, {
    incidentKey: key, sourceEventKey: `guest-environment-normal-observed:${eventId}:${topic}`, observedAt,
  });
  if (!confirmed.resolved) return { complete: false, resolved: false, eligibleAt: confirmed.eligibleAt };
  if (Date.parse(observedAt) >= Date.parse(windowEndsAt)) return { complete: true, resolved: true };
  return { complete: false, resolved: true,
    eligibleAt: new Date(Math.min(Date.parse(windowEndsAt), Date.parse(observedAt) + NORMAL_RECHECK_MS)).toISOString() };
}

export async function reconcileGuestComplaintSensorSignal(pool, input) {
  const eventId = required(input?.eventId, '이벤트');
  const propertyId = required(input?.propertyId, '숙소');
  const type = required(input?.type, '이벤트 유형');
  const observedAt = iso(input?.occurredAt, '관측');
  const data = input?.data ?? {};
  const stayId = required(data.stayId, '내부 숙박');
  const signalTopics = topics(data.topics);
  if (Number(data.detectionMinutes) !== ENVIRONMENT_SENSOR_DETECTION_MINUTES && type !== 'environment_sensor_tracking_ended') {
    throw new Error('온습도 감지 기준이 올바르지 않습니다');
  }

  if (type === 'environment_sensor_anomaly') {
    const alerts = [];
    for (const topic of signalTopics) {
      const existing = await openExisting(pool, { propertyId, stayId, topic, eventId, occurredAt: observedAt });
      if (existing?.resumed) alerts.push(criterion(topic, existing.anomaly.stabilization_minutes));
      alerts.push(...await pairSensorEvent(pool, { eventId, propertyId, stayId, topic, occurredAt: observedAt }));
    }
    return { complete: false, alerts, alertLabel: alerts.length ? alerts.join(' / ') : null };
  }

  if (type === 'environment_sensor_normal') {
    const results = {};
    for (const topic of signalTopics) {
      results[topic] = await reconcileNormalTopic(pool, { eventId, propertyId, stayId, topic, observedAt, data });
    }
    return { complete: Object.values(results).every(result => result.complete), results };
  }

  if (type === 'environment_sensor_tracking_ended') {
    const results = {};
    for (const topic of signalTopics) {
      results[topic] = await endAnomaly(pool, {
        incidentKey: incidentKey(propertyId, stayId, topic), state: 'UNRESOLVED_ENDED',
        sourceEventKey: `guest-environment-stay-ended:${eventId}:${topic}`, occurredAt: observedAt,
        details: { reason: 'STAY_ENDED' },
      });
    }
    return { complete: true, results };
  }

  throw new Error(`알 수 없는 게스트 불만 센서 신호: ${type}`);
}
