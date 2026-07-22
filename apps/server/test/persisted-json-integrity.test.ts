import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runtimeTestsResponseSchema,
  STANDARD_LAYOUT,
  SYMMETRIC_LAYOUT,
  type RuntimeStoredEvent
} from "@symtype/shared";
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

describe("persisted JSON integrity", () => {
  const directories: string[] = [];
  const databases: SymTypeDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function open(): SymTypeDatabase {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-persisted-json-"));
    directories.push(dataDir);
    const database = new SymTypeDatabase(configFor(dataDir));
    const insertMapping = database.db.prepare(
      `INSERT INTO key_mappings
       (layout_id, physical_code, unshifted, shifted, hand, finger, keyboard_row, zone, key_width)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [layoutId, layout] of [
      ["symmetric-default", SYMMETRIC_LAYOUT],
      ["standard-default", STANDARD_LAYOUT]
    ] as const) {
      for (const key of layout) {
        insertMapping.run(
          layoutId,
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
    databases.push(database);
    return database;
  }

  test("write triggers reject malformed authoritative JSON", () => {
    const database = open();

    expect(() =>
      database.db
        .prepare("UPDATE settings SET value_json = ? WHERE profile_id = ?")
        .run("{", "local-profile")
    ).toThrow(/settings\.value_json must be valid JSON/u);

    expect(database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
  });

  test("a corrupted completed summary is reported and never overwritten by feedback", () => {
    const database = open();
    const session = database.createSession({
      kind: "training",
      mode: "smart",
      seed: 11,
      focus: ["a"]
    });
    const sessionId = String(session.id);
    database.completeSession(sessionId, 1_000);
    database.db.exec("DROP TRIGGER validate_sessions_json_update");
    database.db.prepare("UPDATE sessions SET summary_json = ? WHERE id = ?").run("{", sessionId);

    expect(() =>
      database.saveSessionSubjectiveFeedback(sessionId, { difficulty: 3, fatigue: 2 })
    ).toThrow(/Authoritative session summary JSON is corrupted/u);
    expect(
      database.db.prepare("SELECT summary_json FROM sessions WHERE id = ?").pluck().get(sessionId)
    ).toBe("{");
    expect(database.integrityCheck()).toMatchObject({ ok: false });
    expect(database.integrityCheck().detail).toContain("sessions.summary_json");
  });

  test("a valid legacy session summary is upcast without rewriting history", () => {
    const database = open();
    const session = database.createSession({
      kind: "training",
      mode: "smart",
      seed: 13,
      focus: ["a"]
    });
    const sessionId = String(session.id);
    database.completeSession(sessionId, 1_000);
    const legacy = {
      characters: 10,
      correct: 9,
      errors: 1,
      rawWpm: 24,
      netWpm: 22,
      accuracy: 0.9,
      consistency: 0.75,
      activeMs: 5_000,
      feedback: { good: "legacy good", bottleneck: "legacy bottleneck", next: "legacy next" }
    };
    const stored = JSON.stringify(legacy);
    database.db.prepare("UPDATE sessions SET summary_json = ? WHERE id = ?").run(stored, sessionId);

    expect(database.completeSession(sessionId)).toMatchObject({
      keystrokeAccuracy: 0.9,
      finalTextAccuracy: 0.9,
      longestAccurateStreak: 0,
      errorAnalysis: { eventCount: 10, validTimingSamples: 0 }
    });
    expect(
      database.db.prepare("SELECT summary_json FROM sessions WHERE id = ?").pluck().get(sessionId)
    ).toBe(stored);
    expect(database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
  });

  test("rejects a session snapshot when even one ANSI physical code is missing", () => {
    const database = open();
    database.db
      .prepare("DELETE FROM key_mappings WHERE layout_id = ? AND physical_code = ?")
      .run("symmetric-default", "KeyC");

    expect(() =>
      database.createSession({ kind: "training", mode: "smart", seed: 14, focus: ["c"] })
    ).toThrow(/KeyC/u);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
      count: 0
    });
  });

  test("health and SQLite preview reject semantic modifier corruption", async () => {
    const database = open();
    const session = database.createSession({
      kind: "training",
      mode: "smart",
      seed: 15,
      focus: ["a"]
    }) as { id: string; lessonId: string };
    const block = database.addMicroBlock(
      session.lessonId,
      0,
      "focus",
      "a",
      16,
      "modifier fixture"
    ) as { id: string };
    const event: RuntimeStoredEvent = {
      sequence: 0,
      clientTimeMs: 100,
      targetChar: "a",
      actualChar: "a",
      physicalCode: "KeyA",
      shiftSide: "none",
      modifiers: { shift: false, capsLock: false },
      isCorrect: true,
      isCorrection: false,
      backspaceCount: 0,
      ikiMs: null,
      featureChar: "a",
      bigram: null,
      trigram: null,
      mappedHand: "left",
      mappedFinger: "left-pinky",
      keyboardRow: "home",
      zone: "left-pinky",
      characterClass: "lowercase",
      contentMode: "smart",
      textPosition: 0,
      isWordBoundary: false,
      isAfterError: false,
      wasRefocus: false,
      wasPaused: false,
      wasLongPause: false,
      wasThrottled: false,
      wasRepeat: false
    };
    database.ingestEvents(session.id, "modifier-batch", [event], session.lessonId, block.id);
    expect(database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
    database.db
      .prepare("UPDATE keystroke_events SET modifiers_json = ? WHERE session_id = ?")
      .run(JSON.stringify({ shift: "not-a-boolean" }), session.id);

    expect(database.integrityCheck()).toMatchObject({ ok: false });
    expect(database.integrityCheck().detail).toContain("keystroke_events.modifiers_json");
    await expect(database.createBackup("must-not-snapshot-corruption")).rejects.toThrow(
      /modifiers_json/u
    );

    const candidatePath = join(database.config.dataDir, "semantic-corruption.sqlite3");
    await database.db.backup(candidatePath);
    expect(database.validateSqliteBackup(readFileSync(candidatePath))).toMatchObject({ ok: false });
  });

  test("test error evidence is schema-checked in reads and restore previews", () => {
    const database = open();
    const session = database.createSession({
      kind: "test",
      mode: "typing-test",
      seed: 17,
      focus: ["a"]
    });
    const sessionId = String(session.id);
    database.completeSession(sessionId, 15_000);
    const testId = "00000000-0000-4000-8000-000000000017";
    database.db
      .prepare(
        `INSERT INTO tests
         (id, session_id, duration_seconds, raw_wpm, net_wpm, accuracy, consistency,
          errors_json, created_at, keystroke_accuracy, final_text_accuracy)
         VALUES(?, ?, 15, 1, 1, 1, 1, ?, ?, 1, 1)`
      )
      .run(
        testId,
        sessionId,
        JSON.stringify({ count: 0, topConfusions: [], events: [] }),
        "2026-07-21T00:00:00.000Z"
      );
    expect(database.listTests()).toEqual([
      expect.objectContaining({ id: testId, errors_valid: true })
    ]);

    const candidate = structuredClone(database.exportJson()) as {
      data: { tests: Array<{ id: string; errors_json: string }> };
    };
    candidate.data.tests[0]!.errors_json = "{}";
    expect(database.validateJsonBackup(candidate)).toMatchObject({ ok: false });
    expect(database.listTests()).toEqual([
      expect.objectContaining({ id: testId, errors_valid: true })
    ]);

    database.db.prepare("UPDATE tests SET errors_json = ? WHERE id = ?").run("{}", testId);
    const damagedRows = database.listTests();
    expect(damagedRows).toEqual([
      expect.objectContaining({ id: testId, errors_json: "{}", errors_valid: false })
    ]);
    expect(runtimeTestsResponseSchema.parse({ tests: damagedRows }).tests[0]).toMatchObject({
      id: testId,
      errors_valid: false
    });
    expect(database.integrityCheck()).toMatchObject({ ok: false });
    expect(database.integrityCheck().detail).toContain("tests.errors_json");
  });

  test("restoring a pre-v5 JSON backup preserves legacy test accuracy in both metrics", async () => {
    const database = open();
    const session = database.createSession({
      kind: "test",
      mode: "typing-test",
      seed: 19,
      focus: ["a"]
    });
    const sessionId = String(session.id);
    database.completeSession(sessionId, 15_000);
    database.db
      .prepare(
        `INSERT INTO tests
         (id, session_id, duration_seconds, raw_wpm, net_wpm, accuracy, consistency,
          errors_json, created_at, keystroke_accuracy, final_text_accuracy)
         VALUES(?, ?, 15, 20, 18, 0.8, 0.75, ?, ?, 0.8, 0.8)`
      )
      .run(
        "00000000-0000-4000-8000-000000000019",
        sessionId,
        JSON.stringify({ count: 0, topConfusions: [], events: [] }),
        "2026-07-21T00:00:00.000Z"
      );
    const candidate = structuredClone(database.exportJson()) as {
      schemaVersion: number;
      data: {
        tests: Array<{
          keystroke_accuracy?: number;
          final_text_accuracy?: number;
        }>;
      };
    };
    candidate.schemaVersion = 4;
    delete candidate.data.tests[0]!.keystroke_accuracy;
    delete candidate.data.tests[0]!.final_text_accuracy;

    expect(database.validateJsonBackup(candidate)).toMatchObject({ ok: true });
    await database.restoreJsonBackup(candidate);
    expect(
      database.db
        .prepare(
          `SELECT accuracy, keystroke_accuracy, final_text_accuracy
           FROM tests WHERE id = ?`
        )
        .get("00000000-0000-4000-8000-000000000019")
    ).toEqual({ accuracy: 0.8, keystroke_accuracy: 0.8, final_text_accuracy: 0.8 });
  });
});
