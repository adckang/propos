/**
 * Pi 이벤트 아웃박스 — NDJSON 큐 읽기/쓰기/제거/deadLetter 이동.
 *
 * 설계 원칙:
 * - 한 줄 = 이벤트 1개 (NDJSON, JSON.parse 안전)
 * - removeFromQueue/moveToDeadLetter: 원자 교체 (임시 파일 → rename)
 * - 손상된 줄은 조용히 건너뜀 (마지막 줄 write 중단 복구)
 */

import {
  readFile,
  writeFile,
  rename,
  appendFile,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * 이벤트 1개를 NDJSON 줄로 파일 끝에 추가한다.
 * @param {string} queuePath
 * @param {object} event
 */
export async function appendToQueue(queuePath, event) {
  await appendFile(queuePath, JSON.stringify(event) + "\n", "utf8");
}

/**
 * NDJSON 파일을 읽어 파싱된 이벤트 배열을 반환한다.
 * 파일이 없으면 빈 배열 반환. 손상된 줄은 건너뜀.
 * @param {string} queuePath
 * @returns {Promise<object[]>}
 */
export async function readQueue(queuePath) {
  if (!existsSync(queuePath)) return [];

  const raw = await readFile(queuePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  const result = [];
  for (const line of lines) {
    try {
      result.push(JSON.parse(line));
    } catch {
      // 손상된 줄 — 조용히 건너뜀
    }
  }
  return result;
}

/**
 * 큐에서 특정 id의 이벤트를 제거한다. 원자 교체 방식.
 * @param {string} queuePath
 * @param {string} id
 */
export async function removeFromQueue(queuePath, id) {
  const events = await readQueue(queuePath);
  const remaining = events.filter((e) => e.id !== id);
  await _writeAtomic(queuePath, remaining);
}

/**
 * 특정 id를 원본 큐에서 제거하고 deadLetter 파일에 추가한다.
 * @param {string} queuePath
 * @param {string} deadLetterPath
 * @param {string} id
 */
export async function moveToDeadLetter(queuePath, deadLetterPath, id) {
  const events = await readQueue(queuePath);
  const target = events.find((e) => e.id === id);
  if (!target) return;

  const remaining = events.filter((e) => e.id !== id);
  await appendToQueue(deadLetterPath, target);  // dead letter 먼저 (크래시 시 소실 방지)
  await _writeAtomic(queuePath, remaining);
}

// NDJSON 배열을 임시 파일에 쓰고 원자적으로 교체한다.
async function _writeAtomic(targetPath, events) {
  const tmpPath = targetPath + ".tmp";
  const content = events.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(tmpPath, content ? content + "\n" : "", "utf8");
  await rename(tmpPath, targetPath);
}
