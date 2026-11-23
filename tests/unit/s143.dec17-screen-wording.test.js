/**
 * DEC-17 화면 문구 (2026-11-23 사용자 결정)
 *  - 지난 기간 요약 끝의 "노쇼 의심 N건 확인이 필요해요" 안내는 없앤다 — 입실 미감지는 문제 목록·이상 건수에 있다 (s92·s21·s49·s62)
 *  - 대시보드 칩은 문제 목록과 같은 말 "청소 미배정 N건"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('대시보드 칩: "청소 미배정 N건" — "청소 미할당"은 쓰지 않는다', () => {
  const view = read('src/components/v2/MonthlyView.jsx');
  assert.match(view, /`🧹 청소 미배정 \$\{unassignedCleaningCount\}건`/);
  assert.doesNotMatch(view, /청소 미할당/);
});

test('요약 안내 함수가 남아 있지 않다', () => {
  for (const path of ['src/domain/reportSummaryDomain.js', 'src/application/reportingService.js', 'src/application/demoReportingService.js']) {
    assert.doesNotMatch(read(path), /appendPastNoShowNotice|노쇼 의심/, path);
  }
});
