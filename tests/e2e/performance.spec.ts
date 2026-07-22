import { expect, test, type Request } from "@playwright/test";

import { mutate, restoreFreshE2eState, typeTarget } from "./helpers";

interface PerformanceProbe {
  monitoring: boolean;
  longTaskSupported: boolean;
  longTaskDurations: number[];
  maxFrameGapMs: number;
}

declare global {
  interface Window {
    __symtypePerformanceProbe: PerformanceProbe;
  }
}

test("typing burst keeps feedback responsive and persists events in batches", async ({
  page,
  request
}, testInfo) => {
  test.setTimeout(90_000);
  await restoreFreshE2eState(request, {
    keyboardVisible: false,
    reducedMotion: true,
    soundEnabled: false,
    stopOnError: false
  });
  await mutate(request, "patch", "/api/v1/settings", { onboardingComplete: true });

  await page.addInitScript(() => {
    const probe: PerformanceProbe = {
      monitoring: false,
      longTaskSupported:
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes.includes("longtask"),
      longTaskDurations: [],
      maxFrameGapMs: 0
    };
    window.__symtypePerformanceProbe = probe;

    if (probe.longTaskSupported) {
      const observer = new PerformanceObserver((list) => {
        if (!probe.monitoring) return;
        for (const entry of list.getEntries()) probe.longTaskDurations.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    }

    let previousFrame = performance.now();
    const observeFrame = (timestamp: number) => {
      if (probe.monitoring) {
        probe.maxFrameGapMs = Math.max(probe.maxFrameGapMs, timestamp - previousFrame);
      }
      previousFrame = timestamp;
      requestAnimationFrame(observeFrame);
    };
    requestAnimationFrame(observeFrame);
  });

  await page.goto("/train/session?mode=smart&duration=0.25&seed=73021");
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
  );
  const blockResponse = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /^开始/ }).click();
  const sessionId = ((await (await sessionResponse).json()) as { session: { id: string } }).session
    .id;
  const block = (await (await blockResponse).json()) as {
    block: { target_text: string };
  };
  const target = block.block.target_text;
  expect(target.length).toBeGreaterThanOrEqual(20);
  expect(target.length).toBeLessThanOrEqual(60);

  const eventWrites: Request[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      outgoing.url().endsWith(`/api/v1/sessions/${sessionId}/events`)
    ) {
      eventWrites.push(outgoing);
    }
  });

  const nextBlock = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.evaluate(() => {
    const probe = window.__symtypePerformanceProbe;
    probe.longTaskDurations = [];
    probe.maxFrameGapMs = 0;
    probe.monitoring = true;
  });
  await typeTarget(page, target);
  const performanceEvidence = await page.evaluate(() => {
    const probe = window.__symtypePerformanceProbe;
    probe.monitoring = false;
    return {
      longTaskSupported: probe.longTaskSupported,
      longTaskDurations: [...probe.longTaskDurations],
      maxFrameGapMs: probe.maxFrameGapMs
    };
  });
  expect((await nextBlock).ok()).toBeTruthy();

  await expect.poll(() => eventWrites.length).toBeGreaterThan(0);
  const persistedEvents = eventWrites.flatMap((outgoing) => {
    const body = outgoing.postDataJSON() as { events: unknown[] };
    return body.events;
  });
  const batchSizes = eventWrites.map((outgoing) => {
    const body = outgoing.postDataJSON() as { events: unknown[] };
    return body.events.length;
  });
  expect(persistedEvents).toHaveLength(target.length);
  expect(eventWrites.length).toBeLessThan(target.length);
  for (const batchSize of batchSizes) {
    expect(batchSize).toBeGreaterThan(1);
    expect(batchSize).toBeLessThanOrEqual(24);
  }

  expect(performanceEvidence.maxFrameGapMs).toBeLessThan(250);
  if (performanceEvidence.longTaskSupported) {
    expect(Math.max(0, ...performanceEvidence.longTaskDurations)).toBeLessThan(100);
    expect(
      performanceEvidence.longTaskDurations.reduce((sum, duration) => sum + duration, 0)
    ).toBeLessThan(150);
  }

  await testInfo.attach("typing-performance-evidence.json", {
    body: JSON.stringify(
      {
        project: testInfo.project.name,
        targetCharacters: target.length,
        requestCount: eventWrites.length,
        batchSizes,
        ...performanceEvidence
      },
      null,
      2
    ),
    contentType: "application/json"
  });

  const abandon = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/sessions/${sessionId}/abandon`) &&
      response.request().method() === "POST"
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存并退出" }).click();
  expect((await abandon).ok()).toBeTruthy();
});
