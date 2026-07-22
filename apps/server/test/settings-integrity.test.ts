import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { SymTypeDatabase } from "../src/db/database.js";

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

describe("authoritative settings integrity", () => {
  const directories: string[] = [];
  const databases: SymTypeDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ["malformed JSON", "{"],
    ["schema-invalid JSON", "{}"]
  ])("rejects %s without overwriting it with defaults", (_label, corruptedValue) => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-settings-integrity-"));
    directories.push(dataDir);
    const database = new SymTypeDatabase(configFor(dataDir));
    databases.push(database);
    if (corruptedValue === "{") {
      expect(() =>
        database.db
          .prepare("UPDATE settings SET value_json = ? WHERE profile_id = ?")
          .run(corruptedValue, "local-profile")
      ).toThrow(/must be valid JSON/u);
      // Simulate corruption outside normal application writes; the trigger above proves ordinary
      // writes are blocked, while the remaining assertions prove reads never repair/overwrite it.
      database.db.exec("DROP TRIGGER validate_settings_json_update");
    }
    database.db
      .prepare("UPDATE settings SET value_json = ? WHERE profile_id = ?")
      .run(corruptedValue, "local-profile");

    expect(() => database.getSettings()).toThrow(/Authoritative settings/u);
    expect(() => database.updateSettings({ theme: "dark" })).toThrow(/Authoritative settings/u);
    expect(
      database.db
        .prepare("SELECT value_json FROM settings WHERE profile_id = ?")
        .pluck()
        .get("local-profile")
    ).toBe(corruptedValue);
  });

  test("upcasts a complete legacy settings row without overwriting the stored JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-settings-legacy-"));
    directories.push(dataDir);
    const database = new SymTypeDatabase(configFor(dataDir));
    databases.push(database);
    const legacy = { ...database.getSettings() } as Record<string, unknown>;
    delete legacy.keyboardFingerColors;
    delete legacy.progressionAccuracy;
    delete legacy.experimentEnabled;
    delete legacy.advancedWeights;
    const stored = JSON.stringify(legacy);
    database.db
      .prepare("UPDATE settings SET value_json = ? WHERE profile_id = ?")
      .run(stored, "local-profile");

    expect(database.getSettings()).toMatchObject({
      keyboardFingerColors: true,
      progressionAccuracy: 0.975,
      experimentEnabled: false,
      advancedWeights: {
        accuracy: 0.34,
        speed: 0.28,
        uncertainty: 0.12,
        transfer: 0.12,
        userFocus: 0.08,
        recovery: 0.06
      }
    });
    expect(
      database.db
        .prepare("SELECT value_json FROM settings WHERE profile_id = ?")
        .pluck()
        .get("local-profile")
    ).toBe(stored);
    expect(database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
  });
});
