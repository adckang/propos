import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleNodeHaRequest } from "./server/haApiHandlers.js";
import { handleNodeIcalRequest } from "./server/icalApiHandlers.js";
import { startWatcher, getMonitoringState, setMonitoringConfig, setRoomState } from "./server/occupancyWatcher.js";
import { getHaBaseUrl, getHaToken } from "./server/haProxy.js";
import { fetchWeather } from "./server/weatherService.js";

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

function apiProxyPlugin(env) {
  const attachMiddleware = server => {
    server.middlewares.use(async (req, res, next) => {
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
      startWatcher();
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      startWatcher();
      attachMiddleware(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  // 접두사 '' → VITE_ 제한 없이 .env.local 전체 로드 (PROPOS_* 포함)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), apiProxyPlugin(env)],
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
