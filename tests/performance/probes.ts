import type { Page } from "@playwright/test";

import { hotPathProbeSource } from "./browser-hot-probe";
import type { LoadObservation, PageProbeSnapshot } from "./types";

export async function installLoadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = {
      cls: 0,
      largestContentfulPaint: null as number | null,
      longTasks: [] as number[]
    };
    window.__symtypeLoadProbe = probe;
    if (typeof PerformanceObserver === "undefined") return;

    if (PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.largestContentfulPaint = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) probe.cls += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    }
  });
}

export async function readLoadObservation(
  page: Page,
  remoteRequests: readonly string[]
): Promise<LoadObservation> {
  return page.evaluate((unexpected) => {
    const probe = window.__symtypeLoadProbe;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const longTaskSupported =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask");
    return {
      cls: probe?.cls ?? 0,
      fcpMs: paint?.startTime ?? null,
      lcpMs: probe?.largestContentfulPaint ?? null,
      longTaskSupported,
      tbtMs: longTaskSupported
        ? (probe?.longTasks ?? []).reduce((sum, duration) => sum + Math.max(0, duration - 50), 0)
        : null,
      transferBytes:
        (navigation?.transferSize ?? 0) +
        resources.reduce((sum, resource) => sum + resource.transferSize, 0),
      unexplainedRemoteRequests: [...unexpected]
    };
  }, remoteRequests);
}

export async function installHotPathProbe(page: Page): Promise<void> {
  await page.addInitScript({ content: hotPathProbeSource() });
}

export async function readHotPathProbe(page: Page): Promise<PageProbeSnapshot> {
  return page.evaluate(() => {
    const probe = window.__symtypePerfProbe;
    if (!probe) throw new Error("The hot-path probe is not installed");
    return {
      audio: { ...probe.audio, scheduleMs: [...probe.audio.scheduleMs] },
      domNodes: document.getElementsByTagName("*").length,
      eventTiming: { ...probe.eventTiming, durations: [...probe.eventTiming.durations] },
      handlerMs: [...probe.handlerMs],
      inputToRafMs: [...probe.inputToRafMs],
      listeners: probe.listeners,
      longTasks: { ...probe.longTasks, durations: [...probe.longTasks.durations] },
      timers: probe.timers,
      trustedKeydowns: probe.trustedKeydowns
    };
  });
}

export async function resetHotPathSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__symtypePerfProbe;
    if (!probe) throw new Error("The hot-path probe is not installed");
    probe.audio.scheduleMs = [];
    probe.eventTiming.durations = [];
    probe.handlerMs = [];
    probe.inputToRafMs = [];
    probe.longTasks.durations = [];
    probe.trustedKeydowns = 0;
  });
}
