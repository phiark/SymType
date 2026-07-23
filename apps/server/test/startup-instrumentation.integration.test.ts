import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { StartupTimeline } from "../src/startup-timings.js";

describe("server startup instrumentation", () => {
  const directories: string[] = [];
  const apps: AppContext[] = [];

  afterEach(async () => {
    await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function configFor(dataDir: string): ServerConfig {
    return {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "logs", "symtype.log"),
      webDist: join(dataDir, "web-dist-not-present"),
      isTest: true
    };
  }

  async function createInstrumentedApp(
    config: ServerConfig
  ): Promise<{ context: AppContext; timeline: StartupTimeline }> {
    const timeline = new StartupTimeline();
    const context = await createApp(config, { startupTimeline: timeline });
    apps.push(context);
    return { context, timeline };
  }

  test("wires database and automatic-backup phases without changing the public health payload", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-startup-timing-"));
    directories.push(dataDir);
    const config = configFor(dataDir);
    const first = await createInstrumentedApp(config);

    const snapshot = first.timeline.snapshot();
    expect(snapshot.automaticBackupOutcome).toBe("created");
    const orderedMarks = [
      snapshot.marks.appConstructionStartedMs,
      snapshot.marks.databaseReadyMs,
      snapshot.marks.automaticBackupStartedMs,
      snapshot.marks.automaticBackupFinishedMs,
      snapshot.marks.appConstructionFinishedMs
    ];
    for (const mark of orderedMarks) expect(typeof mark).toBe("number");
    const completeMarks = orderedMarks.filter((mark): mark is number => typeof mark === "number");
    expect(completeMarks).toHaveLength(5);
    expect(completeMarks).toEqual([...completeMarks].sort((left, right) => left - right));
    expect(snapshot.marks.listenerReadyMs).toBeUndefined();

    const health = await first.context.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "127.0.0.1:4173" }
    });
    expect(Object.keys(health.json<Record<string, unknown>>())).not.toContain("startupTimings");

    await first.context.app.close();
    apps.splice(apps.indexOf(first.context), 1);
    const second = await createInstrumentedApp(config);
    expect(second.timeline.snapshot().automaticBackupOutcome).toBe("current");
  });
});
