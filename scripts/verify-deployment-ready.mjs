import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

const errors = [];

const vercelConfig = JSON.parse(readRepoFile("vercel.json"));
const privateConfigSource = readRepoFile("src/config/privateConfig.js");
const readmeSource = readRepoFile("README.md");
const envExampleSource = readRepoFile(".env.vercel.example");

assert(vercelConfig.outputDirectory === "dist", "[verify:deploy] vercel.json outputDirectory must be \"dist\".", errors);
assert(vercelConfig.buildCommand === "npm run build", "[verify:deploy] vercel.json buildCommand must be \"npm run build\".", errors);

const hasSpaRewrite = Array.isArray(vercelConfig.rewrites) && vercelConfig.rewrites.some(rule => (
  rule?.destination === "/index.html"
));
assert(hasSpaRewrite, "[verify:deploy] vercel.json must rewrite SPA routes to /index.html.", errors);

for (const [source, slug] of [
  ["/api/stats/calendar", "calendar"],
  ["/api/stats/drilldown", "drilldown"],
]) {
  const hasStatsRewrite = vercelConfig.rewrites.some(rule => (
    rule?.source === source && rule?.destination === `/api/stats?slug=${slug}`
  ));
  assert(hasStatsRewrite, `[verify:deploy] vercel.json must route ${source} through api/stats.js.`, errors);
}

const hasNoStoreHeader = Array.isArray(vercelConfig.headers) && vercelConfig.headers.some(entry => (
  entry?.source === "/api/ha/:path*" &&
  Array.isArray(entry.headers) &&
  entry.headers.some(header => header.key === "Cache-Control" && header.value === "no-store")
));
assert(hasNoStoreHeader, "[verify:deploy] vercel.json must set Cache-Control: no-store for /api/ha/*.", errors);

const hasIcalNoStoreHeader = Array.isArray(vercelConfig.headers) && vercelConfig.headers.some(entry => (
  entry?.source === "/api/ical" &&
  Array.isArray(entry.headers) &&
  entry.headers.some(header => header.key === "Cache-Control" && header.value === "no-store")
));
assert(hasIcalNoStoreHeader, "[verify:deploy] vercel.json must set Cache-Control: no-store for /api/ical.", errors);

for (const file of [
  "api/ha/[...slug].js",
  "api/stats.js",
  "api/ical.js",
  "server/cleaning/_calendar.js",
  "server/cleaning/_dispatch.js",
  "server/cleaning/_notify.js",
  "server/cleaning/_push.js",
  "server/cleaning/_sms.js",
  "server/haProxy.js",
  "server/haApiHandlers.js",
  "server/icalProxy.js",
  "server/icalApiHandlers.js",
]) {
  assert(repoFileExists(file), `[verify:deploy] Missing deployment file: ${file}`, errors);
}

const apiFunctionFiles = listFiles(path.join(repoRoot, "api"))
  .filter((file) => /\.(?:js|mjs|cjs|ts)$/.test(file));
assert(
  apiFunctionFiles.length <= 12,
  `[verify:deploy] Vercel Hobby allows at most 12 functions; found ${apiFunctionFiles.length}.`,
  errors,
);

for (const envKey of ["PROPOS_HA_BASE_URL", "PROPOS_HA_WS_URL", "PROPOS_HA_TOKEN"]) {
  assert(privateConfigSource.includes(envKey), `[verify:deploy] privateConfig.js must reference ${envKey}.`, errors);
  assert(readmeSource.includes(envKey), `[verify:deploy] README.md must document ${envKey}.`, errors);
  assert(envExampleSource.includes(envKey), `[verify:deploy] .env.vercel.example must include ${envKey}.`, errors);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log("[verify:deploy] Vercel routing, HA proxy files, and env variable docs are in place.");
