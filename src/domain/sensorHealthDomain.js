/**
 * 감지 센서 사전 점검 (DEC-12) — 알림은 필요할 때 보낸다.
 *
 * 입실·퇴실 확인(SensorEventGenerator)은 숙소 구역의 문(door)·움직임(motion) 센서만 읽는다. 둘 중 하나라도 꺼지면 확인이 멈춘다.
 * 그래서 시간 간격으로 반복해 알리지 않고, 그 센서가 필요해지기 전에 — 퇴실·입실 **하루 전·2시간 전** — 미리 점검해
 * 꺼져 있으면 운영자에게 알린다(시작 시각과 무관하게 같은 규칙). 퇴실·입실 그 시각에도 꺼져 있으면 확인 불가 문제로 남기는 것은
 * SuspicionTracker가 한다.
 *
 * - 꺼짐 = HA 상태 unavailable(기기에 닿지 못함). unknown은 넣지 않는다 — 값이 바뀔 때만 보고하는 센서는 HA 재시작 뒤 한동안
 *   unknown이지만 고장이 아니다. 숙소 구역에 문·움직임 센서가 아예 없어도 확인할 수 없으므로 꺼짐으로 본다.
 * - 점검은 (단계, 시각, 몇 시간 전)마다 한 번. 워처가 꺼져 있다 켜져 두 점검 시각이 모두 지났으면 늦은 쪽(2시간 전)만 한다.
 */
export const DETECTION_SENSOR_CLASSES = Object.freeze({ door: '문 센서', motion: '움직임 센서' });
export const PRECHECK_OFFSETS = Object.freeze([
  { key: 'd1', label: '하루 전', ms: 24 * 3_600_000 },
  { key: 'h2', label: '2시간 전', ms: 2 * 3_600_000 },
]);
const OFF_STATE = 'unavailable';
const PHASE_LABEL = Object.freeze({ checkout: '퇴실', checkin: '입실', cleaning: '청소' });
const DONE_KEEP_MS = 3 * 24 * 3_600_000;

const timeOf = value => {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};

/** 숙소 구역 상태 중 감지 센서만 — { entityId, role, roleLabel, name, state } */
export function detectionSensors(stateMap = {}) {
  const sensors = [];
  for (const [entityId, state] of Object.entries(stateMap ?? {})) {
    if (!state || entityId.split('.')[0] !== 'binary_sensor') continue;
    const role = state.attributes?.device_class;
    if (!Object.hasOwn(DETECTION_SENSOR_CLASSES, role)) continue;
    sensors.push({ entityId, role, roleLabel: DETECTION_SENSOR_CLASSES[role], name: state.attributes?.friendly_name || entityId, state: state.state });
  }
  return sensors.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}

/**
 * 지금 꺼져 있는 감지 센서. 구역 상태를 아직 못 읽었으면(빈 목록) 판단하지 않고 [] —
 * 읽었는데 문·움직임 센서가 하나도 없으면 "센서 없음" 한 항목.
 */
export function offDetectionSensors(stateMap = {}) {
  if (!stateMap || Object.keys(stateMap).length === 0) return [];
  const sensors = detectionSensors(stateMap);
  if (sensors.length === 0) return [{ entityId: null, role: null, roleLabel: '감지 센서', name: '문·움직임 센서 없음' }];
  return sensors.filter(sensor => sensor.state === OFF_STATE).map(({ state, ...sensor }) => sensor);
}

/** 앞으로의 퇴실·입실 시각 — 지금 예약과 체류 중 미뤄 둔 다음 예약에서 */
export function upcomingTimes(reservations, now) {
  const times = new Map();
  for (const reservation of reservations) {
    if (!reservation) continue;
    for (const [phase, field] of [['checkout', 'checkOut'], ['checkin', 'checkIn']]) {
      const at = timeOf(reservation[field]);
      if (at != null && at > now) times.set(`${phase}|${new Date(at).toISOString()}`, { phase, at });
    }
  }
  return [...times.values()].sort((a, b) => a.at - b.at);
}

/**
 * 지금 해야 할 사전 점검. 같은 시각의 점검이 여럿 지났으면 늦은 것 하나만 돌려주고 나머지는 한 것으로 표시한다.
 * @returns {{ due: { key, phase, at, offsetLabel }[], done: Record<string, number> }}
 */
export function duePrechecks({ times, done = {}, now }) {
  const nextDone = {};
  for (const [key, at] of Object.entries(done ?? {})) if (Number.isFinite(at) && now - at < DONE_KEEP_MS) nextDone[key] = at;
  const due = [];
  for (const { phase, at } of times) {
    const reached = PRECHECK_OFFSETS.filter(offset => now >= at - offset.ms && now < at);
    if (!reached.length) continue;
    const base = `${phase}|${new Date(at).toISOString()}`;
    const pending = reached.filter(offset => !Object.hasOwn(nextDone, `${base}|${offset.key}`));
    if (!pending.length) continue;
    for (const offset of reached) nextDone[`${base}|${offset.key}`] = at;
    const latest = pending.at(-1);
    due.push({ key: `${base}|${latest.key}`, phase, at, offsetLabel: latest.label, checkAt: at - latest.ms });
  }
  return { due, done: nextDone };
}

/**
 * 사전 점검 기록의 발생 시각 = 그 점검을 해야 했던 시각(+점검마다 고정된 0~999ms). 같은 주기에 두 점검이 나와도
 * DB의 (숙소, 종류, 발생 시각) 중복 방지에 걸리지 않고, 다시 보내도 같은 시각이다.
 */
export function precheckEventTime(check) {
  let hash = 2166136261;
  for (const ch of check.key) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return check.checkAt + ((hash >>> 0) % 1000);
}

const kstLabel = at => {
  const kst = new Date(at + 9 * 3_600_000);
  const p = n => String(n).padStart(2, '0');
  return `${p(kst.getUTCMonth() + 1)}/${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
};
const sensorList = sensors => sensors.map(s => (s.entityId && s.roleLabel ? `${s.roleLabel}(${s.name})` : s.name)).join(', ');

/** 사전 점검에서 꺼진 센서를 찾았을 때 운영자 알림 */
export function precheckAlertMessage(areaName, check, sensors) {
  return {
    title: `[PROPOS] ${areaName ?? '숙소'} 감지 센서 점검`,
    message: `${kstLabel(check.at)} ${PHASE_LABEL[check.phase]} ${check.offsetLabel} 점검 — 꺼져 있는 센서: ${sensorList(sensors)}. `
      + `그대로면 ${PHASE_LABEL[check.phase]}을 확인할 수 없어요. 그 전에 확인해 주세요.`,
  };
}

/** 운영자에게 넘기는 문제의 알림 (DEC-11) — 무엇이 안 됐고 무엇을 해 달라는지 */
export function handoffAlertMessage(areaName, event) {
  const name = areaName ?? '숙소';
  const phase = event.data?.phase;
  const at = timeOf(event.data?.checkOut ?? event.data?.checkIn ?? event.data?.startAt ?? event.timestamp);
  const when = at != null ? `${kstLabel(at)} ` : '';
  if (event.type === 'late_checkout_detected') {
    return { title: `[PROPOS] ${name} 퇴실 지연`, message: `${when}퇴실이 확인되지 않아 청소 모드(에어컨 끄기·조명·환기)를 켜지 않았어요. 확인 후 직접 켜 주세요.` };
  }
  if (event.type === 'checkin_not_detected') {
    const deadline = timeOf(event.data?.deadline);
    const until = deadline != null ? `${kstLabel(deadline)}까지` : '기다리는 동안';
    return { title: `[PROPOS] ${name} 입실 미감지`, message: `${when}입실이 ${until} 확인되지 않았어요. 기기 상태(에어컨·조명)를 직접 확인해 주세요.` };
  }
  if (event.type === 'cleaning_not_detected') {
    return { title: `[PROPOS] ${name} 청소 미감지`, message: `${when}청소 시간 동안 담당자가 들어온 것이 보이지 않았어요. 공실 기기 제어(끄기·잠금)를 하지 않았어요. 청소가 됐는지 직접 확인해 주세요.` };
  }
  if (event.type === 'detection_unconfirmable') {
    const what = PHASE_LABEL[phase] ?? '퇴실·입실';
    const cause = {
      sensor_off: `꺼져 있는 센서: ${sensorList(event.data?.sensors ?? [])}`,
      not_entered: '입실이 확인되지 않은 체류였어요',
      exit_not_seen: '청소 담당자가 나간 것을 보지 못했어요',
    }[event.data?.cause] ?? '그 시각에 감시가 멈춰 있었어요';
    const devices = { checkout: '청소 모드를 켜지 않았어요. ', checkin: '체류 기기 제어를 하지 않았어요. ', cleaning: '공실 기기 제어(끄기·잠금)를 하지 않았어요. ' }[phase] ?? '';
    return { title: `[PROPOS] ${name} ${what} 확인 불가`, message: `${when}${what}${phase === 'cleaning' ? '를' : '을'} 확인할 수 없어요(${cause}). ${devices}직접 확인하고 처리해 주세요.` };
  }
  return null;
}
