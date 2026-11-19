import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import eruda from "vite-plugin-eruda";
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

// Only explicit DEMO answers execute locally, and they come from the API handlers' own DEMO branches —
// a second copy here drifted from production once (RF-37). Service data and all physical device
// operations always pass through the production API below.
async function runDemoApiHandler(req, res, modulePath) {
  try {
    req.query = queryFromUrl(req.url || '');
    const { default: handler } = await import(modulePath);
    await handler(req, vercelResponse(res));
  } catch (error) { sendJson(res, 500, { error: error.message }); }
}

async function handleDemoReportApi(req, res) {
  const raw = req.url || '';
  if (!(raw === '/api/stats' || raw.startsWith('/api/stats?') || raw.startsWith('/api/stats/'))) return false;
  await runDemoApiHandler(req, res, './api/stats.js');
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
      // 청소 API(통계·숙소·그 밖은 403)와 숙소 메타데이터 API의 데모 응답은 실제 핸들러의 데모 분기가 만든다
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/cleaning/")) {
        await runDemoApiHandler(req, res, "./api/cleaning/[...slug].js");
        return;
      }
      if (dataProfile === DATA_PROFILE.DEMO && req.url?.startsWith("/api/properties") && req.method === "GET") {
        await runDemoApiHandler(req, res, "./api/properties.js");
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
