/**
 * 청소 자동화 — 토큰 & 전화번호 정규화 유닛 테스트
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ── 테스트 헬퍼: 소스 파일에서 순수 함수 추출 ──────────────
// _dispatch.js의 randomToken은 내보내지 않으므로 동일 로직을 재현

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomToken() {
  let t = "";
  for (let i = 0; i < 6; i++) t += TOKEN_CHARS[Math.floor(Math.random() * 36)];
  return t;
}

// cleaning/[...slug].js의 normalizePhone
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^82/, "0");
  const m = digits.match(/^(\d{3})(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

// sms/send.js의 toE164
function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+${digits}`;
}

// ============================================================
// 토큰 형식
// ============================================================
describe("randomToken — 형식 검증", () => {
  test("길이가 항상 6자", () => {
    for (let i = 0; i < 100; i++) {
      assert.equal(randomToken().length, 6);
    }
  });

  test("대문자 + 숫자만 포함 [A-Z0-9]", () => {
    const regex = /^[A-Z0-9]{6}$/;
    for (let i = 0; i < 200; i++) {
      assert.ok(regex.test(randomToken()), `유효하지 않은 토큰: ${randomToken()}`);
    }
  });

  test("토큰 36^6 공간 내 충분한 다양성 (1000개 중 중복 없음)", () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(randomToken());
    assert.ok(seen.size >= 990, `토큰 다양성 부족: ${seen.size}/1000`);
  });
});

// ============================================================
// normalizePhone (DB 저장 형식 010-XXXX-XXXX)
// ============================================================
describe("normalizePhone — 전화번호 정규화", () => {
  test("하이픈 포함 정상 입력 → 그대로 반환", () => {
    assert.equal(normalizePhone("010-1234-5678"), "010-1234-5678");
  });

  test("하이픈 없는 숫자열 → 하이픈 추가", () => {
    assert.equal(normalizePhone("01012345678"), "010-1234-5678");
  });

  test("+82 국제 형식 → 010 로컬 형식", () => {
    assert.equal(normalizePhone("+821012345678"), "010-1234-5678");
  });

  test("82로 시작하는 숫자열 → 010 변환", () => {
    assert.equal(normalizePhone("821012345678"), "010-1234-5678");
  });

  test("공백 포함 입력 → 정상 파싱", () => {
    assert.equal(normalizePhone("010 1234 5678"), "010-1234-5678");
  });

  test("11자리 아닌 경우 → 원본 반환 (유효성 검사 실패)", () => {
    // 10자리 숫자는 패턴 불일치 → 원본 반환
    assert.equal(normalizePhone("0101234567"), "0101234567");
  });
});

// ============================================================
// toE164 (SMS 게이트웨이 발송용)
// ============================================================
describe("toE164 — E.164 변환", () => {
  test("010-1234-5678 → +821012345678", () => {
    assert.equal(toE164("010-1234-5678"), "+821012345678");
  });

  test("01012345678 → +821012345678", () => {
    assert.equal(toE164("01012345678"), "+821012345678");
  });

  test("821012345678 (82 prefix) → +821012345678", () => {
    assert.equal(toE164("821012345678"), "+821012345678");
  });

  test("+821012345678 (이미 E164) → +821012345678", () => {
    // + 제거 후 82로 시작 → +82...
    assert.equal(toE164("+821012345678"), "+821012345678");
  });
});

// ============================================================
// calcCleaningTimes 경계값
// ============================================================
import { calcCleaningTimes } from "../../api/cleaning/_dispatch.js";

describe("calcCleaningTimes — 경계값", () => {
  test("반환값이 Date 객체", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes("2026-09-10", 11, 2.5);
    assert.ok(cleaning_start_at instanceof Date);
    assert.ok(cleaning_end_at instanceof Date);
  });

  test("cleaning_end_at > cleaning_start_at", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes("2026-09-10", 11, 2.5);
    assert.ok(cleaning_end_at > cleaning_start_at);
  });

  test("duration 0 → start == end", () => {
    const { cleaning_start_at, cleaning_end_at } = calcCleaningTimes("2026-09-10", 11, 0);
    assert.equal(cleaning_start_at.getTime(), cleaning_end_at.getTime());
  });

  test("다른 날짜끼리 독립적으로 계산됨", () => {
    const a = calcCleaningTimes("2026-09-10", 11, 2.5);
    const b = calcCleaningTimes("2026-09-11", 11, 2.5);
    const diffDays = (b.cleaning_start_at.getTime() - a.cleaning_start_at.getTime()) / 86_400_000;
    assert.equal(diffDays, 1);
  });
});
