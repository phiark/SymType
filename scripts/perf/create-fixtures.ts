import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  FIXED_PROFILE_ID,
  FIXED_TIME_ZONE,
  FIXED_UTC,
  FIXTURE_SEED
} from "./lib/fixture-constants.js";
import { checkpointAndClose, createProductionSchema } from "./lib/fixture-schema.js";
import { validateFixtureDatabase } from "./lib/fixture-validation.js";
import { insertFixtureWorkload } from "./lib/fixture-workload.js";
import {
  fixtureDatabasePath,
  fixtureManifestPath,
  loadFixtureManifest,
  PERF_FIXTURE_SPECS,
  resolvePerfDataRoot,
  type FixtureId,
  type FixtureManifest,
  type FixtureManifestEntry,
  type FixtureSpec
} from "./lib/fixtures.js";
import { sha256File, writeJsonAtomic } from "./lib/json-files.js";

export interface CreateFixtureOptions {
  readonly root?: string;
  readonly sizes?: readonly FixtureId[];
  readonly verifyOnly?: boolean;
}

export async function createFixtures(options: CreateFixtureOptions = {}): Promise<FixtureManifest> {
  const root = resolvePerfDataRoot(options.root);
  const selected = selectSpecs(options.sizes);
  if (options.verifyOnly) return verifyExisting(root, selected);
  for (const spec of selected) {
    process.stdout.write(`Creating ${spec.id} fixture (${spec.eventCount} events)...\n`);
    await createOne(root, spec);
  }
  const entries = await collectExistingEntries(root);
  const manifest: FixtureManifest = {
    schemaVersion: 1,
    seed: FIXTURE_SEED,
    fixedUtc: FIXED_UTC,
    timeZone: FIXED_TIME_ZONE,
    profileId: FIXED_PROFILE_ID,
    fixtures: entries
  };
  writeJsonAtomic(fixtureManifestPath(root), manifest);
  return manifest;
}

async function createOne(root: string, spec: FixtureSpec): Promise<FixtureManifestEntry> {
  const path = fixtureDatabasePath(spec, root);
  const database = createProductionSchema(path);
  try {
    insertFixtureWorkload(database, spec.eventCount);
  } finally {
    checkpointAndClose(database);
  }
  return createManifestEntry(root, spec);
}

async function collectExistingEntries(root: string): Promise<FixtureManifestEntry[]> {
  const entries: FixtureManifestEntry[] = [];
  for (const spec of PERF_FIXTURE_SPECS) {
    if (existsSync(fixtureDatabasePath(spec, root)))
      entries.push(await createManifestEntry(root, spec));
  }
  return entries;
}

async function createManifestEntry(root: string, spec: FixtureSpec): Promise<FixtureManifestEntry> {
  const path = fixtureDatabasePath(spec, root);
  const validated = validateFixtureDatabase(path, spec);
  return {
    id: spec.id,
    relativePath: `fixtures/${spec.filename}`,
    eventCount: spec.eventCount,
    byteSize: statSync(path).size,
    sha256: await sha256File(path),
    schemaVersion: validated.schemaVersion,
    sqliteVersion: validated.sqliteVersion,
    validation: validated.validation
  };
}

async function verifyExisting(
  root: string,
  selected: readonly FixtureSpec[]
): Promise<FixtureManifest> {
  const manifest = loadFixtureManifest(root);
  for (const spec of selected) {
    const expected = manifest.fixtures.find((entry) => entry.id === spec.id);
    if (!expected) throw new Error(`Fixture manifest is missing ${spec.id}`);
    const actual = await createManifestEntry(root, spec);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Fixture ${spec.id} does not match its manifest`);
    }
  }
  return manifest;
}

function selectSpecs(ids?: readonly FixtureId[]): readonly FixtureSpec[] {
  if (!ids || ids.length === 0) return PERF_FIXTURE_SPECS;
  const selected = new Set(ids);
  return PERF_FIXTURE_SPECS.filter((spec) => selected.has(spec.id));
}

function parseArguments(arguments_: readonly string[]): CreateFixtureOptions {
  let root: string | undefined;
  let sizes: FixtureId[] | undefined;
  let verifyOnly = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--root") root = requiredValue(arguments_, ++index, argument);
    else if (argument === "--sizes")
      sizes = parseSizes(requiredValue(arguments_, ++index, argument));
    else if (argument === "--verify-only") verifyOnly = true;
    else throw new Error(`Unknown fixture argument: ${argument}`);
  }
  return { ...(root ? { root } : {}), ...(sizes ? { sizes } : {}), verifyOnly };
}

function parseSizes(value: string): FixtureId[] {
  const values = value.split(",");
  const allowed = new Set(PERF_FIXTURE_SPECS.map((spec) => spec.id));
  for (const id of values) {
    if (!allowed.has(id as FixtureId)) throw new Error(`Unknown fixture size: ${id}`);
  }
  return values as FixtureId[];
}

function requiredValue(arguments_: readonly string[], index: number, flag: string): string {
  const value = arguments_[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const manifest = await createFixtures(parseArguments(process.argv.slice(2)));
  process.stdout.write(`Validated ${manifest.fixtures.length} fixture(s).\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
