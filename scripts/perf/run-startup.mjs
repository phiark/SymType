#!/usr/bin/env node

/* global console, process */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { captureEnvironmentMetadata, sha256File, writeJsonAtomic } from "./lib/index.js";
import { assertSupportedPerformanceRuntime, projectRoot } from "./p2-process.mjs";
import { measureStartupScenarios } from "./p2-startup-trials.mjs";

const DEFAULT_OUTPUT = join(projectRoot, "reports/performance/fragments/startup.json");

export function parseStartupArguments(arguments_) {
  const options = { samples: 10, output: DEFAULT_OUTPUT, fixture: null, timeoutMs: 30_000 };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (["--samples", "--output", "--fixture", "--timeout-ms"].includes(argument) && !value) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === "--samples") options.samples = Number(arguments_[++index]);
    else if (argument === "--output") options.output = resolve(arguments_[++index]);
    else if (argument === "--fixture") options.fixture = resolve(arguments_[++index]);
    else if (argument === "--timeout-ms") options.timeoutMs = Number(arguments_[++index]);
    else if (argument === "--enforce") options.enforce = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.samples) || options.samples < 10) {
    throw new Error("Startup measurements require at least 10 isolated trials per state.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be at least 1000.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node --import tsx scripts/perf/run-startup.mjs [options]

  --samples N       Isolated trials per backup state (minimum 10)
  --fixture PATH    Optional closed SQLite fixture copied into every trial
  --output PATH     Atomic JSON fragment path
  --timeout-ms N    Per-process health timeout
  --enforce         Fail when a startup budget is exceeded`);
}

export async function runStartup(options) {
  assertSupportedPerformanceRuntime();
  if (options.fixture && !existsSync(options.fixture))
    throw new Error("Fixture database not found.");
  const { health, appWork, scenarios } = await measureStartupScenarios(options);
  const fixture = options.fixture
    ? {
        path: options.fixture,
        byteSize: statSync(options.fixture).size,
        sha256: await sha256File(options.fixture)
      }
    : { kind: "fresh-empty" };
  const fragment = {
    schemaVersion: 1,
    fragment: "startup",
    environment: captureEnvironmentMetadata({
      command: "node --import tsx scripts/perf/run-startup.mjs",
      cacheState: "OS page cache uncontrolled; launcher dependency/build cache verified",
      fixture: options.fixture ?? "fresh-empty"
    }),
    fixture,
    cacheDisclosure: {
      osColdCacheClaimed: false,
      statement: "The runner does not flush or claim control of the operating-system page cache.",
      backupStates: ["first-backup", "same-day-cached-backup"],
      browserLaunch: {
        measured: false,
        reason: "OS browser launch is outside app-controlled work."
      }
    },
    metrics: {
      "startup.health_ready_ms": { unit: "ms", ...health },
      "startup.app_work_ms": { unit: "ms", ...appWork }
    },
    scenarios
  };
  writeJsonAtomic(options.output, fragment);
  if (options.enforce && (health.p95 > 1_500 || appWork.p95 > 2_000)) process.exitCode = 1;
  return fragment;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = parseStartupArguments(process.argv.slice(2));
  if (options.help) printHelp();
  else await runStartup(options);
}
