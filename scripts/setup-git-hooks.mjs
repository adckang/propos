import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";

const hookPath = path.join(".githooks", "pre-commit");

if (!existsSync(".git") || !existsSync(hookPath)) {
  process.exit(0);
}

try {
  chmodSync(hookPath, 0o755);
} catch (_) {
  // Ignore chmod issues on unsupported filesystems.
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
