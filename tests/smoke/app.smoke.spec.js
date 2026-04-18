import { expect, test } from "@playwright/test";

test.describe("PROPOS smoke", () => {
  test("landing and key pages render without runtime errors", async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];
    const returnButton = () => page.getByRole("button", { name: /← (홈|뒤로|커맨드 센터)/ }).first();
    const haStage = text => page.locator(".ha-step").filter({ hasText: text }).first();
    const ccStage = (code, label) => page.locator(".pipeline-card").filter({ hasText: code }).filter({ hasText: label }).first();
    const landingPortalCard = label => page.locator(".land-status-card").filter({ hasText: label }).first();

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
    await expect(page.getByText("S01 · 내일 체크인 준비")).toBeVisible();
    await expect(page.getByText("S03 · 체류 중 대응")).toBeVisible();

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

    await page.getByRole("button", { name: "커맨드 센터 열기" }).click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await expect(page.getByText("실시간 알림", { exact: true })).toBeVisible();
    await expect(page.getByText("처리할 숙소")).toBeVisible();
    await ccStage("S03", "체류 중").click();
    await expect(page.getByRole("button", { name: "체류 중 예외 일괄 처리" }).first()).toBeVisible();
    await page.locator(".cc-queue-card").first().locator("button", { hasText: "상세" }).click();
    await expect(page.getByText("왜 이 숙소를 봐야 하나")).toBeVisible();
    await expect(page.getByRole("button", { name: "대표 숙소 보드 열기" }).first()).toBeVisible();
    await page.getByRole("button", { name: "대표 숙소 보드 열기" }).first().click();
    await expect(page.getByText("지금 처리해야 할 것").or(page.getByText("지금 안정")).first()).toBeVisible();
    await expect(page.getByText("처리 필요")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("내일 체크인 준비").click();
    await expect(ccStage("S01", "D-1 준비")).toBeVisible();
    await expect(page.getByRole("button", { name: "D-1 자동화 일괄 처리" }).first()).toBeVisible();
    await page.getByRole("button", { name: "D-1 자동화 일괄 처리" }).first().click();
    await expect(page.getByText("내일 체크인 준비").first()).toBeVisible();
    await expect(page.getByText("같은 단계 예외를 묶어서 처리")).toBeVisible();
    await expect(page.getByText("자동 실행")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("당일 입실 확인").click();
    await expect(ccStage("S02", "체크인 당일")).toBeVisible();
    await page.getByRole("button", { name: "체크인 예외 일괄 처리" }).first().click();
    await expect(page.getByText("같은 단계 예외를 묶어서 처리").first()).toBeVisible();
    await expect(page.getByText("처리 필요").first()).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("체류 중 대응").click();
    await expect(ccStage("S03", "체류 중")).toBeVisible();
    await page.getByRole("button", { name: "체류 중 예외 일괄 처리" }).first().click();
    await expect(page.getByText("실시간 모니터링").first()).toBeVisible();
    await expect(page.getByText("같은 단계 예외를 묶어서 처리").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /폴링 시작/ }).first()).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("다음 예약 준비").click();
    await expect(ccStage("S04", "퇴실·청소")).toBeVisible();
    await page.getByRole("button", { name: "퇴실·청소 일괄 처리" }).first().click();
    await expect(page.getByText("S04 · 퇴실·청소").first()).toBeVisible();
    await expect(page.getByText("같은 단계 예외를 묶어서 처리").first()).toBeVisible();
    await expect(page.getByText("청소 체크리스트").or(page.getByText("퇴실 감지")).first()).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    await landingPortalCard("정산 검토").click();
    await expect(ccStage("S05", "수익 정산")).toBeVisible();
    await page.getByRole("button", { name: "수익 정산 일괄 처리" }).first().click();
    await expect(page.getByText("이번 달 수익 정리")).toBeVisible();
    await expect(page.getByText("같은 단계 예외를 묶어서 처리")).toBeVisible();
    await expect(page.getByText("지금 할 일")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("전체 관제 센터")).toBeVisible();
    await returnButton().click();
    await expect(page.getByText("에어비앤비 완전 관리 시스템")).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
