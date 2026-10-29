/**
 * 외부 토큰/연동(구글 OAuth, Watch 채널 등) 상태 추적 — 단일 진입점.
 * 2026-11 Google Calendar 리프레시 토큰 만료 사고(콘솔 로그만 남고 아무도 못 알아챔) 재발 방지용.
 * Vercel 함수 수에 포함되지 않도록 server/ 아래에 둔다.
 *
 * kv는 호출부가 인자로 주입한다(CLAUDE.md: @vercel/kv는 api/ 폴더에서만 import — 이 파일은
 * server/에 있으므로 직접 import하지 않고 src/infrastructure/kvStore.js와 같은 방식을 따른다).
 *
 * 설계:
 *  - 호출부마다 try/catch + Slack 코드를 반복하지 않도록, 토큰을 "발급하는 함수" 자신이
 *    이 모듈을 거치게 한다(getGoogleToken/getGmailToken 내부에서 호출) — 호출부가 몇 곳이든
 *    전부 자동으로 혜택을 받는다.
 *  - 같은 실패가 계속돼도 ALERT_THROTTLE_MS마다 한 번만 재알림(스팸 방지).
 *  - 실패 후 복구되면 "복구됨" 알림 1회(장애 지속 시간 포함) — 사람이 확인하러 안 가도 됨.
 *  - checkStaleness(): "갱신 시도 자체가 실패"가 아니라 "누가 언제 마지막으로 성공 갱신했는지"를
 *    별도로 추적해, 7일 만료형 연동(Gmail/Calendar Watch)이 주기 renewal을 조용히 몇 번 건너뛰어도
 *    실제 만료 전에 미리 경고할 수 있게 한다.
 */

import { postSlack } from "./_slack.js";

const ALERT_THROTTLE_MS = 3 * 60 * 60 * 1000; // 같은 실패로 3시간에 한 번만 재알림
const STATE_TTL_SEC = 60 * 24 * 60 * 60; // KV 키 TTL. 장애 중엔 매번 갱신되므로 사실상 "장애 지속 중엔 안 만료"

function stateKeys(name) {
  return {
    failingSince: `token_health:${name}:failing_since`,
    lastAlertAt: `token_health:${name}:last_alert_at`,
  };
}

/** 토큰 발급/연동 시도가 실패했을 때 호출. 처음 실패하거나 throttle 시간이 지났을 때만 Slack 발송. */
export async function reportTokenFailure(kv, name, label, error) {
  const { failingSince, lastAlertAt } = stateKeys(name);
  const now = Date.now();
  try {
    // failingSince 값은 유지하되, 실패가 계속되는 한 TTL은 매번 갱신한다.
    // (한 번만 set하면 장애가 STATE_TTL_SEC보다 길어질 때 키가 사라져 "장애 지속 시간"이
    //  복구 시 잘못 계산된다 — 이 기능이 막으려는 사고 자체가 장기 침묵 장애라 특히 중요)
    const since = await kv.get(failingSince);
    await kv.set(failingSince, since ?? now, { ex: STATE_TTL_SEC });

    const lastAlert = await kv.get(lastAlertAt);
    if (!lastAlert || now - Number(lastAlert) > ALERT_THROTTLE_MS) {
      await postSlack(
        `🚨 [PROPOS] ${label} 실패\n` +
        `사유: ${error?.message ?? error}\n` +
        `→ 자동 갱신이 안 되는 종류면 수동 갱신 필요(scripts/get-refresh-token.mjs 등)`
      );
      await kv.set(lastAlertAt, now, { ex: STATE_TTL_SEC });
    }
  } catch (e) {
    console.error(`[token-health] ${name} 실패 보고 중 오류:`, e.message);
  }
}

/** 토큰 발급/연동 성공 시 호출. 직전까지 실패 상태였을 때만 "복구됨" 1회 알림 + 상태 초기화. */
export async function reportTokenSuccess(kv, name, label) {
  const { failingSince, lastAlertAt } = stateKeys(name);
  try {
    const since = await kv.get(failingSince);
    if (since) {
      const downMin = Math.round((Date.now() - Number(since)) / 60_000);
      await postSlack(`✅ [PROPOS] ${label} 복구됨 (장애 지속 약 ${downMin}분)`);
      await kv.del(failingSince);
      await kv.del(lastAlertAt);
    }
  } catch (e) {
    console.error(`[token-health] ${name} 복구 보고 중 오류:`, e.message);
  }
}

/** 주기 갱신형 연동이 마지막으로 성공 갱신된 시각을 기록. */
export async function markRenewed(kv, name) {
  try {
    await kv.set(`token_health:${name}:last_renewed_at`, Date.now(), { ex: STATE_TTL_SEC });
  } catch (e) {
    console.error(`[token-health] ${name} 갱신 시각 기록 실패:`, e.message);
  }
}

/**
 * 주기 갱신형 연동(예: 7일마다 갱신해야 하는 Watch 채널)을 "지금 시도해야 하는지" 판단.
 * 기록이 없으면(최초 배포 등) true — 한 번도 안 갱신됐으면 당연히 시도해야 한다.
 * checkStaleness(경고용, 기록 없으면 건너뜀)와 반대로 이 함수는 "시도 여부" 판단이라
 * 기록 없음을 안전하게 true로 다룬다. 호출 자체가 실패해도 true(시도해보는 쪽이 안전).
 */
export async function isRenewalDue(kv, name, thresholdMs) {
  try {
    const lastRenewed = await kv.get(`token_health:${name}:last_renewed_at`);
    if (!lastRenewed) return true;
    return Date.now() - Number(lastRenewed) > thresholdMs;
  } catch (e) {
    console.error(`[token-health] ${name} 갱신 필요 여부 확인 실패:`, e.message);
    return true;
  }
}

/**
 * 주기 갱신형 연동(예: 7일마다 갱신해야 하는 Watch 채널)이 staleMs 이상 갱신 안 됐으면
 * 사전 경고(reportTokenFailure와 같은 throttle 재사용, 별도 name으로 상태 분리).
 * 기록이 아예 없으면(처음 배포 등) 조용히 건너뛴다 — 오탐 방지.
 */
export async function checkStaleness(kv, name, label, staleMs) {
  try {
    const lastRenewed = await kv.get(`token_health:${name}:last_renewed_at`);
    if (!lastRenewed) return;
    const elapsedMs = Date.now() - Number(lastRenewed);
    if (elapsedMs <= staleMs) {
      await reportTokenSuccess(kv, `${name}_stale`, label);
      return;
    }
    const elapsedDays = (elapsedMs / 86_400_000).toFixed(1);
    await reportTokenFailure(
      kv,
      `${name}_stale`,
      `${label} 갱신 지연`,
      new Error(`마지막 성공 갱신 후 ${elapsedDays}일 경과 — 만료 전 확인 필요`)
    );
  } catch (e) {
    console.error(`[token-health] ${name} 지연 점검 실패:`, e.message);
  }
}
