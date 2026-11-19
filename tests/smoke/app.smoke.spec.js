import { expect, test } from "@playwright/test";
import { getDemoStats, getDemoDrilldown, getDemoMonthlyCalendar } from '../../src/application/demoReportingService.js';
import { productionCsp } from '../helpers/cspPolicy.js';

// 운영 응답의 CSP(vercel.json)를 미리보기 서버의 화면 응답에 그대로 붙이되 **차단** 모드로 건다 — 운영은 아직
// Report-Only 지만, 시험에서는 막히는 것이 있으면 화면이 깨지고 위반이 기록되어 바로 실패한다(나중에 차단으로 바꿀 근거).
const CSP = productionCsp().value;
let cspViolations = [];

// Local preview shares production APIs. UI tests must never send writes or
// telemetry to the occupied property; all service requests use fixture data.
test.beforeEach(async ({ page }) => {
  cspViolations = [];
  await page.exposeFunction('__proposCspViolation', violation => { cspViolations.push(violation); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      window.__proposCspViolation(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.fulfill({ status: 204, body: '' });
    if (route.request().resourceType() === 'document') {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body = {};
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'UI test is read-only' } });
    if (url.pathname === '/api/auth/me') body = { required: false };
    else if (url.pathname === '/api/properties' || url.pathname === '/api/cleaning/properties') body = [];
    else if (url.pathname === '/api/stats/calendar') body = getDemoMonthlyCalendar(url.searchParams.get('period') ?? 'this_month');
    else if (url.pathname === '/api/stats/drilldown') body = getDemoDrilldown(url.searchParams.get('metric'), url.searchParams.get('period'));
    else if (url.pathname === '/api/stats') body = getDemoStats(url.searchParams.get('period') ?? 'now');
    return route.fulfill({ status: 200, json: body });
  });
});

test.afterEach(() => {
  expect(cspViolations, '운영 CSP 위반').toEqual([]);
});

test.describe("PROPOS smoke", () => {
  test("landing and key pages render without runtime errors", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];
    const returnButton = () => page.getByRole("button", { name: /← (홈|뒤로|커맨드 센터)/ }).first();
    const haStage = text => page.locator(".ha-step").filter({ hasText: text }).first();
    const landingPortalCard = label => page.locator(".land-status-card").filter({ hasText: label }).first();

    page.on("pageerror", error => { pageErrors.push(String(error)); });
    page.on("console", message => {
      if (message.type() === "error") {
        const text = message.text();
        // favicon 404 and API resource 404 are expected in vite preview (no serverless runtime)
        if (!text.includes("favicon") && !text.includes("Failed to load resource")) {
          consoleErrors.push(text);
        }
      }
    });
    page.on("response", response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
    });

    // ── RSM 대시보드 기본 화면 (앱 기본값) → 홈으로 이동 ──────
    await page.goto("/");
    await expect(page.getByText("현황 대시보드")).toBeVisible();
    await returnButton().click(); // ← 홈 → landing

    // ── 랜딩 ──────────────────────────────────────────────
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();
    await expect(page.getByRole("button", { name: "대표 숙소 상세 보기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "커맨드 센터 열기" })).toBeVisible();
    await expect(page.getByText("지금 뜬 알림")).toBeVisible();
    await expect(page.getByText("S01 · 내일 체크인 준비")).toBeVisible();
    await expect(page.getByText("S03 · 체류 중 대응")).toBeVisible();

    // ── HomeAssistant 화면 ─────────────────────────────────
    await page.getByRole("button", { name: "대표 숙소 상세 보기" }).click();
    await expect(page.getByText("해운대 오션뷰 펜트하우스").first()).toBeVisible();
    await expect(page.getByText("빠른 제어").first()).toBeVisible();
    await expect(page.getByText("지금 처리해야 할 것").or(page.getByText("지금 안정")).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "← 커맨드 센터" }).first()).toBeVisible();
    await expect(page.getByText("처리 필요")).toBeVisible();
    await haStage(/D-1 자동화\s*내일 체크인/).click();
    await expect(page.getByText("도어락 PIN 발급")).toBeVisible();
    await haStage(/체크인\s*입실 완료/).click();
    await expect(page.getByText("체크인 씬 실행 결과")).toBeVisible();
    await haStage(/퇴실·청소\s*체크아웃 예정/).click();
    await expect(page.getByText("청소 체크리스트", { exact: true })).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    // ── CommandCenter 기본 렌더 ────────────────────────────
    await page.getByRole("button", { name: "커맨드 센터 열기" }).click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(page.getByText("자동화 알림")).toBeVisible();
    await expect(page.getByText("개입 필요").first()).toBeVisible();
    await expect(page.getByText("자동 운영 정상").first()).toBeVisible();

    // 건강도 필터 버튼 확인
    await expect(page.getByRole("button", { name: /전체/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /시스템 장애/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /성능 저하/ })).toBeVisible();

    // 시점 필터 pills 확인
    await expect(page.getByText("시점 필터")).toBeVisible();

    // AttentionCard 있으면 카드 클릭 → 상세 패널 → HA handoff 검증
    const attentionSection = page.locator(".cc-scroll-sections");
    const firstCardName = attentionSection.locator("div").filter({ hasText: /자동 모니터링|오프라인|복구 실패|임계치/ }).first();
    const hasAttention = await firstCardName.isVisible().catch(() => false);
    if (hasAttention) {
      await firstCardName.click();
      await expect(page.getByText("자동화 상태").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "대표 숙소 보드 열기" }).first()).toBeVisible();
      // CC → HA handoff: 실제 건강도가 status 카드에 반영되는지 검증
      await page.getByRole("button", { name: "대표 숙소 보드 열기" }).first().click();
      await expect(page.getByText("지금 처리해야 할 것").or(page.getByText("지금 안정")).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "← 뒤로" }).first()).toBeVisible();
      await returnButton().click(); // HA → CC (source: "command-center" 이므로 CC 복귀)
    }

    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    // ── 랜딩 포털 카드 → CommandCenter 시점 필터 pill 활성 검증 ─
    const stagePill = code => page.locator(`button[data-active="true"]`).filter({ hasText: code }).first();

    await landingPortalCard("내일 체크인 준비").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(stagePill("S01")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("당일 입실 확인").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(stagePill("S02")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("체류 중 대응").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(stagePill("S03")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("다음 예약 준비").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(stagePill("S04")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("정산 검토").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    // ── 런타임 오류 없음 ──────────────────────────────────
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });

  test("CSP: 위 흐름 밖의 화면(로그인·개인정보·약관·목록/상세)도 운영 정책을 지킨다", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", error => { pageErrors.push(String(error)); });

    await page.goto("/privacy-policy");
    await expect(page.getByRole("heading", { name: "개인정보처리방침" })).toBeVisible();
    await page.goto("/terms-of-service");
    await expect(page.locator("h1").first()).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("현황 대시보드")).toBeVisible();
    await page.locator('[data-testid="status-details-toggle"]').click();
    await page.locator('[data-testid="status-card-OCCUPIED"]').click();
    await expect(page.getByRole("button", { name: /← (대시보드|뒤로)/ }).first()).toBeVisible();

    // 로그인을 요구하는 서버(enforce)라면 보이는 로그인 화면
    await page.route("**/api/auth/me", route => route.fulfill({ json: { required: true, mode: "enforce", authenticated: false } }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "PROPOS 운영자 로그인" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("CSP: 정책은 필요한 곳(같은 사이트·Clarity·구글 폰트)만 열고 그 밖은 막는다 — 비어 있는 정책이 아님", async ({ page }) => {
    await page.goto("/privacy-policy");
    await expect(page.getByRole("heading", { name: "개인정보처리방침" })).toBeVisible();
    await page.evaluate(async () => {
      const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); document.head.appendChild(el); };
      // 열려 있어야 하는 것 — 운영의 Clarity 분석(태그·본체·수집), 구글 폰트, 같은 사이트 API·이미지
      add("script", { src: "https://www.clarity.ms/tag/csp-probe" });
      add("script", { src: "https://scripts.clarity.ms/0.8.0/clarity.js" });
      add("img", { src: "https://c.bing.com/c.gif" });
      add("img", { src: "https://c.clarity.ms/c.gif" });
      add("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Probe" });
      add("img", { src: "/api/camera/snapshot?path=/local/snapshots/csp-probe.jpg" }); // CCTV 사진은 같은 사이트 이미지
      await fetch("https://k.clarity.ms/collect", { method: "POST", mode: "no-cors" }).catch(() => {});
      await fetch("/api/stats?period=now").catch(() => {});
      // 막혀야 하는 것 — 다른 곳의 스크립트, 페이지 안에 직접 쓴 스크립트, 다른 곳으로 보내는 요청, 허용 목록 밖 이미지
      add("script", { src: "https://cdn.csp-probe.invalid/x.js" });
      add("script", { textContent: "window.__cspInlineRan = true;" });
      await fetch("https://collect.csp-probe.invalid/x", { method: "POST", mode: "no-cors" }).catch(() => {});
      add("img", { src: "https://images.unsplash.com/photo-csp-probe" }); // 앱에서 갈 수 없는 옛 소개 화면만 쓴다
      add("img", { src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }); // 앱 코드가 쓰지 않는다
    });
    const expected = [
      "connect-src https://collect.csp-probe.invalid/x",
      "img-src data",
      "img-src https://images.unsplash.com/photo-csp-probe",
      "script-src-elem https://cdn.csp-probe.invalid/x.js",
      "script-src-elem inline",
    ];
    await expect.poll(() => [...cspViolations].sort()).toEqual(expected);
    expect(await page.evaluate(() => window.__cspInlineRan)).toBeUndefined();
    cspViolations = []; // 의도한 위반 — 공통 검사(afterEach)에서 빼기
  });
});
