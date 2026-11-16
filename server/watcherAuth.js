/**
 * Pi 워처 HTTP 의 요청 확인 (RF-21).
 *
 * 화면·서버(Vercel API)는 로그인·숙소 권한을 확인한 뒤에만 워처를 부른다. 그런데 워처 주소는 인터넷에서 직접 열려 있어,
 * 주소를 아는 사람은 로그인 없이 서버를 건너뛰고 워처에 바로 갈 수 있었다. 서버는 이제 워처를 부를 때
 * Pi → 서버 이벤트 전송과 같은 공유키(PROPOS_PI_SECRET, 헤더 x-pi-secret)를 붙이고, 워처는 이 키를 확인한다.
 *
 * 단계 (PROPOS_WATCHER_AUTH_MODE):
 *  - enforce(기본): 키가 맞는 요청만 처리하고 나머지는 401. Pi 에 키가 없으면 전부 거절한다(설정 실수로 열리는 것보다 닫히는 쪽)
 *  - log: 키 없는 요청도 처리하되 기록한다 — 새 호출자를 확인할 때만 정확히 'log' 로 켠다
 * 2026-11-16 Pi 에 기록 모드로 먼저 반영해 저장소 밖의 호출자를 확인한 뒤 기본값을 enforce 로 바꿨다(RF-21) —
 * 재시작 때 설정이 빠지거나 값에 오타가 있어도 다시 열리지 않게.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const WATCHER_SECRET_HEADER = 'x-pi-secret';

export function watcherAuthMode(env = process.env) {
  return env.PROPOS_WATCHER_AUTH_MODE === 'log' ? 'log' : 'enforce';
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

/** 워처가 시작할 때 남기는 모드 한 줄 — 차단 모드인데 Pi 에 키가 없으면(환경파일이 안 읽힘 등) 서버 요청까지 전부 막히므로 경고한다 */
export function watcherAuthStartupMessage(env = process.env) {
  if (watcherAuthMode(env) === 'log') return '[watcher-auth] 모드: 기록(키 없는 요청도 처리하고 기록)';
  if (typeof env.PROPOS_PI_SECRET !== 'string' || !env.PROPOS_PI_SECRET) {
    return '[watcher-auth] 모드: 차단 — 경고: 공유키(PROPOS_PI_SECRET)가 없어 서버 요청까지 모두 401 로 거절합니다';
  }
  return '[watcher-auth] 모드: 차단(키 없는 요청 401)';
}

/**
 * "키가 없거나 틀린 요청" 기록 — 기록 모드에서 처리한 것과 차단 모드에서 거절한 것(→ 401) 모두 남긴다.
 * 거절도 남겨야 서버의 키가 틀렸을 때나 저장소 밖 호출자가 막혔을 때 Pi 쪽에서 무엇이 막혔는지 보인다.
 * 워처 주소는 인터넷에 열려 있어 봇·스캐너가 계속 두드릴 수 있으므로
 * 같은 (방식, 경로)는 intervalMs 에 한 번만 남기고 그 사이 건수를 함께 적는다. 모르는 경로는 하나로 묶어 기억이 늘지 않게 한다.
 */
export function createUnauthenticatedLogger({ knownPaths, intervalMs = 10 * 60_000, now = () => Date.now(), log = (m) => console.warn(m) } = {}) {
  const seen = new Map();
  return (method, pathname, { rejected = false } = {}) => {
    const key = `${method} ${knownPaths?.has(pathname) ? pathname : '(기타 경로)'}`;
    const t = now();
    const entry = seen.get(key);
    if (entry && t - entry.at < intervalMs) { entry.skipped += 1; return; }
    const skipped = entry?.skipped ?? 0;
    seen.set(key, { at: t, skipped: 0 });
    const outcome = rejected ? ' → 401 거절' : '';
    const more = skipped ? ` (직전 기록 뒤 ${skipped}건 더)` : '';
    log(`[watcher-auth] 키가 없거나 틀린 요청 ${key}${outcome}${more}`);
  };
}
