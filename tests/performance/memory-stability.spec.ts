import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";

import { createCustomText, patchSettings } from "./api";
import { saveObservation } from "./observations";
import { installHotPathProbe, readHotPathProbe, resetHotPathSamples } from "./probes";
import {
  mixedText,
  runMixedInputStream,
  saveAndExit,
  startMeasuredSession,
  type BlockPayload,
  type StreamResult
} from "./typing-driver";

interface MemorySnapshot {
  atMs: number;
  domNodes: number;
  heapBytes: number;
  listeners: number;
  rssBytes: number | null;
  timers: number;
}

interface MemoryProfile {
  activeEnd: MemorySnapshot;
  baseline: MemorySnapshot;
  snapshots: MemorySnapshot[];
  stream: StreamResult;
}

function memoryDurationMs(): number {
  const value = Number(process.env.SYMTYPE_MEMORY_DURATION_MS ?? "1800000");
  if (!Number.isInteger(value) || value < 5_000) throw new Error("Invalid memory duration");
  if (!process.env.SYMTYPE_PERF_SHORT && value < 1_800_000) {
    throw new Error("Release memory measurement requires 30 minutes");
  }
  return value;
}

function readRssBytes(processId: number | null): number | null {
  if (processId == null || process.platform === "win32") return null;
  try {
    const output = execFileSync("/bin/ps", ["-o", "rss=", "-p", String(processId)], {
      encoding: "utf8"
    });
    const kib = Number(output.trim());
    return Number.isFinite(kib) ? kib * 1024 : null;
  } catch {
    return null;
  }
}

async function browserProcessId(session: CDPSession): Promise<number | null> {
  const response = (await session.send("SystemInfo.getProcessInfo")) as {
    processInfo: Array<{ id: number; type: string }>;
  };
  return response.processInfo.find((candidate) => candidate.type === "browser")?.id ?? null;
}

async function memorySnapshot(
  page: Page,
  session: CDPSession,
  processId: number | null,
  atMs: number
): Promise<MemorySnapshot> {
  await page.requestGC();
  await session.send("HeapProfiler.collectGarbage");
  const heap = (await session.send("Runtime.getHeapUsage")) as { usedSize: number };
  const probe = await readHotPathProbe(page);
  return {
    atMs,
    domNodes: probe.domNodes,
    heapBytes: heap.usedSize,
    listeners: probe.listeners,
    rssBytes: readRssBytes(processId),
    timers: probe.timers
  };
}

async function configureMemory(request: APIRequestContext): Promise<string> {
  await patchSettings(request, {
    onboardingComplete: true,
    keyboardVisible: false,
    reducedMotion: true,
    smoothScroll: false,
    soundEnabled: true,
    soundMode: "keys",
    soundTheme: "soft",
    volume: 0.2,
    stopOnError: false,
    backspaceMode: "enabled",
    theme: "light"
  });
  return createCustomText(request, mixedText(100_000));
}

async function collectMemoryProfile(
  page: Page,
  block: BlockPayload,
  options: {
    processId: number | null;
    runtimeMs: number;
    sampleEveryMs: number;
    session: CDPSession;
    short: boolean;
    warmupMs: number;
  }
): Promise<MemoryProfile> {
  const snapshots: MemorySnapshot[] = [];
  let nextSampleAt = options.warmupMs;
  const stream = await runMixedInputStream(page, block, options.runtimeMs, {
    attemptsPerSecond: options.short ? 12 : 3,
    onCheckpoint: async (_probe, elapsedMs) => {
      if (elapsedMs < nextSampleAt) return;
      snapshots.push(await memorySnapshot(page, options.session, options.processId, elapsedMs));
      nextSampleAt += options.sampleEveryMs;
    }
  });
  if (snapshots.length === 0 || snapshots.at(-1)!.atMs < options.runtimeMs - 250) {
    snapshots.push(
      await memorySnapshot(page, options.session, options.processId, stream.wallTimeMs)
    );
  }
  const baseline = snapshots[0];
  const activeEnd = snapshots.at(-1);
  if (!baseline || !activeEnd) throw new Error("The memory profile did not produce snapshots");
  return { activeEnd, baseline, snapshots, stream };
}

function assertMemoryBounds(snapshots: readonly MemorySnapshot[]): void {
  const range = (values: number[]) => Math.max(...values) - Math.min(...values);
  expect(range(snapshots.map((snapshot) => snapshot.listeners))).toBeLessThanOrEqual(5);
  expect(range(snapshots.map((snapshot) => snapshot.timers))).toBeLessThanOrEqual(5);
  expect(range(snapshots.map((snapshot) => snapshot.domNodes))).toBeLessThanOrEqual(100);
}

async function releasePracticeRoute(
  page: Page,
  sessionId: string,
  session: CDPSession,
  processId: number | null,
  atMs: number
): Promise<{ released: MemorySnapshot; typingGlyphs: number }> {
  await saveAndExit(page, sessionId);
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "把数据变成下一次行动" })).toBeVisible();
  const released = await memorySnapshot(page, session, processId, atMs);
  await expect(page.getByRole("textbox", { name: "打字练习输入区" })).toHaveCount(0);
  return { released, typingGlyphs: await page.locator(".typing-glyph").count() };
}

test("records the separate 30-minute retained-memory and route-release profile", async ({
  browser,
  page,
  request
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-memory", "Only the memory command runs this suite");
  const runtimeMs = memoryDurationMs();
  const short = Boolean(process.env.SYMTYPE_PERF_SHORT);
  const warmupMs = Number(process.env.SYMTYPE_MEMORY_WARMUP_MS ?? (short ? "2000" : "120000"));
  const sampleEveryMs = Number(process.env.SYMTYPE_MEMORY_SAMPLE_MS ?? (short ? "2000" : "300000"));
  test.setTimeout(runtimeMs + 240_000);
  await installHotPathProbe(page);
  const customTextId = await configureMemory(request);
  await page.goto(
    `/test/session?mode=custom&seconds=3600&seed=20260722&customTextId=${customTextId}&includeInModel=0`
  );
  const { block, sessionId } = await startMeasuredSession(page);
  await resetHotPathSamples(page);
  const pageSession = await page.context().newCDPSession(page);
  const browserSession = await browser.newBrowserCDPSession();
  const processId = await browserProcessId(browserSession);
  const profile = await collectMemoryProfile(page, block, {
    processId,
    runtimeMs,
    sampleEveryMs,
    session: pageSession,
    short,
    warmupMs
  });
  const release = await releasePracticeRoute(
    page,
    sessionId,
    pageSession,
    processId,
    profile.stream.wallTimeMs
  );
  const retainedBytes = profile.activeEnd.heapBytes - profile.baseline.heapBytes;
  const retainedPercent =
    profile.baseline.heapBytes > 0 ? (retainedBytes / profile.baseline.heapBytes) * 100 : null;
  assertMemoryBounds(profile.snapshots);

  await saveObservation(testInfo, "memory-stability", {
    activeEnd: profile.activeEnd,
    baseline: profile.baseline,
    browserVersion: browser.version(),
    browserProcessId: processId,
    engine: "chromium",
    metrics: {
      retainedHeapGrowthBytes: retainedBytes,
      retainedHeapGrowthMiB: retainedBytes / 1024 / 1024,
      retainedHeapGrowthPercent: retainedPercent,
      routeReleasedHeapBytes: release.released.heapBytes,
      routeReleasedVsActiveBytes: release.released.heapBytes - profile.activeEnd.heapBytes
    },
    release: {
      typingGlyphs: release.typingGlyphs,
      typingSurfaceReleased: release.typingGlyphs === 0,
      snapshot: release.released
    },
    runtimeMs: profile.stream.wallTimeMs,
    snapshots: profile.snapshots,
    support: {
      chromiumHeap: true,
      chromiumRss:
        processId != null && profile.snapshots.some((snapshot) => snapshot.rssBytes != null),
      webkitHeap: { supported: false, reason: "The WebKit transport has no CDP heap API." },
      webkitRss: { supported: false, reason: "The WebKit transport does not expose a browser PID." }
    }
  });
});
