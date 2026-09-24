/**
 * s56 — 대시보드 캘린더(다음달) 칸의 체류/공실/입실/퇴실/청소배정을 각각 클릭 가능하게
 *
 * 사용자 요청 (2026-09-24, "dashboard의 캘린더 뷰 부분을 수정해달라는 말이었어" — 이전 s55는 레포트
 * 패널 얘기였고, 이번 건 캘린더 칸 자체 얘기임을 명확히 함):
 *   - 체류 N → 누르면 ListView의 해당 날짜로 이동, 체류 필터 적용
 *   - 공실 N → 누르면 ListView의 해당 날짜로 이동, 공실 필터 적용
 *   - 입실 N / 퇴실 N → 누르면 팝업에 숙소 리스트
 *   - "청소 N" 한 줄 → "배정완료 M / 미배정 K"로 표기(지금처럼 컬러로 하이라이트)
 *     · 배정완료 → 팝업에 숙소별 청소 담당자 리스트
 *     · 미배정 → 팝업에 배정요청중/수동배정 필요 등 주요 세부 상태 → 각각 또 누르면 숙소별 상세 목록
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildFutureCalendarDays,
  classifyDayCleaningItems,
  kstDayOffsetFromToday,
} from '../../src/domain/monthlyCalendarDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// A. kstDayOffsetFromToday — 캘린더 날짜 키 → ListView가 쓰는 "일 단위 오프셋"
// ══════════════════════════════════════════════════════════════════════════
describe('kstDayOffsetFromToday', () => {
  const NOW = new Date('2026-09-24T03:00:00Z'); // KST 9/24 12:00

  test('오늘 자기 자신 → 0', () => {
    assert.equal(kstDayOffsetFromToday('2026-09-24', NOW), 0);
  });

  test('내일 → 1, 어제 → -1', () => {
    assert.equal(kstDayOffsetFromToday('2026-09-25', NOW), 1);
    assert.equal(kstDayOffsetFromToday('2026-09-23', NOW), -1);
  });

  test('한 달 뒤(다음달 캘린더에서 클릭하는 상황) → 30', () => {
    assert.equal(kstDayOffsetFromToday('2026-10-24', NOW), 30);
  });

  test('KST 자정 근처에도 날짜가 밀리지 않는다 (UTC 23:30 = KST 08:30, 여전히 같은 날)', () => {
    const edge = new Date('2026-09-23T23:30:00Z'); // KST 9/24 08:30
    assert.equal(kstDayOffsetFromToday('2026-09-24', edge), 0);
    assert.equal(kstDayOffsetFromToday('2026-09-25', edge), 1);
  });

  test('연도가 바뀌는 경계도 정확', () => {
    const dec31 = new Date('2026-12-31T15:00:00Z'); // KST 2027-01-01 00:00
    assert.equal(kstDayOffsetFromToday('2027-01-01', dec31), 0);
  });

  test('인자를 생략하면 현재 시각 기준 (throw 안 함)', () => {
    assert.equal(typeof kstDayOffsetFromToday('2026-09-24'), 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. buildFutureCalendarDays — 숙소 ID 목록도 함께 (체류/공실/입실/퇴실 팝업용)
// ══════════════════════════════════════════════════════════════════════════
describe('buildFutureCalendarDays — 숙소 ID 목록', () => {
  const range = { from: new Date('2026-09-28T15:00:00Z'), to: new Date('2026-10-05T15:00:00Z') }; // 9/29~10/5 KST

  test('체류/공실 숙소 ID를 properties 원래 순서로 나눠 담는다', () => {
    const properties = [
      { id: 'A', name: 'A', reservations: [{ checkIn: new Date('2026-09-20T15:00:00Z'), checkOut: new Date('2026-10-10T15:00:00Z') }] }, // 기간 내내 체류
      { id: 'B', name: 'B', reservations: [] }, // 기간 내내 공실
      { id: 'C', name: 'C', reservations: [{ checkIn: new Date('2026-09-20T15:00:00Z'), checkOut: new Date('2026-10-10T15:00:00Z') }] }, // 체류
    ];
    const days = buildFutureCalendarDays(properties, range, []);
    const day = days['2026-09-29'];
    assert.deepEqual(day.occupiedPropertyIds, ['A', 'C']);
    assert.deepEqual(day.vacantPropertyIds, ['B']);
    assert.equal(day.occupiedRooms, 2);
    assert.equal(day.vacantRooms, 1);
  });

  test('체류/공실 숙소 ID를 합치면 항상 전체 숙소가 된다 (중복·누락 없음)', () => {
    const properties = [
      { id: 'A', name: 'A', reservations: [{ checkIn: new Date('2026-09-30T15:00:00Z'), checkOut: new Date('2026-10-01T15:00:00Z') }] },
      { id: 'B', name: 'B', reservations: [] },
      { id: 'C', name: 'C', reservations: [] },
    ];
    const days = buildFutureCalendarDays(properties, range, []);
    for (const day of Object.values(days)) {
      const combined = [...day.occupiedPropertyIds, ...day.vacantPropertyIds].sort();
      assert.deepEqual(combined, ['A', 'B', 'C']);
    }
  });

  test('입실/퇴실 숙소 ID도 담는다 (KST 날짜 경계 — UTC 시각을 KST로 바꾼 날짜에 잡힌다)', () => {
    const properties = [
      // checkIn 9/29 15:00 UTC = KST 9/30 00:00 → "9/30"에 입실로 잡힌다
      { id: 'A', name: 'A', reservations: [{ checkIn: new Date('2026-09-29T15:00:00Z'), checkOut: new Date('2026-10-01T15:00:00Z') }] },
      // checkIn 9/28 15:00 UTC = KST 9/29 00:00 → "9/29"에 입실로 잡힌다
      { id: 'B', name: 'B', reservations: [{ checkIn: new Date('2026-09-28T15:00:00Z'), checkOut: new Date('2026-09-29T15:00:00Z') }] },
    ];
    const days = buildFutureCalendarDays(properties, range, []);
    assert.deepEqual(days['2026-09-29'].checkInPropertyIds, ['B']);
    assert.deepEqual(days['2026-09-30'].checkInPropertyIds, ['A']);
    assert.deepEqual(days['2026-09-30'].checkOutPropertyIds, ['B']);
    assert.equal(days['2026-09-29'].checkIns, 1);
    assert.equal(days['2026-09-30'].checkOuts, 1);
  });

  test('숙소가 없으면 모든 날짜가 빈 배열 (에러 없음)', () => {
    const days = buildFutureCalendarDays([], range, []);
    for (const day of Object.values(days)) {
      assert.deepEqual(day.occupiedPropertyIds, []);
      assert.deepEqual(day.vacantPropertyIds, []);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. classifyDayCleaningItems — 배정완료/배정요청중/수동배정필요
// ══════════════════════════════════════════════════════════════════════════
describe('classifyDayCleaningItems', () => {
  test('ASSIGNED/COMPLETED → assigned, 진행중 상태 → requesting, ESCALATED/CANCELLED → manual', () => {
    const items = [
      { property_id: 'A', status: 'ASSIGNED' },
      { property_id: 'B', status: 'COMPLETED' },
      { property_id: 'C', status: 'PENDING' },
      { property_id: 'D', status: 'NOTIFYING_VIP_2' },
      { property_id: 'E', status: 'ESCALATED' },
      { property_id: 'F', status: 'CANCELLED' },
    ];
    const result = classifyDayCleaningItems(items);
    assert.deepEqual(result.assigned.map(i => i.property_id), ['A', 'B']);
    assert.deepEqual(result.requesting.map(i => i.property_id), ['C', 'D']);
    assert.deepEqual(result.manual.map(i => i.property_id), ['E', 'F']);
  });

  test('빈 입력·미지정 상태도 안전', () => {
    assert.deepEqual(classifyDayCleaningItems([]), { assigned: [], requesting: [], manual: [], noJob: [] });
    assert.deepEqual(classifyDayCleaningItems([{ property_id: 'X', status: undefined }]), { assigned: [], requesting: [], manual: [], noJob: [] });
  });

  test('청소 잡이 없는 체크아웃 숙소는 noJob에 담긴다 ("퇴실 6건인데 배정완료 1건" 문제 해결)', () => {
    const items = [{ property_id: 'A', status: 'ASSIGNED' }];
    const checkOutPropertyIds = ['A', 'B', 'C', 'D', 'E', 'F']; // 퇴실 6건, 잡은 1건뿐
    const r = classifyDayCleaningItems(items, checkOutPropertyIds);
    assert.deepEqual(r.assigned.map(i => i.property_id), ['A']);
    assert.deepEqual(r.noJob, ['B', 'C', 'D', 'E', 'F']); // A는 잡이 있으니 제외, 순서는 원래 순서 유지
    assert.equal(r.assigned.length + r.requesting.length + r.manual.length + r.noJob.length, 6);
  });

  test('checkOutPropertyIds를 안 주면(과거 호출 호환) noJob은 항상 빈 배열', () => {
    const r = classifyDayCleaningItems([{ property_id: 'A', status: 'ASSIGNED' }]);
    assert.deepEqual(r.noJob, []);
  });

  test('잡이 있는 숙소는 상태와 무관하게 noJob에서 빠진다 (배정 요청중·수동배정 필요도 "계획은 있음")', () => {
    const items = [
      { property_id: 'A', status: 'PENDING' },
      { property_id: 'B', status: 'ESCALATED' },
    ];
    const r = classifyDayCleaningItems(items, ['A', 'B', 'C']);
    assert.deepEqual(r.noJob, ['C']);
  });

  test('세 분류를 합치면 입력 건수와 같다 (건 누락 없음)', () => {
    const items = [
      { property_id: 'A', status: 'ASSIGNED' }, { property_id: 'B', status: 'PENDING' },
      { property_id: 'C', status: 'ESCALATED' }, { property_id: 'D', status: 'BULK_REMINDED' },
      { property_id: 'E', status: 'CANCELLED' }, { property_id: 'F', status: 'COMPLETED' },
    ];
    const r = classifyDayCleaningItems(items);
    assert.equal(r.assigned.length + r.requesting.length + r.manual.length, items.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. MonthlyCalendar 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('MonthlyCalendar — 체류/공실 → ListView 날짜 이동, 입실/퇴실/청소배정 → 팝업', () => {
  const src = read('src/components/v2/reporting/MonthlyCalendar.jsx');

  test('onNavigateToList prop을 받는다', () => {
    assert.match(src, /onNavigateToList,/);
  });

  test('체류를 누르면 그 날짜 오프셋 + 그날의 체류/공실 숙소 ID를 함께 넘긴다', () => {
    assert.match(src, /onNavigateToList\?\.\(kstDayOffsetFromToday\(cell\.key\), 'OCCUPIED', \{ occupied: futureDay\.occupiedPropertyIds, vacant: futureDay\.vacantPropertyIds \}\)/);
  });

  test('공실을 누르면 같은 정보로 \'VACANT\'를 넘긴다', () => {
    assert.match(src, /onNavigateToList\?\.\(kstDayOffsetFromToday\(cell\.key\), 'VACANT', \{ occupied: futureDay\.occupiedPropertyIds, vacant: futureDay\.vacantPropertyIds \}\)/);
  });

  test('체류/공실/입실/퇴실 값이 0이면 눌리지 않는다 (DayStat)', () => {
    assert.match(src, /const clickable = value > 0 && !!onClick;/);
    assert.match(src, /onClick=\{clickable \? onClick : undefined\} disabled=\{!clickable\}/);
  });

  test('입실을 누르면 체크인 팝업, 퇴실을 누르면 체크아웃 팝업', () => {
    assert.match(src, /onClick=\{\(\) => setFuturePopup\(\{ day: cell\.key, kind: 'checkin' \}\)\}/);
    assert.match(src, /onClick=\{\(\) => setFuturePopup\(\{ day: cell\.key, kind: 'checkout' \}\)\}/);
  });

  test('청소 배정은 두 줄로 나뉜다 — "청소 배정 완료"는 일반 텍스트, "청소 미배정"만 빨간 배경 강조', () => {
    assert.match(src, /label="청소 배정 완료" value=\{assigned\}/);
    assert.match(src, /청소 미배정 \{unassigned\}/);
    // 배정 완료는 DayStat(일반 텍스트, 배경 없음) 재사용 — 하이라이트 없음
    assert.match(src, /<DayStat testId="future-cleaning-assigned" label="청소 배정 완료"/);
    // 미배정만 빨간 배경 pill
    const unassignedBtn = src.slice(src.indexOf('data-testid="future-cleaning-unassigned"'), src.indexOf('data-testid="future-cleaning-unassigned"') + 300);
    assert.match(unassignedBtn, /background: '#dc2626'/);
  });

  test('미배정 수는 배정요청중+수동배정필요+청소계획없음의 합 (퇴실 수와 항상 맞아떨어진다)', () => {
    assert.match(src, /const dayUnassigned = dayCleaning\.requesting\.length \+ dayCleaning\.manual\.length \+ dayCleaning\.noJob\.length;/);
    assert.match(src, /unassigned=\{dayUnassigned\}/);
  });

  test('청소 배정 완료·미배정이 하나도 없어도 퇴실 예정이 있으면(잡이 통째로 없음) 요약을 그린다', () => {
    assert.match(src, /\(dayCleaning\.assigned\.length > 0 \|\| dayUnassigned > 0\) && \(/);
  });

  test('classifyDayCleaningItems 호출에 그날의 checkOutPropertyIds를 넘긴다', () => {
    assert.match(src, /classifyDayCleaningItems\(futureDay\.cleaningItems, futureDay\.checkOutPropertyIds\)/);
    assert.match(src, /classifyDayCleaningItems\(popupDayData\?\.cleaningItems \?\? \[\], popupDayData\?\.checkOutPropertyIds \?\? \[\]\)/);
  });

  test('미배정 팝업은 배정요청중/수동배정필요에 더해 "청소 계획 없음"도 보여준다', () => {
    const start = src.indexOf("{futurePopup?.kind === 'unassigned' && (");
    const end = src.indexOf("{futurePopup?.kind === 'nojob' && (", start);
    assert.ok(start > 0 && end > start, '미배정 팝업 블록을 찾지 못함');
    const block = src.slice(start, end);
    assert.match(block, /label: '청소 계획 없음'/);
    assert.match(block, /value: popupCleaning\.noJob\.length/);
  });

  test('"청소 계획 없음"을 누르면 그 숙소들의 이름 목록 팝업이 뜨고, 숙소를 누르면 그 숙소로 이동한다', () => {
    const start = src.indexOf("{futurePopup?.kind === 'nojob' && (");
    assert.ok(start > 0);
    const end = src.indexOf('\n      )}', start) + '\n      )}'.length;
    const block = src.slice(start, end);
    assert.match(block, /staticItems=\{popupCleaning\.noJob\}/);
    assert.match(block, /<SimpleListRow/);
    assert.match(block, /sub="청소 잡 미생성"/);
    assert.match(block, /selectPropertyById\(propertyId\)/);
  });

  test('배정완료 배지를 누르면 assigned 팝업, 미배정 배지를 누르면 unassigned 팝업', () => {
    assert.match(src, /onAssignedClick=\{\(\) => setFuturePopup\(\{ day: cell\.key, kind: 'assigned' \}\)\}/);
    assert.match(src, /onUnassignedClick=\{\(\) => setFuturePopup\(\{ day: cell\.key, kind: 'unassigned' \}\)\}/);
  });

  test('배정완료 팝업은 AssignedCleanerRow로 숙소별 청소 담당자를 보여준다', () => {
    assert.match(src, /<AssignedCleanerRow/);
    assert.match(src, /cleanerName=\{item\.cleaner_name\}/);
    assert.match(src, /sub=\{cleanerName \|\| '담당자 미정'\}/);
  });

  test('미배정 팝업은 배정완료를 보여주지 않고, 배정요청중/수동배정필요 두 줄만 있다', () => {
    const start = src.indexOf("{futurePopup?.kind === 'unassigned' && (");
    const end = src.indexOf("{futurePopup?.kind === 'requesting' && (", start);
    assert.ok(start > 0 && end > start, '미배정 팝업 블록을 찾지 못함');
    const block = src.slice(start, end);
    assert.match(block, /label: '배정 요청중'/);
    assert.match(block, /label: '수동배정 필요'/);
    assert.ok(!/배정완료/.test(block), '미배정 팝업 안에 배정완료가 남아 있음');
  });

  test('미배정 팝업에서 배정요청중/수동배정필요를 누르면 그 상태의 숙소별 상세 목록으로 팝업이 전환된다', () => {
    assert.match(src, /onClick=\{row\.clickable \? \(\) => setFuturePopup\(\{ day: futurePopup\.day, kind: row\.key \}\) : undefined\}/);
  });

  test('배정요청중/수동배정필요 0건이면 그 줄이 눌리지 않는다', () => {
    assert.match(src, /clickable: popupCleaning\.requesting\.length > 0/);
    assert.match(src, /clickable: popupCleaning\.manual\.length > 0/);
  });

  test('수동배정 필요 목록은 ESCALATED/CANCELLED를 하나로 합친다 (D-018/D-019와 같은 규칙)', () => {
    assert.match(src, /kind: item\.status === 'CANCELLED' \? 'needsRequest' : 'failed'/);
    assert.match(src, /buildMixedCleaningIssueRows\(/);
  });

  test('배정요청중 목록은 buildCleaningIssueRows(\'requesting\', …) 로 만든다 (D-019와 같은 규칙)', () => {
    assert.match(src, /buildCleaningIssueRows\('requesting', popupCleaning\.requesting, Date\.now\(\)\)/);
  });

  test('팝업에서 항목을 누르면 팝업을 닫고 그 숙소를 선택한다 (존재하지 않는 ID는 안전하게 무시)', () => {
    assert.match(src, /const selectPropertyById = \(propertyId\) => \{/);
    assert.match(src, /if \(property\) onSelectProperty\?\.\(property\);/);
  });

  test('과거·이번달의 "문제" 팝업은 그대로 유지된다 (회귀 없음)', () => {
    assert.match(src, /selectedDay &&/);
    assert.match(src, /emptyMessage="문제 없음"/);
    assert.ok(!/청소 예정 없음/.test(src), '옛 "청소 예정" 문구(다른 selectedDay 경로)가 남아 있으면 안 됨');
  });

  test('새 코드는 다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), c);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. RoomStateApp / MonthlyView / PropertyListView 배선 (L2)
// ══════════════════════════════════════════════════════════════════════════
describe('화면 간 배선 — 대시보드 캘린더 → ListView', () => {
  test('MonthlyView가 onNavigateToList를 받아 MonthlyCalendar로 그대로 넘긴다', () => {
    const src = read('src/components/v2/MonthlyView.jsx');
    assert.match(src, /onNavigateToList,/);
    assert.match(src, /<MonthlyCalendar[\s\S]*?onNavigateToList=\{onNavigateToList\}/);
  });

  test('RoomStateApp — onNavigateToList가 listFilter/listDayOffset/listJumpIds를 채우고 리스트로 이동한다', () => {
    const src = read('src/components/v2/RoomStateApp.jsx');
    assert.match(src, /onNavigateToList=\{\(dayOffset, occupancy, propertyIds\) => \{ setListFilter\(occupancy\); setListDayOffset\(dayOffset\); setListJumpIds\(propertyIds\); setView\('list'\); \}\}/);
  });

  test('RoomStateApp — 기존 상단 상태칩(onSelectStatus)으로 이동할 때는 날짜 지정을 초기화한다 (다른 흐름과 안 섞이게)', () => {
    const src = read('src/components/v2/RoomStateApp.jsx');
    assert.match(src, /onSelectStatus=\{\(status\) => \{ setListFilter\(status\); setListDayOffset\(null\); setListJumpIds\(null\); setView\('list'\); \}\}/);
  });

  test('RoomStateApp — PropertyListView에 initialDayOffset/initialOccupantIds를 전달한다', () => {
    const src = read('src/components/v2/RoomStateApp.jsx');
    assert.match(src, /initialDayOffset=\{listDayOffset\}/);
    assert.match(src, /initialOccupantIds=\{listJumpIds\}/);
  });

  test('PropertyListView — initialDayOffset이 있으면 타임라인을 그 날짜로 열고, 일 모드로 시작한다', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /useState\(initialDayOffset \?\? 0\)/);
    assert.match(src, /useState\(initialDayOffset != null \? 'day' : 'week'\)/);
  });

  test('PropertyListView — 그 날짜의 체류/공실 숙소 ID는 mount 시점에 한 번만 고정한다', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /const \[dayOccupantIds\] = useState\(\(\) => initialOccupantIds/);
  });

  test('PropertyListView — OCCUPIED/VACANT 필터일 때 dayOccupantIds가 있으면 그걸로 거른다 (currentState 대신)', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /if \(dayOccupantIds && \(filter === 'OCCUPIED' \|\| filter === 'VACANT'\)\) return dayOccupantIds\[filter\]\.has\(p\.id\);/);
  });

  test('PropertyListView — 날짜 지정이 없으면(일반 진입) 기존처럼 currentState 로만 거른다 (회귀 없음)', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /return filter === FILTER_ALL \|\| p\.currentState\.mainStatus === filter;/);
  });

  test('PropertyListView — 상단 칩 개수도 날짜 지정 중엔 dayOccupantIds 기준으로 보여준다', () => {
    const src = read('src/components/v2/PropertyListView.jsx');
    assert.match(src, /dayOccupantIds && \(key === 'OCCUPIED' \|\| key === 'VACANT'\)\s*\n\s*\? dayOccupantIds\[key\]\.size/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F. 서버 — 배정완료 목록에 청소 담당자 이름
// ══════════════════════════════════════════════════════════════════════════
describe('서버 — 청소 담당자 이름 (cleaner_name)', () => {
  test('items 쿼리가 cleaners 테이블을 조인해 담당자 이름을 함께 준다', () => {
    const src = read('api/cleaning/[...slug].js');
    const fn = src.slice(src.indexOf('async function getCleaningStats'), src.indexOf('async function handleCalendarWebhook'));
    assert.match(fn, /LEFT JOIN cleaners c ON c\.id = j\.assigned_cleaner_id/);
    assert.match(fn, /c\.name AS cleaner_name/);
  });

  test('스키마에 cleaners.name, cleaning_jobs.assigned_cleaner_id 가 실제로 있다', () => {
    const schema = read('data/schema-cleaning.sql');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS cleaners[\s\S]*?name\s+TEXT NOT NULL/);
    assert.match(schema, /assigned_cleaner_id\s+UUID REFERENCES cleaners\(id\)/);
  });

  test('dev 스텁도 배정완료 항목에 cleaner_name을 채운다', () => {
    const src = read('vite.config.mjs');
    assert.match(src, /cleaner_name: \(status === "ASSIGNED" \|\| status === "COMPLETED"\) \? CLEANER_NAMES\[slot % CLEANER_NAMES\.length\] : null/);
  });

  test('dev 스텁 — 목업 숙소도 상태가 다양하다 (80% 배정완료, 나머지 20%는 요청중/실패/재요청)', () => {
    const src = read('vite.config.mjs');
    const fn = src.slice(src.indexOf('"/api/cleaning/stats"'), src.indexOf('"/api/cleaning/properties"'));
    assert.match(fn, /\{ upTo: 80, status: "ASSIGNED" \}/);
    assert.match(fn, /\{ upTo: 90, status: "PENDING" \}/);
    assert.match(fn, /\{ upTo: 95, status: "ESCALATED" \}/);
    assert.match(fn, /\{ upTo: 100, status: "CANCELLED" \}/);
  });

  test('dev 스텁 — 같은 숙소·체크아웃이면 새로고침해도 항상 같은 상태 (결정적, 진짜 무작위 아님)', () => {
    const src = read('vite.config.mjs');
    assert.match(src, /const roll100 = \(str\) => \{/);
    assert.match(src, /const statusFor = \(p, checkoutAt\) => \{/);
    assert.match(src, /const roll = roll100\(`\$\{p\.id\}\|\$\{checkoutAt\.toISOString\(\)\}`\);/);
  });

  test('dev 스텁 — 한 숙소가 그 기간에 여러 번 체크아웃하면 각각 잡을 만든다 (한 건도 빠지지 않게)', () => {
    const src = read('vite.config.mjs');
    assert.match(src, /const checkoutsInRange = \(p\) => \(p\.reservations \?\? \[\]\)/);
    assert.match(src, /rooms\.flatMap\(\(\{ p \}\) => checkoutsInRange\(p\)\.map/);
  });

  test('dev 스텁 — 배정완료/요청중/실패/요청필요 숫자는 items에서 그대로 센다 (합계가 항상 일치)', () => {
    const src = read('vite.config.mjs');
    const fn = src.slice(src.indexOf('"/api/cleaning/stats"'), src.indexOf('"/api/cleaning/properties"'));
    assert.match(fn, /const assigned\s+= items\.filter\(i => i\.status === "ASSIGNED"\)\.length;/);
    assert.match(fn, /const requesting\s+= items\.filter\(i => i\.status === "PENDING"\)\.length;/);
    assert.match(fn, /const failed\s+= items\.filter\(i => i\.status === "ESCALATED"\)\.length;/);
    assert.match(fn, /const needsRequest = items\.filter\(i => i\.status === "CANCELLED"\)\.length;/);
  });
});

describe('roll100/statusFor 확률 분포 — 80%가 배정완료인지 실제로 재현해서 확인', () => {
  test('roll100은 0~99 사이 값을 결정적으로 낸다 (같은 문자열 → 항상 같은 값)', () => {
    const src = read('vite.config.mjs');
    const match = src.match(/const roll100 = \(str\) => \{[\s\S]*?\n {8}\};/);
    assert.ok(match, 'roll100 구현을 찾지 못함');
    // eslint-disable-next-line no-new-func
    const roll100 = new Function(`${match[0]}; return roll100;`)();
    const a = roll100('P001|2026-10-01T02:00:00.000Z');
    const b = roll100('P001|2026-10-01T02:00:00.000Z');
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 100);
  });

  test('많은 표본에서 배정완료 비율이 대략 80%에 가깝다 (±10%p)', () => {
    const src = read('vite.config.mjs');
    const rollMatch = src.match(/const roll100 = \(str\) => \{[\s\S]*?\n {8}\};/);
    const tableMatch = src.match(/const STATUS_TABLE = \[[\s\S]*?\n {8}\];/);
    assert.ok(rollMatch && tableMatch, '분포 계산에 필요한 코드를 찾지 못함');
    const { roll100, STATUS_TABLE } = new Function(`${rollMatch[0]}
${tableMatch[0]}; return { roll100, STATUS_TABLE };`)();
    let assignedCount = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const roll = roll100(`P${i % 37}|2026-1${i % 2}-${(i % 27) + 1}T0${i % 9}:00:00.000Z`);
      const status = STATUS_TABLE.find(({ upTo }) => roll < upTo).status;
      if (status === 'ASSIGNED') assignedCount++;
    }
    const ratio = assignedCount / N;
    assert.ok(ratio > 0.70 && ratio < 0.90, `배정완료 비율이 80%와 너무 다름: ${(ratio * 100).toFixed(1)}%`);
  });
});
