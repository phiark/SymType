import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { assertNoPageOverflow, mutate, resetOnboarding, typeTargetAtPace } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;

async function expectNoAxeViolations(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags([...wcagTags]).analyze();
  expect(
    result.violations,
    `${state}:\n${result.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help}\n${violation.nodes
            .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
            .join("\n")}`
      )
      .join("\n")}`
  ).toEqual([]);
}

async function enableCompletedOnboarding(
  request: Parameters<typeof mutate>[0],
  theme: "light" | "dark"
): Promise<void> {
  await mutate(request, "patch", "/api/v1/settings", {
    onboardingComplete: true,
    calibrationComplete: true,
    theme,
    reducedMotion: true,
    keyboardVisible: true
  });
}

async function openSingleBlockCalibration(page: Page): Promise<string> {
  await page.clock.install();
  await page.goto(
    "/train/session?mode=calibration&duration=0.25&calibrationCategories=letters&seed=424242"
  );
  await page.waitForLoadState("networkidle");

  const blockPromise = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.clock.fastForward(1);
  await page.getByRole("button", { name: /^开始$/u }).click();
  const blockResponse = await blockPromise;
  expect(blockResponse.ok(), await blockResponse.text()).toBeTruthy();
  const body = (await blockResponse.json()) as { block: { target_text: string } };
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await expect(surface).toBeVisible();
  await expect(surface).toBeFocused();
  return body.block.target_text;
}

async function pressForwardTab(page: Page, projectName: string): Promise<void> {
  // Desktop Safari follows the macOS default of using Option+Tab for buttons and links.
  await page.keyboard.press(projectName === "webkit" ? "Alt+Tab" : "Tab");
}

function screenshotOptions() {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    fullPage: false,
    maxDiffPixelRatio: 0.001,
    scale: "css" as const
  };
}

test("visual 1024 route matrix has no horizontal overflow", async ({ page, request }, testInfo) => {
  await enableCompletedOnboarding(request, "light");
  await page.clock.setFixedTime(new Date("2026-07-21T12:00:00Z"));
  await page.setViewportSize({ width: 1024, height: 768 });

  const routes = [
    { path: "/", name: "today" },
    { path: "/train", name: "train" },
    { path: "/settings", name: "settings" },
    { path: "/game", name: "game" },
    { path: "/analytics", name: "analytics" }
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#main-content h1").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (route.name === "analytics") {
      const statisticsResponse = await request.get("/api/v1/statistics?period=7d");
      expect(statisticsResponse.ok(), await statisticsResponse.text()).toBeTruthy();
      const statistics = (await statisticsResponse.json()) as {
        overview: { sessions: number; characters: number };
      };
      expect(statistics.overview).toMatchObject({ sessions: 0, characters: 0 });
      const characterCard = page
        .locator(".metric-card")
        .filter({ has: page.getByText("字符", { exact: true }) });
      await expect(characterCard.locator("strong")).toHaveText("0");
    }
    await assertNoPageOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(
      `1024-${route.name}-light-${testInfo.project.name}.png`,
      screenshotOptions()
    );
  }
});

test("200 percent desktop reflow proxy preserves the primary Today task", async ({
  page,
  request
}, testInfo) => {
  await enableCompletedOnboarding(request, "light");
  await page.clock.setFixedTime(new Date("2026-07-21T12:00:00Z"));
  // A 512 CSS-pixel layout is the deterministic reflow equivalent of viewing a
  // 1024 CSS-pixel desktop canvas at 200%. It does not claim to automate browser chrome zoom UI.
  await page.setViewportSize({ width: 512, height: 768 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#main-content h1").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /开始今日训练/u })).toBeVisible();
  await expectNoAxeViolations(page, "200 percent desktop reflow proxy");
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(
    `reflow-200-today-${testInfo.project.name}.png`,
    screenshotOptions()
  );
});

test("visual zero-evidence formal test completion is neutral", async ({
  page,
  request
}, testInfo) => {
  await enableCompletedOnboarding(request, "dark");
  await page.clock.install();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/test/session?mode=typing-test&seconds=15");
  const blockPromise = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.clock.fastForward(1);
  await page.getByRole("button", { name: /^开始/u }).click();
  expect((await blockPromise).ok()).toBeTruthy();
  await page.clock.fastForward(15_500);

  await expect(page.getByRole("heading", { name: "这次测试没有有效输入" })).toBeVisible();
  await expect(page.getByText("已安全关闭，未计入训练统计")).toBeVisible();
  await expect(page.getByText(/不会增加今日目标、连续天数或个人最佳/u)).toBeVisible();
  await expect(page.getByText("已写入本机 SQLite")).toHaveCount(0);
  await expect(page.getByText("已安全保存", { exact: true })).toBeVisible();
  await expect(page.getByText("净 WPM", { exact: true })).toHaveCount(0);
  await expect(page.getByText("做得好", { exact: true })).toHaveCount(0);
  await expect(page.getByText("主观难度", { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page, "zero-evidence formal test completion");
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(
    `test-empty-complete-dark-${testInfo.project.name}.png`,
    screenshotOptions()
  );

  const statisticsResponse = await request.get("/api/v1/statistics?period=all");
  expect(statisticsResponse.ok(), await statisticsResponse.text()).toBeTruthy();
  expect((await statisticsResponse.json()) as unknown).toMatchObject({
    overview: { sessions: 0, active_ms: 0, characters: 0 }
  });
});

test("functional dynamic states pass axe and preserve keyboard focus", async ({
  page,
  request
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await resetOnboarding(request);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const welcomeHeading = page.getByRole("heading", { name: /为 Symmetric 指法建立/u });
  await expect(welcomeHeading).toBeFocused();
  await expectNoAxeViolations(page, "onboarding welcome");
  await pressForwardTab(page, testInfo.project.name);
  await expect(page.getByRole("button", { name: /开始设置/u })).toBeFocused();

  await page.getByRole("button", { name: /开始设置/u }).click();
  await expect(page.getByRole("heading", { name: "先让训练适合你的环境。" })).toBeFocused();
  await page.getByRole("combobox", { name: "主题" }).selectOption("dark");
  await page.getByRole("button", { name: /^继续/u }).click();
  await expect(page.getByRole("heading", { name: "选择这次想取样的区域。" })).toBeFocused();
  await expectNoAxeViolations(page, "onboarding calibration choices");
  await page.getByRole("button", { name: "稍后校准" }).click();
  await expect(page.getByRole("button", { name: /开始今日训练/u })).toBeVisible();

  const target = await openSingleBlockCalibration(page);
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoAxeViolations(page, "active training surface");

  await surface.press("Escape");
  const dialog = page.getByRole("dialog", { name: "结束这次训练？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "继续训练" })).toBeFocused();
  await pressForwardTab(page, testInfo.project.name);
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expectNoAxeViolations(page, "training exit confirmation");
  await dialog.getByRole("button", { name: "继续训练" }).click();
  await expect(dialog).toBeHidden();
  await expect(surface).toBeFocused();

  await page.clock.fastForward(179_000);
  await typeTargetAtPace(page, target);
  const completionHeading = page.getByRole("heading", { name: "这一轮完成了" });
  await expect(completionHeading).toBeVisible();
  await expect(completionHeading).toBeFocused();
  await expectNoAxeViolations(page, "training completion");
  await assertNoPageOverflow(page);
});

test("visual dark active training, exit dialog, and completion", async ({
  page,
  request
}, testInfo) => {
  await enableCompletedOnboarding(request, "dark");
  await page.setViewportSize({ width: 1024, height: 900 });
  const target = await openSingleBlockCalibration(page);
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(
    `training-active-dark-${testInfo.project.name}.png`,
    screenshotOptions()
  );

  await surface.press("Escape");
  const dialog = page.getByRole("dialog", { name: "结束这次训练？" });
  await expect(dialog).toBeVisible();
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(
    `training-exit-dialog-dark-${testInfo.project.name}.png`,
    screenshotOptions()
  );

  await dialog.getByRole("button", { name: "继续训练" }).click();
  await expect(surface).toBeFocused();
  await page.clock.fastForward(179_000);
  await typeTargetAtPace(page, target);
  await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(
    `training-complete-dark-${testInfo.project.name}.png`,
    screenshotOptions()
  );
});

test("visual designed disconnected state is actionable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route("**/api/v1/bootstrap", (route) => route.abort("connectionfailed"));
  await page.goto("/");

  const error = page.getByRole("alert");
  await expect(error.getByRole("heading", { name: "本地服务暂时没有回应" })).toBeVisible({
    timeout: 15_000
  });
  await expect(error.getByRole("button", { name: /重试/u })).toBeEnabled();
  await assertNoPageOverflow(page);
  await expectNoAxeViolations(page, "disconnected bootstrap state");
  await pressForwardTab(page, testInfo.project.name);
  await expect(error.getByRole("button", { name: /重试/u })).toBeFocused();
  await expect(page).toHaveScreenshot(
    `disconnected-${testInfo.project.name}.png`,
    screenshotOptions()
  );
});
