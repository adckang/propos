import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.join(configDir, "propos.config.json");
const exampleConfigPath = path.join(configDir, "propos.config.json.example");

function readJsonConfig(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cloneConfig(config) {
  return {
    ...config,
    ha: { ...(config.ha || {}) },
    entities: { ...(config.entities || {}) },
    sensorThresholds: { ...(config.sensorThresholds || {}) },
    polling: { ...(config.polling || {}) },
    defaultProps: Array.isArray(config.defaultProps) ? [...config.defaultProps] : [],
  };
}

function applyEnvOverrides(config) {
  const next = cloneConfig(config);

  const overrides = [
    ["PROPOS_HA_BASE_URL", ["ha", "baseUrl"]],
    ["PROPOS_HA_WS_URL", ["ha", "wsUrl"]],
    ["PROPOS_HA_TOKEN", ["ha", "token"]],
  ];

  for (const [envKey, [section, key]] of overrides) {
    const value = process.env[envKey];
    if (!value || !value.trim()) continue;
    next[section][key] = value.trim();
  }

  return next;
}

function loadPrivateConfig() {
  const baseConfig = fs.existsSync(localConfigPath)
    ? readJsonConfig(localConfigPath)
    : readJsonConfig(exampleConfigPath);

  return applyEnvOverrides(baseConfig);
}

const privateConfig = loadPrivateConfig();

export { loadPrivateConfig };

export default privateConfig;
