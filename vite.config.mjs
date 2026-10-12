import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import eruda from "vite-plugin-eruda";
import { handleNodeHaRequest } from "./server/haApiHandlers.js";
import { handleNodeIcalRequest } from "./server/icalApiHandlers.js";
import { startWatcher, getMonitoringState, setMonitoringConfig, setRoomState } from "./server/occupancyWatcher.js";
import { getHaBaseUrl, getHaToken } from "./server/haProxy.js";
import { fetchWeather } from "./server/weatherService.js";
import {
  getDemoCleaningStats,
  getDemoDrilldown,
  getDemoMonthlyCalendar,
  getDemoPropertyConfigs,
  getDemoStats,
} from "./src/application/demoReportingService.js";
import { DATA_PROFILE, resolveBuildDataProfile } from "./src/config/dataProfile.js";
import { describePeriod, parseOffsetPeriod } from "./src/domain/periodDomain.js";

const DEMO_STATS_PERIODS = new Set([
  "now", "yesterday", "today", "tomorrow", "last_hour", "next_hour",
  "this_week", "last_week", "next_week", "this_month", "last_month", "next_month",
]);
const DEMO_CALENDAR_PERIODS = new Set(["last_month", "this_month", "next_month"]);
const DEMO_DRILLDOWN_METRICS = new Set([
  "cleaning_time", "post_checkout_energy", "post_checkout_security",
  "vacant_energy", "post_cleaning_security", "pre_stay_optimization",
]);

function isDemoDrilldownPeriod(period) {
  if (["yesterday", "last_hour", "this_week", "last_week", "this_month", "last_month"].includes(period)) return true;
  const descriptor = describePeriod(period);
  return Boolean(descriptor && descriptor.tense === "past" && (descriptor.unit === "week" || descriptor.unit === "day"));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

function queryFromUrl(rawUrl = '') {
  const url = new URL(rawUrl, 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

function vercelResponse(res) {
  res.status = status => { res.statusCode = status; return res; };
  res.json = body => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  res.send = body => res.end(typeof body === 'string' ? body : JSON.stringify(body));
  res.redirect = (status, location) => { res.statusCode = status; res.setHeader('Location', location); res.end(); };
  return res;
}

async function handleLocalDatabaseApi(req, res) {
  const originalUrl = req.url || '';
  const isStats = originalUrl === '/api/stats' || originalUrl.startsWith('/api/stats?') || originalUrl.startsWith('/api/stats/');
  const isCleaning = originalUrl.startsWith('/api/cleaning/');
  const isWatcherProperties = originalUrl === '/api/properties' || originalUrl.startsWith('/api/properties?');
  if (!isStats && !isCleaning && !isWatcherProperties) return false;

  try {
    const query = queryFromUrl(originalUrl);
    req.query = query;
    const response = vercelResponse(res);
    if (isStats) {
      const { default: handler } = await import('./api/stats.js');
      await handler(req, response);
      return true;
    }
    if (isWatcherProperties) {
      const { default: handler } = await import('./api/properties.js');
      await handler(req, response);
      return true;
    }
    const { default: handler } = await import('./api/cleaning/[...slug].js');
    await handler(req, response);
    return true;
  } catch (error) {
    console.error('[vite/local-db-api]', error);
    sendJson(res, 500, { error: error.message });
    return true;
  }
}

async function handleCameraSnapshot(req, res) {
  const imgPath = new URL(req.url, "http://localhost").searchParams.get("path") ?? "";
  if (!imgPath.startsWith("/local/snapshots/") || imgPath.includes("..")) {
    res.statusCode = 400; res.end(); return;
  }
  try {
    const imgRes = await fetch(`${getHaBaseUrl()}${imgPath}`, {
      headers: { Authorization: `Bearer ${getHaToken()}` },
    });
    if (!imgRes.ok) { res.statusCode = 404; res.end(); return; }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(buf);
  } catch { res.statusCode = 502; res.end(); }
}

function apiProxyPlugin(env, dataProfile) {
  const attachMiddleware = server => {
    server.middlewares.use(async (req, res, next) => {
      const demoBlocksExternalSideEffect = dataProfile === DATA_PROFILE.DEMO && (
        req.url?.startsWith("/api/ha/") ||
        req.url?.startsWith("/api/ical") ||
        req.url?.startsWith("/api/camera/snapshot") ||
        req.url?.startsWith("/api/monitoring/") ||
        (req.url?.startsWith("/api/properties") && req.method !== "GET") ||
        (req.url?.startsWith("/api/cleaning/") && req.method !== "GET")
      );
      if (demoBlocksExternalSideEffect) {
        sendJson(res, 403, { error: "demo profile is read-only", dataProfile: "demo" });
        return;
      }
      if (req.url?.startsWith("/api/ha/")) {
        handleNodeHaRequest(req, res);
        return;
      }
      if (req.url?.startsWith("/api/ical")) {
        handleNodeIcalRequest(req, res);
        return;
      }
      if (req.url === "/api/monitoring/state" && req.method === "GET") {
        sendJson(res, 200, getMonitoringState());
        return;
      }
      if (req.url === "/api/monitoring/config" && req.method === "POST") {
        setMonitoringConfig(await readBody(req));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.url === "/api/monitoring/state" && req.method === "PUT") {
        const body = await readBody(req);
        if (body.roomState) setRoomState(body.roomState);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.url?.startsWith("/api/camera/snapshot") && req.method === "GET") {
        await handleCameraSnapshot(req, res);
        return;
      }
      if (dataProfile !== DATA_PROFILE.DEMO && await handleLocalDatabaseApi(req, res)) {
        return;
      }
      // demo 프로필의 공통 레포트 서비스 — Vite와 demo 배포가 같은 응답을 사용한다.
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/stats/calendar") && req.method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const period = url.searchParams.get("period") ?? "this_month";
        if (!DEMO_CALENDAR_PERIODS.has(period)) {
          sendJson(res, 400, { error: `invalid period: ${period}` });
          return;
        }
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        sendJson(res, 200, getDemoMonthlyCalendar(period, { propertyIds: selectedIds }));
        return;
      }
      // demo 프로필 드릴다운도 같은 공통 서비스에서 생성한다.
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/stats/drilldown") && req.method === "GET") {
        const url    = new URL(req.url, "http://localhost");
        const metric = url.searchParams.get("metric") ?? "";
        const period = url.searchParams.get("period") ?? "";
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        if (!period) { sendJson(res, 400, { error: "period is required" }); return; }
        if (!metric) { sendJson(res, 400, { error: "metric is required" }); return; }
        if (!isDemoDrilldownPeriod(period)) { sendJson(res, 400, { error: `invalid period: ${period}` }); return; }
        if (!DEMO_DRILLDOWN_METRICS.has(metric)) { sendJson(res, 400, { error: `invalid metric: ${metric}` }); return; }
        sendJson(res, 200, getDemoDrilldown(metric, period, { propertyIds: selectedIds }));
        return;
      }
      // demo 프로필 통계 — production API와 동일한 응답 계약.
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/stats") && req.method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const period = url.searchParams.get("period") ?? "now";
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        if (!DEMO_STATS_PERIODS.has(period) && !parseOffsetPeriod(period)) {
          sendJson(res, 400, { error: `invalid period: ${period}` });
          return;
        }
        sendJson(res, 200, getDemoStats(period, { propertyIds: selectedIds }));
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/cleaning/stats") && req.method === "GET") {
        const csUrl      = new URL(req.url, "http://localhost");
        const withItems  = csUrl.searchParams.get("items") === "true";
        const rawIds     = csUrl.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        const period = csUrl.searchParams.get("period") ?? "next_week";
        try {
          sendJson(res, 200, getDemoCleaningStats(period, { propertyIds: selectedIds, withItems }));
        } catch (error) {
          sendJson(res, 400, { error: error.message, dataProfile: "demo" });
        }
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/cleaning/properties") && req.method === "GET") {
        sendJson(res, 200, getDemoPropertyConfigs());
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/cleaning/")) {
        sendJson(res, 403, { error: "demo profile is read-only", dataProfile: "demo" });
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/properties") && req.method === "GET") {
        sendJson(res, 200, getDemoPropertyConfigs().map(property => ({
          id: property.property_id,
          name: property.name,
          checkOutHour: property.checkout_hour,
          cleaningDurationHours: property.cleaning_duration_hours,
          dataOrigin: "DEMO",
        })));
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/config") && req.method === "GET") {
        sendJson(res, 200, { dataProfile: "demo" });
        return;
      }
      if (req.url?.startsWith("/api/weather") && req.method === "GET") {
        const district = new URL(req.url, "http://localhost").searchParams.get("district") ?? "";
        if (!district) { sendJson(res, 400, { error: "district required" }); return; }
        try {
          const result = await fetchWeather(district, env.PROPOS_KMA_API_KEY ?? null);
          if (result.error) { sendJson(res, result.status ?? 500, { error: result.error }); return; }
          sendJson(res, 200, result.data);
        } catch (err) {
          sendJson(res, 502, { error: err.message });
        }
        return;
      }
      next();
    });
  };

  return {
    name: "api-proxy-middleware",
    configureServer(server) {
      if (dataProfile !== DATA_PROFILE.DEMO) startWatcher();
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      if (dataProfile !== DATA_PROFILE.DEMO) startWatcher();
      attachMiddleware(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  // 접두사 '' → VITE_ 제한 없이 .env.local 전체 로드 (PROPOS_* 포함)
  const env = loadEnv(mode, process.cwd(), '');
  // Vite의 loadEnv 결과는 import.meta.env에만 주입된다. 로컬에서 Vercel API
  // 핸들러를 직접 호출할 때도 동일한 DB/Google 설정을 사용하도록 서버 런타임
  // 환경에 없는 값만 보완한다(이미 주입된 셸/배포 환경변수는 우선 유지).
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env) && (
      key === 'POSTGRES_URL' ||
      key.startsWith('PROPOS_') ||
      key.startsWith('GOOGLE_') ||
      key.startsWith('FIREBASE_') ||
      key.startsWith('KV_')
    )) {
      process.env[key] = value;
    }
  }
  const dataProfile = resolveBuildDataProfile(mode, env);

  return {
    plugins: [react(), apiProxyPlugin(env, dataProfile), ...(mode === 'development' ? [eruda()] : [])],
    define: {
      'import.meta.env.VITE_PROPOS_DATA_PROFILE': JSON.stringify(dataProfile),
    },
    // host:true → 0.0.0.0 바인딩 (VSCode 터널/네트워크 접속 허용)
    // strictPort → 포트 점유 시 다른 포트로 튀지 않음
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      commonjsOptions: {
        include: [
          /node_modules/,
          /src\/application\//,
          /src\/domain\//,
          /src\/infrastructure\//,
          /src\/config\//,
        ],
      },
    },
  };
});
