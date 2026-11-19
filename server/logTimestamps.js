// Pi 워처 기록(watcher.log) 줄마다 한국 시각을 붙인다 (RF-30).
// 워처는 console 출력을 그대로 watcher.log 에 이어 쓰는데(start-watcher.sh 의 `>>`) 줄에 시각이 없어,
// 지난 감지·거절 기록을 날짜로 대조할 수 없었다. 기록하는 곳이 여러 모듈의 console 호출이라 console 자체를 감싼다.
import { format } from 'node:util';

export const LOG_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WRAPPED = Symbol.for('propos.logTimestamps.wrapped');

/** 2026-11-19T22:44:45.150+09:00 — Pi 의 시간대 설정과 상관없이 한국 시각, 다시 읽으면 같은 순간 */
export function kstTimestamp(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().replace('Z', '+09:00');
}

/**
 * target(console)의 기록 메서드를 줄 앞에 시각을 붙이는 함수로 바꾼다. 이미 감싼 메서드는 건너뛴다(시각이 두 번 붙지 않게).
 * 내용은 console 과 같은 규칙으로 한 줄로 만든 뒤 그 한 줄만 넘긴다 — 인자가 하나뿐인 문자열은 다시 해석되지 않아 % 가 그대로 남는다.
 * @returns {boolean} 새로 감싼 메서드가 있으면 true
 */
export function installLogTimestamps(target = console, now = Date.now) {
  let installed = false;
  for (const method of LOG_METHODS) {
    const original = target[method];
    if (typeof original !== 'function' || original[WRAPPED]) continue;
    const wrapped = (...args) => original.call(target, `${kstTimestamp(now())} ${format(...args)}`);
    wrapped[WRAPPED] = true;
    target[method] = wrapped;
    installed = true;
  }
  return installed;
}
