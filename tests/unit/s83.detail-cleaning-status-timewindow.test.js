/**
 * s83 — 디테일뷰 "청소 미배정" 표시가 11월 전체에서 틀렸던 더 큰 원인
 *
 * 배경: s82(2026-10-30)에서 reservation_uid 중복 문제를 고쳤는데도, 사용자가 11월 전체를
 * 다시 확인하니 디테일뷰는 여전히 거의 모든 날짜를 "미배정"으로 보여줬다("캘린더뷰는 11월
 * 전부 배정완료인데, 디테일뷰는 전부 미배정으로 뜨는듯"). 실제 운영 데이터로 조사한 결과,
 * 더 근본적인 원인 하나가 더 있었다:
 *
 *   디테일뷰 타임라인의 "청소 중" 구간(세그먼트)은 **예약의 실제(raw iCal) 체크아웃 시각**에서
 *   시작하도록 만들어지는데(addResCycles/buildFutureSegments), 그 구간이 "배정됐는지"를 판단할
 *   때는 **cleaning_jobs가 체크아웃시각 설정(예: 매일 11시 KST) 기준으로 스스로 계산한 청소
 *   시작 시각**과 "겹치는지"로 확인했다. 그런데 실제 운영 데이터를 보니 이 두 시각이 같은
 *   날짜인데도 최대 9시간까지 차이 나는 예약들이 있어서(raw 체크아웃 시각 자체가 들쭉날쭉),
 *   사실상 거의 매번 안 겹쳐 "미배정"으로 잘못 떴다. 이 매칭은 두 군데에 있었다:
 *     ① calendarSyncService.js의 buildLiveProperty — cleaningSlots와 겹치는지로 매번
 *        cleaningStatus를 다시 계산해서 덮어씀(이미 Postgres에서 날짜 기준으로 정확히
 *        매칭된 값이 있어도 무시하고 덮어씀).
 *     ② PropertyDetailView.jsx의 cleaningInfoMap — 역시 겹침으로 찾음.
 *   둘 다 고쳐야 실제로 화면에 정확한 값이 뜬다(①만 고치면 ②가 그 값을 다시 못 찾고,
 *   ②만 고치면 애초에 ①이 값을 이미 틀리게 덮어써 놓은 뒤라 소용없다).
 *
 * 고침:
 *   ① buildLiveProperty — 예약이 이미 cleaningStatus를 들고 있으면(Postgres 정본에서 온 값)
 *      그대로 두고, 겹침 재계산은 그 값이 아예 없을 때만 폴백으로 돌린다.
 *   ② PropertyDetailView의 cleaningInfoMap — 시간 겹침 대신, 세그먼트가 시작하는 시각과
 *      "정확히 같은 체크아웃 시각"을 가진 예약을 찾아 그 예약 자신의 cleaningStatus를
 *      그대로 쓴다(세그먼트는 애초에 그 예약의 checkOut에서 시작하도록 만들어지므로 항상
 *      정확히 일치한다 — 폴백용 겹침 계산 자체가 불필요해짐).
 *
 * 레이어: L1 — buildLiveProperty 실제 호출(①). L2 — PropertyDetailView.jsx 소스 계약(②).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildLiveProperty, lastPastReservation, deriveCurrentState } from '../../src/application/calendarSyncService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const TEMPLATE = {
  id: 'test-prop', name: '테스트숙소', district: '', sensors: null,
  checkInHour: 15, checkOutHour: 11, cleaningDurationHours: 3,
};

function makeReservation({ checkIn, checkOut, cleaningStatus, cleanerName }) {
  return {
    uid: `res:${checkOut}`,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut),
    ...(cleaningStatus ? { cleaningStatus } : {}),
    ...(cleanerName ? { cleanerName } : {}),
  };
}

describe('buildLiveProperty — 예약이 이미 cleaningStatus를 들고 있으면 겹침 재계산으로 덮어쓰지 않는다 (①)', () => {
  const now = new Date('2026-10-30T00:00:00Z');

  test('예약의 raw 체크아웃 시각이 cleaningSlots 시각과 9시간 어긋나도, 이미 ASSIGNED면 그대로 ASSIGNED', () => {
    // 실제 운영에서 관찰된 패턴 그대로: 예약 체크아웃은 11:00 UTC, 청소 슬롯은 같은 날 02:00-05:00 UTC
    const reservations = [
      makeReservation({
        checkIn: '2026-11-07T15:00:00Z', checkOut: '2026-11-08T11:00:00Z',
        cleaningStatus: 'ASSIGNED', cleanerName: '김철수',
      }),
    ];
    // cleaningSlots가 있어도(비어있지 않아도) 겹치지 않는 시각이라 old 로직이면 UNASSIGNED로 덮였을 것
    const cleaningSlots = [
      { start: new Date('2026-11-08T02:00:00Z'), end: new Date('2026-11-08T05:00:00Z'), cleanerName: '김철수' },
    ];
    const live = buildLiveProperty(TEMPLATE, reservations, cleaningSlots);
    const res = live.reservations.find(r => r.checkOut.getTime() === new Date('2026-11-08T11:00:00Z').getTime());
    assert.ok(res, '해당 예약을 찾지 못함');
    assert.equal(res.cleaningStatus, 'ASSIGNED', '이미 ASSIGNED인 예약이 겹침 재계산으로 UNASSIGNED로 덮이면 안 됨');
    assert.equal(res.cleanerName, '김철수');
  });

  test('(회귀 방지) cleaningStatus가 아예 없는 예약은 여전히 cleaningSlots 겹침으로 폴백 계산된다', () => {
    // 겹침 매칭은 "이 예약의 체크인 이전, 직전 체크아웃 이후"의 슬롯을 찾는 방식(청소=입실 준비)
    const reservations = [
      makeReservation({ checkIn: '2026-11-06T15:00:00Z', checkOut: '2026-11-09T02:00:00Z' }), // cleaningStatus 없음
    ];
    const cleaningSlots = [
      { start: new Date('2026-11-06T02:00:00Z'), end: new Date('2026-11-06T05:00:00Z'), cleanerName: '이영희' },
    ];
    const live = buildLiveProperty(TEMPLATE, reservations, cleaningSlots);
    const res = live.reservations[0];
    assert.equal(res.cleaningStatus, 'ASSIGNED', '폴백 겹침 매칭 자체는 여전히 동작해야 함(기존 동작 유지)');
    assert.equal(res.cleanerName, '이영희');
  });

  test('cleaningStatus 없고 겹치는 슬롯도 없으면 UNASSIGNED (기존 동작 유지)', () => {
    const reservations = [
      makeReservation({ checkIn: '2026-11-06T15:00:00Z', checkOut: '2026-11-09T02:00:00Z' }),
    ];
    // 슬롯은 있지만(빈 배열 아님) 이 예약의 체크인 이전 구간과 안 겹침 → "슬롯 못 찾음" 경로
    const cleaningSlots = [
      { start: new Date('2026-12-01T02:00:00Z'), end: new Date('2026-12-01T05:00:00Z'), cleanerName: '아무개' },
    ];
    const live = buildLiveProperty(TEMPLATE, reservations, cleaningSlots);
    assert.equal(live.reservations[0].cleaningStatus, 'UNASSIGNED');
  });
});

describe('PropertyDetailView.jsx — cleaningInfoMap이 체크아웃 시각 동일성으로 예약 자신의 cleaningStatus를 읽는다 (②)', () => {
  const src = read('src/components/v2/PropertyDetailView.jsx');
  const fnMatch = src.match(/const cleaningInfoMap = useMemo\(\(\) => \{[\s\S]*?\}, \[recentSegs, property\.reservations\]\);/);

  test('cleaningInfoMap 블록을 찾을 수 있다', () => {
    assert.ok(fnMatch, 'cleaningInfoMap 정의를 찾지 못함(의존성 배열이 바뀌었다면 정규식도 갱신 필요)');
  });

  test('(회귀 방지) property.cleaningSlots로 시간 겹침을 찾는 옛 방식이 남아있지 않다', () => {
    assert.doesNotMatch(
      fnMatch[0],
      /property\.cleaningSlots/,
      'cleaningSlots 시간 겹침 매칭으로 되돌아가면, 예약의 raw 체크아웃 시각과 계산된 청소 시각이' +
      ' 달라 거의 항상 "미배정"으로 잘못 보이는 버그가 재발한다'
    );
  });

  test('세그먼트 시작 시각과 예약의 checkOut이 정확히 같은 예약을 찾는다', () => {
    assert.match(fnMatch[0], /r\.checkOut\.getTime\(\)\s*===\s*seg\.start\.getTime\(\)/);
  });

  test('찾은 예약 자신의 cleaningStatus를 그대로 쓴다(재계산 없음)', () => {
    assert.match(fnMatch[0], /cleaningStatus:\s*res\.cleaningStatus/);
  });

  test('(2차 리뷰로 발견한 회귀 수정) 정확히 일치하는 예약이 없으면(지금 진행 중인 세그먼트는' +
       ' 시작 시각이 "지금"으로 잘림) 가장 최근에 체크아웃한 예약으로 폴백한다', () => {
    assert.match(
      fnMatch[0],
      /\?\?\s*lastCheckedOut/,
      '폴백이 없으면 "지금 한창 청소 중"인 숙소가 실제론 배정돼 있어도 항상 미배정으로 잘못 보인다' +
      ' — 가장 눈에 띄는 케이스라 리뷰에서 지적된 치명적 회귀'
    );
  });

  test('(3차 리뷰로 발견) lastCheckedOut을 따로 구현하지 않고 deriveCurrentState/deriveTimeline과' +
       ' 똑같은 lastPastReservation을 그대로 재사용한다', () => {
    // 따로 구현(inline filter+sort)하면, deriveTimeline 쪽 선택 기준이 나중에 바뀌어도 여기는
    // 안 따라가 조용히 달라질 수 있다 — 아예 한 함수만 쓰게 해서 구조적으로 못 갈라지게 한다.
    assert.match(src, /import \{ lastPastReservation \} from '\.\.\/\.\.\/application\/calendarSyncService\.js';/);
    assert.match(fnMatch[0], /lastPastReservation\(reservations, new Date\(\)\)/);
    assert.doesNotMatch(
      fnMatch[0],
      /\.sort\(\(a,\s*b\)\s*=>\s*b\.checkOut/,
      '체크아웃 시각 기준으로 직접 다시 정렬하는 코드가 남아있으면 lastPastReservation을 안 쓰고' +
      ' 또 따로 구현한 것 — 겹치는 예약에서 deriveTimeline과 다른 예약을 "지금"으로 가리킬 수 있음'
    );
  });

  test('(1차 리뷰로 발견한 회귀 수정) cleaningStatus 필드가 전혀 없는 숙소(목업/데모)는' +
       ' 매칭을 아예 돌리지 않는다 — 전부 "미배정"으로 잘못 보이는 걸 막음', () => {
    assert.doesNotMatch(
      fnMatch[0],
      /if \(!reservations\.length\) return map;/,
      '예약 개수만 보고 통과시키면, cleaningStatus 필드 자체가 없는 목업 숙소(P001~P020 등)도' +
      ' 전부 매칭을 돌려서 모든 예약이 가짜 "미배정" 배지를 달게 된다(D-020이 명시적으로' +
      ' 없앴던 목업 노이즈가 되돌아옴, 실제 PROPERTIES 데이터로 재현 확인됨)'
    );
    assert.match(
      fnMatch[0],
      /const tracksCleaning = reservations\.some\(r => r\.cleaningStatus != null\);\s*\n\s*if \(!tracksCleaning\) return map;/,
      '예약 중 cleaningStatus 필드를 하나라도 들고 있는 숙소(=실제 운영 숙소)만 매칭을 돌려야 함'
    );
  });
});

describe('calendarSyncService.js — lastPastReservation (체크아웃이 지난 예약 중 "체크인 순서상 마지막" 것)', () => {
  function res(checkIn, checkOut, tag) {
    return { tag, checkIn: new Date(checkIn), checkOut: new Date(checkOut) };
  }
  const now = new Date('2026-10-30T12:00:00Z');

  test('체크아웃이 지난 예약이 없으면 null', () => {
    assert.equal(lastPastReservation([res('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', 'future')], now), null);
  });

  test('체크아웃이 지난 예약 중 배열상 마지막(체크인 순) 것을 고른다', () => {
    const reservations = [
      res('2026-10-20T00:00:00Z', '2026-10-22T00:00:00Z', 'A'),
      res('2026-10-25T00:00:00Z', '2026-10-28T00:00:00Z', 'B'),
    ];
    assert.equal(lastPastReservation(reservations, now).tag, 'B');
  });

  test('(3차 리뷰 핵심) 예약이 겹쳐 있을 때(체크아웃 시각이 아니라) 체크인 순서상 마지막 것을' +
       ' 고른다 — deriveCurrentState가 "지금 청소 중"으로 보는 예약과 반드시 같은 결과를 낸다', () => {
    // A는 B를 통째로 감싸는 더 긴 숙박(체크인 더 이름 10/18, 체크아웃 더 늦음 10/27) — 배열은
    // 이미 체크인 순 정렬(서버가 ORDER BY check_in으로 내려줌, D-016/listProperties)이라고 가정.
    const reservations = [
      res('2026-10-18T00:00:00Z', '2026-10-27T00:00:00Z', 'A_longer_but_earlier_checkin'),
      res('2026-10-20T00:00:00Z', '2026-10-24T00:00:00Z', 'B_shorter_but_later_checkin'),
    ];
    const picked = lastPastReservation(reservations, now);
    assert.equal(picked.tag, 'B_shorter_but_later_checkin', 'checkOut 기준으로 고르면 A가 뽑히는데, 그건 deriveCurrentState와 달라짐');

    // 두 선택이 실제로 다른 결과를 내는 시점으로 교차 확인: A 체크아웃(10/27) 1시간 뒤는
    // A 기준이면 청소중(2.5시간 이내)이지만, B 체크아웃(10/24)으로부터는 사흘이 지나 청소중이
    // 아니다 — lastPastReservation이 (버그처럼) A를 골랐다면 이 시점에 CLEANING이어야 한다.
    const soonAfterA = new Date('2026-10-27T01:00:00Z');
    const state = deriveCurrentState(reservations, soonAfterA, 2.5);
    assert.notEqual(
      state.mainStatus, 'CLEANING',
      'A를 기준으로 판단했다면(체크아웃 정렬 버그) 이 시점엔 CLEANING이어야 하는데 아니라면' +
      ' lastPastReservation이 deriveCurrentState와 다른 예약을 고르고 있다는 뜻'
    );
  });
});
