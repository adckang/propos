import { expect, test } from "@playwright/test";

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
        if (!text.includes("favicon")) consoleErrors.push(text);
      }
    });
    page.on("response", response => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
    });

    // ── 랜딩 ──────────────────────────────────────────────
    await page.goto("/");
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();
    await expect(page.getByRole("button", { name: "대표 숙소 상세 보기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "커맨드 센터 열기" })).toBeVisible();
    await expect(page.getByText("지금 뜬 알림")).toBeVisible();
    await expect(page.getByText("S01 · 내일 체크인 준비")).toBeVisible();
    await expect(page.getByText("S03 · 체류 중 대응")).toBeVisible();

    // ── HomeAssistant 화면 ─────────────────────────────────
    await page.getByRole("button", { name: "대표 숙소 상세 보기" }).click();
    await expect(page.getByText("해운대 오션뷰 펜트하우스")).toBeVisible();
    await expect(page.getByText("빠른 제어")).toBeVisible();
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

    // AttentionCard 있으면 카드 클릭 → 상세 패널
    const attentionSection = page.locator(".cc-scroll-sections");
    const firstCardName = attentionSection.locator("div").filter({ hasText: /자동 모니터링|오프라인|복구 실패|임계치/ }).first();
    const hasAttention = await firstCardName.isVisible().catch(() => false);
    if (hasAttention) {
      await firstCardName.click();
      await expect(page.getByText("자동화 상태").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "대표 숙소 보드 열기" }).first()).toBeVisible();
    }

    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    // ── 랜딩 포털 카드 → CommandCenter 시점 필터 연동 ─────
    await landingPortalCard("내일 체크인 준비").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    // S01 시점 필터 pill 활성 확인
    await expect(page.getByRole("button", { name: /S01/ })).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("당일 입실 확인").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(page.getByRole("button", { name: /S02/ })).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("체류 중 대응").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(page.getByRole("button", { name: /S03/ })).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("다음 예약 준비").click();
    await expect(page.getByText("자동운영 안정화 관제 센터")).toBeVisible();
    await expect(page.getByRole("button", { name: /S04/ })).toBeVisible();
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
});
