import { expect, test } from "@playwright/test";
import { mutate, restoreFreshE2eState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await restoreFreshE2eState(request, {
    reducedMotion: true,
    soundEnabled: false,
    experimentEnabled: false
  });
  await mutate(request, "patch", "/api/v1/settings", { onboardingComplete: true });
});

test("empty Today defers charts and route loading preserves navigation", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始今日训练" })).toBeVisible();
  expect(scripts.some((url) => /TodayTrendChart|AreaChart/u.test(url))).toBe(false);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/TrainPage-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/train", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("正在打开页面");
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "选择今天的训练方式" })).toBeVisible();
});

test("optional scopes stay discoverable and a chosen configuration receives focus", async ({
  page
}) => {
  await page.goto("/train");
  await expect(page.getByRole("button", { name: "食指区", exact: true })).toBeHidden();
  await page.locator("summary").filter({ hasText: "练习范围" }).click();
  await page.getByRole("button", { name: "食指区", exact: true }).click();
  await page.locator("summary").filter({ hasText: "练习范围" }).click();
  await expect(page.locator("summary").filter({ hasText: "练习范围" })).toContainText("食指区");
  await page.getByRole("button", { name: /自定义文本 粘贴/u }).click();
  await expect(page.getByRole("heading", { name: "继续本地文本，或导入一份新内容" })).toBeFocused();
  await page.getByRole("button", { name: "关闭自定义文本" }).click();
  await expect(page.getByRole("button", { name: /自定义文本 粘贴/u })).toBeFocused();
  await page.getByRole("button", { name: /^智能课程/u }).click();
  await expect(page).toHaveURL(/scope=/u);
  expect(new URL(page.url()).searchParams.get("scope")).toBe("食指区");
});

test("save remains reachable after navigating to the last settings group", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "目标与算法", exact: true }).click();
  const speed = page.getByRole("slider", { name: "目标速度", exact: true });
  const initialSpeed = Number(await speed.inputValue());
  await speed.press(initialSpeed < 250 ? "ArrowRight" : "ArrowLeft");
  const save = page.getByRole("button", { name: "保存更改", exact: true });
  await page.getByRole("button", { name: "数据与备份", exact: true }).click();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByRole("button", { name: "已保存", exact: true })).toBeVisible();
  const settings = (await (await request.get("/api/v1/bootstrap")).json()) as {
    settings: { targetWpm: number };
  };
  expect(settings.settings.targetWpm).toBe(initialSpeed < 250 ? initialSpeed + 1 : 249);
});

test("game setup and launch are visible before the level catalogue", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/game");
  await expect(page.getByRole("button", { name: "启动新任务" })).toBeInViewport();
  await expect(page.getByRole("group", { name: "难度" })).toBeVisible();
});

test("navigation opens the page top and experiment links reach their settings section", async ({
  page
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "数据与备份", exact: true }).click();
  await expect(page.getByRole("heading", { name: "数据与备份", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把数据变成下一次行动" })).toBeInViewport();
  await page.getByRole("link", { name: "前往实验设置" }).click();
  await expect(page.getByRole("heading", { name: "目标与算法", exact: true })).toBeInViewport();
});

test("a failed page module offers reload and a working home route without developer errors", async ({
  page,
  request
}) => {
  await mutate(request, "patch", "/api/v1/settings", { fontSize: 34 });
  await page.route("**/SettingsPage-*.js", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      headers: { "Cache-Control": "no-store" },
      body: "Page temporarily unavailable"
    })
  );
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "这个页面暂时无法打开" })).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText(/TypeError|assets\/|Hey developer/u);
  await expect(page.getByRole("link", { name: "返回今日", exact: true })).toBeVisible();
  await page.unroute("**/SettingsPage-*.js");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "重新打开页面" }).click()
  ]);
  // Some engines retain a failed module after reload. The existing Today route stays usable.
  await page.getByRole("link", { name: /^(今日|返回今日)$/u }).click();
  await expect(page.getByRole("button", { name: "开始今日训练" })).toBeVisible();
  const bootstrap = (await (await request.get("/api/v1/bootstrap")).json()) as {
    settings: { fontSize: number };
  };
  expect(bootstrap.settings.fontSize).toBe(34);
});
