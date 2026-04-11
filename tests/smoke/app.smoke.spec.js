import { expect, test } from "@playwright/test";

test.describe("PROPOS smoke", () => {
  test("landing and key pages render without runtime errors", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const returnButton = () => page.getByRole("button", { name: /← (홈|뒤로)/ });

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
    await returnButton().click();

    await page.getByText("커맨드 센터").first().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await expect(page.getByText("실시간 알림")).toBeVisible();
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
