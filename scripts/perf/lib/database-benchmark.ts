import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import type Database from "better-sqlite3";

import { SymTypeDatabase } from "../../../apps/server/src/db/database.js";
import { FIXED_PROFILE_ID } from "./fixture-constants.js";
import { HOT_DATABASE_QUERIES, type DatabaseQueryContext } from "./database-queries.js";
import { fixtureDatabasePath, type FixtureId, type FixtureSpec } from "./fixtures.js";
import { summarizeSamples, type SampleSummary } from "./statistics.js";

export interface SizeBenchmarkResult {
  readonly size: FixtureId;
  readonly sqliteVersion: string;
  readonly direct: Readonly<Record<string, SampleSummary>>;
  readonly production: Readonly<Record<string, SampleSummary>>;
  readonly plans: Readonly<Record<string, readonly QueryPlanRow[]>>;
  readonly observations: {
    readonly statisticsAllCharacters: number;
    readonly dashboardHasLastSession: boolean;
  };
}

export interface QueryPlanRow {
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

export function benchmarkFixture(
  spec: FixtureSpec,
  dataRoot: string,
  samples: number
): SizeBenchmarkResult {
  const runtimeDirectory = join(dataRoot, "runtime", `database-${spec.id}-${process.pid}`);
  rmSync(runtimeDirectory, { recursive: true, force: true });
  mkdirSync(runtimeDirectory, { recursive: true });
  const databasePath = join(runtimeDirectory, "symtype.sqlite3");
  copyFileSync(fixtureDatabasePath(spec, dataRoot), databasePath);
  const database = new SymTypeDatabase({
    host: "127.0.0.1",
    port: 0,
    dataDir: runtimeDirectory,
    databasePath,
    logPath: join(runtimeDirectory, "logs", "symtype.log"),
    webDist: join(runtimeDirectory, "missing-web-dist"),
    isTest: true
  });
  try {
    const result = runMeasurements(database, spec.id, samples);
    if (result.observations.statisticsAllCharacters !== spec.eventCount) {
      throw new Error(`All-time statistics did not select every ${spec.id} fixture event`);
    }
    return result;
  } finally {
    database.close();
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

function runMeasurements(
  database: SymTypeDatabase,
  size: FixtureId,
  samples: number
): SizeBenchmarkResult {
  const context = queryContext(database.db);
  const direct: Record<string, SampleSummary> = {};
  const plans: Record<string, readonly QueryPlanRow[]> = {};
  for (const query of HOT_DATABASE_QUERIES) {
    const parameters = query.parameters(context);
    const statement = database.db.prepare(query.sql);
    statement.all(...parameters);
    direct[query.id] = summarizeSamples(measureStatement(statement, parameters, samples));
    plans[query.id] = queryPlan(database.db, query.sql, parameters);
  }
  const production = {
    dashboard: measureOperation(() => database.getDashboard(), samples),
    statistics_all: measureOperation(() => database.getStatistics("all"), samples)
  };
  const dashboard = database.getDashboard() as { lastSession?: unknown };
  const statistics = database.getStatistics("all") as { overview?: { characters?: unknown } };
  const statisticsAllCharacters = Number(statistics.overview?.characters ?? 0);
  const sqliteVersion = String(
    (database.db.prepare("SELECT sqlite_version() AS value").get() as { value: string }).value
  );
  return {
    size,
    sqliteVersion,
    direct,
    production,
    plans,
    observations: {
      statisticsAllCharacters,
      dashboardHasLastSession: dashboard.lastSession != null
    }
  };
}

function measureStatement(
  statement: Database.Statement,
  parameters: readonly unknown[],
  sampleCount: number
): number[] {
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now();
    const rows = statement.all(...parameters);
    samples.push(performance.now() - started);
    consume(rows);
  }
  return samples;
}

function measureOperation(operation: () => unknown, sampleCount: number): SampleSummary {
  operation();
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now();
    consume(operation());
    samples.push(performance.now() - started);
  }
  return summarizeSamples(samples);
}

function queryPlan(
  database: Database.Database,
  sql: string,
  parameters: readonly unknown[]
): readonly QueryPlanRow[] {
  return (
    database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
      id: number;
      parent: number;
      detail: string;
    }[]
  ).map(({ id, parent, detail }) => ({ id, parent, detail }));
}

function queryContext(database: Database.Database): DatabaseQueryContext {
  const latest = database
    .prepare("SELECT id FROM sessions ORDER BY completed_at DESC LIMIT 1")
    .get() as { id: string } | undefined;
  return {
    profileId: FIXED_PROFILE_ID,
    since: "1970-01-01T00:00:00.000Z",
    sinceDate: "1970-01-01",
    latestSessionId: latest?.id ?? "no-session"
  };
}

let resultSink: unknown;
function consume(value: unknown): void {
  resultSink = value;
}

export function benchmarkSink(): unknown {
  return resultSink;
}
