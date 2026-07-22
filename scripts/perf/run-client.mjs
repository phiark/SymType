import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

import {
  captureEnvironmentMetadata,
  fixtureDatabasePath,
  loadFixtureManifest,
  summarizeSamples,
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
    output: resolve(root, "reports/performance/fragments/p3-client.json"),
    short: false
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--short") options.short = true;
    else if (argument === "--skip-build") options.build = false;
    else if (argument === "--data-root") options.dataRoot = resolve(arguments_[++index] ?? "");
    else if (argument === "--output") options.output = resolve(arguments_[++index] ?? "");
    else throw new Error(`Unknown client performance argument: ${argument}`);
  }
  return options;
}

async function run(executable, arguments_, environment) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, arguments_, {
      cwd: root,
      env: environment,
      stdio: "inherit"
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Command failed with code ${code} and signal ${signal}`));
    });
  });
}

async function buildProductionOutput() {
  await run("npm", ["run", "build"], supportedRuntimeEnvironment());
  assertProductionBuild();
}

function readObservation(directory, project, name) {
  const path = resolve(directory, `${project}.${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing browser observation: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function numeric(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}

function metric(unit, values, method) {
  const samples = numeric(values);
  if (samples.length === 0) {
    return {
      unit,
      supported: false,
      reason: "The browser did not expose a numeric sample.",
      ...(method ? { method } : {})
    };
  }
  return { unit, supported: true, ...summarizeSamples(samples), ...(method ? { method } : {}) };
}

function valueMetric(unit, value, method) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { unit, supported: false, reason: "The browser did not expose this value." };
  }
  return { unit, supported: true, value, ...(method ? { method } : {}) };
}

async function runProject(project, environmentBase, observationDirectory, fixture, short) {
  const port = await selectLoopbackPort();
  const runId = `client-${Date.now()}-${project}`;
  await run(
    process.execPath,
    [
      resolve(root, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config=playwright.performance.config.ts",
      `--project=${project}`,
      "tests/performance/client-load.spec.ts",
      "tests/performance/typing-hot-path.spec.ts"
    ],
    {
      ...environmentBase,
      SYMTYPE_PERF_FIXTURE_PATH: fixture,
      SYMTYPE_PERF_LOAD_SAMPLES: short ? "2" : "20",
      SYMTYPE_PERF_OBSERVATION_DIR: observationDirectory,
      SYMTYPE_PERF_PORT: String(port),
      SYMTYPE_PERF_RUN_ID: runId,
      SYMTYPE_PERF_SHORT: short ? "1" : "",
      SYMTYPE_PERF_TYPING_DURATION_MS: short ? "5000" : "120000"
    }
  );
}

function loadMetrics(release) {
  const coldFcp = release.cold.map((sample) => sample.fcpMs);
  const coldLcp = release.cold.map((sample) => sample.lcpMs);
  const warmLcp = release.warm.map((sample) => sample.lcpMs);
  const totalBlocking = release.cold.map((sample) => sample.tbtMs);
  const cls = numeric(release.cold.map((sample) => sample.cls));
  return {
    "client.cold_fcp_ms": metric("ms", coldFcp, "PerformancePaintTiming"),
    "client.cold_lcp_ms": metric("ms", coldLcp, "LargestContentfulPaint"),
    "client.warm_lcp_ms": metric("ms", warmLcp, "LargestContentfulPaint with warm HTTP cache"),
    "client.total_blocking_time_ms": metric("ms", totalBlocking, "Long Tasks above 50 ms"),
    "client.cumulative_layout_shift": valueMetric("score", cls.length ? Math.max(...cls) : null),
    "client.warm_route_ms": metric("ms", release.routeMs, "SPA route mark to ready heading")
  };
}

function typingLatencyMetrics(chromiumTyping, webkitTyping) {
  const chromiumPaint = chromiumTyping.after.inputToRafMs;
  const webkitPaint = webkitTyping.after.inputToRafMs;
  const longTasks = [
    ...chromiumTyping.after.longTasks.durations,
    ...webkitTyping.after.longTasks.durations
  ];
  return {
    "typing.handler_ms": metric(
      "ms",
      chromiumTyping.after.handlerMs,
      "wrapped DOM event listeners"
    ),
    "typing.chromium_input_to_paint_ms": metric(
      "ms",
      chromiumPaint,
      "trusted keydown browser timestamp to requestAnimationFrame"
    ),
    "typing.webkit_input_to_paint_ms": metric(
      "ms",
      webkitPaint,
      "trusted keydown browser timestamp to requestAnimationFrame"
    ),
    "typing.input_to_paint_ms": metric(
      "ms",
      [...chromiumPaint, ...webkitPaint],
      "trusted keydown browser timestamp to requestAnimationFrame"
    ),
    "typing.chromium_event_timing_ms": metric(
      "ms",
      chromiumTyping.after.eventTiming.durations,
      "PerformanceEventTiming with the browser duration threshold"
    ),
    "typing.webkit_event_timing_ms": metric(
      "ms",
      webkitTyping.after.eventTiming.durations,
      "PerformanceEventTiming with the browser duration threshold"
    ),
    "typing.long_task_ms": valueMetric("ms", longTasks.length ? Math.max(...longTasks) : 0)
  };
}

function typingStabilityMetrics(chromiumTyping) {
  const domValues = [
    chromiumTyping.before.domNodes,
    chromiumTyping.after.domNodes,
    ...chromiumTyping.stream.domSamples
  ];
  return {
    "typing.event_rate_per_second": valueMetric(
      "events/s",
      chromiumTyping.stream.attemptsPerSecond
    ),
    "typing.dom_node_range": valueMetric("nodes", Math.max(...domValues) - Math.min(...domValues)),
    "typing.listener_delta": valueMetric(
      "listeners",
      chromiumTyping.after.listeners - chromiumTyping.before.listeners
    ),
    "typing.timer_delta": valueMetric(
      "timers",
      chromiumTyping.after.timers - chromiumTyping.before.timers
    ),
    "typing.persisted_events": valueMetric("events", chromiumTyping.persistedCount)
  };
}

function soundMetrics(chromiumTyping, webkitTyping) {
  const sound = [...chromiumTyping.after.audio.scheduleMs, ...webkitTyping.after.audio.scheduleMs];
  return {
    "sound.key_to_schedule_ms": metric(
      "ms",
      sound,
      "trusted keydown to AudioScheduledSourceNode.start"
    ),
    "sound.audio_contexts": valueMetric("contexts", chromiumTyping.after.audio.contexts),
    "sound.unreleased_nodes": valueMetric(
      "nodes",
      chromiumTyping.after.audio.createdNodes - chromiumTyping.after.audio.endedNodes
    )
  };
}

function aggregateMetrics(release, chromiumTyping, webkitTyping) {
  return {
    ...loadMetrics(release),
    ...typingLatencyMetrics(chromiumTyping, webkitTyping),
    ...typingStabilityMetrics(chromiumTyping),
    ...soundMetrics(chromiumTyping, webkitTyping)
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.build) await buildProductionOutput();
  else assertProductionBuild();
  const fixture = fixtureDatabasePath("empty", options.dataRoot);
  const manifest = loadFixtureManifest(options.dataRoot);
  const fixtureEntry = manifest.fixtures.find((entry) => entry.id === "empty");
  if (!fixtureEntry || !existsSync(fixture))
    throw new Error("Create the empty performance fixture first");

  const observations = resolve(options.dataRoot, "observations", `client-${Date.now()}`);
  rmSync(observations, { recursive: true, force: true });
  mkdirSync(observations, { recursive: true });
  const environment = supportedRuntimeEnvironment();
  for (const project of ["chromium-release", "chromium-local", "webkit-local"]) {
    await runProject(project, environment, observations, fixture, options.short);
  }

  const release = readObservation(observations, "chromium-release", "client-load");
  const chromiumLocal = readObservation(observations, "chromium-local", "client-load");
  const webkitLocal = readObservation(observations, "webkit-local", "client-load");
  const chromiumTyping = readObservation(observations, "chromium-local", "typing-hot-path");
  const webkitTyping = readObservation(observations, "webkit-local", "typing-hot-path");
  const document = {
    schemaVersion: 1,
    fragment: "p3-client",
    environment: captureEnvironmentMetadata({
      command: options.short ? "perf:client --short" : "perf:client",
      cacheState: "cold and warm profiles are separate",
      fixture: fixtureEntry.id,
      sqliteVersion: fixtureEntry.sqliteVersion
    }),
    fixture: fixtureEntry,
    runtime: {
      playwrightVersion,
      chromiumVersion: release.browserVersion,
      webkitVersion: webkitLocal.browserVersion
    },
    configuration: {
      releaseCpuSlowdown: 4,
      localCpuSlowdown: 1,
      loadSamples: release.sampleCount,
      typingDurationMs: chromiumTyping.stream.wallTimeMs,
      shortValidation: options.short,
      timeZone: manifest.timeZone
    },
    metrics: aggregateMetrics(release, chromiumTyping, webkitTyping),
    profiles: {
      chromiumRelease: release,
      chromiumLocal,
      chromiumTyping,
      webkitLocal,
      webkitTyping
    }
  };
  mkdirSync(dirname(options.output), { recursive: true });
  writeJsonAtomic(options.output, document);
  process.stdout.write(
    `${JSON.stringify({ output: options.output, fragment: document.fragment })}\n`
  );
}

await main();
