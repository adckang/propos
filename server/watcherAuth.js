/**
 * Pi 워처 HTTP 의 요청 확인 (RF-21).
 *
 * 화면·서버(Vercel API)는 로그인·숙소 권한을 확인한 뒤에만 워처를 부른다. 그런데 워처 주소는 인터넷에서 직접 열려 있어,
 * 주소를 아는 사람은 로그인 없이 서버를 건너뛰고 워처에 바로 갈 수 있었다. 서버는 이제 워처를 부를 때
 * Pi → 서버 이벤트 전송과 같은 공유키(PROPOS_PI_SECRET, 헤더 x-pi-secret)를 붙이고, 워처는 이 키를 확인한다.
 *
 * 단계 (PROPOS_WATCHER_AUTH_MODE):
 *  - log(기본): 키 없는 요청도 처리하되 기록한다 — 저장소 밖의 호출자(HA 자동화 등)가 있는지 먼저 확인한다
 *  - enforce: 키가 맞는 요청만 처리하고 나머지는 401. Pi 에 키가 없으면 전부 거절한다(설정 실수로 열리는 것보다 닫히는 쪽)
 * 확인이 끝나면 기본값을 enforce 로 바꿔, 재시작 때 설정이 빠져도 다시 열리지 않게 한다(RF-21 마지막 단계).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const WATCHER_SECRET_HEADER = 'x-pi-secret';

export function watcherAuthMode(env = process.env) {
  return env.PROPOS_WATCHER_AUTH_MODE === 'enforce' ? 'enforce' : 'log';
}

// 두 값을 같은 길이(해시)로 바꿔 비교한다 — 비교 시간으로 키의 내용·길이가 새지 않게
const digest = (value) => createHash('sha256').update(value, 'utf8').digest();

/** 요청에 Pi 와 같은 공유키가 있는가 */
export function hasWatcherSecret(headers, env = process.env) {
  const expected = env.PROPOS_PI_SECRET;
  const given = headers?.[WATCHER_SECRET_HEADER];
  if (typeof expected !== 'string' || !expected || typeof given !== 'string' || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** 'allow' = 키가 맞음, 'log' = 키 없음·기록 모드(처리하되 기록), 'reject' = 키 없음·차단 모드(401) */
export function decideWatcherRequest(headers, env = process.env) {
  if (hasWatcherSecret(headers, env)) return 'allow';
  return watcherAuthMode(env) === 'enforce' ? 'reject' : 'log';
}

/**
 * 기록 모드의 "키 없는 요청" 기록 — 워처 주소는 인터넷에 열려 있어 봇·스캐너가 계속 두드릴 수 있다.
 * 같은 (방식, 경로)는 intervalMs 에 한 번만 남기고 그 사이 건수를 함께 적는다. 모르는 경로는 하나로 묶어 기억이 늘지 않게 한다.
 */
export function createUnauthenticatedLogger({ knownPaths, intervalMs = 10 * 60_000, now = () => Date.now(), log = (m) => console.warn(m) } = {}) {
  const seen = new Map();
  return (method, pathname) => {
    const key = `${method} ${knownPaths?.has(pathname) ? pathname : '(기타 경로)'}`;
    const t = now();
    const entry = seen.get(key);
    if (entry && t - entry.at < intervalMs) { entry.skipped += 1; return; }
    const skipped = entry?.skipped ?? 0;
    seen.set(key, { at: t, skipped: 0 });
    log(`[watcher-auth] 키 없는 요청 ${key}${skipped ? ` (직전 기록 뒤 ${skipped}건 더)` : ''}`);
  };
}
