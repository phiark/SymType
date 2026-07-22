import {
  persistedGameLevelSummarySchema,
  persistedLayoutSnapshotSchema,
  persistedSessionSummarySchema,
  persistedSettingsSchema,
  persistedTestErrorsSchema
} from "@symtype/shared";
import Database from "better-sqlite3";

import type { FixtureSpec, FixtureValidation } from "./fixtures.js";

export interface ValidatedFixture {
  readonly schemaVersion: number;
  readonly sqliteVersion: string;
  readonly validation: FixtureValidation;
}

export function validateFixtureDatabase(path: string, spec: FixtureSpec): ValidatedFixture {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const validation = collectValidation(database);
    const schemaVersion = scalar(
      database,
      "SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations"
    );
    const sqliteVersion = String(
      (database.prepare("SELECT sqlite_version() AS value").get() as { value: string }).value
    );
    assertFixture(spec, validation);
    validatePersistedJson(database);
    return { schemaVersion, sqliteVersion, validation };
  } finally {
    database.close();
  }
}

function collectValidation(database: Database.Database): FixtureValidation {
  const quickCheck = database.pragma("quick_check") as { quick_check: string }[];
  const integrity = quickCheck.length === 1 && quickCheck[0]?.quick_check === "ok" ? "ok" : "bad";
  if (integrity !== "ok")
    throw new Error(`Fixture quick_check failed: ${JSON.stringify(quickCheck)}`);
  const byKind = (kind: string) =>
    scalar(database, "SELECT COUNT(*) AS value FROM sessions WHERE kind = ?", kind);
  return {
    integrity,
    foreignKeyViolations: (database.pragma("foreign_key_check") as unknown[]).length,
    linkedEvents: scalar(
      database,
      `SELECT COUNT(*) AS value FROM keystroke_events e
       JOIN lessons l ON l.id = e.lesson_id AND l.session_id = e.session_id
       JOIN micro_blocks b ON b.id = e.block_id AND b.lesson_id = l.id`
    ),
    batchedEvents: scalar(
      database,
      "SELECT COALESCE(SUM(event_count), 0) AS value FROM event_batches"
    ),
    summaryCharacters: scalar(
      database,
      "SELECT COALESCE(SUM(json_extract(summary_json, '$.characters')), 0) AS value FROM sessions"
    ),
    settings: scalar(database, "SELECT COUNT(*) AS value FROM settings"),
    sessions: scalar(database, "SELECT COUNT(*) AS value FROM sessions"),
    practiceSessions: byKind("training"),
    testSessions: byKind("test"),
    gameSessions: byKind("game"),
    tests: scalar(database, "SELECT COUNT(*) AS value FROM tests"),
    gameRuns: scalar(database, "SELECT COUNT(*) AS value FROM game_runs"),
    errors: scalar(database, "SELECT COUNT(*) AS value FROM keystroke_events WHERE is_correct = 0"),
    backspaces: scalar(
      database,
      "SELECT COUNT(*) AS value FROM keystroke_events WHERE backspace_count > 0"
    ),
    shifted: scalar(
      database,
      "SELECT COUNT(*) AS value FROM keystroke_events WHERE json_extract(modifiers_json, '$.shift') = 1"
    ),
    digits: scalar(
      database,
      "SELECT COUNT(*) AS value FROM keystroke_events WHERE character_class = 'digit'"
    ),
    symbols: scalar(
      database,
      "SELECT COUNT(*) AS value FROM keystroke_events WHERE character_class = 'symbol'"
    ),
    dailyCharacters: scalar(
      database,
      "SELECT COALESCE(SUM(character_count), 0) AS value FROM daily_summaries"
    )
  };
}

function assertFixture(spec: FixtureSpec, value: FixtureValidation): void {
  const issues: string[] = [];
  if (value.foreignKeyViolations !== 0) issues.push("foreign keys");
  if (value.linkedEvents !== spec.eventCount) issues.push("linked events");
  if (value.batchedEvents !== spec.eventCount) issues.push("event batches");
  if (value.summaryCharacters !== spec.eventCount) issues.push("session summaries");
  if (value.dailyCharacters !== spec.eventCount) issues.push("daily summaries");
  if (value.settings !== 1) issues.push("settings");
  if (spec.eventCount > 0) {
    if (value.practiceSessions === 0 || value.testSessions === 0 || value.gameSessions === 0) {
      issues.push("session kinds");
    }
    if (value.tests !== value.testSessions) issues.push("test rows");
    if (value.gameRuns !== value.gameSessions) issues.push("game rows");
    if ([value.errors, value.backspaces, value.shifted, value.digits, value.symbols].includes(0)) {
      issues.push("event variety");
    }
  } else if (value.sessions !== 0) issues.push("empty sessions");
  if (issues.length > 0)
    throw new Error(`Fixture ${spec.id} validation failed: ${issues.join(", ")}`);
}

function validatePersistedJson(database: Database.Database): void {
  validateRows(database, "SELECT value_json AS value FROM settings", persistedSettingsSchema);
  validateRows(
    database,
    "SELECT summary_json AS value FROM sessions",
    persistedSessionSummarySchema
  );
  validateRows(
    database,
    "SELECT layout_snapshot_json AS value FROM sessions",
    persistedLayoutSnapshotSchema
  );
  validateRows(database, "SELECT errors_json AS value FROM tests", persistedTestErrorsSchema);
  validateRows(
    database,
    "SELECT summary_json AS value FROM game_levels",
    persistedGameLevelSummarySchema
  );
}

function validateRows(
  database: Database.Database,
  sql: string,
  schema: { safeParse(value: unknown): { success: boolean } }
): void {
  const rows = database.prepare(sql).all() as { value: string }[];
  for (const [index, row] of rows.entries()) {
    const parsed = schema.safeParse(JSON.parse(row.value) as unknown);
    if (!parsed.success)
      throw new Error(`Fixture JSON schema mismatch at row ${index + 1}: ${sql}`);
  }
}

function scalar(database: Database.Database, sql: string, parameter?: string): number {
  const row = (
    parameter === undefined ? database.prepare(sql).get() : database.prepare(sql).get(parameter)
  ) as { value: number };
  return row.value;
}
