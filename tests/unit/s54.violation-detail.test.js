/**
 * s54 — 레포트 위반·문제 목록의 한 줄: "숙소 이름 · 무슨 문제가 어떻게 있었는지 구어체 한 줄 · 시간"
 *
 * 사용자 요청 (2026-09-21):
 *   1) 건수를 누르면 뜨는 목록이 "숙소 이름·날짜"만 보여 썰렁하다 → 무슨 문제가 어떻게 있었는지 알려 달라.
 *   2) 심각도 글자·막대·요약 칩 같은 설명은 없애고, 빨강(심각) / 초록(괜찮음) 같은 일상적인 색으로만 알려 달라.
 *   과거 레포트(위반 6지표)와 미래 레포트(배정 실패·배정 요청 필요) 모두에 적용.
 *
 * 레이어: L1 = 실제 함수 import / L2 = 실제 소스 파일 계약(readFileSync).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CLEANING_LIMIT_HOURS,
  detectCleaningTimeFailures,
  detectEventTypeFailures,
  detectEventFailuresWithContext,
  detectVacantEnergyFailures,
  detectPostCheckoutFailures,
  detectPostCleaningFailures,
} from '../../src/domain/metricDrilldownDomain.js';
import {
  CLEANING_OVER_MIN,
  VACANT_ENERGY_MIN,
  CHECKOUT_URGENCY_HOURS,
  formatDuration,
  formatKstDateTime,
  formatKstTime,
  formatKstDayTime,
  describeViolation,
  buildViolationRows,
  describeCleaningIssue,
  buildCleaningIssueRows,
} from '../../src/domain/violationDetailDomain.js';
import { getDrilldownForMetric } from '../../src/application/reportingService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const t = (iso) => new Date(iso);
const NOW = Date.parse('2026-09-21T03:00:00Z'); // KST 2026-09-21(월) 12:00

// ══════════════════════════════════════════════════════════════════════════
// A. 서버 — 위반 건에 앞뒤 이벤트를 짝지어 준다 (metricDrilldownDomain)
// ══════════════════════════════════════════════════════════════════════════
describe('청소 시간 초과 — 기준 시간을 함께 내려준다', () => {
  test('detail.limit_hours = 기준(3시간) — 화면이 "기준 대비 초과분"을 계산할 수 있다', () => {
    const events = [
      { type: 'cleaning_started',  property_id: 'A', device_time: t('2026-09-08T10:00:00Z') },
      { type: 'cleaning_finished', property_id: 'A', device_time: t('2026-09-08T14:30:00Z') },
    ];
    const [item] = detectCleaningTimeFailures(events);
    assert.equal(CLEANING_LIMIT_HOURS, 3);
    assert.equal(item.detail.limit_hours, 3);
    assert.equal(item.detail.duration_hours, 4.5); // 기존 값은 그대로
  });
});

describe('공실 에너지 낭비 — 켜진 뒤 꺼질 때까지', () => {
  const detected = (pid, iso) => ({ type: 'vacant_energy_waste_detected', property_id: pid, device_time: t(iso) });
  const resolved = (pid, iso) => ({ type: 'vacant_energy_waste_resolved', property_id: pid, device_time: t(iso) });

  test('감지 뒤 처음 나온 꺼짐 기록이 resolved_at', () => {
    const [item] = detectVacantEnergyFailures([
      detected('A', '2026-09-08T10:00:00Z'),
      resolved('A', '2026-09-08T12:10:00Z'),
      resolved('A', '2026-09-08T15:00:00Z'), // 더 나중 기록은 무시
    ]);
    assert.equal(item.property_id, 'A');
    assert.equal(item.detail.resolved_at, '2026-09-08T12:10:00.000Z');
  });

  test('꺼짐 기록이 없으면 resolved_at 키 자체가 없다 (모르는 값을 지어내지 않음)', () => {
    const [item] = detectVacantEnergyFailures([detected('A', '2026-09-08T10:00:00Z')]);
    assert.ok(!('resolved_at' in item.detail));
  });

  test('감지 "전"의 꺼짐 기록과 다른 숙소의 꺼짐 기록은 짝이 아니다', () => {
    const [item] = detectVacantEnergyFailures([
      resolved('A', '2026-09-08T09:00:00Z'),
      detected('A', '2026-09-08T10:00:00Z'),
      resolved('B', '2026-09-08T11:00:00Z'),
    ]);
    assert.ok(!('resolved_at' in item.detail));
  });

  test('이벤트가 최신순(DB 조회 순서)으로 들어와도 같은 결과', () => {
    const asc = [detected('A', '2026-09-08T10:00:00Z'), resolved('A', '2026-09-08T12:00:00Z')];
    const desc = [...asc].reverse();
    assert.deepEqual(detectVacantEnergyFailures(desc), detectVacantEnergyFailures(asc));
  });

  test('같은 숙소의 감지가 두 번이면 각각 자기 뒤의 꺼짐과 짝지어진다', () => {
    const items = detectVacantEnergyFailures([
      detected('A', '2026-09-08T10:00:00Z'), resolved('A', '2026-09-08T11:00:00Z'),
      detected('A', '2026-09-09T10:00:00Z'), resolved('A', '2026-09-09T13:00:00Z'),
    ]);
    const byDay = Object.fromEntries(items.map(i => [new Date(i.occurred_at).toISOString().slice(0, 10), i.detail.resolved_at]));
    assert.equal(byDay['2026-09-08'], '2026-09-08T11:00:00.000Z');
    assert.equal(byDay['2026-09-09'], '2026-09-09T13:00:00.000Z');
  });
});

describe('퇴실 후 / 청소 후 위반 — 기준 이벤트로부터 얼마 뒤', () => {
  test('퇴실 후: 이 건과 같거나 그 전에 있었던 가장 가까운 퇴실 감지가 anchor_at', () => {
    const [item] = detectPostCheckoutFailures([
      { type: 'check_out_detected', property_id: 'A', device_time: t('2026-09-07T11:00:00Z') },
      { type: 'check_out_detected', property_id: 'A', device_time: t('2026-09-08T11:00:00Z') },
      { type: 'check_out_detected', property_id: 'A', device_time: t('2026-09-08T13:00:00Z') }, // 이 건 이후 → 제외
      { type: 'post_checkout_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T11:12:00Z') },
    ], 'post_checkout_energy_waste_detected');
    assert.equal(item.detail.anchor_at, '2026-09-08T11:00:00.000Z');
  });

  test('청소 후: cleaning_finished 를 기준으로 삼는다', () => {
    const [item] = detectPostCleaningFailures([
      { type: 'cleaning_finished', property_id: 'A', device_time: t('2026-09-08T14:00:00Z') },
      { type: 'post_cleaning_security_breach_detected', property_id: 'A', device_time: t('2026-09-08T14:45:00Z') },
    ], 'post_cleaning_security_breach_detected');
    assert.equal(item.detail.anchor_at, '2026-09-08T14:00:00.000Z');
  });

  test('기준 이벤트가 없으면 anchor_at 없음 / 다른 숙소의 것은 쓰지 않는다', () => {
    const [item] = detectPostCheckoutFailures([
      { type: 'check_out_detected', property_id: 'B', device_time: t('2026-09-08T11:00:00Z') },
      { type: 'post_checkout_security_breach_detected', property_id: 'A', device_time: t('2026-09-08T11:12:00Z') },
    ], 'post_checkout_security_breach_detected');
    assert.ok(!('anchor_at' in item.detail));
  });

  test('device_time 이 Date / ISO 문자열 / 숫자(ms)여도 같은 결과', () => {
    const mk = (conv) => detectPostCheckoutFailures([
      { type: 'check_out_detected', property_id: 'A', device_time: conv('2026-09-08T11:00:00Z') },
      { type: 'post_checkout_energy_waste_detected', property_id: 'A', device_time: conv('2026-09-08T11:12:00Z') },
    ], 'post_checkout_energy_waste_detected')[0].detail.anchor_at;
    assert.equal(mk(iso => new Date(iso)), '2026-09-08T11:00:00.000Z');
    assert.equal(mk(iso => iso), '2026-09-08T11:00:00.000Z');
    assert.equal(mk(iso => Date.parse(iso)), '2026-09-08T11:00:00.000Z');
  });

  test('이벤트 data.reason(문자열)은 detail.reason 으로, 그 밖의 값은 버린다', () => {
    const base = { type: 'post_checkout_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T11:12:00Z') };
    const reasonOf = (data) => detectEventFailuresWithContext([{ ...base, data }], base.type)[0].detail.reason;
    assert.equal(reasonOf({ reason: '  거실 에어컨 켜짐 ' }), '거실 에어컨 켜짐');
    assert.equal(reasonOf({ reason: '' }), undefined);
    assert.equal(reasonOf({ reason: 42 }), undefined);
    assert.equal(reasonOf(null), undefined);
  });

  test('맥락이 하나도 없으면 detail 은 빈 객체 (기존 detectEventTypeFailures 와 같은 모양)', () => {
    const events = [{ type: 'post_checkout_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T11:12:00Z') }];
    assert.deepEqual(detectPostCheckoutFailures(events, events[0].type)[0].detail, {});
    assert.deepEqual(detectEventTypeFailures(events, events[0].type)[0].detail, {});
  });
});

describe('getDrilldownForMetric — 공실 에너지 낭비는 기간 뒤에 꺼진 건도 짝지어 준다', () => {
  test('기간 안에서 꺼진 건: 한 번 조회로 resolved_at 포함', async () => {
    const calls = [];
    const db = { query: async (sql, params) => {
      calls.push(params);
      return { rows: calls.length === 1
        ? [
          { type: 'vacant_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T10:00:00Z'), data: null },
          { type: 'vacant_energy_waste_resolved', property_id: 'A', device_time: t('2026-09-08T12:30:00Z'), data: null },
        ]
        : [] };
    } };
    const r = await getDrilldownForMetric('vacant_energy', 'last_week', { db });
    assert.equal(r.failCount, 1);
    assert.equal(r.items[0].detail.resolved_at, '2026-09-08T12:30:00.000Z');
  });

  test('기간이 끝난 뒤에 꺼진 건: 기간 끝~지금의 꺼짐 기록을 추가로 조회해 짝지음 (감지 건은 늘지 않음)', async () => {
    const calls = [];
    const db = { query: async (sql, params) => {
      calls.push(params);
      if (calls.length === 1) {
        return { rows: [{ type: 'vacant_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T10:00:00Z'), data: null }] };
      }
      return { rows: [
        { type: 'vacant_energy_waste_resolved', property_id: 'A', device_time: t('2026-09-30T01:00:00Z'), data: null },
        // 뒤 조회에서 온 "감지" 이벤트는 이 기간의 실패 건이 아니므로 무시되어야 한다
        { type: 'vacant_energy_waste_detected', property_id: 'Z', device_time: t('2026-09-30T02:00:00Z'), data: null },
      ] };
    } };
    const r = await getDrilldownForMetric('vacant_energy', 'last_week', { db });
    assert.equal(calls.length, 2);
    assert.equal(r.failCount, 1, '기간 밖의 감지 이벤트가 실패 건으로 섞임');
    assert.equal(r.items[0].detail.resolved_at, '2026-09-30T01:00:00.000Z');
  });

  test('다른 지표는 추가 조회를 하지 않는다', async () => {
    let n = 0;
    const db = { query: async () => { n += 1; return { rows: [] }; } };
    await getDrilldownForMetric('post_checkout_energy', 'last_week', { db });
    await getDrilldownForMetric('cleaning_time', 'last_week', { db });
    assert.equal(n, 2);
  });

  test('퇴실 후 위반은 같은 조회 결과 안의 퇴실 감지와 짝지어진다', async () => {
    const db = { query: async () => ({ rows: [
      { type: 'post_checkout_energy_waste_detected', property_id: 'A', device_time: t('2026-09-08T11:12:00Z'), data: null },
      { type: 'check_out_detected',                  property_id: 'A', device_time: t('2026-09-08T11:00:00Z'), data: null },
    ] }) };
    const r = await getDrilldownForMetric('post_checkout_energy', 'last_week', { db });
    assert.equal(r.items[0].detail.anchor_at, '2026-09-08T11:00:00.000Z');
  });
});


// ══════════════════════════════════════════════════════════════════════════
// B. 화면용 순수 함수 (violationDetailDomain)
// ══════════════════════════════════════════════════════════════════════════
describe('formatDuration — 사람이 읽는 길이', () => {
  test('분 / 시간 / 일 단위', () => {
    assert.equal(formatDuration(48), '48분');
    assert.equal(formatDuration(65), '1시간 5분');
    assert.equal(formatDuration(180), '3시간');
    assert.equal(formatDuration(1440), '1일');
    assert.equal(formatDuration(1500), '1일 1시간');
    assert.equal(formatDuration(60 * 24 * 6 + 60 * 5), '6일 5시간');
  });
  test('1분 미만·이상한 값은 "1분 미만" (빈 글자나 NaN 을 보이지 않는다)', () => {
    assert.equal(formatDuration(0), '1분 미만');
    assert.equal(formatDuration(0.4), '1분 미만');
    assert.equal(formatDuration(-5), '1분 미만');
    assert.equal(formatDuration(NaN), '1분 미만');
    assert.equal(formatDuration(undefined), '1분 미만');
  });
  test('반올림으로 60분이 되면 "1시간"', () => {
    assert.equal(formatDuration(59.6), '1시간');
  });
});

describe('KST 시각 표시 — 실행 환경 시간대와 무관', () => {
  test('UTC 9/20 15:30 = KST 9/21 00:30 (날짜가 넘어간다)', () => {
    assert.equal(formatKstDateTime('2026-09-20T15:30:00Z'), '09/21 00:30');
    assert.equal(formatKstTime('2026-09-20T15:30:00Z'), '00:30');
    assert.equal(formatKstDayTime('2026-09-20T15:30:00Z'), '9/21(월) 00:30');
  });
  test('Date / ms / ISO 모두 같은 결과, 잘못된 값은 "—"', () => {
    const iso = '2026-09-08T14:30:00Z';
    assert.equal(formatKstDateTime(new Date(iso)), '09/08 23:30');
    assert.equal(formatKstDateTime(Date.parse(iso)), '09/08 23:30');
    assert.equal(formatKstDateTime(iso), '09/08 23:30');
    assert.equal(formatKstDateTime(null), '—');
    assert.equal(formatKstDateTime('아님'), '—');
    assert.equal(formatKstDayTime(undefined), '—');
  });
});

describe('한 줄의 모양 — 화면에는 문장·색·정렬에 쓸 값만 나간다', () => {
  test('과거 위반: { severity, text, sortKey } 뿐 (등급 글자·막대 길이·보조 문구 없음)', () => {
    for (const metric of ['cleaning_time', 'vacant_energy', 'post_checkout_energy', 'post_checkout_security', 'post_cleaning_security', 'pre_stay_optimization']) {
      const v = describeViolation(metric, { occurred_at: '2026-09-08T14:30:00Z', detail: { duration_hours: 4 } }, NOW);
      assert.deepEqual(Object.keys(v).sort(), ['severity', 'sortKey', 'text'], metric);
      assert.equal(typeof v.text, 'string');
    }
  });
  test('미래 청소 문제: { severity, text, when, sortKey } 뿐', () => {
    const v = describeCleaningIssue('failed', { checkout_at: '2026-09-23T02:00:00Z' }, NOW);
    assert.deepEqual(Object.keys(v).sort(), ['severity', 'sortKey', 'text', 'when']);
  });
});

describe('청소 시간 초과 — 문장과 색(심각도)', () => {
  const cleaning = (overMin, limit = 3, occurred = '2026-09-08T14:30:00Z') => ({
    occurred_at: occurred,
    detail: { duration_hours: (limit * 60 + overMin) / 60, limit_hours: limit },
  });

  test('구어체 한 줄: "청소가 3시간 48분 걸렸어요 (기준 3시간보다 48분 더)"', () => {
    const v = describeViolation('cleaning_time', cleaning(48), NOW);
    assert.equal(v.text, '청소가 3시간 48분 걸렸어요 (기준 3시간보다 48분 더)');
    assert.equal(describeViolation('cleaning_time', cleaning(72), NOW).text, '청소가 4시간 12분 걸렸어요 (기준 3시간보다 1시간 12분 더)');
  });

  test('색 경계: 29분 초록 / 30분 주황 / 59분 주황 / 60분 빨강', () => {
    assert.equal(describeViolation('cleaning_time', cleaning(29), NOW).severity, 'minor');
    assert.equal(describeViolation('cleaning_time', cleaning(30), NOW).severity, 'caution');
    assert.equal(describeViolation('cleaning_time', cleaning(59), NOW).severity, 'caution');
    assert.equal(describeViolation('cleaning_time', cleaning(60), NOW).severity, 'severe');
    assert.equal(describeViolation('cleaning_time', cleaning(300), NOW).severity, 'severe');
  });

  test('기준값 상수와 같은 경계를 쓴다 (한쪽만 바꾸면 이 테스트가 잡는다)', () => {
    assert.equal(CLEANING_OVER_MIN.caution, 30);
    assert.equal(CLEANING_OVER_MIN.severe, 60);
  });

  test('서버가 준 기준(limit_hours)을 쓴다 — 2시간 기준에서 30분 초과는 주황', () => {
    const v = describeViolation('cleaning_time', cleaning(30, 2), NOW);
    assert.equal(v.severity, 'caution');
    assert.equal(v.text, '청소가 2시간 30분 걸렸어요 (기준 2시간보다 30분 더)');
  });

  test('limit_hours 가 없으면 기본 3시간 (예전 응답과 호환)', () => {
    const v = describeViolation('cleaning_time', { occurred_at: 'x', detail: { duration_hours: 3.8 } }, NOW);
    assert.match(v.text, /기준 3시간보다 48분 더/);
  });

  test('초과분이 1분 미만이어도 "0분 더"로 보이지 않는다 (최소 1분)', () => {
    const v = describeViolation('cleaning_time', { occurred_at: 'x', detail: { duration_hours: 3 + 20 / 3600 } }, NOW);
    assert.match(v.text, /1분 더/);
    assert.ok(!/0분/.test(v.text));
    assert.equal(v.severity, 'minor');
  });

  test('소요 시간 값이 없으면 색 없이(중립) 안전하게 (NaN 표시 금지)', () => {
    const v = describeViolation('cleaning_time', { occurred_at: 'x', detail: {} }, NOW);
    assert.equal(v.severity, 'info');
    assert.ok(!/NaN|undefined/.test(v.text));
  });
});

describe('공실 에너지 낭비 — 문장과 색(켜져 있던 시간)', () => {
  const vacant = (minutes, occurred = '2026-09-08T10:00:00Z') => ({
    occurred_at: occurred,
    detail: { resolved_at: new Date(Date.parse(occurred) + minutes * 60000).toISOString() },
  });

  test('색 경계: 59분 초록 / 60분 주황 / 179분 주황 / 180분 빨강', () => {
    assert.equal(describeViolation('vacant_energy', vacant(59), NOW).severity, 'minor');
    assert.equal(describeViolation('vacant_energy', vacant(60), NOW).severity, 'caution');
    assert.equal(describeViolation('vacant_energy', vacant(179), NOW).severity, 'caution');
    assert.equal(describeViolation('vacant_energy', vacant(180), NOW).severity, 'severe');
    assert.equal(VACANT_ENERGY_MIN.caution, 60);
    assert.equal(VACANT_ENERGY_MIN.severe, 180);
  });

  test('구어체 한 줄: "빈 숙소인데 전기가 2시간 10분 동안 켜져 있었어요"', () => {
    assert.equal(describeViolation('vacant_energy', vacant(130), NOW).text, '빈 숙소인데 전기가 2시간 10분 동안 켜져 있었어요');
  });

  test('꺼진 기록이 없으면 "꺼진 기록이 없어요" + 지금까지의 경과 시간으로 색을 정한다', () => {
    const recent = describeViolation('vacant_energy', { occurred_at: '2026-09-21T02:30:00Z', detail: {} }, NOW); // 30분 전
    assert.equal(recent.text, '빈 숙소인데 전기가 켜진 채로 30분째 꺼진 기록이 없어요');
    assert.equal(recent.severity, 'minor');
    const old = describeViolation('vacant_energy', { occurred_at: '2026-09-20T03:00:00Z', detail: {} }, NOW); // 24시간 전
    assert.equal(old.severity, 'severe');
    assert.match(old.text, /1일째 꺼진 기록이 없어요/);
  });

  test('꺼진 시각이 감지보다 빠르면(잘못된 기록) 꺼진 기록이 없는 것으로 취급', () => {
    const v = describeViolation('vacant_energy', {
      occurred_at: '2026-09-08T10:00:00Z', detail: { resolved_at: '2026-09-08T09:00:00Z' },
    }, NOW);
    assert.match(v.text, /꺼진 기록이 없어요/);
  });
});

describe('색을 나누지 않는 지표 — 무슨 일이 있었는지만 문장으로', () => {
  const anchored = (occurred, anchor) => ({ occurred_at: occurred, detail: { anchor_at: anchor } });

  test('퇴실후 절전: "퇴실하고 12분 뒤에 조명·냉난방이 켜진 채로 감지됐어요", 중립색', () => {
    const v = describeViolation('post_checkout_energy', anchored('2026-09-08T11:12:00Z', '2026-09-08T11:00:00.000Z'), NOW);
    assert.equal(v.text, '퇴실하고 12분 뒤에 조명·냉난방이 켜진 채로 감지됐어요');
    assert.equal(v.severity, 'info');
  });

  test('퇴실후 보안 / 청소후 보안: 기준 이벤트 이름이 다르다', () => {
    const a = describeViolation('post_checkout_security', anchored('2026-09-08T11:40:00Z', '2026-09-08T11:00:00.000Z'), NOW);
    assert.equal(a.text, '퇴실하고 40분 뒤에 문·창문·재실 센서에 반응이 잡혔어요');
    const b = describeViolation('post_cleaning_security', anchored('2026-09-08T15:05:00Z', '2026-09-08T14:00:00.000Z'), NOW);
    assert.equal(b.text, '청소가 끝나고 1시간 5분 뒤에 문·창문·재실 센서에 반응이 잡혔어요');
  });

  test('기준 이벤트가 없으면 시간 없이 ("퇴실 후에") — 모르는 숫자를 만들지 않는다', () => {
    const v = describeViolation('post_checkout_security', { occurred_at: '2026-09-08T11:12:00Z', detail: {} }, NOW);
    assert.equal(v.text, '퇴실 후에 문·창문·재실 센서에 반응이 잡혔어요');
    assert.ok(!/\d+분 뒤/.test(v.text));
    assert.equal(describeViolation('post_cleaning_security', { occurred_at: 'x', detail: {} }, NOW).text,
      '청소가 끝난 뒤에 문·창문·재실 센서에 반응이 잡혔어요');
  });

  test('기록된 사유(reason)가 있으면 문장 끝에 괄호로 그대로 덧붙인다', () => {
    const v = describeViolation('post_checkout_energy', {
      occurred_at: '2026-09-08T11:12:00Z', detail: { anchor_at: '2026-09-08T11:00:00.000Z', reason: '거실 에어컨·조명 켜짐' },
    }, NOW);
    assert.equal(v.text, '퇴실하고 12분 뒤에 조명·냉난방이 켜진 채로 감지됐어요 (거실 에어컨·조명 켜짐)');
  });

  test('입실전 최적화 미완료: 입실 준비 시각(KST)을 함께', () => {
    const v = describeViolation('pre_stay_optimization', { occurred_at: '2026-09-08T04:30:00Z', detail: {} }, NOW);
    assert.equal(v.text, '입실 준비 시간(13:30)이 지났는데 숙소 준비가 끝났다는 기록이 없어요');
    assert.equal(v.severity, 'info');
  });

  test('알 수 없는 지표도 던지지 않고 빈 문장', () => {
    const v = describeViolation('unknown_metric', { occurred_at: 'x' }, NOW);
    assert.equal(v.severity, 'info');
    assert.equal(v.text, '');
  });
});

describe('buildViolationRows — 심한 건이 위로', () => {
  const cleaning = (id, overMin, at) => ({
    property_id: id, occurred_at: at,
    detail: { duration_hours: (180 + overMin) / 60, limit_hours: 3 },
  });

  test('빨강 → 주황 → 초록, 같은 색 안에서는 초과분이 큰 순', () => {
    const rows = buildViolationRows('cleaning_time', [
      cleaning('A', 20, '2026-09-01T00:00:00Z'),
      cleaning('B', 90, '2026-09-02T00:00:00Z'),
      cleaning('C', 45, '2026-09-03T00:00:00Z'),
      cleaning('D', 65, '2026-09-04T00:00:00Z'),
      cleaning('E', 30, '2026-09-05T00:00:00Z'),
    ], NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['B', 'D', 'C', 'E', 'A']);
    assert.deepEqual(rows.map(r => r.view.severity), ['severe', 'severe', 'caution', 'caution', 'minor']);
  });

  test('수치가 같으면 최근 발생이 먼저', () => {
    const rows = buildViolationRows('cleaning_time', [
      cleaning('OLD', 45, '2026-09-01T00:00:00Z'),
      cleaning('NEW', 45, '2026-09-05T00:00:00Z'),
    ], NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['NEW', 'OLD']);
  });

  test('색을 나누지 않는 지표는 최근 발생 순', () => {
    const rows = buildViolationRows('post_checkout_energy', [
      { property_id: 'A', occurred_at: '2026-09-01T10:00:00Z', detail: {} },
      { property_id: 'B', occurred_at: '2026-09-03T10:00:00Z', detail: {} },
      { property_id: 'C', occurred_at: '2026-09-02T10:00:00Z', detail: {} },
    ], NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['B', 'C', 'A']);
  });

  test('공실 에너지: 꺼진 기록이 없는 오래된 건이 맨 위(빨강)', () => {
    const rows = buildViolationRows('vacant_energy', [
      { property_id: 'SHORT', occurred_at: '2026-09-08T10:00:00Z', detail: { resolved_at: '2026-09-08T10:20:00.000Z' } },
      { property_id: 'OPEN',  occurred_at: '2026-09-15T10:00:00Z', detail: {} },
      { property_id: 'LONG',  occurred_at: '2026-09-08T10:00:00Z', detail: { resolved_at: '2026-09-08T14:00:00.000Z' } },
    ], NOW);
    assert.equal(rows[0].item.property_id, 'OPEN'); // 6일째 → 5760분
    assert.equal(rows[2].item.property_id, 'SHORT');
  });

  test('입력 배열은 바꾸지 않고, null/빈 입력도 안전', () => {
    const items = [cleaning('A', 20, '2026-09-01T00:00:00Z'), cleaning('B', 90, '2026-09-02T00:00:00Z')];
    const snapshot = JSON.stringify(items);
    buildViolationRows('cleaning_time', items, NOW);
    assert.equal(JSON.stringify(items), snapshot);
    assert.deepEqual(buildViolationRows('cleaning_time', null, NOW), []);
    assert.deepEqual(buildViolationRows('cleaning_time', [], NOW), []);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. 미래 레포트 — 배정 실패 / 배정 요청 필요
// ══════════════════════════════════════════════════════════════════════════
describe('청소 배정 문제 — 체크아웃 24시간 이내는 빨강, 그 밖은 주황 (초록 없음)', () => {
  const at = (hoursFromNow) => new Date(NOW + hoursFromNow * 3600000).toISOString();

  test('경계: 24시간 이내 빨강 / 그 밖 주황', () => {
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(5) }, NOW).severity, 'severe');
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(24) }, NOW).severity, 'severe');
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(24.1) }, NOW).severity, 'caution');
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(200) }, NOW).severity, 'caution');
    assert.equal(CHECKOUT_URGENCY_HOURS.severe, 24);
  });

  test('문제가 있는데 초록(괜찮음)으로 보이지 않는다 — 배정 실패·요청 필요 어느 쪽도, 며칠이 남았든, 일정을 모르든', () => {
    for (const kind of ['failed', 'needsRequest']) {
      for (const h of [-50, -1, 0, 5, 24, 25, 72, 73, 500, 5000]) {
        const sev = describeCleaningIssue(kind, { checkout_at: at(h) }, NOW).severity;
        assert.ok(sev === 'severe' || sev === 'caution', `${kind} ${h}h → ${sev}`);
      }
      const unknown = describeCleaningIssue(kind, {}, NOW).severity;
      assert.ok(unknown === 'severe' || unknown === 'caution', `${kind} 일정 모름 → ${unknown}`);
    }
  });

  test('배정 실패 문장: 체크아웃까지 남은 시간 + 청소자를 못 구한 이야기', () => {
    assert.equal(describeCleaningIssue('failed', { checkout_at: at(5) }, NOW).text,
      '체크아웃이 5시간 뒤인데 청소할 사람을 아직 못 구했어요');
    assert.equal(describeCleaningIssue('failed', { checkout_at: '2026-09-22T05:00:00Z' }, NOW).text,
      '체크아웃이 내일인데 청소할 사람을 아직 못 구했어요');
  });

  test('요청·거절 인원: "5명 중 2명 거절, 3명 무응답"', () => {
    const v = describeCleaningIssue('failed', { checkout_at: '2026-09-23T02:00:00Z', notified_count: 5, declined_count: 2 }, NOW);
    assert.equal(v.text, '체크아웃이 2일 뒤인데 청소할 사람을 못 구했어요 (5명 중 2명 거절, 3명 무응답)');
  });

  test('전부 거절 / 전부 무응답 / 거절이 요청보다 많으면 요청 수로 제한', () => {
    const t2 = (n, d) => describeCleaningIssue('failed', { checkout_at: at(5), notified_count: n, declined_count: d }, NOW).text;
    assert.match(t2(2, 2), /\(2명 모두 거절\)$/);
    assert.match(t2(3, 0), /\(3명 모두 무응답\)$/);
    assert.match(t2(2, 9), /\(2명 모두 거절\)$/);
  });

  test('인원을 모르면 있는 그대로 (숫자를 지어내지 않는다)', () => {
    assert.ok(!/\(/.test(describeCleaningIssue('failed', { checkout_at: at(48) }, NOW).text));
    assert.ok(!/\(/.test(describeCleaningIssue('failed', { checkout_at: at(48), notified_count: 0 }, NOW).text));
  });

  test('이미 지난 체크아웃: 가장 급함(빨강) + "체크아웃 시간이 3시간 지났는데"', () => {
    const v = describeCleaningIssue('failed', { checkout_at: at(-3) }, NOW);
    assert.equal(v.severity, 'severe');
    assert.match(v.text, /^체크아웃 시간이 3시간 지났는데 /);
  });

  test('배정 요청 필요(취소) 문장: 다시 요청해야 한다 + 취소된 지 얼마나 됐는지', () => {
    const v = describeCleaningIssue('needsRequest', { checkout_at: at(48), updated_at: new Date(NOW - 5 * 3600000).toISOString() }, NOW);
    assert.equal(v.text, '체크아웃이 2일 뒤인데 취소된 청소를 다시 요청해야 해요 (5시간 전에 취소됨)');
  });

  test('취소 시각을 모르거나 미래(시계 오차)면 시간 없이', () => {
    assert.ok(!/\(/.test(describeCleaningIssue('needsRequest', { checkout_at: at(48) }, NOW).text));
    assert.ok(!/\(/.test(describeCleaningIssue('needsRequest', { checkout_at: at(48), updated_at: at(3) }, NOW).text));
  });

  test('체크아웃 시각은 KST 요일 포함 ("9/23(수) 11:00")', () => {
    assert.equal(describeCleaningIssue('failed', { checkout_at: '2026-09-23T02:00:00Z' }, NOW).when, '9/23(수) 11:00');
  });

  test('체크아웃 시각이 없거나 잘못돼도 안전 (NaN·undefined 표시 금지)', () => {
    for (const checkout_at of [undefined, null, '아님']) {
      const v = describeCleaningIssue('failed', { checkout_at }, NOW);
      assert.ok(!/NaN|undefined|Invalid/.test(`${v.text}${v.when}`), String(checkout_at));
      assert.equal(v.text, '청소할 사람을 아직 못 구했어요');
      assert.equal(v.when, '—');
    }
  });

  test('buildCleaningIssueRows — 체크아웃이 가까운 순, 입력은 그대로', () => {
    const items = [
      { property_id: 'FAR',  checkout_at: at(200) },
      { property_id: 'NEAR', checkout_at: at(5) },
      { property_id: 'MID',  checkout_at: at(48) },
      { property_id: 'NONE' }, // 일정을 모르는 건은 맨 뒤
    ];
    const snapshot = JSON.stringify(items);
    const rows = buildCleaningIssueRows('failed', items, NOW);
    assert.deepEqual(rows.map(r => r.item.property_id), ['NEAR', 'MID', 'FAR', 'NONE']);
    assert.equal(JSON.stringify(items), snapshot);
    assert.deepEqual(buildCleaningIssueRows('failed', undefined, NOW), []);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. 배선 (L2 — 실제 소스)
// ══════════════════════════════════════════════════════════════════════════
describe('서버 배선', () => {
  test('reportingService — 4개 지표가 앞뒤 이벤트를 짝짓는 감지 함수를 쓴다', () => {
    const src = read('src/application/reportingService.js');
    assert.match(src, /post_checkout_energy:\s+\(events\) => detectPostCheckoutFailures\(events, "post_checkout_energy_waste_detected"\)/);
    assert.match(src, /post_checkout_security:\s+\(events\) => detectPostCheckoutFailures\(events, "post_checkout_security_breach_detected"\)/);
    assert.match(src, /vacant_energy:\s+\(events\) => detectVacantEnergyFailures\(events\)/);
    assert.match(src, /post_cleaning_security:\s+\(events\) => detectPostCleaningFailures\(events, "post_cleaning_security_breach_detected"\)/);
  });

  test('청소 배정 통계 — 실패 건에 요청/거절 인원, 두 목록 모두 updated_at, COUNT 는 숫자로 변환', () => {
    const src = read('api/cleaning/[...slug].js');
    const fn = src.slice(src.indexOf('async function getCleaningStats'), src.indexOf('async function handleCalendarWebhook'));
    assert.match(fn, /LEFT JOIN \(\s*SELECT job_id,[\s\S]*?FROM cleaning_notifs[\s\S]*?GROUP BY job_id/);
    assert.match(fn, /notified_count/);
    assert.match(fn, /declined_count/);
    assert.match(fn, /response IN \('DECLINED','DECLINED_AFTER_ASSIGNED'\)/);
    assert.equal((fn.match(/j\.updated_at/g) ?? []).length, 2, '배정 실패·배정 요청 필요 두 목록 모두 updated_at 필요');
    assert.match(fn, /Number\(r\.notified_count\)/);
    assert.match(fn, /Number\(r\.declined_count\)/);
  });

  test('스키마에 있는 컬럼만 쓴다 (cleaning_notifs.response / job_id, cleaning_jobs.updated_at)', () => {
    const schema = read('data/schema-cleaning.sql');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS cleaning_notifs[\s\S]*?job_id\s+UUID/);
    assert.match(schema, /cleaning_notifs[\s\S]*?response\s+TEXT CHECK \(response IS NULL OR response IN \('DECLINED','DECLINED_AFTER_ASSIGNED'\)\)/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS cleaning_jobs[\s\S]*?updated_at\s+TIMESTAMPTZ/);
  });
});

describe('화면 배선 — 숙소 이름 · 구어체 한 줄 · 시간, 심각도는 색으로만', () => {
  const row   = read('src/components/v2/reporting/ViolationRow.jsx');
  const sheet = read('src/components/v2/reporting/DrilldownSheet.jsx');
  const panel = read('src/components/v2/reporting/FutureMatrixPanel.jsx');

  test('DrilldownSheet — 항목마다 계산한 문장·색의 행(ViolationRow)을 심한 순으로 그린다', () => {
    assert.match(sheet, /buildViolationRows\(metric, data\?\.items \?\? \[\], Date\.now\(\)\)/);
    assert.match(sheet, /<ViolationRow/);
    assert.match(sheet, /dateLabel=\{formatKstDateTime\(item\.occurred_at\)\}/);
    assert.ok(!/function FailItem|function formatDetail/.test(sheet), '옛 한 줄(숙소 이름·날짜만) 컴포넌트가 남아 있음');
  });

  test('DrilldownSheet — 월간 캘린더 등 static 모드는 자기 행(renderItem)을 그대로 쓴다', () => {
    assert.match(sheet, /renderItem\s*\?\s*activeItems\.map\(\(item, i\) => renderItem\(item, i\)\)/);
  });

  test('FutureMatrixPanel — 배정 실패·요청 필요 목록도 같은 행, 급한 순 정렬, 눌러서 숙소로 이동', () => {
    assert.match(panel, /buildCleaningIssueRows\(/);
    assert.match(panel, /<ViolationRow/);
    assert.match(panel, /dateLabel=\{view\.when\}/);
    assert.match(panel, /onSelectRoom\?\.\(item\.property_id\)/);
    assert.match(panel, /isMobile = false, onSelectRoom \}/);
    assert.ok(!/function CleaningItem/.test(panel), '옛 한 줄 컴포넌트가 남아 있음');
  });

  test('ViolationRow — 이름 · 문장 · 시간을 그린다', () => {
    assert.match(row, /\{name\}<\/span>/);
    assert.match(row, /\{view\.text\}<\/span>/);
    assert.match(row, /\{dateLabel\}<\/span>/);
  });

  test('심각도는 색으로만: 빨강 / 주황 / 초록 / 회색 (라이트 테마)', () => {
    assert.match(row, /severe:\s+\{ dot: '#ef4444', bg: '#fef2f2', border: '#fecaca' \}/);
    assert.match(row, /caution:\s+\{ dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a' \}/);
    assert.match(row, /minor:\s+\{ dot: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' \}/);
    assert.match(row, /info:\s+\{ dot: '#94a3b8', bg: '#ffffff', border: '#e2e8f0' \}/);
    assert.match(row, /const tone = TONE\[view\.severity\] \?\? TONE\.info/);
  });

  test('등급 글자·막대·요약 칩·기준 안내·흐림 처리가 없다 (사용자 요청 — 설명 없이 색으로만)', () => {
    // 화면에 나가는 코드만 검사 — 설명 주석은 제외
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    for (const [name, full] of [['ViolationRow', row], ['DrilldownSheet', sheet], ['FutureMatrixPanel', panel]]) {
      const src = code(full);
      for (const word of ['심각', '경미', '긴급', '임박', '여유']) {
        assert.ok(!src.includes(word), `${name} 에 등급 글자 "${word}" 가 있음`);
      }
      assert.ok(!/view\.(tag|headline|sub|ratio)\b/.test(src), `${name} 가 옛 표시 값(tag/headline/sub/ratio)을 씀`);
      assert.ok(!/Chips|criteria|MagnitudeBar/.test(src), `${name} 에 요약 칩/기준 안내/막대가 남아 있음`);
    }
    assert.ok(!/opacity/.test(code(row)), '줄을 흐리게 만드는 코드가 남아 있음');
  });

  test('버튼은 배경색 + 테두리 + 레이블 (디자인 헌법)', () => {
    const button = row.slice(row.indexOf('<button'), row.indexOf('</button>'));
    assert.match(button, /background: tone\.bg/);
    assert.match(button, /border: `1px solid \$\{tone\.border\}`/);
    assert.match(button, /aria-label=/);
  });

  test('새 파일에 금지된 다크 색이 없고 innerHTML 도 쓰지 않는다', () => {
    const FORBIDDEN = ['#02080d', '#030f18', '#0a1f2e', '#00d4ff', '#00ff88'];
    for (const rel of ['src/domain/violationDetailDomain.js', 'src/components/v2/reporting/ViolationRow.jsx']) {
      const src = read(rel);
      for (const c of FORBIDDEN) assert.ok(!src.toLowerCase().includes(c), `${rel} 에 ${c}`);
      assert.ok(!/innerHTML/.test(src), rel);
    }
  });

  test('도메인은 화면 코드를 import 하지 않는 순수 함수 파일 (화면 ↔ 비즈니스 로직 분리)', () => {
    const domain = read('src/domain/violationDetailDomain.js');
    assert.ok(!/from ['"]react['"]/.test(domain));
    assert.ok(!/^import /m.test(domain), '순수 함수 파일은 import 가 없어야 함');
  });
});

describe('dev 스텁 — 실제 서버 응답과 같은 키로 화면을 확인할 수 있다', () => {
  const src = read('vite.config.mjs');
  test('drilldown 샘플: 기준(limit_hours) · 꺼짐(resolved_at) · 퇴실 기준(anchor_at)', () => {
    assert.match(src, /limit_hours: 3/);
    assert.match(src, /resolved_at: "2026-09-07T23:20:00\.000Z"/);
    assert.match(src, /anchor_at: "2026-09-08T11:00:00\.000Z"/);
  });
  test('cleaning/stats 샘플: 요청·거절 인원과 취소 시각', () => {
    assert.match(src, /notified_count: status === "ESCALATED"/);
    assert.match(src, /declined_count: status === "ESCALATED"/);
    assert.match(src, /updated_at: new Date\(Date\.now\(\)/);
  });
});
