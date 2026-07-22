import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { STANDARD_PRESET, SYMMETRIC_PRESET } from "@symtype/shared";
import Database from "better-sqlite3";

import {
  ALGORITHM_VERSION,
  DEFAULT_SETTINGS,
  STANDARD_LAYOUT_ID,
  SYMMETRIC_LAYOUT_ID
} from "../../../apps/server/src/db/database.js";
import { migrations } from "../../../apps/server/src/db/migrations.js";
import { FIXED_PROFILE_ID, FIXED_UTC } from "./fixture-constants.js";

export function createProductionSchema(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
  database.pragma("temp_store = MEMORY");
  database.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
  );
  const apply = database.transaction(() => {
    for (const migration of migrations) {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)")
        .run(migration.version, migration.name, FIXED_UTC);
    }
  });
  apply();
  insertFoundation(database);
  return database;
}

export function checkpointAndClose(database: Database.Database): void {
  if (!database.open) return;
  database.pragma("wal_checkpoint(TRUNCATE)");
  database.close();
}

function insertFoundation(database: Database.Database): void {
  const insert = database.transaction(() => {
    database
      .prepare("INSERT INTO profiles(id, display_name, created_at, updated_at) VALUES(?, ?, ?, ?)")
      .run(FIXED_PROFILE_ID, "Performance typist", FIXED_UTC, FIXED_UTC);
    database
      .prepare(
        "INSERT INTO settings(profile_id, value_json, version, updated_at) VALUES(?, ?, 1, ?)"
      )
      .run(FIXED_PROFILE_ID, JSON.stringify(DEFAULT_SETTINGS), FIXED_UTC);
    insertLayout(database, {
      id: SYMMETRIC_LAYOUT_ID,
      name: "Symmetric（默认）",
      preset: "symmetric",
      active: 1,
      definition: SYMMETRIC_PRESET
    });
    insertLayout(database, {
      id: STANDARD_LAYOUT_ID,
      name: "Standard",
      preset: "standard",
      active: 0,
      definition: STANDARD_PRESET
    });
    database
      .prepare(
        `INSERT INTO goals
         (id, profile_id, daily_minutes, target_wpm, minimum_accuracy, effective_from, updated_at)
         VALUES('primary-goal', ?, 10, 45, 0.94, '2025-01-15', ?)`
      )
      .run(FIXED_PROFILE_ID, FIXED_UTC);
    database
      .prepare(
        `INSERT INTO streaks(profile_id, current_days, longest_days, last_training_date)
         VALUES(?, 7, 12, '2025-01-15')`
      )
      .run(FIXED_PROFILE_ID);
  });
  insert();
}

interface LayoutFixture {
  readonly id: string;
  readonly name: string;
  readonly preset: "symmetric" | "standard";
  readonly active: number;
  readonly definition: typeof SYMMETRIC_PRESET;
}

function insertLayout(database: Database.Database, layout: LayoutFixture): void {
  database
    .prepare(
      `INSERT INTO keyboard_layouts
       (id, profile_id, name, preset, is_active, created_at, updated_at)
       VALUES(?, NULL, ?, ?, ?, ?, ?)`
    )
    .run(layout.id, layout.name, layout.preset, layout.active, FIXED_UTC, FIXED_UTC);
  const insertMapping = database.prepare(
    `INSERT INTO key_mappings
     (layout_id, physical_code, unshifted, shifted, hand, finger, keyboard_row, zone, key_width)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const key of layout.definition.keys) {
    insertMapping.run(
      layout.id,
      key.code,
      key.unshifted ?? "",
      key.shifted ?? "",
      key.hand,
      key.finger,
      key.row,
      key.zone,
      key.width
    );
  }
}

export function algorithmVersion(): string {
  return ALGORITHM_VERSION;
}
