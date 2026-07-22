#!/usr/bin/env node

/* global console, process */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  fixtureDatabasePath,
  getFixtureSpec,
  loadFixtureManifest,
  writeJsonAtomic
} from "./lib/index.js";
import { requestJson } from "./p2-http.mjs";
import {
  copyFixtureDatabase,
  createTrialDataDirectory,
  assertSupportedPerformanceRuntime,
  projectRoot,
  removeTrialDirectory,
  startProductionServer,
  stopOwnedProcess
} from "./p2-process.mjs";
import { measureServerOperations } from "./p2-server-measurements.mjs";
import {
  createServerFragment,
  describeServerFixture,
  serverBudgetsPass
} from "./p2-server-report.mjs";

const DEFAULT_OUTPUT = join(projectRoot, "reports/performance/fragments/server.json");

export function parseServerArguments(arguments_) {
  const options = {
    samples: 20,
    warmups: 5,
    output: DEFAULT_OUTPUT,
    fixtureId: "100k",
    dataRoot: undefined,
    fixture: undefined
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (
      ["--samples", "--warmups", "--output", "--fixture-id", "--data-root", "--fixture"].includes(
        argument
      ) &&
      !value
    ) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === "--samples") options.samples = Number(arguments_[++index]);
    else if (argument === "--warmups") options.warmups = Number(arguments_[++index]);
    else if (argument === "--output") options.output = resolve(arguments_[++index]);
    else if (argument === "--fixture-id") options.fixtureId = arguments_[++index];
    else if (argument === "--data-root") options.dataRoot = resolve(arguments_[++index]);
    else if (argument === "--fixture") options.fixture = resolve(arguments_[++index]);
    else if (argument === "--enforce") options.enforce = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.samples) || options.samples < 20) {
    throw new Error("Server measurements require at least 20 warm samples per operation.");
  }
  if (!Number.isInteger(options.warmups) || options.warmups < 1) {
    throw new Error("--warmups must be a positive integer.");
  }
  if (options.samples + options.warmups > 120) {
    throw new Error("Samples and warmups cannot exceed the 120-character event fixture block.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node --import tsx scripts/perf/run-server.mjs [options]

  --samples N       Timed samples per operation (minimum 20)
  --warmups N       Untimed requests before each operation
  --fixture-id ID   empty, 1k, 100k (default), or 1m
  --data-root PATH  Fixture root created by create-fixtures.ts
  --fixture PATH    Closed custom SQLite fixture; overrides --fixture-id
  --output PATH     Atomic JSON fragment path
  --enforce         Fail when a server budget is exceeded`);
}

function resolveFixture(options) {
  if (options.fixture) return { path: options.fixture, id: "custom", manifest: null };
  const spec = getFixtureSpec(options.fixtureId);
  const manifest = loadFixtureManifest(options.dataRoot);
  const entry = manifest.fixtures.find((candidate) => candidate.id === spec.id);
  if (!entry) throw new Error(`Fixture manifest has no ${spec.id} entry.`);
  return { path: fixtureDatabasePath(spec, options.dataRoot), id: spec.id, manifest: entry };
}

export async function runServer(options) {
  assertSupportedPerformanceRuntime();
  const fixture = resolveFixture(options);
  if (!existsSync(fixture.path)) throw new Error(`Fixture database not found: ${fixture.path}`);
  const description = await describeServerFixture(fixture);
  const trial = createTrialDataDirectory(`server-${fixture.id}`);
  copyFixtureDatabase(fixture.path, trial.dataDir);
  let server;
  let fragment;
  let operationError;
  try {
    server = await startProductionServer({ dataDir: trial.dataDir, instrumentEventLoop: true });
    const bootstrap = await requestJson(server.url, "/api/v1/bootstrap");
    const activeLayout = bootstrap.layouts.find((layout) => layout.is_active === 1);
    if (!activeLayout?.mappings?.length)
      throw new Error("Bootstrap has no active layout mappings.");
    const measured = await measureServerOperations(
      server,
      { ...bootstrap, activeLayoutMappings: activeLayout.mappings },
      options
    );
    fragment = createServerFragment(fixture, description, measured, options);
    writeJsonAtomic(options.output, fragment);
    if (options.enforce && !serverBudgetsPass(measured)) process.exitCode = 1;
  } catch (error) {
    operationError = error;
  }
  const cleanup = server ? await stopOwnedProcess(server.child) : null;
  removeTrialDirectory(trial.trialRoot);
  if (operationError) throw operationError;
  if (cleanup && !cleanup.graceful) throw new Error("Built server did not stop gracefully.");
  return fragment;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = parseServerArguments(process.argv.slice(2));
  if (options.help) printHelp();
  else await runServer(options);
}
