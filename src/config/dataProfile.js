export const DATA_PROFILE = Object.freeze({
  DEMO: 'demo',
  HYBRID: 'hybrid',
  REAL: 'real',
});

export function normalizeDataProfile(value, fallback = DATA_PROFILE.HYBRID) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === DATA_PROFILE.DEMO || normalized === DATA_PROFILE.HYBRID || normalized === DATA_PROFILE.REAL) return normalized;
  return fallback;
}

function explicitDataProfile(value) {
  const profile = normalizeDataProfile(value, null);
  if (!profile) throw new Error(`invalid PROPOS_DATA_PROFILE: ${value}`);
  return profile;
}

/**
 * 서버 런타임의 데이터 프로필.
 * - 로컬과 Vercel production 모두 같은 DB의 혼합 데이터(hybrid)를 사용한다.
 * - 숙소별 data_origin으로 REAL/SIMULATED를 구분한다.
 *
 * PROPOS_DATA_PROFILE을 지정하면 어느 환경에서도 같은 프로필을 재현할 수 있다.
 */
export function resolveServerDataProfile(env = {}) {
  if (env.PROPOS_DATA_PROFILE) {
    return explicitDataProfile(env.PROPOS_DATA_PROFILE);
  }
  return DATA_PROFILE.HYBRID;
}

/** Vite 빌드와 서버 런타임이 같은 규칙을 쓰도록 한 곳에서 결정한다. */
export function resolveBuildDataProfile(mode, env = {}) {
  if (env.PROPOS_DATA_PROFILE) {
    return explicitDataProfile(env.PROPOS_DATA_PROFILE);
  }
  return DATA_PROFILE.HYBRID;
}

export function isDemoDataProfile(profile) {
  return normalizeDataProfile(profile) === DATA_PROFILE.DEMO;
}
