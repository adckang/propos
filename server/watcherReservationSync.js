/**
 * RF-27 — 대시보드 없이 Pi 워처에 최신 예약을 보낸다.
 *
 * 예전엔 대시보드(RoomStateApp)를 브라우저에서 열어 둘 때만 Pi로 예약이 갔다. 아무도 화면을 열지 않으면 Pi 예약이 낡아
 * 입실 준비·입실·퇴실 판단이 지난 예약을 기준으로 돌았다(DEC-04, 2026-11-17). 서버 정기 작업이 iCal 동기화 직후 이 함수를 불러
 * DB의 최신 예약을 그 숙소를 맡은 Pi에 보낸다 — 대시보드가 보내던 것과 같은 경로(`/api/monitoring/config`)·같은 예약 모양.
 * 보내는 것은 예약 하나뿐이다 — 이름(areaName)·기기 설정은 건드리지 않는다(워처는 받은 값만 덮어쓴다).
 *
 * 하지 않는 것(사용자 지시): Pi 상태(roomState)를 바꾸지 않는다.
 *  - 보낼 예약이 없으면 보내지 않는다 — 워처는 예약이 있다가 빈 값이 오면 "예약 취소"로 보고 상태를 바꾼다.
 *  - 워처 하나가 숙소 여러 개를 맡으면 보내지 않는다 — 워처 설정은 숙소 하나뿐이라 서로 덮어쓴다(D-035 한계와 같음).
 * 실패해도 던지지 않는다 — 정기 작업의 다른 단계가 계속 돌게 결과만 돌려준다.
 */
import { createWatcherPropertyLookup, watcherRequestHeaders } from './auth/watcherScope.js';
import { pickCurrentReservation, toMonitoringReservation, usableReservations } from '../src/domain/monitoringReservationDomain.js';
import { DATA_PROFILE, resolveServerDataProfile } from '../src/config/dataProfile.js';

const PUSH_TIMEOUT_MS = 5_000;

/**
 * @param {{ query: Function }} db
 * @param {{ lookup?: () => Promise<object[]>, fetchImpl?: Function, now?: Date, env?: object, log?: Function }} [options]
 * @returns {Promise<{ propertyId: string|null, watcherUrl: string|null, sent: boolean, result: string, httpStatus?: number }[]>}
 */
export async function pushCurrentReservationsToWatchers(db, options = {}) {
  const {
    lookup = createWatcherPropertyLookup(),
    fetchImpl = (...args) => fetch(...args),
    now = new Date(),
    env = process.env,
    log = (...args) => console.log(...args),
  } = options;

  const skip = (propertyId, watcherUrl, result) => ({ propertyId, watcherUrl, sent: false, result });
  if (resolveServerDataProfile(env) === DATA_PROFILE.DEMO) return [skip(null, null, 'demo 프로필 — 보내지 않음')];

  let watcherProperties;
  try { watcherProperties = await lookup(); }
  catch (err) {
    log(`[watcher-reservation] 워처 숙소 목록 조회 실패: ${err.message}`);
    return [skip(null, null, '워처 숙소 목록 조회 실패')];
  }

  // 워처(주소)별로 숙소를 모은다 — 워처 하나가 숙소 하나를 맡을 때만 보낸다
  const byWatcher = new Map();
  for (const p of Array.isArray(watcherProperties) ? watcherProperties : []) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.sourceUrl !== 'string' || !p.sourceUrl) continue;
    if (!byWatcher.has(p.sourceUrl)) byWatcher.set(p.sourceUrl, []);
    byWatcher.get(p.sourceUrl).push(p);
  }

  // 워처 목록이 비면(워처가 꺼졌거나 키가 맞지 않아 조회기가 빈 목록을 돌려준 경우 포함) 정기 작업 로그에 남게 결과를 하나 둔다
  if (byWatcher.size === 0) return [skip(null, null, '워처 숙소 목록 없음 — 보내지 않음')];

  // 워처마다 따로 — 한 워처가 느려도 다른 워처를 기다리게 하지 않는다
  return Promise.all([...byWatcher].map(async ([watcherUrl, properties]) => {
    if (properties.length !== 1) return skip(null, watcherUrl, `워처가 숙소 ${properties.length}개를 맡아 보내지 않음`);
    const propertyId = properties[0].id;
    try {
      const { rows: [config] } = await db.query(
        `SELECT property_id FROM property_cleaning_config WHERE property_id=$1 AND data_origin='REAL'`, [propertyId]);
      if (!config) return skip(propertyId, watcherUrl, '운영 DB의 실제 숙소가 아님 — 보내지 않음');

      const { rows } = await db.query(
        `SELECT reservation_uid AS uid, check_in AS "checkIn", check_out AS "checkOut", status
           FROM property_reservations WHERE property_id=$1 AND data_origin='REAL'`, [propertyId]);
      const reservation = toMonitoringReservation(pickCurrentReservation(usableReservations(rows), now));
      if (!reservation) return skip(propertyId, watcherUrl, '현재·다음 예약 없음 — 빈 예약은 보내지 않음');

      const response = await fetchImpl(`${watcherUrl.replace(/\/$/, '')}/api/monitoring/config`, {
        method: 'POST',
        headers: watcherRequestHeaders({ 'Content-Type': 'application/json' }, env),
        body: JSON.stringify({ reservation }),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!response.ok) log(`[watcher-reservation] ${propertyId} 예약 전달 실패: HTTP ${response.status}`);
      return { propertyId, watcherUrl, sent: response.ok, result: response.ok ? '보냄' : '워처가 거절', httpStatus: response.status };
    } catch (err) {
      log(`[watcher-reservation] ${propertyId} 예약 전달 실패: ${err.message}`);
      return skip(propertyId, watcherUrl, '전달 실패');
    }
  }));
}
