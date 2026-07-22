import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { createFixtures } from "./create-fixtures.js";
import { fixtureDatabasePath, loadFixtureManifest } from "./lib/fixtures.js";

test("fixture generation is deterministic, coherent, and manifest-verified", async () => {
  const root = mkdtempSync(join(tmpdir(), "symtype-perf-fixtures-"));
  try {
    const first = await createFixtures({ root, sizes: ["empty", "1k"] });
    expect(first.fixtures.map(({ id, eventCount }) => [id, eventCount])).toEqual([
      ["empty", 0],
      ["1k", 1_000]
    ]);
    const populated = first.fixtures[1];
    expect(populated).toBeDefined();
    if (!populated) throw new Error("Populated fixture is unavailable");
    expect(populated.validation.linkedEvents).toBe(1_000);
    expect(populated.validation.dailyCharacters).toBe(1_000);
    for (const value of [
      populated.validation.practiceSessions,
      populated.validation.testSessions,
      populated.validation.gameSessions,
      populated.validation.errors,
      populated.validation.backspaces,
      populated.validation.shifted,
      populated.validation.digits,
      populated.validation.symbols
    ]) {
      expect(value).toBeGreaterThan(0);
    }

    const hashes = first.fixtures.map(({ sha256 }) => sha256);
    const second = await createFixtures({ root, sizes: ["empty", "1k"] });
    expect(second.fixtures.map(({ sha256 }) => sha256)).toEqual(hashes);
    expect(await createFixtures({ root, sizes: ["empty", "1k"], verifyOnly: true })).toEqual(
      second
    );
    expect(loadFixtureManifest(root)).toEqual(second);
    expect(fixtureDatabasePath("1k", root)).toMatch(/fixtures\/1k\.sqlite3$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
