/**
 * s60 — ListView: 타임라인 네비게이터를 레포트 패널 위로 올려서 "레포트 ↔ 하이라이트 박스"를 붙인다
 *
 * 사용자 피드백 (2026-09-24): D-022(레포트 기간 하이라이트 박스)를 만들고 나서도 "타임라인에
 * 표시된 구간이 레포트에 해당하는 기간이라는 게 직관적으로 와닿지 않는다"는 지적이 이어졌다.
 * 색을 맞추는 것만으로는(테두리 색 = 레포트 배지 색) 사용자가 스스로 매칭해야 해서 약하다고
 * 판단, 사용자가 직접 제안한 해법: "레포트 패널 위로 네비게이션 패널을 올리면 레포트 패널과
 * 하이라이트 박스가 바로 붙는다" — 기존엔 [레포트 패널] → [네비게이터] → [타임라인] 순서라
 * 네비게이터가 둘 사이에 끼어 있었다. 네비게이터를 맨 위로 올려 [네비게이터] → [레포트 패널] →
 * [타임라인(하이라이트 박스)] 순서로 바꾸면, 레포트 패널 바로 아래에 하이라이트 박스가 이어져
 * 물리적 인접성으로 "이게 그 얘기구나"가 바로 보인다. (DetailView는 세로 스크롤 캔버스라 같은
 * 효과가 안 나서 이번엔 보류 — 사용자 확인.)
 *
 * 레이어: L2 — 실제 소스 파일의 JSX 순서를 계약으로 검증(순수 리오더라 새 로직은 없음).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('PropertyListView — ListViewFilter(네비게이터)가 레포트 패널보다 먼저 렌더링된다', () => {
  const src = read('src/components/v2/PropertyListView.jsx');

  test('상태 필터 바 다음 순서가 [ListViewFilter] → [요약 배너/레포트 패널] → [간트+하이라이트]다', () => {
    const navIdx    = src.indexOf('<ListViewFilter');
    const reportIdx = src.indexOf('{noSelection ? (');
    const ganttIdx  = src.indexOf('간트 헤더 + 목록 래퍼');
    assert.ok(navIdx > 0 && reportIdx > 0 && ganttIdx > 0, '세 구간을 모두 찾지 못함');
    assert.ok(navIdx < reportIdx, 'ListViewFilter가 레포트 블록보다 뒤에 있음');
    assert.ok(reportIdx < ganttIdx, '레포트 블록이 간트(하이라이트 박스)보다 뒤에 있음');
  });

  test('ListViewFilter는 상태 필터 바로 다음, 다른 블록 없이 바로 이어진다', () => {
    const filterBarIdx = src.indexOf('상태 필터 바');
    const navIdx = src.indexOf('<ListViewFilter');
    const between = src.slice(filterBarIdx, navIdx);
    // 상태 필터 바의 닫는 div 이후 ListViewFilter 시작 전까지 다른 최상위 섹션(레포트/요약)이 끼어들면 안 됨
    assert.ok(!between.includes('SummaryBanner'), '상태 필터 바와 네비게이터 사이에 SummaryBanner가 끼어 있음');
  });

  test('레포트 패널(SummaryBanner) 바로 다음이 간트 래퍼(하이라이트 박스 포함) — 그 사이에 네비게이터가 없다', () => {
    const reportIdx = src.indexOf('{noSelection ? (');
    const ganttIdx  = src.indexOf('간트 헤더 + 목록 래퍼');
    const between = src.slice(reportIdx, ganttIdx);
    assert.ok(!between.includes('<ListViewFilter'), '레포트 패널과 간트 사이에 네비게이터가 남아 있음 — 리오더가 적용되지 않음');
  });

  test('ListViewFilter의 props(windowOffset/mode 등 제어 대상)는 리오더 이후에도 그대로다', () => {
    assert.match(src, /<ListViewFilter\s+windowOffset=\{windowOffset\}\s+onOffsetChange=\{setWindowOffset\}\s+mode=\{listMode\}\s+onModeChange=\{setListMode\}\s+isMobile=\{isMobile\}\s+\/>/);
  });
});
