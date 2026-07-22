import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { createFixtures } from "./create-fixtures.js";
import { fixtureDatabasePath } from "./lib/fixtures.js";
import { readJsonFile, sha256File } from "./lib/json-files.js";
import { parseDatabaseArguments, runDatabaseBenchmarks } from "./run-database.js";

test("database runner measures every hot read 20 times without changing fixtures", async () => {
  const root = mkdtempSync(join(tmpdir(), "symtype-perf-database-"));
  try {
    await createFixtures({ root, sizes: ["empty", "1k"] });
    const sources = [fixtureDatabasePath("empty", root), fixtureDatabasePath("1k", root)];
    const hashes = await Promise.all(sources.map(sha256File));
    const output = join(root, "database-fragment.json");
    const fragment = await runDatabaseBenchmarks({
      dataRoot: root,
      output,
      samples: 20,
      sizes: ["empty", "1k"]
    });
    expect(fragment.fragment).toBe("database");
    expect(fragment.fixtures.map(({ id, eventCount }) => [id, eventCount])).toEqual([
      ["empty", 0],
      ["1k", 1_000]
    ]);
    const metric = fragment.metrics["database.hot_query_ms"];
    expect(metric).toBeDefined();
    expect(metric?.count).toBe(20);
    expect(metric?.samples).toHaveLength(20);
    for (const value of Object.values(fragment.metrics)) {
      expect(value.unit).toBe("ms");
      expect(value.count).toBe(20);
      expect(value.samples).toHaveLength(20);
    }
    const emptyPlans = fragment.queryPlans.empty;
    const populatedPlans = fragment.queryPlans["1k"];
    expect(emptyPlans).toBeDefined();
    expect(populatedPlans).toBeDefined();
    expect(Object.keys(emptyPlans ?? {})).toHaveLength(7);
    expect(Object.keys(populatedPlans ?? {})).toHaveLength(7);
    expect(fragment.observations.empty).toEqual({
      statisticsAllCharacters: 0,
      dashboardHasLastSession: false
    });
    expect(fragment.observations["1k"]).toEqual({
      statisticsAllCharacters: 1_000,
      dashboardHasLastSession: true
    });
    expect(readJsonFile(output)).toEqual(fragment);
    expect(await Promise.all(sources.map(sha256File))).toEqual(hashes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("database argument parser rejects a sample count below the release minimum", async () => {
  const parsed = parseDatabaseArguments(["--samples", "20", "--sizes", "empty,1k"]);
  expect(parsed.samples).toBe(20);
  expect(parsed.sizes).toEqual(["empty", "1k"]);
  await expect(runDatabaseBenchmarks({ samples: 19 })).rejects.toThrow(
    /at least 20 samples per hot read/
  );
});
