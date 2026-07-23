import { readFile } from "node:fs/promises";

import { expect, test, type Download } from "@playwright/test";

import {
  assertNoPageOverflow,
  bootstrap,
  finishOnboarding,
  mutate,
  restoreFreshE2eState,
  typeTarget
} from "./helpers";

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  expect(path, "local Playwright download path").not.toBeNull();
  return readFile(path ?? "");
}

test("analytics, mapping, backup, theme, and custom text controls are live", async ({
  page,
  request
}, testInfo) => {
  await restoreFreshE2eState(request);
  await finishOnboarding(page);
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "把数据变成下一次行动" })).toBeVisible();
  await expect(page.getByText(/键盘热力图/)).toBeVisible();
  await assertNoPageOverflow(page);
  await expect(page).toHaveScreenshot(`analytics-${testInfo.project.name}.png`, {
    fullPage: true,
    animations: "disabled"
  });

  await page.goto("/settings");
  await page.getByRole("searchbox", { name: "搜索设置" }).fill("声音");
  await expect(page.getByRole("heading", { name: "声音" })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索设置" }).fill("");
  await page.getByRole("button", { name: /键盘映射/ }).click();
  await expect(page.getByText(/Symmetric（默认）/)).toBeVisible();
  await page.getByRole("button", { name: "复制当前预设后编辑" }).click();
  await expect(
    page.getByRole("button", { name: /关闭通知：已复制为可编辑的自定义映射/u })
  ).toBeVisible();
  const keyCFinger = page.getByRole("combobox", { name: "KeyC 的建议手指" });
  const nextFinger =
    (await keyCFinger.inputValue()) === "right-index" ? "left-index" : "right-index";
  await keyCFinger.selectOption(nextFinger);
  await page.getByRole("button", { name: "保存逐键映射" }).click();
  await expect(page.getByRole("button", { name: /关闭通知：自定义映射内容已保存/u })).toBeVisible();
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /关闭通知：设置与目标已在一个 SQLite 事务中保存/u })
  ).toBeVisible();
  const savedBootstrap = (await (await request.get("/api/v1/bootstrap")).json()) as {
    settings: { activeLayoutId: string };
    layouts: Array<{
      id: string;
      mappings: Array<{ physical_code: string; hand: string; finger: string; zone: string }>;
    }>;
  };
  const activeLayout = savedBootstrap.layouts.find(
    (layout) => layout.id === savedBootstrap.settings.activeLayoutId
  );
  expect(activeLayout?.mappings.find((mapping) => mapping.physical_code === "KeyC")).toMatchObject({
    hand: nextFinger.startsWith("right-") ? "right" : "left",
    finger: nextFinger,
    zone: nextFinger
  });
  await page.getByRole("button", { name: /数据与备份/ }).click();
  const dataSection = page.locator("#settings-data");
  await dataSection.evaluate((section) =>
    section.scrollIntoView({ behavior: "instant", block: "start" })
  );
  await expect(dataSection).toBeInViewport();
  const backupResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/backups") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /创建 SQLite 快照/ }).click();
  const createdBackup = await backupResponse;
  expect(createdBackup.ok(), await createdBackup.text()).toBeTruthy();
  await expect(
    page.getByRole("button", { name: /关闭通知：已创建并轮转本机 SQLite 备份/u })
  ).toBeVisible();
  const sqliteDownload = page.waitForEvent("download");
  await page.getByText("下载 SQLite 备份", { exact: true }).click();
  const downloaded = await sqliteDownload;
  expect(downloaded.suggestedFilename()).toMatch(/\.sqlite3$/u);
  await assertNoPageOverflow(page);

  await page.goto("/train");
  await page.getByRole("button", { name: /自定义文本/ }).click();
  await expect(page.getByRole("heading", { name: "继续本地文本，或导入一份新内容" })).toBeVisible();
  await expect(page.getByText(/不要输入真实密码/)).toBeVisible();
});

test("populated analytics reconciles real events, errors, features, groups, and experiment evidence", async ({
  page,
  request
}) => {
  test.setTimeout(90_000);
  await restoreFreshE2eState(request, {
    experimentEnabled: true,
    keyboardVisible: false,
    soundEnabled: false,
    stopOnError: false
  });

  await page.goto("/train/session?mode=smart&duration=0.25&focus=ct&seed=41024");
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
  );
  let blockResponse = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /^开始/ }).click();
  const sessionId = ((await (await sessionResponse).json()) as { session: { id: string } }).session
    .id;
  let wrongTarget = "";
  let wrongActual = "";

  for (let index = 0; index < 4; index += 1) {
    const block = (await (await blockResponse).json()) as { block: { target_text: string } };
    const next =
      index < 3
        ? page.waitForResponse(
            (response) =>
              response.url().includes("/blocks/next") && response.request().method() === "POST"
          )
        : page.waitForResponse(
            (response) =>
              response.url().endsWith(`/api/v1/sessions/${sessionId}/complete`) &&
              response.request().method() === "POST"
          );
    if (index === 0) {
      wrongTarget = block.block.target_text[0] ?? "";
      wrongActual = wrongTarget.toLowerCase() === "q" ? "p" : "q";
      const surface = page.getByRole("textbox", { name: "打字练习输入区" });
      await surface.focus();
      await page.keyboard.press(wrongActual === "q" ? "KeyQ" : "KeyP");
      await page.keyboard.press("Backspace");
    }
    await typeTarget(page, block.block.target_text);
    const persisted = await next;
    expect(persisted.ok(), await persisted.text()).toBeTruthy();
    if (index < 3) blockResponse = Promise.resolve(persisted);
  }

  await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
  const statisticsResponse = await request.get("/api/v1/statistics?period=7d");
  expect(statisticsResponse.ok(), await statisticsResponse.text()).toBeTruthy();
  const statistics = (await statisticsResponse.json()) as {
    overview: { sessions: number; characters: number; errors: number };
    trend: Array<{ kind: string }>;
    features: Array<{ feature_type: string }>;
    confusion: Array<{ target_char: string; actual_char: string; count: number }>;
    groups: unknown[];
    recentErrors: unknown[];
    experiment: { enabled: boolean; eligibleForComparison: boolean; conclusion: string };
  };
  expect(statistics.overview.sessions).toBe(1);
  expect(statistics.overview.characters).toBeGreaterThan(80);
  expect(statistics.overview.errors).toBe(1);
  expect(statistics.trend).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "training" })])
  );
  for (const featureType of ["key", "bigram", "trigram", "finger", "zone", "class"]) {
    expect(statistics.features.some((feature) => feature.feature_type === featureType)).toBe(true);
  }
  expect(statistics.confusion).toContainEqual({
    target_char: wrongTarget,
    actual_char: wrongActual,
    count: 1
  });
  expect(statistics.groups.length).toBeGreaterThan(0);
  expect(statistics.recentErrors.length).toBe(1);
  expect(statistics.experiment).toMatchObject({
    enabled: true,
    eligibleForComparison: false
  });
  expect(statistics.experiment.conclusion).toMatch(/样本|结论/u);

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "把数据变成下一次行动" })).toBeVisible();
  const characterCard = page.getByText("字符", { exact: true }).locator("..");
  await expect(characterCard).toContainText(statistics.overview.characters.toLocaleString());
  await expect(characterCard).toContainText("1 次错误");
  await expect(page.getByText(/1 个训练数据点/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "实际输入 → 目标输入" })).toBeVisible();
  await expect(page.getByText(wrongActual, { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "手、手指、行、区域与 Shift" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "只显示训练上下文" })).toBeVisible();
  await expect(page.getByText(`应为`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "训练算法实验" })).toBeVisible();
  await expect(page.getByText("尚无结论", { exact: true }).first()).toBeVisible();

  for (const label of ["按键", "二元组合", "三元组合", "映射指区", "键区", "字符类别"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("table").last()).toBeVisible();
  }
  await assertNoPageOverflow(page);
});

test("typing appearance and motion settings remain server-backed and drive the live surface", async ({
  page,
  request
}) => {
  await finishOnboarding(page);
  await page.goto("/settings");
  await page.locator("#settings-appearance select").first().selectOption("dark");
  const reducedMotion = page.getByRole("switch", { name: "减少动态效果" });
  if ((await reducedMotion.getAttribute("aria-checked")) !== "true") await reducedMotion.click();
  const keyboard = page.getByRole("switch", { name: "显示虚拟键盘" });
  if ((await keyboard.getAttribute("aria-checked")) !== "false") await keyboard.click();
  await page.getByRole("slider", { name: "训练字号" }).fill("41");
  await page.getByRole("slider", { name: "训练行距" }).fill("1.9");
  await page.getByRole("combobox", { name: "光标样式" }).selectOption("underline");
  const smoothScroll = page.getByRole("switch", { name: "平滑滚动" });
  if ((await smoothScroll.getAttribute("aria-checked")) !== "false") await smoothScroll.click();
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /关闭通知：设置与目标已在一个 SQLite 事务中保存/u })
  ).toBeVisible();

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("switch", { name: "减少动态效果" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(page.getByRole("switch", { name: "显示虚拟键盘" })).toHaveAttribute(
    "aria-checked",
    "false"
  );
  await expect(page.getByRole("slider", { name: "训练字号" })).toHaveValue("41");
  await expect(page.getByRole("slider", { name: "训练行距" })).toHaveValue("1.9");
  await expect(page.getByRole("combobox", { name: "光标样式" })).toHaveValue("underline");
  await expect(page.getByRole("switch", { name: "平滑滚动" })).toHaveAttribute(
    "aria-checked",
    "false"
  );
  const stored = await bootstrap(request);
  expect(stored.settings).toMatchObject({
    theme: "dark",
    reducedMotion: true,
    keyboardVisible: false,
    fontSize: 41,
    lineHeight: 1.9,
    caretStyle: "underline",
    smoothScroll: false
  });

  await page.goto("/train/session?mode=smart&duration=0.1&seed=5841");
  await page.getByRole("button", { name: /^开始/u }).click();
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute("data-caret", "underline");
  expect(
    await surface.evaluate((element) => ({
      fontSize: element.style.fontSize,
      lineHeight: element.style.lineHeight,
      scrollBehavior: element.style.scrollBehavior
    }))
  ).toEqual({ fontSize: "41px", lineHeight: "1.9", scrollBehavior: "auto" });
  await expect(page.locator(".virtual-keyboard")).toHaveCount(0);
});

test("system theme follows the browser color scheme while the server keeps system authority", async ({
  page,
  request
}) => {
  await restoreFreshE2eState(request, { theme: "system" });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  const darkBackground = await page
    .locator("html")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--bg"));
  expect(darkBackground).not.toBe("");
  const switchThumb = page.locator(".switch span").first();
  expect(
    await switchThumb.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration)
    )
  ).toBeLessThanOrEqual(0.001);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) => getComputedStyle(element).getPropertyValue("--bg"))
    )
    .not.toBe(darkBackground);
  await expect
    .poll(() =>
      switchThumb.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration)
      )
    )
    .toBeGreaterThan(0.01);
  expect((await bootstrap(request)).settings).toMatchObject({
    theme: "system",
    reducedMotion: false
  });
});

test("data controls export real files and restore a validated JSON backup with a safety snapshot", async ({
  page,
  request
}) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await finishOnboarding(page);
  await mutate(request, "patch", "/api/v1/settings", { theme: "light" });

  await page.goto("/test/session?mode=typing-test&seconds=15");
  const blockPromise = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.clock.fastForward(1);
  await page.getByRole("button", { name: /^开始/u }).click();
  const blockResponse = await blockPromise;
  expect(blockResponse.ok(), await blockResponse.text()).toBeTruthy();
  const block = (await blockResponse.json()) as { block: { target_text: string } };
  await typeTarget(page, Array.from(block.block.target_text)[0] ?? "a");
  await page.clock.fastForward(15_500);
  await expect(page.getByRole("heading", { name: "测试完成" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /数据与备份/ }).click();

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByText("导出 CSV", { exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^symtype-sessions-\d{4}-\d{2}-\d{2}\.csv$/u);
  const csv = (await downloadedBytes(csvDownload)).toString("utf8").replace(/^\uFEFF/u, "");
  expect(csv).toContain(
    "kind,mode,started_at,completed_at,active_ms,raw_wpm,net_wpm,accuracy,consistency,characters"
  );
  expect(csv).toContain('"test","typing-test"');

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByText("导出完整 JSON", { exact: true }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/^symtype-\d{4}-\d{2}-\d{2}\.json$/u);
  const jsonBytes = await downloadedBytes(jsonDownload);
  const exported = JSON.parse(jsonBytes.toString("utf8")) as {
    format: string;
    schemaVersion: number;
    algorithmVersion: string;
    data: {
      settings: Array<{ value_json: string }>;
      sessions: Array<{ kind: string; mode: string; status: string }>;
      keystroke_events: unknown[];
    };
  };
  expect(exported).toMatchObject({
    format: "symtype-json-backup",
    schemaVersion: expect.any(Number),
    algorithmVersion: expect.any(String)
  });
  expect(exported.data.sessions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "test", mode: "typing-test", status: "completed" })
    ])
  );
  expect(exported.data.keystroke_events.length).toBeGreaterThan(0);
  expect(JSON.parse(exported.data.settings[0]?.value_json ?? "{}")).toMatchObject({
    theme: "light"
  });

  const sqliteDownloadPromise = page.waitForEvent("download");
  await page.getByText("下载 SQLite 备份", { exact: true }).click();
  const sqliteDownload = await sqliteDownloadPromise;
  expect(sqliteDownload.suggestedFilename()).toMatch(/\.sqlite3$/u);
  const sqlite = await downloadedBytes(sqliteDownload);
  expect(sqlite.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");

  const restoreInput = page.locator('#settings-data input[type="file"]');
  await restoreInput.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{")
  });
  await expect(
    page.getByRole("button", {
      name: /无法读取 JSON 备份：文件内容不是有效 JSON。当前数据库未更改。/u
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "自动备份当前库并恢复" })).toHaveCount(0);

  await restoreInput.setInputFiles({
    name: "symtype-valid.json",
    mimeType: "application/json",
    buffer: jsonBytes
  });
  await expect(page.getByText("恢复摘要", { exact: true })).toBeVisible();
  await expect(page.getByText(/个 profile.*次 session.*个事件/u)).toBeVisible();

  await mutate(request, "patch", "/api/v1/settings", { theme: "dark" });
  expect((await bootstrap(request)).settings).toMatchObject({ theme: "dark" });

  page.once("dialog", (dialog) => void dialog.accept());
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "自动备份当前库并恢复" }).click()
  ]);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect((await bootstrap(request)).settings).toMatchObject({ theme: "light" });

  const backupsResponse = await request.get("/api/v1/backups");
  expect(backupsResponse.ok(), await backupsResponse.text()).toBeTruthy();
  const backups = (await backupsResponse.json()) as { backups: Array<{ reason: string }> };
  expect(backups.backups.some((backup) => backup.reason === "pre-restore")).toBe(true);
});
