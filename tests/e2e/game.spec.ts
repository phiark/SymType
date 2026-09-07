import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { audioProbe, finishOnboarding, installAudioProbe, mutate, typeTarget } from "./helpers";

interface RunResponse {
  run: {
    id: string;
    current_level: number;
    mode: "campaign" | "hardcore";
    difficulty: "standard" | "hard" | "adaptive";
    status: string;
    score: number;
    alert_value: number;
    levels: Array<{
      level_number: number;
      attempt_number: number;
      status: string;
      score: number;
      alert_value: number;
      summary_json: string | null;
    }>;
  };
}

interface GameBlock {
  id: string;
  block_type: string;
  target_text: string;
}

interface GameResponse extends RunResponse {
  level: {
    id: string;
    stages: Array<{
      stage: 1 | 2 | 3;
      targets: Array<{ text: string }>;
    }>;
  };
  plan: {
    tuning: {
      timeLimitSeconds: number;
      requiredKeystrokeAccuracy: number;
      targetCountPerStage: number;
    };
    stages: Array<{
      stage: 1 | 2 | 3;
      title: string;
      targets: Array<{ text: string }>;
    }>;
  };
}

async function readRun(request: APIRequestContext, runId: string): Promise<GameResponse> {
  const response = await request.get(`/api/v1/game/runs/${runId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as GameResponse;
}

function latestAttempt(run: RunResponse["run"], level: number) {
  return run.levels
    .filter((attempt) => attempt.level_number === level)
    .sort((left, right) => right.attempt_number - left.attempt_number)[0];
}

function expectAuthoredStageBlock(
  response: GameResponse,
  block: GameBlock,
  stage: 1 | 2 | 3
): void {
  expect(block.block_type).toBe(`game-stage-${stage}`);
  const authoredTargets = new Set(
    response.level.stages
      .find((candidate) => candidate.stage === stage)
      ?.targets.map(({ text }) => text)
  );
  const actualTargets = block.target_text.split("\n");
  expect(actualTargets).toHaveLength(response.plan.tuning.targetCountPerStage);
  expect(authoredTargets.size).toBeGreaterThan(0);
  for (const target of actualTargets) expect(authoredTargets).toContain(target);
}

async function expectResetHud(page: Page, level: number): Promise<void> {
  await expect(page.getByText(`LEVEL ${level}/6 · STAGE 1/3`, { exact: true })).toBeVisible();
  await expect(page.getByText("本轮分数 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "游戏警戒值" })).toHaveAttribute(
    "aria-valuenow",
    "0"
  );
}

async function beginLevel(page: Page, buttonName: RegExp): Promise<GameBlock> {
  const blockPromise = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: buttonName }).click();
  const response = await blockPromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { block: GameBlock };
  await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toBeVisible();
  return body.block;
}

async function completeLevel(
  page: Page,
  buttonName: RegExp,
  afterBegin?: () => Promise<void>
): Promise<void> {
  let target = (await beginLevel(page, buttonName)).target_text;
  await afterBegin?.();
  for (let stage = 1; stage <= 3; stage += 1) {
    if (stage < 3) {
      const nextBlock = page.waitForResponse(
        (response) =>
          response.url().includes("/blocks/next") && response.request().method() === "POST"
      );
      await typeTarget(page, target);
      const response = await nextBlock;
      expect(response.ok(), await response.text()).toBeTruthy();
      target = ((await response.json()) as { block: { target_text: string } }).block.target_text;
      await expect(page.getByText(new RegExp(`STAGE ${stage + 1}/3`))).toBeVisible();
    } else {
      await typeTarget(page, target);
    }
  }
}

async function failLevelAtStage(
  page: Page,
  buttonName: RegExp,
  failureStage: 1 | 2 | 3
): Promise<Response> {
  let target = (await beginLevel(page, buttonName)).target_text;
  for (let stage = 1; stage < failureStage; stage += 1) {
    const nextBlock = page.waitForResponse(
      (response) =>
        response.url().includes("/blocks/next") && response.request().method() === "POST"
    );
    await typeTarget(page, target);
    const response = await nextBlock;
    expect(response.ok(), await response.text()).toBeTruthy();
    target = ((await response.json()) as { block: { target_text: string } }).block.target_text;
  }
  const result = page.waitForResponse(
    (response) => response.url().includes("/level-result") && response.request().method() === "POST"
  );
  await page
    .getByRole("textbox", { name: "打字练习输入区" })
    .pressSequentially(definitelyWrongText(target));
  const response = await result;
  expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}

async function completeLevelWithAccuracyErrors(page: Page): Promise<Response> {
  let block = await beginLevel(page, /开始关卡/);
  for (const [index, errors] of [2, 2, 1].entries()) {
    const target = block.target_text;
    await typeTarget(page, definitelyWrongText(target).slice(0, errors));
    const isFinal = index === 2;
    const boundary = page.waitForResponse((response) =>
      isFinal
        ? response.url().includes("/level-result") && response.request().method() === "POST"
        : response.url().includes("/blocks/next") && response.request().method() === "POST"
    );
    await typeTarget(page, target.slice(errors));
    const response = await boundary;
    expect(response.ok(), await response.text()).toBeTruthy();
    if (!isFinal) {
      block = ((await response.json()) as { block: GameBlock }).block;
    } else {
      return response;
    }
  }
  throw new Error("Accuracy-gate scenario did not reach its final stage");
}

function definitelyWrongText(target: string): string {
  return [...target]
    .slice(0, 24)
    .map((character) => (character.toLowerCase() === "x" ? "q" : "x"))
    .join("");
}

test.describe.serial("Pineapple Breach state and UI", () => {
  test("Standard, Hard, and Adaptive start with their real deterministic stage content", async ({
    page,
    request
  }) => {
    test.setTimeout(90_000);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });

    for (const difficulty of ["standard", "hard", "adaptive"] as const) {
      await page.goto("/game");
      await page
        .getByRole("group", { name: "难度" })
        .getByRole("button", {
          name: difficulty === "standard" ? "Standard" : difficulty === "hard" ? "Hard" : "Adaptive"
        })
        .click();
      const runPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/game/runs") && response.request().method() === "POST"
      );
      await page.getByRole("button", { name: /启动新任务/ }).click();
      const created = (await (await runPromise).json()) as RunResponse;
      expect(created.run).toMatchObject({ difficulty, mode: "campaign", current_level: 1 });
      const authoritative = await readRun(request, created.run.id);
      const first = await beginLevel(page, /开始关卡/);
      expectAuthoredStageBlock(authoritative, first, 1);

      const nextBlock = page.waitForResponse(
        (response) =>
          response.url().includes("/blocks/next") && response.request().method() === "POST"
      );
      await typeTarget(page, first.target_text);
      const secondResponse = await nextBlock;
      expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
      const second = ((await secondResponse.json()) as { block: GameBlock }).block;
      expectAuthoredStageBlock(authoritative, second, 2);
      await expect(page.getByText("LEVEL 1/6 · STAGE 2/3", { exact: true })).toBeVisible();

      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "保存并退出" }).click();
      await expect(page).toHaveURL(new RegExp(`/game\\?resume=${created.run.id}$`, "u"));
    }
  });

  test("all six fictional levels can be completed through the typing UI", async ({
    page,
    request
  }) => {
    test.setTimeout(180_000);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });
    const testsBeforeResponse = await request.get("/api/v1/tests");
    expect(testsBeforeResponse.ok(), await testsBeforeResponse.text()).toBeTruthy();
    const testsBefore = (await testsBeforeResponse.json()) as {
      tests: Array<{ id: string; session_id: string }>;
    };
    const statisticsBeforeResponse = await request.get("/api/v1/statistics?period=all");
    expect(statisticsBeforeResponse.ok(), await statisticsBeforeResponse.text()).toBeTruthy();
    const statisticsBefore = (await statisticsBeforeResponse.json()) as {
      overview: { sessions: number; characters: number };
      trend: Array<{ kind: string; character_count: number }>;
    };
    await page.goto("/game");
    const runPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/game/runs") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    const created = (await (await runPromise).json()) as RunResponse;
    const runId = created.run.id;

    for (let level = 1; level <= 6; level += 1) {
      const state = await request.get(`/api/v1/game/runs/${runId}`);
      const stateBody = (await state.json()) as { run: { current_level: number } };
      expect(stateBody.run.current_level).toBe(level);
      await completeLevel(page, level === 1 ? /开始关卡/ : /进入下一关/);
      if (level < 6)
        await expect(page.getByRole("heading", { name: /阶段同步完成/ })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /PINEAPPLE VAULT/ })).toBeVisible();
    await expect(page.getByText(/游戏数据保持 game 标签/)).toBeVisible();

    const progressResponse = await request.get("/api/v1/game/progress");
    expect(progressResponse.ok(), await progressResponse.text()).toBeTruthy();
    const progress = (await progressResponse.json()) as {
      completedLevels: number[];
      personalBests: Array<{ level: number; score: number }>;
      achievements: Array<{ achievement_id: string }>;
      runs: Array<{ id: string; status: string; personal_best: 0 | 1; score: number }>;
      personalBest: number | null;
    };
    expect(progress.completedLevels).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress.personalBests.map(({ level }) => level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress.achievements.map(({ achievement_id }) => achievement_id)).toEqual(
      expect.arrayContaining(["first-fiction-breach", "error-free-level"])
    );
    const completedRun = progress.runs.find((run) => run.id === runId);
    expect(completedRun).toMatchObject({ status: "completed" });
    expect(completedRun?.score).toBeGreaterThan(0);
    expect(progress.personalBest).toBe(
      Math.max(...progress.runs.filter((run) => run.status === "completed").map((run) => run.score))
    );

    const testsAfterResponse = await request.get("/api/v1/tests");
    expect(testsAfterResponse.ok(), await testsAfterResponse.text()).toBeTruthy();
    const testsAfter = (await testsAfterResponse.json()) as typeof testsBefore;
    expect(testsAfter.tests).toEqual(testsBefore.tests);
    const statisticsAfterResponse = await request.get("/api/v1/statistics?period=all");
    expect(statisticsAfterResponse.ok(), await statisticsAfterResponse.text()).toBeTruthy();
    const statisticsAfter = (await statisticsAfterResponse.json()) as {
      overview: { sessions: number; characters: number };
      trend: Array<{ kind: string; character_count: number }>;
    };
    expect(statisticsAfter.overview.sessions).toBe(statisticsBefore.overview.sessions + 6);
    expect(statisticsAfter.overview.characters).toBeGreaterThan(
      statisticsBefore.overview.characters
    );
    const gameCharactersBefore = statisticsBefore.trend
      .filter(({ kind }) => kind === "game")
      .reduce((sum, entry) => sum + entry.character_count, 0);
    const gameCharactersAfter = statisticsAfter.trend
      .filter(({ kind }) => kind === "game")
      .reduce((sum, entry) => sum + entry.character_count, 0);
    expect(gameCharactersAfter - gameCharactersBefore).toBe(
      statisticsAfter.overview.characters - statisticsBefore.overview.characters
    );

    await page.goto("/analytics");
    const gameFilter = page.getByRole("button", { name: "游戏", exact: true });
    await gameFilter.click();
    await expect(gameFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".analytics-trend .chart-summary")).toContainText(
      /\d+ 个游戏数据点/u
    );

    await page.goto("/test");
    await expect(page.locator(".metric-card").filter({ hasText: "正式测试次数" })).toContainText(
      String(testsBefore.tests.length)
    );

    await page.goto("/game");
    await expect(
      page.getByLabel("六关解锁状态").locator('article[data-state="complete"]')
    ).toHaveCount(6);
    await expect(page.getByText("首次通关", { exact: true })).toBeVisible();
    await expect(page.getByText("无错通关", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`完整 Run 最高 ${progress.personalBest?.toLocaleString()} 分`, { exact: true })
    ).toBeVisible();
  });

  test("Campaign failure at every level resets that whole level, then allows a clean retry", async ({
    page,
    request
  }) => {
    test.setTimeout(240_000);
    await installAudioProbe(page);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", {
      stopOnError: false,
      soundEnabled: true,
      soundMode: "all",
      soundTheme: "terminal",
      volume: 0.4
    });
    await page.reload();
    await page.goto("/game");
    const runPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/game/runs")
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    const created = (await (await runPromise).json()) as RunResponse;

    for (let level = 1; level <= 6; level += 1) {
      const failureStage = (((level - 1) % 3) + 1) as 1 | 2 | 3;
      await failLevelAtStage(page, level === 1 ? /开始关卡/ : /进入下一关/, failureStage);
      await expect(page.getByRole("heading", { name: "信号被切断" })).toBeVisible();
      await expect(page.getByText(new RegExp(`第 ${level} 关从阶段 1`))).toBeVisible();
      const failedState = await readRun(request, created.run.id);
      expect(failedState.run).toMatchObject({ current_level: level, alert_value: 0 });
      expect(latestAttempt(failedState.run, level)).toMatchObject({
        status: "active",
        score: 0,
        alert_value: 0
      });

      await completeLevel(page, /从规则指定位置重开/, () => expectResetHud(page, level));
      if (level < 6) {
        await expect(page.getByRole("heading", { name: /阶段同步完成/ })).toBeVisible();
      }
    }
    await expect(page.getByRole("heading", { name: /PINEAPPLE VAULT/ })).toBeVisible();
    const sounds = await audioProbe(page);
    expect(sounds.constructed).toBe(1);
    expect(sounds.resumed).toBe(1);
    expect(sounds.played).toEqual(
      expect.arrayContaining([
        { frequency: 230, wave: "square" },
        { frequency: 1280, wave: "square" }
      ])
    );
  });

  test("Hardcore failure at every level resets the entire run to level 1", async ({
    page,
    request
  }) => {
    test.setTimeout(360_000);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });
    await page.goto("/game");
    await page.getByRole("button", { name: "Hardcore Run" }).click();
    const runPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/game/runs")
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    const created = (await (await runPromise).json()) as RunResponse;

    for (let failureLevel = 1; failureLevel <= 6; failureLevel += 1) {
      const restartButton = failureLevel === 1 ? /开始关卡/ : /从规则指定位置重开/;
      for (let level = 1; level < failureLevel; level += 1) {
        await completeLevel(page, level === 1 ? restartButton : /进入下一关/);
        await expect(page.getByRole("heading", { name: /阶段同步完成/ })).toBeVisible();
      }
      await failLevelAtStage(
        page,
        failureLevel === 1 ? restartButton : /进入下一关/,
        (((failureLevel - 1) % 3) + 1) as 1 | 2 | 3
      );
      await expect(page.getByRole("heading", { name: "信号被切断" })).toBeVisible();
      await expect(page.getByText(/整个任务回到第 1 关/)).toBeVisible();
      const state = await readRun(request, created.run.id);
      expect(state.run).toMatchObject({ current_level: 1, score: 0, alert_value: 0 });
      expect(latestAttempt(state.run, 1)).toMatchObject({
        status: "active",
        score: 0,
        alert_value: 0
      });
      const failedLevel = state.run.levels
        .filter((attempt) => attempt.level_number === failureLevel && attempt.status === "failure")
        .at(-1);
      expect(failedLevel).toBeDefined();
    }
  });

  test("timeout failure is committed by the real monotonic countdown and resets Campaign", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });
    await page.clock.install({ time: new Date("2026-07-21T12:00:00Z") });
    await page.goto("/game");
    const runPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/game/runs")
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    const created = (await (await runPromise).json()) as RunResponse;
    const authoritative = await readRun(request, created.run.id);
    await beginLevel(page, /开始关卡/);

    const resultPromise = page.waitForResponse(
      (response) =>
        response.url().includes("/level-result") && response.request().method() === "POST"
    );
    await page.clock.runFor((authoritative.plan.tuning.timeLimitSeconds + 1) * 1000);
    const result = await resultPromise;
    expect(result.ok(), await result.text()).toBeTruthy();
    expect(result.request().postDataJSON()).toMatchObject({
      outcome: "failure",
      failureReason: "timeout"
    });
    await expect(page.getByRole("heading", { name: "信号被切断" })).toBeVisible();
    await expect(page.getByText(/倒计时归零/u)).toBeVisible();

    const state = await readRun(request, created.run.id);
    expect(state.run).toMatchObject({ current_level: 1, alert_value: 0 });
    const failed = state.run.levels.find((attempt) => attempt.status === "failure");
    expect(JSON.parse(failed?.summary_json ?? "{}")).toMatchObject({ failureReason: "timeout" });
    expect(latestAttempt(state.run, 1)).toMatchObject({
      status: "active",
      score: 0,
      alert_value: 0
    });
  });

  test("three completed stages below the accuracy floor fail through the accuracy gate", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });
    await page.goto("/game");
    const runPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/game/runs")
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    const created = (await (await runPromise).json()) as RunResponse;

    const result = await completeLevelWithAccuracyErrors(page);
    expect(result.request().postDataJSON()).toMatchObject({
      outcome: "failure",
      failureReason: "accuracy-gate"
    });
    await expect(page.getByRole("heading", { name: "信号被切断" })).toBeVisible();
    await expect(page.getByText(/三阶段击键准确率未达到/u)).toBeVisible();
    const state = await readRun(request, created.run.id);
    const failed = state.run.levels.find((attempt) => attempt.status === "failure");
    expect(JSON.parse(failed?.summary_json ?? "{}")).toMatchObject({
      failureReason: "accuracy-gate"
    });
    expect(latestAttempt(state.run, 1)).toMatchObject({
      status: "active",
      score: 0,
      alert_value: 0
    });
  });

  test("blur pause and manual resume preserve the monotonic countdown deadline", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", { stopOnError: false });
    await page.clock.install({ time: new Date("2026-07-21T12:00:00Z") });
    await page.goto("/game");
    const runPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/game/runs")
    );
    await page.getByRole("button", { name: /启动新任务/ }).click();
    await runPromise;
    await beginLevel(page, /开始关卡/);
    const timer = page.locator(".game-timer");
    const initial = Number.parseInt((await timer.textContent()) ?? "", 10);
    await page.clock.runFor(2_100);
    const beforePause = Number.parseInt((await timer.textContent()) ?? "", 10);
    expect(beforePause).toBeLessThan(initial);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByText(/游戏已暂停/)).toBeVisible();
    const pauseDialog = page.getByRole("dialog", { name: "训练已暂停" });
    await expect(pauseDialog.getByRole("button", { name: "退出" })).toBeVisible();
    const pausedAt = await timer.textContent();
    await page.clock.runFor(5_000);
    expect(await timer.textContent()).toBe(pausedAt);
    await pauseDialog.getByRole("button", { name: "退出" }).click();
    const exitDialog = page.getByRole("dialog", { name: "退出当前关卡？" });
    await expect(exitDialog).toBeVisible();
    await exitDialog.getByRole("button", { name: "继续本关" }).click();
    await expect(pauseDialog).toBeVisible();
    await pauseDialog.getByRole("button", { name: "继续训练" }).click();
    await expect(page.getByText(/游戏已暂停/)).toHaveCount(0);
    await page.clock.runFor(1_100);
    const afterResume = Number.parseInt((await timer.textContent()) ?? "", 10);
    const pausedSeconds = Number.parseInt(pausedAt ?? "", 10);
    expect(afterResume).toBeLessThan(pausedSeconds);
    expect(afterResume).toBeGreaterThanOrEqual(pausedSeconds - 2);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存并退出" }).click();
  });
});
