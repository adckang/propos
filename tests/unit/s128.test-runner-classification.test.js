// s128 — e2e 폴더의 두 실행기(node:test 외부 연결 시험 · Playwright 화면 시험)가 서로 섞이지 않고,
// 실제 외부 서비스·집 HA를 건드리는 시험은 명시적으로 허락했을 때만 돈다(ACT-08).
//
// 소스 글자만 보면 "허락 검사가 있다"는 것만 알 수 있고 모든 묶음이 그 검사를 거치는지는 모른다 —
// 실제로 IT-S37-09(운영 API)만 검사를 건너뛰고 있었다. 그래서 파일을 실제로 실행해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONNECTIVITY = 'tests/e2e/s37.live-connectivity.test.js';
const read = relative => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

// 자식 프로세스의 fetch 를 전부 막고 시도한 주소를 stderr 에 남긴다 — 무엇이 잘못돼도 밖으로 나가지 않는다.
const BLOCK_ALL_FETCH = 'data:text/javascript,' + encodeURIComponent(
  'globalThis.fetch = async (u) => { process.exitCode = 1; process.stderr.write("FETCH_ATTEMPT " + String(u?.url ?? u) + "\\n"); throw new Error("blocked by s128"); };',
);

// 허락 검사가 빠지면 실제로 돌아 버릴 값들. 접속 대상은 모두 가짜(로컬 닫힌 포트 등)라 새도 밖으로 가지 않는다.
const FAKE_SERVICE_ENV = {
  POSTGRES_URL: 'postgres://s128:s128@127.0.0.1:1/s128',
  GOOGLE_CLIENT_ID: 's128', GOOGLE_CLIENT_SECRET: 's128',
  GOOGLE_REFRESH_TOKEN: 's128', GOOGLE_CALENDAR_REFRESH_TOKEN: 's128',
  KV_REST_API_URL: 'http://127.0.0.1:1', KV_REST_API_TOKEN: 's128',
  PROPOS_SMS_GW_ID: 's128', PROPOS_SMS_GW_PWD: 's128',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  PROPOS_SLACK_WEBHOOK: 'http://127.0.0.1:1/s128',
};

function runConnectivity(extraEnv) {
  // 사용자 셸의 실제 비밀값이 섞이지 않도록 최소 환경으로 띄운다.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv };
  const r = spawnSync(process.execPath, ['--import', BLOCK_ALL_FETCH, '--test-reporter=tap', CONNECTIVITY], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 30_000,
  });
  const count = name => Number(r.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
  return {
    status: r.status,
    tests: count('tests'),
    fail: count('fail'),
    fetches: (r.stderr.match(/^FETCH_ATTEMPT .*$/gm) ?? []),
    output: `${r.stdout}\n${r.stderr}`.slice(-2000),
  };
}

test('외부 연결 시험은 RUN_LIVE_CONNECTIVITY=1 없이는 서비스 환경변수가 다 있어도 아무 시험도·요청도 하지 않는다', () => {
  const r = runConnectivity(FAKE_SERVICE_ENV);
  assert.equal(r.tests, 0, `허락 없이 실행된 시험이 있다:\n${r.output}`);
  assert.equal(r.fail, 0, r.output);
  assert.deepEqual(r.fetches, [], `허락 없이 네트워크 요청을 시도했다:\n${r.output}`);
  assert.equal(r.status, 0, r.output);
});

test('(대조) 허락하면 환경변수가 필요 없는 운영 API 묶음이 실제로 요청을 시도한다 — 위 시험이 빈 검사가 아님', () => {
  // 서비스 환경변수는 주지 않는다 → 운영 API 묶음만 돌고, 그 요청은 BLOCK_ALL_FETCH 가 막는다.
  const r = runConnectivity({ RUN_LIVE_CONNECTIVITY: '1' });
  assert.ok(r.fetches.length > 0, `허락했는데 요청 시도가 없다 — 차단 장치나 실행 방식이 바뀌었는지 확인:\n${r.output}`);
  assert.ok(r.fetches.every(line => line.includes('https://www.proposonline.com/')), r.fetches.join('\n'));
});

test('Playwright E2E 설정은 *.spec.js 만 수집한다 — node:test 외부 연결 시험 파일을 불러오지도 않는다', () => {
  // --list 는 시험을 실행하지 않고 개발 서버도 띄우지 않는다. 예전 설정은 이 단계에서 s37 파일을 불러와 실행했다.
  const r = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.e2e.config.mjs', '--list'], {
    cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', timeout: 60_000,
  });
  const output = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, output.slice(-2000));
  assert.doesNotMatch(output, /IT-S37|s37\.live-connectivity/, '외부 연결 시험 파일이 Playwright 수집 중에 실행됐다');
  assert.match(output, /s40\.dashboard\.spec\.js/);
  assert.match(read(CONNECTIVITY), /from "node:test"/); // 이 파일이 Playwright 용이 아니라는 전제
});

test('package.json 은 외부 연결 시험을 별도 명령으로만 노출한다', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:connectivity'], `node --test ${CONNECTIVITY}`);
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (name === 'test:connectivity') continue;
    assert.doesNotMatch(command, /s37|tests\/e2e\/\*\.test/, `${name} 이(가) 외부 연결 시험을 함께 돌린다`);
  }
});

test('실제 HA E2E는 명시적 허락·환경변수만 쓰고, 실패해도 도어·워처 설정을 모두 되돌린다', () => {
  // E2E-003 은 집 HA 와 실제 Pi 워처를 바꾸므로 실행해서 확인할 수 없다 — 안전장치의 소스 계약만 고정한다.
  const dashboard = read('tests/e2e/s40.dashboard.spec.js');
  assert.match(dashboard, /const HA_AVAILABLE = RUN_LIVE_HA && /);
  assert.match(dashboard, /process\.env\.RUN_LIVE_HA === '1'/);
  assert.doesNotMatch(dashboard, /privateConfig|propos\.config\.json/, '로컬 비공개 설정 파일만 있어도 실제 HA 시험이 켜지면 안 된다');

  const finallyBody = dashboard.match(/\} finally \{([\s\S]*?)\n {2}\}\n/)?.[1] ?? '';
  assert.ok(finallyBody, 'E2E-003 에 finally 복원 블록이 있어야 한다');
  assert.match(finallyBody, /toggle\(originalDoorState === 'on'\)/);
  assert.match(finallyBody, /monitoring\/config', \{ data: origConfig \}/);
  // finally 안에서 바로 던지면 한쪽 복원 실패가 다른 쪽 복원을 건너뛰고 원래 실패 원인을 가린다.
  assert.doesNotMatch(finallyBody, /assert\.|throw /);
});
