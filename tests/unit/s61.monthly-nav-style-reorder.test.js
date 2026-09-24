/**
 * s61 — 대시보드 "지난달/이번달/다음달" 버튼을 ListView "지난주/이번주/다음주"와 같은
 * 크기·모양으로 맞추고, 네비게이터를 레포트 패널 위로 올린다 (D-025)
 *
 * 사용자 요청 (2026-09-24): "dashboard의 '지난달, 이번달, 다음달' 버튼도 listview의
 * '지난주,이번주, 다음주' 버튼처럼 똑같은 사이즈와 모양으로 만들어주고. 레포트 패널과
 * 위치 바꿔. 리스트 뷰처럼." — D-024(ListView 네비게이터를 레포트 패널 위로)와 같은 이유로
 * 대시보드(MonthlyView)에도 적용.
 *
 * 레이어: L2 — 실제 소스 파일의 스타일 값·JSX 순서를 계약으로 검증(순수 스타일/리오더라
 * 새 로직은 없음).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('MonthlyViewFilter — ListViewFilter의 3버튼 네비게이터와 같은 치수/색', () => {
  const filterSrc = read('src/components/v2/reporting/MonthlyViewFilter.jsx');
  const listFilterSrc = read('src/components/v2/reporting/ListViewFilter.jsx');

  test('버튼이 flex:1로 균등하게 늘어난다 (기존의 justifyContent 중앙정렬 칩 방식이 아님)', () => {
    assert.match(filterSrc, /flex: 1,/);
    assert.ok(!filterSrc.includes("justifyContent: 'center'"), '아직 중앙정렬 칩 스타일이 남아 있음');
  });

  test('버튼 모양(테두리 반경 20, active 배경 #1a202c)이 ListViewFilter와 동일하다', () => {
    assert.match(filterSrc, /borderRadius: 20,/);
    assert.match(filterSrc, /background: active \? '#1a202c' : isCenter \? '#f8fafc' : '#fff',/);
    assert.match(filterSrc, /color: active \? '#fff' : isCenter \? '#374151' : '#94a3b8',/);
    // ListViewFilter의 "수평 네비게이터" 버튼과 같은 색 리터럴을 그대로 쓰는지 교차 확인
    assert.match(listFilterSrc, /background: active \? '#1a202c' : isCenter \? '#f8fafc' : '#fff',/);
  });

  test("가운데(이번달)는 ListView의 '오늘'/'이번주'처럼 isCenter로 강조되고, 폰트 크기·굵기도 동일하다", () => {
    assert.match(filterSrc, /const isCenter = i === 1;/);
    assert.match(filterSrc, /fontSize: isMobile \? 10 : 11,/);
    assert.match(filterSrc, /fontWeight: active \? 700 : isCenter \? 600 : 500,/);
  });

  test('data-testid는 그대로 유지 (다른 테스트가 이 셀렉터에 의존)', () => {
    assert.match(filterSrc, /data-testid="monthly-view-filter"/);
  });

  test('다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!filterSrc.toLowerCase().includes(c), c);
  });
});

describe('MonthlyView — 네비게이터(MonthlyViewFilter)가 레포트 패널(SelectedPropertyReport)보다 먼저 렌더링된다', () => {
  const src = read('src/components/v2/MonthlyView.jsx');

  test('JSX 순서가 [MonthlyViewFilter] → [SelectedPropertyReport] → [PropertyMultiSelectDropdown] → [MonthlyCalendar]다', () => {
    const navIdx      = src.indexOf('<MonthlyViewFilter');
    const reportIdx    = src.indexOf('<SelectedPropertyReport');
    const dropdownIdx = src.indexOf('<PropertyMultiSelectDropdown');
    const calendarIdx = src.indexOf('<MonthlyCalendar');
    assert.ok(navIdx > 0 && reportIdx > 0 && dropdownIdx > 0 && calendarIdx > 0, '네 컴포넌트를 모두 찾지 못함');
    assert.ok(navIdx < reportIdx, 'MonthlyViewFilter가 SelectedPropertyReport보다 뒤에 있음 — 리오더 미적용');
    assert.ok(reportIdx < dropdownIdx, 'SelectedPropertyReport가 PropertyMultiSelectDropdown보다 뒤에 있음');
    assert.ok(dropdownIdx < calendarIdx, 'PropertyMultiSelectDropdown이 MonthlyCalendar보다 뒤에 있음');
  });

  test('두 컴포넌트의 props는 리오더 이후에도 그대로다', () => {
    assert.match(src, /<MonthlyViewFilter statsPeriod=\{statsPeriod\} onPeriodChange=\{setStatsPeriod\} isMobile=\{isMobile\} \/>/);
    assert.match(src, /<SelectedPropertyReport statsPeriod=\{statsPeriod\} scopedProperties=\{scopedProperties\}/);
  });
});
