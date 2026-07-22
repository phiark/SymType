import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYMMETRIC_LAYOUT, type RuntimeStoredEvent } from "@symtype/shared";
import { afterEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";

const HOST = "127.0.0.1:4173";
const ORIGIN = `http://${HOST}`;

describe("sequential built-in long-form progress", () => {
  const directories: string[] = [];
  const contexts: AppContext[] = [];

  afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(({ app }) => app.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  async function open(dataDir: string): Promise<AppContext> {
    const context = await createApp({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "symtype.log"),
      webDist: join(dataDir, "missing-web-dist"),
      isTest: true
    });
    await context.app.ready();
    contexts.push(context);
    return context;
  }

  function headers(context: AppContext) {
    return { host: HOST, origin: ORIGIN, "x-symtype-csrf": context.csrfToken };
  }

  async function createLongFormSession(context: AppContext, seed: number) {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: headers(context),
      payload: {
        kind: "training",
        mode: "long-form",
        strategy: "adaptive",
        seed,
        focus: [],
        includeInModel: true
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ session: { id: string; lessonId: string } }>().session;
  }

  function event(sequence: number, target: string, textPosition: number): RuntimeStoredEvent {
    const mapping = SYMMETRIC_LAYOUT.find(
      (key) =>
        key.unshifted === target ||
        key.shifted === target ||
        (target === "\n" && key.code === "Enter") ||
        (target === "\t" && key.code === "Tab")
    );
    if (!mapping) throw new Error(`No ANSI mapping for ${JSON.stringify(target)}`);
    const shifted = mapping.shifted === target && mapping.unshifted !== target;
    return {
      sequence,
      clientTimeMs: sequence * 180,
      targetChar: target,
      actualChar: target,
      physicalCode: mapping.code,
      shiftSide: shifted ? (mapping.hand === "left" ? "right" : "left") : "none",
      modifiers: { shift: shifted, capsLock: false },
      isCorrect: true,
      isCorrection: false,
      backspaceCount: 0,
      ikiMs: sequence === 0 ? null : 180,
      featureChar: target,
      bigram: null,
      trigram: null,
      mappedHand: mapping.hand,
      mappedFinger: mapping.finger,
      keyboardRow: mapping.row,
      zone: mapping.zone,
      characterClass: "unknown",
      contentMode: "long-form",
      textPosition,
      isWordBoundary: /\s/u.test(target),
      isAfterError: false,
      wasRefocus: false,
      wasPaused: false,
      wasLongPause: false,
      wasThrottled: false,
      wasRepeat: false
    };
  }

  test("seeds provenance, advances only on full evidence, and resumes the same passage", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-long-form-"));
    directories.push(dataDir);
    let context = await open(dataDir);
    expect(
      context.database.db
        .prepare("SELECT COUNT(*) AS count FROM content_sources WHERE is_builtin = 1")
        .get()
    ).toMatchObject({ count: 3 });
    expect(
      context.database.db
        .prepare("SELECT COUNT(*) AS count FROM custom_texts WHERE source_id IS NOT NULL")
        .get()
    ).toMatchObject({ count: 3 });
    const customList = await context.app.inject({
      method: "GET",
      url: "/api/v1/custom-texts",
      headers: { host: HOST }
    });
    expect(customList.json()).toEqual({ texts: [] });

    const session = await createLongFormSession(context, 17);
    const firstResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: headers(context),
      payload: {
        blockIndex: 0,
        seed: 101,
        mode: "long-form",
        length: 20,
        focus: [],
        phase: "focus"
      }
    });
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json<{
      block: {
        id: string;
        target_text: string;
        source_text_id: string;
        source_start: number;
        source_length: number;
        rationale: string;
      };
      adaptiveDebug: { contentSource: { title: string; sourceId: string; progress: string } };
    }>();
    const stored = context.database.db
      .prepare("SELECT content, reading_position FROM custom_texts WHERE id = ?")
      .get(first.block.source_text_id) as { content: string; reading_position: number };
    expect(first.block).toMatchObject({ source_start: 0, source_length: 20 });
    expect(first.block.target_text).toBe(stored.content.slice(0, 20));
    expect(first.block.rationale).toContain(first.adaptiveDebug.contentSource.title);
    expect(stored.reading_position).toBe(0);

    const partialEvents = [...first.block.target_text]
      .slice(0, -1)
      .map((target, index) => event(index, target, index));
    const partial = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: headers(context),
      payload: {
        batchId: randomUUID(),
        lessonId: session.lessonId,
        blockId: first.block.id,
        events: partialEvents
      }
    });
    expect(partial.statusCode).toBe(200);
    expect(
      context.database.db
        .prepare("SELECT reading_position FROM custom_texts WHERE id = ?")
        .get(first.block.source_text_id)
    ).toMatchObject({ reading_position: 0 });

    const lastIndex = first.block.target_text.length - 1;
    const completed = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: headers(context),
      payload: {
        batchId: randomUUID(),
        lessonId: session.lessonId,
        blockId: first.block.id,
        events: [event(lastIndex, first.block.target_text[lastIndex] ?? "", lastIndex)]
      }
    });
    expect(completed.statusCode).toBe(200);
    expect(
      context.database.db
        .prepare("SELECT reading_position FROM custom_texts WHERE id = ?")
        .get(first.block.source_text_id)
    ).toMatchObject({ reading_position: 20 });
    const completedBlock = context.database.db
      .prepare("SELECT completed_at FROM micro_blocks WHERE id = ?")
      .get(first.block.id) as { completed_at: string | null };
    expect(typeof completedBlock.completed_at).toBe("string");

    const consecutiveResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: headers(context),
      payload: {
        blockIndex: 1,
        seed: 202,
        mode: "long-form",
        length: 20,
        focus: [],
        phase: "transfer"
      }
    });
    expect(consecutiveResponse.statusCode).toBe(200);
    const consecutive = consecutiveResponse.json<{
      block: { source_text_id: string; source_start: number; target_text: string };
    }>().block;
    expect(consecutive.source_text_id).toBe(first.block.source_text_id);
    expect(consecutive.source_start).toBe(20);
    expect(consecutive.target_text).toBe(stored.content.slice(20, 40));

    await context.app.close();
    contexts.splice(contexts.indexOf(context), 1);
    context = await open(dataDir);
    const resumedSession = await createLongFormSession(context, 999_991);
    const resumedResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${resumedSession.lessonId}/blocks/next`,
      headers: headers(context),
      payload: {
        blockIndex: 0,
        seed: 303,
        mode: "long-form",
        length: 20,
        focus: [],
        phase: "focus"
      }
    });
    expect(resumedResponse.statusCode).toBe(200);
    const resumed = resumedResponse.json<{
      block: { source_text_id: string; source_start: number; target_text: string };
    }>().block;
    expect(resumed.source_text_id).toBe(first.block.source_text_id);
    expect(resumed.source_start).toBe(20);
    expect(resumed.target_text).toBe(stored.content.slice(20, 40));
  });
});
