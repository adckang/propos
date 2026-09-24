import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import eruda from "vite-plugin-eruda";
import { handleNodeHaRequest } from "./server/haApiHandlers.js";
import { handleNodeIcalRequest } from "./server/icalApiHandlers.js";
import { startWatcher, getMonitoringState, setMonitoringConfig, setRoomState } from "./server/occupancyWatcher.js";
import { getHaBaseUrl, getHaToken } from "./server/haProxy.js";
import { fetchWeather } from "./server/weatherService.js";
import { PROPERTIES as MOCK_PROPERTIES } from "./src/data/roomStateMockData.js";
import { countCurrentStats } from "./src/domain/reportingDomain.js";
import { describePeriod, periodToRemainingRange } from "./src/domain/periodDomain.js";

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

// dev 스텁 공통 — 선택 숙소별로 값을 결정적으로 분배해 부분집합 합 == 개별 합이 되게 한다.
// (선택 수 비례 반올림은 소수 선택에서 0으로 붕괴하고 합산되지 않아 UI 검증을 오도함)
// 합계 n을 N개 숙소에 나눌 때 Σ floor((n + k) / N), k=0..N-1 == n 이므로 전체 선택 = 기존 총합.
function makeStubScope(selectedIds) {
  const N = MOCK_PROPERTIES.length;
  const rooms = MOCK_PROPERTIES
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !selectedIds || selectedIds.includes(p.id));
  const keyOffset = (key) => [...String(key)].reduce((a, c) => a + c.charCodeAt(0), 0) % N;
  const share = (n, idx, off) => Math.floor((n + (N - 1 - ((idx + off) % N))) / N);
  const sc = (n, off = 0) => rooms.reduce((sum, { idx }) => sum + share(n, idx, off), 0);
  const scaleAll = (base) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, sc(v, keyOffset(k))]));
  const holders = (n, off = 0) => rooms.filter(({ idx }) => share(n, idx, off) > 0).map(({ p }) => p);
  return { rooms, sc, scaleAll, holders, keyOffset };
}

// 월간 화면 공통 목업 문제 원본. 숙소 소유자는 고정하고 선택 시 필터만 한다.
// 레포트 요약·달력·월간 지표 상세가 모두 이 목록을 사용한다.
const MONTHLY_DEMO_ISSUE_TEMPLATES = [
  { propertyIndex: 0,  day: 3,  hour: 11, category: "OCCUPIED",       type: "complaint_detected",                    label: "민원 발생" },
  { propertyIndex: 2,  day: 7,  hour: 15, category: "CLEANING",       type: "cleaning_time_exceeded",                label: "청소 시간 3시간 초과" },
  { propertyIndex: 6,  day: 7,  hour: 18, category: "VACANT",         type: "vacant_energy_waste_detected",          label: "공실 중 에너지 낭비" },
  { propertyIndex: 11, day: 12, hour: 9,  category: "PRE_STAY_READY", type: "pre_stay_optimization_failed",           label: "입실전 숙소 최적화 미완료" },
  { propertyIndex: 17, day: 18, hour: 22, category: "OCCUPIED",       type: "energy_waste_detected",                 label: "체류 중 에너지 낭비" },
  { propertyIndex: 4,  day: 20, hour: 12, category: "CLEANING",       type: "post_checkout_energy_waste_detected",   label: "퇴실 후 청소 전 에너지 낭비" },
  { propertyIndex: 5,  day: 20, hour: 13, category: "CLEANING",       type: "post_checkout_security_breach_detected",label: "퇴실 후 청소 전 보안 문제" },
  { propertyIndex: 7,  day: 24, hour: 16, category: "VACANT",         type: "post_cleaning_security_breach_detected",label: "청소 후 공실 보안 문제" },
  { propertyIndex: 8,  day: 26, hour: 11, category: "CLEANING",       type: "cleaning_assignment_issue",             label: "청소 미배정" },
];

function demoMonthRange(period) {
  const now = new Date();
  const offset = period === "last_month" ? -1 : period === "next_month" ? 1 : 0;
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { from, to };
}

function monthlyDemoIssues(period, selectedIds = null) {
  if (period === "next_month") return [];
  const { from } = demoMonthRange(period);
  return MONTHLY_DEMO_ISSUE_TEMPLATES
    .map(template => {
      const property = MOCK_PROPERTIES[template.propertyIndex];
      return {
        property_id: property.id,
        occurred_at: new Date(from.getFullYear(), from.getMonth(), template.day, template.hour).toISOString(),
        category: template.category,
        type: template.type,
        label: template.label,
        resolved_at: null,
        detail: {},
      };
    })
    .filter(item => !selectedIds || selectedIds.includes(item.property_id));
}

function alignMonthlyStatsWithIssues(stats, issues) {
  const count = type => issues.filter(item => item.type === type).length;
  const anomalies = count("complaint_detected") + count("energy_waste_detected");
  const preStayFailures = count("pre_stay_optimization_failed");
  const cleaningTimeFailures = count("cleaning_time_exceeded");
  const assignmentFailures = count("cleaning_assignment_issue");
  const preStayAttempts = Math.max(stats.preStayAttempts ?? 0, preStayFailures);
  const cleaningFinished = Math.max(stats.cleaningFinished ?? 0, cleaningTimeFailures);
  const cleaningCreated = Math.max(stats.cleaningCreated ?? 0, assignmentFailures);
  return {
    ...stats,
    anomalies,
    energyWaste: count("energy_waste_detected"),
    noShowSuspected: count("no_show_suspected"),
    earlyCheckinSuspected: count("early_checkin_suspected"),
    checkoutConfirmationNeeded: count("checkout_confirmation_needed"),
    vacantEnergyWaste: count("vacant_energy_waste_detected"),
    postCheckoutEnergyWaste: count("post_checkout_energy_waste_detected"),
    postCheckoutSecurityBreach: count("post_checkout_security_breach_detected"),
    postCleaningSecurityBreach: count("post_cleaning_security_breach_detected"),
    preStayAttempts,
    preStayOptimized: Math.max(0, preStayAttempts - preStayFailures),
    cleaningFinished,
    cleaningOnTime: Math.max(0, cleaningFinished - cleaningTimeFailures),
    cleaningCreated,
    cleaningAssigned: Math.max(0, cleaningCreated - assignmentFailures),
  };
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
      // dev 전용 월간 캘린더 스텁 — 실제 DB 없이 날짜별 문제 UI 확인용
      if (req.url?.startsWith("/api/stats/calendar") && req.method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const period = url.searchParams.get("period") ?? "this_month";
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        const { from: monthStart, to: monthEnd } = demoMonthRange(period);
        const items = monthlyDemoIssues(period, selectedIds);
        const days = {};
        for (const item of items) {
          const d = new Date(item.occurred_at);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if (!days[key]) days[key] = { total: 0, categories: {}, items: [] };
          days[key].total += 1;
          days[key].categories[item.category] = (days[key].categories[item.category] ?? 0) + 1;
          days[key].items.push(item);
        }
        sendJson(res, 200, {
          period,
          range: { from: monthStart.toISOString(), to: new Date(monthEnd.getTime() - 1).toISOString() },
          days,
          items,
          stateSegments: [],
        });
        return;
      }
      // dev 전용 /api/stats/drilldown 스텁
      if (req.url?.startsWith("/api/stats/drilldown") && req.method === "GET") {
        const url    = new URL(req.url, "http://localhost");
        const metric = url.searchParams.get("metric") ?? "";
        const period = url.searchParams.get("period") ?? "";
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        // 샘플 ID 는 목업 숙소 ID(P012=개포 L호 …) — 화면이 리스트와 같은 숙소 이름으로 바꿔 보여주는지 dev 에서 확인할 수 있도록
        // 목록 줄마다 "얼마나 심했는지"가 보이는지 dev 에서 확인하도록 심각도가 섞이게 구성 (실제 서버 응답과 같은 detail 키)
        const DEMO_ITEMS = {
          cleaning_time:          [
            { property_id: "P012", occurred_at: new Date("2026-09-08T14:30:00Z"), detail: { duration_hours: 3.8, started_at: new Date("2026-09-08T10:42:00Z"), finished_at: new Date("2026-09-08T14:30:00Z"), limit_hours: 3 } },
            { property_id: "P013", occurred_at: new Date("2026-09-07T18:10:00Z"), detail: { duration_hours: 4.2, started_at: new Date("2026-09-07T13:58:00Z"), finished_at: new Date("2026-09-07T18:10:00Z"), limit_hours: 3 } },
            { property_id: "P014", occurred_at: new Date("2026-09-09T09:06:00Z"), detail: { duration_hours: 3.1, started_at: new Date("2026-09-09T06:00:00Z"), finished_at: new Date("2026-09-09T09:06:00Z"), limit_hours: 3 } },
            { property_id: "P009", occurred_at: new Date("2026-09-06T17:30:00Z"), detail: { duration_hours: 5.5, started_at: new Date("2026-09-06T12:00:00Z"), finished_at: new Date("2026-09-06T17:30:00Z"), limit_hours: 3 } },
          ],
          post_checkout_energy:   [
            { property_id: "P014", occurred_at: new Date("2026-09-08T11:12:00Z"), detail: { anchor_at: "2026-09-08T11:00:00.000Z" } },
            { property_id: "P008", occurred_at: new Date("2026-09-06T09:30:00Z"), detail: { anchor_at: "2026-09-06T08:50:00.000Z", reason: "거실 에어컨·조명 켜짐" } },
          ],
          post_checkout_security: [
            { property_id: "P009", occurred_at: new Date("2026-09-09T16:00:00Z"), detail: { anchor_at: "2026-09-09T15:20:00.000Z" } },
          ],
          vacant_energy:          [
            { property_id: "P010", occurred_at: new Date("2026-09-07T20:00:00Z"), detail: { resolved_at: "2026-09-07T23:20:00.000Z" } },
            { property_id: "P011", occurred_at: new Date("2026-09-08T08:00:00Z"), detail: { resolved_at: "2026-09-08T09:30:00.000Z" } },
            { property_id: "P015", occurred_at: new Date("2026-09-09T12:00:00Z"), detail: { resolved_at: "2026-09-09T12:25:00.000Z" } },
            { property_id: "P016", occurred_at: new Date("2026-09-09T02:00:00Z"), detail: {} },
          ],
          post_cleaning_security: [
            { property_id: "P016", occurred_at: new Date("2026-09-08T15:00:00Z"), detail: { anchor_at: "2026-09-08T14:10:00.000Z" } },
          ],
          pre_stay_optimization:  [],
        };
        const MONTHLY_METRIC_TYPES = {
          cleaning_time:          "cleaning_time_exceeded",
          post_checkout_energy:   "post_checkout_energy_waste_detected",
          post_checkout_security: "post_checkout_security_breach_detected",
          vacant_energy:          "vacant_energy_waste_detected",
          post_cleaning_security: "post_cleaning_security_breach_detected",
          pre_stay_optimization:  "pre_stay_optimization_failed",
        };
        const isMonthly = ["last_month", "this_month"].includes(period);
        const items = isMonthly
          ? monthlyDemoIssues(period, selectedIds).filter(item => item.type === MONTHLY_METRIC_TYPES[metric])
          : (DEMO_ITEMS[metric] ?? []).filter(item => !selectedIds || selectedIds.includes(item.property_id));
        sendJson(res, 200, { metric, period, failCount: items.length, items });
        return;
      }
      // dev 전용 /api/stats 스텁 — 실제 DB 없이 레포트 UI 확인용
      if (req.url?.startsWith("/api/stats") && req.method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const period = url.searchParams.get("period") ?? "now";

        // property_ids 파싱 — 선택 숙소 필터. 숙소별 결정적 분배라 부분집합 합 == 개별 합
        const rawIds = url.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        const { rooms, sc, scaleAll } = makeStubScope(selectedIds);

        // now/today: 목업 숙소의 실제 currentState 에서 계산 → 리스트 칩(체류중/청소중/입실전/공실)과 항상 일치
        const NOW_STATS = countCurrentStats(rooms.map(({ p }) => p.currentState));

        const PAST_STATS = scaleAll({
          checkIns: 14, checkOuts: 12, anomalies: 3, energyWaste: 1,
          noShowSuspected: 1, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0,
          vacantEnergyWaste: 3, vacantEnergyResolved: 3,
          preStayAttempts: 12, preStayOptimized: 11,
          cleaningFinished: 12, cleaningOnTime: 10,
          cleaningAssigned: 12, cleaningCreated: 12,
          postCheckoutEnergyWaste: 2, postCheckoutSecurityBreach: 1, postCleaningSecurityBreach: 1,
        });

        const FUTURE_STATS = scaleAll({
          checkIns: 8, checkOuts: 6, anomalies: 0, energyWaste: 0,
          noShowSuspected: 0, earlyCheckinSuspected: 0, checkoutConfirmationNeeded: 0,
        });

        // ACTIVE_STATS: this_week / this_month — 과거 지표 + 남은 체크인(checkIns = 미래분)
        const ACTIVE_STATS = scaleAll({
          checkOuts: 6, preStayAttempts: 8, preStayOptimized: 7,
          cleaningFinished: 6, cleaningOnTime: 5,
          cleaningAssigned: 5, cleaningCreated: 6,
          vacantEnergyWaste: 1, postCheckoutEnergyWaste: 1,
          postCheckoutSecurityBreach: 0, postCleaningSecurityBreach: 0,
          checkIns: 5,  // 이번 주 남은 체크인 예정 수 (FutureMatrixPanel용)
        });

        const selLabel = selectedIds ? `${selectedIds.length}개 숙소` : "전체 숙소";
        const PERIOD_SUMMARY = {
          now:       `현재 ${selLabel} 중 ${NOW_STATS.anomalyCount}개 이상 징후가 확인됐어요.`,
          today:     `현재 ${selLabel} 중 ${NOW_STATS.anomalyCount}개 이상 징후가 확인됐어요.`,
          this_week: `이번 주 ${selLabel} 이상감지 ${sc(3)}건이 있어요.`,
          last_week: `지난주 ${selLabel} 체크인 ${sc(14)}건 완료, 이상감지 ${sc(3)}건이 있었어요.`,
          yesterday: `어제 ${selLabel} 체크인 ${sc(2)}건, 이상감지 ${sc(1)}건이 있었어요.`,
          last_hour: `지난 1시간 ${selLabel} 이벤트 ${sc(3)}건이 있었어요.`,
          this_month:`이번 달 ${selLabel} 이상감지 ${sc(3)}건이 있어요.`,
          last_month:`지난달 ${selLabel} 체크인 ${sc(14)}건 완료, 이상감지 ${sc(3)}건이 있었어요.`,
          next_week: `다음 주 ${selLabel} 체크인 ${sc(8)}건 예정이에요.`,
          tomorrow:  `내일 ${selLabel} 체크인 ${sc(8)}건 예정이에요.`,
          next_hour: `1시간 내 ${selLabel} 체크인 ${sc(1)}건 예정이에요.`,
        };

        // now/today → 현재 상태 집계 (NOW_STATS). 나머지는 기간 시제(과거/진행/미래)로 고른다.
        // 몇 주·며칠 뒤/전(weeks_ahead_2 등)도 같은 규칙 — 스텁은 기간별로 값을 바꾸지 않는다.
        const desc     = describePeriod(period);
        const isLive   = ["now", "today"].includes(period);
        const isActive = desc?.tense === "active" && !isLive;
        const isFuture = desc?.tense === "future";
        const baseStats = isLive ? NOW_STATS : isActive ? ACTIVE_STATS : isFuture ? FUTURE_STATS : PAST_STATS;
        const monthIssues = desc?.unit === "month" ? monthlyDemoIssues(period, selectedIds) : [];
        const stats = desc?.unit === "month" && !isFuture
          ? alignMonthlyStatsWithIssues(baseStats, monthIssues)
          : baseStats;
        let summary = PERIOD_SUMMARY[period];
        if (desc?.unit === "month" && !isFuture) {
          summary = monthIssues.length > 0
            ? `${desc.label} ${selLabel} 운영 문제 ${monthIssues.length}건이 있었어요.`
            : `${desc.label} ${selLabel} 운영 문제가 없었어요.`;
        }
        if (summary === undefined && desc) {
          summary = isFuture
            ? `${desc.label} ${selLabel} 체크인 ${stats.checkIns}건 예정이에요.`
            : `${desc.label} ${selLabel} 체크인 ${stats.checkIns}건 완료, 이상감지 ${stats.anomalies}건이 있었어요.`;
        }
        sendJson(res, 200, { period, stats, summary: summary ?? "" });
        return;
      }
      if (req.url?.startsWith("/api/cleaning/stats") && req.method === "GET") {
        // dev 전용 스텁 — 청소 배정 4분류 (실제 DB 없이 레포트 UI 확인용)
        // 목업 숙소별로 분배 → 선택 숙소 합 == 개별 합, 드릴다운 목록 개수 == 표시 건수
        const csUrl      = new URL(req.url, "http://localhost");
        const withItems  = csUrl.searchParams.get("items") === "true";
        const rawIds     = csUrl.searchParams.get("property_ids") ?? "";
        const selectedIds = rawIds ? rawIds.split(",").map(s => s.trim()).filter(Boolean) : null;
        const { sc, holders } = makeStubScope(selectedIds);
        const OFF = { assigned: 2, requesting: 3, failed: 5, needsRequest: 11 }; // 항목마다 다른 숙소가 걸리도록
        const assigned = sc(4, OFF.assigned), requesting = sc(2, OFF.requesting), failed = sc(1, OFF.failed);
        // 실제 API와 동일: total = 취소 제외 잡 수 = 배정완료 + 요청중 + 실패, needsRequest는 CANCELLED 별도
        const base = { total: assigned + requesting + failed, assigned, requesting, failed, needsRequest: sc(1, OFF.needsRequest) };
        base.unassigned = base.total - base.assigned;
        if (!withItems) { sendJson(res, 200, base); return; }
        const period = csUrl.searchParams.get("period") ?? "next_week";
        const scheduleRange = periodToRemainingRange(period);
        const spanDays = Math.max(1, Math.floor((scheduleRange.to - scheduleRange.from) / 86_400_000));
        const toItem = (p, status, slot) => ({
          property_id: p.id,
          property_name: p.name,
          status,
          checkout_at: new Date(scheduleRange.from.getTime() + (slot % spanDays) * 86_400_000 + 12 * 3_600_000).toISOString(),
          // 실제 서버와 같은 보조 값 — 배정 실패: 요청/거절 인원, 취소: 취소된 시각
          updated_at: new Date(Date.now() - (slot % 5 + 1) * 5 * 3_600_000).toISOString(),
          notified_count: status === "ESCALATED" ? 3 + (slot % 3) : 0,
          declined_count: status === "ESCALATED" ? slot % 3 : 0,
        });
        const items = [
          ...holders(4, OFF.assigned).map((p, i) => toItem(p, "ASSIGNED", i * 5 + 1)),
          ...holders(2, OFF.requesting).map((p, i) => toItem(p, "PENDING", i * 7 + 2)),
          ...holders(1, OFF.failed).map((p, i) => toItem(p, "ESCALATED", i * 11 + 3)),
          ...holders(1, OFF.needsRequest).map((p, i) => toItem(p, "CANCELLED", i * 13 + 4)),
        ];
        sendJson(res, 200, {
          ...base,
          items,
          failedItems:       items.filter(item => item.status === "ESCALATED"),
          needsRequestItems: items.filter(item => item.status === "CANCELLED"),
        });
        return;
      }
      if (req.url?.startsWith("/api/cleaning/properties") && req.method === "POST") {
        // dev 전용 스텁 — 숙소 등록/이전 (실제 DB 없음). previous_property_id 가 오면 이전 성공으로 응답
        const body = await readBody(req);
        if (!body.property_id || !body.name) { sendJson(res, 400, { error: "property_id, name 필수" }); return; }
        sendJson(res, 200, { ...body, ...(body.previous_property_id ? { migrated: {} } : {}) });
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
