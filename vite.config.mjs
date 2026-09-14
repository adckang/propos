import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import eruda from "vite-plugin-eruda";
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
      // dev 전용 /api/stats/drilldown 스텁
      if (req.url?.startsWith("/api/stats/drilldown") && req.method === "GET") {
        const url    = new URL(req.url, "http://localhost");
        const metric = url.searchParams.get("metric") ?? "";
        const period = url.searchParams.get("period") ?? "";
        const DEMO_ITEMS = {
          cleaning_time:          [
            { property_id: "room-101", occurred_at: new Date("2026-09-08T14:30:00Z"), detail: { duration_hours: 3.8, started_at: new Date("2026-09-08T10:40:00Z"), finished_at: new Date("2026-09-08T14:30:00Z") } },
            { property_id: "room-305", occurred_at: new Date("2026-09-07T18:10:00Z"), detail: { duration_hours: 4.2, started_at: new Date("2026-09-07T14:00:00Z"), finished_at: new Date("2026-09-07T18:10:00Z") } },
          ],
          post_checkout_energy:   [
            { property_id: "room-203", occurred_at: new Date("2026-09-08T11:00:00Z"), detail: {} },
            { property_id: "room-102", occurred_at: new Date("2026-09-06T09:30:00Z"), detail: {} },
          ],
          post_checkout_security: [
            { property_id: "room-401", occurred_at: new Date("2026-09-09T16:00:00Z"), detail: {} },
          ],
          vacant_energy:          [
            { property_id: "room-202", occurred_at: new Date("2026-09-07T20:00:00Z"), detail: {} },
            { property_id: "room-303", occurred_at: new Date("2026-09-08T08:00:00Z"), detail: {} },
            { property_id: "room-104", occurred_at: new Date("2026-09-09T12:00:00Z"), detail: {} },
          ],
          post_cleaning_security: [
            { property_id: "room-205", occurred_at: new Date("2026-09-08T15:00:00Z"), detail: {} },
          ],
          pre_stay_optimization:  [],
        };
        const items = DEMO_ITEMS[metric] ?? [];
        sendJson(res, 200, { metric, period, failCount: items.length, items });
        return;
      }
      // dev 전용 /api/stats 스텁 — 실제 DB 없이 레포트 UI 확인용
      if (req.url?.startsWith("/api/stats") && req.method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const period = url.searchParams.get("period") ?? "now";
        const NOW_STATS = { occupied: 7, preStayReady: 0, vacant: 10, cleaning: 3, anomalyCount: 2, total: 20 };
        const PAST_STATS = {
          checkIns: 14, checkOuts: 12, anomalies: 3, energyWaste: 1,
          noShowSuspected: 1, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0,
          vacantEnergyWaste: 3, vacantEnergyResolved: 3,
          preStayAttempts: 12, preStayOptimized: 11,
          cleaningFinished: 12, cleaningOnTime: 10,
          cleaningAssigned: 12, cleaningCreated: 12,
          postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1, postCleaningSecurityBreach: 1,
        };
        const FUTURE_STATS = { checkIns: 8, checkOuts: 6, anomalies: 0, energyWaste: 0, noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0 };
        const PERIOD_SUMMARY = {
          now: "현재 2개 숙소 이상 징후가 확인됐어요. 바로 확인이 필요해요.",
          today: "현재 2개 숙소 이상 징후가 확인됐어요. 바로 확인이 필요해요.",
          this_week: "이번 주 이상감지 3건이 있어요.",
          last_week: "지난주 체크인 14건 완료, 이상감지 3건이 있었어요.",
          yesterday: "어제 체크인 2건, 이상감지 1건이 있었어요.",
          last_hour: "지난 1시간 이벤트 3건이 있었어요.",
          this_month: "이번 달 이상감지 3건이 있어요.",
          last_month: "지난달 체크인 14건 완료, 이상감지 3건이 있었어요.",
          next_week: "다음 주 체크인 8건 예정이에요.",
          tomorrow: "내일 체크인 8건 예정이에요.",
          next_hour: "1시간 내 체크인 1건 예정이에요.",
        };
        // now/today → KV 기반 live state (NOW_STATS). 나머지 ACTIVE/PAST/FUTURE → event format.
        const isLive = ["now", "today"].includes(period);
        const isFuture = ["next_week", "next_month", "tomorrow", "next_hour"].includes(period);
        const stats = isLive ? NOW_STATS : isFuture ? FUTURE_STATS : PAST_STATS;
        sendJson(res, 200, { period, stats, summary: PERIOD_SUMMARY[period] ?? "" });
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
    plugins: [react(), apiProxyPlugin(env), ...(mode === 'development' ? [eruda()] : [])],
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
