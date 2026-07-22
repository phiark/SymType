import { statSync } from "node:fs";
import { basename } from "node:path";
import Database from "better-sqlite3";

import { captureEnvironmentMetadata, sha256File } from "./lib/index.js";

export async function describeServerFixture(fixture) {
  const byteSize = statSync(fixture.path).size;
  const sha256 = await sha256File(fixture.path);
  if (
    fixture.manifest &&
    (fixture.manifest.byteSize !== byteSize || fixture.manifest.sha256 !== sha256)
  ) {
    throw new Error(`Fixture ${fixture.id} does not match its deterministic manifest.`);
  }
  const database = new Database(fixture.path, { readonly: true });
  let sqliteVersion;
  try {
    sqliteVersion = database.prepare("SELECT sqlite_version() AS version").get().version;
  } finally {
    database.close();
  }
  return { byteSize, sha256, sqliteVersion };
}

export function createServerFragment(fixture, description, measured, options) {
  return {
    schemaVersion: 1,
    fragment: "server",
    environment: captureEnvironmentMetadata({
      command: "node --import tsx scripts/perf/run-server.mjs",
      cacheState: "Warm HTTP samples after explicit untimed requests; OS page cache uncontrolled",
      sqliteVersion: description.sqliteVersion,
      fixture: fixture.id
    }),
    fixture: {
      id: fixture.id,
      path: fixture.manifest?.relativePath ?? basename(fixture.path),
      byteSize: description.byteSize,
      sha256: description.sha256,
      manifest: fixture.manifest
    },
    samplePolicy: {
      warmupsPerOperation: options.warmups,
      timedSamplesPerOperation: options.samples
    },
    metrics: {
      "server.common_read_ms": { unit: "ms", ...measured.reads.metric },
      "server.common_save_ms": { unit: "ms", ...measured.commonSave },
      "server.next_block_ms": { unit: "ms", ...measured.nextBlock.latency },
      "server.event_loop_delay_ms": {
        unit: "ms",
        samples: [measured.eventLoop.p99Ms],
        count: measured.eventLoop.count,
        p99: measured.eventLoop.p99Ms
      }
    },
    scenarios: {
      reads: measured.reads.scenarios,
      settingsSave: measured.settingsSave,
      eventSave: measured.eventSave,
      nextBlock: measured.nextBlock,
      eventLoop: measured.eventLoop
    }
  };
}

export function serverBudgetsPass(measured) {
  return (
    measured.reads.metric.p95 <= 75 &&
    measured.commonSave.p95 <= 100 &&
    measured.nextBlock.latency.p95 <= 50 &&
    measured.eventLoop.p99Ms <= 20
  );
}
