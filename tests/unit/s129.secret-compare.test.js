// s129 — 서버가 받는 비밀값(Pi 공유키·구글 웹훅·정기 작업)은 같은 방식으로, 비교 시간으로 값이 새지 않게 비교한다.
// 워처(RF-21, server/watcherAuth.js)는 이미 해시 + timingSafeEqual 로 비교했고, 나머지 네 곳은 단순 문자열 비교(!==)였다.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretMatches } from '../../server/auth/secretMatch.js';
import { event, request as eventRequest } from '../helpers/eventApiFixture.js';
import { cleaningDeclineFixture } from '../helpers/cleaningDeclineFixture.js';
import { actualCronModule, cronResponse, installCronIO } from '../helpers/cronHandlerFixture.js';

const read = relative => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('secretMatches — 공용 비밀값 비교', () => {
  test('같은 값만 맞다', () => {
    assert.equal(secretMatches('fixture-secret', 'fixture-secret'), true);
    assert.equal(secretMatches('fixture-secreT', 'fixture-secret'), false);
  });
  test('길이가 다른 값은 예외 없이 틀리다 — 앞부분만 같은 값·더 긴 값', () => {
    assert.equal(secretMatches('fixture-secre', 'fixture-secret'), false);
    assert.equal(secretMatches('fixture-secretX', 'fixture-secret'), false);
    assert.equal(secretMatches('', 'fixture-secret'), false);
  });
  test('받은 값이 문자열이 아니면 틀리다', () => {
    for (const given of [undefined, null, 1, ['fixture-secret'], {}]) assert.equal(secretMatches(given, 'fixture-secret'), false);
  });
  test('같은 길이의 해시를 상수 시간으로 비교한다 — 걸린 시간은 결과로 드러나지 않아 소스로 고정', () => {
    assert.match(read('server/auth/secretMatch.js'), /timingSafeEqual\(digest\(given\), digest\(expected\)\)/);
  });
  test('서버 쪽 값이 비어 있으면 무엇과도 맞지 않는다(빈 값끼리도)', () => {
    for (const expected of [undefined, null, '']) {
      assert.equal(secretMatches('', expected), false);
      assert.equal(secretMatches('anything', expected), false);
    }
  });
});

// 실제 핸들러에 "거의 맞는" 값을 보낸다 — 거절은 그대로이고, 길이가 달라도 예외(500)가 나지 않아야 한다.
const NEAR_MISSES = expected => [expected.slice(0, -1), `${expected}X`, expected.toUpperCase()];

describe('실제 핸들러는 거의 맞는 비밀값을 처리하지 않는다', () => {
  test('Pi 이벤트 수신(/api/events, /write) — 401, DB·알림 없음', async () => {
    for (const action of ['', 'write']) {
      for (const secret of NEAR_MISSES('fixture-key')) {
        const result = await eventRequest(action, event, { secret });
        assert.equal(result.res.code, 401, `${action || 'root'} ${secret}`);
        assert.deepEqual(result.calls, []);
        assert.deepEqual(result.notices, []);
      }
    }
  });

  async function webhookFixture(t) {
    const f = await cleaningDeclineFixture({ calendar: { fetch: async () => { throw new Error('Google must not be called'); } } });
    t.after(() => {
      try {
        assert.deepEqual(f.tokenCalls, [], '토큰을 받지 않는다');
        assert.deepEqual(f.queries, [], 'DB를 읽지 않는다');
        assert.deepEqual(f.calendarRequests, [], 'Google을 부르지 않는다');
        assert.deepEqual(f.blocked, []);
        assert.deepEqual(f.errors, []);
      } finally { f.restore(); }
    });
    return f;
  }

  // 아래 두 요청은 비밀값이 통과되면 본문 검사에서 400 이 나는 모양이다 — 200(조용히 무시)이어야 비교가 거절한 것이다.
  test('캘린더 웹훅 — 거의 맞는 채널 토큰은 200으로 무시', async t => {
    const f = await webhookFixture(t);
    for (const token of NEAR_MISSES('fixture-webhook-secret')) {
      const res = await f.invoke({ method: 'POST', url: '/api/cleaning/calendar-webhook',
        headers: { 'x-goog-channel-token': token, 'x-goog-resource-state': 'exists' } });
      assert.equal(res.code, 200, token);
    }
  });

  test('Gmail 웹훅 — 거의 맞는 비밀값·비밀값 없음은 200으로 무시(본문을 읽지 않음)', async t => {
    const f = await webhookFixture(t);
    for (const url of [...NEAR_MISSES('fixture-webhook-secret').map(s => `/api/cleaning/gmail-webhook?secret=${s}`), '/api/cleaning/gmail-webhook']) {
      const res = await f.invoke({ method: 'POST', url, rawBody: 'not json' });
      assert.equal(res.code, 200, url);
    }
  });

  test('Gmail 웹훅 — 서버에 비밀값이 설정돼 있지 않으면 지금처럼 검사 없이 처리한다(본문 검사까지 감)', async t => {
    const f = await cleaningDeclineFixture({ calendar: { secret: '', fetch: async () => { throw new Error('Google must not be called'); } } });
    t.after(() => f.restore());
    const res = await f.invoke({ method: 'POST', url: '/api/cleaning/gmail-webhook', rawBody: 'not json' });
    assert.equal(res.code, 400);
    assert.deepEqual(f.tokenCalls, []);
    assert.deepEqual(f.queries, []);
  });

  test('정기 작업 — 거의 맞는 Bearer 값·Bearer 없는 값은 401, DB 없음', async t => {
    const { default: handler } = await actualCronModule();
    for (const authorization of [...NEAR_MISSES('Bearer fixture-cron-secret'), 'fixture-cron-secret']) {
      const fixture = installCronIO();
      try {
        const res = cronResponse();
        await handler({ method: 'GET', url: '/api/cron/morning', query: {}, headers: { authorization } }, res);
        assert.equal(res.code, 401, authorization);
        assert.deepEqual(fixture.calls, []);
      } finally { fixture.restore(); }
    }
    delete globalThis.__cronHandlerIO;
    t.diagnostic('맞는 값·값 미설정의 통과는 s34 가 실제 핸들러로 확인한다');
  });
});

test('비밀값을 받는 네 곳이 단순 비교 대신 공용 비교를 쓴다', () => {
  const events = read('api/events/[...slug].js');
  const cleaning = read('api/cleaning/[...slug].js');
  const cron = read('api/cron/[...slug].js');

  assert.match(events, /hasWatcherSecret\(req\.headers, process\.env\)/, 'Pi 공유키는 워처와 같은 함수로 확인');
  assert.doesNotMatch(events, /(!==|===)\s*process\.env\.PROPOS_PI_SECRET/);

  assert.match(cleaning, /secretMatches\(req\.headers\["x-goog-channel-token"\], webhookSecret\)/);
  assert.match(cleaning, /secretMatches\(qs\.get\("secret"\), webhookSecret\)/);
  assert.doesNotMatch(cleaning, /(!==|===)\s*webhookSecret/);

  assert.match(cron, /secretMatches\(req\.headers\.authorization, `Bearer \$\{cronSecret\}`\)/);
  assert.doesNotMatch(cron, /(!==|===)\s*`Bearer/);
});
