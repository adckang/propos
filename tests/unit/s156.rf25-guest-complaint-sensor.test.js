import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGuestComplaintTopics,
  extractAirbnbGuestComplaint,
  extractAirbnbListingId,
} from '../../src/domain/guestComplaintEmailDomain.js';
import {
  EnvironmentSensorAnomalyDetector,
  ENVIRONMENT_SENSOR_DETECTION_MINUTES,
} from '../../src/application/environmentSensorAnomalyDetector.js';
import { request } from '../helpers/eventApiFixture.js';

const MIN = 60_000;
const b64 = value => Buffer.from(value).toString('base64url');

function gmailMessage({ from = 'Airbnb <automated@airbnb.com>', subject = 'Re: fixture stay', text } = {}) {
  const plain = text ?? [
    '%recipient.first_name%',
    'https://www.airbnb.co.kr/',
    'Fixture listing 예약(11월 20일~23일)',
    '',
    'Fixture guest',
    '오후 3:20',
    '방이 너무 덥고 습해요. 에어컨과 제습기를 확인해 주세요.',
    '',
    '답장 보내기',
    'https://www.airbnb.co.kr/hosting/thread/987654321?thread_type=host',
    '',
    'https://www.airbnb.co.kr/rooms/123456789',
  ].join('\n');
  return {
    id: 'gmail-message-1', threadId: 'gmail-thread-1', internalDate: String(Date.parse('2026-11-25T10:00:00Z')),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }],
      parts: [{ mimeType: 'text/plain', body: { data: b64(plain) } }],
    },
  };
}

test('RF-25 Gmail: Airbnb 새 답장 블록의 온도·습도 주제와 숙소·대화 ID만 추출한다', () => {
  const signal = extractAirbnbGuestComplaint(gmailMessage());
  assert.deepEqual(signal, {
    gmailMessageId: 'gmail-message-1', gmailThreadId: 'gmail-thread-1',
    airbnbRoomId: '123456789', airbnbThreadId: '987654321',
    occurredAt: '2026-11-25T10:00:00.000Z', topics: ['temperature', 'humidity'],
  });
  assert.ok(!Object.values(signal).includes('방이 너무 덥고 습해요. 에어컨과 제습기를 확인해 주세요.'));
  assert.equal(extractAirbnbGuestComplaint(gmailMessage({ from: 'Other <mail@example.com>' })), null);
  assert.equal(extractAirbnbGuestComplaint(gmailMessage({ text: gmailMessage().payload.parts[0].body.data })), null);
});

test('RF-25 Gmail: 실제 설정의 Airbnb iCal URL에서 메일 rooms ID와 같은 listing ID를 읽는다', () => {
  assert.equal(extractAirbnbListingId('https://www.airbnb.com/calendar/ical/123456789.ics?s=secret'), '123456789');
  assert.equal(extractAirbnbListingId('https://example.com/calendar/ical/not-a-number.ics'), null);
});

test('RF-25 Gmail: 단독 문의는 제외하고 온도·습도 표현만 분류한다', () => {
  assert.deepEqual(classifyGuestComplaintTopics('와이파이 비밀번호가 궁금해요'), []);
  assert.deepEqual(classifyGuestComplaintTopics('It is cold and very humid in the room'), ['temperature', 'humidity']);
});

test('RF-25 온습도 센서: 3분 지속 발생과 정상 재확인 시각을 재시작 상태에 보존한다', () => {
  const detector = new EnvironmentSensorAnomalyDetector();
  const input = (now, issueTopics) => detector.evaluate({ issueTopics, stayId: 'stay-1', eligible: true, observed: true, now });
  assert.deepEqual(input(0, ['temperature']), []);
  const active = input(ENVIRONMENT_SENSOR_DETECTION_MINUTES * MIN, ['temperature']);
  assert.equal(active[0].type, 'environment_sensor_anomaly');
  assert.deepEqual(active[0].data.topics, ['temperature']);
  const normalAt = 4 * MIN;
  const normal = input(normalAt, []);
  assert.equal(normal[0].type, 'environment_sensor_normal');
  assert.equal(normal[0].data.normalStartedAtByTopic.temperature, new Date(normalAt).toISOString());
  assert.equal(detector.acknowledgeNormal({
    stayId: 'stay-1', normalStartedAtByTopic: normal[0].data.normalStartedAtByTopic,
    results: { temperature: { complete: false, eligibleAt: new Date(14 * MIN).toISOString() } },
  }), true);
  const restored = new EnvironmentSensorAnomalyDetector();
  restored.restore(detector.snapshot());
  assert.deepEqual(restored.evaluate({ issueTopics: [], stayId: 'stay-1', eligible: true, observed: true, now: 13 * MIN }), []);
  assert.equal(restored.evaluate({ issueTopics: [], stayId: 'stay-1', eligible: true, observed: true, now: 14 * MIN })[0].type,
    'environment_sensor_normal');
});

test('RF-25 온습도 센서: 정상 대기 중 재발과 관측 공백은 안정화 구간을 다시 시작한다', () => {
  const detector = new EnvironmentSensorAnomalyDetector();
  detector.evaluate({ issueTopics: ['humidity'], stayId: 'stay-1', eligible: true, observed: true, now: 0 });
  detector.evaluate({ issueTopics: ['humidity'], stayId: 'stay-1', eligible: true, observed: true, now: 3 * MIN });
  detector.evaluate({ issueTopics: [], stayId: 'stay-1', eligible: true, observed: true, now: 4 * MIN });
  detector.evaluate({ issueTopics: [], stayId: 'stay-1', eligible: true, observed: false, now: 5 * MIN });
  const restarted = detector.evaluate({ issueTopics: [], stayId: 'stay-1', eligible: true, observed: true, now: 6 * MIN });
  assert.deepEqual(restarted[0].data.restartTopics, ['humidity']);
  const recurred = detector.evaluate({ issueTopics: ['humidity'], stayId: 'stay-1', eligible: true, observed: true, now: 7 * MIN });
  assert.deepEqual(recurred[0].data.recurredTopics, ['humidity']);
});

test('RF-25 게스트 불만 센서 이벤트 API는 정본 조정 결과와 실제 기준 알림을 전달한다', async () => {
  const result = { complete: false, alertLabel: '게스트 온도 불만 + 온습도 이상 · 기준: 메시지 전후 60분 이내 · 정상 10분 유지 시 해결' };
  const body = {
    type: 'environment_sensor_anomaly', property_id: 'fixture-property', device_time: '2026-11-25T10:03:00.000Z',
    data: { stayId: 'stay-1', topics: ['temperature'], detectionMinutes: ENVIRONMENT_SENSOR_DETECTION_MINUTES },
  };
  const call = await request('write', body, { guestComplaintResult: result });
  assert.equal(call.res.code, 200);
  assert.equal(call.guestComplaintSignals.length, 1);
  assert.equal(call.notices[0][3].label, result.alertLabel);
});
