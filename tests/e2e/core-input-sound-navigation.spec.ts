import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { getBindingForCharacter, SYMMETRIC_PRESET } from "@symtype/shared";

import { audioProbe, finishOnboarding, installAudioProbe, mutate, typeTarget } from "./helpers";

interface ExportedSession {
  id: string;
  status: string;
}

interface ExportedEvent {
  session_id: string;
  block_id: string;
  sequence: number;
  target_char: string;
  actual_char: string;
  physical_code: string;
  shift_side: "left" | "right" | "both" | "none";
  modifiers_json: string;
  is_correct: number;
  text_position: number;
  was_refocus: number;
  was_paused: number;
  was_repeat: number;
}

interface ExportedDatabase {
  data: {
    sessions: ExportedSession[];
    keystroke_events: ExportedEvent[];
  };
}

interface BlockPayload {
  block: { id: string; target_text: string };
}

async function exportedDatabase(request: APIRequestContext): Promise<ExportedDatabase> {
  const response = await request.get("/api/v1/export/json");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ExportedDatabase;
}

async function statistics(request: APIRequestContext) {
  const response = await request.get("/api/v1/statistics?period=all");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    shiftSummary: {
      left: number;
      right: number;
      both: number;
      missing: number;
      sameHand: number;
      capsLock: number;
    };
  };
}

function blockResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
}

async function pressCharacter(page: Page, character: string): Promise<void> {
  if (character === "\n") {
    await page.keyboard.press("Enter");
    return;
  }
  if (character === "\t") {
    await page.keyboard.press("Tab");
    return;
  }
  const binding = getBindingForCharacter(SYMMETRIC_PRESET, character);
  expect(binding, `No ANSI US binding for ${JSON.stringify(character)}`).toBeDefined();
  if (!binding) return;
  if (binding.shifted) {
    const oppositeShift = binding.key.hand === "left" ? "ShiftRight" : "ShiftLeft";
    await page.keyboard.down(oppositeShift);
    await page.keyboard.press(binding.key.code);
    await page.keyboard.up(oppositeShift);
  } else {
    await page.keyboard.press(binding.key.code);
  }
}

async function pressWithoutShift(page: Page, character: string): Promise<void> {
  const binding = getBindingForCharacter(SYMMETRIC_PRESET, character);
  expect(binding?.shifted).toBe(true);
  if (binding) await page.keyboard.press(binding.key.code);
}

async function pressWithSameHandShift(page: Page, character: string): Promise<"left" | "right"> {
  const binding = getBindingForCharacter(SYMMETRIC_PRESET, character);
  expect(binding?.shifted).toBe(true);
  expect(binding?.key.hand === "left" || binding?.key.hand === "right").toBeTruthy();
  const side = binding?.key.hand === "right" ? "right" : "left";
  const shift = side === "left" ? "ShiftLeft" : "ShiftRight";
  if (binding) {
    await page.keyboard.down(shift);
    await page.keyboard.press(binding.key.code);
    await page.keyboard.up(shift);
  }
  return side;
}

async function dispatchCapsLockCharacter(page: Page, character: string): Promise<void> {
  const binding = getBindingForCharacter(SYMMETRIC_PRESET, character);
  expect(binding?.shifted && /[A-Z]/u.test(character)).toBe(true);
  if (!binding) return;
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await surface.evaluate(
    (element, payload) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: payload.character,
        code: payload.code,
        shiftKey: false
      });
      Object.defineProperty(event, "getModifierState", {
        value: (modifier: string) => modifier === "CapsLock"
      });
      element.dispatchEvent(event);
    },
    { character, code: binding.key.code }
  );
}

test.describe.serial("today intent, input boundaries, audio, and navigation", () => {
  test("Today exposes every duration and propagates the selected intent", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", {
      trainingBias: "speed"
    });

    for (const duration of [5, 10, 15, 20]) {
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(`^${duration}\\s*分钟$`, "u") }).click();
      await expect(page).toHaveURL(new RegExp(`mode=smart.*duration=${duration}.*bias=speed`, "u"));
      await expect(page.getByLabel("本轮训练计划")).toContainText(`${duration} 分钟`);
      await expect(page.getByLabel("本轮训练计划")).toContainText("速度挑战");
    }

    await page.goto("/");
    const systemButton = page.getByRole("button", { name: /^系统\s*\d+\s*分钟$/u });
    const systemName = (await systemButton.innerText()).replaceAll(/\s/gu, "");
    const systemDuration = Number(systemName.match(/(\d+)分钟/u)?.[1]);
    expect([5, 10, 15, 20]).toContain(systemDuration);
    await systemButton.click();
    await expect(page).toHaveURL(
      new RegExp(`mode=smart.*duration=${systemDuration}.*bias=speed.*auto=1`, "u")
    );
    await expect(page.getByLabel("本轮训练计划")).toContainText("系统按今日目标选择");

    await page.goto("/");
    await page.getByRole("button", { name: "准确优先" }).click();
    const primaryTitle = await page
      .getByRole("button", { name: /^系统\s*\d+\s*分钟$/u })
      .getAttribute("title");
    const primaryDuration = Number(primaryTitle?.match(/(\d+) 分钟/u)?.[1]);
    await page.getByRole("button", { name: /开始今日训练/u }).click();
    await expect(page).toHaveURL(
      new RegExp(`mode=smart.*duration=${primaryDuration}.*bias=accuracy.*auto=1`, "u")
    );
    await expect(page.getByLabel("本轮训练计划")).toContainText("准确优先");
  });

  test("real session events persist Shift, Caps Lock, focus-loss, IME, repeat, and sound evidence", async ({
    page,
    request
  }) => {
    test.setTimeout(120_000);
    await installAudioProbe(page);
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", {
      soundEnabled: true,
      soundTheme: "soft",
      soundMode: "all",
      volume: 0.4,
      stopOnError: false
    });
    const before = await statistics(request);

    await page.goto("/train/session?mode=shift&duration=0.25&seed=9441");
    const sessionPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
    );
    let nextBlock = blockResponse(page);
    await page.getByRole("button", { name: /^开始/ }).click();
    const sessionResponse = await sessionPromise;
    const sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;

    let missingMarker: { blockId: string; position: number } | undefined;
    let sameHandMarker: { blockId: string; position: number; side: "left" | "right" } | undefined;
    let capsMarker: { blockId: string; position: number } | undefined;
    let resumeMarker: { blockId: string; position: number } | undefined;
    let eventCount = 0;
    let ignoredBoundaryChecked = false;
    let shiftedCase = 0;
    const expectedEvents: Array<{ blockId: string; targetLength: number }> = [];
    let completeResponse: Response | undefined;

    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      const block = (await (await nextBlock).json()) as BlockPayload;
      const followingBlock = blockIndex < 3 ? blockResponse(page) : undefined;
      const completionResponse =
        blockIndex === 3
          ? page.waitForResponse(
              (response) =>
                response.url().endsWith(`/api/v1/sessions/${sessionId}/complete`) &&
                response.request().method() === "POST"
            )
          : undefined;
      expectedEvents.push({
        blockId: block.block.id,
        targetLength: block.block.target_text.length
      });
      const surface = page.getByRole("textbox", { name: "打字练习输入区" });
      await surface.focus();

      if (!ignoredBoundaryChecked) {
        await page.getByRole("button", { name: "重开当前微组" }).focus();
        await page.keyboard.type("qwerty123");
        await expect(page.getByText(`0/${block.block.target_text.length}`)).toBeVisible();
        await surface.focus();
        const first = block.block.target_text[0] ?? "a";
        const binding = getBindingForCharacter(SYMMETRIC_PRESET, first);
        expect(binding).toBeDefined();
        await surface.dispatchEvent("keydown", {
          key: "Process",
          code: binding?.key.code ?? "KeyA",
          keyCode: 229,
          isComposing: true
        });
        await surface.dispatchEvent("keydown", {
          key: first,
          code: binding?.key.code ?? "KeyA",
          repeat: true,
          shiftKey: binding?.shifted ?? false
        });
        await expect(page.getByText(`0/${block.block.target_text.length}`)).toBeVisible();
        ignoredBoundaryChecked = true;
      }

      const characters = Array.from(block.block.target_text);
      for (let position = 0; position < characters.length; position += 1) {
        const character = characters[position] ?? "";
        if (!resumeMarker && eventCount === 8) {
          await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
          await expect(page.getByRole("button", { name: "继续训练" })).toBeVisible();
          await page.getByRole("button", { name: "继续训练" }).click();
          await expect(surface).toBeFocused();
          resumeMarker = { blockId: block.block.id, position };
        }

        if (/[A-Z]/u.test(character) && shiftedCase === 0) {
          missingMarker = { blockId: block.block.id, position };
          await pressWithoutShift(page, character);
          shiftedCase += 1;
        } else if (/[A-Z]/u.test(character) && shiftedCase === 1) {
          const side = await pressWithSameHandShift(page, character);
          sameHandMarker = { blockId: block.block.id, position, side };
          shiftedCase += 1;
        } else if (/[A-Z]/u.test(character) && shiftedCase === 2) {
          capsMarker = { blockId: block.block.id, position };
          await dispatchCapsLockCharacter(page, character);
          shiftedCase += 1;
        } else {
          await pressCharacter(page, character);
        }
        eventCount += 1;
      }

      if (followingBlock) nextBlock = followingBlock;
      if (completionResponse) completeResponse = await completionResponse;
    }

    await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
    expect(completeResponse).toBeDefined();
    expect(missingMarker).toBeDefined();
    expect(sameHandMarker).toBeDefined();
    expect(capsMarker).toBeDefined();
    expect(resumeMarker).toBeDefined();

    const completion = (await completeResponse?.json()) as {
      summary: {
        errorAnalysis: {
          behavioralIssues: Array<{
            kind: string;
            topFeatures: Array<{ feature: string }>;
          }>;
        };
      };
    };
    const shiftIssue = completion.summary.errorAnalysis.behavioralIssues.find(
      (issue) => issue.kind === "shift-use-error"
    );
    expect(shiftIssue?.topFeatures.map((feature) => feature.feature)).toEqual(
      expect.arrayContaining(["missing-shift", "same-hand-shift"])
    );

    const exported = await exportedDatabase(request);
    const stored = exported.data.keystroke_events
      .filter((event) => event.session_id === sessionId)
      .sort((left, right) => left.sequence - right.sequence);
    expect(stored).toHaveLength(expectedEvents.reduce((sum, block) => sum + block.targetLength, 0));
    expect(stored.map((event) => event.sequence)).toEqual(
      Array.from({ length: stored.length }, (_, index) => index)
    );
    expect(stored.every((event) => event.was_repeat === 0)).toBe(true);

    const findMarker = (marker: { blockId: string; position: number } | undefined) =>
      stored.find(
        (event) => event.block_id === marker?.blockId && event.text_position === marker.position
      );
    expect(findMarker(missingMarker)).toMatchObject({
      shift_side: "none",
      is_correct: 0
    });
    expect(JSON.parse(findMarker(missingMarker)?.modifiers_json ?? "{}")).toMatchObject({
      shift: false,
      capsLock: false
    });
    expect(findMarker(sameHandMarker)).toMatchObject({
      shift_side: sameHandMarker?.side,
      is_correct: 1
    });
    expect(findMarker(capsMarker)).toMatchObject({ shift_side: "none", is_correct: 1 });
    expect(JSON.parse(findMarker(capsMarker)?.modifiers_json ?? "{}")).toMatchObject({
      shift: false,
      capsLock: true
    });

    const resumed = findMarker(resumeMarker);
    expect(resumed).toMatchObject({ was_refocus: 1, was_paused: 1 });
    const afterResume = stored.find((event) => event.sequence === (resumed?.sequence ?? -2) + 1);
    expect(afterResume).toMatchObject({ was_refocus: 0, was_paused: 0 });

    const after = await statistics(request);
    expect(after.shiftSummary.missing).toBeGreaterThanOrEqual(before.shiftSummary.missing + 2);
    expect(after.shiftSummary.sameHand).toBeGreaterThanOrEqual(before.shiftSummary.sameHand + 1);
    expect(after.shiftSummary.capsLock).toBeGreaterThanOrEqual(before.shiftSummary.capsLock + 1);

    await expect
      .poll(async () => (await audioProbe(page)).played.map((tone) => tone.frequency))
      .toEqual(expect.arrayContaining([520, 360, 155, 760, 880]));
    const probe = await audioProbe(page);
    expect(probe.constructed).toBe(1);
    expect(probe.resumed).toBe(1);
  });

  test("settings preview applies all, keys-only, and errors-only filters in both engines", async ({
    page,
    request
  }) => {
    await installAudioProbe(page);
    await finishOnboarding(page);

    const expected: Record<"all" | "keys" | "errors", number[]> = {
      all: [520, 155],
      keys: [520],
      errors: [155]
    };
    for (const mode of ["all", "keys", "errors"] as const) {
      await mutate(request, "patch", "/api/v1/settings", {
        soundEnabled: true,
        soundTheme: "soft",
        soundMode: mode,
        volume: 0.4
      });
      await page.goto("/settings");
      await page.getByRole("button", { name: "播放示例" }).click();
      await expect
        .poll(async () => (await audioProbe(page)).played.map((tone) => tone.frequency))
        .toEqual(expected[mode]);
      const probe = await audioProbe(page);
      expect(probe.constructed).toBe(1);
      expect(probe.resumed).toBe(1);
    }
  });

  test("same-app Back is guarded and refresh preserves flushed events before recovery", async ({
    page,
    request
  }) => {
    await finishOnboarding(page);
    await mutate(request, "patch", "/api/v1/settings", {
      soundEnabled: false,
      stopOnError: false
    });
    await page.goto("/");
    await page.getByRole("button", { name: /^5\s*分钟$/u }).click();

    const sessionPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
    );
    const firstBlock = blockResponse(page);
    await page.getByRole("button", { name: /^开始/ }).click();
    const sessionId = ((await (await sessionPromise).json()) as { session: { id: string } }).session
      .id;
    const block = (await (await firstBlock).json()) as BlockPayload;
    expect(block.block.target_text.length).toBeGreaterThanOrEqual(24);

    await typeTarget(page, block.block.target_text.slice(0, 3));
    const backAttempt = page.goBack({ timeout: 3_000 }).catch(() => null);
    await expect(page.getByRole("dialog")).toContainText("结束这次训练？");
    await expect(page).toHaveURL(/\/train\/session/u);
    await page.getByRole("button", { name: "继续训练" }).click();
    await backAttempt;
    await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toBeFocused();

    const persistedBatch = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/sessions/${sessionId}/events`) &&
        response.request().method() === "POST"
    );
    await typeTarget(page, block.block.target_text.slice(3, 24));
    expect((await persistedBatch).ok()).toBeTruthy();

    page.on("dialog", (dialog) => void dialog.accept());
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("status")).toContainText("上次刷新中断的半节课程已标记为放弃");
    await expect(page).not.toHaveURL(/session=/u);

    const exported = await exportedDatabase(request);
    expect(exported.data.sessions.find((session) => session.id === sessionId)).toMatchObject({
      status: "abandoned"
    });
    const events = exported.data.keystroke_events.filter((event) => event.session_id === sessionId);
    expect(events).toHaveLength(24);
    expect(events.map((event) => event.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, index) => index)
    );
  });
});
