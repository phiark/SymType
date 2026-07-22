import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, type AppContext } from "../src/app.js";
import type { StoredEvent } from "../src/db/database.js";

export const FIXED_NOW = new Date("2025-02-14T08:00:00.000Z");

export interface SessionIds {
  id: string;
  lessonId: string;
}

export interface BlockIds {
  id: string;
}

interface EventInput {
  sequence: number;
  targetChar: string;
  actualChar?: string;
  physicalCode: string;
  textPosition: number;
  overrides?: Partial<StoredEvent>;
}

export class GoldenHarness {
  readonly dataDir = mkdtempSync(join(tmpdir(), "symtype-v1-server-golden-"));
  private readonly contexts = new Set<AppContext>();

  async openApp(): Promise<AppContext> {
    const context = await createApp({
      host: "127.0.0.1",
      port: 0,
      dataDir: this.dataDir,
      databasePath: join(this.dataDir, "symtype.sqlite3"),
      logPath: join(this.dataDir, "logs", "symtype.log"),
      webDist: join(this.dataDir, "missing-web-dist"),
      isTest: true
    });
    await context.app.ready();
    this.contexts.add(context);
    return context;
  }

  async closeApp(context: AppContext): Promise<void> {
    if (!this.contexts.delete(context)) return;
    await context.app.close();
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.contexts].map(({ app }) => app.close()));
    this.contexts.clear();
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  createSession(
    context: AppContext,
    input: Partial<{
      kind: "calibration" | "training" | "test" | "game";
      mode: string;
      includeInModel: boolean;
    }> = {}
  ): SessionIds {
    return context.database.createSession({
      kind: "training",
      mode: "smart",
      seed: 1701,
      focus: ["aA", "A!"],
      includeInModel: true,
      ...input
    }) as unknown as SessionIds;
  }

  createBlock(
    context: AppContext,
    session: SessionIds,
    targetText: string,
    blockType = "golden-fixture"
  ): BlockIds {
    return context.database.addMicroBlock(
      session.lessonId,
      0,
      blockType,
      targetText,
      2701,
      "Frozen V1 server fixture."
    ) as unknown as BlockIds;
  }

  event(input: EventInput): StoredEvent {
    const { sequence, targetChar, physicalCode, textPosition, overrides = {} } = input;
    const actualChar = input.actualChar ?? targetChar;
    return {
      sequence,
      clientTimeMs: sequence * 210,
      targetChar,
      actualChar,
      physicalCode,
      shiftSide: "none",
      modifiers: { shift: false, capsLock: false },
      isCorrect: targetChar === actualChar,
      isCorrection: false,
      backspaceCount: 0,
      ikiMs: sequence === 0 ? null : 210,
      featureChar: "client-spoof",
      bigram: "client-spoof",
      trigram: "client-spoof",
      mappedHand: "client-spoof",
      mappedFinger: "client-spoof",
      keyboardRow: "client-spoof",
      zone: "client-spoof",
      characterClass: "client-spoof",
      contentMode: "client-spoof",
      textPosition,
      isWordBoundary: true,
      isAfterError: true,
      wasRefocus: false,
      wasPaused: false,
      wasLongPause: false,
      wasThrottled: false,
      wasRepeat: false,
      ...overrides
    };
  }

  ingest(
    context: AppContext,
    session: SessionIds,
    block: BlockIds,
    events: readonly StoredEvent[],
    batchId = "11111111-1111-4111-8111-111111111111"
  ) {
    return context.database.ingestEvents(session.id, batchId, events, session.lessonId, block.id);
  }
}
