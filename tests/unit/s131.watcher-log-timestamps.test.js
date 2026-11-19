// s131 — Pi 워처 기록(watcher.log) 줄마다 한국 시각을 붙인다 (RF-30).
// 워처는 console 출력을 그대로 watcher.log 에 이어 쓰는데(start-watcher.sh 의 `>>`), 줄에 시각이 없어
// 지난 감지 기록을 날짜로 대조할 수 없었다. 실제 워처 서버가 이 설치를 부르는지는 s122 가 서버를 띄워 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { kstTimestamp, installLogTimestamps, LOG_METHODS } from '../../server/logTimestamps.js';

const AT = Date.UTC(2026, 10, 19, 13, 44, 45, 150); // 2026-11-19 22:44:45.150 KST

function captureConsole() {
  let out = '';
  const stream = new Writable({ write(chunk, _enc, done) { out += chunk; done(); } });
  return { console: new Console({ stdout: stream, stderr: stream }), text: () => out };
}

test('시각은 한국 시각(+09:00), 밀리초까지 — Pi 의 시간대 설정과 상관없다', () => {
  assert.equal(kstTimestamp(AT), '2026-11-19T22:44:45.150+09:00');
  assert.equal(kstTimestamp(Date.UTC(2026, 10, 19, 15, 0, 0, 0)), '2026-11-20T00:00:00.000+09:00', 'UTC 15시 = 다음 날 0시');
  assert.equal(new Date(kstTimestamp(AT)).getTime(), AT, '다시 읽으면 같은 순간');
});

test('log·info·warn·error·debug 모두 줄 앞에 시각이 붙고, 내용은 console 과 같은 모양으로 남는다', () => {
  const c = captureConsole();
  installLogTimestamps(c.console, () => AT);
  c.console.log('[Watcher] 상태 전환: %s ← %s', 'OCCUPIED/STAY', 'checkin');
  c.console.info('info', 1);
  c.console.warn('[watcher-auth] 키가 없거나 틀린 요청', { path: '/api/x' });
  c.console.error('[Watcher] 처리 오류:', 'timeout');
  c.console.debug('debug');
  const ts = '2026-11-19T22:44:45.150+09:00';
  assert.equal(c.text(), [
    `${ts} [Watcher] 상태 전환: OCCUPIED/STAY ← checkin`,
    `${ts} info 1`,
    `${ts} [watcher-auth] 키가 없거나 틀린 요청 { path: '/api/x' }`,
    `${ts} [Watcher] 처리 오류: timeout`,
    `${ts} debug`,
  ].join('\n') + '\n');
  assert.deepEqual(LOG_METHODS, ['log', 'info', 'warn', 'error', 'debug']);
});

test('기록 내용의 % 는 한 번만 해석된다 — 이미 완성된 한 줄을 그대로 넘긴다', () => {
  const c = captureConsole();
  installLogTimestamps(c.console, () => AT);
  c.console.log('100% done %s');
  c.console.log('%s', '50%d 남음');
  assert.equal(c.text(), '2026-11-19T22:44:45.150+09:00 100% done %s\n2026-11-19T22:44:45.150+09:00 50%d 남음\n');
});

test('오류 객체는 스택까지 남고 첫 줄에 시각이 붙는다', () => {
  const c = captureConsole();
  installLogTimestamps(c.console, () => AT);
  c.console.error(new Error('HA 응답 없음'));
  const [first, second] = c.text().split('\n');
  assert.equal(first, '2026-11-19T22:44:45.150+09:00 Error: HA 응답 없음');
  assert.match(second, /^\s+at /);
});

test('찍는 순간의 시각을 쓴다(설치 시각이 아니라)', () => {
  const c = captureConsole();
  let now = AT;
  installLogTimestamps(c.console, () => now);
  c.console.log('a');
  now += 61_000;
  c.console.log('b');
  assert.equal(c.text(), '2026-11-19T22:44:45.150+09:00 a\n2026-11-19T22:45:46.150+09:00 b\n');
});

test('두 번 설치해도 시각은 한 번만 붙고, 누가 메서드를 바꿔 끼운 뒤 다시 설치하면 다시 붙는다', () => {
  const c = captureConsole();
  assert.equal(installLogTimestamps(c.console, () => AT), true);
  assert.equal(installLogTimestamps(c.console, () => AT), false);
  c.console.log('once');
  assert.equal(c.text(), '2026-11-19T22:44:45.150+09:00 once\n');

  const lines = [];
  c.console.warn = (...args) => lines.push(args);
  assert.equal(installLogTimestamps(c.console, () => AT), true, 'warn 이 새 함수라 다시 감싼다');
  c.console.warn('again');
  assert.deepEqual(lines, [['2026-11-19T22:44:45.150+09:00 again']], '완성된 한 줄 하나만 넘긴다');
});
