import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AppContext } from "../src/app.js";
import { FIXED_NOW, GoldenHarness, type SessionIds } from "./v1-golden.fixture.js";

function normalizedRows(context: AppContext, session: SessionIds) {
  const rows = context.database.db
    .prepare(
      `SELECT sequence, client_time_ms, server_time, target_char, actual_char, physical_code, shift_side,
              modifiers_json, is_correct, is_correction, backspace_count, iki_ms, feature_char,
              bigram, trigram, mapped_hand, mapped_finger, keyboard_row, zone, character_class,
              content_mode, text_position, is_word_boundary, is_after_error, was_refocus,
              was_paused, was_long_pause, was_throttled, was_repeat
       FROM keystroke_events WHERE session_id = ? ORDER BY sequence`
    )
    .all(session.id) as Record<string, unknown>[];
  return rows.map((row) => ({
    serverTime: row.server_time,
    input: [row.sequence, row.client_time_ms, row.target_char, row.actual_char, row.physical_code],
    modifiers: [row.shift_side, JSON.parse(String(row.modifiers_json))],
    result: [row.is_correct, row.is_correction, row.backspace_count, row.iki_ms],
    feature: [row.feature_char, row.bigram, row.trigram],
    mapping: [
      row.mapped_hand,
      row.mapped_finger,
      row.keyboard_row,
      row.zone,
      row.character_class,
      row.content_mode
    ],
    position: [
      row.text_position,
      row.is_word_boundary,
      row.is_after_error,
      row.was_refocus,
      row.was_paused,
      row.was_long_pause,
      row.was_throttled,
      row.was_repeat
    ]
  }));
}

describe.sequential("V1 server persistence goldens", () => {
  let harness: GoldenHarness;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    harness = new GoldenHarness();
  });

  afterEach(async () => {
    await harness.dispose();
    vi.useRealTimers();
  });

  test("freezes the literal 22-table SQLite manifest", async () => {
    const context = await harness.openApp();
    const tables = (
      context.database.db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        )
        .all() as { name: string }[]
    ).map(({ name }) => name);
    expect(tables).toEqual([
      "achievements",
      "backups",
      "content_sources",
      "custom_texts",
      "daily_summaries",
      "event_batches",
      "feature_stats",
      "game_levels",
      "game_runs",
      "goals",
      "key_mappings",
      "keyboard_layouts",
      "keystroke_events",
      "lessons",
      "micro_blocks",
      "personal_bests",
      "profiles",
      "schema_migrations",
      "sessions",
      "settings",
      "streaks",
      "tests"
    ]);
    expect(context.database.getSchemaVersion()).toBe(10);
  });

  test("freezes authoritative normalization for a canonical event sequence", async () => {
    const context = await harness.openApp();
    const session = harness.createSession(context);
    const block = harness.createBlock(context, session, "aA!");
    const events = [
      harness.event({ sequence: 0, targetChar: "a", physicalCode: "KeyA", textPosition: 0 }),
      harness.event({
        sequence: 1,
        targetChar: "A",
        actualChar: "S",
        physicalCode: "KeyS",
        textPosition: 1,
        overrides: {
          shiftSide: "right",
          modifiers: { shift: true, capsLock: false },
          isCorrect: false
        }
      }),
      harness.event({
        sequence: 2,
        targetChar: "A",
        physicalCode: "KeyA",
        textPosition: 1,
        overrides: {
          shiftSide: "right",
          modifiers: { shift: true, capsLock: false },
          backspaceCount: 1,
          ikiMs: 220
        }
      }),
      harness.event({
        sequence: 3,
        targetChar: "!",
        physicalCode: "Digit1",
        textPosition: 2,
        overrides: {
          shiftSide: "right",
          modifiers: { shift: true, capsLock: false },
          ikiMs: 230,
          wasRefocus: true
        }
      })
    ];
    expect(harness.ingest(context, session, block, events)).toEqual({
      duplicate: false,
      accepted: 4,
      checkpoint: 3
    });
    expect(normalizedRows(context, session)).toEqual([
      {
        serverTime: "2025-02-14T08:00:00.000Z",
        input: [0, 0, "a", "a", "KeyA"],
        modifiers: ["none", { shift: false, capsLock: false }],
        result: [1, 0, 0, null],
        feature: ["a", null, null],
        mapping: ["left", "left-pinky", "home", "left-pinky", "lowercase", "smart"],
        position: [0, 0, 0, 0, 0, 0, 0, 0]
      },
      {
        serverTime: "2025-02-14T08:00:00.000Z",
        input: [1, 210, "A", "S", "KeyS"],
        modifiers: ["right", { shift: true, capsLock: false }],
        result: [0, 0, 0, 210],
        feature: ["A", "aA", null],
        mapping: ["left", "left-pinky", "home", "left-pinky", "uppercase", "smart"],
        position: [1, 0, 0, 0, 0, 0, 0, 0]
      },
      {
        serverTime: "2025-02-14T08:00:00.000Z",
        input: [2, 420, "A", "A", "KeyA"],
        modifiers: ["right", { shift: true, capsLock: false }],
        result: [1, 1, 1, 220],
        feature: ["A", "aA", null],
        mapping: ["left", "left-pinky", "home", "left-pinky", "uppercase", "smart"],
        position: [1, 0, 1, 0, 0, 0, 0, 0]
      },
      {
        serverTime: "2025-02-14T08:00:00.000Z",
        input: [3, 630, "!", "!", "Digit1"],
        modifiers: ["right", { shift: true, capsLock: false }],
        result: [1, 0, 0, 230],
        feature: ["!", "A!", "aA!"],
        mapping: ["left", "left-pinky", "number", "left-pinky", "symbol", "smart"],
        position: [2, 0, 0, 1, 0, 0, 0, 0]
      }
    ]);
    expect(
      context.database.db
        .prepare(
          `SELECT first_sequence, last_sequence, event_count, received_at
           FROM event_batches WHERE session_id = ?`
        )
        .get(session.id)
    ).toEqual({
      first_sequence: 0,
      last_sequence: 3,
      event_count: 4,
      received_at: "2025-02-14T08:00:00.000Z"
    });
  });

  test("freezes session completion and interrupted-session recovery", async () => {
    const context = await harness.openApp();
    const session = harness.createSession(context);
    const block = harness.createBlock(context, session, "ab");
    harness.ingest(context, session, block, [
      harness.event({ sequence: 0, targetChar: "a", physicalCode: "KeyA", textPosition: 0 }),
      harness.event({
        sequence: 1,
        targetChar: "b",
        actualChar: "n",
        physicalCode: "KeyN",
        textPosition: 1,
        overrides: { isCorrect: false }
      })
    ]);
    const summary = context.database.completeSession(session.id, 10_000);
    expect({ ...summary, errorAnalysis: "<separately-classified>" }).toEqual({
      characters: 2,
      correct: 1,
      errors: 1,
      rawWpm: 2.4,
      netWpm: 0,
      keystrokeAccuracy: 0.5,
      finalTextAccuracy: 0.5,
      accuracy: 0.5,
      consistency: 0,
      activeMs: 10_000,
      longestAccurateStreak: 1,
      feedback: {
        good: "完成了 2 个有证据的练习字符。",
        bottleneck: "1 次错误拖低了净速度；下一轮先守住准确率。",
        next: "安排更短的 blocked micro-block，并降低目标速度。"
      },
      errorAnalysis: "<separately-classified>"
    });

    const interrupted = harness.createSession(context);
    const interruptedBlock = harness.createBlock(context, interrupted, "q");
    harness.ingest(context, interrupted, interruptedBlock, [
      harness.event({ sequence: 0, targetChar: "q", physicalCode: "KeyQ", textPosition: 0 })
    ]);
    const recovered = context.database.recoverSession(interrupted.id, "abandon", 1_250);
    expect({
      recovered: recovered.recovered,
      status: recovered.status,
      characters: recovered.summary.characters,
      rawWpm: recovered.summary.rawWpm,
      netWpm: recovered.summary.netWpm,
      accuracy: recovered.summary.accuracy,
      activeMs: recovered.summary.activeMs
    }).toEqual({
      recovered: true,
      status: "abandoned",
      characters: 1,
      rawWpm: 9.6,
      netWpm: 9.6,
      accuracy: 1,
      activeMs: 1_250
    });
    expect(context.database.recoverSession(interrupted.id)).toEqual(recovered);
  });
});
