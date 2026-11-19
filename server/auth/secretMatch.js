/**
 * 서버가 받는 비밀값(구글 웹훅·정기 작업 등) 비교.
 *
 * 단순 문자열 비교(!==)는 첫 글자부터 다른 곳에서 멈춰서, 응답 시간을 많이 재면 값을 한 글자씩 맞혀 볼 여지가 있다.
 * 두 값을 같은 길이의 해시로 바꾼 뒤 timingSafeEqual 로 비교한다 — 걸린 시간으로 값의 내용·길이가 새지 않고,
 * 길이가 달라도 예외가 나지 않는다. 워처의 Pi 공유키 확인(server/watcherAuth.js, RF-21)과 같은 방식이다.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value, 'utf8').digest();

/** 받은 값(given)이 서버 쪽 값(expected)과 같은가. 서버 쪽 값이 비어 있으면 무엇과도 맞지 않는다. */
export function secretMatches(given, expected) {
  if (typeof expected !== 'string' || !expected || typeof given !== 'string') return false;
  return timingSafeEqual(digest(given), digest(expected));
}
