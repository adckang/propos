/**
 * s84 — airbnbEventsToReservations가 서버 실행 시간대에 의존하지 않고 항상 KST로 변환한다
 *
 * 배경: 사용자가 실사용 중 발견(2026-10-30) — 캘린더뷰·디테일뷰 타임라인에서 체크인이 자정,
 * 체크아웃이 오후 8시로 보임(원래는 체크인 오후3시 / 체크아웃 오전11시여야 정상). 숙소
 * 체크인·체크아웃 시각이 정확히 9시간(KST=UTC+9) 밀려 있었다.
 *
 * 원인: airbnbEventsToReservations가 Date.prototype.setHours()로 체크인/체크아웃 시각을
 * 붙였는데, setHours()는 "그 값을 서버 프로세스가 돌고 있는 시간대" 기준으로 해석한다.
 * 로컬 개발 환경(한국 시간대 Mac)에서는 우연히 맞게 나오지만, Vercel 서버는 UTC로 돌아서
 * "체크인 15시(KST 의도)"가 "15시 UTC"(=KST로 환산하면 자정, 9시간 밀림)로 잘못 저장됐다.
 * 그래서 이 버그는 로컬에서 npm test를 돌려도(한국 시간대라) 안 잡히고 운영에서만 터졌다 —
 * 그래서 이 테스트는 절대 UTC 타임스탬프(toISOString())로 직접 확인해서, 테스트를 어느
 * 시간대 기기에서 돌리든 버그가 있으면 반드시 실패하게 한다(날짜 문자열만 비교하면 이번처럼
 * 로컬 시간대에서 우연히 통과해버릴 수 있다).
 *
 * 고침: setHours() 대신 Date.UTC() + 명시적 KST 오프셋(-9시간)으로 직접 계산
 * (kstWallClockToUtc, KST는 서머타임이 없어 연중 고정 오프셋).
 *
 * 레이어: L1 — 실제 함수 호출, 시간대 무관하게 절대 UTC 값으로 단언.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { airbnbEventsToReservations, parseVEvents } from '../../src/domain/room-state/icalParser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function events(dtstart, dtend) {
  return parseVEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:s84-test',
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    'SUMMARY:Reserved',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
}

describe('airbnbEventsToReservations — 체크인/체크아웃을 KST 기준으로 정확히 UTC 변환한다', () => {
  test('체크인 15시(KST) = 06:00 UTC — 자정(9시간 밀림)이 아니다', () => {
    const [r] = airbnbEventsToReservations(events('20261010', '20261012'), 15, 11);
    assert.equal(r.checkIn.toISOString(), '2026-10-10T06:00:00.000Z');
  });

  test('체크아웃 11시(KST) = 02:00 UTC — 오후 8시(9시간 밀림)가 아니다', () => {
    const [r] = airbnbEventsToReservations(events('20261010', '20261012'), 15, 11);
    assert.equal(r.checkOut.toISOString(), '2026-10-12T02:00:00.000Z');
  });

  test('기본값(체크인 15시/체크아웃 11시)도 동일하게 정확하다', () => {
    const [r] = airbnbEventsToReservations(events('20261231', '20270101'));
    assert.equal(r.checkIn.toISOString(), '2026-12-31T06:00:00.000Z');
    assert.equal(r.checkOut.toISOString(), '2027-01-01T02:00:00.000Z');
  });

  test('(회귀 방지) setHours 기반 구현으로 되돌아가지 않았다', () => {
    const src = read('src/domain/room-state/icalParser.js');
    assert.doesNotMatch(
      src,
      /checkIn\.setHours|checkOut\.setHours/,
      'setHours()는 서버 실행 시간대에 의존해 로컬에서는 맞고 운영(UTC)에서만 9시간 밀리는' +
      ' 버그를 재발시킨다 — Date.UTC + 명시적 KST 오프셋 방식을 유지해야 함'
    );
  });
});
