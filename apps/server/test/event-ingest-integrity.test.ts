import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYMMETRIC_LAYOUT, type RuntimeStoredEvent } from "@symtype/shared";
import { afterEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";

interface EventHarness {
  context: AppContext;
  sessionId: string;
  lessonId: string;
  blockId: string;
}

function eventFor(
  sequence: number,
  targetChar: string,
  textPosition: number,
  overrides: Partial<RuntimeStoredEvent> = {}
): RuntimeStoredEvent {
  const actualChar = overrides.actualChar ?? targetChar;
  const mapping = SYMMETRIC_LAYOUT.find(
    (key) =>
      key.unshifted === actualChar ||
      key.shifted === actualChar ||
      (actualChar === "\n" && key.code === "Enter") ||
      (actualChar === "\t" && key.code === "Tab")
  );
  if (!mapping) throw new Error(`No ANSI mapping for ${JSON.stringify(actualChar)}`);
  const shifted = mapping.shifted === actualChar && mapping.unshifted !== actualChar;
  return {
    sequence,
    clientTimeMs: sequence * 150 + 100,
    targetChar,
    actualChar,
    physicalCode: mapping.code,
    shiftSide: shifted ? (mapping.hand === "left" ? "right" : "left") : "none",
    modifiers: { shift: shifted, capsLock: false },
    isCorrect: actualChar === targetChar,
    isCorrection: false,
    backspaceCount: 0,
    ikiMs: sequence === 0 ? null : 150,
    featureChar: targetChar,
    bigram: null,
    trigram: null,
    mappedHand: mapping.hand,
    mappedFinger: mapping.finger,
    keyboardRow: mapping.row,
    zone: mapping.zone,
    characterClass: "unknown",
    contentMode: "unknown",
    textPosition,
    isWordBoundary: /\s/u.test(targetChar),
    isAfterError: false,
    wasRefocus: false,
    wasPaused: false,
    wasLongPause: false,
    wasThrottled: false,
    wasRepeat: false,
    ...overrides
  };
}

describe("server-authoritative event ingest", () => {
  const directories: string[] = [];
  const contexts: AppContext[] = [];

  afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(({ app }) => app.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  async function harness(
    targetText: string,
    mode = "common-english",
    includeInModel = false
  ): Promise<EventHarness> {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-event-integrity-"));
    directories.push(dataDir);
    const context = await createApp({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "symtype.log"),
      webDist: join(dataDir, "missing-web-dist"),
      isTest: true
    });
    contexts.push(context);
    const session = context.database.createSession({
      kind: "training",
      mode,
      strategy: "adaptive",
      seed: 7103,
      focus: [],
      includeInModel
    }) as { id: string; lessonId: string };
    const block = context.database.addMicroBlock(
      session.lessonId,
      0,
      "focus",
      targetText,
      7104,
      "Integrity fixture"
    ) as { id: string };
    return {
      context,
      sessionId: session.id,
      lessonId: session.lessonId,
      blockId: block.id
    };
  }

  test.each([
    {
      name: "target character",
      mutate: (event: RuntimeStoredEvent): RuntimeStoredEvent => ({
        ...event,
        targetChar: "b",
        isCorrect: false
      }),
      error: /immutable micro-block text/u
    },
    {
      name: "actual character",
      mutate: (event: RuntimeStoredEvent): RuntimeStoredEvent => ({
        ...event,
        actualChar: "x",
        isCorrect: false
      }),
      error: /physical key and modifiers/u
    },
    {
      name: "correctness",
      mutate: (event: RuntimeStoredEvent): RuntimeStoredEvent => ({
        ...event,
        isCorrect: false
      }),
      error: /correctness/u
    },
    {
      name: "physical code",
      mutate: (event: RuntimeStoredEvent): RuntimeStoredEvent => ({
        ...event,
        physicalCode: "NotARealAnsiKey"
      }),
      error: /layout snapshot/u
    }
  ])("rejects a forged $name and rolls back the batch", async ({ mutate, error }) => {
    const fixture = await harness("a");
    const forged = mutate(eventFor(0, "a", 0));

    expect(() =>
      fixture.context.database.ingestEvents(
        fixture.sessionId,
        randomUUID(),
        [forged],
        fixture.lessonId,
        fixture.blockId
      )
    ).toThrow(error);
    expect(
      fixture.context.database.db
        .prepare("SELECT COUNT(*) AS count FROM keystroke_events WHERE session_id = ?")
        .get(fixture.sessionId)
    ).toEqual({ count: 0 });
    expect(
      fixture.context.database.db
        .prepare("SELECT COUNT(*) AS count FROM event_batches WHERE session_id = ?")
        .get(fixture.sessionId)
    ).toEqual({ count: 0 });
  });

  test("normalizes forged mapping, n-gram, class, mode, boundary, and correction fields", async () => {
    const fixture = await harness("ab ");
    const forgedEvents = [..."ab "].map((targetChar, index) =>
      eventFor(index, targetChar, index, {
        featureChar: "fake",
        bigram: "xx",
        trigram: "xxx",
        mappedHand: "forged-hand",
        mappedFinger: "forged-finger",
        keyboardRow: "forged-row",
        zone: "forged-zone",
        characterClass: "forged-class",
        contentMode: "game-6",
        isWordBoundary: targetChar !== " ",
        isCorrection: true,
        isAfterError: true
      })
    );

    const result = fixture.context.database.ingestEvents(
      fixture.sessionId,
      randomUUID(),
      forgedEvents,
      fixture.lessonId,
      fixture.blockId
    );

    expect(result).toMatchObject({ duplicate: false, accepted: 3, checkpoint: 2 });
    const rows = fixture.context.database.db
      .prepare(
        `SELECT sequence, feature_char, bigram, trigram, mapped_hand, mapped_finger,
                keyboard_row, zone, character_class, content_mode, is_word_boundary,
                is_correction, is_after_error
         FROM keystroke_events WHERE session_id = ? ORDER BY sequence`
      )
      .all(fixture.sessionId);
    expect(rows).toEqual([
      {
        sequence: 0,
        feature_char: "a",
        bigram: null,
        trigram: null,
        mapped_hand: "left",
        mapped_finger: "left-pinky",
        keyboard_row: "home",
        zone: "left-pinky",
        character_class: "lowercase",
        content_mode: "common-english",
        is_word_boundary: 0,
        is_correction: 0,
        is_after_error: 0
      },
      {
        sequence: 1,
        feature_char: "b",
        bigram: "ab",
        trigram: null,
        mapped_hand: "left",
        mapped_finger: "left-index",
        keyboard_row: "bottom",
        zone: "left-index",
        character_class: "lowercase",
        content_mode: "common-english",
        is_word_boundary: 0,
        is_correction: 0,
        is_after_error: 0
      },
      {
        sequence: 2,
        feature_char: " ",
        bigram: "b ",
        trigram: "ab ",
        mapped_hand: "thumb",
        mapped_finger: "thumb",
        keyboard_row: "space",
        zone: "thumb",
        character_class: "whitespace",
        content_mode: "common-english",
        is_word_boundary: 1,
        is_correction: 0,
        is_after_error: 0
      }
    ]);
  });

  test("aggregates authoritative content mode only for model-eligible sessions", async () => {
    const modeled = await harness("ab ", "common-english", true);
    const excluded = await harness("ab ", "source-code", false);
    const events = [..."ab "].map((targetChar, index) => eventFor(index, targetChar, index));

    modeled.context.database.ingestEvents(
      modeled.sessionId,
      randomUUID(),
      events,
      modeled.lessonId,
      modeled.blockId
    );
    excluded.context.database.ingestEvents(
      excluded.sessionId,
      randomUUID(),
      events,
      excluded.lessonId,
      excluded.blockId
    );

    expect(
      modeled.context.database.db
        .prepare(
          `SELECT feature_value, sample_count FROM feature_stats
           WHERE feature_type = 'content-mode' ORDER BY feature_value`
        )
        .all()
    ).toEqual([{ feature_value: "common-english", sample_count: 3 }]);
    expect(
      excluded.context.database.db
        .prepare("SELECT feature_value FROM feature_stats WHERE feature_type = 'content-mode'")
        .all()
    ).toEqual([]);

    modeled.context.database.completeSession(modeled.sessionId, 1_000);
    const statistics = modeled.context.database.getStatistics("all") as {
      features: { feature_type: string; feature_value: string; sample_count: number }[];
    };
    expect(
      statistics.features.find(
        (feature) =>
          feature.feature_type === "content-mode" && feature.feature_value === "common-english"
      )
    ).toMatchObject({ sample_count: 3 });
  });

  test("repairs post-error context by sequence when an earlier batch arrives late and stays idempotent", async () => {
    const fixture = await harness("ab");
    const laterBatchId = randomUUID();
    const laterEvent = eventFor(1, "b", 1);

    const firstArrival = fixture.context.database.ingestEvents(
      fixture.sessionId,
      laterBatchId,
      [laterEvent],
      fixture.lessonId,
      fixture.blockId
    );
    const repeatedLater = fixture.context.database.ingestEvents(
      fixture.sessionId,
      laterBatchId,
      [laterEvent],
      fixture.lessonId,
      fixture.blockId
    );
    expect(firstArrival).toMatchObject({ duplicate: false, accepted: 1, checkpoint: 1 });
    expect(repeatedLater).toMatchObject({ duplicate: true, accepted: 1, checkpoint: 1 });
    expect(
      fixture.context.database.db
        .prepare(
          "SELECT is_after_error FROM keystroke_events WHERE session_id = ? AND sequence = 1"
        )
        .get(fixture.sessionId)
    ).toEqual({ is_after_error: 0 });

    const earlierBatchId = randomUUID();
    const earlierError = eventFor(0, "a", 0, {
      actualChar: "s",
      physicalCode: "KeyS",
      isCorrect: false
    });
    const lateEarlier = fixture.context.database.ingestEvents(
      fixture.sessionId,
      earlierBatchId,
      [earlierError],
      fixture.lessonId,
      fixture.blockId
    );
    const repeatedEarlier = fixture.context.database.ingestEvents(
      fixture.sessionId,
      earlierBatchId,
      [earlierError],
      fixture.lessonId,
      fixture.blockId
    );

    expect(lateEarlier).toMatchObject({ duplicate: false, accepted: 1 });
    expect(repeatedEarlier).toMatchObject({ duplicate: true, accepted: 1, checkpoint: 0 });
    expect(
      fixture.context.database.db
        .prepare(
          `SELECT sequence, is_correct, is_after_error
           FROM keystroke_events WHERE session_id = ? ORDER BY sequence`
        )
        .all(fixture.sessionId)
    ).toEqual([
      { sequence: 0, is_correct: 0, is_after_error: 0 },
      { sequence: 1, is_correct: 1, is_after_error: 1 }
    ]);
    expect(
      fixture.context.database.db
        .prepare("SELECT COUNT(*) AS count FROM event_batches WHERE session_id = ?")
        .get(fixture.sessionId)
    ).toEqual({ count: 2 });
    expect(
      fixture.context.database.db
        .prepare("SELECT client_checkpoint FROM sessions WHERE id = ?")
        .get(fixture.sessionId)
    ).toEqual({ client_checkpoint: 1 });

    expect(() =>
      fixture.context.database.ingestEvents(
        fixture.sessionId,
        laterBatchId,
        [{ ...laterEvent, clientTimeMs: laterEvent.clientTimeMs + 1 }],
        fixture.lessonId,
        fixture.blockId
      )
    ).toThrow(/different payload/u);
    expect(
      fixture.context.database.db
        .prepare("SELECT COUNT(*) AS count FROM keystroke_events WHERE session_id = ?")
        .get(fixture.sessionId)
    ).toEqual({ count: 2 });
  });
});
