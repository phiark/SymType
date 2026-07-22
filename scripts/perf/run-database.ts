import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { benchmarkFixture, type SizeBenchmarkResult } from "./lib/database-benchmark.js";
import { captureEnvironmentMetadata } from "./lib/environment.js";
import { validateFixtureDatabase } from "./lib/fixture-validation.js";
import {
  fixtureDatabasePath,
  getFixtureSpec,
  loadFixtureManifest,
  PERF_FIXTURE_SPECS,
  resolvePerfDataRoot,
  type FixtureId,
  type FixtureManifestEntry,
  type FixtureSpec
} from "./lib/fixtures.js";
import { sha256File, writeJsonAtomic } from "./lib/json-files.js";
import type { SampleSummary } from "./lib/statistics.js";

const DEFAULT_OUTPUT = resolve("reports/performance/fragments/database.json");

export interface DatabaseRunnerOptions {
  readonly dataRoot?: string;
  readonly output?: string;
  readonly samples?: number;
  readonly sizes?: readonly FixtureId[];
  readonly enforce?: boolean;
}

export async function runDatabaseBenchmarks(options: DatabaseRunnerOptions = {}) {
  const dataRoot = resolvePerfDataRoot(options.dataRoot);
  const output = resolve(options.output ?? DEFAULT_OUTPUT);
  const samples = options.samples ?? 20;
  if (!Number.isInteger(samples) || samples < 20) {
    throw new Error("Database measurements require at least 20 samples per hot read");
  }
  const specs = selectedSpecs(options.sizes);
  const manifest = loadFixtureManifest(dataRoot);
  const fixtures = await verifyFixtures(dataRoot, specs, manifest.fixtures);
  const results: SizeBenchmarkResult[] = [];
  for (const spec of specs) {
    process.stdout.write(`Measuring ${spec.id} database fixture...\n`);
    results.push(benchmarkFixture(spec, dataRoot, samples));
  }
  const metrics = buildMetrics(results);
  const sqliteVersions = [...new Set(results.map((result) => result.sqliteVersion))];
  const fragment = {
    schemaVersion: 1,
    fragment: "database",
    environment: captureEnvironmentMetadata({
      command: "node --import tsx scripts/perf/run-database.ts",
      cacheState:
        "One untimed warm read per operation; same connection; OS page cache uncontrolled",
      sqliteVersion: sqliteVersions.join(","),
      fixture: specs.map(({ id }) => id).join(",")
    }),
    samplePolicy: {
      timedSamplesPerOperation: samples,
      warmupsPerOperation: 1,
      fixtureGenerationTimed: false,
      osPageCacheControlled: false
    },
    fixtures,
    metrics,
    observations: Object.fromEntries(results.map((result) => [result.size, result.observations])),
    queryPlans: Object.fromEntries(results.map((result) => [result.size, result.plans])),
    scalingRatios: scalingRatios(results, specs)
  };
  writeJsonAtomic(output, fragment);
  const hotQuery = metrics["database.hot_query_ms"];
  if (options.enforce && hotQuery && hotQuery.p95 > 50) process.exitCode = 1;
  return fragment;
}

function buildMetrics(results: readonly SizeBenchmarkResult[]) {
  const metrics: Record<string, { unit: "ms"; source?: string } & SampleSummary> = {};
  const direct: { id: string; summary: SampleSummary }[] = [];
  for (const result of results) {
    for (const [queryId, summary] of Object.entries(result.direct)) {
      const id = `database.query.${queryId}.${result.size}_ms`;
      metrics[id] = { unit: "ms", ...summary };
      direct.push({ id, summary });
    }
    for (const [operationId, summary] of Object.entries(result.production)) {
      metrics[`database.production.${operationId}.${result.size}_ms`] = { unit: "ms", ...summary };
    }
  }
  const worst = direct.sort((left, right) => right.summary.p95 - left.summary.p95)[0];
  if (!worst) throw new Error("No database hot-query measurements were recorded");
  metrics["database.hot_query_ms"] = { unit: "ms", source: worst.id, ...worst.summary };
  return metrics;
}

async function verifyFixtures(
  root: string,
  specs: readonly FixtureSpec[],
  entries: readonly FixtureManifestEntry[]
): Promise<FixtureManifestEntry[]> {
  const verified: FixtureManifestEntry[] = [];
  for (const spec of specs) {
    const entry = entries.find((candidate) => candidate.id === spec.id);
    if (!entry) throw new Error(`Fixture manifest has no ${spec.id} entry`);
    const path = fixtureDatabasePath(spec, root);
    if ((await sha256File(path)) !== entry.sha256)
      throw new Error(`Fixture ${spec.id} hash mismatch`);
    const validation = validateFixtureDatabase(path, spec);
    if (validation.schemaVersion !== entry.schemaVersion) {
      throw new Error(`Fixture ${spec.id} schema version mismatch`);
    }
    verified.push(entry);
  }
  return verified;
}

function scalingRatios(results: readonly SizeBenchmarkResult[], specs: readonly FixtureSpec[]) {
  const output: Record<string, unknown[]> = {};
  const positive = specs.filter(({ eventCount }) => eventCount > 0);
  const resultBySize = new Map(results.map((result) => [result.size, result]));
  const first = results[0];
  if (!first) return output;
  for (const queryId of Object.keys(first.direct)) {
    output[`query.${queryId}`] = adjacentRatios(positive, resultBySize, "direct", queryId);
  }
  for (const operationId of Object.keys(first.production)) {
    output[`production.${operationId}`] = adjacentRatios(
      positive,
      resultBySize,
      "production",
      operationId
    );
  }
  return output;
}

function adjacentRatios(
  specs: readonly FixtureSpec[],
  results: ReadonlyMap<FixtureId, SizeBenchmarkResult>,
  group: "direct" | "production",
  id: string
): unknown[] {
  const ratios: unknown[] = [];
  for (let index = 1; index < specs.length; index += 1) {
    const from = specs[index - 1];
    const to = specs[index];
    if (!from || !to) continue;
    const fromMedian = results.get(from.id)?.[group][id]?.median;
    const toMedian = results.get(to.id)?.[group][id]?.median;
    if (fromMedian === undefined || toMedian === undefined) continue;
    const dataRatio = to.eventCount / from.eventCount;
    const timeRatio = fromMedian === 0 ? null : toMedian / fromMedian;
    ratios.push({
      from: from.id,
      to: to.id,
      dataRatio,
      fromMedian,
      toMedian,
      timeRatio,
      normalizedRatio: timeRatio === null ? null : timeRatio / dataRatio,
      superlinear: timeRatio !== null && timeRatio > dataRatio * 1.05
    });
  }
  return ratios;
}

export function parseDatabaseArguments(arguments_: readonly string[]): DatabaseRunnerOptions {
  const parsed: {
    dataRoot?: string;
    output?: string;
    samples?: number;
    sizes?: FixtureId[];
    enforce?: boolean;
    help?: boolean;
  } = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--data-root") parsed.dataRoot = requiredValue(arguments_, ++index, argument);
    else if (argument === "--output") parsed.output = requiredValue(arguments_, ++index, argument);
    else if (argument === "--samples")
      parsed.samples = Number(requiredValue(arguments_, ++index, argument));
    else if (argument === "--sizes")
      parsed.sizes = parseSizes(requiredValue(arguments_, ++index, argument));
    else if (argument === "--enforce") parsed.enforce = true;
    else if (argument === "--help") parsed.help = true;
    else throw new Error(`Unknown database argument: ${argument}`);
  }
  if (parsed.help) printHelp();
  return parsed;
}

function selectedSpecs(ids?: readonly FixtureId[]): readonly FixtureSpec[] {
  return ids?.map(getFixtureSpec) ?? PERF_FIXTURE_SPECS;
}

function parseSizes(value: string): FixtureId[] {
  return value.split(",").map((id) => getFixtureSpec(id as FixtureId).id);
}

function requiredValue(arguments_: readonly string[], index: number, flag: string): string {
  const value = arguments_[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  process.stdout.write(`Usage: node --import tsx scripts/perf/run-database.ts [options]\n
  --data-root PATH  Fixture root created by create-fixtures.ts
  --sizes LIST      empty,1k,100k,1m (default: all)
  --samples N       Timed samples per query and production read (minimum 20)
  --output PATH     Atomic JSON fragment path
  --enforce         Fail when the hot-query p95 exceeds 50 ms\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runDatabaseBenchmarks(parseDatabaseArguments(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
