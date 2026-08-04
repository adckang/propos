import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendToQueue,
  readQueue,
  removeFromQueue,
  moveToDeadLetter,
} from "../../scripts/outbox.mjs";

let tmpDir;

// 테스트 격리: 매 test마다 새 임시 디렉토리
const setupDir = async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "propos-outbox-test-"));
};
const teardownDir = async () => {
  await rm(tmpDir, { recursive: true, force: true });
};

describe("outbox.mjs — appendToQueue / readQueue", () => {
  beforeEach(setupDir);
  afterEach(teardownDir);

  test("이벤트 1개 추가 → readQueue에서 정확히 1개 반환", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    const event = {
      id: "uuid-1",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    };
    await appendToQueue(qPath, event);
    const lines = await readQueue(qPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, "uuid-1");
    assert.equal(lines[0].type, "check_out_detected");
  });

  test("이벤트 여러 개 추가 → 삽입 순서 보장", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    for (let i = 1; i <= 3; i++) {
      await appendToQueue(qPath, {
        id: `uuid-${i}`,
        type: "check_in_detected",
        property_id: "paju201",
        device_time: new Date().toISOString(),
        retry: 0,
      });
    }
    const lines = await readQueue(qPath);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].id, "uuid-1");
    assert.equal(lines[1].id, "uuid-2");
    assert.equal(lines[2].id, "uuid-3");
  });

  test("파일 없을 때 readQueue → 빈 배열 반환 (에러 없음)", async () => {
    const qPath = join(tmpDir, "nonexistent.ndjson");
    const lines = await readQueue(qPath);
    assert.deepEqual(lines, []);
  });

  test("마지막 줄 손상 시 나머지 정상 줄만 읽음", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-1",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    await appendToQueue(qPath, {
      id: "uuid-2",
      type: "check_in_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    // 깨진 JSON 줄 추가
    await appendFile(qPath, '{"id":"uuid-3","broken\n');
    const lines = await readQueue(qPath);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].id, "uuid-1");
    assert.equal(lines[1].id, "uuid-2");
  });
});

describe("outbox.mjs — removeFromQueue", () => {
  beforeEach(setupDir);
  afterEach(teardownDir);

  test("처리 완료 이벤트 제거 → 파일에서 사라짐", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-1",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    await appendToQueue(qPath, {
      id: "uuid-2",
      type: "check_in_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    await removeFromQueue(qPath, "uuid-1");
    const lines = await readQueue(qPath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, "uuid-2");
  });

  test("존재하지 않는 id 제거 → 에러 없이 파일 유지", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-1",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    await removeFromQueue(qPath, "uuid-none");
    const lines = await readQueue(qPath);
    assert.equal(lines.length, 1); // 아무것도 안 지워짐
  });

  test("마지막 항목 제거 후 readQueue → 빈 배열", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-only",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 0,
    });
    await removeFromQueue(qPath, "uuid-only");
    const lines = await readQueue(qPath);
    assert.deepEqual(lines, []);
  });
});

describe("outbox.mjs — moveToDeadLetter", () => {
  beforeEach(setupDir);
  afterEach(teardownDir);

  test("원본 큐에서 제거 + deadLetter에 추가", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    const dlPath = join(tmpDir, "deadLetter.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-bad",
      type: "check_out_detected",
      property_id: "paju201",
      device_time: new Date().toISOString(),
      retry: 3,
    });
    await moveToDeadLetter(qPath, dlPath, "uuid-bad");
    const queue = await readQueue(qPath);
    const dead = await readQueue(dlPath);
    assert.equal(queue.length, 0);
    assert.equal(dead.length, 1);
    assert.equal(dead[0].id, "uuid-bad");
  });

  test("deadLetter 파일 없어도 자동 생성", async () => {
    const qPath = join(tmpDir, "eventQueue.ndjson");
    const dlPath = join(tmpDir, "nonexistent-dl.ndjson");
    await appendToQueue(qPath, {
      id: "uuid-x",
      type: "complaint_detected",
      property_id: "paju202",
      device_time: new Date().toISOString(),
      retry: 3,
    });
    await moveToDeadLetter(qPath, dlPath, "uuid-x");
    const dead = await readQueue(dlPath);
    assert.equal(dead.length, 1);
  });
});
