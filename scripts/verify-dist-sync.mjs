import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (options.capture) {
    return result;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

console.log("[verify:dist] Rebuilding dist from src...");
run("npm", ["run", "build"]);

const status = run("git", ["status", "--short", "--", "dist"], { capture: true });
const output = (status.stdout || "").trim();

if (status.status !== 0) {
  console.error(status.stderr || "[verify:dist] Failed to inspect dist status.");
  process.exit(status.status ?? 1);
}

if (output) {
  console.error("[verify:dist] dist is out of sync with src. Rebuild and commit the generated output.");
  console.error(output);
  process.exit(1);
}

console.log("[verify:dist] dist is in sync.");
