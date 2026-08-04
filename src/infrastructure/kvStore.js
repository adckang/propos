/**
 * Vercel KV 캐시 레이어.
 * @vercel/kv는 api/ 폴더에서만 import — 이 파일은 kv 객체를 인자로 주입받는다.
 *
 * KV 키 설계 (data-storage-design.md 기준):
 *   state:{property_id}           → 숙소 현재 상태, TTL 5분
 *   report:daily:{property_id}:{YYYY-MM-DD} → 일별 리포트 캐시, TTL 1시간
 */

const STATE_TTL_SEC = 5 * 60;       // 5분
const REPORT_TTL_SEC = 60 * 60;     // 1시간

/**
 * 숙소 현재 상태를 KV에 저장한다.
 * @param {object} kv - { set: Function, get: Function } 인터페이스
 * @param {string} propertyId
 * @param {{ mainStatus: string, subStatus: string }} state
 */
export async function setRoomState(kv, propertyId, state) {
  await kv.set(`state:${propertyId}`, JSON.stringify(state), {
    ex: STATE_TTL_SEC,
  });
}

/**
 * KV에서 숙소 현재 상태를 읽는다.
 * @param {object} kv
 * @param {string} propertyId
 * @returns {Promise<{ mainStatus: string, subStatus: string }|null>}
 */
export async function getRoomState(kv, propertyId) {
  const raw = await kv.get(`state:${propertyId}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * 일별 리포트 캐시를 KV에 저장한다.
 * @param {object} kv
 * @param {string} propertyId
 * @param {string} date - 'YYYY-MM-DD'
 * @param {object} report
 */
export async function setDailyReport(kv, propertyId, date, report) {
  await kv.set(
    `report:daily:${propertyId}:${date}`,
    JSON.stringify(report),
    { ex: REPORT_TTL_SEC }
  );
}

/**
 * KV에서 일별 리포트 캐시를 읽는다.
 * @param {object} kv
 * @param {string} propertyId
 * @param {string} date
 * @returns {Promise<object|null>}
 */
export async function getDailyReport(kv, propertyId, date) {
  const raw = await kv.get(`report:daily:${propertyId}:${date}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
