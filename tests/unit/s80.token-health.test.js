/**
 * s80 — 토큰 매니저 레이어 (_tokenHealth.js) — 2026-10-27
 *
 * 배경: 2026-11 Google Calendar 리프레시 토큰이 죽었는데 콘솔 로그만 남고 아무도
 * 못 알아채서 한 달간 블로커 생성이 통째로 스킵된 사고. 호출부마다 try/catch +
 * Slack 코드를 반복하는 대신, 토큰을 발급하는 함수(getGoogleToken/getGmailToken)
 * 자신이 이 공용 레이어를 거치게 해서 모든 호출부가 자동으로 혜택을 받게 한다.
 *
 * 요구사항(사용자): 과설계 없이 필요한 것만, 코드 중복 없이, 만료 전 사전 경고까지.
 *
 * /code-review high 자체 리뷰로 찾아 반영한 결함 5건(2026-10-27):
 *   1. 매일 돌아야 하는 checkStaleness가 morning 핸들러 맨 끝에 있어, 그 앞의 네 단계
 *      (daily-plan/worker-health-check/cleaning-followup/monthly-cleaning) 중 하나라도
 *      throw하면 그날 staleness 점검 자체가 안 돎 → 네 단계를 개별 try/catch로 격리.
 *   2. markRenewed("calendar_watch")가 "캘린더 전부 성공"일 때만 돌아서, 숙소가 늘어 캘린더가
 *      여러 개면 하나만 영구히 깨져도 markRenewed가 다시는 안 되고 staleness 경고가 매일 영구
 *      오탐으로 남음 → 갱신 메커니즘 자체가 살았는지만 추적하도록 무조건 markRenewed.
 *   3. Gmail Watch 성공 응답에 expiration이 없으면 Slack 메시지 포맷팅(new Date(NaN))이 throw해서
 *      catch가 "실패"로 잘못 보고(이미 markRenewed는 됐는데 모순되는 알림) → expiration 없으면
 *      "알 수 없음"으로 안전하게 표시.
 *   4. failingSince의 KV TTL을 최초 1회만 세팅해서, 장애가 TTL(원래 30일)보다 길면 lastAlertAt은
 *      계속 갱신되는데 failingSince만 사라져 복구 시 "장애 지속 시간"이 축소 보고됨 → 실패마다
 *      TTL을 갱신(값은 유지).
 *   5. _tokenHealth.js가 @vercel/kv를 server/에서 직접 import해서 CLAUDE.md 규칙
 *      ("@vercel/kv는 api/ 폴더에서만 import")과 기존 DI 관례(kvStore.js)를 깨뜸 →
 *      kv를 인자로 주입받도록 전면 수정, getGoogleToken/getGmailToken도 kv를 받아 전달.
 *
 * 레이어:
 *   L1 — _tokenHealth.js의 실제 동작(throttle, 복구 알림, staleness 판정, TTL 갱신)을
 *        @vercel/kv가 내부적으로 쓰는 fetch를 가짜로 바꿔 진짜로 실행해서 검증.
 *   L2 — _calendar.js/api/cron/[...slug].js/_dispatch.js/_notify.js 소스 계약
 *        (실제로 이 레이어를 거치는지, kv 주입 여부, postSlack 중복이 제거됐는지).
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── 가짜 KV(Upstash REST pipeline 프로토콜) + Slack 웹훅 recorder ──────────────
// @vercel/kv는 모든 명령을 POST {KV_REST_API_URL}/pipeline, body=[[cmd,...args]]
// 로 보내고 [{result}] 형태로 응답받는다(실제 패키지 동작 확인 후 작성).
const kvStore = new Map();
const slackMessages = [];
const kvCommands = []; // [cmd, key, ...] 전체 로그 — "set이 매번 실제로 호출되는지"(TTL 갱신) 같은
                        // 값만으로는 구분 안 되는 동작을 검증하려면 호출 자체를 봐야 한다.

function installFetchMock() {
  kvStore.clear();
  slackMessages.length = 0;
  kvCommands.length = 0;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('hooks.slack.test')) {
      slackMessages.push(JSON.parse(opts.body).text);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) };
    }
    if (u.includes('fake-kv.test')) {
      const body = JSON.parse(opts.body);
      const results = body.map(([cmd, ...args]) => {
        kvCommands.push([cmd, ...args]);
        if (cmd === 'get') return { result: kvStore.has(args[0]) ? kvStore.get(args[0]) : null };
        if (cmd === 'set') { kvStore.set(args[0], args[1]); return { result: 'OK' }; }
        if (cmd === 'del') { const had = kvStore.has(args[0]); kvStore.delete(args[0]); return { result: had ? 1 : 0 }; }
        return { result: null };
      });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(results), json: async () => results };
    }
    throw new Error(`예상 못 한 fetch 호출: ${u}`);
  };
}

process.env.PROPOS_SLACK_WEBHOOK = 'https://hooks.slack.test/webhook';
process.env.KV_REST_API_URL = 'https://fake-kv.test';
process.env.KV_REST_API_TOKEN = 'fake-token';
installFetchMock(); // _tokenHealth.js를 import하는 순간 _slack.js가 webhook URL을 캡처하므로 import 전에 설치

const { kv } = await import('@vercel/kv'); // _tokenHealth.js에 인자로 주입할 실제 kv 클라이언트(가짜 fetch 경유)
const { reportTokenFailure, reportTokenSuccess, markRenewed, checkStaleness } =
  await import('../../server/cleaning/_tokenHealth.js');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('_tokenHealth — reportTokenFailure: 같은 실패는 3시간에 한 번만 알림', () => {
  beforeEach(installFetchMock);

  test('첫 실패 → Slack 1건 발송 + failing_since/last_alert_at 기록', async () => {
    await reportTokenFailure(kv, 't1', 'T1 토큰', new Error('boom'));
    assert.equal(slackMessages.length, 1);
    assert.match(slackMessages[0], /T1 토큰 실패/);
    assert.match(slackMessages[0], /boom/);
    assert.ok(kvStore.has('token_health:t1:failing_since'));
    assert.ok(kvStore.has('token_health:t1:last_alert_at'));
  });

  test('throttle 안(바로 재실패) → 추가 Slack 없음', async () => {
    await reportTokenFailure(kv, 't1', 'T1 토큰', new Error('boom'));
    await reportTokenFailure(kv, 't1', 'T1 토큰', new Error('boom again'));
    assert.equal(slackMessages.length, 1, '3시간 안 재실패는 중복 알림이면 안 된다');
  });

  test('throttle 지나면(last_alert_at이 3시간 이상 전) → 다시 알림', async () => {
    await reportTokenFailure(kv, 't1', 'T1 토큰', new Error('boom'));
    kvStore.set('token_health:t1:last_alert_at', Date.now() - 4 * 3600_000);
    await reportTokenFailure(kv, 't1', 'T1 토큰', new Error('still boom'));
    assert.equal(slackMessages.length, 2);
  });

  test('(버그 수정 확인) 재실패마다 failing_since의 set이 다시 호출된다(TTL 갱신) — 값은 유지하면서', async () => {
    // 값이 바뀌지 않는 것만으론 "TTL이 갱신되는지"를 구분할 수 없다(옛 버그 코드도 값은 그대로
    // 유지했다 — if(!since)라 두 번째 호출에서 set 자체를 스킵했을 뿐). set이 "호출됐는지" 자체를
    // 봐야 한다: 실제 KV에서 set을 다시 호출해야 TTL 타이머가 리셋되기 때문.
    await reportTokenFailure(kv, 't3', 'T3 토큰', new Error('boom'));
    const firstSince = kvStore.get('token_health:t3:failing_since');
    const setsAfterFirst = kvCommands.filter(([cmd, key]) => cmd === 'set' && key === 'token_health:t3:failing_since').length;
    assert.equal(setsAfterFirst, 1);

    kvStore.set('token_health:t3:last_alert_at', Date.now() - 4 * 3600_000); // throttle 통과시켜 재호출
    await reportTokenFailure(kv, 't3', 'T3 토큰', new Error('boom again'));
    const setsAfterSecond = kvCommands.filter(([cmd, key]) => cmd === 'set' && key === 'token_health:t3:failing_since').length;
    assert.equal(setsAfterSecond, 2, '두 번째 실패에서도 set이 다시 호출돼야 TTL이 갱신된다(버그 버전은 여기서 1로 멈춤)');
    assert.equal(kvStore.get('token_health:t3:failing_since'), firstSince, '그래도 값(최초 실패 시각) 자체는 보존돼야 함');
  });
});

describe('_tokenHealth — reportTokenSuccess: 실패 상태였을 때만 복구 알림', () => {
  beforeEach(installFetchMock);

  test('실패 기록 없이 성공 → 알림 없음(정상 흐름을 스팸하지 않음)', async () => {
    await reportTokenSuccess(kv, 't2', 'T2 토큰');
    assert.equal(slackMessages.length, 0);
  });

  test('실패 직후 성공 → 복구 알림 1건 + 상태 초기화', async () => {
    await reportTokenFailure(kv, 't2', 'T2 토큰', new Error('down'));
    await reportTokenSuccess(kv, 't2', 'T2 토큰');
    assert.equal(slackMessages.length, 2);
    assert.match(slackMessages[1], /복구됨/);
    assert.equal(kvStore.has('token_health:t2:failing_since'), false);
    assert.equal(kvStore.has('token_health:t2:last_alert_at'), false);
  });

  test('복구 후 재성공 → 더 이상 알림 없음(이미 초기화됐으므로)', async () => {
    await reportTokenFailure(kv, 't2', 'T2 토큰', new Error('down'));
    await reportTokenSuccess(kv, 't2', 'T2 토큰');
    await reportTokenSuccess(kv, 't2', 'T2 토큰');
    assert.equal(slackMessages.length, 2, '두 번째 성공은 이미 정상 상태라 추가 알림 없어야 함');
  });

  test('장기 지속 장애(29일) 후 복구 시 지속 시간이 분 단위로 정확히 보고된다', async () => {
    const longAgo = Date.now() - 29 * DAY_MS;
    kvStore.set('token_health:t4:failing_since', longAgo); // 최초 실패 시각을 29일 전으로 소급 설정
    await reportTokenSuccess(kv, 't4', 'T4 토큰');
    const recoveryMsg = slackMessages[slackMessages.length - 1];
    assert.match(recoveryMsg, /복구됨/);
    const minutesReported = Number(recoveryMsg.match(/약 (\d+)분/)[1]);
    assert.ok(minutesReported > 28 * 24 * 60, `29일에 가까운 지속시간이 보고돼야 함 (실제: ${minutesReported}분)`);
  });
});

describe('_tokenHealth — markRenewed / checkStaleness: 갱신 지연 사전 경고', () => {
  beforeEach(installFetchMock);

  test('갱신 기록이 전혀 없으면(배포 직후 등) 조용히 건너뜀 — 오탐 방지', async () => {
    await checkStaleness(kv, 'watchX', 'Watch X', 6 * DAY_MS);
    assert.equal(slackMessages.length, 0);
  });

  test('최근 갱신됨(staleMs 이내) → 알림 없음', async () => {
    await markRenewed(kv, 'watchX');
    await checkStaleness(kv, 'watchX', 'Watch X', 6 * DAY_MS);
    assert.equal(slackMessages.length, 0);
  });

  test('갱신 안 된 지 staleMs 초과 → 사전 경고 알림 (만료 전에 미리 통보)', async () => {
    kvStore.set('token_health:watchX:last_renewed_at', Date.now() - 6.5 * DAY_MS);
    await checkStaleness(kv, 'watchX', 'Watch X', 6 * DAY_MS);
    assert.equal(slackMessages.length, 1);
    assert.match(slackMessages[0], /Watch X 갱신 지연/);
    assert.match(slackMessages[0], /일 경과/);
  });

  test('경고 상태에서 실제로 다시 갱신되면 복구 알림', async () => {
    kvStore.set('token_health:watchX:last_renewed_at', Date.now() - 6.5 * DAY_MS);
    await checkStaleness(kv, 'watchX', 'Watch X', 6 * DAY_MS); // 경고 1건
    await markRenewed(kv, 'watchX');
    await checkStaleness(kv, 'watchX', 'Watch X', 6 * DAY_MS); // 복구 1건
    assert.equal(slackMessages.length, 2);
    assert.match(slackMessages[1], /복구됨/);
  });
});

// ── L2: 실제 호출부가 이 레이어를 거치는지 소스 계약으로 확인 ──────────────────
describe('소스 계약 — getGoogleToken/getGmailToken이 kv를 주입받아 _tokenHealth를 거친다', () => {
  const src = read('server/cleaning/_calendar.js');

  test('@vercel/kv를 직접 import하지 않는다(CLAUDE.md: api/ 폴더에서만 import)', () => {
    assert.doesNotMatch(
      src,
      /from\s*["']@vercel\/kv["']/,
      'server/ 모듈이 @vercel/kv를 직접 import하면 안 됨 — kv는 인자로 받아야 함(주석에서 설명으로 언급하는 것은 무관)'
    );
  });

  test('_tokenHealth에서 reportTokenFailure/reportTokenSuccess를 import한다', () => {
    assert.match(src, /import\s*\{\s*reportTokenFailure,\s*reportTokenSuccess\s*\}\s*from\s*["']\.\/_tokenHealth\.js["']/);
  });

  test('getGoogleToken(kv) — 실패 시 reportTokenFailure(kv, "google_calendar", ...) 호출 후 재throw', () => {
    const m = src.match(/export async function getGoogleToken\(kv\)[\s\S]*?\n}/);
    assert.ok(m, 'getGoogleToken(kv) 정의를 찾지 못함');
    assert.match(m[0], /reportTokenFailure\(kv, "google_calendar"/);
    assert.match(m[0], /reportTokenSuccess\(kv, "google_calendar"/);
    assert.match(m[0], /throw e;/);
  });

  test('getGmailToken(kv)도 동일하게 "google_gmail" 이름으로 레이어를 거친다', () => {
    const m = src.match(/export async function getGmailToken\(kv\)[\s\S]*?\n}/);
    assert.ok(m, 'getGmailToken(kv) 정의를 찾지 못함');
    assert.match(m[0], /reportTokenFailure\(kv, "google_gmail"/);
    assert.match(m[0], /reportTokenSuccess\(kv, "google_gmail"/);
  });
});

describe('소스 계약 — api/cleaning/[...slug].js의 모든 호출부가 kv를 넘긴다', () => {
  const src = read('api/cleaning/[...slug].js');

  test('getGoogleToken()/getGmailToken() — 괄호 빈 호출이 하나도 남지 않았다', () => {
    assert.doesNotMatch(src, /getGoogleToken\(\)/, 'kv 없이 호출하는 곳이 남아있으면 런타임 에러');
    assert.doesNotMatch(src, /getGmailToken\(\)/);
  });

  test('getGoogleToken(kv)/getGmailToken(kv) 호출이 실제로 존재한다(12곳)', () => {
    const calls = (src.match(/get(Google|Gmail)Token\(kv\)/g) ?? []).length;
    assert.ok(calls >= 10, `호출부가 너무 적음(${calls}) — kv 주입 누락 의심`);
  });
});

describe('소스 계약 — api/cron/[...slug].js의 Watch 갱신이 kv를 주입받아 레이어를 거친다', () => {
  const src = read('api/cron/[...slug].js');

  test('getGoogleToken()/getGmailToken() — 괄호 빈 호출이 하나도 남지 않았다', () => {
    assert.doesNotMatch(src, /getGoogleToken\(\)/);
    assert.doesNotMatch(src, /getGmailToken\(\)/);
  });

  test('_tokenHealth에서 reportTokenFailure/markRenewed/checkStaleness를 import한다', () => {
    assert.match(src, /from\s*["']\.\.\/\.\.\/server\/cleaning\/_tokenHealth\.js["']/);
  });

  test('Gmail Watch 갱신 실패 시 reportTokenFailure(kv, "gmail_watch", ...) 호출', () => {
    assert.match(src, /reportTokenFailure\(kv, "gmail_watch", "Gmail Watch 갱신"/);
  });

  test('Calendar Watch 갱신 실패 시 reportTokenFailure(kv, "calendar_watch", ...) 호출 (기존 중복 postSlack 제거됨)', () => {
    assert.match(src, /reportTokenFailure\(kv, "calendar_watch", "Calendar Watch 갱신"/);
    assert.doesNotMatch(
      src,
      /Calendar Watch 갱신 실패: \$\{e\.message\}/,
      '기존에 있던 중복 postSlack 호출이 남아있으면 안 됨(이제 reportTokenFailure 하나로 통일)'
    );
  });

  test('(버그 수정 확인) markRenewed("calendar_watch")가 전체 성공 조건에 더 안 묶여있다', () => {
    assert.doesNotMatch(
      src,
      /if \(calWatchCount === calProps\.length\) await markRenewed/,
      '캘린더 하나만 영구히 깨져도 markRenewed가 영원히 안 되는 조건이 남아있으면 안 됨'
    );
    assert.match(src, /await markRenewed\(kv, "calendar_watch"\);/);
  });

  test('(버그 수정 확인) Gmail Watch 성공 메시지가 expiration 없을 때 안전하게 "알 수 없음"으로 폴백한다', () => {
    assert.match(src, /const expLabel = w\.expiration \? new Date\(Number\(w\.expiration\)\)\.toISOString\(\)\.slice\(0, 10\) : "알 수 없음";/);
    assert.doesNotMatch(
      src,
      /만료: \$\{new Date\(Number\(w\.expiration\)\)\.toISOString\(\)\.slice\(0, 10\)\}/,
      'expiration 누락 시 RangeError로 throw되는 옛 패턴이 남아있으면 안 됨'
    );
  });

  test('성공 시 markRenewed(kv, ...) 기록, 매일 checkStaleness(kv, ...)로 만료 전 사전 경고', () => {
    assert.match(src, /markRenewed\(kv, "gmail_watch"\)/);
    assert.match(src, /markRenewed\(kv, "calendar_watch"\)/);
    assert.match(src, /checkStaleness\(kv, "gmail_watch", "Gmail Watch", WATCH_STALE_MS\)/);
    assert.match(src, /checkStaleness\(kv, "calendar_watch", "Calendar Watch", WATCH_STALE_MS\)/);
  });

  test('(버그 수정 확인) daily-plan/worker-health-check/cleaning-followup/monthly-cleaning이 개별 try/catch로 격리돼, 하나가 실패해도 뒤의 checkStaleness가 계속 돈다', () => {
    assert.match(src, /try \{ await handleDailyPlan\(db, nullRes\); ran\.push\("daily-plan"\); \}/);
    assert.match(src, /try \{ await handleWorkerHealthCheck\(db, nullRes\); ran\.push\("worker-health-check"\); \}/);
    assert.match(src, /try \{ await handleCleaningFollowup\(db, nullRes\); ran\.push\("cleaning-followup"\); \}/);
    assert.match(src, /try \{ await handleMonthlyClean\(db, nullRes\); ran\.push\("monthly-cleaning"\); \}/);
  });

  test('WATCH_STALE_MS는 7일 만료보다 짧게(여유를 두고 미리 경고)', () => {
    const m = src.match(/const WATCH_STALE_MS = ([^;]+);/);
    assert.ok(m, 'WATCH_STALE_MS 정의를 찾지 못함');
    // eslint-disable-next-line no-eval
    const ms = (0, eval)(m[1]);
    assert.ok(ms < 7 * DAY_MS, `7일보다 짧아야 미리 경고가 됨 (현재 ${ms}ms)`);
  });
});

describe('소스 계약 — postSlack 중복 제거 (_dispatch.js, _notify.js가 _slack.js 하나만 쓴다)', () => {
  test('_dispatch.js는 postSlack을 직접 구현하지 않고 _slack.js에서 재export한다', () => {
    const src = read('server/cleaning/_dispatch.js');
    assert.match(src, /export\s*\{\s*postSlack\s*\}\s*from\s*["']\.\/_slack\.js["']/);
    assert.doesNotMatch(src, /const SLACK_WEBHOOK = process\.env\.PROPOS_SLACK_WEBHOOK/);
  });

  test('_notify.js는 자체 postSlackInternal 없이 _slack.js의 postSlack을 쓴다', () => {
    const src = read('server/cleaning/_notify.js');
    assert.match(src, /import\s*\{\s*postSlack\s*\}\s*from\s*["']\.\/_slack\.js["']/);
    assert.doesNotMatch(src, /postSlackInternal/);
    assert.doesNotMatch(src, /const SLACK_WEBHOOK = process\.env\.PROPOS_SLACK_WEBHOOK/);
  });

  test('_slack.js에 실제 구현이 정확히 한 곳만 있다', () => {
    const src = read('server/cleaning/_slack.js');
    assert.match(src, /const SLACK_WEBHOOK = process\.env\.PROPOS_SLACK_WEBHOOK/);
    assert.match(src, /export async function postSlack/);
  });
});
