/**
 * s82 — listProperties의 reservations[].cleaningStatus를 reservation_uid 대신
 * 체크아웃 "날짜"로 매칭 (실사용 중 발견, 2026-10-30)
 *
 * 배경: 캘린더뷰(/api/cleaning/stats, cleaning_jobs를 직접 집계)에서는 파주201 11월
 * 전부 "배정완료"로 정상 표시됐는데, 디테일뷰(/api/cleaning/properties의
 * reservations[].cleaningStatus 경유)는 11/6 체크아웃 하나만 여전히 "미배정"으로
 * 보였다. 실제 운영 DB를 조회해 원인 확정:
 *   - cleaning_jobs에는 11/6 체크아웃 잡이 정확히 1개, status='ASSIGNED'.
 *   - 그런데 property_reservations에는 같은 체크인/체크아웃(11/3→11/6)인데
 *     reservation_uid가 다른 예약이 2행 있었다(Airbnb iCal이 같은 예약을 새 uid로
 *     다시 내보낸 것으로 추정 — 2026-10-29 SHORT_NOTICE 동기화로 새로 생김).
 *   - listProperties의 LATERAL JOIN이 reservation_uid로만 매칭해서, 중복 행 중
 *     cleaning_jobs가 실제로 가리키는 uid가 아닌 쪽은 영원히 매칭 실패 →
 *     cleaningStatus: null → 디테일뷰가 "미배정"으로 표시.
 * 고침: JOIN 조건을 reservation_uid 대신 "체크아웃 날짜"로 변경 — 캘린더뷰/
 * handleCalendarScan/handleCalendarWebhook이 이미 쓰는 것과 같은 규칙이라, 예약이
 * 중복돼 있어도(uid가 뭐든) 같은 날짜의 실제 cleaning_jobs를 정확히 찾는다.
 *
 * 레이어: L2 — api/cleaning/[...slug].js 소스 계약(JOIN 조건 텍스트).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('api/cleaning/[...slug].js — listProperties의 cleaningStatus 매칭이 날짜 기준이다', () => {
  const src = read('api/cleaning/[...slug].js');
  // listProperties 함수 본문만 떼어서 본다(다른 함수의 reservation_uid 사용과 섞이지 않게)
  const fnMatch = src.match(/async function listProperties\([\s\S]*?\n}\n/);

  test('listProperties 함수를 찾을 수 있다', () => {
    assert.ok(fnMatch, 'listProperties 함수를 찾지 못함');
  });

  test('(회귀 방지) cj.reservation_uid = r.reservation_uid 로 매칭하지 않는다', () => {
    assert.doesNotMatch(
      fnMatch[0],
      /cj\.reservation_uid\s*=\s*r\.reservation_uid/,
      'reservation_uid로만 매칭하면 Airbnb iCal이 같은 예약을 다른 uid로 다시 내보낼 때' +
      ' 중복 예약 행 중 하나가 영원히 "미배정"으로 잘못 보인다(실제로 발생한 사례)'
    );
  });

  test('체크아웃 날짜(to_char YYYY-MM-DD)로 매칭한다 — handleCalendarScan과 같은 규칙', () => {
    assert.match(
      fnMatch[0],
      /to_char\(cj\.checkout_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'\)\s*\n?\s*=\s*to_char\(r\.check_out AT TIME ZONE 'UTC', 'YYYY-MM-DD'\)/,
      "JOIN 조건이 날짜 단위 비교가 아니면 이 수정의 목적(중복 예약에도 안전한 매칭)이 안 지켜짐"
    );
  });

  test('property_id로는 여전히 좁힌다(다른 숙소 잡과 섞이면 안 됨)', () => {
    assert.match(fnMatch[0], /cj\.property_id\s*=\s*r\.property_id/);
  });

  test('reservation_uid 자체는 응답 표시용(uid 필드)으로는 그대로 남아있다', () => {
    assert.match(fnMatch[0], /'uid',\s*r\.reservation_uid/, '예약 자신의 uid 표시 필드는 지우면 안 됨(다른 용도)');
  });

  test('가장 최근 갱신된 잡 하나만 고른다(ORDER BY updated_at DESC LIMIT 1 유지)', () => {
    assert.match(fnMatch[0], /ORDER BY cj\.updated_at DESC\s*\n?\s*LIMIT 1/);
  });
});
