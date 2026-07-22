import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { SymTypeDatabase, SYMMETRIC_LAYOUT_ID } from "../src/db/database.js";

describe("repository parameterization", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("stores attack-shaped layout, custom text, and backup fields only as data", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-parameterization-"));
    directories.push(dataDir);
    const database = new SymTypeDatabase({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "logs", "symtype.log"),
      webDist: join(dataDir, "web-dist-not-present"),
      isTest: true
    });
    const attack = `x'); DROP TABLE profiles; -- " <script>`;
    try {
      const layoutId = database.createCustomLayout(attack, SYMMETRIC_LAYOUT_ID);
      expect(database.listLayouts()).toContainEqual(
        expect.objectContaining({ id: layoutId, name: attack })
      );

      const text = database.saveCustomText({
        title: attack,
        content: `${attack}\nSELECT * FROM settings;`,
        fileType: "txt",
        includeInModel: false
      });
      expect(database.getCustomText(String(text.id))).toMatchObject({
        title: attack,
        content: `${attack}\nSELECT * FROM settings;`
      });

      const backup = await database.createBackup(attack);
      expect(backup).toMatchObject({ reason: attack });
      expect(database.listBackups()).toContainEqual(expect.objectContaining({ reason: attack }));
      expect(database.db.prepare("SELECT COUNT(*) AS count FROM profiles").get()).toEqual({
        count: 1
      });
    } finally {
      database.close();
    }
  });
});
