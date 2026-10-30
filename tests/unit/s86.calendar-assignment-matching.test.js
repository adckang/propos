/**
 * s86 — Google Calendar 참석자 → 청소자 매칭 및 기존 ASSIGNED(NULL) 복구 계약
 *
 * 실제 운영 DB에서 파주201의 ASSIGNED 21건 모두 assigned_cleaner_id=NULL인 상태가
 * 확인되어 추가한 회귀 테스트다.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { attendeeEmailsForCleaner, matchCleanerAttendee } from '../../src/domain/calendarAssignmentDomain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const apiSource = read('api/cleaning/[...slug].js');

function functionBlock(name, nextName) {
  const m = apiSource.match(new RegExp(`async function ${name}[\\s\\S]*?(?=\\nasync function ${nextName}|\\nconst |\\nexport default)`));
  assert.ok(m, `${name} 블록을 찾지 못함`);
  return m[0];
}

describe('Calendar 담당자 매칭 도메인', () => {
  test('주최자가 첫 번째 참석자여도 등록된 청소 담당자를 찾는다', () => {
    const attendees = [
      { email: 'bnb.paju@gmail.com' },
      { email: ' CLEANER@example.com ' },
    ];
    const cleaners = [{ id: 'c-1', email: 'cleaner@example.com', name: '김청소' }];
    const result = matchCleanerAttendee(attendees, cleaners, 'bnb.paju@gmail.com');
    assert.equal(result?.email, 'cleaner@example.com');
    assert.equal(result?.cleaner.id, 'c-1');
  });

  test('주최자 이메일은 후보에서 제외하고 후보 순서를 보존한다', () => {
    const emails = attendeeEmailsForCleaner([
      { email: 'BNB.PAJU@GMAIL.COM' },
      { email: 'one@example.com' },
      { email: 'one@example.com' },
      { email: 'two@example.com' },
    ], 'bnb.paju@gmail.com');
    assert.deepEqual(emails, ['one@example.com', 'two@example.com']);
  });

  test('등록된 담당자가 없으면 null을 반환한다', () => {
    const result = matchCleanerAttendee(
      [{ email: 'bnb.paju@gmail.com' }, { email: 'unknown@example.com' }],
      [{ id: 'c-1', email: 'other@example.com' }],
      'bnb.paju@gmail.com',
    );
    assert.equal(result, null);
  });
});

describe('Calendar Webhook/Scan — 담당자 없는 ASSIGNED 오염 방지 및 복구', () => {
  test('Webhook은 attendees[0]만 사용하지 않고 공용 담당자 매칭을 사용한다', () => {
    const block = functionBlock('handleCalendarWebhook', 'handleGmailWebhook');
    assert.match(block, /resolveCalendarCleaner/);
    assert.doesNotMatch(block, /evt\.attendees\?\.\[0\]\?\.email/);
  });

  test('수동 Scan도 attendees[0]만 사용하지 않고 공용 담당자 매칭을 사용한다', () => {
    const block = functionBlock('handleCalendarScan', 'registerGmailWatch');
    assert.match(block, /resolveCalendarCleaner/);
    assert.doesNotMatch(block, /evt\.attendees\[0\]\.email/);
  });

  test('Webhook/Scan 모두 assigned_cleaner_id가 없는 ASSIGNED 작업을 복구 대상으로 포함한다', () => {
    const blocks = [
      functionBlock('handleCalendarWebhook', 'handleGmailWebhook'),
      functionBlock('handleCalendarScan', 'registerGmailWatch'),
    ];
    for (const block of blocks) {
      assert.match(block, /status\s*=\s*'ASSIGNED'\s+AND\s+assigned_cleaner_id\s+IS\s+NULL/);
      assert.match(block, /assigned_cleaner_id\s+IS\s+NULL\)\s+RETURNING id/);
    }
  });

  test('담당자 매칭 실패 시에도 ASSIGNED + NULL을 새로 저장하지 않는다', () => {
    const blocks = [
      functionBlock('handleCalendarWebhook', 'handleGmailWebhook'),
      functionBlock('handleCalendarScan', 'registerGmailWatch'),
    ];
    for (const block of blocks) {
      assert.match(block, /if \(!cleaner\)/);
      assert.match(block, /continue/);
    }
  });
});
