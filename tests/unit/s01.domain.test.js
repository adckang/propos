import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { filterTomorrowCheckIns } from "../../src/domain/bookingDomain.js";
import { generatePIN, calcExpiry } from "../../src/domain/pinDomain.js";
import { buildWelcomeMessage } from "../../src/domain/messageDomain.js";

// ============================================================
// bookingDomain
// ============================================================
describe('bookingDomain.filterTomorrowCheckIns', () => {

  const BOOKINGS = [
    { propId: 'P-001', guestName: '김민준', checkIn: '2026-03-28T15:00:00', checkOut: '2026-03-30T11:00:00', status: 'confirmed', pinRequired: true },
    { propId: 'P-002', guestName: '이수진', checkIn: '2026-03-28T14:00:00', checkOut: '2026-03-29T11:00:00', status: 'confirmed', pinRequired: true },
    { propId: 'P-003', guestName: '박지호', checkIn: '2026-03-28T16:00:00', checkOut: '2026-03-31T11:00:00', status: 'pending',   pinRequired: true },
    { propId: 'P-004', guestName: '최유나', checkIn: '2026-03-29T15:00:00', checkOut: '2026-03-31T11:00:00', status: 'confirmed', pinRequired: true },
    { propId: 'P-005', guestName: '정민서', checkIn: '2026-03-27T15:00:00', checkOut: '2026-03-28T11:00:00', status: 'confirmed', pinRequired: true },
  ];

  test('내일 체크인 + confirmed 만 반환한다', () => {
    const result = filterTomorrowCheckIns(BOOKINGS, '2026-03-27');
    assert.equal(result.length, 2);
    assert.ok(result.every(b => b.checkIn.startsWith('2026-03-28')));
    assert.ok(result.every(b => b.status === 'confirmed'));
  });

  test('pending 상태는 제외한다', () => {
    const result = filterTomorrowCheckIns(BOOKINGS, '2026-03-27');
    assert.ok(result.every(b => b.status !== 'pending'));
  });

  test('모레 이후 체크인은 제외한다', () => {
    const result = filterTomorrowCheckIns(BOOKINGS, '2026-03-27');
    assert.ok(result.every(b => !b.checkIn.startsWith('2026-03-29')));
  });

  test('오늘 이전 체크인은 제외한다', () => {
    const result = filterTomorrowCheckIns(BOOKINGS, '2026-03-27');
    assert.ok(result.every(b => !b.checkIn.startsWith('2026-03-27')));
  });

  test('빈 배열 입력 시 빈 배열 반환', () => {
    const result = filterTomorrowCheckIns([], '2026-03-27');
    assert.deepEqual(result, []);
  });

  test('null 입력 시 빈 배열 반환', () => {
    const result = filterTomorrowCheckIns(null, '2026-03-27');
    assert.deepEqual(result, []);
  });

  test('월말 경계: 3월 31일 → 4월 1일 체크인 반환', () => {
    const booking = { propId: 'P-099', guestName: '테스트', checkIn: '2026-04-01T15:00:00', checkOut: '2026-04-03T11:00:00', status: 'confirmed' };
    const result = filterTomorrowCheckIns([booking], '2026-03-31');
    assert.equal(result.length, 1);
  });
});

// ============================================================
// pinDomain.generatePIN
// ============================================================
describe('pinDomain.generatePIN', () => {

  test('6자리 문자열을 반환한다', () => {
    const pin = generatePIN();
    assert.equal(typeof pin, 'string');
    assert.equal(pin.length, 6);
  });

  test('숫자로만 구성된다', () => {
    const pin = generatePIN();
    assert.match(pin, /^\d{6}$/);
  });

  test('000000 ~ 999999 범위 내에 있다', () => {
    const n = parseInt(generatePIN(), 10);
    assert.ok(n >= 0 && n <= 999999);
  });

  test('선행 0 패딩 정상 동작 (랜덤 100회 중 6자리 유지)', () => {
    for (let i = 0; i < 100; i++) {
      const pin = generatePIN();
      assert.equal(pin.length, 6, `PIN "${pin}" is not 6 digits`);
    }
  });
});

// ============================================================
// pinDomain.calcExpiry
// ============================================================
describe('pinDomain.calcExpiry', () => {

  test('validFrom = checkIn - 1시간', () => {
    const { validFrom } = calcExpiry('2026-03-28T15:00:00', '2026-03-30T11:00:00');
    const from = new Date(validFrom);
    assert.equal(from.getUTCHours(), 14);
    assert.equal(from.getUTCMinutes(), 0);
  });

  test('validUntil = checkOut 그대로', () => {
    const { validUntil } = calcExpiry('2026-03-28T15:00:00', '2026-03-30T11:00:00');
    const until = new Date(validUntil);
    assert.equal(until.getUTCFullYear(), 2026);
    assert.equal(until.getUTCMonth(),    2);   // 0-based → 3월
    assert.equal(until.getUTCDate(),     30);
    assert.equal(until.getUTCHours(),    11);
    assert.equal(until.getUTCMinutes(),  0);
  });

  test('자정 경계: 00:00 체크인 → validFrom = 전날 23:00', () => {
    const { validFrom } = calcExpiry('2026-03-28T00:00:00', '2026-03-30T11:00:00');
    const from = new Date(validFrom);
    assert.equal(from.getUTCDate(), 27);
    assert.equal(from.getUTCHours(), 23);
  });

  test('checkIn 없으면 에러', () => {
    assert.throws(() => calcExpiry('', '2026-03-30T11:00:00'), /required/);
  });

  test('checkOut 없으면 에러', () => {
    assert.throws(() => calcExpiry('2026-03-28T15:00:00', ''), /required/);
  });

  test('checkOut이 checkIn보다 앞이면 에러', () => {
    assert.throws(
      () => calcExpiry('2026-03-30T11:00:00', '2026-03-28T15:00:00'),
      /after/
    );
  });

  test('잘못된 날짜 문자열이면 에러', () => {
    assert.throws(() => calcExpiry('not-a-date', '2026-03-30T11:00:00'), /Invalid/);
  });
});

// ============================================================
// messageDomain.buildWelcomeMessage
// ============================================================
describe('messageDomain.buildWelcomeMessage', () => {

  const BOOKING = {
    guestName: '김민준',
    propName:  '해운대 오션뷰 펜트하우스',
    checkIn:   '2026-03-28T15:00:00.000Z',
    checkOut:  '2026-03-30T11:00:00.000Z',
    wifi:      { ssid: 'ProposGuest_5G', pw: '1234567890' },
  };

  const PIN_RECORD = { pin: '492817', validFrom: '2026-03-28T14:00:00.000Z', validUntil: '2026-03-30T11:00:00.000Z' };

  test('게스트 이름이 포함된다', () => {
    const msg = buildWelcomeMessage(BOOKING, PIN_RECORD);
    assert.ok(msg.includes('김민준'));
  });

  test('PIN이 포함된다', () => {
    const msg = buildWelcomeMessage(BOOKING, PIN_RECORD);
    assert.ok(msg.includes('492817'));
  });

  test('WiFi SSID가 포함된다', () => {
    const msg = buildWelcomeMessage(BOOKING, PIN_RECORD);
    assert.ok(msg.includes('ProposGuest_5G'));
  });

  test('WiFi 비밀번호가 포함된다', () => {
    const msg = buildWelcomeMessage(BOOKING, PIN_RECORD);
    assert.ok(msg.includes('1234567890'));
  });

  test('문자열을 반환한다', () => {
    const msg = buildWelcomeMessage(BOOKING, PIN_RECORD);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
  });

  test('wifi 없어도 에러 없이 동작한다', () => {
    const noWifi = { ...BOOKING, wifi: null };
    assert.doesNotThrow(() => buildWelcomeMessage(noWifi, PIN_RECORD));
  });

  test('booking 없으면 에러', () => {
    assert.throws(() => buildWelcomeMessage(null, PIN_RECORD), /required/);
  });

  test('pinRecord 없으면 에러', () => {
    assert.throws(() => buildWelcomeMessage(BOOKING, null), /required/);
  });

  test('guestName 없으면 에러', () => {
    const noName = { ...BOOKING, guestName: '' };
    assert.throws(() => buildWelcomeMessage(noName, PIN_RECORD), /required/);
  });

  test('pin 없으면 에러', () => {
    assert.throws(() => buildWelcomeMessage(BOOKING, { pin: '' }), /required/);
  });
});
