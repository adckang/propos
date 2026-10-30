import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(path.join(ROOT, "api/cleaning/[...slug].js"), "utf8");

function functionBlock(name, nextName) {
  const match = source.match(new RegExp(`async function ${name}[\\s\\S]*?(?=\\nasync function ${nextName}|\\nconst |\\nexport default)`));
  assert.ok(match, `${name} 블록을 찾지 못함`);
  return match[0];
}

describe("iCal 수동 동기화 — 기존 Calendar 담당자 복구 연결", () => {
  test("서버 직접 동기화가 담당자 복구 루틴을 호출한다", () => {
    const block = functionBlock("handleIcalSync", "bootstrapBlockers");
    assert.match(block, /repairCalendarAssignments/);
  });

  test("복구 대상은 REAL 숙소의 ASSIGNED + assigned_cleaner_id NULL 작업으로 제한한다", () => {
    const block = functionBlock("repairCalendarAssignments", "handleIcalSync");
    assert.match(block, /data_origin='REAL'/);
    assert.match(block, /status='ASSIGNED'/);
    assert.match(block, /assigned_cleaner_id IS NULL/);
  });

  test("담당자 복구 실패가 iCal 예약 동기화 전체를 실패시키지 않는다", () => {
    const block = functionBlock("handleIcalSync", "bootstrapBlockers");
    assert.match(block, /try \{[\s\S]*repairCalendarAssignments/);
    assert.match(block, /catch \(e\)[\s\S]*assignmentRepair/);
  });
});
