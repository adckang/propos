import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDir, "..");

export function resolveRepoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

export function repoFileExists(relativePath) {
  return fs.existsSync(resolveRepoPath(relativePath));
}

export function readRepoFile(relativePath) {
  return fs.readFileSync(resolveRepoPath(relativePath), "utf8");
}

function ensureString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[scenarios] ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`[scenarios] ${label} must be an array.`);
  }
  return value;
}

function ensureUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    const id = ensureString(item.id, `${label}.id`);
    if (ids.has(id)) {
      throw new Error(`[scenarios] Duplicate ${label} id: ${id}`);
    }
    ids.add(id);
  }
}

export function loadScenarioRegistry() {
  const registry = YAML.parse(readRepoFile("docs/scenarios.yaml"));

  if (!registry || typeof registry !== "object") {
    throw new Error("[scenarios] docs/scenarios.yaml must parse to an object.");
  }

  ensureString(String(registry.version ?? ""), "version");
  ensureString(registry.updated_at, "updated_at");
  ensureArray(registry.system_pages, "system_pages");
  ensureArray(registry.scenarios, "scenarios");

  ensureUniqueIds(registry.system_pages, "system_pages");
  ensureUniqueIds(registry.scenarios, "scenarios");

  for (const page of registry.system_pages) {
    ensureString(page.title, `${page.id}.title`);
    ensureString(page.screen_key, `${page.id}.screen_key`);
    ensureString(page.component, `${page.id}.component`);
    ensureString(page.primary_user, `${page.id}.primary_user`);
    ensureString(page.purpose, `${page.id}.purpose`);
    ensureArray(page.stage_coverage, `${page.id}.stage_coverage`);
    ensureArray(page.key_questions, `${page.id}.key_questions`);
  }

  for (const scenario of registry.scenarios) {
    ensureString(scenario.use_case_id, `${scenario.id}.use_case_id`);
    ensureString(scenario.screen_key, `${scenario.id}.screen_key`);
    ensureString(scenario.title, `${scenario.id}.title`);
    ensureString(scenario.stage_label, `${scenario.id}.stage_label`);
    ensureString(scenario.landing_label, `${scenario.id}.landing_label`);
    ensureString(scenario.component, `${scenario.id}.component`);
    ensureString(scenario.diagram, `${scenario.id}.diagram`);
    ensureString(scenario.functional_test, `${scenario.id}.functional_test`);
    ensureString(scenario.service, `${scenario.id}.service`);
    ensureString(scenario.entry_function, `${scenario.id}.entry_function`);
    ensureString(scenario.trigger, `${scenario.id}.trigger`);
    ensureString(scenario.primary_job, `${scenario.id}.primary_job`);
    ensureString(scenario.success_signal, `${scenario.id}.success_signal`);
    ensureArray(scenario.domain_modules, `${scenario.id}.domain_modules`);
    ensureArray(scenario.primary_actions, `${scenario.id}.primary_actions`);
  }

  return registry;
}
