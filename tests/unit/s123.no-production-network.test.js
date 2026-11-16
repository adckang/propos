// RF-23(2026-11-16): s101 이 끝난 뒤 워처의 이벤트 재전송이 진짜 네트워크로 운영 `POST https://proposonline.com/api/events/write`
// 에 나갔다(가짜 키라 401, 저장 없음 — 로컬 npm test·GitHub CI 마다 1건). 이제 npm test 는 모든 테스트 파일에 운영 쪽 주소 차단 장치를 걸고,
// 막은 요청이 있으면 그 파일을 실패로 만든다. 이 파일은 장치가 걸려 있는지, 막고 실패시키는지, 어떤 주소를 막는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isProductionHost } from '../helpers/productionHosts.js';

const trap = fileURLToPath(new URL('../helpers/productionFetchTrap.js', import.meta.url));

test('npm test 는 모든 테스트 파일보다 먼저 운영 주소 차단 장치를 불러온다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /^node --import \.\/tests\/helpers\/productionFetchTrap\.js --test /);
});

test('막는 주소: 운영 사이트·Pi 워처·Vercel·Slack·DB·KV·Google·집 HA / 그 밖(테스트용 가짜 주소·로컬)은 막지 않는다', () => {
  for (const host of ['proposonline.com', 'www.proposonline.com', 'watcher.proposonline.com', 'propos-project-v2.vercel.app', 'hooks.slack.com',
    'ep-x.ap-southeast-1.aws.neon.tech', 'x.upstash.io', 'fcm.googleapis.com', 'www.googleapis.com', '192.168.45.76', 'WWW.PROPOSONLINE.COM']) {
    assert.equal(isProductionHost(host), true, host);
  }
  for (const host of ['ha.test', 'localhost', '127.0.0.1', 'example.com', 'evilproposonline.com', 'proposonline.com.example', '', undefined]) {
    assert.equal(isProductionHost(host), false, String(host));
  }
});

test('막은 요청이 있으면 실제로 보내지 않고, 끝날 때 무엇을 막았는지 출력하며 실패(종료 코드 1)한다', () => {
  const leak = spawnSync(process.execPath, ['--import', trap, '--input-type=module', '-e',
    "const r = await fetch('https://proposonline.com/api/events/write', { method: 'POST' }); if (r.status !== 599) process.exit(3);"],
  { encoding: 'utf8', timeout: 30_000 });
  assert.equal(leak.status, 1, leak.stderr);
  assert.match(leak.stderr, /운영 쪽 주소로 요청하려 해서 막았습니다 \(1건\):\n {2}POST https:\/\/proposonline\.com\/api\/events\/write/);

  const clean = spawnSync(process.execPath, ['--import', trap, '--input-type=module', '-e', 'globalThis.ok = true;'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stderr, '');
});

test('npm test 로 실행 중이면 이 테스트 프로세스에도 장치가 걸려 있다(파일마다 걸리는지)', async (t) => {
  const installed = globalThis.__productionFetchTrap;
  if (!installed) { t.skip('npm test 가 아닌 단독 실행 — 장치가 없으므로 운영 주소를 부르지 않는다'); return; }
  const response = await fetch('https://proposonline.com/api/events/write', { method: 'POST' });
  assert.equal(response.status, 599);
  assert.deepEqual(installed.calls, ['POST https://proposonline.com/api/events/write']);
  installed.reset(); // 일부러 부른 1건 — 이 파일이 실패로 끝나지 않게 지운다
});
