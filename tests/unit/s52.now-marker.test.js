/**
 * s52 — 월간 캘린더(대시보드)의 "지금" 표시
 *
 * 사용자 요청 (2026-09-21): 대시보드의 캘린더에도 리스트 화면과 같은 방식으로 "지금"을 표시한다.
 *   - 오늘 칸: 날짜를 진하고 굵게 + 현재 시각 위치의 굵은 세로선 위에 "지금 PM 10:11" 표식과 점
 *             (리스트 화면의 타임라인처럼 표식 → 점 → 선. 캘린더 제목 옆이 아니라 오늘 칸 안)
 *   - 하단 범례: "지금 (현재)"
 *   - 오늘 칸이 그 달력에 보일 때만 표시
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { kstNowMarker } from '../../src/domain/nowMarkerDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// A. kstNowMarker — 오늘 날짜·하루 중 위치·시각 라벨 (KST)
// ══════════════════════════════════════════════════════════════════════════
describe('kstNowMarker — 오늘 날짜와 시각 라벨', () => {
  test('KST 22:11 → 오늘 날짜, "PM 10:11"', () => {
    const m = kstNowMarker(new Date('2026-09-21T13:11:00Z'));
    assert.equal(m.dateKey, '2026-09-21');
    assert.equal(m.label, 'PM 10:11');
  });

  test('자정 00:00 → "AM 12:00", 하루의 시작(0)', () => {
    const m = kstNowMarker(new Date('2026-09-20T15:00:00Z')); // KST 9/21 00:00
    assert.equal(m.dateKey, '2026-09-21');
    assert.equal(m.label, 'AM 12:00');
    assert.equal(m.dayFraction, 0);
  });

  test('정오 12:00 → "PM 12:00", 하루의 딱 절반', () => {
    const m = kstNowMarker(new Date('2026-09-21T03:00:00Z'));
    assert.equal(m.label, 'PM 12:00');
    assert.equal(m.dayFraction, 0.5);
  });

  test('오전/오후 경계: 11:59 → AM 11:59, 12:01 → PM 12:01, 13:05 → PM 1:05', () => {
    assert.equal(kstNowMarker(new Date('2026-09-21T02:59:00Z')).label, 'AM 11:59');
    assert.equal(kstNowMarker(new Date('2026-09-21T03:01:00Z')).label, 'PM 12:01');
    assert.equal(kstNowMarker(new Date('2026-09-21T04:05:00Z')).label, 'PM 1:05');
  });

  test('분은 항상 두 자리 (AM 12:05)', () => {
    assert.equal(kstNowMarker(new Date('2026-09-20T15:05:00Z')).label, 'AM 12:05');
  });

  test('23:59:59.999 → 아직 같은 날, 위치는 1 미만', () => {
    const m = kstNowMarker(new Date('2026-09-21T14:59:59.999Z'));
    assert.equal(m.dateKey, '2026-09-21');
    assert.ok(m.dayFraction < 1 && m.dayFraction > 0.999);
    assert.equal(m.label, 'PM 11:59');
  });

  test('UTC 날짜와 KST 날짜가 다른 시각 (UTC 9/20 20:00 = KST 9/21 05:00)', () => {
    const m = kstNowMarker(new Date('2026-09-20T20:00:00Z'));
    assert.equal(m.dateKey, '2026-09-21');
    assert.equal(m.label, 'AM 5:00');
  });

  test('연말 경계: UTC 12/31 15:00 = KST 다음 해 1/1 00:00', () => {
    assert.equal(kstNowMarker(new Date('2026-12-31T15:00:00Z')).dateKey, '2027-01-01');
  });

  test('날짜 키는 월간 캘린더 칸의 key 형식(YYYY-MM-DD, 0 채움)', () => {
    assert.match(kstNowMarker(new Date('2026-03-04T03:00:00Z')).dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(kstNowMarker(new Date('2026-03-04T03:00:00Z')).dateKey, '2026-03-04');
  });

  test('하루 중 위치는 시간이 갈수록 커지고 항상 [0, 1)', () => {
    let prev = -1;
    for (let h = 0; h < 24; h++) {
      const f = kstNowMarker(new Date(Date.UTC(2026, 8, 20, 15 + h, 30))).dayFraction; // KST h:30 (다음날 새벽 포함)
      assert.ok(f >= 0 && f < 1, `h=${h} f=${f}`);
      assert.ok(f > prev, `h=${h} 증가해야 함`);
      prev = f;
    }
  });

  test('인자를 생략하면 현재 시각으로 계산한다', () => {
    assert.match(kstNowMarker().dateKey, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. MonthlyCalendar 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('MonthlyCalendar — "지금" 표시 배선', () => {
  const src = read('src/components/v2/reporting/MonthlyCalendar.jsx');

  test('현재 시각을 1분 주기 훅으로 받아 KST 기준으로 계산한다', () => {
    assert.match(src, /useNow\(\)/);
    assert.match(src, /kstNowMarker\(now\)/);
  });

  test('오늘 칸에만 표식(시각 표식 + 점 + 세로선)을 그린다 (isToday 조건)', () => {
    assert.match(src, /isToday\s*&&\s*<NowCellMarker\s+fraction=\{nowMarker\.dayFraction\}\s+label=\{nowMarker\.label\}/);
    assert.match(src, /const isToday = cell\.key === nowMarker\.dateKey/);
  });

  test('시각 표식은 캘린더 제목 옆이 아니라 오늘 칸 안에만 있다', () => {
    assert.ok(!/<NowPill/.test(src), 'MonthlyCalendar 에서 NowPill 을 직접 쓰면 제목 옆 등에 떠버릴 수 있음');
    const h2 = src.slice(src.indexOf('<h2'), src.indexOf('</h2>'));
    assert.ok(!/Now/.test(h2), '제목(h2)에 "지금" 표식이 섞여 있음');
    assert.equal((src.match(/<NowCellMarker/g) ?? []).length, 1, '오늘 칸 한 곳에서만 사용');
  });

  test('오늘 칸은 표식 자리만큼 날짜 숫자·문제 배지를 아래로 내린다 (겹치지 않게)', () => {
    assert.match(src, /nowShift = isToday \? nowStripHeight\(isMobile\) : 0/);
    assert.match(src, /\$\{5 \+ nowShift\}px 4px 5px/);
    assert.match(src, /\$\{7 \+ nowShift\}px 7px 7px/);
    assert.match(src, /top: \(isMobile \? 23 : 29\) \+ nowShift/);
  });

  test('오늘 날짜는 진하고 굵게 (리스트 화면의 오늘 표시와 같은 #1a202c / 700)', () => {
    assert.match(src, /isToday \? '#1a202c'/);
    assert.match(src, /fontWeight: isToday \? 700 : 400/);
  });

  test('하단 범례는 오늘 칸이 달력에 보일 때만', () => {
    assert.match(src, /todayInGrid\s*&&\s*\(\s*<div[\s\S]*?<NowLegendItem/);
    assert.match(src, /const todayInGrid = calendar\.cells\.some\(cell => cell\.key === nowMarker\.dateKey\)/);
  });

  test('훅은 "숙소를 선택해주세요" 조기 return 보다 앞에 있다 (Rules of Hooks)', () => {
    const early = src.indexOf('if (noSelection)');
    assert.ok(early > 0);
    assert.ok(src.indexOf('useNow()') < early, 'useNow 가 조기 return 뒤에 있음');
    assert.ok(src.indexOf('kstNowMarker(now)') < early, 'useMemo(kstNowMarker) 가 조기 return 뒤에 있음');
  });
});

describe('NowMarker 부품 — 리스트 화면과 같은 모양 (드리프트 방지)', () => {
  const marker = read('src/components/v2/reporting/NowMarker.jsx');
  const list   = read('src/components/v2/PropertyListView.jsx');

  test('세로선은 클릭을 가로막지 않는다 (문제 건수 배지 등 클릭 유지)', () => {
    assert.match(marker, /data-testid="now-marker-line"[\s\S]*?pointerEvents: 'none'/);
  });

  test('시각 표식은 칸 안에 가둔다 (이웃 날짜를 가리지 않게) — 선·점은 정확한 시각 위치', () => {
    assert.match(marker, /left: `clamp\(\$\{half\}px, \$\{pct\}, calc\(100% - \$\{half\}px\)\)`/);
    assert.match(marker, /<NowPill label=\{label\} compact=\{compact\} \/>/);
  });

  test('좁은 모바일 칸에서는 "지금" 글자를 빼고 칩을 작게 (칸 폭 약 53px 안에 들어가도록)', () => {
    assert.match(marker, /\{!compact && \(/);
    assert.match(marker, /fontSize: 8, padding: '1px 3px'/);
  });

  // 두 파일 모두에 있어야 하는 스타일 토큰 — 한쪽만 바꾸면 이 테스트가 실패한다
  const SHARED_TOKENS = [
    ["색 #1a202c",                     "'#1a202c'"],
    ['"지금" 글자 8px/800',            'fontSize: 8, fontWeight: 800'],
    ['시각 칩 9px/700',                'fontSize: 9, fontWeight: 700'],
    ['시각 칩 안쪽 여백',              "padding: '1px 5px'"],
    ['범례 막대 크기',                 'width: 2.5, height: 14'],
    ['범례 문구',                      '지금 (현재)'],
  ];
  for (const [name, token] of SHARED_TOKENS) {
    test(`공통 스타일: ${name}`, () => {
      assert.ok(list.includes(token), `PropertyListView 에 없음: ${token}`);
      assert.ok(marker.includes(token) || marker.includes(token.replace(/'/g, '')), `NowMarker 에 없음: ${token}`);
    });
  }

  test('시각 라벨은 리스트 화면과 같은 12시간제 규칙(AM/PM, h % 12 || 12)', () => {
    const domain = read('src/domain/nowMarkerDomain.js');
    assert.ok(list.includes("h < 12 ? 'AM' : 'PM'") && list.includes('h % 12 || 12'));
    assert.ok(domain.includes("hours < 12 ? 'AM' : 'PM'") && domain.includes('hours % 12 || 12'));
  });
});
