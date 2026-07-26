import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleNodeHaRequest } from "./server/haApiHandlers.js";
import { handleNodeIcalRequest } from "./server/icalApiHandlers.js";
import { startWatcher, getMonitoringState, setMonitoringConfig, setRoomState } from "./server/occupancyWatcher.js";
import { getHaBaseUrl, getHaToken } from "./server/haProxy.js";

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

function apiProxyPlugin() {
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

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  // ── dev/preview 서버: 0.0.0.0 바인딩 + 고정 포트 ──
  // host:true → localhost 외 네트워크/VSCode 터널 포워딩으로도 접속 가능
  // strictPort → 포트 점유 시 다른 포트로 튀지 않고 실패(포워딩 포트 고정)
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
});
