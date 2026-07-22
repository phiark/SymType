import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

import {
  captureEnvironmentMetadata,
  fixtureDatabasePath,
  loadFixtureManifest,
  writeJsonAtomic
} from "./lib/index.ts";
import {
  assertProductionBuild,
  selectLoopbackPort,
  supportedRuntimeEnvironment
} from "./p2-process.mjs";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const playwrightVersion = require("@playwright/test/package.json").version;

function parseArguments(arguments_) {
  const options = {
    build: true,
    dataRoot: resolve(root, ".symtype-perf-data"),
    output: resolve(root, "reports/performance/fragments/p3-memory.json"),
    short: false
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--short") options.short = true;
    else if (argument === "--skip-build") options.build = false;
    else if (argument === "--data-root") options.dataRoot = resolve(arguments_[++index] ?? "");
    else if (argument === "--output") options.output = resolve(arguments_[++index] ?? "");
    else throw new Error(`Unknown memory performance argument: ${argument}`);
  }
  return options;
}

async function run(executable, arguments_, environment) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, arguments_, { cwd: root, env: environment, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Command failed with code ${code} and signal ${signal}`));
    });
  });
}

function valueMetric(unit, value, method) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { unit, supported: false, reason: "The browser did not expose this value." };
  }
  return { unit, supported: true, value, ...(method ? { method } : {}) };
}

function memoryRunEnvironment(options, environment, fixture, observations, port) {
  return {
    ...environment,
    SYMTYPE_MEMORY_DURATION_MS: options.short ? "8000" : "1800000",
    SYMTYPE_MEMORY_SAMPLE_MS: options.short ? "2000" : "300000",
    SYMTYPE_MEMORY_WARMUP_MS: options.short ? "2000" : "120000",
    SYMTYPE_PERF_FIXTURE_PATH: fixture,
    SYMTYPE_PERF_OBSERVATION_DIR: observations,
    SYMTYPE_PERF_PORT: String(port),
    SYMTYPE_PERF_RUN_ID: `memory-${Date.now()}`,
    SYMTYPE_PERF_SHORT: options.short ? "1" : ""
  };
}

async function runMemoryProject(options, environment, fixture, observations) {
  const port = await selectLoopbackPort();
  await run(
    process.execPath,
    [
      resolve(root, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config=playwright.performance.config.ts",
      "--project=chromium-memory",
      "tests/performance/memory-stability.spec.ts"
    ],
    memoryRunEnvironment(options, environment, fixture, observations, port)
  );
}

function memoryMetrics(raw) {
  const snapshotValues = (key) => raw.snapshots.map((snapshot) => snapshot[key]);
  const range = (values) => Math.max(...values) - Math.min(...values);
  const baselineRss = raw.baseline.rssBytes;
  const activeRss = raw.activeEnd.rssBytes;
  return {
    "memory.retained_heap_growth_percent": valueMetric(
      "percent",
      raw.metrics.retainedHeapGrowthPercent,
      "forced-GC Runtime.getHeapUsage"
    ),
    "memory.retained_heap_growth_mib": valueMetric(
      "MiB",
      raw.metrics.retainedHeapGrowthMiB,
      "forced-GC Runtime.getHeapUsage"
    ),
    "memory.rss_growth_mib": valueMetric(
      "MiB",
      typeof baselineRss === "number" && typeof activeRss === "number"
        ? (activeRss - baselineRss) / 1024 / 1024
        : null,
      "operating-system RSS for the Chromium browser process"
    ),
    "memory.dom_node_range": valueMetric("nodes", range(snapshotValues("domNodes"))),
    "memory.listener_range": valueMetric("listeners", range(snapshotValues("listeners"))),
    "memory.timer_range": valueMetric("timers", range(snapshotValues("timers"))),
    "memory.route_release_heap_delta_mib": valueMetric(
      "MiB",
      raw.metrics.routeReleasedVsActiveBytes / 1024 / 1024,
      "forced-GC heap after the practice route unmounts"
    )
  };
}

function createMemoryDocument(options, manifest, fixtureEntry, raw) {
  return {
    schemaVersion: 1,
    fragment: "p3-memory",
    environment: captureEnvironmentMetadata({
      command: options.short ? "perf:memory --short" : "perf:memory",
      cacheState: "warm baseline after continuous practice",
      fixture: fixtureEntry.id,
      sqliteVersion: fixtureEntry.sqliteVersion
    }),
    fixture: fixtureEntry,
    runtime: { playwrightVersion, chromiumVersion: raw.browserVersion },
    configuration: {
      durationMs: raw.runtimeMs,
      shortValidation: options.short,
      timeZone: manifest.timeZone,
      warmupMs: options.short ? 2_000 : 120_000
    },
    metrics: memoryMetrics(raw),
    profile: raw
  };
}

function loadFixture(options) {
  const fixture = fixtureDatabasePath("empty", options.dataRoot);
  const manifest = loadFixtureManifest(options.dataRoot);
  const fixtureEntry = manifest.fixtures.find((entry) => entry.id === "empty");
  if (!fixtureEntry || !existsSync(fixture)) {
    throw new Error("Create the empty performance fixture first");
  }
  return { fixture, fixtureEntry, manifest };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const environment = supportedRuntimeEnvironment();
  if (options.build) await run("npm", ["run", "build"], environment);
  assertProductionBuild();
  const { fixture, fixtureEntry, manifest } = loadFixture(options);
  const observations = resolve(options.dataRoot, "observations", `memory-${Date.now()}`);
  rmSync(observations, { recursive: true, force: true });
  mkdirSync(observations, { recursive: true });
  await runMemoryProject(options, environment, fixture, observations);
  const path = resolve(observations, "chromium-memory.memory-stability.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const document = createMemoryDocument(options, manifest, fixtureEntry, raw);
  mkdirSync(dirname(options.output), { recursive: true });
  writeJsonAtomic(options.output, document);
  process.stdout.write(
    `${JSON.stringify({ output: options.output, fragment: document.fragment })}\n`
  );
}

await main();
