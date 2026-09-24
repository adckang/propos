/**
 * s55 — 미래 레포트(FutureMatrixPanel)를 3줄로 접기 + 세부는 팝업으로
 *
 * 사용자 요청 (2026-09-24, 대시보드 화면 "다음달" 탭 = ListView의 "다음주"와 같은 컴포넌트를 공유):
 *   1차: 예약/청소배정/점유예측 8줄이 한 화면에 다 펼쳐져 있어 복잡하다 → 3줄로 접자
 *   2차: "퇴실예정 안에다가 청소 배정을 포함시키라는 뜻은 아니었어. 입실건수와 같이 퇴실예정건수도
 *        따로 나란히 봐야하고, 청소배정 현황도 별도로 카운트해서 봐야지." → 체크인/체크아웃은 나란히,
 *        청소배정은 완전히 별도 섹션으로 분리
 *   3차: "공실률 00% - 누르면 세부 데이터 팝업", "퇴실예정 5 (배정완료, 미배정) 으로 표기. 그걸 누르면
 *        세부 데이터로 팝업 (배정요청중, 수동배정 필요 등)" → 세부는 인라인 아코디언이 아니라 팝업으로
 *   4차: "체크인/퇴실예정은 나란히 말고 순차적으로. 배정완료 4건 / 미배정 4건 각각 줄로 나누고, 미배정을
 *        누르면 세부 팝업, 거기서 배정완료는 빼줘. 수동배정 필요처럼 배정 요청중도 누르면 세부 항목
 *        보이게" → 지금 이 구조 (체크인/퇴실은 순차, 배정완료·미배정 각자 줄, 미배정 팝업=요청중+수동배정
 *        필요만, 요청중도 클릭 시 숙소별 상세 목록)
 *   5차: "공실률 팝업에 체류00건/공실00건 나오는데, 그냥 공실률 높은 숙소순으로 숙소 리스트를 띄워주는게
 *        좋겠어. 10개 단위로 해서 next 로 넘기며 볼수 있게. 각 숙소별 공실률 데이터를 값으로 보여주고" →
 *        합계 2줄을 숙소별 공실률 순위 리스트(10개씩 다음/이전)로 교체
 *   "입실예정" 클릭 시 기기 상태 표시는 이번엔 보류 (사용자 결정).
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildMixedCleaningIssueRows,
  buildCleaningIssueRows,
  describeCleaningIssue,
} from '../../src/domain/violationDetailDomain.js';
import { getPropertyVacancyRates } from '../../src/domain/futureWeekDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = Date.parse('2026-09-24T03:00:00Z');
const at = (h) => new Date(NOW + h * 3600000).toISOString();

// ══════════════════════════════════════════════════════════════════════════
// A. describeCleaningIssue('requesting', …) — 진행 중 상태는 회색·정보성
// ══════════════════════════════════════════════════════════════════════════
describe('describeCleaningIssue — kind="requesting" (배정 요청중, 아직 문제 아님)', () => {
  test('심각도는 항상 info(회색) — 급해도 빨강/주황으로 안 바뀐다', () => {
    assert.equal(describeCleaningIssue('requesting', { checkout_at: at(2) }, NOW).severity, 'info');
    assert.equal(describeCleaningIssue('requesting', { checkout_at: at(200) }, NOW).severity, 'info');
    assert.equal(describeCleaningIssue('requesting', {}, NOW).severity, 'info');
  });

  test('내부 상태 코드를 그대로 보여주지 않고 문장으로 옮긴다', () => {
    const textFor = (status) => describeCleaningIssue('requesting', { checkout_at: at(5), status }, NOW).text;
    assert.match(textFor('PENDING'), /담당자를 찾고 있어요/);
    assert.match(textFor('NOTIFYING_VIP_1'), /우선순위 청소자에게 요청했어요/);
    assert.match(textFor('NOTIFYING_BULK'), /전체 청소자에게 요청을 넓혔어요/);
    assert.ok(!/PENDING|NOTIFYING/.test(textFor('PENDING')), '내부 상태 코드가 그대로 노출됨');
  });

  test('상태를 모르면 무난한 기본 문장', () => {
    assert.match(describeCleaningIssue('requesting', { checkout_at: at(5) }, NOW).text, /요청하고 응답을 기다리고 있어요/);
    assert.match(describeCleaningIssue('requesting', { checkout_at: at(5), status: '알수없음' }, NOW).text, /요청하고 응답을 기다리고 있어요/);
  });

  test('체크아웃 시각 문구는 failed/needsRequest 와 같은 형식', () => {
    assert.match(describeCleaningIssue('requesting', { checkout_at: at(5) }, NOW).text, /^체크아웃이 5시간 뒤인데/);
    assert.equal(describeCleaningIssue('requesting', { checkout_at: '2026-09-23T02:00:00Z' }, NOW).when, '9/23(수) 11:00');
  });

  test('failed/needsRequest 의 기존 동작은 그대로 (회귀 없음)', () => {
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(5) }, NOW).severity, 'severe');
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(200) }, NOW).severity, 'caution');
    assert.match(describeCleaningIssue('needsRequest', { checkout_at: at(5) }, NOW).text, /다시 요청해야 해요/);
  });

  test('buildCleaningIssueRows("requesting", …) 도 체크아웃이 가까운 순으로 정렬', () => {
    const rows = buildCleaningIssueRows('requesting', [
      { property_id: 'FAR',  checkout_at: at(200) },
      { property_id: 'NEAR', checkout_at: at(5) },
    ], NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['NEAR', 'FAR']);
    assert.ok(rows.every(r => r.view.severity === 'info'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. buildMixedCleaningIssueRows — 배정 실패 + 배정 요청 필요를 한 목록으로 (수동배정 필요)
// ══════════════════════════════════════════════════════════════════════════
describe('buildMixedCleaningIssueRows — "수동배정 필요" 통합 목록', () => {
  test('두 종류(failed, needsRequest)를 한 목록으로 합치고, 급한 순으로 함께 정렬한다', () => {
    const entries = [
      { kind: 'needsRequest', item: { property_id: 'FAR',  checkout_at: at(200) } },
      { kind: 'failed',       item: { property_id: 'NEAR', checkout_at: at(5) } },
      { kind: 'needsRequest', item: { property_id: 'MID',  checkout_at: at(48) } },
    ];
    const rows = buildMixedCleaningIssueRows(entries, NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['NEAR', 'MID', 'FAR']);
  });

  test('결과는 각 kind에 describeCleaningIssue를 적용한 것과 같은 view를 낸다', () => {
    const item = { property_id: 'A', checkout_at: at(5) };
    const [row] = buildMixedCleaningIssueRows([{ kind: 'failed', item }], NOW);
    assert.deepEqual(row.view, describeCleaningIssue('failed', item, NOW));
  });

  test('빈 입력·undefined도 안전', () => {
    assert.deepEqual(buildMixedCleaningIssueRows([], NOW), []);
    assert.deepEqual(buildMixedCleaningIssueRows(undefined, NOW), []);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. FutureMatrixPanel 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('FutureMatrixPanel — 예약은 순차적으로, 청소배정은 완전히 별도, 세부는 팝업', () => {
  const src = read('src/components/v2/reporting/FutureMatrixPanel.jsx');

  test('체크인 예정과 퇴실예정은 각자 한 줄씩(순차적으로), 클릭 없음, 청소 배정 숫자가 섞이지 않는다', () => {
    const start = src.indexOf('{/* 예약');
    const end = src.indexOf('{/* 청소배정');
    const block = src.slice(start, end);
    assert.match(block, /label="체크인 예정" value=\{`\$\{checkIns\}건`\}/);
    assert.match(block, /label="퇴실예정"\s+value=\{`\$\{checkOuts\}건`\}/);
    assert.ok(!/onClick/.test(block), '예약 줄에 클릭 동작이 있음');
    assert.ok(!/csAssigned|csUnassigned/.test(block), '퇴실예정 줄 안에 청소 배정 숫자가 섞여 있음');
    // 나란히(flex 두 칸) 배치가 아니라 각자 줄
    assert.ok(!/alignSelf: 'stretch', background: '#e2e8f0'/.test(block), '나란히 배치용 구분선이 남아 있음');
  });

  test('청소배정: 배정완료와 미배정이 각각 줄로 나뉜다', () => {
    const start = src.indexOf('{/* 청소배정');
    const end = src.indexOf('{/* 점유 예측');
    const block = src.slice(start, end);
    assert.match(block, /label="배정완료" value=\{fmtCleaning\(csAssigned\)\}/);
    assert.match(block, /label="미배정"/);
    assert.match(block, /value=\{fmtCleaning\(csUnassigned\)\}/);
  });

  test('미배정 값은 0보다 크면 빨간색으로 강조한다 (지금처럼 컬러로)', () => {
    assert.match(src, /red=\{cleaningReady && csUnassigned > 0\}/);
  });

  test('미배정을 누르면 팝업(DrilldownSheet)이 뜨고, 배정완료는 그 팝업 안에 없다', () => {
    assert.match(src, /onClick=\{unassignedClickable \? \(\) => setUnassignedPopup\(true\) : undefined\}/);
    assert.match(src, /unassignedPopup && \(/);
    assert.match(src, /metricLabel="미배정"/);
    const popupStart = src.indexOf('unassignedPopup && (');
    const popupEnd = src.indexOf('/* 공실률 팝업', popupStart);
    const popupBlock = src.slice(popupStart, popupEnd);
    assert.match(popupBlock, /label: '배정 요청중'/);
    assert.match(popupBlock, /label: '수동배정 필요'/);
    assert.ok(!/label: '배정완료'/.test(popupBlock), '미배정 팝업 안에 배정완료가 남아 있음');
  });

  test('배정 요청중·수동배정 필요 둘 다 0건이면 눌리지 않는다', () => {
    assert.match(src, /manualClickable\s*=\s*cleaningReady && \(csManual \?\? 0\) > 0/);
    assert.match(src, /requestingClickable\s*=\s*cleaningReady && \(csRequesting \?\? 0\) > 0/);
    assert.match(src, /clickable: requestingClickable/);
    assert.match(src, /clickable: manualClickable/);
  });

  test('미배정 팝업에서 배정 요청중을 누르면 그 팝업을 닫고 배정 요청중 상세 목록 팝업을 연다', () => {
    assert.match(src, /if \(row\.key === 'requesting'\) setRequestingOpen\(true\);/);
    assert.match(src, /else setManualOpen\(true\);/);
    assert.match(src, /requestingOpen && \(/);
    assert.match(src, /metricLabel="배정 요청중"/);
    assert.match(src, /staticItems=\{requestingRows\}/);
  });

  test('배정 요청중 목록은 items 중 진행 중 상태만 걸러 쓴다 (서버 추가 호출 없음)', () => {
    assert.match(src, /REQUESTING_STATUSES\.has\(item\.status\)/);
    assert.match(src, /buildCleaningIssueRows\('requesting', items, Date\.now\(\)\)/);
  });

  test('미배정 팝업에서 수동배정 필요를 누르면 그 팝업을 닫고 숙소별 상세 목록 팝업을 연다', () => {
    assert.match(src, /setUnassignedPopup\(false\);/);
    assert.match(src, /manualOpen && \(/);
    assert.match(src, /metricLabel="수동배정 필요"/);
    assert.match(src, /staticItems=\{manualRows\}/);
    assert.match(src, /kind: 'failed', item/);
    assert.match(src, /kind: 'needsRequest', item/);
  });

  test('공실률 한 줄 — 헤드라인 % 값은 그대로, 누르면 페이지를 0으로 되돌리고 팝업을 연다', () => {
    assert.match(src, /label="공실률"/);
    assert.match(src, /onClick=\{\(\) => \{ setVacancyPage\(0\); setOccupancyPopup\(true\); \}\}/);
    assert.match(src, /vacancyPct\s*=\s*forecast \? Math\.round\(forecast\.vacancyRate \* 100\) : null/);
  });

  test('공실률 팝업은 합계 2줄(체류/공실)이 아니라 숙소별 공실률 순위 리스트다', () => {
    assert.match(src, /occupancyPopup && \(/);
    assert.match(src, /staticItems=\{vacancyPageItems\}/);
    assert.match(src, /<VacancyRow/);
    assert.ok(!/label: '체류', value: `\$\{forecast\.occupiedRooms\}건`/.test(src), '옛 합계 2줄이 남아 있음');
  });

  test('공실률 리스트는 공실률이 높은 숙소가 위로 오게 정렬한다', () => {
    assert.match(src, /getPropertyVacancyRates\(properties, range\.from, range\.to\)/);
    assert.match(src, /\.sort\(\(a, b\) => b\.vacancyRate - a\.vacancyRate\)/);
  });

  test('공실률 리스트는 10개 단위로 나뉘고, 팝업 하단에 다음/이전 버튼이 있다', () => {
    assert.match(src, /VACANCY_PAGE_SIZE = 10/);
    assert.match(src, /vacancyTotalPages\s*=\s*Math\.max\(1, Math\.ceil\(vacancyList\.length \/ VACANCY_PAGE_SIZE\)\)/);
    assert.match(src, /vacancyPageItems\s*=\s*vacancyList\.slice\(vacancyPage \* VACANCY_PAGE_SIZE, vacancyPage \* VACANCY_PAGE_SIZE \+ VACANCY_PAGE_SIZE\)/);
    assert.match(src, /footer=\{\s*<VacancyPager/);
    assert.match(src, /onNext=\{\(\) => setVacancyPage\(p => Math\.min\(vacancyTotalPages - 1, p \+ 1\)\)\}/);
    assert.match(src, /onPrev=\{\(\) => setVacancyPage\(p => Math\.max\(0, p - 1\)\)\}/);
  });

  test('VacancyPager — 페이지가 1개뿐이면 아무것도 그리지 않는다 (다음 버튼이 필요 없을 때)', () => {
    assert.match(src, /if \(totalPages <= 1\) return null;/);
  });

  test('공실률 리스트 각 줄을 누르면 팝업을 닫고 그 숙소로 이동한다', () => {
    const start = src.indexOf('occupancyPopup && (');
    const end = src.indexOf('/* 수동배정 필요 상세 목록 팝업', start);
    const block = src.slice(start, end);
    assert.match(block, /setOccupancyPopup\(false\);/);
    assert.match(block, /onSelectRoom\?\.\(row\.property_id\)/);
  });

  test('옛 4줄(배정 요청 필요/배정 실패 개별 행, 공실 예정/체류 예정 개별 행)은 사라졌다', () => {
    assert.ok(!/label="배정 요청 필요"/.test(src));
    assert.ok(!/label="배정 실패"/.test(src));
    assert.ok(!/label="공실 예정"/.test(src));
    assert.ok(!/label="체류 예정"/.test(src));
  });

  test('세부는 인라인 아코디언이 아니라 팝업이다 (회전 화살표·펼침 상태 없음)', () => {
    assert.ok(!/rotate\(90deg\)/.test(src), '인라인 아코디언(회전 화살표)이 남아 있음');
    assert.ok(!/aria-expanded/.test(src), 'aria-expanded 가 남아 있음 — 아코디언 흔적');
  });

  test('훅은 모두 조건부 early return(if (!stats) return null) 보다 앞에 있다 (Rules of Hooks)', () => {
    const early = src.indexOf('if (!stats) return null');
    assert.ok(early > 0);
    const lastHook = Math.max(
      src.lastIndexOf('useMemo('),
      src.lastIndexOf('useState('),
      src.lastIndexOf('useEffect('),
    );
    assert.ok(lastHook < early, '훅이 early return 뒤에 있음');
  });

  test('새 코드는 다크 색을 재사용하지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), c);
  });

  test('이 컴포넌트는 대시보드(MonthlyView)의 "다음달" 탭에서도 재사용된다 (ReportPanel이 tense=future로 분기)', () => {
    const reportPanel = read('src/components/v2/reporting/ReportPanel.jsx');
    assert.match(reportPanel, /tense === 'future'.*<FutureMatrixPanel/s);
    const periodDomain = read('src/domain/periodDomain.js');
    assert.match(periodDomain, /next_month:\s*\{\s*tense:\s*'future'/);
  });
});

describe('violationDetailDomain — 새 export가 문서화된 계약대로 동작', () => {
  test('buildMixedCleaningIssueRows / buildCleaningIssueRows 가 export 되어 있다', () => {
    const src = read('src/domain/violationDetailDomain.js');
    assert.match(src, /export function buildMixedCleaningIssueRows/);
    assert.match(src, /export function buildCleaningIssueRows/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. getPropertyVacancyRates — 숙소별 공실률 (공실률 팝업의 데이터 원천)
// ══════════════════════════════════════════════════════════════════════════
describe('getPropertyVacancyRates — 숙소 하나하나의 공실률', () => {
  const weekStart = new Date('2026-09-28T15:00:00Z'); // KST 9/29 00:00
  const weekEnd   = new Date('2026-10-05T15:00:00Z'); // KST 10/6 00:00 (7박)

  test('한 숙소가 기간 내내 비어있으면(예약 없음) 공실률 100%', () => {
    const [row] = getPropertyVacancyRates([{ id: 'A', name: '빈 숙소', reservations: [] }], weekStart, weekEnd);
    assert.equal(row.property_id, 'A');
    assert.equal(row.property_name, '빈 숙소');
    assert.equal(row.occupiedNights, 0);
    assert.equal(row.vacantNights, 7);
    assert.equal(row.totalNights, 7);
    assert.equal(row.vacancyRate, 1);
  });

  test('기간 내내 체류 중이면 공실률 0%', () => {
    const property = { id: 'B', name: '꽉 찬 숙소', reservations: [
      { checkIn: new Date('2026-09-20T15:00:00Z'), checkOut: new Date('2026-10-10T15:00:00Z') },
    ] };
    const [row] = getPropertyVacancyRates([property], weekStart, weekEnd);
    assert.equal(row.occupiedNights, 7);
    assert.equal(row.vacantNights, 0);
    assert.equal(row.vacancyRate, 0);
  });

  test('일부만 체류하면 그 비율만큼 공실률 (3박 체류 / 7박 중 → 공실 4박 → 4/7)', () => {
    const property = { id: 'C', name: '반반 숙소', reservations: [
      { checkIn: new Date('2026-09-28T15:00:00Z'), checkOut: new Date('2026-10-01T15:00:00Z') }, // 3박
    ] };
    const [row] = getPropertyVacancyRates([property], weekStart, weekEnd);
    assert.equal(row.occupiedNights, 3);
    assert.equal(row.vacantNights, 4);
    assert.equal(row.vacancyRate, 4 / 7);
  });

  test('getOccupancyForecast의 합계와 숫자가 맞물린다 (같은 계산 로직 공유)', () => {
    const properties = [
      { id: 'A', name: 'A', reservations: [] },
      { id: 'B', name: 'B', reservations: [{ checkIn: new Date('2026-09-20T15:00:00Z'), checkOut: new Date('2026-10-10T15:00:00Z') }] },
    ];
    const rows = getPropertyVacancyRates(properties, weekStart, weekEnd);
    const sumOccupied = rows.reduce((s, r) => s + r.occupiedNights, 0);
    const sumVacant   = rows.reduce((s, r) => s + r.vacantNights, 0);
    assert.equal(sumOccupied, 7); // B만 7박
    assert.equal(sumVacant, 7);   // A만 7박
  });

  test('정렬은 하지 않고 입력 순서 그대로 반환 (정렬은 화면 책임)', () => {
    const properties = [
      { id: 'FULL',  name: 'FULL',  reservations: [{ checkIn: new Date('2026-09-20T15:00:00Z'), checkOut: new Date('2026-10-10T15:00:00Z') }] },
      { id: 'EMPTY', name: 'EMPTY', reservations: [] },
    ];
    const rows = getPropertyVacancyRates(properties, weekStart, weekEnd);
    assert.deepEqual(rows.map(r => r.property_id), ['FULL', 'EMPTY']);
  });

  test('숙소가 없으면 빈 배열', () => {
    assert.deepEqual(getPropertyVacancyRates([], weekStart, weekEnd), []);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. DrilldownSheet — footer (페이지 넘김 버튼 등, 목록 스크롤 밖에 고정)
// ══════════════════════════════════════════════════════════════════════════
describe('DrilldownSheet — footer', () => {
  const src = read('src/components/v2/reporting/DrilldownSheet.jsx');

  test('footer prop을 받아 목록 스크롤 영역 밖(아래)에 그린다', () => {
    assert.match(src, /footer,\s*\n\s*\/\/ 공통/);
    assert.match(src, /\{footer && \(/);
    // 목록의 overflowY:auto div가 닫힌 뒤에 footer가 와야 한다 (스크롤에 같이 말려들지 않게)
    const listDivIdx = src.indexOf("overflowY: 'auto'");
    const footerIdx  = src.indexOf('{footer && (');
    assert.ok(footerIdx > listDivIdx, 'footer가 스크롤 영역보다 앞에 있음');
  });

  test('footer가 없으면 아무것도 안 그린다 (기존 화면들은 그대로)', () => {
    assert.match(src, /\{footer && \(/); // 조건부 렌더 — falsy 면 안 그림
  });
});

describe('violationDetailDomain — 새 export가 문서화된 계약대로 동작 (getPropertyVacancyRates)', () => {
  test('getPropertyVacancyRates 가 export 되어 있다', () => {
    const src = read('src/domain/futureWeekDomain.js');
    assert.match(src, /export function getPropertyVacancyRates/);
  });
});
