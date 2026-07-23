import { describe, expect, test } from "vitest";

import { StartupTimeline } from "../src/startup-timings.js";

describe("startup timings", () => {
  test("records each known phase once against the Node process time origin", () => {
    let now = 12.34567;
    const timeline = new StartupTimeline({
      timeOrigin: Date.parse("2026-07-23T00:00:00.000Z"),
      now: () => now
    });

    expect(timeline.mark("appConstructionStarted")).toBe(12.346);
    now = 20;
    expect(timeline.mark("appConstructionStarted")).toBe(12.346);
    expect(timeline.mark("databaseReady")).toBe(20);
    now = 25.5555;
    expect(timeline.mark("automaticBackupStarted")).toBe(25.556);
    now = 40;
    expect(timeline.mark("automaticBackupFinished")).toBe(40);
    timeline.recordAutomaticBackupOutcome("created");
    timeline.recordAutomaticBackupOutcome("current");
    now = 45;
    expect(timeline.mark("appConstructionFinished")).toBe(45);
    now = 60;
    expect(timeline.mark("listenerReady")).toBe(60);

    expect(timeline.snapshot()).toEqual({
      schemaVersion: 1,
      clock: "node-performance-time-origin",
      nodeProcessStartedAt: "2026-07-23T00:00:00.000Z",
      nodeProcessStartMs: 0,
      automaticBackupOutcome: "created",
      marks: {
        appConstructionStartedMs: 12.346,
        databaseReadyMs: 20,
        automaticBackupStartedMs: 25.556,
        automaticBackupFinishedMs: 40,
        appConstructionFinishedMs: 45,
        listenerReadyMs: 60
      }
    });
  });

  test("returns detached snapshots and omits phases that have not happened", () => {
    const timeline = new StartupTimeline({
      timeOrigin: Date.parse("2026-07-23T00:00:00.000Z"),
      now: () => 7
    });
    timeline.mark("appConstructionStarted");

    const first = timeline.snapshot();
    first.marks.appConstructionStartedMs = 999;

    expect(timeline.snapshot().marks).toEqual({ appConstructionStartedMs: 7 });
  });
});
