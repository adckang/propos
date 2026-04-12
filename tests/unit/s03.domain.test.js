import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isAnomaly, buildAnomalyAlert, getDefaultThresholds } from "../../src/domain/sensorDomain.js";
import { buildReplyDraft } from "../../src/domain/messageDomain.js";

// ============================================================
// 공통 픽스처
// ============================================================

const T = getDefaultThresholds();
// T = { temp:{warn:30,critical:35}, humidity:{warn:80,critical:90},
//        noise:{warn:60,critical:75}, power:{warn:3000,critical:5000} }

const BOOKING = { guestName: '김민준', propId: 'P-042', propName: '해운대 오션뷰' };

// ============================================================
// sensorDomain.getDefaultThresholds
// ============================================================
describe('sensorDomain.getDefaultThresholds', () => {
  test('4개 센서 키를 모두 포함한다', () => {
    const t = getDefaultThresholds();
    assert.ok('temp'     in t);
    assert.ok('humidity' in t);
    assert.ok('noise'    in t);
    assert.ok('power'    in t);
  });

  test('각 임계값은 warn < critical 이다', () => {
    const t = getDefaultThresholds();
    for (const key of ['temp', 'humidity', 'noise', 'power']) {
      assert.ok(t[key].warn < t[key].critical, `${key}: warn should be < critical`);
    }
  });
});

// ============================================================
// sensorDomain.isAnomaly
// ============================================================
describe('sensorDomain.isAnomaly — 정상 범위', () => {
  test('모든 값이 정상 범위이면 isAnomaly=false', () => {
    const r = { propId:'P-042', time:'15:00', temp:25, humidity:60, noise:45, power:1000 };
    const result = isAnomaly(r, T);
    assert.equal(result.isAnomaly, false);
    assert.equal(result.severity, null);
    assert.deepEqual(result.sensors, []);
  });

  test('null 센서값은 스킵한다', () => {
    const r = { propId:'P-042', time:'15:00', temp:null, humidity:null, noise:null, power:null };
    const result = isAnomaly(r, T);
    assert.equal(result.isAnomaly, false);
  });

  test('임계값 경계값(warn 정확히)은 이상 아님', () => {
    const r = { propId:'P-042', time:'15:00', temp:30, humidity:80, noise:60, power:3000 };
    const result = isAnomaly(r, T);
    assert.equal(result.isAnomaly, false);
  });
});

describe('sensorDomain.isAnomaly — warn 레벨', () => {
  test('temp warn 초과 → severity=warn, sensors=[temp]', () => {
    const r = { propId:'P-042', time:'15:00', temp:31, humidity:50, noise:40, power:500 };
    const result = isAnomaly(r, T);
    assert.equal(result.isAnomaly, true);
    assert.equal(result.severity, 'warn');
    assert.deepEqual(result.sensors, ['temp']);
  });

  test('humidity warn 초과 → severity=warn', () => {
    const r = { propId:'P-042', time:'15:00', temp:20, humidity:85, noise:40, power:500 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'warn');
    assert.ok(result.sensors.includes('humidity'));
  });

  test('noise warn 초과 → severity=warn', () => {
    const r = { propId:'P-042', time:'15:00', temp:20, humidity:50, noise:65, power:500 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'warn');
    assert.ok(result.sensors.includes('noise'));
  });

  test('power warn 초과 → severity=warn', () => {
    const r = { propId:'P-042', time:'15:00', temp:20, humidity:50, noise:40, power:4000 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'warn');
    assert.ok(result.sensors.includes('power'));
  });
});

describe('sensorDomain.isAnomaly — critical 레벨', () => {
  test('temp critical 초과 → severity=critical', () => {
    const r = { propId:'P-042', time:'15:00', temp:36, humidity:50, noise:40, power:500 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'critical');
    assert.ok(result.sensors.includes('temp'));
  });

  test('warn 센서 + critical 센서 동시 → severity=critical (가장 높은 값 적용)', () => {
    const r = { propId:'P-042', time:'15:00', temp:36, humidity:85, noise:40, power:500 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'critical');
    assert.ok(result.sensors.includes('temp'));
    assert.ok(result.sensors.includes('humidity'));
  });

  test('복수 센서 동시 이상 → sensors 배열에 모두 포함', () => {
    const r = { propId:'P-042', time:'15:00', temp:36, humidity:91, noise:80, power:6000 };
    const result = isAnomaly(r, T);
    assert.equal(result.severity, 'critical');
    assert.equal(result.sensors.length, 4);
  });
});

describe('sensorDomain.isAnomaly — 에러 케이스', () => {
  test('reading 없으면 에러', () => {
    assert.throws(() => isAnomaly(null, T), /required/);
  });

  test('thresholds 없으면 에러', () => {
    const r = { propId:'P-042', time:'15:00', temp:25 };
    assert.throws(() => isAnomaly(r, null), /required/);
  });
});

// ============================================================
// sensorDomain.buildAnomalyAlert
// ============================================================
describe('sensorDomain.buildAnomalyAlert', () => {
  const READING  = { propId:'P-042', time:'15:00', temp:36, humidity:91, noise:40, power:500 };
  const ANOMALY_CRITICAL = { isAnomaly:true, severity:'critical', sensors:['temp','humidity'] };
  const ANOMALY_WARN     = { isAnomaly:true, severity:'warn',     sensors:['noise'] };

  test('propId가 포함된다', () => {
    const msg = buildAnomalyAlert('P-042', READING, ANOMALY_CRITICAL);
    assert.ok(msg.includes('P-042'));
  });

  test('critical 심각도 → [긴급] 레이블 포함', () => {
    const msg = buildAnomalyAlert('P-042', READING, ANOMALY_CRITICAL);
    assert.ok(msg.includes('[긴급]'));
  });

  test('warn 심각도 → [경고] 레이블 포함', () => {
    const r   = { ...READING, noise:65 };
    const msg = buildAnomalyAlert('P-042', r, ANOMALY_WARN);
    assert.ok(msg.includes('[경고]'));
  });

  test('이상 센서 이름(한글)이 포함된다', () => {
    const msg = buildAnomalyAlert('P-042', READING, ANOMALY_CRITICAL);
    assert.ok(msg.includes('온도'));
    assert.ok(msg.includes('습도'));
  });

  test('문자열을 반환한다', () => {
    const msg = buildAnomalyAlert('P-042', READING, ANOMALY_CRITICAL);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('propId 없으면 에러', () => {
    assert.throws(() => buildAnomalyAlert('', READING, ANOMALY_CRITICAL), /required/);
  });

  test('reading 없으면 에러', () => {
    assert.throws(() => buildAnomalyAlert('P-042', null, ANOMALY_CRITICAL), /required/);
  });

  test('anomaly 없으면 에러', () => {
    assert.throws(() => buildAnomalyAlert('P-042', READING, null), /required/);
  });

  test('sensors 빈 배열이면 에러', () => {
    assert.throws(() => buildAnomalyAlert('P-042', READING, { sensors:[], severity:'warn' }), /empty/);
  });
});

// ============================================================
// messageDomain.buildReplyDraft
// ============================================================
describe('messageDomain.buildReplyDraft — 키워드 매칭', () => {
  test('wifi 키워드 → WiFi 안내 초안', () => {
    const draft = buildReplyDraft('wifi 비밀번호가 뭔가요?', BOOKING);
    assert.ok(draft.includes('WiFi') || draft.includes('wifi') || draft.includes('와이파이'));
    assert.ok(draft.includes('김민준'));
  });

  test('와이파이 키워드 → WiFi 안내 초안', () => {
    const draft = buildReplyDraft('와이파이가 안 돼요', BOOKING);
    assert.ok(draft.includes('김민준'));
  });

  test('덥다 키워드 → 온도 조절 안내 초안', () => {
    const draft = buildReplyDraft('너무 더워요', BOOKING);
    assert.ok(draft.includes('김민준'));
    assert.ok(draft.includes('온도') || draft.includes('에어컨') || draft.includes('냉방'));
  });

  test('춥다 키워드 → 온도 조절 안내 초안', () => {
    const draft = buildReplyDraft('방이 너무 춥습니다', BOOKING);
    assert.ok(draft.includes('김민준'));
  });

  test('청소 키워드 → 청소 요청 처리 초안', () => {
    const draft = buildReplyDraft('청소가 안 되어 있어요', BOOKING);
    assert.ok(draft.includes('김민준'));
    assert.ok(draft.includes('청소'));
  });

  test('체크아웃 키워드 → 체크아웃 안내 초안', () => {
    const draft = buildReplyDraft('체크아웃은 어떻게 하나요?', BOOKING);
    assert.ok(draft.includes('김민준'));
    assert.ok(draft.includes('체크아웃') || draft.includes('키'));
  });

  test('checkout 영문 키워드 → 체크아웃 초안', () => {
    const draft = buildReplyDraft('how do I checkout?', BOOKING);
    assert.ok(draft.includes('김민준'));
  });

  test('매칭 없음 → 일반 응대 초안', () => {
    const draft = buildReplyDraft('안녕하세요 잘 지내고 있어요', BOOKING);
    assert.ok(draft.includes('김민준'));
    assert.equal(typeof draft, 'string');
    assert.ok(draft.length > 0);
  });

  test('대소문자 무관하게 매칭된다', () => {
    const draft = buildReplyDraft('WIFI is not working', BOOKING);
    assert.ok(draft.includes('김민준'));
  });
});

describe('messageDomain.buildReplyDraft — 에러 케이스', () => {
  test('guestMessage 없으면 에러', () => {
    assert.throws(() => buildReplyDraft('', BOOKING), /required/);
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => buildReplyDraft('wifi 안돼요', null), /required/);
  });

  test('booking.guestName 없으면 에러', () => {
    assert.throws(() => buildReplyDraft('wifi 안돼요', { guestName:'' }), /required/);
  });
});
