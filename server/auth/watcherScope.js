/**
 * 운영자의 라즈베리파이 워처(모니터링·CCTV) 접근을 "자기 숙소에 연결된 워처"로 제한한다 (D-035).
 *
 * 숙소 ↔ 워처 연결은 Pi 가 가진 숙소 메타데이터({ id, watcherId, ... })에 있다 — 서버가 그 목록을 읽어
 * 운영자의 숙소(scope)에 해당하는 watcherId 만 허용한다. 관리자는 호출부에서 이 검사를 건너뛴다.
 * 한계: 워처 하나가 여러 숙소를 맡으면 그 워처의 데이터는 숙소별로 나눌 수 없다(현재는 숙소 1개 = 워처 1개).
 */
import { canAccessProperty } from './operatorAccounts.js';

export function parseWatcherUrls(env = process.env) {
  let byId = {};
  try { byId = JSON.parse(env.PROPOS_WATCHER_URLS ?? '{}') || {}; } catch { byId = {}; }
  const defaultUrl = env.PROPOS_WATCHER_URL || null;
  const all = [...new Set([...Object.values(byId), defaultUrl].filter((u) => typeof u === 'string' && u))];
  return { byId, defaultUrl, all };
}

const normUrl = (u) => String(u ?? '').replace(/\/$/, '');

/** watcherId → 실제로 호출할 주소. (주소 맵에 없는 이름은 기본 워처로 폴백 — 기존 동작. 그래서 운영자 검사는 이 결과 주소를 쓴다) */
export function resolveWatcherUrl(watcherId, env = process.env) {
  const { byId, defaultUrl } = parseWatcherUrls(env);
  if (watcherId && byId[watcherId]) return byId[watcherId];
  return defaultUrl ?? null;
}

/**
 * 운영자가 이 워처를 써도 되는가. 모두 맞아야 한다:
 *  ① 운영자의 숙소 중 하나가 이 watcherId 로 등록돼 있고,
 *  ② 우리가 실제로 호출할 주소(resolveUrl(watcherId))가 "그 숙소를 보고한 Pi 의 주소"와 같고(주소 맵에 없는 이름이 기본 Pi 로
 *     폴백돼 다른 숙소의 CCTV·상태가 보이는 우회 차단),
 *  ③ 그 워처가 **운영자 범위 밖의 숙소도 함께** 맡고 있지 않다 — 워처 하나가 여러 숙소를 맡으면 상태·스냅샷을 숙소별로 나눌 수 없어
 *     다른 숙소의 데이터가 섞여 보이므로 닫는 쪽으로 거절한다(설정 창이 새 숙소에 watcher1 을 미리 채워 두므로 실제로 생길 수 있다).
 */
export function operatorMayUseWatcher(scope, properties, watcherId, resolveUrl) {
  if (typeof watcherId !== 'string' || !watcherId) return false;
  const target = normUrl(resolveUrl(watcherId));
  if (!target) return false;
  const rows = (Array.isArray(properties) ? properties : []).filter((p) => p && typeof p.id === 'string' && p.watcherId === watcherId && normUrl(p.sourceUrl) === target);
  return rows.some((p) => canAccessProperty(scope, p.id)) && rows.every((p) => canAccessProperty(scope, p.id));
}

/**
 * 모든 워처의 숙소 메타데이터를 모아 돌려주는 조회기. 각 항목에 보고한 Pi 의 주소(sourceUrl)를 붙인다.
 * 워처(주소)별로 따로 캐시한다: 한 워처가 꺼져 있어도 나머지는 캐시를 쓰고(전체가 매번 5초씩 기다리지 않게),
 * 실패한 워처는 잠시(failBackoffMs) 다시 묻지 않으며 마지막으로 성공한 목록을 staleMs 안에서만 임시로 쓴다.
 * 동시에 여러 요청이 오면 진행 중인 조회 하나를 같이 기다린다. fetchImpl 은 테스트에서 주입한다.
 */
export function createWatcherPropertyLookup({ getUrls = () => parseWatcherUrls().all, fetchImpl = (...a) => fetch(...a), ttlMs = 60_000, timeoutMs = 5_000, failBackoffMs = 15_000, staleMs = 10 * 60_000, now = () => Date.now(), log = console.warn } = {}) {
  const state = new Map(); // url -> { good: { at, list }, failAt, inflight }
  async function loadOne(url) {
    const key = normUrl(url);
    const st = state.get(key) ?? {};
    state.set(key, st);
    const t = now();
    if (st.good && t - st.good.at < ttlMs) return st.good.list;
    const stale = () => (st.good && t - st.good.at < staleMs ? st.good.list : []); // 오래된 목록은 쓰지 않는다 — 꺼진 워처의 숙소는 안 보이는 쪽이 안전
    if (st.failAt != null && t - st.failAt < failBackoffMs) return stale();
    if (st.inflight) return st.inflight;
    st.inflight = (async () => {
      try {
        const r = await fetchImpl(`${key}/api/properties`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!Array.isArray(body)) throw new Error('목록이 아님');
        const list = body.map((p) => (p && typeof p === 'object' ? { ...p, sourceUrl: key } : p));
        st.good = { at: now(), list }; st.failAt = null;
        return list;
      } catch (err) {
        st.failAt = now();
        log(`[watcherScope] 워처 숙소 목록 조회 실패 (${key}): ${err.message}`);
        return stale();
      } finally { st.inflight = null; }
    })();
    return st.inflight;
  }
  return async function lookup() {
    return (await Promise.all(getUrls().map(loadOne))).flat();
  };
}
