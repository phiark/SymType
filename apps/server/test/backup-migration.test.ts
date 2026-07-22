import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { SymTypeDatabase } from "../src/db/database.js";
import { migrations } from "../src/db/migrations.js";

function configFor(dataDir: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    databasePath: join(dataDir, "symtype.sqlite3"),
    logPath: join(dataDir, "symtype.log"),
    webDist: join(dataDir, "missing-web-dist"),
    isTest: true
  };
}

function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createHistoricalDatabase(path: string, throughVersion: number): void {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of migrations) {
    if (migration.version > throughVersion) break;
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)")
      .run(migration.version, migration.name, "2024-01-01T00:00:00.000Z");
  }
  database
    .prepare(
      `INSERT INTO profiles(id, display_name, created_at, updated_at)
       VALUES('local-profile', 'Preserved typist', ?, ?)`
    )
    .run("2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO settings(profile_id, value_json, version, updated_at)
       VALUES('local-profile', ?, 1, ?)`
    )
    .run(
      JSON.stringify({
        onboardingComplete: true,
        calibrationComplete: true,
        theme: "dark",
        reducedMotion: false,
        keyboardVisible: true,
        soundEnabled: true,
        soundTheme: "soft",
        soundMode: "all",
        volume: 0.4,
        activeLayoutId: "symmetric-default",
        stopOnError: false,
        backspaceMode: "enabled",
        fontSize: 30,
        lineHeight: 1.6,
        caretStyle: "bar",
        smoothScroll: true,
        targetWpm: 45,
        minimumAccuracy: 0.94,
        trainingBias: "balanced",
        defaultDurationMinutes: 10
      }),
      "2024-01-01T00:00:00.000Z"
    );
  database
    .prepare(
      `INSERT INTO sessions
       (id, profile_id, kind, mode, strategy, status, seed, started_at, completed_at,
        algorithm_version, summary_json)
       VALUES('historical-session', 'local-profile', 'training', 'smart', 'adaptive',
              'completed', 17, ?, ?, 'historical-v1', ?)`
    )
    .run(
      "2024-01-02T00:00:00.000Z",
      "2024-01-02T00:01:00.000Z",
      JSON.stringify({
        characters: 10,
        correct: 9,
        errors: 1,
        rawWpm: 24,
        netWpm: 22,
        accuracy: 0.9,
        consistency: 0.75,
        activeMs: 5_000,
        feedback: { good: "legacy good", bottleneck: "legacy bottleneck", next: "legacy next" }
      })
    );
  database.close();
}

describe("verified automatic backup lifecycle", () => {
  const directories: string[] = [];
  const databases: SymTypeDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function open(): SymTypeDatabase {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-backup-integrity-"));
    directories.push(dataDir);
    const database = new SymTypeDatabase(configFor(dataDir));
    databases.push(database);
    return database;
  }

  test("creates at most one verified automatic startup backup per local date", async () => {
    const database = open();

    const first = await database.ensureAutomaticBackup();
    const repeated = await database.ensureAutomaticBackup();

    expect(first).toMatchObject({ reason: "automatic-startup" });
    expect(repeated).toBeNull();
    expect(
      database.db
        .prepare("SELECT COUNT(*) AS count FROM backups WHERE reason = 'automatic-startup'")
        .get()
    ).toEqual({ count: 1 });
    const stored = database.listBackups()[0] as { path: string; checksum: string };
    expect(existsSync(stored.path)).toBe(true);
    expect(checksum(stored.path)).toBe(stored.checksum);
  });

  test("removes a same-day checksum mismatch from metadata and rebuilds it", async () => {
    const database = open();
    const first = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
    };
    database.db
      .prepare("UPDATE backups SET checksum = ? WHERE id = ?")
      .run("0".repeat(64), first.id);

    const replacement = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
      checksum: string;
    };

    expect(replacement.id).not.toBe(first.id);
    expect(database.db.prepare("SELECT 1 FROM backups WHERE id = ?").get(first.id)).toBeUndefined();
    expect(checksum(replacement.path)).toBe(replacement.checksum);
    expect(
      database.db
        .prepare("SELECT COUNT(*) AS count FROM backups WHERE reason = 'automatic-startup'")
        .get()
    ).toEqual({ count: 1 });
  });

  test("removes corrupt same-day backup metadata and creates a valid replacement", async () => {
    const database = open();
    const first = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
    };
    writeFileSync(first.path, "not a sqlite database");

    const replacement = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
      checksum: string;
    };

    expect(replacement.id).not.toBe(first.id);
    expect(database.db.prepare("SELECT 1 FROM backups WHERE id = ?").get(first.id)).toBeUndefined();
    expect(checksum(replacement.path)).toBe(replacement.checksum);
    const verified = new Database(replacement.path, { readonly: true, fileMustExist: true });
    expect(verified.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
    verified.close();
  });

  test("rejects a checksum-matching snapshot with invalid persisted JSON semantics", async () => {
    const database = open();
    const first = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
    };
    const altered = new Database(first.path);
    altered
      .prepare("UPDATE settings SET value_json = '{}' WHERE profile_id = ?")
      .run("local-profile");
    altered.close();
    database.db
      .prepare("UPDATE backups SET checksum = ? WHERE id = ?")
      .run(checksum(first.path), first.id);

    const replacement = (await database.ensureAutomaticBackup()) as {
      id: string;
      path: string;
      checksum: string;
    };

    expect(replacement.id).not.toBe(first.id);
    expect(database.db.prepare("SELECT 1 FROM backups WHERE id = ?").get(first.id)).toBeUndefined();
    expect(checksum(replacement.path)).toBe(replacement.checksum);
  });

  test("rotates metadata to the seven newest valid snapshots only", async () => {
    const database = open();
    const initial: { id: string; path: string }[] = [];
    for (let index = 0; index < 7; index += 1) {
      const backup = (await database.createBackup(`rotation-${index}`)) as {
        id: string;
        path: string;
      };
      initial.push(backup);
      database.db
        .prepare("UPDATE backups SET created_at = ? WHERE id = ?")
        .run(`2024-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, backup.id);
    }

    const corrupt = initial[3];
    expect(corrupt).toBeDefined();
    writeFileSync(corrupt!.path, "corrupt snapshot");
    await database.createBackup("rotation-7");
    await database.createBackup("rotation-8");

    const records = database.db
      .prepare("SELECT id, path, checksum, created_at FROM backups ORDER BY created_at DESC")
      .all() as { id: string; path: string; checksum: string; created_at: string }[];
    expect(records).toHaveLength(7);
    expect(records.some((record) => record.id === corrupt!.id)).toBe(false);
    expect(records.some((record) => record.id === initial[0]?.id)).toBe(false);
    for (const record of records) {
      expect(existsSync(record.path)).toBe(true);
      expect(checksum(record.path)).toBe(record.checksum);
      const verified = new Database(record.path, { readonly: true, fileMustExist: true });
      expect(verified.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
      verified.close();
    }
  });
});

describe("forward-only schema migration safety", () => {
  const directories: string[] = [];
  const databases: SymTypeDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("upgrades a version-one database through the latest migration without losing history", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-migration-upgrade-"));
    directories.push(dataDir);
    const config = configFor(dataDir);
    createHistoricalDatabase(config.databasePath, 1);

    const database = new SymTypeDatabase(config);
    databases.push(database);

    expect(database.getSchemaVersion()).toBe(migrations.at(-1)?.version);
    expect(
      database.db.prepare("SELECT display_name FROM profiles WHERE id = 'local-profile'").get()
    ).toEqual({ display_name: "Preserved typist" });
    expect(
      database.db
        .prepare("SELECT algorithm_version FROM sessions WHERE id = ?")
        .get("historical-session")
    ).toEqual({ algorithm_version: "historical-v1" });
    expect(database.getSettings()).toMatchObject({
      keyboardFingerColors: true,
      progressionAccuracy: 0.975,
      experimentEnabled: false
    });
    expect(database.completeSession("historical-session")).toMatchObject({
      keystrokeAccuracy: 0.9,
      finalTextAccuracy: 0.9,
      errorAnalysis: { validTimingSamples: 0 }
    });
    expect(database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
    const sessionColumns = database.db.pragma("table_info(sessions)") as { name: string }[];
    expect(sessionColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "include_in_model",
        "keyboard_layout_id",
        "layout_snapshot_json",
        "stage_id"
      ])
    );
    const indexes = database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as { name: string }[];
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "idx_sessions_profile_completed",
        "idx_micro_blocks_type_lesson",
        "idx_keystrokes_block_sequence"
      ])
    );
  });

  test("version ten backfills dual accuracy for tests left at v5 defaults", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-migration-test-accuracy-"));
    directories.push(dataDir);
    const config = configFor(dataDir);
    createHistoricalDatabase(config.databasePath, 5);
    const fixture = new Database(config.databasePath);
    fixture
      .prepare(
        `INSERT INTO tests
         (id, session_id, duration_seconds, raw_wpm, net_wpm, accuracy, consistency,
          errors_json, created_at)
         VALUES(?, 'historical-session', 60, 42, 39, 0.875, 0.8, ?, ?)`
      )
      .run(
        "historical-test",
        JSON.stringify({ count: 0, topConfusions: [], events: [] }),
        "2024-01-02T00:01:00.000Z"
      );
    fixture.close();

    const database = new SymTypeDatabase(config);
    databases.push(database);

    expect(
      database.db
        .prepare(
          `SELECT accuracy, keystroke_accuracy, final_text_accuracy
           FROM tests WHERE id = 'historical-test'`
        )
        .get()
    ).toEqual({ accuracy: 0.875, keystroke_accuracy: 0.875, final_text_accuracy: 0.875 });
    expect(database.getSchemaVersion()).toBe(10);
  });

  test("surfaces a migration failure atomically without rebuilding or deleting history", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-migration-failure-"));
    directories.push(dataDir);
    const config = configFor(dataDir);
    createHistoricalDatabase(config.databasePath, 7);
    const fixture = new Database(config.databasePath);
    fixture.exec(
      "CREATE INDEX idx_micro_blocks_type_lesson ON micro_blocks(target_text, lesson_id)"
    );
    fixture.close();

    expect(() => new SymTypeDatabase(config)).toThrow(/idx_micro_blocks_type_lesson/u);

    const preserved = new Database(config.databasePath, { readonly: true, fileMustExist: true });
    expect(
      preserved.prepare("SELECT display_name FROM profiles WHERE id = 'local-profile'").get()
    ).toEqual({ display_name: "Preserved typist" });
    expect(
      preserved
        .prepare("SELECT algorithm_version FROM sessions WHERE id = ?")
        .get("historical-session")
    ).toEqual({ algorithm_version: "historical-v1" });
    expect(
      preserved.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
    ).toEqual({ version: 7 });
    expect(
      preserved
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_profile_completed'"
        )
        .get()
    ).toBeUndefined();
    expect(
      preserved
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_micro_blocks_type_lesson'"
        )
        .get()
    ).toBeDefined();
    preserved.close();
  });
});
