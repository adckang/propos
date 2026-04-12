import { expect, test } from "@playwright/test";

test.describe("PROPOS smoke", () => {
  test("landing and key pages render without runtime errors", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const returnButton = () => page.getByRole("button", { name: /← (홈|뒤로)/ }).first();
    const haStage = text => page.locator(".ha-step").filter({ hasText: text }).first();
    const ccStage = label => page.locator(".pipeline-card").filter({ hasText: label }).first();

    page.on("pageerror", error => {
      pageErrors.push(String(error));
    });

    page.on("console", message => {
      if (message.type() === "error") {
        const text = message.text();
        if (!text.includes("favicon")) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto("/");

    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await page.getByText("홈 어시스턴트").first().click();
    await expect(page.getByText("해운대 오션뷰 펜트하우스")).toBeVisible();
    await expect(page.getByText("빠른 제어")).toBeVisible();
    await haStage(/D-1 자동화\s*내일 체크인/).click();
    await expect(page.getByText("도어락 PIN 발급")).toBeVisible();
    await haStage(/체크인\s*입실 완료/).click();
    await expect(page.getByText("체크인 씬 실행 결과")).toBeVisible();
    await haStage(/퇴실·청소\s*체크아웃 예정/).click();
    await expect(page.getByText("청소 체크리스트")).toBeVisible();
    await returnButton().click();

    await page.getByText("커맨드 센터").first().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await expect(page.getByText("실시간 알림")).toBeVisible();
    await ccStage("센서 모니터링").click();
    await expect(page.getByText("전체 폴링 시작")).toBeVisible();
    await page.locator(".pcard").first().click();
    await expect(page.getByText("숙소 정보")).toBeVisible();
    await page.locator(".dtab").filter({ hasText: "IoT" }).click();
    await expect(page.getByText("IoT 디바이스")).toBeVisible();
    await returnButton().click();

    await page.getByText("D-1 자동화").first().click();
    await expect(page.getByText("D-1 체크인 전날 자동화").first()).toBeVisible();
    await returnButton().click();

    await page.getByText("체크인 당일").first().click();
    await expect(page.getByText("UC-002 — 체크인 당일 자동화")).toBeVisible();
    await returnButton().click();

    await page.getByText("체류 중 모니터링").first().click();
    await expect(page.getByText("UC-003 — 체류 중 실시간 모니터링")).toBeVisible();
    await returnButton().click();

    await page.getByText("체크아웃 & 청소").first().click();
    await expect(page.getByText("UC-004 — 체크아웃 & 청소 자동화")).toBeVisible();
    await returnButton().click();

    await page.getByText("수익 정산").first().click();
    await expect(page.getByText("UC-005 — 수익 정산 자동화")).toBeVisible();
    await returnButton().click();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
