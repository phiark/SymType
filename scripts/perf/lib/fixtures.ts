import { resolve, join } from "node:path";

import { readJsonFile } from "./json-files.js";

export type FixtureId = "empty" | "1k" | "100k" | "1m";

export interface FixtureSpec {
  readonly id: FixtureId;
  readonly eventCount: number;
  readonly filename: `${FixtureId}.sqlite3`;
}

export interface FixtureValidation {
  readonly integrity: "ok";
  readonly foreignKeyViolations: number;
  readonly linkedEvents: number;
  readonly batchedEvents: number;
  readonly summaryCharacters: number;
  readonly settings: number;
  readonly sessions: number;
  readonly practiceSessions: number;
  readonly testSessions: number;
  readonly gameSessions: number;
  readonly tests: number;
  readonly gameRuns: number;
  readonly errors: number;
  readonly backspaces: number;
  readonly shifted: number;
  readonly digits: number;
  readonly symbols: number;
  readonly dailyCharacters: number;
}

export interface FixtureManifestEntry {
  readonly id: FixtureId;
  readonly relativePath: string;
  readonly eventCount: number;
  readonly byteSize: number;
  readonly sha256: string;
  readonly schemaVersion: number;
  readonly sqliteVersion: string;
  readonly validation: FixtureValidation;
}

export interface FixtureManifest {
  readonly schemaVersion: 1;
  readonly seed: number;
  readonly fixedUtc: string;
  readonly timeZone: "UTC";
  readonly profileId: "local-profile";
  readonly fixtures: readonly FixtureManifestEntry[];
}

export const PERF_FIXTURE_SPECS: readonly FixtureSpec[] = Object.freeze([
  { id: "empty", eventCount: 0, filename: "empty.sqlite3" },
  { id: "1k", eventCount: 1_000, filename: "1k.sqlite3" },
  { id: "100k", eventCount: 100_000, filename: "100k.sqlite3" },
  { id: "1m", eventCount: 1_000_000, filename: "1m.sqlite3" }
]);

export function resolvePerfDataRoot(root?: string): string {
  return resolve(root ?? ".symtype-perf-data");
}

export function fixtureDatabasePath(spec: FixtureSpec | FixtureId, root?: string): string {
  const selected = typeof spec === "string" ? getFixtureSpec(spec) : spec;
  return join(resolvePerfDataRoot(root), "fixtures", selected.filename);
}

export function fixtureManifestPath(root?: string): string {
  return join(resolvePerfDataRoot(root), "manifest.json");
}

export function loadFixtureManifest(root?: string): FixtureManifest {
  return readJsonFile<FixtureManifest>(fixtureManifestPath(root));
}

export function getFixtureSpec(id: FixtureId): FixtureSpec {
  const spec = PERF_FIXTURE_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Unknown performance fixture: ${id}`);
  return spec;
}
