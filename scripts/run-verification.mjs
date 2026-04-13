import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const VERIFY_STEPS = [
  {
    id: "unit-functional",
    label: "Unit + Functional Tests",
    command: "npm",
    args: ["test"],
  },
  {
    id: "scenario-sync",
    label: "Scenario Sync Verification",
    command: "npm",
    args: ["run", "verify:scenarios"],
  },
  {
    id: "deploy-ready",
    label: "Deployment Readiness Verification",
    command: "npm",
    args: ["run", "verify:deploy"],
  },
  {
    id: "dist-sync",
    label: "Dist Sync Verification",
    command: "npm",
    args: ["run", "verify:dist"],
  },
  {
    id: "smoke",
    label: "Smoke Tests",
    command: "npm",
    args: ["run", "test:smoke"],
  },
];

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function formatDuration(durationMs) {
  const seconds = (durationMs / 1000).toFixed(durationMs >= 10000 ? 1 : 2);
  return `${seconds}s`;
}

function buildSummaryMarkdown(summary) {
  const lines = [
    "# Verification Summary",
    "",
    `- Run ID: \`${summary.runId}\``,
    `- Started At: ${summary.startedAt}`,
    `- Finished At: ${summary.finishedAt}`,
    `- Overall Status: ${summary.status.toUpperCase()}`,
    `- Total Duration: ${formatDuration(summary.durationMs)}`,
    "",
    "## Steps",
    "",
    "| Step | Status | Duration | Log |",
    "|------|--------|----------|-----|",
  ];

  for (const step of summary.steps) {
    lines.push(`| ${step.label} | ${step.status.toUpperCase()} | ${formatDuration(step.durationMs)} | \`${step.id}.log\` |`);
  }

  lines.push("");

  const failedSteps = summary.steps.filter((step) => step.status === "failed");
  if (failedSteps.length > 0) {
    lines.push("## Failures", "");
    for (const step of failedSteps) {
      lines.push(`- ${step.label}: ${step.errorMessage ?? "See log file"}`);
    }
    lines.push("");
  }

  lines.push("## How To Read", "");
  lines.push("- Open `summary.md` first.");
  lines.push("- If a step failed, open the matching `*.log` file.");

  return `${lines.join("\n")}\n`;
}

function runStep(step) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const start = process.hrtime.bigint();
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let spawnError = null;

    const onChunk = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (error) => {
      spawnError = error;
    });

    child.on("close", (code) => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({
        ...step,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs,
        status: code === 0 && !spawnError ? "passed" : "failed",
        exitCode: code ?? 1,
        output,
        errorMessage: spawnError ? spawnError.message : null,
      });
    });
  });
}

async function writeRunArtifacts(runDir, latestDir, summary, steps) {
  for (const step of steps) {
    await writeFile(path.join(runDir, `${step.id}.log`), step.output, "utf8");
    await writeFile(path.join(latestDir, `${step.id}.log`), step.output, "utf8");
  }

  const summaryJson = JSON.stringify(summary, null, 2);
  const summaryMd = buildSummaryMarkdown(summary);

  await writeFile(path.join(runDir, "summary.json"), summaryJson, "utf8");
  await writeFile(path.join(runDir, "summary.md"), summaryMd, "utf8");
  await writeFile(path.join(latestDir, "summary.json"), summaryJson, "utf8");
  await writeFile(path.join(latestDir, "summary.md"), summaryMd, "utf8");
}

async function main() {
  const startedAt = new Date();
  const runId = formatTimestamp(startedAt);
  const baseDir = path.join(process.cwd(), "artifacts", "verification");
  const historyDir = path.join(baseDir, "history");
  const runDir = path.join(historyDir, runId);
  const latestDir = path.join(baseDir, "latest");

  await mkdir(runDir, { recursive: true });
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });

  const steps = [];
  for (const step of VERIFY_STEPS) {
    console.log(`\n==> ${step.label}`);
    steps.push(await runStep(step));
  }

  const finishedAt = new Date();
  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status: steps.every((step) => step.status === "passed") ? "passed" : "failed",
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      durationMs: step.durationMs,
      exitCode: step.exitCode,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      errorMessage: step.errorMessage,
    })),
  };

  await writeRunArtifacts(runDir, latestDir, summary, steps);

  console.log(`\nVerification summary saved to ${path.relative(process.cwd(), latestDir)}/summary.md`);
  console.log(`Verification history saved to ${path.relative(process.cwd(), runDir)}/summary.md`);

  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
