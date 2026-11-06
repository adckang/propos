import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import eruda from "vite-plugin-eruda";
import {
  getDemoCleaningStats,
  getDemoPropertyConfigs,
} from "./src/application/demoReportingService.js";
import { DATA_PROFILE, resolveBuildDataProfile } from "./src/config/dataProfile.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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

// Only explicit DEMO reports execute locally. Service data and all physical
// device operations always pass through the production API below.
async function handleDemoReportApi(req, res) {
  const raw = req.url || '';
  if (!(raw === '/api/stats' || raw.startsWith('/api/stats?') || raw.startsWith('/api/stats/'))) return false;
  try {
    req.query = queryFromUrl(raw);
    const { default: handler } = await import('./api/stats.js');
    await handler(req, vercelResponse(res));
  } catch (error) { sendJson(res, 500, { error: error.message }); }
  return true;
}

function apiProxyPlugin(dataProfile) {
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
      if (await handleDemoReportApi(req, res)) return;
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
      next();
    });
  };

  return {
    name: "api-proxy-middleware",
    configureServer(server) {
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const dataProfile = resolveBuildDataProfile(mode, env);
  // The fixture API shares the production report handler, whose runtime
  // profile must also be DEMO when the build profile came from an env file.
  if (dataProfile === DATA_PROFILE.DEMO) process.env.PROPOS_DATA_PROFILE = DATA_PROFILE.DEMO;
  // Localhost is a UI entry point into the same service, not another backend.
  // Tokens, DB connections and watcher routing are read only by production.
  const proxy = dataProfile === DATA_PROFILE.DEMO ? undefined : {
    '/api': { target: 'https://www.proposonline.com', changeOrigin: true, cookieDomainRewrite: '' },
  };

  return {
    plugins: [react(), ...(dataProfile === DATA_PROFILE.DEMO ? [apiProxyPlugin(dataProfile)] : []), ...(mode === 'development' ? [eruda()] : [])],
    define: {
      'import.meta.env.VITE_PROPOS_DATA_PROFILE': JSON.stringify(dataProfile),
    },
    // host:true → 0.0.0.0 바인딩 (VSCode 터널/네트워크 접속 허용)
    // strictPort → 포트 점유 시 다른 포트로 튀지 않음
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      proxy,
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
