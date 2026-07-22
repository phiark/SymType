import { resolve } from "node:path";
import { expect, test } from "vitest";

import {
  fixtureDatabasePath,
  fixtureManifestPath,
  getFixtureSpec,
  PERF_FIXTURE_SPECS
} from "./fixtures.js";

test("fixture registry fixes all required event sizes and paths", () => {
  expect(PERF_FIXTURE_SPECS.map(({ id, eventCount }) => [id, eventCount])).toEqual([
    ["empty", 0],
    ["1k", 1_000],
    ["100k", 100_000],
    ["1m", 1_000_000]
  ]);
  const root = resolve("fixture-root");
  expect(fixtureDatabasePath("1k", root)).toBe(resolve(root, "fixtures", "1k.sqlite3"));
  expect(fixtureManifestPath(root)).toBe(resolve(root, "manifest.json"));
  expect(getFixtureSpec("1m").filename).toBe("1m.sqlite3");
});
