import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import {
  LONG_FORM_SAMPLES,
  builtInLongFormTextId,
  contentSources,
  selectLongFormSample
} from "@symtype/content";
import {
  characterForPhysicalKey,
  getKeyByCode,
  netWpm as calculateNetWpm,
  rawWpm as calculateRawWpm,
  persistedFeatureWindowSchema,
  persistedGameLevelSummarySchema,
  persistedJsonObjectSchema,
  persistedLayoutSnapshotSchema,
  persistedLessonFocusSchema,
  persistedModifiersSchema,
  persistedSessionSummarySchema,
  persistedSettingsSchema,
  persistedTestErrorsSchema,
  runtimeDefaultAdvancedWeights,
  runtimeSettingsSchema,
  SYMMETRIC_PRESET,
  type KeyboardPreset,
  type PersistedSessionSummary,
  type PersistedTestErrors,
  type RuntimeCorrectionCheckpoint,
  type RuntimeSettings,
  type RuntimeStoredEvent
} from "@symtype/shared";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import {
  buildExperimentReport,
  type ExperimentEvent,
  type ExperimentSession
} from "../domain/experiment-analysis.js";
import {
  analyzeSessionErrors,
  calculateSessionSummary,
  isErrorAnalysisSummary,
  mergeErrorAnalysis,
  summarizeFinalText,
  type ErrorAnalysisSummary,
  type SessionSummary,
  type SummaryEventRow
} from "../domain/session-analysis.js";
import {
  buildPeriodFeatures,
  buildPeriodGroups,
  median,
  medianAbsoluteDeviation,
  periodBounds,
  robustLearningSlope,
  type PeriodFeatureRow,
  type PeriodGroupRow,
  type StatisticsPeriod
} from "../domain/statistics-analysis.js";
import { migrations } from "./migrations.js";

export type { SessionSummary } from "../domain/session-analysis.js";

export const LOCAL_PROFILE_ID = "local-profile";
export const SYMMETRIC_LAYOUT_ID = "symmetric-default";
export const STANDARD_LAYOUT_ID = "standard-default";
export const ALGORITHM_VERSION = "adaptive-v1";

export type AppSettings = RuntimeSettings;

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingComplete: false,
  calibrationComplete: false,
  theme: "system",
  reducedMotion: false,
  keyboardVisible: true,
  keyboardFingerColors: true,
  soundEnabled: true,
  soundTheme: "soft",
  soundMode: "all",
  volume: 0.35,
  activeLayoutId: SYMMETRIC_LAYOUT_ID,
  stopOnError: false,
  backspaceMode: "enabled",
  fontSize: 30,
  lineHeight: 1.65,
  caretStyle: "bar",
  smoothScroll: true,
  targetWpm: 45,
  minimumAccuracy: 0.94,
  progressionAccuracy: 0.975,
  trainingBias: "balanced",
  defaultDurationMinutes: 10,
  experimentEnabled: false,
  advancedWeights: { ...runtimeDefaultAdvancedWeights }
};

export type StoredEvent = RuntimeStoredEvent;

export interface CreateSessionInput {
  kind: "calibration" | "training" | "test" | "game";
  mode: string;
  strategy?: string;
  seed: number;
  focus?: unknown;
  includeInModel?: boolean;
  stageId?:
    "home" | "index" | "other" | "top" | "bottom" | "numbers" | "symbols" | "shift" | undefined;
}

export interface VerifiedGameLevelResult {
  run: Record<string, unknown>;
  result: {
    outcome: "success" | "failure";
    score: number;
    alertValue: number;
    errorFree: boolean;
    completedStages: number;
    sessionId: string;
  };
}

export interface BuiltInLongFormSlice {
  readonly textId: string;
  readonly title: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceType: string;
  readonly license: string;
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly text: string;
}

function now(): string {
  return new Date().toISOString();
}

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parsePersistedJson<T>(value: string, label: string, schema: z.ZodType<T>): T {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      `Authoritative ${label} JSON is corrupted; restore a verified backup before continuing`
    );
  }
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `Authoritative ${label} JSON does not match its schema; restore a verified backup before continuing`
    );
  }
  return parsed.data;
}

function parseAuthoritativeSettings(value: string): AppSettings {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      "Authoritative settings JSON is corrupted; restore a verified backup before changing settings"
    );
  }
  const parsed = persistedSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      "Authoritative settings do not match the current schema; restore a verified backup before changing settings"
    );
  }
  return parsed.data;
}

function sha256(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function batchFingerprint(
  lessonId: string | undefined,
  blockId: string | undefined,
  events: readonly StoredEvent[]
): string {
  const normalized = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => ({
      sequence: event.sequence,
      clientTimeMs: event.clientTimeMs,
      targetChar: event.targetChar,
      actualChar: event.actualChar,
      physicalCode: event.physicalCode,
      shiftSide: event.shiftSide ?? "none",
      modifiers: Object.fromEntries(
        Object.entries(event.modifiers ?? {}).sort(([left], [right]) => left.localeCompare(right))
      ),
      isCorrect: event.isCorrect,
      isCorrection: event.isCorrection ?? false,
      backspaceCount: event.backspaceCount ?? 0,
      ikiMs: event.ikiMs ?? null,
      featureChar: event.featureChar ?? event.targetChar,
      bigram: event.bigram ?? null,
      trigram: event.trigram ?? null,
      mappedHand: event.mappedHand ?? "unknown",
      mappedFinger: event.mappedFinger ?? "unknown",
      keyboardRow: event.keyboardRow ?? "unknown",
      zone: event.zone ?? "unknown",
      characterClass: event.characterClass ?? "unknown",
      contentMode: event.contentMode ?? "unknown",
      textPosition: event.textPosition,
      isWordBoundary: event.isWordBoundary ?? false,
      isAfterError: event.isAfterError ?? false,
      wasRefocus: event.wasRefocus ?? false,
      wasPaused: event.wasPaused ?? false,
      wasLongPause: event.wasLongPause ?? false,
      wasThrottled: event.wasThrottled ?? false,
      wasRepeat: event.wasRepeat ?? false
    }));
  return sha256(
    Buffer.from(json({ lessonId: lessonId ?? null, blockId: blockId ?? null, events: normalized }))
  );
}

const BACKUP_TABLES = [
  "profiles",
  "settings",
  "keyboard_layouts",
  "key_mappings",
  "sessions",
  "lessons",
  "micro_blocks",
  "event_batches",
  "keystroke_events",
  "feature_stats",
  "daily_summaries",
  "goals",
  "streaks",
  "tests",
  "personal_bests",
  "game_runs",
  "game_levels",
  "achievements",
  "content_sources",
  "custom_texts"
] as const;

const RESTORE_DELETE_ORDER = [
  "game_levels",
  "achievements",
  "game_runs",
  "personal_bests",
  "tests",
  "keystroke_events",
  "event_batches",
  "micro_blocks",
  "lessons",
  "sessions",
  "feature_stats",
  "daily_summaries",
  "streaks",
  "goals",
  "custom_texts",
  "content_sources",
  "key_mappings",
  "keyboard_layouts",
  "settings",
  "profiles"
] as const;

const SQLITE_SNAPSHOT_TABLES = ["schema_migrations", ...BACKUP_TABLES, "backups"] as const;
const PRE_MIGRATION_SNAPSHOTS_PER_PATH = 2;

interface CanonicalSessionMetric {
  id: string;
  kind: string;
  activeMs: number;
  completedAt: string;
  localDate: string;
  characters: number;
  correct: number;
  uncorrectedErrors: number;
  consistency: number;
}

interface CanonicalMetricAggregate {
  sessions: number;
  active_ms: number;
  characters: number;
  correct: number;
  errors: number;
  uncorrected_errors: number;
  raw_wpm: number;
  net_wpm: number;
  accuracy: number;
  consistency: number;
}

interface CanonicalDailyMetric extends CanonicalMetricAggregate {
  local_date: string;
  kind: string;
  character_count: number;
  correct_count: number;
}

interface CanonicalizedSessionSummary {
  summary: PersistedSessionSummary;
  uncorrectedErrors: number;
}

function sessionPreset(snapshotJson: string | null): KeyboardPreset {
  if (!snapshotJson) return SYMMETRIC_PRESET;
  const snapshot = parsePersistedJson(
    snapshotJson,
    "session layout snapshot",
    persistedLayoutSnapshotSchema
  );
  const mappings = new Map(snapshot.mappings.map((mapping) => [mapping.physical_code, mapping]));
  return {
    id: snapshot.layout.id,
    name: snapshot.layout.name,
    basedOn: snapshot.layout.preset === "standard" ? "standard" : "symmetric",
    keys: SYMMETRIC_PRESET.keys.map((key) => {
      const mapping = mappings.get(key.code);
      if (!mapping) throw new Error(`Session layout snapshot is missing ${key.code}`);
      return {
        ...key,
        unshifted: mapping.unshifted,
        shifted: mapping.shifted,
        hand: mapping.hand,
        finger: mapping.finger,
        row: mapping.keyboard_row,
        zone: mapping.zone,
        width: mapping.key_width
      };
    })
  };
}

function authoritativeCharacterClass(character: string): string {
  if (/[a-z]/u.test(character)) return "lowercase";
  if (/[A-Z]/u.test(character)) return "uppercase";
  if (/\d/u.test(character)) return "digit";
  if (/\s/u.test(character)) return "whitespace";
  return "symbol";
}

/**
 * A browser reports the physical key separately from the printable character.
 * Reconstruct the ANSI-US character from the immutable session snapshot so a
 * client cannot claim that a wrong physical key was correct. Enter and Tab are
 * printable training controls even though their keyboard definitions are not.
 */
function authoritativeActualCharacter(
  preset: KeyboardPreset,
  physicalCode: string,
  modifiers: Readonly<Record<string, boolean>>
): string | null {
  if (physicalCode === "Enter") return "\n";
  if (physicalCode === "Tab") return "\t";
  const key = getKeyByCode(preset, physicalCode);
  if (!key) return null;
  return characterForPhysicalKey(key, modifiers.shift === true, modifiers.capsLock === true);
}

function authoritativeContentMode(
  session: { kind: string; mode: string },
  blockType: string
): string {
  if (session.kind === "calibration" && blockType.startsWith("calibration-")) return blockType;
  if (session.kind === "game") {
    const level = session.mode.match(/^pineapple-level-(\d+)$/u)?.[1];
    return level ? `game-${level}` : "game";
  }
  return session.mode;
}

function sessionSummaryForPersistence(
  summary: SessionSummary,
  rows: readonly SummaryEventRow[],
  correctionCheckpoint?: RuntimeCorrectionCheckpoint
): PersistedSessionSummary {
  return persistedSessionSummarySchema.parse({
    ...summary,
    metricVersion: 1,
    uncorrectedErrors: summarizeFinalText(rows, correctionCheckpoint).uncorrectedErrors
  });
}

function publicSessionSummary(summary: PersistedSessionSummary): SessionSummary {
  const publicSummary = { ...summary };
  delete publicSummary.metricVersion;
  delete publicSummary.uncorrectedErrors;
  return publicSummary;
}

export class SymTypeDatabase {
  readonly db: Database.Database;
  readonly config: ServerConfig;
  private readonly statisticsCache = new Map<
    StatisticsPeriod,
    { token: string; report: Record<string, unknown> }
  >();
  private integrityCache: { token: string; result: { ok: boolean; detail: string } } | undefined;

  constructor(config: ServerConfig) {
    this.config = config;
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(join(config.dataDir, "backups"), { recursive: true });
    mkdirSync(join(config.dataDir, "logs"), { recursive: true });
    mkdirSync(join(config.dataDir, "restore-staging"), { recursive: true });
    this.cleanupSqliteStaging();
    this.db = new Database(config.databasePath);
    this.configure();
    this.migrate();
    this.seed();
  }

  private configure(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
  }

  private migrate(): void {
    const migrationTableExists = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`
      )
      .get();
    if (!migrationTableExists) {
      this.db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
    }
    const applied = new Set(
      this.db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => (row as { version: number }).version)
    );
    const pending = migrations.filter((migration) => !applied.has(migration.version));
    if (applied.size > 0 && pending.length > 0) {
      const fromVersion = Math.max(...applied);
      const toVersion = pending.at(-1)?.version;
      if (toVersion == null) throw new Error("Pending migration target is missing");
      this.createPreMigrationSnapshot(fromVersion, toVersion);
    }
    for (const migration of pending) {
      const run = this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)")
          .run(migration.version, migration.name, now());
      });
      run();
    }
  }

  private migrationSnapshotCounts(source: Database.Database): Record<string, number> {
    const existingTables = new Set(
      (
        source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name)
    );
    const missing = SQLITE_SNAPSHOT_TABLES.filter((table) => !existingTables.has(table));
    if (missing.length > 0) {
      throw new Error(`Database is missing required table(s): ${missing.join(", ")}`);
    }
    return Object.fromEntries(
      SQLITE_SNAPSHOT_TABLES.map((table) => [
        table,
        (
          source.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count
      ])
    );
  }

  private migrationSnapshotIntegrity(
    source: Database.Database,
    expectedVersion: number,
    expectedCounts: Readonly<Record<string, number>>
  ): { ok: boolean; detail: string } {
    try {
      const quick = (source.pragma("quick_check") as { quick_check: string }[])
        .map((row) => row.quick_check)
        .join("; ");
      const foreignKeys = source.pragma("foreign_key_check") as unknown[];
      const version = (
        source
          .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
          .get() as { version: number }
      ).version;
      const counts = this.migrationSnapshotCounts(source);
      const mismatchedCounts = SQLITE_SNAPSHOT_TABLES.filter(
        (table) => counts[table] !== expectedCounts[table]
      );
      const ok =
        quick === "ok" &&
        foreignKeys.length === 0 &&
        version === expectedVersion &&
        mismatchedCounts.length === 0;
      return {
        ok,
        detail: [
          quick,
          ...(foreignKeys.length ? [`${foreignKeys.length} foreign-key violation(s)`] : []),
          ...(version !== expectedVersion
            ? [`schema version ${version}, expected ${expectedVersion}`]
            : []),
          ...(mismatchedCounts.length
            ? [`row-count mismatch in ${mismatchedCounts.join(", ")}`]
            : [])
        ].join("; ")
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "unreadable migration snapshot"
      };
    }
  }

  private createPreMigrationSnapshot(fromVersion: number, toVersion: number): void {
    const sourceCounts = this.migrationSnapshotCounts(this.db);
    const sourceIntegrity = this.migrationSnapshotIntegrity(this.db, fromVersion, sourceCounts);
    if (!sourceIntegrity.ok) {
      throw new Error(
        `Database integrity check failed before migration backup: ${sourceIntegrity.detail}`
      );
    }

    const id = randomUUID();
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const reason = `pre-migration-v${fromVersion}-to-v${toVersion}`;
    const path = join(
      this.config.dataDir,
      "backups",
      `symtype-${reason}-${stamp}-${id.slice(0, 8)}.sqlite3`
    );
    let recorded = false;
    try {
      this.db.prepare("VACUUM INTO ?").run(path);
      if (process.platform !== "win32") chmodSync(path, 0o600);
      const snapshot = new Database(path, { readonly: true, fileMustExist: true });
      let validation: { ok: boolean; detail: string };
      try {
        validation = this.migrationSnapshotIntegrity(snapshot, fromVersion, sourceCounts);
      } finally {
        snapshot.close();
      }
      if (!validation.ok) {
        throw new Error(`Pre-migration backup integrity check failed: ${validation.detail}`);
      }
      const bytes = readFileSync(path);
      this.db
        .prepare(
          `INSERT INTO backups(id, path, reason, byte_size, schema_version, checksum, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, path, reason, bytes.length, fromVersion, sha256(bytes), now());
      recorded = true;
      this.prunePreMigrationSnapshots(reason, id);
    } catch (error) {
      if (recorded || existsSync(path)) this.removeBackupFileAndMetadata(id, path);
      throw error;
    }
  }

  private removeBackupFileAndMetadata(id: string, path: string): boolean {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      return false;
    }
    try {
      this.db.prepare("DELETE FROM backups WHERE id = ?").run(id);
      return true;
    } catch {
      // The path is already gone. Keep startup and rotation non-blocking; a
      // later pass can remove metadata that now points to a missing file.
      return false;
    }
  }

  private prunePreMigrationSnapshots(reason: string, requiredId: string): void {
    const records = this.db
      .prepare(
        `SELECT id, path, schema_version, checksum
         FROM backups
         WHERE reason = ?
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC, rowid DESC`
      )
      .all(reason, requiredId) as {
      id: string;
      path: string;
      schema_version: number;
      checksum: string;
    }[];
    let retained = 0;
    for (const record of records) {
      const validation = existsSync(record.path)
        ? this.validateMigrationSnapshotFile(record.path, record.schema_version)
        : { ok: false, detail: "missing", checksum: "" };
      const valid = validation.ok && validation.checksum === record.checksum;
      if (record.id === requiredId && !valid) {
        throw new Error(`New pre-migration snapshot became invalid: ${validation.detail}`);
      }
      if (valid && retained < PRE_MIGRATION_SNAPSHOTS_PER_PATH) {
        retained += 1;
        continue;
      }
      // Retention is best effort after the required snapshot is verified. Keep
      // metadata when unlink fails so a later maintenance pass can retry without
      // sacrificing the new recovery point or blocking the pending migration.
      this.removeBackupFileAndMetadata(record.id, record.path);
    }
  }

  private seed(): void {
    const timestamp = now();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO profiles(id, display_name, created_at, updated_at) VALUES(?, ?, ?, ?)"
        )
        .run(LOCAL_PROFILE_ID, "Local typist", timestamp, timestamp);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO settings(profile_id, value_json, version, updated_at) VALUES(?, ?, 1, ?)"
        )
        .run(LOCAL_PROFILE_ID, json(DEFAULT_SETTINGS), timestamp);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO keyboard_layouts
           (id, profile_id, name, preset, is_active, created_at, updated_at)
           VALUES(?, NULL, ?, ?, ?, ?, ?)`
        )
        .run(SYMMETRIC_LAYOUT_ID, "Symmetric（默认）", "symmetric", 1, timestamp, timestamp);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO keyboard_layouts
           (id, profile_id, name, preset, is_active, created_at, updated_at)
           VALUES(?, NULL, ?, ?, ?, ?, ?)`
        )
        .run(STANDARD_LAYOUT_ID, "Standard", "standard", 0, timestamp, timestamp);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO goals
           (id, profile_id, daily_minutes, target_wpm, minimum_accuracy, effective_from, updated_at)
           VALUES('primary-goal', ?, 10, 45, 0.94, ?, ?)`
        )
        .run(LOCAL_PROFILE_ID, timestamp.slice(0, 10), timestamp);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO streaks(profile_id, current_days, longest_days) VALUES(?, 0, 0)"
        )
        .run(LOCAL_PROFILE_ID);
      this.seedBundledContent(timestamp);
    });
    run();
  }

  private seedBundledContent(timestamp: string): void {
    const insertSource = this.db.prepare(
      `INSERT OR IGNORE INTO content_sources
       (id, name, source_type, license, source_url, is_builtin, created_at)
       VALUES(?, ?, ?, ?, NULL, 1, ?)`
    );
    for (const source of contentSources) {
      insertSource.run(source.id, source.title, source.provenance, json(source.license), timestamp);
    }
    const insertBuiltInText = this.db.prepare(
      `INSERT OR IGNORE INTO custom_texts
       (id, profile_id, title, source_id, content, file_type, character_count, word_count,
        include_in_model, reading_position, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, 'txt', ?, ?, 0, 0, ?, ?)`
    );
    for (const sample of LONG_FORM_SAMPLES) {
      insertBuiltInText.run(
        builtInLongFormTextId(sample.id),
        LOCAL_PROFILE_ID,
        sample.title,
        sample.sourceId,
        sample.text,
        sample.text.length,
        sample.wordCount,
        timestamp,
        timestamp
      );
    }
  }

  getSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    return row.version;
  }

  private storedJsonIntegrityFailures(source: Database.Database = this.db): string[] {
    const failures: string[] = [];
    const columns = [
      ["settings", "value_json", "object", false],
      ["sessions", "summary_json", "object", true],
      ["sessions", "layout_snapshot_json", "object", true],
      ["lessons", "focus_json", "array", false],
      ["micro_blocks", "summary_json", "object", true],
      ["keystroke_events", "modifiers_json", "object", false],
      ["feature_stats", "recent_window_json", "array", false],
      ["tests", "errors_json", "object", false],
      ["game_levels", "summary_json", "object", true],
      ["achievements", "metadata_json", "object", false]
    ] as const;
    for (const [table, column, expectedType, nullable] of columns) {
      const nullClause = nullable ? `${column} IS NOT NULL AND ` : "";
      const row = source
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table}
           WHERE ${nullClause}(
             json_valid(${column}) <> 1 OR
             CASE WHEN json_valid(${column}) = 1 THEN json_type(${column}) <> ? ELSE 0 END
           )`
        )
        .get(expectedType) as { count: number };
      if (row.count > 0) failures.push(`${table}.${column}: ${row.count} invalid row(s)`);
    }

    const validateColumn = (
      table: string,
      column: string,
      label: string,
      schema: z.ZodType,
      nullable = false
    ) => {
      const rows = source
        .prepare(
          `SELECT rowid AS record_id, ${column} AS value FROM ${table}${
            nullable ? ` WHERE ${column} IS NOT NULL` : ""
          }`
        )
        .all() as { record_id: number; value: string }[];
      for (const row of rows) {
        let candidate: unknown;
        try {
          candidate = JSON.parse(row.value) as unknown;
        } catch {
          continue;
        }
        if (!schema.safeParse(candidate).success) {
          failures.push(`${label}: schema mismatch at row ${row.record_id}`);
          if (failures.length >= 20) return;
        }
      }
    };

    validateColumn("settings", "value_json", "settings.value_json", persistedSettingsSchema);
    validateColumn(
      "sessions",
      "summary_json",
      "sessions.summary_json",
      persistedSessionSummarySchema,
      true
    );
    validateColumn(
      "sessions",
      "layout_snapshot_json",
      "sessions.layout_snapshot_json",
      persistedLayoutSnapshotSchema,
      true
    );
    validateColumn("lessons", "focus_json", "lessons.focus_json", persistedLessonFocusSchema);
    validateColumn(
      "micro_blocks",
      "summary_json",
      "micro_blocks.summary_json",
      persistedJsonObjectSchema,
      true
    );
    validateColumn(
      "feature_stats",
      "recent_window_json",
      "feature_stats.recent_window_json",
      persistedFeatureWindowSchema
    );
    validateColumn(
      "keystroke_events",
      "modifiers_json",
      "keystroke_events.modifiers_json",
      persistedModifiersSchema
    );
    validateColumn("tests", "errors_json", "tests.errors_json", persistedTestErrorsSchema);
    validateColumn(
      "game_levels",
      "summary_json",
      "game_levels.summary_json",
      persistedGameLevelSummarySchema,
      true
    );
    validateColumn(
      "achievements",
      "metadata_json",
      "achievements.metadata_json",
      persistedJsonObjectSchema
    );
    return failures;
  }

  private databaseRevision(): string {
    const totalChanges = this.db.prepare("SELECT total_changes() AS count").get() as {
      count: number;
    };
    const dataVersion = this.db.pragma("data_version", { simple: true }) as number;
    return `${totalChanges.count}:${dataVersion}`;
  }

  integrityCheck(options: { refresh?: boolean } = {}): { ok: boolean; detail: string } {
    const token = this.databaseRevision();
    if (!options.refresh && this.integrityCache?.token === token) {
      return this.integrityCache.result;
    }
    const rows = this.db.pragma("quick_check") as { quick_check: string }[];
    const quickCheck = rows.map((row) => row.quick_check).join("; ");
    const foreignKeyFailures = this.db.pragma("foreign_key_check") as unknown[];
    const jsonFailures = this.storedJsonIntegrityFailures();
    const ok = quickCheck === "ok" && foreignKeyFailures.length === 0 && jsonFailures.length === 0;
    const detail = [
      quickCheck,
      ...(foreignKeyFailures.length
        ? [`foreign_key_check: ${foreignKeyFailures.length} violation(s)`]
        : []),
      ...jsonFailures
    ].join("; ");
    const result = { ok, detail };
    this.integrityCache = { token: this.databaseRevision(), result };
    return result;
  }

  getSettings(): AppSettings {
    const row = this.db
      .prepare("SELECT value_json FROM settings WHERE profile_id = ?")
      .get(LOCAL_PROFILE_ID) as { value_json: string } | undefined;
    if (!row) {
      throw new Error(
        "Authoritative settings row is missing; restore a verified backup before changing settings"
      );
    }
    return parseAuthoritativeSettings(row.value_json);
  }

  updateSettings(patch: {
    [Key in keyof AppSettings]?: AppSettings[Key] | undefined;
  }): AppSettings {
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(
        (entry): entry is [string, AppSettings[keyof AppSettings]] => entry[1] !== undefined
      )
    ) as Partial<AppSettings>;
    const next = runtimeSettingsSchema.parse({ ...this.getSettings(), ...definedPatch });
    if (definedPatch.activeLayoutId) this.assertSelectableLayout(definedPatch.activeLayoutId);
    const timestamp = now();
    const change = this.db.transaction(() => {
      this.writeSettings(next, timestamp);
      if (definedPatch.activeLayoutId) {
        this.activateLayout(definedPatch.activeLayoutId, timestamp);
      }
    });
    change();
    return next;
  }

  updatePreferences(
    patch: { [Key in keyof AppSettings]?: AppSettings[Key] | undefined },
    goal: { dailyMinutes: number; targetWpm: number; minimumAccuracy: number }
  ): { settings: AppSettings; goal: Record<string, unknown> } {
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(
        (entry): entry is [string, AppSettings[keyof AppSettings]] => entry[1] !== undefined
      )
    ) as Partial<AppSettings>;
    const next = runtimeSettingsSchema.parse({ ...this.getSettings(), ...definedPatch });
    if (definedPatch.activeLayoutId) this.assertSelectableLayout(definedPatch.activeLayoutId);
    const timestamp = now();
    const save = this.db.transaction(() => {
      this.writeSettings(next, timestamp);
      if (definedPatch.activeLayoutId) {
        this.activateLayout(definedPatch.activeLayoutId, timestamp);
      }
      const result = this.db
        .prepare(
          `UPDATE goals SET daily_minutes = ?, target_wpm = ?, minimum_accuracy = ?, updated_at = ?
           WHERE id = 'primary-goal' AND profile_id = ?`
        )
        .run(goal.dailyMinutes, goal.targetWpm, goal.minimumAccuracy, timestamp, LOCAL_PROFILE_ID);
      if (result.changes !== 1) throw new Error("Primary goal not found");
    });
    save();
    return { settings: next, goal: this.getGoal() };
  }

  private writeSettings(settings: AppSettings, timestamp: string): void {
    const result = this.db
      .prepare(
        "UPDATE settings SET value_json = ?, version = version + 1, updated_at = ? WHERE profile_id = ?"
      )
      .run(json(settings), timestamp, LOCAL_PROFILE_ID);
    if (result.changes !== 1) throw new Error("Local settings not found");
  }

  private assertSelectableLayout(layoutId: string): void {
    const layout = this.db
      .prepare(
        `SELECT l.id, COUNT(m.physical_code) AS mapping_count
         FROM keyboard_layouts l
         LEFT JOIN key_mappings m ON m.layout_id = l.id
         WHERE l.id = ? AND (l.profile_id IS NULL OR l.profile_id = ?)
         GROUP BY l.id`
      )
      .get(layoutId, LOCAL_PROFILE_ID) as { id: string; mapping_count: number } | undefined;
    if (!layout || layout.mapping_count === 0) {
      throw new Error("Selected keyboard layout does not exist or has no mappings");
    }
  }

  private activateLayout(layoutId: string, timestamp: string): void {
    this.db
      .prepare(
        "UPDATE keyboard_layouts SET is_active = 0 WHERE profile_id IS NULL OR profile_id = ?"
      )
      .run(LOCAL_PROFILE_ID);
    const result = this.db
      .prepare(
        `UPDATE keyboard_layouts SET is_active = 1, updated_at = ?
         WHERE id = ? AND (profile_id IS NULL OR profile_id = ?)`
      )
      .run(timestamp, layoutId, LOCAL_PROFILE_ID);
    if (result.changes !== 1) throw new Error("Selected keyboard layout does not exist");
  }

  getProfile(): Record<string, unknown> {
    return this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(LOCAL_PROFILE_ID) as Record<
      string,
      unknown
    >;
  }

  listLayouts(): Record<string, unknown>[] {
    const layouts = this.db
      .prepare("SELECT * FROM keyboard_layouts ORDER BY preset, created_at")
      .all() as Record<string, unknown>[];
    const mappings = this.db
      .prepare("SELECT * FROM key_mappings ORDER BY layout_id, physical_code")
      .all() as Record<string, unknown>[];
    return layouts.map((layout) => ({
      ...layout,
      mappings: mappings.filter((mapping) => mapping.layout_id === layout.id)
    }));
  }

  getActiveLayoutMappings(): {
    code: string;
    unshifted: string;
    shifted: string;
    hand: string;
    finger: string;
    row: string;
    zone: string;
  }[] {
    return this.db
      .prepare(
        `SELECT m.physical_code AS code, m.unshifted, m.shifted, m.hand, m.finger,
                m.keyboard_row AS row, m.zone
         FROM key_mappings m JOIN keyboard_layouts l ON l.id = m.layout_id
         WHERE l.is_active = 1 ORDER BY m.physical_code`
      )
      .all() as ReturnType<SymTypeDatabase["getActiveLayoutMappings"]>;
  }

  replaceLayoutMappings(
    layoutId: string,
    mappings: readonly Record<string, string | number>[]
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO key_mappings
       (layout_id, physical_code, unshifted, shifted, hand, finger, keyboard_row, zone, key_width)
       VALUES(@layoutId, @code, @unshifted, @shifted, @hand, @finger, @row, @zone, @width)`
    );
    const run = this.db.transaction(() => {
      this.db.prepare("DELETE FROM key_mappings WHERE layout_id = ?").run(layoutId);
      for (const mapping of mappings) insert.run({ layoutId, ...mapping });
    });
    run();
  }

  createCustomLayout(name: string, baseLayoutId: string): string {
    const id = randomUUID();
    const timestamp = now();
    const copy = this.db.transaction(() => {
      const base = this.db
        .prepare("SELECT id FROM keyboard_layouts WHERE id = ?")
        .get(baseLayoutId) as { id: string } | undefined;
      if (!base) throw new Error("Base layout not found");
      this.db
        .prepare(
          `INSERT INTO keyboard_layouts
           (id, profile_id, name, preset, base_layout_id, is_active, created_at, updated_at)
           VALUES(?, ?, ?, 'custom', ?, 0, ?, ?)`
        )
        .run(id, LOCAL_PROFILE_ID, name, baseLayoutId, timestamp, timestamp);
      this.db
        .prepare(
          `INSERT INTO key_mappings
           SELECT ?, physical_code, unshifted, shifted, hand, finger, keyboard_row, zone, key_width
           FROM key_mappings WHERE layout_id = ?`
        )
        .run(id, baseLayoutId);
    });
    copy();
    return id;
  }

  createSession(input: CreateSessionInput): Record<string, unknown> {
    const id = randomUUID();
    const lessonId = randomUUID();
    const timestamp = now();
    const strategy = input.strategy ?? "adaptive";
    if (input.mode === "traditional") {
      const stage = this.getTraditionalProgress().stages.find(
        (candidate) => candidate.id === input.stageId
      );
      if (!stage || !stage.unlocked) throw new Error("Traditional stage is not unlocked");
    } else if (input.stageId) {
      throw new Error("Traditional stage does not belong to this session mode");
    }
    const create = this.db.transaction(() => {
      const activeLayout = this.db
        .prepare(
          `SELECT id, name, preset FROM keyboard_layouts
           WHERE is_active = 1 AND (profile_id IS NULL OR profile_id = ?)
           ORDER BY CASE WHEN profile_id = ? THEN 0 ELSE 1 END LIMIT 1`
        )
        .get(LOCAL_PROFILE_ID, LOCAL_PROFILE_ID) as
        { id: string; name: string; preset: string } | undefined;
      if (!activeLayout) throw new Error("Active keyboard layout not found");
      const layoutMappings = this.db
        .prepare(
          `SELECT physical_code, unshifted, shifted, hand, finger,
                  keyboard_row, zone, key_width
           FROM key_mappings WHERE layout_id = ? ORDER BY physical_code`
        )
        .all(activeLayout.id) as Record<string, unknown>[];
      if (layoutMappings.length === 0) throw new Error("Active keyboard layout has no mappings");
      const layoutSnapshot = persistedLayoutSnapshotSchema.parse({
        version: 1,
        layout: activeLayout,
        mappings: layoutMappings
      });
      this.db
        .prepare(
          `INSERT INTO sessions
           (id, profile_id, kind, mode, strategy, status, seed, started_at, algorithm_version,
            include_in_model, keyboard_layout_id, layout_snapshot_version, layout_snapshot_json,
            stage_id)
           VALUES(?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          id,
          LOCAL_PROFILE_ID,
          input.kind,
          input.mode,
          strategy,
          input.seed,
          timestamp,
          ALGORITHM_VERSION,
          Number(input.includeInModel ?? true),
          activeLayout.id,
          json(layoutSnapshot),
          input.stageId ?? null
        );
      this.db
        .prepare(
          `INSERT INTO lessons
           (id, session_id, lesson_index, focus_json, explanation, started_at)
           VALUES(?, ?, 0, ?, ?, ?)`
        )
        .run(
          lessonId,
          id,
          json(input.focus ?? []),
          "Warm up, revisit a mapped weak zone, then transfer it into readable context.",
          timestamp
        );
    });
    create();
    return { id, lessonId, strategy, status: "active", startedAt: timestamp };
  }

  getSession(sessionId: string): Record<string, unknown> | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
      Record<string, unknown> | undefined;
    if (!row) return undefined;
    const lesson = this.db
      .prepare("SELECT * FROM lessons WHERE session_id = ? ORDER BY lesson_index DESC LIMIT 1")
      .get(sessionId) as Record<string, unknown> | undefined;
    const blocks = lesson
      ? (this.db
          .prepare("SELECT * FROM micro_blocks WHERE lesson_id = ? ORDER BY block_index")
          .all(lesson.id) as Record<string, unknown>[])
      : [];
    const nextSequence = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence) + 1, 0) AS next_sequence FROM keystroke_events WHERE session_id = ?"
        )
        .get(sessionId) as { next_sequence: number }
    ).next_sequence;
    const eventsByBlock = new Map<
      string,
      { text_position: number; target_char: string; actual_char: string; backspace_count: number }[]
    >();
    const blockEvents = this.db
      .prepare(
        `SELECT block_id, text_position, target_char, actual_char, backspace_count
         FROM keystroke_events WHERE session_id = ? AND block_id IS NOT NULL ORDER BY sequence`
      )
      .all(sessionId) as {
      block_id: string;
      text_position: number;
      target_char: string;
      actual_char: string;
      backspace_count: number;
    }[];
    for (const event of blockEvents) {
      const values = eventsByBlock.get(event.block_id) ?? [];
      values.push(event);
      eventsByBlock.set(event.block_id, values);
    }
    const blocksWithResume = blocks.map((block) => ({
      ...block,
      resume_position: this.resumePosition(eventsByBlock.get(String(block.id)) ?? [])
    }));
    const publicRow = { ...row };
    if (typeof publicRow.summary_json === "string") {
      const stored = parsePersistedJson(
        publicRow.summary_json,
        "session summary",
        persistedSessionSummarySchema
      );
      publicRow.summary_json = json(
        publicSessionSummary(
          this.canonicalizePersistedSessionSummary(
            sessionId,
            Number(publicRow.active_ms ?? stored.activeMs),
            stored
          ).summary
        )
      );
    }
    return {
      ...publicRow,
      next_sequence: nextSequence,
      lesson: lesson ? { ...lesson, blocks: blocksWithResume } : null
    };
  }

  private resumePosition(
    events: readonly {
      text_position: number;
      target_char: string;
      actual_char: string;
      backspace_count: number;
    }[]
  ): number {
    const positions = new Map<number, { target_char: string; actual_char: string }>();
    for (const event of events) {
      if (event.backspace_count > 0) {
        for (const position of positions.keys()) {
          if (position >= event.text_position) positions.delete(position);
        }
      }
      positions.set(event.text_position, event);
    }
    if (positions.size === 0) return 0;
    const highestPosition = Math.max(...positions.keys());
    for (let position = 0; position <= highestPosition; position += 1) {
      const event = positions.get(position);
      if (!event) return position;
      if (event.actual_char !== event.target_char && position === highestPosition) return position;
    }
    return highestPosition + 1;
  }

  addMicroBlock(
    lessonId: string,
    blockIndex: number,
    blockType: string,
    targetText: string,
    seed: number,
    rationale: string,
    sourceTextId?: string,
    sourceStart?: number
  ): Record<string, unknown> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO micro_blocks
         (id, lesson_id, block_index, block_type, target_text, seed, rationale,
          source_text_id, source_start, source_length)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        lessonId,
        blockIndex,
        blockType,
        targetText,
        seed,
        rationale,
        sourceTextId ?? null,
        sourceStart ?? null,
        sourceTextId ? targetText.length : null
      );
    return this.db
      .prepare("SELECT * FROM micro_blocks WHERE lesson_id = ? AND block_index = ?")
      .get(lessonId, blockIndex) as Record<string, unknown>;
  }

  getLessonContext(
    lessonId: string
  ): { sessionId: string; strategy: string; mode: string; kind: string } | undefined {
    return this.db
      .prepare(
        `SELECT s.id AS sessionId, s.strategy, s.mode, s.kind
         FROM lessons l JOIN sessions s ON s.id = l.session_id WHERE l.id = ?`
      )
      .get(lessonId) as
      { sessionId: string; strategy: string; mode: string; kind: string } | undefined;
  }

  listFeatureModelRows(): {
    feature_type: string;
    feature_value: string;
    short_alpha: number;
    short_beta: number;
    long_alpha: number;
    long_beta: number;
    short_iki_ms: number | null;
    long_iki_ms: number | null;
    iki_mad_ms: number | null;
    sample_count: number;
    current_streak: number;
    recent_window_json: string;
    last_practiced_at: string | null;
  }[] {
    return this.db
      .prepare(
        `SELECT feature_type, feature_value, short_alpha, short_beta, long_alpha, long_beta,
                short_iki_ms, long_iki_ms, iki_mad_ms, sample_count, current_streak,
                recent_window_json, last_practiced_at
         FROM feature_stats WHERE profile_id = ? AND feature_type IN ('key','bigram','trigram')`
      )
      .all(LOCAL_PROFILE_ID) as ReturnType<SymTypeDatabase["listFeatureModelRows"]>;
  }

  ingestEvents(
    sessionId: string,
    batchId: string,
    events: readonly StoredEvent[],
    lessonId?: string,
    blockId?: string
  ): { duplicate: boolean; accepted: number; checkpoint: number } {
    if (events.length === 0) {
      const session = this.db
        .prepare("SELECT client_checkpoint FROM sessions WHERE id = ?")
        .get(sessionId) as { client_checkpoint: number } | undefined;
      if (!session) throw new Error("Session not found");
      return { duplicate: false, accepted: 0, checkpoint: session.client_checkpoint };
    }
    const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
    const fingerprint = batchFingerprint(lessonId, blockId, ordered);
    const existing = this.db
      .prepare(
        `SELECT event_count, last_sequence, payload_hash
         FROM event_batches WHERE session_id = ? AND batch_id = ?`
      )
      .get(sessionId, batchId) as
      { event_count: number; last_sequence: number; payload_hash: string | null } | undefined;
    if (existing) {
      if (existing.payload_hash && existing.payload_hash !== fingerprint) {
        throw new Error("Batch ID is already used for a different payload");
      }
      return {
        duplicate: true,
        accepted: existing.event_count,
        checkpoint: existing.last_sequence
      };
    }

    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last) throw new Error("Empty event batch");
    if (!lessonId || !blockId) {
      throw new Error("Event batches with keystrokes require a lesson and micro-block context");
    }
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index]?.sequence !== first.sequence + index) {
        throw new Error("Event sequences must be contiguous within a batch");
      }
    }

    const insert = this.db.prepare(
      `INSERT INTO keystroke_events (
        session_id, lesson_id, block_id, sequence, client_time_ms, server_time,
        target_char, actual_char, physical_code, shift_side, modifiers_json,
        is_correct, is_correction, backspace_count, iki_ms, feature_char, bigram, trigram,
        mapped_hand, mapped_finger, keyboard_row, zone, character_class, content_mode,
        text_position, is_word_boundary, is_after_error, was_refocus, was_paused,
        was_long_pause, was_throttled, was_repeat
      ) VALUES (
        @sessionId, @lessonId, @blockId, @sequence, @clientTimeMs, @serverTime,
        @targetChar, @actualChar, @physicalCode, @shiftSide, @modifiersJson,
        @isCorrect, @isCorrection, @backspaceCount, @ikiMs, @featureChar, @bigram, @trigram,
        @mappedHand, @mappedFinger, @keyboardRow, @zone, @characterClass, @contentMode,
        @textPosition, @isWordBoundary, @isAfterError, @wasRefocus, @wasPaused,
        @wasLongPause, @wasThrottled, @wasRepeat
      )`
    );
    const updateFeature = this.db.prepare(
      `INSERT INTO feature_stats (
        profile_id, feature_type, feature_value, short_alpha, short_beta,
        long_alpha, long_beta, short_iki_ms, long_iki_ms, iki_mad_ms, sample_count,
        current_streak, recent_window_json, last_practiced_at, algorithm_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, feature_type, feature_value) DO UPDATE SET
        short_alpha = 2 + (short_alpha - 2) * 0.995 + excluded.short_alpha - 2,
        short_beta = 1 + (short_beta - 1) * 0.995 + excluded.short_beta - 1,
        long_alpha = long_alpha + excluded.long_alpha - 2,
        long_beta = long_beta + excluded.long_beta - 1,
        short_iki_ms = CASE WHEN excluded.short_iki_ms IS NULL THEN short_iki_ms
          WHEN short_iki_ms IS NULL THEN excluded.short_iki_ms
          ELSE short_iki_ms * 0.82 + excluded.short_iki_ms * 0.18 END,
        long_iki_ms = CASE WHEN excluded.long_iki_ms IS NULL THEN long_iki_ms
          WHEN long_iki_ms IS NULL THEN excluded.long_iki_ms
          ELSE long_iki_ms * 0.96 + excluded.long_iki_ms * 0.04 END,
        sample_count = sample_count + 1,
        current_streak = CASE WHEN excluded.current_streak = 1 THEN current_streak + 1 ELSE 0 END,
        recent_window_json = CASE
          WHEN json_array_length(recent_window_json) >= 40 THEN
            json_remove(
              json_insert(recent_window_json, '$[#]', json_extract(excluded.recent_window_json, '$[0]')),
              '$[0]'
            )
          ELSE json_insert(recent_window_json, '$[#]', json_extract(excluded.recent_window_json, '$[0]'))
        END,
        last_practiced_at = CASE
          WHEN last_practiced_at IS NULL OR last_practiced_at < excluded.last_practiced_at
            THEN excluded.last_practiced_at
          ELSE last_practiced_at
        END,
        algorithm_version = excluded.algorithm_version,
        updated_at = MAX(updated_at, excluded.updated_at)`
    );
    const writeRebuiltFeature = this.db.prepare(
      `INSERT INTO feature_stats (
         profile_id, feature_type, feature_value, short_alpha, short_beta,
         long_alpha, long_beta, short_iki_ms, long_iki_ms, iki_mad_ms, sample_count,
         current_streak, recent_window_json, last_practiced_at, learning_slope,
         algorithm_version, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(profile_id, feature_type, feature_value) DO UPDATE SET
         short_alpha = excluded.short_alpha,
         short_beta = excluded.short_beta,
         long_alpha = excluded.long_alpha,
         long_beta = excluded.long_beta,
         short_iki_ms = excluded.short_iki_ms,
         long_iki_ms = excluded.long_iki_ms,
         iki_mad_ms = NULL,
         sample_count = excluded.sample_count,
         current_streak = excluded.current_streak,
         recent_window_json = excluded.recent_window_json,
         last_practiced_at = excluded.last_practiced_at,
         learning_slope = NULL,
         algorithm_version = excluded.algorithm_version,
         updated_at = excluded.updated_at`
    );
    const selectModelEvents = this.db.prepare(
      `SELECT e.feature_char, e.bigram, e.trigram, e.mapped_hand, e.mapped_finger,
              e.keyboard_row, e.zone, e.character_class, e.content_mode, e.is_correct,
              e.iki_ms, e.was_long_pause, e.was_refocus, e.was_paused, e.was_throttled,
              e.was_repeat, e.server_time
       FROM keystroke_events e
       JOIN sessions s ON s.id = e.session_id
       WHERE s.profile_id = ? AND s.include_in_model = 1
       ORDER BY s.started_at, s.id, e.sequence`
    );
    const getFeatureWindow = this.db.prepare(
      `SELECT recent_window_json FROM feature_stats
       WHERE profile_id = ? AND feature_type = ? AND feature_value = ?`
    );
    const updateFeatureRobustValues = this.db.prepare(
      `UPDATE feature_stats SET iki_mad_ms = ?, learning_slope = ?
       WHERE profile_id = ? AND feature_type = ? AND feature_value = ?`
    );
    const receiveTime = now();
    const transaction = this.db.transaction(() => {
      const session = this.db
        .prepare(
          `SELECT id, profile_id, kind, mode, status, started_at, include_in_model,
                  layout_snapshot_json
           FROM sessions WHERE id = ?`
        )
        .get(sessionId) as
        | {
            id: string;
            profile_id: string;
            kind: string;
            mode: string;
            status: string;
            started_at: string;
            include_in_model: number;
            layout_snapshot_json: string | null;
          }
        | undefined;
      if (!session) throw new Error("Session not found");
      if (!["active", "paused"].includes(session.status))
        throw new Error("Session is already closed");
      if (!session.layout_snapshot_json) {
        throw new Error("Active session layout snapshot is missing");
      }
      const snapshot = parsePersistedJson(
        session.layout_snapshot_json,
        "session layout snapshot",
        persistedLayoutSnapshotSchema
      );
      const mappingByCode = new Map(
        snapshot.mappings.map((mapping) => [mapping.physical_code, mapping])
      );
      const mappingForTarget = (target: string) =>
        snapshot.mappings.find(
          (mapping) =>
            mapping.unshifted === target ||
            mapping.shifted === target ||
            (target === "\n" && mapping.physical_code === "Enter") ||
            (target === "\t" && mapping.physical_code === "Tab")
        );
      const preset = sessionPreset(session.layout_snapshot_json);
      const block = this.db
        .prepare(
          `SELECT b.lesson_id, b.target_text, b.block_type, l.session_id
           FROM micro_blocks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = ?`
        )
        .get(blockId) as
        | { lesson_id: string; target_text: string; block_type: string; session_id: string }
        | undefined;
      if (!block) throw new Error("Micro-block not found");
      if (block.session_id !== sessionId || block.lesson_id !== lessonId) {
        throw new Error("Event context does not belong to session");
      }
      const findSequence = this.db.prepare(
        "SELECT 1 FROM keystroke_events WHERE session_id = ? AND sequence = ?"
      );
      const previousMaximum = this.db
        .prepare("SELECT MAX(sequence) AS maximum FROM keystroke_events WHERE session_id = ?")
        .get(sessionId) as { maximum: number | null };
      const laterCanonicalModelSession = this.db
        .prepare(
          `SELECT 1
           FROM sessions later
           WHERE later.profile_id = ? AND later.include_in_model = 1
             AND (
               later.started_at > ?
               OR (later.started_at = ? AND later.id > ?)
             )
             AND EXISTS (
               SELECT 1 FROM keystroke_events event
               WHERE event.session_id = later.id
             )
           LIMIT 1`
        )
        .get(session.profile_id, session.started_at, session.started_at, session.id);
      const repairsFeatureOrder =
        session.include_in_model === 1 &&
        ((previousMaximum.maximum != null && first.sequence < previousMaximum.maximum) ||
          laterCanonicalModelSession != null);
      const correctnessAtSequence = this.db.prepare(
        "SELECT is_correct FROM keystroke_events WHERE session_id = ? AND sequence = ?"
      );
      const updateNextAfterError = this.db.prepare(
        "UPDATE keystroke_events SET is_after_error = ? WHERE session_id = ? AND sequence = ?"
      );
      let previousWasCorrect = true;
      const touchedFeatures = new Map<string, [string, string]>();

      for (let eventIndex = 0; eventIndex < ordered.length; eventIndex += 1) {
        const event = ordered[eventIndex];
        if (!event) continue;
        if (findSequence.get(sessionId, event.sequence)) {
          throw new Error("Event sequence already exists in another batch");
        }
        const priorInBatch = ordered[eventIndex - 1];
        if (priorInBatch && event.clientTimeMs < priorInBatch.clientTimeMs) {
          throw new Error("Event monotonic times must not move backwards");
        }
        if (event.textPosition >= block.target_text.length) {
          throw new Error("Event text position is outside its micro-block");
        }
        const targetChar = block.target_text[event.textPosition];
        if (targetChar == null || event.targetChar !== targetChar) {
          throw new Error("Event target does not match the immutable micro-block text");
        }
        const physicalMapping = mappingByCode.get(event.physicalCode);
        const targetMapping = mappingForTarget(targetChar);
        if (session.layout_snapshot_json && !physicalMapping) {
          throw new Error("Event physical code does not belong to session layout snapshot");
        }
        if (session.layout_snapshot_json && !targetMapping) {
          throw new Error("Event target character does not belong to session layout snapshot");
        }
        const actualChar = authoritativeActualCharacter(
          preset,
          event.physicalCode,
          event.modifiers ?? {}
        );
        if (actualChar == null || event.actualChar !== actualChar) {
          throw new Error("Event actual character does not match its physical key and modifiers");
        }
        const isCorrect = actualChar === targetChar;
        if (event.isCorrect !== isCorrect) {
          throw new Error("Event correctness does not match the authoritative characters");
        }
        const featureChar = targetChar;
        const bigram =
          event.textPosition > 0
            ? block.target_text.slice(event.textPosition - 1, event.textPosition + 1)
            : null;
        const trigram =
          event.textPosition > 1
            ? block.target_text.slice(event.textPosition - 2, event.textPosition + 1)
            : null;
        const mappedHand = targetMapping?.hand ?? "unknown";
        const mappedFinger = targetMapping?.finger ?? "unknown";
        const keyboardRow = targetMapping?.keyboard_row ?? "unknown";
        const zone = targetMapping?.zone ?? "unknown";
        const characterClass = authoritativeCharacterClass(targetChar);
        const contentMode = authoritativeContentMode(session, block.block_type);
        const isWordBoundary = /\s/u.test(targetChar);
        if (!priorInBatch) {
          const preceding = correctnessAtSequence.get(sessionId, event.sequence - 1) as
            { is_correct: number } | undefined;
          previousWasCorrect = preceding ? preceding.is_correct === 1 : true;
        }
        const isAfterError = !previousWasCorrect;
        const isCorrection = (event.backspaceCount ?? 0) > 0;
        const eligibleIki =
          isCorrect &&
          !event.wasLongPause &&
          !event.wasRefocus &&
          !event.wasPaused &&
          !event.wasThrottled &&
          !event.wasRepeat &&
          event.ikiMs != null &&
          event.ikiMs >= 25 &&
          event.ikiMs <= 3000
            ? event.ikiMs
            : null;
        insert.run({
          sessionId,
          lessonId: lessonId ?? null,
          blockId: blockId ?? null,
          sequence: event.sequence,
          clientTimeMs: event.clientTimeMs,
          serverTime: receiveTime,
          targetChar,
          actualChar,
          physicalCode: event.physicalCode,
          shiftSide: event.shiftSide ?? "none",
          modifiersJson: json(event.modifiers ?? {}),
          isCorrect: Number(isCorrect),
          isCorrection: Number(isCorrection),
          backspaceCount: event.backspaceCount ?? 0,
          ikiMs: event.ikiMs ?? null,
          featureChar,
          bigram,
          trigram,
          mappedHand,
          mappedFinger,
          keyboardRow,
          zone,
          characterClass,
          contentMode,
          textPosition: event.textPosition,
          isWordBoundary: Number(isWordBoundary),
          isAfterError: Number(isAfterError),
          wasRefocus: Number(event.wasRefocus ?? false),
          wasPaused: Number(event.wasPaused ?? false),
          wasLongPause: Number(event.wasLongPause ?? false),
          wasThrottled: Number(event.wasThrottled ?? false),
          wasRepeat: Number(event.wasRepeat ?? false)
        });

        // A sendBeacon fallback can arrive before an earlier ordinary batch.
        // Repair the already-stored successor so eventual event order, rather
        // than request arrival order, defines post-error context.
        updateNextAfterError.run(Number(!isCorrect), sessionId, event.sequence + 1);

        previousWasCorrect = isCorrect;
        if (session.include_in_model !== 1) continue;
        const featurePairs: [string, string | null | undefined][] = [
          ["key", featureChar],
          ["bigram", bigram],
          ["trigram", trigram],
          ["finger", mappedFinger],
          ["hand", mappedHand],
          ["row", keyboardRow],
          ["zone", zone],
          ["class", characterClass],
          ["content-mode", contentMode]
        ];
        for (const [featureType, featureValue] of featurePairs) {
          if (!featureValue || featureValue === "unknown") continue;
          touchedFeatures.set(`${featureType}\0${featureValue}`, [featureType, featureValue]);
          if (repairsFeatureOrder) continue;
          const alpha = isCorrect ? 3 : 2;
          const beta = isCorrect ? 1 : 2;
          updateFeature.run(
            session.profile_id,
            featureType,
            featureValue,
            alpha,
            beta,
            alpha,
            beta,
            eligibleIki,
            eligibleIki,
            isCorrect ? 1 : 0,
            json([isCorrect ? (eligibleIki ?? 1) : 0]),
            receiveTime,
            ALGORITHM_VERSION,
            receiveTime
          );
        }
      }
      if (repairsFeatureOrder && touchedFeatures.size > 0) {
        type ModelEventRow = {
          feature_char: string;
          bigram: string | null;
          trigram: string | null;
          mapped_hand: string;
          mapped_finger: string;
          keyboard_row: string;
          zone: string;
          character_class: string;
          content_mode: string;
          is_correct: number;
          iki_ms: number | null;
          was_long_pause: number;
          was_refocus: number;
          was_paused: number;
          was_throttled: number;
          was_repeat: number;
          server_time: string;
        };
        type RebuiltFeature = {
          featureType: string;
          featureValue: string;
          shortAlpha: number;
          shortBeta: number;
          longAlpha: number;
          longBeta: number;
          shortIkiMs: number | null;
          longIkiMs: number | null;
          sampleCount: number;
          currentStreak: number;
          recentWindow: number[];
          lastPracticedAt: string;
          updatedAt: string;
        };
        const modelEvents = selectModelEvents.all(session.profile_id) as ModelEventRow[];
        const rebuiltFeatures = new Map<string, RebuiltFeature>();
        for (const row of modelEvents) {
          const eligibleIki =
            row.is_correct === 1 &&
            row.was_long_pause === 0 &&
            row.was_refocus === 0 &&
            row.was_paused === 0 &&
            row.was_throttled === 0 &&
            row.was_repeat === 0 &&
            row.iki_ms != null &&
            row.iki_ms >= 25 &&
            row.iki_ms <= 3000
              ? row.iki_ms
              : null;
          const pairs: [string, string | null][] = [
            ["key", row.feature_char],
            ["bigram", row.bigram],
            ["trigram", row.trigram],
            ["finger", row.mapped_finger],
            ["hand", row.mapped_hand],
            ["row", row.keyboard_row],
            ["zone", row.zone],
            ["class", row.character_class],
            ["content-mode", row.content_mode]
          ];
          for (const [featureType, featureValue] of pairs) {
            if (!featureValue || featureValue === "unknown") continue;
            const key = `${featureType}\0${featureValue}`;
            if (!touchedFeatures.has(key)) continue;
            const isCorrect = row.is_correct === 1;
            const recentValue = isCorrect ? (eligibleIki ?? 1) : 0;
            const current = rebuiltFeatures.get(key);
            if (!current) {
              rebuiltFeatures.set(key, {
                featureType,
                featureValue,
                shortAlpha: isCorrect ? 3 : 2,
                shortBeta: isCorrect ? 1 : 2,
                longAlpha: isCorrect ? 3 : 2,
                longBeta: isCorrect ? 1 : 2,
                shortIkiMs: eligibleIki,
                longIkiMs: eligibleIki,
                sampleCount: 1,
                currentStreak: isCorrect ? 1 : 0,
                recentWindow: [recentValue],
                lastPracticedAt: row.server_time,
                updatedAt: row.server_time
              });
              continue;
            }
            current.shortAlpha = 2 + (current.shortAlpha - 2) * 0.995 + (isCorrect ? 1 : 0);
            current.shortBeta = 1 + (current.shortBeta - 1) * 0.995 + (isCorrect ? 0 : 1);
            current.longAlpha += isCorrect ? 1 : 0;
            current.longBeta += isCorrect ? 0 : 1;
            if (eligibleIki != null) {
              current.shortIkiMs =
                current.shortIkiMs == null
                  ? eligibleIki
                  : current.shortIkiMs * 0.82 + eligibleIki * 0.18;
              current.longIkiMs =
                current.longIkiMs == null
                  ? eligibleIki
                  : current.longIkiMs * 0.96 + eligibleIki * 0.04;
            }
            current.sampleCount += 1;
            current.currentStreak = isCorrect ? current.currentStreak + 1 : 0;
            if (current.recentWindow.length >= 40) current.recentWindow.shift();
            current.recentWindow.push(recentValue);
            if (row.server_time > current.lastPracticedAt) {
              current.lastPracticedAt = row.server_time;
            }
            if (row.server_time > current.updatedAt) current.updatedAt = row.server_time;
          }
        }
        for (const [key, [featureType]] of touchedFeatures) {
          const feature = rebuiltFeatures.get(key);
          if (!feature) {
            throw new Error(`Canonical model rebuild found no evidence for ${featureType}`);
          }
          writeRebuiltFeature.run(
            session.profile_id,
            feature.featureType,
            feature.featureValue,
            feature.shortAlpha,
            feature.shortBeta,
            feature.longAlpha,
            feature.longBeta,
            feature.shortIkiMs,
            feature.longIkiMs,
            feature.sampleCount,
            feature.currentStreak,
            json(feature.recentWindow),
            feature.lastPracticedAt,
            ALGORITHM_VERSION,
            feature.updatedAt
          );
        }
      }
      for (const [featureType, featureValue] of touchedFeatures.values()) {
        const row = getFeatureWindow.get(session.profile_id, featureType, featureValue) as {
          recent_window_json: string;
        };
        const window = parsePersistedJson(
          row.recent_window_json,
          "feature recent window",
          persistedFeatureWindowSchema
        );
        const recentIkis = window.filter((value) => value >= 25 && value <= 3000);
        updateFeatureRobustValues.run(
          medianAbsoluteDeviation(recentIkis),
          robustLearningSlope(recentIkis),
          session.profile_id,
          featureType,
          featureValue
        );
      }
      this.db
        .prepare(
          `INSERT INTO event_batches
           (session_id, batch_id, first_sequence, last_sequence, event_count, received_at, payload_hash)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          batchId,
          first.sequence,
          last.sequence,
          ordered.length,
          receiveTime,
          fingerprint
        );
      this.db
        .prepare("UPDATE sessions SET client_checkpoint = MAX(client_checkpoint, ?) WHERE id = ?")
        .run(last.sequence, sessionId);
    });
    transaction();
    this.advanceBuiltInLongFormProgressFromEvidence(lessonId);
    return { duplicate: false, accepted: ordered.length, checkpoint: last.sequence };
  }

  pauseSession(sessionId: string, paused: boolean): void {
    const status = paused ? "paused" : "active";
    const result = this.db
      .prepare(
        `UPDATE sessions SET status = ?
         WHERE id = ? AND status IN ('active','paused')`
      )
      .run(status, sessionId);
    if (result.changes !== 1) throw new Error("Active session not found");
  }

  private validateCorrectionCheckpoint(
    sessionId: string,
    checkpoint?: RuntimeCorrectionCheckpoint
  ): RuntimeCorrectionCheckpoint | undefined {
    if (!checkpoint) return undefined;
    const block = this.db
      .prepare(
        `SELECT LENGTH(b.target_text) AS target_length
         FROM micro_blocks b
         JOIN lessons l ON l.id = b.lesson_id
         WHERE b.id = ? AND l.session_id = ?`
      )
      .get(checkpoint.blockId, sessionId) as { target_length: number } | undefined;
    if (!block) throw new Error("Correction checkpoint does not belong to session");
    if (checkpoint.position > block.target_length) {
      throw new Error("Correction checkpoint does not belong to the micro-block bounds");
    }
    const latestEvent = this.db
      .prepare(
        `SELECT block_id
         FROM keystroke_events
         WHERE session_id = ?
         ORDER BY sequence DESC
         LIMIT 1`
      )
      .get(sessionId) as { block_id: string | null } | undefined;
    if (!latestEvent?.block_id || latestEvent.block_id !== checkpoint.blockId) {
      throw new Error("Correction checkpoint does not belong to the latest event micro-block");
    }
    const events = this.db
      .prepare(
        `SELECT text_position, backspace_count
         FROM keystroke_events
         WHERE session_id = ? AND block_id = ?
         ORDER BY sequence`
      )
      .all(sessionId, checkpoint.blockId) as {
      text_position: number;
      backspace_count: number;
    }[];
    const positions = new Set<number>();
    for (const event of events) {
      if (event.backspace_count > 0) {
        for (const position of positions) {
          if (position >= event.text_position) positions.delete(position);
        }
      }
      positions.add(event.text_position);
    }
    let reconstructedTail = 0;
    while (positions.has(reconstructedTail)) reconstructedTail += 1;
    if (checkpoint.position >= reconstructedTail) {
      throw new Error("Correction checkpoint does not belong to the reconstructed event tail");
    }
    return checkpoint;
  }

  completeSession(
    sessionId: string,
    activeMs?: number,
    correctionCheckpoint?: RuntimeCorrectionCheckpoint
  ): SessionSummary {
    const rows = this.getSummaryEventRows(sessionId);
    const errorAnalysis = this.buildSessionErrorAnalysis(sessionId, rows);
    const session = this.db
      .prepare(
        "SELECT kind, mode, started_at, status, active_ms, summary_json FROM sessions WHERE id = ?"
      )
      .get(sessionId) as
      | {
          kind: string;
          mode: string;
          started_at: string;
          status: string;
          active_ms: number;
          summary_json: string | null;
        }
      | undefined;
    if (!session) throw new Error("Session not found");
    const validatedCheckpoint = this.validateCorrectionCheckpoint(sessionId, correctionCheckpoint);
    if (session.mode === "long-form") {
      const lessons = this.db
        .prepare("SELECT id FROM lessons WHERE session_id = ?")
        .all(sessionId) as { id: string }[];
      for (const lesson of lessons) this.advanceBuiltInLongFormProgressFromEvidence(lesson.id);
    }
    if (session.status === "completed") {
      if (!session.summary_json) throw new Error("Completed session summary is missing");
      const stored = parsePersistedJson(
        session.summary_json,
        "session summary",
        persistedSessionSummarySchema
      );
      return publicSessionSummary(
        this.canonicalizePersistedSessionSummary(sessionId, session.active_ms, stored, rows).summary
      );
    }
    if (session.status === "abandoned") throw new Error("Session is already abandoned");
    const summary = calculateSessionSummary(rows, activeMs, errorAnalysis, validatedCheckpoint);
    const timestamp = now();
    const completedLocalDate = localDate(new Date(timestamp));
    const complete = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE sessions SET status = 'completed', completed_at = ?, active_ms = ?, summary_json = ?
           WHERE id = ?`
        )
        .run(
          timestamp,
          summary.activeMs,
          json(sessionSummaryForPersistence(summary, rows, validatedCheckpoint)),
          sessionId
        );
      this.db
        .prepare("UPDATE lessons SET completed_at = COALESCE(completed_at, ?) WHERE session_id = ?")
        .run(timestamp, sessionId);
      if (summary.characters > 0) {
        this.rebuildPersistedDailySummary(timestamp, session.kind);
        this.updateStreak(completedLocalDate);
      }
    });
    complete();
    return summary;
  }

  recoverSession(
    sessionId: string,
    disposition: "complete" | "abandon" = "complete",
    activeMs?: number,
    correctionCheckpoint?: RuntimeCorrectionCheckpoint
  ): { recovered: true; status: "completed" | "abandoned"; summary: SessionSummary } {
    const session = this.db
      .prepare("SELECT status, active_ms, summary_json FROM sessions WHERE id = ?")
      .get(sessionId) as
      { status: string; active_ms: number; summary_json: string | null } | undefined;
    if (!session) throw new Error("Session not found");
    if (session.status === "completed") {
      return {
        recovered: true,
        status: "completed",
        summary: this.completeSession(sessionId, undefined, correctionCheckpoint)
      };
    }

    const rows = this.getSummaryEventRows(sessionId);
    const errorAnalysis = this.buildSessionErrorAnalysis(sessionId, rows);
    const validatedCheckpoint = this.validateCorrectionCheckpoint(sessionId, correctionCheckpoint);
    const recalculated = calculateSessionSummary(
      rows,
      activeMs ?? (session.active_ms > 0 ? session.active_ms : undefined),
      errorAnalysis,
      validatedCheckpoint
    );
    if (session.status === "abandoned") {
      const stored = session.summary_json
        ? parsePersistedJson(session.summary_json, "session summary", persistedSessionSummarySchema)
        : null;
      const summary: SessionSummary = stored
        ? publicSessionSummary(
            this.canonicalizePersistedSessionSummary(sessionId, session.active_ms, stored, rows)
              .summary
          )
        : recalculated;
      if (!session.summary_json) {
        this.db
          .prepare(
            "UPDATE sessions SET active_ms = ?, summary_json = ? WHERE id = ? AND status = 'abandoned'"
          )
          .run(
            summary.activeMs,
            json(sessionSummaryForPersistence(summary, rows, validatedCheckpoint)),
            sessionId
          );
      }
      return { recovered: true, status: "abandoned", summary };
    }

    if (disposition === "complete") {
      return {
        recovered: true,
        status: "completed",
        summary: this.completeSession(sessionId, activeMs, validatedCheckpoint)
      };
    }

    const timestamp = now();
    const abandon = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE sessions SET status = 'abandoned', completed_at = ?, active_ms = ?, summary_json = ?
           WHERE id = ? AND status IN ('active','paused')`
        )
        .run(
          timestamp,
          recalculated.activeMs,
          json(sessionSummaryForPersistence(recalculated, rows, validatedCheckpoint)),
          sessionId
        );
      if (result.changes !== 1) throw new Error("Session is already closed");
      this.db
        .prepare("UPDATE lessons SET completed_at = COALESCE(completed_at, ?) WHERE session_id = ?")
        .run(timestamp, sessionId);
    });
    abandon();
    return { recovered: true, status: "abandoned", summary: recalculated };
  }

  abandonSession(sessionId: string, correctionCheckpoint?: RuntimeCorrectionCheckpoint): void {
    this.recoverSession(sessionId, "abandon", undefined, correctionCheckpoint);
  }

  private buildSessionErrorAnalysis(
    sessionId: string,
    rows: readonly SummaryEventRow[]
  ): ErrorAnalysisSummary {
    const snapshot = this.db
      .prepare("SELECT layout_snapshot_json FROM sessions WHERE id = ?")
      .get(sessionId) as { layout_snapshot_json: string | null } | undefined;
    const preset = sessionPreset(snapshot?.layout_snapshot_json ?? null);
    const blockTargets = new Map(
      (
        this.db
          .prepare(
            `SELECT b.id, b.target_text
             FROM micro_blocks b JOIN lessons l ON l.id = b.lesson_id
             WHERE l.session_id = ?`
          )
          .all(sessionId) as { id: string; target_text: string }[]
      ).map((block) => [block.id, block.target_text])
    );
    return analyzeSessionErrors({
      rows,
      blockTargets,
      preset,
      targetWpm: this.getSettings().targetWpm
    });
  }

  private getSummaryEventRows(sessionId: string): SummaryEventRow[] {
    return this.db
      .prepare(
        `SELECT sequence, is_correct, iki_ms, was_long_pause, was_refocus, was_throttled, was_repeat,
                target_char, actual_char, block_id, text_position, is_correction, backspace_count
                , shift_side, modifiers_json, mapped_hand, mapped_finger, keyboard_row, was_paused
         FROM keystroke_events WHERE session_id = ? ORDER BY sequence`
      )
      .all(sessionId) as SummaryEventRow[];
  }

  private canonicalizePersistedSessionSummary(
    sessionId: string,
    activeMs: number,
    stored: PersistedSessionSummary,
    existingRows?: readonly SummaryEventRow[]
  ): CanonicalizedSessionSummary {
    if (stored.metricVersion === 1 && typeof stored.uncorrectedErrors === "number") {
      return {
        summary: stored,
        uncorrectedErrors: stored.uncorrectedErrors
      };
    }

    const rows = existingRows ?? this.getSummaryEventRows(sessionId);
    if (rows.length === 0) {
      return {
        summary: stored,
        uncorrectedErrors: stored.errors
      };
    }
    const finalText = summarizeFinalText(rows);
    const canonical = calculateSessionSummary(rows, activeMs, stored.errorAnalysis);
    return {
      summary: persistedSessionSummarySchema.parse({
        ...stored,
        rawWpm: canonical.rawWpm,
        netWpm: canonical.netWpm
      }),
      uncorrectedErrors: finalText.uncorrectedErrors
    };
  }

  private updateStreak(localDate: string): void {
    const row = this.db
      .prepare(
        "SELECT current_days, longest_days, last_training_date FROM streaks WHERE profile_id = ?"
      )
      .get(LOCAL_PROFILE_ID) as {
      current_days: number;
      longest_days: number;
      last_training_date: string | null;
    };
    if (row.last_training_date === localDate) return;
    let currentDays = 1;
    if (row.last_training_date) {
      const previous = new Date(`${row.last_training_date}T00:00:00Z`);
      const current = new Date(`${localDate}T00:00:00Z`);
      if (current.getTime() - previous.getTime() === 86_400_000) currentDays = row.current_days + 1;
    }
    this.db
      .prepare(
        "UPDATE streaks SET current_days = ?, longest_days = MAX(longest_days, ?), last_training_date = ? WHERE profile_id = ?"
      )
      .run(currentDays, currentDays, localDate, LOCAL_PROFILE_ID);
  }

  private getCanonicalSessionMetrics(since: string, before?: string): CanonicalSessionMetric[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.kind, s.active_ms, s.completed_at, s.summary_json,
                COUNT(e.id) AS characters, COALESCE(SUM(e.is_correct), 0) AS correct
         FROM sessions s JOIN keystroke_events e ON e.session_id = s.id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
           ${before ? "AND s.completed_at < ?" : ""}
         GROUP BY s.id
         ORDER BY s.completed_at, s.id`
      )
      .all(...(before ? [LOCAL_PROFILE_ID, since, before] : [LOCAL_PROFILE_ID, since])) as {
      id: string;
      kind: string;
      active_ms: number;
      completed_at: string;
      summary_json: string | null;
      characters: number;
      correct: number;
    }[];

    return rows.map((row) => {
      const stored = row.summary_json
        ? parsePersistedJson(row.summary_json, "session summary", persistedSessionSummarySchema)
        : null;
      const canonical = stored
        ? this.canonicalizePersistedSessionSummary(row.id, row.active_ms, stored)
        : null;
      const rowsWithoutSummary = canonical ? null : this.getSummaryEventRows(row.id);
      const uncorrectedErrors =
        canonical?.uncorrectedErrors ??
        summarizeFinalText(rowsWithoutSummary ?? []).uncorrectedErrors;
      const consistency =
        canonical?.summary.consistency ??
        calculateSessionSummary(rowsWithoutSummary ?? [], row.active_ms).consistency;
      const completedAt = new Date(row.completed_at);
      if (!Number.isFinite(completedAt.getTime())) {
        throw new Error("Completed session has an invalid completion timestamp");
      }
      return {
        id: row.id,
        kind: row.kind,
        activeMs: row.active_ms,
        completedAt: row.completed_at,
        localDate: localDate(completedAt),
        characters: row.characters,
        correct: row.correct,
        uncorrectedErrors,
        consistency
      };
    });
  }

  private aggregateCanonicalMetrics(
    sessions: readonly CanonicalSessionMetric[]
  ): CanonicalMetricAggregate {
    const totals = sessions.reduce(
      (result, session) => ({
        sessions: result.sessions + 1,
        active_ms: result.active_ms + session.activeMs,
        characters: result.characters + session.characters,
        correct: result.correct + session.correct,
        uncorrected_errors: result.uncorrected_errors + session.uncorrectedErrors,
        consistency_weight: result.consistency_weight + session.consistency * session.characters
      }),
      {
        sessions: 0,
        active_ms: 0,
        characters: 0,
        correct: 0,
        uncorrected_errors: 0,
        consistency_weight: 0
      }
    );
    return {
      sessions: totals.sessions,
      active_ms: totals.active_ms,
      characters: totals.characters,
      correct: totals.correct,
      errors: totals.characters - totals.correct,
      uncorrected_errors: totals.uncorrected_errors,
      raw_wpm: calculateRawWpm(totals.characters, totals.active_ms),
      net_wpm: calculateNetWpm(totals.characters, totals.uncorrected_errors, totals.active_ms),
      accuracy: totals.characters > 0 ? totals.correct / totals.characters : 0,
      consistency: totals.characters > 0 ? totals.consistency_weight / totals.characters : 0
    };
  }

  private canonicalDailyMetrics(
    sessions: readonly CanonicalSessionMetric[]
  ): CanonicalDailyMetric[] {
    const grouped = new Map<string, CanonicalSessionMetric[]>();
    for (const session of sessions) {
      const key = `${session.localDate}\0${session.kind}`;
      const values = grouped.get(key) ?? [];
      values.push(session);
      grouped.set(key, values);
    }
    return [...grouped.entries()]
      .map(([key, values]) => {
        const separator = key.indexOf("\0");
        const aggregate = this.aggregateCanonicalMetrics(values);
        return {
          local_date: key.slice(0, separator),
          kind: key.slice(separator + 1),
          ...aggregate,
          character_count: aggregate.characters,
          correct_count: aggregate.correct
        };
      })
      .sort(
        (left, right) =>
          left.local_date.localeCompare(right.local_date) || left.kind.localeCompare(right.kind)
      );
  }

  private rebuildPersistedDailySummary(completedAt: string, kind: string): void {
    const completed = new Date(completedAt);
    const start = new Date(completed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const date = localDate(completed);
    const daily = this.canonicalDailyMetrics(
      this.getCanonicalSessionMetrics(start.toISOString(), end.toISOString())
    ).find((candidate) => candidate.local_date === date && candidate.kind === kind);
    if (!daily) return;
    this.db
      .prepare(
        `INSERT INTO daily_summaries
         (profile_id, local_date, kind, active_ms, session_count, character_count, correct_count,
          raw_wpm, net_wpm, accuracy, consistency)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, local_date, kind) DO UPDATE SET
           active_ms = excluded.active_ms,
           session_count = excluded.session_count,
           character_count = excluded.character_count,
           correct_count = excluded.correct_count,
           raw_wpm = excluded.raw_wpm,
           net_wpm = excluded.net_wpm,
           accuracy = excluded.accuracy,
           consistency = excluded.consistency`
      )
      .run(
        LOCAL_PROFILE_ID,
        daily.local_date,
        daily.kind,
        daily.active_ms,
        daily.sessions,
        daily.character_count,
        daily.correct_count,
        daily.raw_wpm,
        daily.net_wpm,
        daily.accuracy,
        daily.consistency
      );
  }

  getDashboard(): Record<string, unknown> {
    const today = localDate();
    const goal = this.db.prepare("SELECT * FROM goals WHERE id = 'primary-goal'").get() as Record<
      string,
      unknown
    >;
    const streak = this.db
      .prepare("SELECT * FROM streaks WHERE profile_id = ?")
      .get(LOCAL_PROFILE_ID);
    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - 13);
    const recentSessions = this.getCanonicalSessionMetrics(trendStart.toISOString());
    const todayAggregate = this.aggregateCanonicalMetrics(
      recentSessions.filter((session) => session.localDate === today)
    );
    const todaySummary = {
      active_ms: todayAggregate.active_ms,
      sessions: todayAggregate.sessions,
      characters: todayAggregate.characters,
      accuracy: todayAggregate.accuracy,
      net_wpm: todayAggregate.net_wpm
    };
    const sessionsByDate = new Map<string, CanonicalSessionMetric[]>();
    for (const session of recentSessions) {
      const values = sessionsByDate.get(session.localDate) ?? [];
      values.push(session);
      sessionsByDate.set(session.localDate, values);
    }
    const trend = [...sessionsByDate.entries()]
      .map(([date, sessions]) => {
        const aggregate = this.aggregateCanonicalMetrics(sessions);
        return {
          local_date: date,
          active_ms: aggregate.active_ms,
          characters: aggregate.characters,
          accuracy: aggregate.accuracy,
          net_wpm: aggregate.net_wpm
        };
      })
      .sort((left, right) => left.local_date.localeCompare(right.local_date));
    const weaknesses = this.db
      .prepare(
        `SELECT feature_type, feature_value, sample_count,
                short_alpha / (short_alpha + short_beta) AS accuracy,
                short_iki_ms, last_practiced_at
         FROM feature_stats
         WHERE profile_id = ? AND feature_type IN ('key','bigram','trigram')
         ORDER BY ((1.0 - short_alpha / (short_alpha + short_beta)) * 0.6
                   + MIN(1.0, COALESCE(short_iki_ms, 600) / 900.0) * 0.4) DESC
         LIMIT 3`
      )
      .all(LOCAL_PROFILE_ID);
    const lastSession = this.db
      .prepare(
        `SELECT id, active_ms, completed_at, summary_json FROM sessions
         WHERE profile_id = ? AND status = 'completed' AND summary_json IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`
      )
      .get(LOCAL_PROFILE_ID) as
      { id: string; active_ms: number; completed_at: string; summary_json: string } | undefined;
    const latestRetest = this.db
      .prepare(
        `SELECT b.id AS block_id, s.completed_at, s.mode, l.focus_json,
                COUNT(e.id) AS sample_count
         FROM sessions s
         JOIN lessons l ON l.session_id = s.id
         JOIN micro_blocks b ON b.lesson_id = l.id AND b.block_type = 'retest'
         JOIN keystroke_events e ON e.block_id = b.id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at IS NOT NULL
         GROUP BY b.id, s.id, l.id
         HAVING COUNT(e.id) >= 5
         ORDER BY s.completed_at DESC, b.block_index DESC LIMIT 1`
      )
      .get(LOCAL_PROFILE_ID) as
      | {
          block_id: string;
          completed_at: string;
          mode: string;
          focus_json: string;
          sample_count: number;
        }
      | undefined;
    let retention: Record<string, unknown> | null = null;
    if (latestRetest) {
      const prior = this.db
        .prepare(
          `SELECT b.id AS block_id, s.completed_at, COUNT(e.id) AS sample_count
           FROM sessions s
           JOIN lessons l ON l.session_id = s.id
           JOIN micro_blocks b ON b.lesson_id = l.id AND b.block_type <> 'retest'
           JOIN keystroke_events e ON e.block_id = b.id
           WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at < ?
             AND s.mode = ? AND l.focus_json = ?
             AND ((julianday(?) - julianday(s.completed_at)) BETWEEN 0.75 AND 1.5
                  OR (julianday(?) - julianday(s.completed_at)) BETWEEN 2.5 AND 3.5)
           GROUP BY b.id, s.id
           HAVING COUNT(e.id) >= 5
           ORDER BY MIN(
             ABS((julianday(?) - julianday(s.completed_at)) - 1.0),
             ABS((julianday(?) - julianday(s.completed_at)) - 3.0)
           ), s.completed_at DESC
           LIMIT 1`
        )
        .get(
          LOCAL_PROFILE_ID,
          latestRetest.completed_at,
          latestRetest.mode,
          latestRetest.focus_json,
          latestRetest.completed_at,
          latestRetest.completed_at,
          latestRetest.completed_at,
          latestRetest.completed_at
        ) as { block_id: string; completed_at: string; sample_count: number } | undefined;
      if (prior) {
        const currentSummary = calculateSessionSummary(
          this.getBlockSummaryEventRows(latestRetest.block_id)
        );
        const priorSummary = calculateSessionSummary(this.getBlockSummaryEventRows(prior.block_id));
        const hoursGap =
          (new Date(latestRetest.completed_at).getTime() - new Date(prior.completed_at).getTime()) /
          3_600_000;
        retention = {
          window: hoursGap < 48 ? "24h" : "72h",
          hoursGap: Number(hoursGap.toFixed(2)),
          netWpmDelta: Number((currentSummary.netWpm - priorSummary.netWpm).toFixed(1)),
          accuracyDelta: Number(
            (currentSummary.keystrokeAccuracy - priorSummary.keystrokeAccuracy).toFixed(4)
          ),
          sampleCount: latestRetest.sample_count,
          baselineSampleCount: prior.sample_count
        };
      }
    }
    return {
      goal,
      streak,
      today: todaySummary,
      trend,
      weaknesses,
      lastSession: lastSession
        ? {
            completedAt: lastSession.completed_at,
            summary: publicSessionSummary(
              this.canonicalizePersistedSessionSummary(
                lastSession.id,
                lastSession.active_ms,
                parsePersistedJson(
                  lastSession.summary_json,
                  "session summary",
                  persistedSessionSummarySchema
                )
              ).summary
            )
          }
        : null,
      retention
    };
  }

  private getBlockSummaryEventRows(blockId: string): SummaryEventRow[] {
    return this.db
      .prepare(
        `SELECT sequence, is_correct, iki_ms, was_long_pause, was_refocus, was_throttled,
                was_repeat, target_char, actual_char, block_id, text_position, is_correction,
                backspace_count, shift_side, modifiers_json, mapped_hand, mapped_finger,
                keyboard_row, was_paused
         FROM keystroke_events WHERE block_id = ? ORDER BY sequence`
      )
      .all(blockId) as SummaryEventRow[];
  }

  private buildPeriodFeatures(since: string): Record<string, unknown>[] {
    const rows = this.db
      .prepare(
        `SELECT e.feature_char, e.bigram, e.trigram, e.mapped_hand, e.mapped_finger,
                e.keyboard_row, e.zone, e.character_class, e.content_mode, e.is_correct, e.iki_ms,
                e.was_long_pause, e.was_refocus, e.was_paused, e.was_throttled,
                e.was_repeat, e.server_time
         FROM keystroke_events e
         JOIN sessions s ON s.id = e.session_id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
         ORDER BY e.id`
      )
      .all(LOCAL_PROFILE_ID, since) as PeriodFeatureRow[];
    return buildPeriodFeatures(rows);
  }

  private getPeriodErrorAnalysis(since: string): ErrorAnalysisSummary {
    const sessions = this.db
      .prepare(
        `SELECT id, summary_json FROM sessions
         WHERE profile_id = ? AND status = 'completed' AND completed_at >= ?
         ORDER BY completed_at`
      )
      .all(LOCAL_PROFILE_ID, since) as { id: string; summary_json: string | null }[];
    const reports = sessions.map((session) => {
      if (session.summary_json) {
        const stored = parsePersistedJson(
          session.summary_json,
          "session summary",
          persistedSessionSummarySchema
        );
        if (isErrorAnalysisSummary(stored.errorAnalysis)) return stored.errorAnalysis;
      }
      return this.buildSessionErrorAnalysis(session.id, this.getSummaryEventRows(session.id));
    });
    return mergeErrorAnalysis(reports);
  }

  private buildPeriodGroups(since: string): Record<string, unknown>[] {
    const rows = this.db
      .prepare(
        `SELECT e.mapped_hand, e.mapped_finger, e.keyboard_row, e.zone,
                e.character_class, e.shift_side, e.is_correct, e.iki_ms,
                e.was_long_pause, e.was_refocus, e.was_paused, e.was_throttled, e.was_repeat
         FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?`
      )
      .all(LOCAL_PROFILE_ID, since) as PeriodGroupRow[];
    return buildPeriodGroups(rows);
  }

  getStatistics(period: StatisticsPeriod): Record<string, unknown> {
    const reference = new Date();
    const bounds = periodBounds(period, reference);
    const token = `${this.databaseRevision()}:${localDate(reference)}:${bounds.instant}`;
    const cached = this.statisticsCache.get(period);
    // Transactions may roll back without rewinding total_changes(). Never cache their snapshots.
    if (!this.db.inTransaction && cached?.token === token) return structuredClone(cached.report);
    const report = this.calculateStatistics(period, bounds);
    // A second connection can commit during a report. Do not retain an inconsistent revision.
    if (
      !this.db.inTransaction &&
      token === `${this.databaseRevision()}:${localDate(new Date())}:${bounds.instant}`
    ) {
      this.statisticsCache.set(period, { token, report: structuredClone(report) });
    }
    return report;
  }

  private calculateStatistics(
    period: StatisticsPeriod,
    bounds: ReturnType<typeof periodBounds>
  ): Record<string, unknown> {
    const since = bounds.instant;
    const selectedSessions = this.getCanonicalSessionMetrics(since);
    const canonicalOverview = this.aggregateCanonicalMetrics(selectedSessions);
    const overviewCounts = {
      sessions: canonicalOverview.sessions,
      active_ms: canonicalOverview.active_ms,
      characters: canonicalOverview.characters,
      correct: canonicalOverview.correct,
      errors: canonicalOverview.errors
    };
    const timingValues = (
      this.db
        .prepare(
          `SELECT e.iki_ms
           FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
           WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
             AND e.is_correct = 1 AND e.iki_ms BETWEEN 25 AND 3000
             AND e.was_long_pause = 0 AND e.was_refocus = 0 AND e.was_paused = 0
             AND e.was_throttled = 0 AND e.was_repeat = 0`
        )
        .all(LOCAL_PROFILE_ID, since) as { iki_ms: number }[]
    ).map((row) => row.iki_ms);
    const timingCenter = median(timingValues);
    const timingMad = medianAbsoluteDeviation(timingValues);
    const rawWpm = overviewCounts.active_ms > 0 ? canonicalOverview.raw_wpm : null;
    const netWpm = overviewCounts.active_ms > 0 ? canonicalOverview.net_wpm : null;
    const overview = {
      ...overviewCounts,
      raw_wpm: rawWpm,
      net_wpm: netWpm,
      keystroke_accuracy:
        overviewCounts.characters > 0 ? overviewCounts.correct / overviewCounts.characters : null,
      consistency:
        timingCenter != null && timingMad != null && timingCenter > 0
          ? Math.max(0, Math.min(1, 1 - timingMad / timingCenter))
          : null,
      stable_wpm:
        timingValues.length >= 20 && timingCenter != null && timingMad != null
          ? 12_000 / Math.max(25, timingCenter + 1.4826 * timingMad)
          : null,
      timing_samples: timingValues.length
    };
    const trend = this.canonicalDailyMetrics(selectedSessions).map((daily) => ({
      local_date: daily.local_date,
      kind: daily.kind,
      active_ms: daily.active_ms,
      character_count: daily.character_count,
      net_wpm: daily.net_wpm,
      raw_wpm: daily.raw_wpm,
      accuracy: daily.accuracy,
      consistency: daily.consistency
    }));
    const features = this.buildPeriodFeatures(since);
    const confusion = this.db
      .prepare(
        `SELECT target_char, actual_char, COUNT(*) AS count
         FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
           AND e.is_correct = 0
         GROUP BY target_char, actual_char ORDER BY count DESC LIMIT 30`
      )
      .all(LOCAL_PROFILE_ID, since);
    const groups = this.buildPeriodGroups(since);
    const recentErrors = this.db
      .prepare(
        `SELECT e.session_id, e.text_position, e.target_char, e.actual_char, e.physical_code,
                e.server_time
         FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
         WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
           AND e.is_correct = 0
         ORDER BY e.id DESC LIMIT 20`
      )
      .all(LOCAL_PROFILE_ID, since);
    const shift = this.db
      .prepare(
        `WITH active_mapping AS (
           SELECT m.physical_code, m.unshifted, m.shifted
           FROM key_mappings m JOIN keyboard_layouts l ON l.id = m.layout_id
           WHERE l.is_active = 1
         ), classified AS (
           SELECT e.*,
                  CASE WHEN m.shifted = e.target_char AND m.shifted <> m.unshifted THEN 1 ELSE 0 END
                    AS requires_shift,
                  CASE WHEN COALESCE(json_extract(e.modifiers_json, '$.capsLock'), 0) = 1
                       THEN 1 ELSE 0 END AS used_caps_lock
           FROM keystroke_events e
           JOIN sessions s ON s.id = e.session_id
           LEFT JOIN active_mapping m ON m.physical_code = e.physical_code
           WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
         )
         SELECT COALESCE(SUM(CASE WHEN requires_shift = 1 AND shift_side = 'left' THEN 1 ELSE 0 END), 0) AS left_count,
                COALESCE(SUM(CASE WHEN requires_shift = 1 AND shift_side = 'right' THEN 1 ELSE 0 END), 0) AS right_count,
                COALESCE(SUM(CASE WHEN requires_shift = 1 AND shift_side = 'both' THEN 1 ELSE 0 END), 0) AS both_count,
                COALESCE(SUM(CASE WHEN requires_shift = 1 AND shift_side = 'none' THEN 1 ELSE 0 END), 0) AS missing_count,
                COALESCE(SUM(CASE WHEN requires_shift = 1 AND
                                      ((mapped_hand = 'left' AND shift_side = 'left') OR
                                       (mapped_hand = 'right' AND shift_side = 'right'))
                                 THEN 1 ELSE 0 END), 0) AS same_hand_count,
                COALESCE(SUM(used_caps_lock), 0) AS caps_lock_count
         FROM classified`
      )
      .get(LOCAL_PROFILE_ID, since) as {
      left_count: number;
      right_count: number;
      both_count: number;
      missing_count: number;
      same_hand_count: number;
      caps_lock_count: number;
    };
    const shiftSummary = {
      left: shift.left_count,
      right: shift.right_count,
      both: shift.both_count,
      missing: shift.missing_count,
      sameHand: shift.same_hand_count,
      capsLock: shift.caps_lock_count
    };
    const errorAnalysis = this.getPeriodErrorAnalysis(since);
    const experiment = this.getExperimentReport(since);
    return {
      period,
      since,
      sinceLocalDate: bounds.localDate,
      overview,
      trend,
      features,
      confusion,
      groups,
      recentErrors,
      shiftSummary,
      errorAnalysis,
      experiment
    };
  }

  saveSessionSubjectiveFeedback(
    sessionId: string,
    feedback: { difficulty: number; fatigue: number }
  ): Record<string, number> {
    const session = this.db
      .prepare(
        `SELECT status, summary_json FROM sessions
         WHERE id = ? AND profile_id = ?`
      )
      .get(sessionId, LOCAL_PROFILE_ID) as
      { status: string; summary_json: string | null } | undefined;
    if (!session || session.status !== "completed") {
      throw new Error("Completed session not found");
    }
    if (!session.summary_json) throw new Error("Completed session summary is missing");
    const summary = parsePersistedJson(
      session.summary_json,
      "session summary",
      persistedSessionSummarySchema
    );
    const subjectiveFeedback = {
      difficulty: feedback.difficulty,
      fatigue: feedback.fatigue,
      savedAt: now()
    };
    this.db
      .prepare("UPDATE sessions SET summary_json = ? WHERE id = ? AND profile_id = ?")
      .run(json({ ...summary, subjectiveFeedback }), sessionId, LOCAL_PROFILE_ID);
    return { difficulty: feedback.difficulty, fatigue: feedback.fatigue };
  }

  private getExperimentReport(since: string): Record<string, unknown> {
    const settings = this.getSettings();
    if (!settings.experimentEnabled) {
      return buildExperimentReport({ settings, sessions: [], events: [] });
    }

    const sessionRows = this.db
      .prepare(
        `SELECT id, strategy, mode, status, active_ms, summary_json, started_at, completed_at
         FROM sessions
         WHERE profile_id = ? AND kind = 'training' AND started_at >= ?
           AND strategy IN ('adaptive','baseline')
         ORDER BY started_at`
      )
      .all(LOCAL_PROFILE_ID, since) as {
      id: string;
      strategy: "adaptive" | "baseline";
      mode: string;
      status: string;
      active_ms: number;
      summary_json: string | null;
      started_at: string;
      completed_at: string | null;
    }[];
    const sessions: ExperimentSession[] = sessionRows.map((session) => ({
      id: session.id,
      strategy: session.strategy,
      mode: session.mode,
      status: session.status,
      activeMs: session.active_ms,
      summary: session.summary_json
        ? this.canonicalizePersistedSessionSummary(
            session.id,
            session.active_ms,
            parsePersistedJson(
              session.summary_json,
              "session summary",
              persistedSessionSummarySchema
            )
          ).summary
        : null,
      startedAt: session.started_at,
      completedAt: session.completed_at
    }));

    const eventRows = this.db
      .prepare(
        `SELECT s.id AS session_id, s.strategy, s.mode AS session_mode, s.completed_at,
                e.sequence, e.server_time, e.target_char, e.is_correct, e.iki_ms,
                e.was_long_pause, e.was_refocus, e.was_paused, e.was_throttled, e.was_repeat,
                e.is_after_error, e.block_id, b.block_type, l.focus_json
         FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
         LEFT JOIN micro_blocks b ON b.id = e.block_id
         LEFT JOIN lessons l ON l.id = b.lesson_id
         WHERE s.profile_id = ? AND s.kind = 'training' AND s.status = 'completed'
           AND s.started_at >= ? AND s.strategy IN ('adaptive','baseline')
         ORDER BY s.started_at, e.sequence`
      )
      .all(LOCAL_PROFILE_ID, since) as {
      session_id: string;
      strategy: "adaptive" | "baseline";
      session_mode: string;
      completed_at: string;
      sequence: number;
      server_time: string;
      target_char: string;
      is_correct: number;
      iki_ms: number | null;
      was_long_pause: number;
      was_refocus: number;
      was_paused: number;
      was_throttled: number;
      was_repeat: number;
      is_after_error: number;
      block_id: string | null;
      block_type: string | null;
      focus_json: string | null;
    }[];
    const events: ExperimentEvent[] = eventRows.map((event) => ({
      sessionId: event.session_id,
      strategy: event.strategy,
      sessionMode: event.session_mode,
      completedAt: event.completed_at,
      sequence: event.sequence,
      serverTime: event.server_time,
      targetChar: event.target_char,
      isCorrect: event.is_correct,
      ikiMs: event.iki_ms,
      wasLongPause: event.was_long_pause,
      wasRefocus: event.was_refocus,
      wasPaused: event.was_paused,
      wasThrottled: event.was_throttled,
      wasRepeat: event.was_repeat,
      isAfterError: event.is_after_error,
      blockId: event.block_id,
      blockType: event.block_type,
      focusJson: event.focus_json
    }));
    return buildExperimentReport({ settings, sessions, events });
  }
  getGoal(): Record<string, unknown> {
    return this.db.prepare("SELECT * FROM goals WHERE id = 'primary-goal'").get() as Record<
      string,
      unknown
    >;
  }

  getTraditionalProgress(): {
    stages: { id: string; order: number; completed: boolean; unlocked: boolean }[];
  } {
    const stageIds = ["home", "index", "other", "top", "bottom", "numbers", "symbols", "shift"];
    const completedStageRows = this.db
      .prepare(
        `SELECT stage_id
         FROM sessions
         WHERE profile_id = ? AND mode = 'traditional' AND status = 'completed'
           AND stage_id IS NOT NULL`
      )
      .all(LOCAL_PROFILE_ID) as { stage_id: string }[];
    const completed = new Set(completedStageRows.map((row) => row.stage_id));
    return {
      stages: stageIds.map((id, index) => ({
        id,
        order: index + 1,
        completed: completed.has(id),
        unlocked: index === 0 || completed.has(stageIds[index - 1] ?? "")
      }))
    };
  }

  updateGoal(input: { dailyMinutes: number; targetWpm: number; minimumAccuracy: number }): void {
    this.db
      .prepare(
        `UPDATE goals SET daily_minutes = ?, target_wpm = ?, minimum_accuracy = ?, updated_at = ?
         WHERE id = 'primary-goal'`
      )
      .run(input.dailyMinutes, input.targetWpm, input.minimumAccuracy, now());
  }

  listTests(): Record<string, unknown>[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, s.mode, s.active_ms AS session_active_ms,
                s.summary_json AS session_summary_json
         FROM tests t JOIN sessions s ON s.id = t.session_id
         ORDER BY t.created_at DESC LIMIT 100`
      )
      .all() as (Record<string, unknown> & {
      session_id: string;
      errors_json: string;
      session_active_ms: number;
      session_summary_json: string | null;
    })[];
    return rows.map((row) => {
      const { session_active_ms, session_summary_json, ...testRow } = row;
      const summary = session_summary_json
        ? this.canonicalizePersistedSessionSummary(
            row.session_id,
            session_active_ms,
            parsePersistedJson(
              session_summary_json,
              "session summary",
              persistedSessionSummarySchema
            )
          ).summary
        : null;
      let errorsValid = false;
      try {
        errorsValid = persistedTestErrorsSchema.safeParse(
          JSON.parse(row.errors_json) as unknown
        ).success;
      } catch {
        // Preserve the row so the client can identify this one damaged detail record. The
        // authoritative integrity check still reports the corruption and blocks backup creation.
      }
      return {
        ...testRow,
        ...(summary ? { raw_wpm: summary.rawWpm, net_wpm: summary.netWpm } : {}),
        errors_valid: errorsValid
      };
    });
  }

  saveTest(sessionId: string, durationSeconds: number, summary: SessionSummary): string {
    if (summary.characters === 0) {
      throw new Error("A formal test requires at least one valid training-area character");
    }
    const session = this.db
      .prepare("SELECT kind, status FROM sessions WHERE id = ?")
      .get(sessionId) as { kind: string; status: string } | undefined;
    if (!session) throw new Error("Session not found");
    if (session.kind !== "test" || session.status !== "completed") {
      throw new Error("Test session is not completed");
    }
    const existing = this.db.prepare("SELECT id FROM tests WHERE session_id = ?").get(sessionId) as
      { id: string } | undefined;
    if (existing) return existing.id;

    const errorRows = this.db
      .prepare(
        `SELECT target_char, actual_char, physical_code, text_position
         FROM keystroke_events WHERE session_id = ? AND is_correct = 0 ORDER BY sequence`
      )
      .all(sessionId) as {
      target_char: string;
      actual_char: string;
      physical_code: string;
      text_position: number;
    }[];
    const confusionCounts = new Map<
      string,
      { target: string; actual: string; physicalCode: string; count: number }
    >();
    for (const error of errorRows) {
      const key = `${error.target_char}\0${error.actual_char}\0${error.physical_code}`;
      const current = confusionCounts.get(key);
      if (current) current.count += 1;
      else {
        confusionCounts.set(key, {
          target: error.target_char,
          actual: error.actual_char,
          physicalCode: error.physical_code,
          count: 1
        });
      }
    }
    const errors: PersistedTestErrors = persistedTestErrorsSchema.parse({
      count: errorRows.length,
      truncated: errorRows.length > 100,
      topConfusions: [...confusionCounts.values()]
        .sort((left, right) => right.count - left.count)
        .slice(0, 20),
      events: errorRows.slice(-100).map((error) => ({
        target: error.target_char,
        actual: error.actual_char,
        physicalCode: error.physical_code,
        position: error.text_position
      }))
    });
    const id = randomUUID();
    const timestamp = now();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tests
           (id, session_id, duration_seconds, raw_wpm, net_wpm, accuracy, consistency,
            errors_json, created_at, keystroke_accuracy, final_text_accuracy)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sessionId,
          durationSeconds,
          summary.rawWpm,
          summary.netWpm,
          summary.accuracy,
          summary.consistency,
          json(errors),
          timestamp,
          summary.keystrokeAccuracy,
          summary.finalTextAccuracy
        );
      for (const [category, value] of [
        [`test-net-wpm:${durationSeconds}`, summary.netWpm] as const,
        [`test-accuracy:${durationSeconds}`, summary.finalTextAccuracy] as const
      ]) {
        this.db
          .prepare(
            `INSERT INTO personal_bests(profile_id, category, value, session_id, achieved_at)
             VALUES(?, ?, ?, ?, ?)
             ON CONFLICT(profile_id, category) DO UPDATE SET
               value = excluded.value,
               session_id = excluded.session_id,
               achieved_at = excluded.achieved_at
             WHERE excluded.value > personal_bests.value`
          )
          .run(LOCAL_PROFILE_ID, category, value, sessionId, timestamp);
      }
    });
    save();
    return id;
  }

  createGameRun(mode: "campaign" | "hardcore", difficulty: "standard" | "hard" | "adaptive") {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO game_runs
         (id, profile_id, mode, difficulty, status, current_level, started_at)
         VALUES(?, ?, ?, ?, 'active', 1, ?)`
      )
      .run(id, LOCAL_PROFILE_ID, mode, difficulty, timestamp);
    this.db
      .prepare(
        `INSERT INTO game_levels
         (run_id, level_number, attempt_number, status, started_at, summary_json)
         VALUES(?, 1, 1, 'active', ?, ?)`
      )
      .run(id, timestamp, json({ cycle: 1 }));
    return this.getGameRun(id);
  }

  getGameRun(id: string): Record<string, unknown> | undefined {
    const run = this.db
      .prepare("SELECT * FROM game_runs WHERE id = ? AND profile_id = ?")
      .get(id, LOCAL_PROFILE_ID) as Record<string, unknown> | undefined;
    if (!run) return undefined;
    const levels = this.db
      .prepare("SELECT * FROM game_levels WHERE run_id = ? ORDER BY level_number, attempt_number")
      .all(id);
    return { ...run, levels };
  }

  recordVerifiedGameLevelResult(input: {
    runId: string;
    sessionId: string;
    requestedOutcome: "success" | "failure";
    failureReason?: "alert-maxed" | "timeout" | "accuracy-gate";
    alertValue: number;
    requiredAccuracy: number;
    pointsPerCorrect: number;
    alertRules: {
      alertMaximum: number;
      errorAlert: number;
      longPauseAlert: number;
      recoveryStreak: number;
      recoveryPerCorrect: number;
      maximumRecoveryPerPhase: number;
    };
  }): VerifiedGameLevelResult {
    const run = this.db
      .prepare(
        `SELECT mode, difficulty, current_level, status
         FROM game_runs WHERE id = ? AND profile_id = ?`
      )
      .get(input.runId, LOCAL_PROFILE_ID) as
      { mode: string; difficulty: string; current_level: number; status: string } | undefined;
    if (!run || run.status !== "active") throw new Error("Active game run not found");
    const session = this.getSession(input.sessionId);
    if (!session) throw new Error("Game session not found");
    if (
      session.kind !== "game" ||
      session.mode !== `pineapple-level-${run.current_level}` ||
      session.status !== "completed"
    ) {
      throw new Error("Completed game session does not belong to the active level");
    }
    const alreadyUsed = this.db
      .prepare(
        `SELECT 1 FROM game_levels
         WHERE CASE WHEN json_valid(summary_json) = 1
                    THEN json_extract(summary_json, '$.sessionId') END = ? LIMIT 1`
      )
      .get(input.sessionId);
    if (alreadyUsed) throw new Error("Game session result was already committed");

    const lesson = session.lesson as { blocks?: Record<string, unknown>[] } | null | undefined;
    const blocks = lesson?.blocks ?? [];
    const stages = blocks
      .map((block) => {
        const blockType = typeof block.block_type === "string" ? block.block_type : "";
        const targetText = typeof block.target_text === "string" ? block.target_text : "";
        const match = /^game-stage-([123])$/u.exec(blockType);
        return match
          ? {
              stage: Number(match[1]),
              blockIndex: Number(block.block_index),
              targetLength: targetText.length,
              resumePosition: Number(block.resume_position)
            }
          : null;
      })
      .filter((stage): stage is NonNullable<typeof stage> => stage !== null)
      .sort((left, right) => left.stage - right.stage);
    const completedStages = stages.filter(
      (stage) =>
        stage.targetLength > 0 &&
        stage.resumePosition >= stage.targetLength &&
        stage.blockIndex === stage.stage - 1
    ).length;
    const completedAllStages =
      blocks.length === 3 &&
      stages.length === 3 &&
      completedStages === 3 &&
      stages.every((stage, index) => stage.stage === index + 1);
    if (typeof session.summary_json !== "string") {
      throw new Error("Completed game session summary is missing");
    }
    const summary = parsePersistedJson(
      session.summary_json,
      "session summary",
      persistedSessionSummarySchema
    );
    const accuracy = Number(summary.keystrokeAccuracy ?? summary.accuracy);
    const correct = Math.max(0, Number(summary.correct) || 0);
    const errors = Math.max(0, Number(summary.errors) || 0);
    const netWpm = Math.max(0, Number(summary.netWpm) || 0);
    const gameEvents = this.db
      .prepare(
        `SELECT e.is_correct, e.was_long_pause, b.block_type
         FROM keystroke_events e
         JOIN micro_blocks b ON b.id = e.block_id
         WHERE e.session_id = ? ORDER BY e.sequence`
      )
      .all(input.sessionId) as {
      is_correct: number;
      was_long_pause: number;
      block_type: string;
    }[];
    let derivedAlert = 0;
    let accurateStreak = 0;
    let recoveredThisStage = 0;
    let previousStage = "";
    for (const event of gameEvents) {
      if (event.block_type !== previousStage) {
        previousStage = event.block_type;
        accurateStreak = 0;
        recoveredThisStage = 0;
      }
      if (event.is_correct) {
        accurateStreak += 1;
        if (
          accurateStreak >= input.alertRules.recoveryStreak &&
          recoveredThisStage < input.alertRules.maximumRecoveryPerPhase
        ) {
          const recovery = Math.min(
            input.alertRules.recoveryPerCorrect,
            input.alertRules.maximumRecoveryPerPhase - recoveredThisStage,
            derivedAlert
          );
          derivedAlert -= recovery;
          recoveredThisStage += recovery;
        }
      } else {
        accurateStreak = 0;
        derivedAlert += input.alertRules.errorAlert;
      }
      if (event.was_long_pause) derivedAlert += input.alertRules.longPauseAlert;
      derivedAlert = Math.max(0, Math.min(input.alertRules.alertMaximum, derivedAlert));
    }
    const verifiedAlert =
      input.requestedOutcome === "failure"
        ? input.failureReason === "timeout"
          ? input.alertRules.alertMaximum
          : Math.max(derivedAlert, input.alertValue)
        : derivedAlert;
    const verifiedSuccess =
      input.requestedOutcome === "success" &&
      completedAllStages &&
      Number.isFinite(accuracy) &&
      accuracy >= input.requiredAccuracy &&
      verifiedAlert < input.alertRules.alertMaximum;
    if (input.requestedOutcome === "success" && !verifiedSuccess) {
      throw new Error("Game success did not meet the completed-stage and accuracy rules");
    }
    const outcome = verifiedSuccess ? "success" : "failure";
    const score =
      outcome === "success"
        ? Math.min(
            1_000_000,
            Math.max(
              100,
              Math.round(
                correct * input.pointsPerCorrect + accuracy * 500 + netWpm * 5 - verifiedAlert * 3
              )
            )
          )
        : 0;
    const errorFree = outcome === "success" && errors === 0;
    return {
      run: this.updateGameLevel(
        input.runId,
        outcome,
        score,
        verifiedAlert,
        errorFree,
        input.sessionId,
        input.failureReason
      ),
      result: {
        outcome,
        score,
        alertValue: verifiedAlert,
        errorFree,
        completedStages,
        sessionId: input.sessionId
      }
    };
  }

  updateGameLevel(
    runId: string,
    outcome: "success" | "failure",
    score: number,
    alertValue: number,
    errorFree = false,
    sessionId?: string,
    failureReason?: "alert-maxed" | "timeout" | "accuracy-gate"
  ): Record<string, unknown> {
    const run = this.db.prepare("SELECT * FROM game_runs WHERE id = ?").get(runId) as
      | {
          mode: "campaign" | "hardcore";
          difficulty: string;
          current_level: number;
          score: number;
          status: string;
        }
      | undefined;
    if (!run || run.status !== "active") throw new Error("Active game run not found");
    const timestamp = now();
    const latestAttempt = this.db
      .prepare(
        `SELECT attempt_number AS attempt, summary_json
         FROM game_levels WHERE run_id = ? AND level_number = ?
         ORDER BY attempt_number DESC LIMIT 1`
      )
      .get(runId, run.current_level) as { attempt: number; summary_json: string | null };
    if (!latestAttempt.summary_json) throw new Error("Game level summary is missing");
    const attemptMetadata = parsePersistedJson(
      latestAttempt.summary_json,
      "game level summary",
      persistedGameLevelSummarySchema
    );
    const cycle = attemptMetadata.cycle;
    const completedRunScore = run.score + score;
    const priorRunBest = this.db
      .prepare(
        `SELECT MAX(score) AS score FROM game_runs
         WHERE profile_id = ? AND mode = ? AND difficulty = ?
           AND status = 'completed' AND id <> ?`
      )
      .get(LOCAL_PROFILE_ID, run.mode, run.difficulty, runId) as { score: number | null };
    const isNewRunBest = priorRunBest.score == null || completedRunScore > priorRunBest.score;
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE game_levels SET status = ?, score = ?, alert_value = ?, completed_at = ?,
                                  summary_json = ?
           WHERE run_id = ? AND level_number = ? AND attempt_number = ?`
        )
        .run(
          outcome,
          score,
          alertValue,
          timestamp,
          json({
            cycle,
            errorFree: outcome === "success" && errorFree,
            ...(sessionId ? { sessionId } : {}),
            ...(outcome === "failure" && failureReason ? { failureReason } : {})
          }),
          runId,
          run.current_level,
          latestAttempt.attempt
        );
      if (outcome === "success") {
        if (errorFree) {
          this.db
            .prepare(
              `INSERT OR IGNORE INTO achievements(profile_id, achievement_id, unlocked_at, metadata_json)
               VALUES(?, 'error-free-level', ?, ?)`
            )
            .run(
              LOCAL_PROFILE_ID,
              timestamp,
              json({ difficulty: run.difficulty, mode: run.mode, level: run.current_level })
            );
        }
        const next = run.current_level + 1;
        if (next > 6) {
          if (isNewRunBest) {
            this.db
              .prepare(
                `UPDATE game_runs SET personal_best = 0
                 WHERE profile_id = ? AND mode = ? AND difficulty = ? AND id <> ?`
              )
              .run(LOCAL_PROFILE_ID, run.mode, run.difficulty, runId);
          }
          this.db
            .prepare(
              `UPDATE game_runs SET status = 'completed', score = score + ?, alert_value = ?,
               completed_at = ?, personal_best = ? WHERE id = ?`
            )
            .run(score, alertValue, timestamp, Number(isNewRunBest), runId);
          this.db
            .prepare(
              `INSERT OR IGNORE INTO achievements(profile_id, achievement_id, unlocked_at, metadata_json)
               VALUES(?, 'first-fiction-breach', ?, ?)`
            )
            .run(LOCAL_PROFILE_ID, timestamp, json({ difficulty: run.difficulty }));
          if (run.difficulty === "hard") {
            this.db
              .prepare(
                `INSERT OR IGNORE INTO achievements(profile_id, achievement_id, unlocked_at, metadata_json)
                 VALUES(?, 'hard-campaign', ?, ?)`
              )
              .run(LOCAL_PROFILE_ID, timestamp, json({ mode: run.mode }));
          }
        } else {
          this.db
            .prepare(
              "UPDATE game_runs SET current_level = ?, score = score + ?, alert_value = 0 WHERE id = ?"
            )
            .run(next, score, runId);
          const nextLevelAttempt = this.db
            .prepare(
              `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt
               FROM game_levels WHERE run_id = ? AND level_number = ?`
            )
            .get(runId, next) as { attempt: number };
          this.db
            .prepare(
              `INSERT INTO game_levels
               (run_id, level_number, attempt_number, status, started_at, summary_json)
               VALUES(?, ?, ?, 'active', ?, ?)`
            )
            .run(runId, next, nextLevelAttempt.attempt, timestamp, json({ cycle }));
        }
      } else if (run.mode === "hardcore") {
        this.db
          .prepare(
            "UPDATE game_runs SET current_level = 1, score = 0, alert_value = 0 WHERE id = ?"
          )
          .run(runId);
        const firstAttempt = this.db
          .prepare(
            "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt FROM game_levels WHERE run_id = ? AND level_number = 1"
          )
          .get(runId) as { attempt: number };
        const nextCycle = cycle + 1;
        this.db
          .prepare(
            `INSERT INTO game_levels
             (run_id, level_number, attempt_number, status, started_at, summary_json)
             VALUES(?, 1, ?, 'active', ?, ?)`
          )
          .run(runId, firstAttempt.attempt, timestamp, json({ cycle: nextCycle }));
      } else {
        this.db.prepare("UPDATE game_runs SET alert_value = 0 WHERE id = ?").run(runId);
        this.db
          .prepare(
            `INSERT INTO game_levels
             (run_id, level_number, attempt_number, status, started_at, summary_json)
             VALUES(?, ?, ?, 'active', ?, ?)`
          )
          .run(runId, run.current_level, latestAttempt.attempt + 1, timestamp, json({ cycle }));
      }
    });
    transaction();
    return this.getGameRun(runId) as Record<string, unknown>;
  }

  listAchievements(): Record<string, unknown>[] {
    return this.db
      .prepare("SELECT * FROM achievements WHERE profile_id = ? ORDER BY unlocked_at DESC")
      .all(LOCAL_PROFILE_ID) as Record<string, unknown>[];
  }

  getGameProgress(): {
    unlockedLevel: number;
    completedLevels: number[];
    personalBests: { level: number; score: number }[];
    achievements: Record<string, unknown>[];
    levels: Record<string, unknown>[];
    runs: Record<string, unknown>[];
    activeRun: Record<string, unknown> | null;
    personalBest: number | null;
  } {
    const completedLevels = (
      this.db
        .prepare(
          `SELECT DISTINCT gl.level_number
           FROM game_levels gl JOIN game_runs gr ON gr.id = gl.run_id
           WHERE gr.profile_id = ? AND gl.status = 'success'
           ORDER BY gl.level_number`
        )
        .all(LOCAL_PROFILE_ID) as { level_number: number }[]
    ).map((row) => row.level_number);
    const personalBests = this.db
      .prepare(
        `SELECT gl.level_number AS level, MAX(gl.score) AS score
           FROM game_levels gl JOIN game_runs gr ON gr.id = gl.run_id
           WHERE gr.profile_id = ? AND gl.status = 'success'
           GROUP BY gl.level_number ORDER BY gl.level_number`
      )
      .all(LOCAL_PROFILE_ID) as { level: number; score: number }[];
    const runs = this.db
      .prepare(
        `SELECT id, mode, difficulty, status, current_level, score, alert_value,
                started_at, completed_at, personal_best
         FROM game_runs WHERE profile_id = ? ORDER BY started_at DESC LIMIT 100`
      )
      .all(LOCAL_PROFILE_ID) as Record<string, unknown>[];
    const activeRun = runs.find((run) => run.status === "active") ?? null;
    const completed = new Set(completedLevels);
    const bestByLevel = new Map(personalBests.map((entry) => [entry.level, entry.score]));
    const levels = Array.from({ length: 6 }, (_, index) => {
      const level = index + 1;
      return {
        level,
        level_number: level,
        completed: completed.has(level),
        unlocked: level === 1 || completed.has(level) || completed.has(level - 1),
        bestScore: bestByLevel.get(level) ?? null
      };
    });
    const personalBestValues = runs
      .filter((run) => run.status === "completed")
      .map((run) => Number(run.score))
      .filter((score) => Number.isFinite(score));
    return {
      unlockedLevel: Math.min(6, Math.max(1, (completedLevels.at(-1) ?? 0) + 1)),
      completedLevels,
      personalBests,
      achievements: this.listAchievements(),
      levels,
      runs,
      activeRun,
      personalBest: personalBestValues.length ? Math.max(...personalBestValues) : null
    };
  }

  /**
   * Advances bundled reading positions only for micro-blocks with persisted
   * event coverage for every target position. The ordered pass closes multiple
   * consecutive blocks but refuses to jump over an unverified gap.
   */
  advanceBuiltInLongFormProgressFromEvidence(lessonId?: string): {
    completedBlocks: number;
    advancedTexts: number;
  } {
    const lessonClause = lessonId ? "AND b.lesson_id = ?" : "";
    const rows = this.db
      .prepare(
        `SELECT b.id, b.source_text_id, b.source_start, b.source_length,
                LENGTH(b.target_text) AS target_length, t.character_count
         FROM micro_blocks b
         JOIN lessons l ON l.id = b.lesson_id
         JOIN sessions s ON s.id = l.session_id
         JOIN custom_texts t ON t.id = b.source_text_id
         JOIN content_sources c ON c.id = t.source_id AND c.is_builtin = 1
         JOIN keystroke_events e ON e.block_id = b.id
         WHERE s.profile_id = ? AND s.mode = 'long-form'
           AND b.source_start IS NOT NULL AND b.source_length IS NOT NULL
           ${lessonClause}
         GROUP BY b.id, b.source_text_id, b.source_start, b.source_length,
                  b.target_text, t.character_count
         HAVING COUNT(DISTINCT CASE
                  WHEN e.text_position >= 0 AND e.text_position < LENGTH(b.target_text)
                  THEN e.text_position END) = LENGTH(b.target_text)
         ORDER BY b.source_text_id, b.source_start, b.block_index`
      )
      .all(...(lessonId ? [LOCAL_PROFILE_ID, lessonId] : [LOCAL_PROFILE_ID])) as {
      id: string;
      source_text_id: string;
      source_start: number;
      source_length: number;
      target_length: number;
      character_count: number;
    }[];
    if (rows.length === 0) return { completedBlocks: 0, advancedTexts: 0 };

    const positions = new Map<string, number>();
    const advanced = new Set<string>();
    const timestamp = now();
    const complete = this.db.prepare(
      "UPDATE micro_blocks SET completed_at = COALESCE(completed_at, ?) WHERE id = ?"
    );
    const update = this.db.prepare(
      `UPDATE custom_texts
       SET reading_position = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND reading_position < ?`
    );
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        complete.run(timestamp, row.id);
        let position = positions.get(row.source_text_id);
        if (position == null) {
          const stored = this.db
            .prepare("SELECT reading_position FROM custom_texts WHERE id = ? AND profile_id = ?")
            .get(row.source_text_id, LOCAL_PROFILE_ID) as { reading_position: number } | undefined;
          if (!stored) continue;
          position = stored.reading_position;
        }
        if (row.source_start > position) {
          positions.set(row.source_text_id, position);
          continue;
        }
        const end = Math.min(row.character_count, row.source_start + row.source_length);
        if (end > position) {
          update.run(end, timestamp, row.source_text_id, LOCAL_PROFILE_ID, end);
          position = end;
          advanced.add(row.source_text_id);
        }
        positions.set(row.source_text_id, position);
      }
    });
    transaction();
    return { completedBlocks: rows.length, advancedTexts: advanced.size };
  }

  getBuiltInLongFormSlice(lessonId: string, requestedLength: number): BuiltInLongFormSlice | null {
    if (!Number.isInteger(requestedLength) || requestedLength < 20 || requestedLength > 120) {
      throw new RangeError("Built-in long-form slice length must be an integer from 20 to 120");
    }
    // Recover progress after a browser closes between the final event batch and
    // the next-block or session-complete request.
    this.advanceBuiltInLongFormProgressFromEvidence();
    const lesson = this.db
      .prepare(
        `SELECT s.seed, s.mode
         FROM lessons l JOIN sessions s ON s.id = l.session_id
         WHERE l.id = ? AND s.profile_id = ?`
      )
      .get(lessonId, LOCAL_PROFILE_ID) as { seed: number; mode: string } | undefined;
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.mode !== "long-form") throw new Error("Lesson is not built-in long-form");

    type StoredLongForm = {
      id: string;
      title: string;
      source_id: string;
      content: string;
      character_count: number;
      reading_position: number;
      updated_at: string;
      source_name: string;
      source_type: string;
      license: string;
    };
    const existing = this.db
      .prepare(
        `SELECT t.id, t.title, t.source_id, t.content, t.character_count, t.reading_position,
                t.updated_at, c.name AS source_name, c.source_type, c.license
         FROM micro_blocks b
         JOIN custom_texts t ON t.id = b.source_text_id
         JOIN content_sources c ON c.id = t.source_id AND c.is_builtin = 1
         WHERE b.lesson_id = ?
         ORDER BY b.block_index LIMIT 1`
      )
      .get(lessonId) as StoredLongForm | undefined;
    let selected = existing;
    if (!selected) {
      const available = this.db
        .prepare(
          `SELECT t.id, t.title, t.source_id, t.content, t.character_count, t.reading_position,
                  t.updated_at, c.name AS source_name, c.source_type, c.license
           FROM custom_texts t
           JOIN content_sources c ON c.id = t.source_id AND c.is_builtin = 1
           WHERE t.profile_id = ? AND t.reading_position < t.character_count
           ORDER BY CASE WHEN t.reading_position > 0 THEN 0 ELSE 1 END,
                    t.updated_at DESC, t.id`
        )
        .all(LOCAL_PROFILE_ID) as StoredLongForm[];
      const inProgress = available.find((text) => text.reading_position > 0);
      if (inProgress) {
        selected = inProgress;
      } else if (available.length > 0) {
        const preferred = builtInLongFormTextId(selectLongFormSample({ seed: lesson.seed }).id);
        selected = available.find((text) => text.id === preferred) ?? available[0];
      }
    }
    if (!selected || selected.reading_position >= selected.character_count) return null;
    const start = selected.reading_position;
    const text = selected.content.slice(start, start + requestedLength);
    if (text.length === 0) return null;
    return {
      textId: selected.id,
      title: selected.title,
      sourceId: selected.source_id,
      sourceName: selected.source_name,
      sourceType: selected.source_type,
      license: selected.license,
      start,
      end: start + text.length,
      total: selected.character_count,
      text
    };
  }

  saveCustomText(input: {
    title: string;
    content: string;
    fileType: string;
    includeInModel: boolean;
  }): Record<string, unknown> {
    const id = randomUUID();
    const timestamp = now();
    const wordCount = input.content.trim() ? input.content.trim().split(/\s+/u).length : 0;
    this.db
      .prepare(
        `INSERT INTO custom_texts
         (id, profile_id, title, content, file_type, character_count, word_count,
          include_in_model, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        LOCAL_PROFILE_ID,
        input.title,
        input.content,
        input.fileType,
        input.content.length,
        wordCount,
        Number(input.includeInModel),
        timestamp,
        timestamp
      );
    return this.db.prepare("SELECT * FROM custom_texts WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
  }

  listCustomTexts(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT id, title, file_type, character_count, word_count, include_in_model,
                reading_position, created_at, updated_at
         FROM custom_texts
         WHERE profile_id = ? AND source_id IS NULL
         ORDER BY updated_at DESC`
      )
      .all(LOCAL_PROFILE_ID) as Record<string, unknown>[];
  }

  getCustomText(id: string): Record<string, unknown> | undefined {
    return this.db
      .prepare("SELECT * FROM custom_texts WHERE id = ? AND profile_id = ?")
      .get(id, LOCAL_PROFILE_ID) as Record<string, unknown> | undefined;
  }

  advanceCustomTextProgressFromBlock(
    id: string,
    blockId: string,
    requestedPosition?: number
  ):
    | { ok: true; readingPosition: number; expectedPosition: number }
    | { ok: false; reason: "context" | "position" | "gap"; expectedPosition?: number } {
    const block = this.db
      .prepare(
        `SELECT b.source_start, b.source_length
         FROM micro_blocks b
         JOIN lessons l ON l.id = b.lesson_id
         JOIN sessions s ON s.id = l.session_id
         WHERE b.id = ? AND b.source_text_id = ? AND s.profile_id = ? AND s.mode = 'custom'`
      )
      .get(blockId, id, LOCAL_PROFILE_ID) as
      { source_start: number | null; source_length: number | null } | undefined;
    if (!block || block.source_start == null || block.source_length == null) {
      return { ok: false, reason: "context" };
    }
    const text = this.getCustomText(id);
    if (!text) return { ok: false, reason: "context" };
    const nextPosition = Math.min(
      Number(text.character_count ?? 0),
      block.source_start + block.source_length
    );
    if (requestedPosition != null && requestedPosition !== nextPosition) {
      return { ok: false, reason: "position", expectedPosition: nextPosition };
    }
    const currentPosition = Number(text.reading_position ?? 0);
    if (block.source_start > currentPosition) {
      return { ok: false, reason: "gap", expectedPosition: nextPosition };
    }
    this.db
      .prepare(
        `UPDATE custom_texts
         SET reading_position = MAX(reading_position, ?), updated_at = ?
         WHERE id = ? AND profile_id = ?`
      )
      .run(nextPosition, now(), id, LOCAL_PROFILE_ID);
    return {
      ok: true,
      readingPosition: Number(this.getCustomText(id)?.reading_position ?? nextPosition),
      expectedPosition: nextPosition
    };
  }

  exportJson(): Record<string, unknown> {
    const data = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, this.db.prepare(`SELECT * FROM ${table}`).all()])
    );
    return {
      format: "symtype-json-backup",
      schemaVersion: this.getSchemaVersion(),
      algorithmVersion: ALGORITHM_VERSION,
      exportedAt: now(),
      data
    };
  }

  exportCsv(): string {
    const storedRows = this.db
      .prepare(
        `SELECT s.id, s.kind, s.mode, s.started_at, s.completed_at, s.active_ms, s.summary_json
         FROM sessions s WHERE s.status = 'completed' ORDER BY s.started_at`
      )
      .all() as (Record<string, string | number | null> & {
      id: string;
      active_ms: number;
      summary_json: string | null;
    })[];
    const rows: Record<string, string | number | null>[] = storedRows.map(
      ({ id, summary_json, ...row }) => {
        const summary = summary_json
          ? this.canonicalizePersistedSessionSummary(
              id,
              row.active_ms,
              parsePersistedJson(summary_json, "session summary", persistedSessionSummarySchema)
            ).summary
          : null;
        return {
          ...row,
          raw_wpm: summary?.rawWpm ?? null,
          net_wpm: summary?.netWpm ?? null,
          accuracy: summary?.accuracy ?? null,
          consistency: summary?.consistency ?? null,
          characters: summary?.characters ?? null
        };
      }
    );
    const headers = [
      "kind",
      "mode",
      "started_at",
      "completed_at",
      "active_ms",
      "raw_wpm",
      "net_wpm",
      "accuracy",
      "consistency",
      "characters"
    ];
    const escape = (value: string | number | null | undefined) => {
      const rendered = value == null ? "" : typeof value === "number" ? `${value}` : value;
      return `"${rendered.replaceAll('"', '""')}"`;
    };
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))
    ].join("\n");
  }

  async createBackup(reason: string): Promise<Record<string, unknown>> {
    const liveIntegrity = this.integrityCheck({ refresh: true });
    if (!liveIntegrity.ok) {
      throw new Error(`Database integrity check failed before backup: ${liveIntegrity.detail}`);
    }
    this.db.pragma("wal_checkpoint(PASSIVE)");
    const id = randomUUID();
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const path = join(this.config.dataDir, "backups", `symtype-${stamp}-${id.slice(0, 8)}.sqlite3`);
    await this.db.backup(path);
    const bytes = readFileSync(path);
    const validation = this.validateBackupFile(path, bytes);
    if (!validation.ok) {
      unlinkSync(path);
      throw new Error(`Backup integrity check failed: ${validation.detail}`);
    }
    const record = {
      id,
      path,
      filename: basename(path),
      reason,
      byteSize: bytes.length,
      schemaVersion: this.getSchemaVersion(),
      checksum: validation.checksum,
      createdAt: now()
    };
    this.db
      .prepare(
        `INSERT INTO backups(id, path, reason, byte_size, schema_version, checksum, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.path,
        record.reason,
        record.byteSize,
        record.schemaVersion,
        record.checksum,
        record.createdAt
      );
    this.rotateBackups(7);
    return record;
  }

  /**
   * Create at most one verified automatic snapshot per local day. This runs
   * after migrations/default layout seeding, so a startup never snapshots a
   * half-migrated database and never replaces history after an integrity error.
   */
  async ensureAutomaticBackup(): Promise<Record<string, unknown> | null> {
    const liveIntegrity = this.integrityCheck({ refresh: true });
    if (!liveIntegrity.ok) {
      throw new Error(
        `Database integrity check failed before automatic backup: ${liveIntegrity.detail}`
      );
    }
    const latest = this.db
      .prepare(
        `SELECT id, path, checksum, created_at
         FROM backups WHERE reason = 'automatic-startup'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get() as { id: string; path: string; checksum: string; created_at: string } | undefined;
    if (latest && localDate(new Date(latest.created_at)) === localDate()) {
      if (existsSync(latest.path)) {
        const validation = this.validateBackupFile(latest.path);
        if (validation.ok && validation.checksum === latest.checksum) return null;
      }
      this.removeBackupFileAndMetadata(latest.id, latest.path);
    }
    return this.createBackup("automatic-startup");
  }

  listBackups(): Record<string, unknown>[] {
    return this.db
      .prepare("SELECT * FROM backups ORDER BY created_at DESC LIMIT 20")
      .all() as Record<string, unknown>[];
  }

  private rotateBackups(keep: number): void {
    const records = this.db
      .prepare(
        `SELECT id, path, reason, schema_version, checksum
         FROM backups ORDER BY created_at DESC`
      )
      .all() as {
      id: string;
      path: string;
      reason: string;
      schema_version: number;
      checksum: string;
    }[];
    const valid: typeof records = [];
    for (const record of records) {
      const validation = existsSync(record.path)
        ? record.reason.startsWith("pre-migration-v")
          ? this.validateMigrationSnapshotFile(record.path, record.schema_version)
          : this.validateBackupFile(record.path)
        : { ok: false, detail: "missing", checksum: "" };
      if (!validation.ok || validation.checksum !== record.checksum) {
        this.removeBackupFileAndMetadata(record.id, record.path);
        continue;
      }
      valid.push(record);
    }
    for (const extra of valid.slice(keep)) {
      this.removeBackupFileAndMetadata(extra.id, extra.path);
    }
  }

  private validateMigrationSnapshotFile(
    path: string,
    expectedVersion: number
  ): { ok: boolean; detail: string; checksum: string } {
    let snapshot: Database.Database | undefined;
    try {
      const bytes = readFileSync(path);
      snapshot = new Database(path, { readonly: true, fileMustExist: true });
      const counts = this.migrationSnapshotCounts(snapshot);
      const integrity = this.migrationSnapshotIntegrity(snapshot, expectedVersion, counts);
      return { ...integrity, checksum: sha256(bytes) };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "unreadable migration snapshot",
        checksum: ""
      };
    } finally {
      snapshot?.close();
    }
  }

  private validateBackupFile(
    path: string,
    existingBytes?: Buffer
  ): { ok: boolean; detail: string; checksum: string } {
    const bytes = existingBytes ?? readFileSync(path);
    let backup: Database.Database | undefined;
    try {
      backup = new Database(path, { readonly: true, fileMustExist: true });
      const quick = (backup.pragma("quick_check") as { quick_check: string }[])
        .map((row) => row.quick_check)
        .join("; ");
      const foreignKeys = backup.pragma("foreign_key_check") as unknown[];
      const jsonFailures = this.storedJsonIntegrityFailures(backup);
      return {
        ok: quick === "ok" && foreignKeys.length === 0 && jsonFailures.length === 0,
        detail: [
          quick,
          ...(foreignKeys.length ? [`${foreignKeys.length} foreign-key violation(s)`] : []),
          ...jsonFailures
        ].join("; "),
        checksum: sha256(bytes)
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "unreadable SQLite backup",
        checksum: sha256(bytes)
      };
    } finally {
      backup?.close();
    }
  }

  private applyBackupData(data: Record<string, Record<string, unknown>[]>): void {
    for (const table of RESTORE_DELETE_ORDER) this.db.prepare(`DELETE FROM ${table}`).run();
    for (const table of BACKUP_TABLES) {
      const allowedColumns = new Set(
        (this.db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name)
      );
      for (const row of data[table] ?? []) {
        const columns = Object.keys(row).filter((column) => allowedColumns.has(column));
        if (columns.length === 0) continue;
        const identifiers = columns.map((column) => `"${column}"`).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        this.db
          .prepare(`INSERT INTO ${table} (${identifiers}) VALUES (${placeholders})`)
          .run(...columns.map((column) => row[column] ?? null));
      }
    }
  }

  private assertApplicationInvariants(): void {
    const profile = this.db.prepare("SELECT id FROM profiles WHERE id = ?").get(LOCAL_PROFILE_ID);
    if (!profile) throw new Error("Backup does not contain the local profile");
    const settings = this.db
      .prepare("SELECT value_json FROM settings WHERE profile_id = ?")
      .get(LOCAL_PROFILE_ID) as { value_json: string } | undefined;
    if (!settings) throw new Error("Backup does not contain local settings");
    const parsedSettings = parseAuthoritativeSettings(settings.value_json);
    for (const layoutId of [SYMMETRIC_LAYOUT_ID, STANDARD_LAYOUT_ID]) {
      const layout = this.db.prepare("SELECT id FROM keyboard_layouts WHERE id = ?").get(layoutId);
      const mappingCount = (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM key_mappings WHERE layout_id = ?")
          .get(layoutId) as { count: number }
      ).count;
      if (!layout || mappingCount === 0)
        throw new Error("Backup is missing a default keyboard layout");
    }
    const activeLayouts = this.db
      .prepare(
        `SELECT id FROM keyboard_layouts
         WHERE is_active = 1 AND (profile_id IS NULL OR profile_id = ?)`
      )
      .all(LOCAL_PROFILE_ID) as { id: string }[];
    if (activeLayouts.length !== 1 || activeLayouts[0]?.id !== parsedSettings.activeLayoutId) {
      throw new Error("Backup settings and active keyboard layout do not agree");
    }
    if (!this.db.prepare("SELECT id FROM goals WHERE id = 'primary-goal'").get()) {
      throw new Error("Backup does not contain the primary goal");
    }
    if (
      !this.db.prepare("SELECT profile_id FROM streaks WHERE profile_id = ?").get(LOCAL_PROFILE_ID)
    ) {
      throw new Error("Backup does not contain local streak state");
    }
    const foreignKeyFailures = this.db.pragma("foreign_key_check") as unknown[];
    if (foreignKeyFailures.length > 0) throw new Error("Backup contains broken references");
    const integrity = this.integrityCheck({ refresh: true });
    if (!integrity.ok) throw new Error(`Backup failed integrity check: ${integrity.detail}`);
  }

  private dryRunBackup(data: Record<string, Record<string, unknown>[]>): string | undefined {
    const rollbackMarker = new Error("symtype-backup-validation-rollback");
    try {
      const validate = this.db.transaction(() => {
        this.applyBackupData(data);
        this.assertApplicationInvariants();
        throw rollbackMarker;
      });
      validate();
    } catch (error) {
      if (error === rollbackMarker) return undefined;
      return "备份内容无法安全写入当前 schema。";
    }
    return "备份校验没有正常回滚。";
  }

  private normalizeBackupData(
    data: Record<string, Record<string, unknown>[]>,
    schemaVersion: number
  ): Record<string, Record<string, unknown>[]> {
    const normalized = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, (data[table] ?? []).map((row) => ({ ...row }))])
    ) as Record<string, Record<string, unknown>[]>;
    normalized.tests = (normalized.tests ?? []).map((row) => {
      if (typeof row.accuracy !== "number" || !Number.isFinite(row.accuracy)) {
        throw new Error("Test backup row has no finite legacy accuracy");
      }
      if (schemaVersion < 5) {
        return {
          ...row,
          keystroke_accuracy: row.accuracy,
          final_text_accuracy: row.accuracy
        };
      }
      if (
        typeof row.keystroke_accuracy !== "number" ||
        !Number.isFinite(row.keystroke_accuracy) ||
        typeof row.final_text_accuracy !== "number" ||
        !Number.isFinite(row.final_text_accuracy)
      ) {
        throw new Error("Test backup row is missing dual accuracy values");
      }
      if (
        schemaVersion < 10 &&
        row.keystroke_accuracy === 0 &&
        row.final_text_accuracy === 0 &&
        row.accuracy !== 0
      ) {
        return {
          ...row,
          keystroke_accuracy: row.accuracy,
          final_text_accuracy: row.accuracy
        };
      }
      return row;
    });
    return normalized;
  }

  validateJsonBackup(candidate: unknown): {
    ok: boolean;
    summary?: Record<string, number>;
    error?: string;
  } {
    const schema = z.object({
      format: z.literal("symtype-json-backup"),
      schemaVersion: z.number().int().positive().max(this.getSchemaVersion()),
      data: z.record(z.string(), z.unknown())
    });
    const result = schema.safeParse(candidate);
    if (!result.success) return { ok: false, error: "备份格式或 schema 版本不受支持。" };
    const data: Record<string, Record<string, unknown>[]> = {};
    for (const table of BACKUP_TABLES) {
      const rows = result.data.data[table];
      if (
        !Array.isArray(rows) ||
        rows.some((row) => row == null || typeof row !== "object" || Array.isArray(row))
      ) {
        return { ok: false, error: `备份缺少有效的 ${table} 数据表。` };
      }
      data[table] = rows as Record<string, unknown>[];
    }
    let normalizedData: Record<string, Record<string, unknown>[]>;
    try {
      normalizedData = this.normalizeBackupData(data, result.data.schemaVersion);
    } catch {
      return { ok: false, error: "备份中的测试准确率数据不完整。" };
    }
    const dryRunError = this.dryRunBackup(normalizedData);
    if (dryRunError) return { ok: false, error: dryRunError };
    return {
      ok: true,
      summary: {
        profiles: normalizedData.profiles?.length ?? 0,
        sessions: normalizedData.sessions?.length ?? 0,
        events: normalizedData.keystroke_events?.length ?? 0,
        customTexts: (normalizedData.custom_texts ?? []).filter((text) => text.source_id == null)
          .length,
        gameRuns: normalizedData.game_runs?.length ?? 0
      }
    };
  }

  async restoreJsonBackup(candidate: unknown): Promise<Record<string, unknown>> {
    const validation = this.validateJsonBackup(candidate);
    if (!validation.ok) throw new Error(validation.error ?? "Invalid backup");
    const backup = candidate as {
      schemaVersion: number;
      data: Record<string, Record<string, unknown>[]>;
    };
    const normalizedData = this.normalizeBackupData(backup.data, backup.schemaVersion);
    const safetyBackup = await this.createBackup("pre-restore");
    const restore = this.db.transaction(() => {
      this.applyBackupData(normalizedData);
      this.seedBundledContent(now());
      this.assertApplicationInvariants();
    });
    restore();
    const integrity = this.integrityCheck({ refresh: true });
    if (!integrity.ok)
      throw new Error(`Restored database failed integrity check: ${integrity.detail}`);
    return { restored: true, summary: validation.summary, safetyBackup };
  }

  private readSqliteBackup(buffer: Buffer):
    | {
        ok: true;
        candidate: {
          format: "symtype-json-backup";
          schemaVersion: number;
          algorithmVersion: string;
          exportedAt: string;
          data: Record<string, Record<string, unknown>[]>;
        };
      }
    | { ok: false; error: string } {
    if (buffer.length < 100 || buffer.subarray(0, 15).toString() !== "SQLite format 3") {
      return { ok: false, error: "文件不是可识别的 SQLite 数据库。" };
    }
    const candidatePath = join(this.config.dataDir, `restore-candidate-${randomUUID()}.sqlite3`);
    let source: Database.Database | undefined;
    try {
      writeFileSync(candidatePath, buffer, { flag: "wx", mode: 0o600 });
      source = new Database(candidatePath, { readonly: true, fileMustExist: true });
      source.pragma("query_only = ON");
      const integrityRows = source.pragma("quick_check") as { quick_check: string }[];
      if (integrityRows.length !== 1 || integrityRows[0]?.quick_check !== "ok") {
        return { ok: false, error: "SQLite 备份未通过完整性检查。" };
      }
      const tableNames = new Set(
        (
          source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
            name: string;
          }[]
        ).map((row) => row.name)
      );
      if (
        !tableNames.has("schema_migrations") ||
        BACKUP_TABLES.some((table) => !tableNames.has(table))
      ) {
        return { ok: false, error: "SQLite 文件不是完整的 SymType 备份。" };
      }
      const schemaVersion = (
        source
          .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
          .get() as {
          version: number;
        }
      ).version;
      if (schemaVersion < 1 || schemaVersion > this.getSchemaVersion()) {
        return { ok: false, error: "SQLite 备份的 schema 版本不受支持。" };
      }
      const data = Object.fromEntries(
        BACKUP_TABLES.map((table) => [
          table,
          source?.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
        ])
      );
      return {
        ok: true,
        candidate: {
          format: "symtype-json-backup",
          schemaVersion,
          algorithmVersion: ALGORITHM_VERSION,
          exportedAt: now(),
          data
        }
      };
    } catch {
      return { ok: false, error: "无法安全读取这份 SQLite 备份。" };
    } finally {
      if (source?.open) source.close();
      if (existsSync(candidatePath)) unlinkSync(candidatePath);
    }
  }

  validateSqliteBackup(buffer: Buffer): {
    ok: boolean;
    summary?: Record<string, number>;
    error?: string;
  } {
    const loaded = this.readSqliteBackup(buffer);
    if (!loaded.ok) return loaded;
    return this.validateJsonBackup(loaded.candidate);
  }

  stageSqliteBackup(buffer: Buffer): {
    ok: boolean;
    token?: string;
    expiresAt?: string;
    summary?: Record<string, number>;
    error?: string;
  } {
    this.cleanupSqliteStaging();
    const validation = this.validateSqliteBackup(buffer);
    if (!validation.ok) return validation;
    const token = randomUUID();
    const path = this.sqliteStagingPath(token);
    writeFileSync(path, buffer, { flag: "wx", mode: 0o600 });
    return {
      ok: true,
      token,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      summary: validation.summary ?? {}
    };
  }

  async restoreStagedSqliteBackup(token: string): Promise<Record<string, unknown>> {
    if (!z.string().uuid().safeParse(token).success)
      throw new Error("Invalid SQLite restore token");
    const path = this.sqliteStagingPath(token);
    if (!existsSync(path)) throw new Error("SQLite restore token not found or expired");
    if (Date.now() - statSync(path).mtimeMs > 15 * 60_000) {
      unlinkSync(path);
      throw new Error("SQLite restore token not found or expired");
    }
    const buffer = readFileSync(path);
    try {
      return await this.restoreSqliteBackup(buffer);
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  }

  private sqliteStagingPath(token: string): string {
    return join(this.config.dataDir, "restore-staging", `candidate-${token}.sqlite3`);
  }

  private cleanupSqliteStaging(): void {
    const directory = join(this.config.dataDir, "restore-staging");
    if (!existsSync(directory)) return;
    const cutoff = Date.now() - 15 * 60_000;
    for (const filename of readdirSync(directory)) {
      if (!/^candidate-[0-9a-f-]{36}\.sqlite3$/iu.test(filename)) continue;
      const path = join(directory, filename);
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    }
  }

  async restoreSqliteBackup(buffer: Buffer): Promise<Record<string, unknown>> {
    const loaded = this.readSqliteBackup(buffer);
    if (!loaded.ok) throw new Error(loaded.error);
    const validation = this.validateJsonBackup(loaded.candidate);
    if (!validation.ok) throw new Error(validation.error ?? "Invalid SQLite backup");
    const normalizedData = this.normalizeBackupData(
      loaded.candidate.data,
      loaded.candidate.schemaVersion
    );
    const safetyBackup = await this.createBackup("pre-sqlite-restore");
    const restore = this.db.transaction(() => {
      this.applyBackupData(normalizedData);
      this.seedBundledContent(now());
      this.assertApplicationInvariants();
    });
    restore();
    return {
      restored: true,
      sourceFormat: "sqlite",
      summary: validation.summary,
      safetyBackup
    };
  }

  writeDiagnosticSnapshot(): string {
    const path = join(this.config.dataDir, "diagnostic-summary.json");
    writeFileSync(
      path,
      json({
        generatedAt: now(),
        schemaVersion: this.getSchemaVersion(),
        integrity: this.integrityCheck(),
        counts: {
          sessions: (
            this.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }
          ).count,
          events: (
            this.db.prepare("SELECT COUNT(*) AS count FROM keystroke_events").get() as {
              count: number;
            }
          ).count
        }
      })
    );
    return path;
  }

  close(): void {
    if (this.db.open) {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.close();
    }
  }
}
