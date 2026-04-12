import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.join(configDir, "propos.config.json");
const exampleConfigPath = path.join(configDir, "propos.config.json.example");

function readJsonConfig(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadPrivateConfig() {
  if (fs.existsSync(localConfigPath)) {
    return readJsonConfig(localConfigPath);
  }
  return readJsonConfig(exampleConfigPath);
}

const privateConfig = loadPrivateConfig();

export default privateConfig;
