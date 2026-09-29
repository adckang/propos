/**
 * s66 — 모바일 화면에서 운영 지표 표 레이아웃 깨짐 수정 (D-030)
 *
 * 사용자 지적(2026-09-28): "모바일 모드 브라우저로 들어가면, 운영지표가 세로쓰기처럼 나오고.
 * 표의 배치가 형편없어져. 우측 작은 화살표들은 공간을 많이 차지하고 있어. 그리고 이 레포트를
 * 감싸는 박스들은 여백없이 해도 좋겠어"
 *
 * 원인: SharedMetricRow가 데스크톱/모바일 구분 없이 항상 고정 픽셀 그리드(건수 64px + 성공률
 * 50px + 배지 76px + 화살표 16px = 206px)를 썼고, EventMatrixPanel도 isMobile을 받으면서
 * SharedMetricRow에 전달하지 않고 있었다. 좁은 화면에서 라벨(1fr)에 남는 폭이 거의 없어
 * "청소 담당자 배정" 같은 라벨이 한두 글자씩 줄바꿈되며 세로로 늘어선 것처럼 보였다. 게다가
 * ActiveHybridPanel(이번 달/이번 주 등 진행 중 기간)이 감싸는 박스 자체에도 좌우 패딩이 있어,
 * 완료 섹션 테두리 박스 + EventMatrixPanel 패딩 + 안쪽 표 박스 패딩까지 3중으로 쌓여 있었다.
 *
 * 레이어: L2(소스 계약) — 순수 스타일 값 조정이라 새 도메인 로직 없음.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('SharedMetricRow.jsx — 모바일 전용 그리드 템플릿이 데스크톱보다 고정 칼럼 예산이 작다', () => {
  const src = read('src/components/v2/reporting/SharedMetricRow.jsx');

  test('ROW_GRID_TEMPLATE_MOBILE이 export되고, 고정 4칼럼 합이 데스크톱보다 작다(라벨에 더 넓은 폭을 준다)', () => {
    const desktopMatch = src.match(/export const ROW_GRID_TEMPLATE = '1fr ([\d\s]+px[\d\s]+px[\d\s]+px[\d\s]+px)';/);
    const mobileMatch  = src.match(/export const ROW_GRID_TEMPLATE_MOBILE = '1fr ([\d\s]+px[\d\s]+px[\d\s]+px[\d\s]+px)';/);
    assert.ok(desktopMatch, 'ROW_GRID_TEMPLATE 형식이 예상과 다름');
    assert.ok(mobileMatch, 'ROW_GRID_TEMPLATE_MOBILE이 없음');
    const sum = (s) => (s.match(/\d+/g) ?? []).reduce((a, b) => a + Number(b), 0);
    assert.ok(sum(mobileMatch[1]) < sum(desktopMatch[1]), '모바일 고정 칼럼 예산이 데스크톱보다 작아야 함');
  });

  test('isMobile prop을 받아 baseStyle의 gridTemplateColumns/columnGap을 분기한다', () => {
    assert.match(src, /isMobile\s*=\s*false,/);
    assert.match(src, /gridTemplateColumns:\s*isMobile\s*\?\s*ROW_GRID_TEMPLATE_MOBILE\s*:\s*ROW_GRID_TEMPLATE/);
    assert.match(src, /columnGap:\s*isMobile\s*\?\s*4\s*:\s*6/);
  });
});

describe('EventMatrixPanel.jsx — isMobile을 각 SharedMetricRow에 전달하고, 박스 좌우 패딩을 줄인다', () => {
  const src = read('src/components/v2/reporting/EventMatrixPanel.jsx');

  test('MetricRow(SharedMetricRow)에 isMobile을 넘긴다 — 이전엔 EventMatrixPanel이 isMobile을 받고도 전달을 안 해서 항상 데스크톱 그리드로 렌더링됐음', () => {
    assert.match(src, /<MetricRow[\s\S]{0,220}isMobile=\{isMobile\}/);
  });

  test('헤더 행도 같은 isMobile 분기로 그리드 템플릿을 고른다(행과 항상 정렬 유지)', () => {
    assert.match(src, /gridTemplateColumns:\s*isMobile\s*\?\s*ROW_GRID_TEMPLATE_MOBILE\s*:\s*ROW_GRID_TEMPLATE/);
  });

  test('모바일에서 바깥 박스·안쪽 표 박스 좌우 패딩이 데스크톱보다 작다', () => {
    assert.match(src, /padding:\s*isMobile\s*\?\s*'10px 4px'\s*:\s*'16px 20px'/);
    assert.match(src, /padding:\s*isMobile\s*\?\s*'0 8px'\s*:\s*'0 14px'/);
  });
});

describe('ActiveHybridPanel.jsx — 모바일에서 좌우 여백을 없애 안쪽 박스들의 패딩이 겹겹이 쌓이지 않게 한다', () => {
  const src = read('src/components/v2/reporting/ActiveHybridPanel.jsx');

  test('모바일 패딩에 좌우 값이 없다(위아래만)', () => {
    assert.match(src, /padding:\s*isMobile\s*\?\s*'10px 0'\s*:\s*'16px 20px'/);
  });
});
