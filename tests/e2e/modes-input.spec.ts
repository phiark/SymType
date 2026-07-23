import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { finishOnboarding, mutate, typeTarget } from "./helpers";

interface ModeCase {
  mode: string;
  query: string;
  expectedKind: "training" | "calibration";
}

interface ExportedDatabase {
  format: "symtype-json-backup";
  data: {
    sessions: Array<{
      id: string;
      kind: string;
      mode: string;
      status: string;
    }>;
    keystroke_events: Array<{
      session_id: string;
      block_id: string | null;
      sequence: number;
      content_mode: string;
    }>;
  };
}

const modes: readonly ModeCase[] = [
  {
    mode: "traditional",
    query: "stage=home&scope=%E5%AD%97%E6%AF%8D%2C%E7%AC%A6%E5%8F%B7&focus=asdfjkl%3B",
    expectedKind: "training"
  },
  { mode: "rescue", query: "focus=ct&label=rescue-ct", expectedKind: "training" },
  { mode: "common-english", query: "", expectedKind: "training" },
  { mode: "pseudowords", query: "", expectedKind: "training" },
  { mode: "data-entry", query: "", expectedKind: "training" },
  { mode: "punctuation", query: "", expectedKind: "training" },
  { mode: "shift", query: "", expectedKind: "training" },
  { mode: "source-code", query: "", expectedKind: "training" },
  { mode: "long-form", query: "", expectedKind: "training" },
  {
    mode: "calibration",
    query: "scope=%E5%AD%97%E6%AF%8D&focus=abcdefghijklmnopqrstuvwxyz",
    expectedKind: "calibration"
  }
] as const;

async function exportedDatabase(request: APIRequestContext): Promise<ExportedDatabase> {
  const response = await request.get("/api/v1/export/json");
  expect(response.ok(), await response.text()).toBeTruthy();
  const exported = (await response.json()) as ExportedDatabase;
  expect(exported.format).toBe("symtype-json-backup");
  return exported;
}

function eventWriteFor(page: Page, sessionId: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/sessions/${sessionId}/events`) &&
      response.request().method() === "POST"
  );
}

test.describe.serial("practice modes and input boundaries", () => {
  test("every built-in practice family completes and persists a real micro-block", async ({
    page,
    request
  }) => {
    test.setTimeout(240_000);
    await finishOnboarding(page);
    for (const modeCase of modes) {
      const query = modeCase.query ? `&${modeCase.query}` : "";
      await page.goto(`/train/session?mode=${modeCase.mode}&duration=2${query}`);
      const sessionPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
      );
      const blockPromise = page.waitForResponse(
        (response) =>
          response.url().includes("/blocks/next") && response.request().method() === "POST"
      );
      await page.getByRole("button", { name: /^开始/ }).click();
      const sessionResponse = await sessionPromise;
      expect(
        sessionResponse.ok(),
        `${modeCase.mode}: ${await sessionResponse.text()}`
      ).toBeTruthy();
      const sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;
      const block = await blockPromise;
      expect(block.ok(), `${modeCase.mode}: ${await block.text()}`).toBeTruthy();
      const payload = (await block.json()) as {
        block: { id: string; block_type: string; target_text: string };
      };
      expect(
        payload.block.target_text.length,
        `${modeCase.mode}: built-in block must contain bounded real content`
      ).toBeGreaterThan(0);
      expect(
        payload.block.target_text.length,
        `${modeCase.mode}: built-in block unexpectedly exceeds the typing surface bound`
      ).toBeLessThanOrEqual(120);
      await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toBeVisible();

      const eventWrite = eventWriteFor(page, sessionId);
      const nextBlock = page.waitForResponse(
        (response) =>
          response.url().includes("/blocks/next") && response.request().method() === "POST"
      );
      await typeTarget(page, payload.block.target_text);
      const persisted = await eventWrite;
      expect(persisted.ok(), `${modeCase.mode}: ${await persisted.text()}`).toBeTruthy();
      expect((await nextBlock).ok()).toBeTruthy();

      const abandon = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/sessions/${sessionId}/abandon`) &&
          response.request().method() === "POST"
      );
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "保存并退出" }).click();
      expect((await abandon).ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/train$/u);

      const exported = await exportedDatabase(request);
      const storedSession = exported.data.sessions.find((session) => session.id === sessionId);
      expect(storedSession, `${modeCase.mode}: session missing from SQLite export`).toMatchObject({
        kind: modeCase.expectedKind,
        mode: modeCase.mode,
        status: "abandoned"
      });
      const storedEvents = exported.data.keystroke_events
        .filter((event) => event.session_id === sessionId)
        .sort((left, right) => left.sequence - right.sequence);
      expect(storedEvents, `${modeCase.mode}: incomplete SQLite event stream`).toHaveLength(
        payload.block.target_text.length
      );
      expect(storedEvents.map((event) => event.sequence)).toEqual(
        Array.from({ length: payload.block.target_text.length }, (_, index) => index)
      );
      expect(new Set(storedEvents.map((event) => event.block_id))).toEqual(
        new Set([payload.block.id])
      );
      expect(new Set(storedEvents.map((event) => event.content_mode))).toEqual(
        new Set([modeCase.mode === "calibration" ? payload.block.block_type : modeCase.mode])
      );
    }
  });

  test("custom text starts from persisted server content and advances at block boundaries", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    const created = await mutate<{ text: { id: string } }>(
      request,
      "post",
      "/api/v1/custom-texts",
      {
        title: "E2E local text",
        content:
          "pineapple local practice text repeats safely across several distinct segments for deterministic browser verification. ".repeat(
            8
          ),
        fileType: "txt",
        includeInModel: false
      }
    );
    await page.goto(
      `/train/session?mode=custom&duration=2&customTextId=${created.text.id}&includeInModel=0`
    );
    const firstBlockPromise = page.waitForResponse((response) =>
      response.url().includes("/blocks/next")
    );
    await page.getByRole("button", { name: /^开始/ }).click();
    const first = (await (await firstBlockPromise).json()) as { block: { target_text: string } };
    const nextBlockPromise = page.waitForResponse((response) =>
      response.url().includes("/blocks/next")
    );
    await typeTarget(page, first.block.target_text);
    const second = (await (await nextBlockPromise).json()) as { block: { target_text: string } };
    expect(second.block.target_text).not.toBe(first.block.target_text);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存并退出" }).click();
  });

  test("weakness rescue exposes a real zone selector and keeps the generated block in scope", async ({
    page
  }) => {
    await finishOnboarding(page);
    await page.goto("/train");
    await page.getByRole("button", { name: /弱点急救/ }).click();
    await page.getByLabel("目标类型").selectOption("zone");
    await page.getByLabel("聚焦目标").selectOption("symbol-zone");
    await page.getByRole("button", { name: /开始急救组/ }).click();
    await expect(page).toHaveURL(/\/train\/session\?mode=rescue/u);
    const blockPromise = page.waitForResponse(
      (response) =>
        response.url().includes("/blocks/next") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /^开始$/u }).click();
    const response = await blockPromise;
    expect(response.ok(), await response.text()).toBeTruthy();
    const target = ((await response.json()) as { block: { target_text: string } }).block
      .target_text;
    const printableTarget = target.replace(/\s/gu, "");
    expect(printableTarget).not.toMatch(/[a-z]/iu);
    expect(printableTarget).toMatch(/[^a-z0-9]/iu);
    await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存并退出" }).click();
  });

  test("wrong key, Backspace correction, Shift, digits, and symbols share the persisted event path", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    const created = await mutate<{ text: { id: string } }>(
      request,
      "post",
      "/api/v1/custom-texts",
      {
        title: "E2E input boundary",
        content:
          "aA1!;: pineapple-safe input boundary text for physical code verification. ".repeat(5),
        fileType: "txt",
        includeInModel: false
      }
    );
    await page.goto(
      `/train/session?mode=custom&duration=2&customTextId=${created.text.id}&includeInModel=0`
    );
    const firstBlockPromise = page.waitForResponse((response) =>
      response.url().includes("/blocks/next")
    );
    await page.getByRole("button", { name: /^开始/ }).click();
    const first = (await (await firstBlockPromise).json()) as { block: { target_text: string } };
    expect(first.block.target_text.startsWith("aA1!;:")).toBeTruthy();
    const surface = page.getByRole("textbox", { name: "打字练习输入区" });
    await surface.focus();
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    const eventWrite = page.waitForResponse(
      (response) => response.url().includes("/events") && response.request().method() === "POST"
    );
    await typeTarget(page, first.block.target_text);
    expect((await eventWrite).ok()).toBeTruthy();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存并退出" }).click();
  });

  test("formal test countdown freezes while paused and resumes afterwards", async ({ page }) => {
    await finishOnboarding(page);
    await page.goto("/test/session?mode=typing-test&seconds=15");
    await page.getByRole("button", { name: /^开始/ }).click();
    await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toBeVisible();
    const timer = page.locator(".practice-context-bar strong");
    await page.getByRole("button", { name: "暂停" }).click();
    await expect(
      page.locator(".typing-toolbar").getByRole("button", { name: "继续" })
    ).toBeVisible();
    const paused = await timer.textContent();
    await page.waitForTimeout(1_200);
    expect(await timer.textContent()).toBe(paused);
    await page.locator(".typing-toolbar").getByRole("button", { name: "继续" }).click();
    await page.waitForTimeout(1_200);
    expect(await timer.textContent()).not.toBe(paused);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存并退出" }).click();
  });

  test("preset and custom test durations route correctly and a 37-second result persists", async ({
    page,
    request
  }) => {
    await page.clock.install();
    await finishOnboarding(page);
    for (const seconds of [15, 30, 60, 120]) {
      await page.goto("/test");
      await page
        .locator(".test-duration-card")
        .filter({ has: page.getByText(String(seconds), { exact: true }) })
        .click();
      await expect(page).toHaveURL(new RegExp(`seconds=${seconds}(?:&|$)`, "u"));
      await expect(page.getByRole("heading", { name: `${seconds} 秒测试` })).toBeVisible();
    }

    await page.goto("/test");
    await page.getByLabel("自定义时长").fill("37");
    await page.locator(".test-custom-card").getByRole("button", { name: "开始" }).click();
    await expect(page).toHaveURL(/seconds=37(?:&|$)/u);
    await expect(page.getByRole("heading", { name: "37 秒测试" })).toBeVisible();

    const blockPromise = page.waitForResponse((response) =>
      response.url().includes("/blocks/next")
    );
    await page.clock.fastForward(1);
    await page.getByRole("button", { name: /^开始/u }).click();
    const first = (await (await blockPromise).json()) as { block: { target_text: string } };
    await typeTarget(page, Array.from(first.block.target_text)[0] ?? "a");
    await page.clock.fastForward(37_500);
    await expect(page.getByRole("heading", { name: "测试完成" })).toBeVisible();

    const testsResponse = await request.get("/api/v1/tests");
    expect(testsResponse.ok(), await testsResponse.text()).toBeTruthy();
    const testsBody = (await testsResponse.json()) as {
      tests: { duration_seconds: number }[];
    };
    expect(testsBody.tests.some((record) => record.duration_seconds === 37)).toBe(true);
  });

  test("a 15-second formal test persists dual accuracy and appears in the local ranking", async ({
    page
  }) => {
    test.setTimeout(40_000);
    await finishOnboarding(page);
    await page.goto("/test/session?mode=typing-test&seconds=15");
    const blockPromise = page.waitForResponse((response) =>
      response.url().includes("/blocks/next")
    );
    await page.getByRole("button", { name: /^开始/ }).click();
    const first = (await (await blockPromise).json()) as { block: { target_text: string } };
    const surface = page.getByRole("textbox", { name: "打字练习输入区" });
    await surface.focus();
    await page.keyboard.type(first.block.target_text.startsWith("x") ? "q" : "x");
    await page.keyboard.press("Backspace");
    await typeTarget(page, first.block.target_text);
    await expect(page.getByRole("heading", { name: "测试完成" })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText("击键准确率", { exact: true })).toBeVisible();
    await expect(page.getByText(/^最终文本准确率 \d+(?:\.\d+)?%$/u)).toBeVisible();
    await page.getByLabel("主观难度").selectOption("4");
    await page.getByLabel("疲劳感").selectOption("3");
    await page.getByRole("button", { name: "保存感受" }).click();
    await expect(page.getByText(/已写入本机 SQLite，可用于两周交叉策略报告/u)).toBeVisible();
    await page.getByRole("button", { name: /^完成/ }).click();
    await expect(page).toHaveURL(/\/test$/u);
    await expect(page.getByRole("heading", { name: "只和自己的历史比较" })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText("% /");
    await page
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: /1 次.*查看/u })
      .click();
    await expect(page.getByText("本次测试错误证据")).toBeVisible();
    await expect(page.getByText(/只显示 SymType 训练区里的目标/u)).toBeVisible();
  });
});
