import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCleaningUnassignedCriterion } from '../../server/cleaning/_unassignedAnomalies.js';

test('체크인 임박 청소 미배정 알림은 발생 기준과 실제 해결 기준을 함께 표시한다', () => {
  assert.equal(
    formatCleaningUnassignedCriterion(0),
    '기준: 체크인 12시간 이내 · 해결 확인: 즉시',
  );
  assert.equal(
    formatCleaningUnassignedCriterion(7),
    '기준: 체크인 12시간 이내 · 정상 7분 유지 시 해결',
  );
});
