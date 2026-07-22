/* global process */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";

import {
  forbiddenFirstRouteModules,
  scanRemoteFindings,
  staticEntryClosure
} from "./p2-bundle-graph.mjs";
import { readServerEventLoopMonitor, resetServerEventLoopMonitor } from "./p2-event-loop-ipc.mjs";
import { projectRoot, stopOwnedProcess } from "./p2-process.mjs";
import { parseBundleArguments } from "./run-bundle.mjs";
import { parseServerArguments } from "./run-server.mjs";
import { parseStartupArguments } from "./run-startup.mjs";

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("P2 performance runner contracts", () => {
  test("enforces required sample counts and explicit existing-build disclosure", () => {
    expect(() => parseStartupArguments(["--samples", "9"])).toThrow(/at least 10/u);
    expect(() => parseServerArguments(["--samples", "19"])).toThrow(/at least 20/u);
    expect(parseServerArguments(["--samples", "20", "--warmups", "4"]).samples).toBe(20);
    expect(parseBundleArguments(["--no-build"]).build).toBe(false);
  });

  test("resolves static imports without pulling dynamic route entries", () => {
    const manifest = {
      entry: { file: "entry.js", imports: ["shared"], dynamicImports: ["game"] },
      shared: { file: "shared.js" },
      game: { file: "game.js" }
    };
    expect(staticEntryClosure(manifest, ["entry"])).toEqual(["entry", "shared"]);
    expect(
      forbiddenFirstRouteModules({
        "entry.js": ["../../node_modules/recharts/es6/index.js", "../../src/pages/GamePage.tsx"]
      })
    ).toMatchObject({
      pass: false,
      chart: [{ file: "entry.js", moduleCount: 1 }],
      game: [{ file: "entry.js", moduleCount: 1 }]
    });
  });

  test("reports remote font and request findings from distributable files", () => {
    const directory = makeTemporaryDirectory("bundle-scan");
    mkdirSync(join(directory, "assets"));
    writeFileSync(
      join(directory, "assets/app.css"),
      '@font-face{src:url("https://font.invalid/type.woff2")}',
      "utf8"
    );
    writeFileSync(join(directory, "assets/app.js"), 'fetch("https://api.invalid/data")', "utf8");
    const findings = scanRemoteFindings(directory);
    expect(findings.remoteFonts).toHaveLength(1);
    expect(findings.probableRequests).toHaveLength(1);
  });

  test("samples event-loop delay inside the instrumented child, never the benchmark parent", async () => {
    const preload = join(projectRoot, "scripts/perf/p2-event-loop-preload.mjs");
    const child = spawn(
      process.execPath,
      ["--import", preload, "-e", "setInterval(() => {}, 1000)"],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      }
    );
    try {
      await resetServerEventLoopMonitor(child);
      await delay(30);
      const snapshot = await readServerEventLoopMonitor(child);
      expect(snapshot.count).toBeGreaterThan(0);
      expect(snapshot.p99Ms).toBeGreaterThan(0);
      const runner = readFileSync(join(projectRoot, "scripts/perf/run-server.mjs"), "utf8");
      expect(runner).not.toContain("monitorEventLoopDelay");
    } finally {
      await stopOwnedProcess(child);
    }
  });
});

function makeTemporaryDirectory(label) {
  const directory = mkdtempSync(join(tmpdir(), `symtype-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}
