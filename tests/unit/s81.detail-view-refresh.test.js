/**
 * s81 — 디테일뷰 진입 시 청소 배정(cleaningSlots) 새로고침
 *
 * 사용자가 실사용 중 발견(2026-10-30): 관리자가 콘솔로 청소 배정(cleaning_jobs)을 직접
 * 복구한 뒤, 대시보드 캘린더뷰에는 "배정완료"로 바로 반영됐는데 디테일뷰는 여전히
 * "미배정"으로 보였다. "같은 데이터를 보는 거 아니냐"는 질문에 조사한 결과:
 *   - 같은 테이블(cleaning_jobs)을 보는 건 맞다 — 쿼리 로직이 서로 다른 게 아니다.
 *   - 대신 두 화면의 "언제 다시 받아오는지"가 다르다. MonthlyCalendar.jsx는 자기 자신이
 *     마운트될 때마다(대시보드를 열 때마다) /api/cleaning/stats를 새로 받아온다. 반면
 *     PropertyDetailView의 cleaningSlots는 RoomStateApp의 최상위 상태(dbPropertyRows)에서
 *     파생되는데, 이 상태는 앱이 처음 열릴 때 한 번 + 15분 주기로만 갱신된다
 *     (view를 dashboard↔detail로 전환해도 다시 안 받아옴).
 * 고침: view가 'detail'이 될 때마다 refreshDbProperties()를 호출 — MonthlyCalendar와
 * 같은 "열 때마다 새로 받아온다" 원칙으로 맞춤. 15분 주기 자동 동기화(runSync)는 그대로 유지.
 *
 * 레이어: L2 — RoomStateApp.jsx 소스 계약(이펙트 존재·가드·의존성 배열).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('RoomStateApp.jsx — view가 detail이 될 때마다 dbPropertyRows를 새로 받아온다', () => {
  const src = read('src/components/v2/RoomStateApp.jsx');

  test("view === 'detail'일 때 refreshDbProperties()를 호출하는 이펙트가 있다", () => {
    const m = src.match(/useEffect\(\(\) => \{\s*if \(USE_DEMO_DATA \|\| view !== 'detail'\) return;\s*refreshDbProperties\(\);\s*\}, \[view, refreshDbProperties\]\);/);
    assert.ok(m, '디테일뷰 진입 시 refreshDbProperties를 호출하는 이펙트를 찾지 못함');
  });

  test('demo 프로필에서는 건너뛴다(USE_DEMO_DATA 가드) — dbPropertyRows는 hybrid/real에서만 의미 있음', () => {
    const block = src.match(/useEffect\(\(\) => \{\s*if \(USE_DEMO_DATA \|\| view !== 'detail'\) return;[\s\S]*?\}, \[view, refreshDbProperties\]\);/);
    assert.ok(block);
    assert.match(block[0], /USE_DEMO_DATA/);
  });

  test('의존성 배열이 [view, refreshDbProperties] — view 전환마다 재실행된다', () => {
    assert.match(src, /\}, \[view, refreshDbProperties\]\);/);
  });

  test('기존 15분 주기 동기화(runSync)는 그대로 유지된다(이번 수정이 지우지 않았다)', () => {
    assert.match(src, /setInterval\(\(\) => runSync\(syncConfig\), 15 \* 60 \* 1000\)/);
  });

  test('refreshDbProperties는 기존 함수를 재사용한다(새 fetch 로직을 중복 작성하지 않음)', () => {
    assert.match(src, /const refreshDbProperties = useCallback\(async \(\) => \{\s*const rows = await fetchCloudProperties\(\);/);
  });
});
