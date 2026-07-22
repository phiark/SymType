import { expect, type Page, type Response } from "@playwright/test";
import { getBindingForCharacter, SYMMETRIC_PRESET } from "@symtype/shared";

import { readHotPathProbe } from "./probes";
import type { PageProbeSnapshot } from "./types";

export interface BlockPayload {
  block: { id: string; target_text: string };
}

export interface StreamResult {
  blockCount: number;
  corrections: number;
  domSamples: number[];
  eventAttempts: number;
  observedCharacters: string[];
  probeSamples: PageProbeSnapshot[];
  wallTimeMs: number;
}

interface StreamOptions {
  attemptsPerSecond: number;
  onCheckpoint?: (snapshot: PageProbeSnapshot, elapsedMs: number) => Promise<void>;
}

export const mixedText = (minimumLength = 20_000): string => {
  const phrase = "aZ1!;? bY2@,./ Cx3#[]{} dW4$-_+= eV5%() Qn6^: ";
  return phrase.repeat(Math.ceil(minimumLength / phrase.length)).slice(0, minimumLength);
};

export function nextBlockResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
}

export async function startMeasuredSession(page: Page): Promise<{
  block: BlockPayload;
  sessionId: string;
}> {
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
  );
  const blockResponse = nextBlockResponse(page);
  await page.getByRole("button", { name: /^开始/u }).click();
  const sessionPayload = (await (await sessionResponse).json()) as { session: { id: string } };
  return {
    block: (await (await blockResponse).json()) as BlockPayload,
    sessionId: sessionPayload.session.id
  };
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
  expect(binding, `No physical ANSI key for ${JSON.stringify(character)}`).toBeDefined();
  if (!binding) return;
  if (binding.shifted) {
    const shift = binding.key.hand === "left" ? "ShiftRight" : "ShiftLeft";
    await page.keyboard.down(shift);
    await page.keyboard.press(binding.key.code);
    await page.keyboard.up(shift);
  } else {
    await page.keyboard.press(binding.key.code);
  }
}

async function pace(nextAt: number): Promise<void> {
  const remaining = nextAt - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export async function runMixedInputStream(
  page: Page,
  initialBlock: BlockPayload,
  durationMs: number,
  options: StreamOptions
): Promise<StreamResult> {
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await surface.focus();
  const intervalMs = 1000 / options.attemptsPerSecond;
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  let nextAt = startedAt;
  let block = initialBlock;
  let blockCount = 0;
  let eventAttempts = 0;
  let corrections = 0;
  const observedCharacters: string[] = [];
  const domSamples: number[] = [];
  const probeSamples: PageProbeSnapshot[] = [];

  while (Date.now() < deadline) {
    const characters = Array.from(block.block.target_text);
    let completedBlock = true;
    for (let position = 0; position < characters.length; position += 1) {
      if (Date.now() >= deadline) {
        completedBlock = false;
        break;
      }
      const expected = characters[position] ?? "";
      observedCharacters.push(expected);
      const injectError =
        eventAttempts > 0 && eventAttempts % 47 === 0 && position + 1 < characters.length;
      if (injectError) {
        await pace(nextAt);
        await pressCharacter(page, expected === "x" ? "q" : "x");
        eventAttempts += 1;
        nextAt += intervalMs;
        await page.keyboard.press("Backspace");
        corrections += 1;
        await pace(nextAt);
        await pressCharacter(page, expected);
        eventAttempts += 1;
        nextAt += intervalMs;
      } else {
        const following = position + 1 === characters.length ? nextBlockResponse(page) : undefined;
        await pace(nextAt);
        await pressCharacter(page, expected);
        eventAttempts += 1;
        nextAt += intervalMs;
        if (following) {
          const response = await following;
          expect(response.ok(), await response.text()).toBeTruthy();
          block = (await response.json()) as BlockPayload;
        }
      }
    }
    if (!completedBlock) break;
    blockCount += 1;
    const snapshot = await readHotPathProbe(page);
    domSamples.push(snapshot.domNodes);
    probeSamples.push(snapshot);
    await options.onCheckpoint?.(snapshot, Date.now() - startedAt);
  }

  return {
    blockCount,
    corrections,
    domSamples,
    eventAttempts,
    observedCharacters,
    probeSamples,
    wallTimeMs: Date.now() - startedAt
  };
}

export async function saveAndExit(page: Page, sessionId: string): Promise<void> {
  const abandoned = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/sessions/${sessionId}/abandon`) &&
      response.request().method() === "POST"
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存并退出" }).click();
  expect((await abandoned).ok()).toBeTruthy();
}
