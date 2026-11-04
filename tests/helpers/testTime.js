/**
 * testTime — 테스트 공용 시각 도우미 (KST 기준 시각 만들기, "지금" 고정).
 * 여러 테스트가 각자 복사해 쓰던 at()/withNow() 를 한 곳으로 모았다.
 */
import { mock } from 'node:test';

/** KST 벽시계 → Date. 'YYYY-MM-DD'(자정) · 'YYYY-MM-DDTHH:MM' · 'YYYY-MM-DDTHH:MM:SS(.sss)'. 형식이 틀리면 바로 실패. */
export function kst(wallClock) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(:\d{2}(?:\.\d{1,3})?)?)?$/.exec(String(wallClock));
  if (!match) throw new Error(`kst(): 알 수 없는 시각 형식 "${wallClock}"`);
  const [, day, hm = '00:00', sec = ':00'] = match;
  const date = new Date(`${day}T${hm}${sec}+09:00`);
  // 2026-02-30 처럼 JS 가 다음 달로 넘겨 버리는 날짜도 거절
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10) !== day) {
    throw new Error(`kst(): 없는 날짜 "${wallClock}"`);
  }
  return date;
}

/** Date 를 지정한 KST 시각으로 고정한 채 fn 실행 (동기·비동기 모두). 끝나면 원래대로. */
export function withFrozenNow(at, fn) {
  const now = at instanceof Date ? at : kst(at);
  mock.timers.enable({ apis: ['Date'], now });
  let result;
  try {
    result = fn(now);
  } catch (error) {
    mock.timers.reset();
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return result.finally(() => mock.timers.reset());
  }
  mock.timers.reset();
  return result;
}
