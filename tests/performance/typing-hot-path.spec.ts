import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

import { createCustomText, exportDatabase, patchSettings } from "./api";
import { saveObservation } from "./observations";
import { installHotPathProbe, readHotPathProbe, resetHotPathSamples } from "./probes";
import {
  mixedText,
  runMixedInputStream,
  saveAndExit,
  startMeasuredSession,
  type StreamResult
} from "./typing-driver";
import type { PageProbeSnapshot } from "./types";

function durationMs(): number {
  const value = Number(process.env.SYMTYPE_PERF_TYPING_DURATION_MS ?? "120000");
  if (!Number.isInteger(value) || value < 1_000) throw new Error("Invalid typing duration");
  if (!process.env.SYMTYPE_PERF_SHORT && value < 120_000) {
    throw new Error("Release typing measurement requires 120 seconds");
  }
  return value;
}

async function configureTyping(request: APIRequestContext): Promise<string> {
  await patchSettings(request, {
    onboardingComplete: true,
    keyboardVisible: false,
    reducedMotion: true,
    smoothScroll: false,
    soundEnabled: true,
    soundMode: "all",
    soundTheme: "soft",
    volume: 0.25,
    stopOnError: false,
    backspaceMode: "enabled",
    theme: "light"
  });
  return createCustomText(request, mixedText(30_000));
}

function captureWrites(page: Page): { eventRequests: Request[]; mediaRequests: string[] } {
  const eventRequests: Request[] = [];
  const mediaRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      /\/api\/v1\/sessions\/[^/]+\/events$/u.test(outgoing.url())
    ) {
      eventRequests.push(outgoing);
    }
    if (
      outgoing.resourceType() === "media" ||
      /\.(?:aac|mp3|ogg|wav)(?:\?|$)/iu.test(outgoing.url())
    ) {
      mediaRequests.push(outgoing.url());
    }
  });
  return { eventRequests, mediaRequests };
}

async function reconcileEvents(
  request: APIRequestContext,
  sessionId: string,
  eventRequests: readonly Request[]
): Promise<Array<Record<string, unknown>>> {
  const posted = eventRequests.flatMap((outgoing) => {
    const body = outgoing.postDataJSON() as { events: Array<Record<string, unknown>> };
    return body.events;
  });
  const postedBySequence = new Map(posted.map((event) => [Number(event.sequence), event]));
  const exported = await exportDatabase(request);
  const persisted = exported.data.keystroke_events
    .filter((event) => event.session_id === sessionId)
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  expect(postedBySequence.size).toBe(posted.length);
  expect(persisted).toHaveLength(posted.length);
  expect(persisted.map((event) => Number(event.sequence))).toEqual(
    Array.from({ length: persisted.length }, (_, index) => index)
  );
  for (const event of persisted) {
    const sent = postedBySequence.get(Number(event.sequence));
    expect(sent).toBeDefined();
    expect(event.target_char).toBe(sent?.targetChar);
    expect(event.actual_char).toBe(sent?.actualChar);
  }
  return persisted;
}

function assertInputCoverage(events: readonly Record<string, unknown>[]): void {
  expect(events.some((event) => Number(event.is_correct) === 0)).toBeTruthy();
  expect(events.some((event) => Number(event.is_correction) === 1)).toBeTruthy();
  expect(events.some((event) => /[A-Z]/u.test(String(event.target_char)))).toBeTruthy();
  expect(events.some((event) => /\d/u.test(String(event.target_char)))).toBeTruthy();
  expect(events.some((event) => /[^\w\s]/u.test(String(event.target_char)))).toBeTruthy();
}

function assertStableProbe(before: PageProbeSnapshot, after: PageProbeSnapshot): void {
  expect(after.audio.contexts).toBe(1);
  expect(after.audio.endedNodes).toBe(after.audio.createdNodes);
  expect(after.listeners).toBe(before.listeners);
  expect(Math.abs(after.timers - before.timers)).toBeLessThanOrEqual(1);
}

function streamEvidence(stream: StreamResult, attemptsPerSecond: number): Record<string, unknown> {
  return {
    blockCount: stream.blockCount,
    corrections: stream.corrections,
    domSamples: stream.domSamples,
    eventAttempts: stream.eventAttempts,
    observed: {
      digits: stream.observedCharacters.filter((value) => /\d/u.test(value)).length,
      shifted: stream.observedCharacters.filter((value) => /[A-Z]/u.test(value)).length,
      symbols: stream.observedCharacters.filter((value) => /[^\w\s]/u.test(value)).length
    },
    attemptsPerSecond,
    wallTimeMs: stream.wallTimeMs
  };
}

test("records the ordered mixed-input, paint, persistence, and sound path", async ({
  browser,
  page,
  request
}, testInfo) => {
  test.skip(
    testInfo.project.name === "chromium-release" || testInfo.project.name === "chromium-memory",
    "The hot path uses the unthrottled local-use profiles"
  );
  const runtimeMs = durationMs();
  test.setTimeout(runtimeMs + 180_000);
  await installHotPathProbe(page);
  const customTextId = await configureTyping(request);
  const captured = captureWrites(page);
  await page.goto(
    `/test/session?mode=custom&seconds=3600&seed=20260722&customTextId=${customTextId}&includeInModel=0`
  );
  await expect(page.getByRole("heading", { name: "3600 秒测试" })).toBeVisible();
  const { block, sessionId } = await startMeasuredSession(page);
  await page.waitForTimeout(250);
  const before = await readHotPathProbe(page);
  await resetHotPathSamples(page);
  const stream = await runMixedInputStream(page, block, runtimeMs, { attemptsPerSecond: 28 });
  await page.waitForTimeout(500);
  const after = await readHotPathProbe(page);
  await saveAndExit(page, sessionId);
  const persisted = await reconcileEvents(request, sessionId, captured.eventRequests);
  assertInputCoverage(persisted);
  expect(captured.mediaRequests).toEqual([]);
  assertStableProbe(before, after);
  const attemptsPerSecond = stream.eventAttempts / (stream.wallTimeMs / 1000);
  if (!process.env.SYMTYPE_PERF_SHORT) expect(attemptsPerSecond).toBeGreaterThanOrEqual(25);
  await saveObservation(testInfo, "typing-hot-path", {
    after,
    before,
    browserVersion: browser.version(),
    engine: testInfo.project.name.startsWith("webkit") ? "webkit" : "chromium",
    eventRequests: captured.eventRequests.length,
    persistedCount: persisted.length,
    stream: streamEvidence(stream, attemptsPerSecond)
  });
});
