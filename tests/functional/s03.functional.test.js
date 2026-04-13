/**
 * S03 기능 테스트 — 체류 중 모니터링
 * node --test tests/functional/s03.functional.test.js
 *
 * TC-F-024 ~ TC-F-036
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { pollSensors, pollAll, handleGuestMessage } from "../../src/application/monitoringService.js";
import { getDefaultThresholds } from "../../src/domain/sensorDomain.js";

// ─────────────────────────────────────────────
// 공통 픽스처 & Mock 빌더
// ─────────────────────────────────────────────

const T = getDefaultThresholds();

function makeReading(overrides = {}) {
  return {
    propId: 'P-001',
    time: '14:00',
    temp: 25,
    humidity: 60,
    noise: 45,
    power: 1000,
    ...overrides,
  };
}

function makeBooking(overrides = {}) {
  return {
    propId: 'P-001',
    propName: '해운대 오션뷰',
    guestName: '김민준',
    guestId: 'guest-001',
    checkIn: '2026-04-05T15:00:00',
    checkOut: '2026-04-07T11:00:00',
    status: 'confirmed',
    wifi: { ssid: 'PROPOS_GUEST', pw: 'pass1234' },
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    getSensorStates: async (propId) => makeReading({ propId }),
    updateReadings:  () => {},
    addAlert:        () => {},
    setDraft:        () => {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// TC-F-024: 정상 폴링 — 이상 없음
// ─────────────────────────────────────────────
describe('TC-F-024: 정상 센서값 폴링 — 이상 없음', () => {
  test('status=ok, anomaly.isAnomaly=false, addAlert 미호출', async () => {
    let alertCalled = false;
    let updatedPropId = null;
    let updatedReading = null;

    const deps = makeDeps({
      getSensorStates: async () => makeReading({ temp: 25, humidity: 60, noise: 40, power: 500 }),
      updateReadings:  (propId, reading) => {
        updatedPropId = propId;
        updatedReading = reading;
      },
      addAlert:        () => { alertCalled = true; },
    });

    const result = await pollSensors('P-001', T, deps);

    assert.equal(result.status, 'ok');
    assert.equal(result.propId, 'P-001');
    assert.equal(result.error, null);
    assert.equal(result.anomaly.isAnomaly, false);
    assert.equal(result.anomaly.severity, null);
    assert.deepEqual(result.anomaly.sensors, []);
    assert.equal(updatedPropId, 'P-001', 'updateReadings에 propId가 전달되어야 함');
    assert.deepEqual(updatedReading, result.reading, 'updateReadings에 전달된 reading이 반환값과 일치해야 함');
    assert.equal(alertCalled, false, '정상 시 addAlert 호출 안됨');
  });
});

// ─────────────────────────────────────────────
// TC-F-025: warn 이상 감지
// ─────────────────────────────────────────────
describe('TC-F-025: warn 이상 감지 — 알림 생성', () => {
  test('온도 31°C → status=anomaly, severity=warn, addAlert(type=warn) 호출', async () => {
    const alerts = [];

    const deps = makeDeps({
      getSensorStates: async () => makeReading({ temp: 31 }),
      addAlert:        (alert) => alerts.push(alert),
    });

    const result = await pollSensors('P-001', T, deps);

    assert.equal(result.status, 'anomaly');
    assert.equal(result.anomaly.severity, 'warn');
    assert.deepEqual(result.anomaly.sensors, ['temp']);
    assert.equal(result.reading.temp, 31);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'warn');
    assert.ok(alerts[0].msg.includes('[경고]'), `알림 메시지: ${alerts[0].msg}`);
    assert.equal(alerts[0].prop, 'P-001');
    assert.equal(alerts[0].time, '14:00');
  });
});

// ─────────────────────────────────────────────
// TC-F-026: critical 이상 감지
// ─────────────────────────────────────────────
describe('TC-F-026: critical 이상 감지 — 긴급 알림 생성', () => {
  test('온도 36°C → status=anomaly, severity=critical, addAlert(type=error) 호출', async () => {
    const alerts = [];

    const deps = makeDeps({
      getSensorStates: async () => makeReading({ temp: 36 }),
      addAlert:        (alert) => alerts.push(alert),
    });

    const result = await pollSensors('P-001', T, deps);

    assert.equal(result.status, 'anomaly');
    assert.equal(result.anomaly.severity, 'critical');
    assert.deepEqual(result.anomaly.sensors, ['temp']);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'error');
    assert.ok(alerts[0].msg.includes('[긴급]'), `알림 메시지: ${alerts[0].msg}`);
    assert.equal(alerts[0].prop, 'P-001');
  });
});

// ─────────────────────────────────────────────
// TC-F-027: 복합 센서 이상
// ─────────────────────────────────────────────
describe('TC-F-027: 복합 센서 이상 — 가장 높은 severity 적용', () => {
  test('temp=warn + humidity=critical → 전체 severity=critical', async () => {
    const alerts = [];

    const deps = makeDeps({
      getSensorStates: async () => makeReading({ temp: 31, humidity: 91 }),
      addAlert:        (alert) => alerts.push(alert),
    });

    const result = await pollSensors('P-001', T, deps);

    assert.equal(result.anomaly.severity, 'critical');
    assert.ok(result.anomaly.sensors.includes('temp'));
    assert.ok(result.anomaly.sensors.includes('humidity'));
    assert.equal(alerts[0].type, 'error');
  });
});

// ─────────────────────────────────────────────
// TC-F-028: 폴링 실패 — HA 연결 오류
// ─────────────────────────────────────────────
describe('TC-F-028: 폴링 실패 — HA 연결 오류 처리', () => {
  test('getSensorStates throw → status=error, warn 알림 생성, 예외 미전파', async () => {
    const alerts = [];

    const deps = makeDeps({
      getSensorStates: async () => { throw new Error('Connection timeout'); },
      addAlert:        (alert) => alerts.push(alert),
    });

    const result = await pollSensors('P-001', T, deps);

    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('Connection timeout'));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'warn');
    assert.ok(alerts[0].msg.includes('마지막 정상값 유지'), `알림: ${alerts[0].msg}`);
  });

  test('폴링 실패가 다른 숙소 처리를 중단하지 않음 (pollAll)', async () => {
    const alerts = [];
    let successCount = 0;

    const deps = makeDeps({
      getSensorStates: async (propId) => {
        if (propId === 'P-002') throw new Error('P-002 timeout');
        successCount++;
        return makeReading({ propId });
      },
      addAlert: (alert) => alerts.push(alert),
    });

    const results = await pollAll(['P-001', 'P-002', 'P-003'], T, deps);

    assert.equal(results.length, 3);
    assert.equal(results[0].status, 'ok');
    assert.equal(results[1].status, 'error');
    assert.equal(results[2].status, 'ok');
    assert.equal(successCount, 2); // P-001, P-003 성공
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].prop, 'P-002');
    assert.ok(alerts[0].msg.includes('P-002 timeout'));
  });
});

// ─────────────────────────────────────────────
// TC-F-029: pollAll — 정상 일괄 폴링
// ─────────────────────────────────────────────
describe('TC-F-029: pollAll — 여러 숙소 일괄 폴링', () => {
  test('3개 숙소 전부 정상 → S03PollResult 3개 반환', async () => {
    const updated = [];

    const deps = makeDeps({
      getSensorStates: async (propId) => makeReading({ propId }),
      updateReadings:  (propId) => updated.push(propId),
    });

    const results = await pollAll(['P-001', 'P-002', 'P-003'], T, deps);

    assert.equal(results.length, 3);
    assert.deepEqual(updated, ['P-001', 'P-002', 'P-003']);
    for (const r of results) {
      assert.equal(r.status, 'ok');
      assert.equal(r.error, null);
    }
  });

  test('빈 배열 → 빈 결과 반환', async () => {
    let called = false;
    const results = await pollAll([], T, makeDeps({
      getSensorStates: async () => {
        called = true;
        return makeReading();
      },
    }));
    assert.deepEqual(results, []);
    assert.equal(called, false, '빈 배열이면 개별 센서 조회가 없어야 함');
  });
});

// ─────────────────────────────────────────────
// TC-F-030: handleGuestMessage — WiFi 키워드
// ─────────────────────────────────────────────
describe('TC-F-030: handleGuestMessage — WiFi 키워드 → 초안 생성', () => {
  test('wifi 메시지 → setDraft 호출 + info 알림 생성', () => {
    const alerts = [];
    let draftPropId = null;
    let draftText   = null;

    const deps = makeDeps({
      setDraft:  (propId, text) => { draftPropId = propId; draftText = text; },
      addAlert:  (alert) => alerts.push(alert),
    });

    const msg = { id: 'msg-1', guestId: 'guest-001', text: 'wifi 비밀번호 알려주세요', time: '15:10' };
    handleGuestMessage(msg, makeBooking(), deps);

    assert.equal(draftPropId, 'P-001');
    assert.ok(draftText && draftText.length > 0, '초안 텍스트 비어있음');
    assert.ok(draftText.includes('WiFi') || draftText.includes('와이파이'), `초안: ${draftText}`);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'info');
    assert.equal(alerts[0].prop, 'P-001');
    assert.equal(alerts[0].time, '15:10');
    assert.ok(alerts[0].msg.includes('AI 답장 초안 생성 완료'));
  });
});

// ─────────────────────────────────────────────
// TC-F-031: handleGuestMessage — 온도 키워드
// ─────────────────────────────────────────────
describe('TC-F-031: handleGuestMessage — 온도 키워드 → 온도 초안', () => {
  test('"덥다" 메시지 → 에어컨/온도 관련 초안', () => {
    const alerts = [];
    let draftText = null;

    const deps = makeDeps({
      setDraft: (_, text) => { draftText = text; },
      addAlert: (alert) => alerts.push(alert),
    });

    handleGuestMessage(
      { id: 'msg-2', guestId: 'guest-001', text: '방이 너무 더워요', time: '16:00' },
      makeBooking(),
      deps
    );

    assert.ok(draftText.includes('에어컨') || draftText.includes('온도') || draftText.includes('냉방'));
    assert.ok(draftText.includes('김민준'));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].time, '16:00');
  });
});

// ─────────────────────────────────────────────
// TC-F-032: handleGuestMessage — 일반 응대
// ─────────────────────────────────────────────
describe('TC-F-032: handleGuestMessage — 키워드 없음 → 일반 응대', () => {
  test('키워드 없는 메시지 → 일반 응대 초안 + 게스트 이름 포함', () => {
    const alerts = [];
    let draftText = null;

    const deps = makeDeps({
      setDraft: (_, text) => { draftText = text; },
      addAlert: (alert) => alerts.push(alert),
    });

    handleGuestMessage(
      { id: 'msg-3', guestId: 'guest-001', text: '안녕하세요~', time: '10:00' },
      makeBooking(),
      deps
    );

    assert.ok(draftText.includes('김민준'), `초안: ${draftText}`);
    assert.ok(draftText.length > 0);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'info');
  });
});

// ─────────────────────────────────────────────
// TC-F-033: handleGuestMessage — 예외 처리
// ─────────────────────────────────────────────
describe('TC-F-033: handleGuestMessage — 인수 누락 예외', () => {
  test('msg 누락 → throw', () => {
    assert.throws(
      () => handleGuestMessage(null, makeBooking(), makeDeps()),
      /msg is required/
    );
  });

  test('booking 누락 → throw', () => {
    assert.throws(
      () => handleGuestMessage({ text: '안녕', time: '10:00' }, null, makeDeps()),
      /booking is required/
    );
  });
});

// ─────────────────────────────────────────────
// TC-F-034: pollSensors — updateReadings 항상 호출
// ─────────────────────────────────────────────
describe('TC-F-034: pollSensors — updateReadings 이상 여부 무관 항상 호출', () => {
  test('정상 읽기 → updateReadings 호출', async () => {
    let called = false;
    let updated = null;
    const deps = makeDeps({
      updateReadings: (propId, reading) => {
        called = true;
        updated = { propId, reading };
      },
    });
    await pollSensors('P-001', T, deps);
    assert.equal(called, true);
    assert.equal(updated.propId, 'P-001');
    assert.equal(updated.reading.propId, 'P-001');
  });

  test('이상 감지 → updateReadings도 여전히 호출', async () => {
    let called = false;
    const deps = makeDeps({
      getSensorStates: async () => makeReading({ temp: 36 }),
      updateReadings: () => { called = true; },
      addAlert: () => {},
    });
    await pollSensors('P-001', T, deps);
    assert.equal(called, true);
  });
});

// ─────────────────────────────────────────────
// TC-F-035: pollSensors — 반환 구조 검증
// ─────────────────────────────────────────────
describe('TC-F-035: pollSensors — S03PollResult 구조 검증', () => {
  test('정상 결과에 필수 필드 모두 포함', async () => {
    const result = await pollSensors('P-042', T, makeDeps({
      getSensorStates: async () => makeReading({ propId: 'P-042' }),
    }));

    assert.ok('propId'  in result, 'propId 없음');
    assert.ok('status'  in result, 'status 없음');
    assert.ok('reading' in result, 'reading 없음');
    assert.ok('anomaly' in result, 'anomaly 없음');
    assert.ok('error'   in result, 'error 없음');
    assert.equal(result.propId, 'P-042');
  });

  test('에러 결과에 error 메시지 포함', async () => {
    const result = await pollSensors('P-042', T, makeDeps({
      getSensorStates: async () => { throw new Error('HA down'); },
    }));

    assert.equal(result.status, 'error');
    assert.equal(result.reading, null);
    assert.equal(result.anomaly, null);
    assert.ok(result.error.includes('HA down'));
  });
});

// ─────────────────────────────────────────────
// TC-F-036: handleGuestMessage — 알림 시각 포함
// ─────────────────────────────────────────────
describe('TC-F-036: handleGuestMessage — 알림에 메시지 수신 시각 포함', () => {
  test('msg.time이 알림 time에 반영됨', () => {
    const alerts = [];

    const deps = makeDeps({
      setDraft: () => {},
      addAlert: (alert) => alerts.push(alert),
    });

    handleGuestMessage(
      { id: 'msg-4', guestId: 'guest-001', text: '체크아웃 어떻게 하나요?', time: '11:05' },
      makeBooking(),
      deps
    );

    assert.equal(alerts[0].time, '11:05');
  });

  test('msg.time 없어도 에러 없이 처리됨 (현재 시각으로 대체)', () => {
    const alerts = [];
    const deps = makeDeps({
      setDraft: () => {},
      addAlert: (alert) => alerts.push(alert),
    });

    assert.doesNotThrow(() =>
      handleGuestMessage(
        { id: 'msg-5', guestId: 'guest-001', text: '안녕하세요' },
        makeBooking(),
        deps
      )
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].prop, 'P-001');
    assert.equal(typeof alerts[0].time, 'string');
    assert.match(alerts[0].time, /^\d{2}:\d{2}$/);
  });
});
