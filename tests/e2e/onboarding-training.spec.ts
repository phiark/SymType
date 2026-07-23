import { expect, test } from "@playwright/test";

import {
  assertNoPageOverflow,
  bootstrap,
  finishOnboarding,
  mutate,
  resetOnboarding,
  restoreFreshE2eState,
  typeTargetAtPace
} from "./helpers";

test.describe.serial("local-first onboarding and persisted training", () => {
  test("first use explains trust boundaries and persists settings in SQLite", async ({
    page,
    request
  }, testInfo) => {
    await page.addInitScript(() => {
      const probe = { constructed: 0, resumed: 0, oscillators: 0 };
      Object.defineProperty(window, "__symtypeAudioProbe", { value: probe });
      class FakeAudioParam {
        value = 0;
        setValueAtTime(value: number) {
          this.value = value;
        }
        exponentialRampToValueAtTime(value: number) {
          this.value = value;
        }
      }
      class FakeAudioNode {
        connect() {
          return this;
        }
      }
      class FakeGainNode extends FakeAudioNode {
        gain = new FakeAudioParam();
      }
      class FakeOscillatorNode extends FakeAudioNode {
        type: OscillatorType = "sine";
        frequency = new FakeAudioParam();
        start() {}
        stop() {}
      }
      class FakeAudioContext {
        state: AudioContextState = "suspended";
        currentTime = 0;
        destination = new FakeAudioNode();
        constructor() {
          probe.constructed += 1;
        }
        createGain() {
          return new FakeGainNode();
        }
        createOscillator() {
          probe.oscillators += 1;
          return new FakeOscillatorNode();
        }
        resume() {
          probe.resumed += 1;
          this.state = "running";
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: FakeAudioContext
      });
    });
    await resetOnboarding(request);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /为 Symmetric 指法建立/ })).toBeVisible();
    await expect(page.getByText(/本地 SQLite/)).toBeVisible();
    await expect(page.getByText(/不检测真实手指/)).toBeVisible();
    await assertNoPageOverflow(page);
    await expect(page).toHaveScreenshot(`onboarding-${testInfo.project.name}.png`, {
      fullPage: true,
      animations: "disabled"
    });

    await page.getByRole("button", { name: /开始设置/ }).click();
    await page.getByRole("combobox", { name: "主题" }).selectOption("dark");
    await page.getByRole("button", { name: /试听并解锁声音/ }).click();
    await expect(page.getByRole("status")).toContainText("声音已解锁");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __symtypeAudioProbe: { constructed: number; resumed: number; oscillators: number };
              }
            ).__symtypeAudioProbe
        )
      )
      .toMatchObject({ constructed: 1, resumed: 1, oscillators: 1 });
    await page.getByRole("button", { name: /^继续/ }).click();
    await expect(page.getByText(/3–5 分钟基线/)).toBeVisible();
    await page.getByRole("button", { name: "稍后校准" }).click();
    await expect(page.getByRole("button", { name: /开始今日训练/ })).toBeVisible();

    const stored = await bootstrap(request);
    expect(stored.settings.onboardingComplete).toBe(true);
    expect(stored.settings.theme).toBe("dark");
    expect(stored.dataLocation).toContain("symtype.sqlite3");
  });

  test("smart micro-blocks persist, adapt only at boundaries, and survive browser storage clearing", async ({
    page,
    request
  }, testInfo) => {
    // This acceptance path intentionally types five persisted blocks at a realistic pace.
    test.setTimeout(180_000);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { theme: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.clock.install();
    await page.goto(
      "/train/session?mode=smart&duration=5&focus=ct&scope=%E9%A3%9F%E6%8C%87%E5%8C%BA"
    );
    const sessionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
    );
    const firstBlockPromise = page.waitForResponse(
      (response) =>
        response.url().includes("/blocks/next") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /^开始/ }).click();
    const sessionResponse = await sessionResponsePromise;
    const sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;
    let blockResponse = await firstBlockPromise;

    for (let index = 0; index < 5; index += 1) {
      const body = (await blockResponse.json()) as {
        block: { target_text: string; rationale: string; block_index: number };
        adaptiveDebug?: { selectedFeatures: string[] };
      };
      await expect(page.getByText(body.block.rationale)).toBeVisible();
      if (index < 4) {
        const nextBlockPromise = page.waitForResponse(
          (response) =>
            response.url().includes("/blocks/next") && response.request().method() === "POST"
        );
        await typeTargetAtPace(page, body.block.target_text);
        blockResponse = await nextBlockPromise;
      } else {
        const completePromise = page.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/sessions/${sessionId}/complete`)
        );
        await typeTargetAtPace(page, body.block.target_text);
        const completed = await completePromise;
        expect(completed.ok()).toBeTruthy();
      }
    }

    await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
    await expect(page.getByText(/已写入本机 SQLite/)).toBeVisible();
    await expect(page).toHaveScreenshot(`completion-${testInfo.project.name}.png`, {
      fullPage: true,
      animations: "disabled",
      // WPM and consistency are real timing-derived values and may move by a few glyph pixels
      // across engines/runs; keep the same strict 0.1% structural ceiling as the visual matrix.
      maxDiffPixelRatio: 0.001
    });

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/今天练习/).first()).toBeVisible();
    const dashboard = await request.get("/api/v1/dashboard");
    const dashboardBody = (await dashboard.json()) as { today: { characters: number } };
    expect(dashboardBody.today.characters).toBeGreaterThan(0);
    await assertNoPageOverflow(page);
  });

  test("only selected calibration categories are sampled and reported separately", async ({
    page,
    request
  }, testInfo) => {
    await page.clock.install();
    await restoreFreshE2eState(request, {
      onboardingComplete: false,
      calibrationComplete: false
    });
    await page.goto("/");
    await page.getByRole("button", { name: /开始设置/ }).click();
    await page.getByRole("button", { name: /^继续/ }).click();
    for (const skipped of ["常见二元组合", "数字", "大小写"]) {
      await page.getByRole("button", { name: new RegExp(skipped, "u") }).click();
    }
    await page.getByRole("button", { name: "开始基线" }).click();
    await expect(page).toHaveURL(/mode=calibration/u);
    await expect(page).toHaveURL(/calibrationCategories=letters%2Cindex%2Csymbols/u);
    const seededCalibrationUrl = new URL(page.url());
    seededCalibrationUrl.searchParams.set("seed", "424242");
    await page.goto(seededCalibrationUrl.toString());

    const firstBlockPromise = page.waitForResponse(
      (response) =>
        response.url().includes("/blocks/next") && response.request().method() === "POST"
    );
    await page.clock.fastForward(1);
    await page.getByRole("button", { name: /^开始/ }).click();
    let blockResponse = await firstBlockPromise;
    const blockTypes: string[] = [];
    let pacedCharacters = 0;
    for (let index = 0; index < 3; index += 1) {
      const body = (await blockResponse.json()) as {
        block: { target_text: string; block_type: string };
      };
      expect(Array.from(body.block.target_text).length).toBeGreaterThanOrEqual(12);
      expect(Array.from(body.block.target_text).length).toBeLessThanOrEqual(20);
      blockTypes.push(body.block.block_type);
      const nextBlockPromise = page.waitForResponse(
        (response) =>
          response.url().includes("/blocks/next") && response.request().method() === "POST"
      );
      pacedCharacters += Array.from(body.block.target_text).length;
      await typeTargetAtPace(page, body.block.target_text);
      blockResponse = await nextBlockPromise;
    }

    await expect(page.getByRole("heading", { name: "这一轮完成了" })).toHaveCount(0);
    const repeated = (await blockResponse.json()) as {
      block: { target_text: string; block_type: string };
    };
    expect(Array.from(repeated.block.target_text).length).toBeGreaterThanOrEqual(12);
    expect(Array.from(repeated.block.target_text).length).toBeLessThanOrEqual(20);
    blockTypes.push(repeated.block.block_type);
    expect(blockTypes).toEqual([
      "calibration-letters",
      "calibration-index",
      "calibration-symbols",
      "calibration-letters"
    ]);

    const timeProgress = page.getByRole("progressbar", { name: "基线有效活动时间进度" });
    await page.getByRole("button", { name: "暂停" }).click();
    const pausedProgress = await timeProgress.getAttribute("aria-valuenow");
    await page.clock.fastForward("02:00");
    await expect(timeProgress).toHaveAttribute("aria-valuenow", pausedProgress ?? "0");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.clock.fastForward("04:00");

    const completePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/sessions/") &&
        response.url().endsWith("/complete") &&
        response.request().method() === "POST"
    );
    pacedCharacters += Array.from(repeated.block.target_text).length;
    await typeTargetAtPace(page, repeated.block.target_text);
    const completed = await completePromise;
    const completionBody = completed.request().postDataJSON() as { activeMs: number };
    const expectedActiveMs = 4 * 60_000 + pacedCharacters * 120;
    expect(completionBody.activeMs).toBeGreaterThanOrEqual(expectedActiveMs);
    // WebKit scheduling overhead is real active time; keep enough slack for hosted runners while
    // remaining far below the two paused minutes that this assertion is designed to exclude.
    expect(completionBody.activeMs).toBeLessThan(expectedActiveMs + 10_000);
    await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
    await expect(page.getByText("有效活动", { exact: true })).toBeVisible();
    await expect(page.getByText("有效样本", { exact: true })).toBeVisible();
    await expect(page.getByText("节奏稳定性", { exact: true })).toBeVisible();
    await expect(page.getByText("净 WPM", { exact: true })).toHaveCount(0);
    for (const segment of ["字母", "食指边界", "标点 / 符号"]) {
      await expect(page.getByText(segment, { exact: true })).toBeVisible();
    }
    for (const skipped of ["常见二元组合", "数字", "大小写 / Shift"]) {
      await expect(page.getByText(skipped, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(/^\d+ 字符$/u)).toBeVisible();
    await expect(page.getByText(/^建议起点 \d+ WPM$/u)).toBeVisible();
    await expect(page.locator(".calibration-segments strong")).toHaveCount(3);
    await expect(page).toHaveScreenshot(`calibration-${testInfo.project.name}.png`, {
      fullPage: true,
      animations: "disabled",
      // The seed fixes content and layout; browser timing still moves a few IKI-derived digits.
      // Keep the same strict 0.1% structural ceiling used by the ordinary completion capture.
      maxDiffPixelRatio: 0.001
    });
    const stored = await bootstrap(request);
    expect(stored.settings.calibrationComplete).toBe(true);
  });

  test("client routes refresh and settings remain server-backed", async ({ page }) => {
    await finishOnboarding(page);
    for (const route of ["/train", "/test", "/game", "/analytics", "/settings"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      await assertNoPageOverflow(page);
    }
  });
});
