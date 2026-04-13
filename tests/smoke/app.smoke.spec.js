import { expect, test } from "@playwright/test";

test.describe("PROPOS smoke", () => {
  test("landing and key pages render without runtime errors", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];
    const returnButton = () => page.getByRole("button", { name: /← (홈|뒤로)/ }).first();
    const haStage = text => page.locator(".ha-step").filter({ hasText: text }).first();
    const ccStage = label => page.locator(".pipeline-card").filter({ hasText: label }).first();
    const landingStageCard = label => page.locator(".land-sc-card").filter({ hasText: label }).first();

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

    page.on("response", response => {
      const url = response.url();
      const status = response.status();
      if (status >= 500) {
        failedResponses.push(`${status} ${url}`);
      }
    });

    await page.goto("/");

    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();
    await expect(page.getByRole("button", { name: "대표 숙소 상세 보기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "커맨드 센터 열기" })).toBeVisible();
    await expect(page.getByText("지금 뜬 알림")).toBeVisible();

    await page.getByRole("button", { name: "대표 숙소 상세 보기" }).click();
    await expect(page.getByText("해운대 오션뷰 펜트하우스")).toBeVisible();
    await expect(page.getByText("빠른 제어")).toBeVisible();
    await expect(page.getByText("지금 할 일")).toBeVisible();
    await haStage(/D-1 자동화\s*내일 체크인/).click();
    await expect(page.getByText("도어락 PIN 발급")).toBeVisible();
    await haStage(/체크인\s*입실 완료/).click();
    await expect(page.getByText("체크인 씬 실행 결과")).toBeVisible();
    await haStage(/퇴실·청소\s*체크아웃 예정/).click();
    await expect(page.getByText("청소 체크리스트", { exact: true })).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await page.getByRole("button", { name: "커맨드 센터 열기" }).click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await expect(page.getByText("실시간 알림")).toBeVisible();
    await expect(page.getByText("즉시 대응 큐", { exact: true })).toBeVisible();
    await ccStage("센서 모니터링").click();
    await expect(page.getByText("전체 폴링 시작")).toBeVisible();
    await page.locator(".pcard").first().click();
    await expect(page.getByText("숙소 정보")).toBeVisible();
    await page.locator(".dtab").filter({ hasText: "IoT" }).click();
    await expect(page.getByText("IoT 디바이스")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingStageCard("D-1 자동화").click();
    await expect(page.getByText("D-1 체크인 전날 자동화").first()).toBeVisible();
    await expect(page.getByText("자동 실행")).toBeVisible();
    await returnButton().click();

    await landingStageCard("체크인 당일").click();
    await expect(page.getByText("숙소 현황")).toBeVisible();
    await expect(page.getByText("도어락 열림 감지")).toBeVisible();
    await returnButton().click();

    await landingStageCard("체류 중 모니터링").click();
    await expect(page.getByText("UC-003 — 체류 중 실시간 모니터링")).toBeVisible();
    await expect(page.getByRole("button", { name: /폴링 시작/ })).toBeVisible();
    await returnButton().click();

    await landingStageCard("체크아웃 & 청소").click();
    await expect(page.getByText("퇴실 후 정리 현황")).toBeVisible();
    await expect(page.getByText("지금 먼저 처리할 것")).toBeVisible();
    await returnButton().click();

    await landingStageCard("수익 정산").click();
    await expect(page.getByText("이번 달 수익 정산")).toBeVisible();
    await expect(page.getByText("이번 달 정산에서 먼저 볼 것")).toBeVisible();
    await returnButton().click();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
