import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { typeTarget } from "../e2e/helpers";
import { patchSettings } from "./api";
import { saveObservation } from "./observations";

interface StatisticsSummary {
  overview: { sessions: number; characters: number; errors: number };
  features: Array<{ feature_type: string }>;
  groups: unknown[];
  trend: unknown[];
}

interface DashboardSummary {
  today: { sessions: number; characters: number };
  streak: { current_days: number };
  weaknesses: Array<{ feature_value: string; sample_count: number }>;
  lastSession: { summary: { characters: number } } | null;
}

interface CompletionSummary {
  saved: boolean;
  summary: { characters: number };
}

async function sha256(path: string): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const digest = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", rejectPromise);
    input.once("end", () => resolvePromise(digest.digest("hex")));
  });
}

async function timedGet<T>(
  request: APIRequestContext,
  path: string
): Promise<{ body: T; elapsedMs: number }> {
  const startedAt = performance.now();
  const response = await request.get(path);
  const elapsedMs = performance.now() - startedAt;
  expect(response.ok(), await response.text()).toBeTruthy();
  return { body: (await response.json()) as T, elapsedMs };
}

function nextBlock(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
}

test("100k fixture supports Today, a completed course, and populated Analytics", async ({
  browser,
  page,
  request
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-local", "The release smoke uses local Chromium");
  test.setTimeout(180_000);

  const fixturePath = resolve(process.env.SYMTYPE_PERF_FIXTURE_PATH ?? "");
  expect(process.env.SYMTYPE_PERF_FIXTURE_PATH, "100k fixture path").toBeTruthy();
  const fixtureShaBefore = await sha256(fixturePath);
  const totalStartedAt = performance.now();

  await patchSettings(request, {
    onboardingComplete: true,
    calibrationComplete: false,
    keyboardVisible: false,
    reducedMotion: true,
    soundEnabled: false,
    stopOnError: false,
    theme: "light"
  });

  const statisticsBefore = await timedGet<StatisticsSummary>(
    request,
    "/api/v1/statistics?period=all"
  );
  expect(statisticsBefore.body.overview).toMatchObject({
    sessions: 100,
    characters: 100_000,
    errors: 4_200
  });

  const dashboardBefore = await timedGet<DashboardSummary>(request, "/api/v1/dashboard");
  expect(dashboardBefore.body.weaknesses.length).toBeGreaterThan(0);
  expect(dashboardBefore.body.lastSession?.summary.characters).toBeGreaterThan(0);

  const todayStartedAt = performance.now();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /开始今日训练/u })).toBeVisible();
  await expect(page.getByText(/个样本/u).first()).toBeVisible();
  const todayRenderMs = performance.now() - todayStartedAt;

  await page.getByRole("button", { name: /^5\s*分钟$/u }).click();
  await expect(page).toHaveURL(/\/train\/session\?mode=smart&duration=5/u);
  await expect(page.getByRole("heading", { name: "今日智能课程" })).toBeVisible();

  const courseStartedAt = performance.now();
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
  );
  let blockResponse = nextBlock(page);
  await page.getByRole("button", { name: /^开始/u }).click();
  const sessionId = ((await (await sessionResponse).json()) as { session: { id: string } }).session
    .id;
  let completion: CompletionSummary | undefined;

  for (let blockIndex = 0; blockIndex < 5; blockIndex += 1) {
    const block = (await (await blockResponse).json()) as { block: { target_text: string } };
    const transition =
      blockIndex < 4
        ? nextBlock(page)
        : page.waitForResponse(
            (response) =>
              response.url().endsWith(`/api/v1/sessions/${sessionId}/complete`) &&
              response.request().method() === "POST"
          );
    await typeTarget(page, block.block.target_text);
    const response = await transition;
    expect(response.ok(), await response.text()).toBeTruthy();
    if (blockIndex < 4) blockResponse = Promise.resolve(response);
    else completion = (await response.json()) as CompletionSummary;
  }

  await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
  await expect(page.getByText(/已安全保存到这台电脑/u)).toBeVisible();
  expect(completion?.saved).toBe(true);
  expect(completion?.summary.characters).toBeGreaterThan(0);
  const courseCompleteMs = performance.now() - courseStartedAt;

  const dashboardAfter = await timedGet<DashboardSummary>(request, "/api/v1/dashboard");
  expect(dashboardAfter.body.today.sessions).toBeGreaterThanOrEqual(1);
  expect(dashboardAfter.body.today.characters).toBe(completion?.summary.characters);

  await page.goto("/");
  const todayCharacters = page.getByText("今天练习", { exact: true }).locator("..");
  await expect(todayCharacters).toContainText(`${dashboardAfter.body.today.characters} 字符`);

  const analyticsStartedAt = performance.now();
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "把数据变成下一次行动" })).toBeVisible();
  const allResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/statistics?period=all")
  );
  await page.getByRole("button", { name: "全部", exact: true }).click();
  const renderedStatistics = (await (await allResponse).json()) as StatisticsSummary;
  const expectedCharacters = 100_000 + (completion?.summary.characters ?? 0);
  expect(renderedStatistics.overview.characters).toBe(expectedCharacters);
  const characterCard = page.getByText("字符", { exact: true }).locator("..");
  await expect(characterCard).toContainText(expectedCharacters.toLocaleString());
  await expect(page.getByText(/键盘热力图/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "实际输入 → 目标输入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "手、手指、行、区域与 Shift" })).toBeVisible();

  for (const feature of ["二元组合", "映射指区", "字符类别"]) {
    const button = page.getByRole("button", { name: feature, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("table").last()).toBeVisible();
  }
  const analyticsRenderMs = performance.now() - analyticsStartedAt;

  const statisticsAfter = await timedGet<StatisticsSummary>(
    request,
    "/api/v1/statistics?period=all"
  );
  expect(statisticsAfter.body.overview.characters).toBe(expectedCharacters);
  expect(statisticsAfter.body.features.length).toBeGreaterThan(0);
  expect(statisticsAfter.body.groups.length).toBeGreaterThan(0);
  expect(statisticsAfter.body.trend.length).toBeGreaterThan(0);

  const fixtureShaAfter = await sha256(fixturePath);
  expect(fixtureShaAfter).toBe(fixtureShaBefore);
  await saveObservation(testInfo, "100k-product-smoke", {
    command:
      "SYMTYPE_PERF_FIXTURE_PATH=.symtype-perf-data/fixtures/100k.sqlite3 SYMTYPE_PERF_OBSERVATION_DIR=reports/performance/fragments SYMTYPE_PERF_RUN_ID=100k-product-smoke npm exec playwright -- test --config=playwright.performance.config.ts --project=chromium-local tests/performance/100k-product-smoke.spec.ts",
    environment: {
      architecture: process.arch,
      browser: `Chromium ${browser.version()}`,
      node: process.version,
      platform: process.platform,
      project: testInfo.project.name
    },
    fixture: {
      eventsBefore: statisticsBefore.body.overview.characters,
      sha256Before: fixtureShaBefore,
      sha256After: fixtureShaAfter,
      sourceUnchanged: fixtureShaAfter === fixtureShaBefore
    },
    measurementsMs: {
      analyticsRender: analyticsRenderMs,
      courseComplete: courseCompleteMs,
      dashboardAfter: dashboardAfter.elapsedMs,
      dashboardBefore: dashboardBefore.elapsedMs,
      statisticsAfter: statisticsAfter.elapsedMs,
      statisticsBefore: statisticsBefore.elapsedMs,
      todayRender: todayRenderMs,
      total: performance.now() - totalStartedAt
    },
    result: {
      completedCharacters: completion?.summary.characters ?? 0,
      finalCharacters: statisticsAfter.body.overview.characters,
      renderedFeatureViews: ["二元组合", "映射指区", "字符类别"]
    }
  });
});
