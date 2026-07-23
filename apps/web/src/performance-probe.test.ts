/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWebPerformanceProbe,
  installWebPerformanceProbe,
  WEB_PERFORMANCE_MARK_NAMES,
  type WebLongTaskTiming
} from "./performance-probe";

afterEach(() => {
  delete window.symtypePerformance;
  vi.restoreAllMocks();
});

describe("local Web performance probe", () => {
  it("exposes only a frozen, read-only snapshot reader to a local harness", () => {
    const probe = installWebPerformanceProbe();
    const reader = window.symtypePerformance;

    expect(reader).toBeDefined();
    expect(Object.isFrozen(reader)).toBe(true);
    expect(Object.keys(reader ?? {})).toEqual(["snapshot"]);
    expect(reader?.snapshot()).toMatchObject({
      schemaVersion: 1,
      longTasks: [],
      droppedLongTaskCount: 0
    });
    probe.disconnect();
  });

  it("records bootstrap and first interactive paint once", () => {
    let now = 3.4567;
    const frames: (() => void)[] = [];
    const mark = vi.fn();
    const probe = createWebPerformanceProbe({
      timeOrigin: 1_721_692_800_000,
      longTaskSupported: false,
      now: () => now,
      mark,
      scheduleFrame: (callback) => frames.push(callback)
    });

    now = 8;
    probe.markReactRenderSubmitted();
    probe.markReactRenderSubmitted();
    probe.scheduleInteractivePaint();
    probe.scheduleInteractivePaint();
    expect(frames).toHaveLength(1);

    now = 12;
    frames.shift()?.();
    expect(frames).toHaveLength(1);
    now = 20.9996;
    frames.shift()?.();

    expect(probe.snapshot()).toMatchObject({
      schemaVersion: 1,
      clock: "window-performance-time-origin",
      timeOriginEpochMs: 1_721_692_800_000,
      longTaskSupported: false,
      marks: {
        webBootstrapStartedMs: 3.457,
        reactRenderSubmittedMs: 8,
        interactivePaintMs: 21
      }
    });
    expect(mark.mock.calls.flat()).toEqual([
      WEB_PERFORMANCE_MARK_NAMES.bootstrapStarted,
      WEB_PERFORMANCE_MARK_NAMES.reactRenderSubmitted,
      WEB_PERFORMANCE_MARK_NAMES.interactivePaint
    ]);
  });

  it("keeps only the newest 64 content-free long-task timings", () => {
    let onLongTasks: ((entries: readonly WebLongTaskTiming[]) => void) | undefined;
    const disconnect = vi.fn();
    const probe = createWebPerformanceProbe({
      timeOrigin: 1,
      longTaskSupported: true,
      now: () => 0,
      mark: () => undefined,
      scheduleFrame: () => undefined,
      subscribeLongTasks: (callback) => {
        onLongTasks = callback;
        return disconnect;
      }
    });

    onLongTasks?.([
      { startTimeMs: -1, durationMs: 50 },
      { startTimeMs: 1, durationMs: Number.NaN },
      ...Array.from({ length: 70 }, (_, index) => ({
        startTimeMs: index + 0.12345,
        durationMs: 50 + index + 0.98765
      }))
    ]);

    const snapshot = probe.snapshot();
    expect(snapshot.longTasks).toHaveLength(64);
    expect(snapshot.droppedLongTaskCount).toBe(6);
    expect(snapshot.longTasks[0]).toEqual({ startTimeMs: 6.123, durationMs: 56.988 });
    expect(snapshot.longTasks.at(-1)).toEqual({
      startTimeMs: 69.123,
      durationMs: 119.988
    });

    snapshot.longTasks[0]!.durationMs = 999;
    expect(probe.snapshot().longTasks[0]?.durationMs).toBe(56.988);
    probe.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
