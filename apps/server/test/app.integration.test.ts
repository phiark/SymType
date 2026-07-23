import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { GAME_RULES, SYMMETRIC_LAYOUT } from "@symtype/shared";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import type { StoredEvent } from "../src/db/database.js";
import { migrations } from "../src/db/migrations.js";
import { PRODUCT_VERSION } from "../src/product-version.js";

const HOST = "127.0.0.1:4173";
const ORIGIN = `http://${HOST}`;

interface SessionRecord {
  id: string;
  lessonId: string;
}

interface BlockRecord {
  id: string;
  target_text: string;
  source_start: number | null;
  source_length: number | null;
}

describe.sequential("SymType local server integration", () => {
  let dataDir = "";
  let previousDataDir: string | undefined;
  let previousNodeEnv: string | undefined;
  let previousLogLevel: string | undefined;
  let liveApps: Set<AppContext>;

  beforeEach(() => {
    previousDataDir = process.env.SYMTYPE_DATA_DIR;
    previousNodeEnv = process.env.NODE_ENV;
    previousLogLevel = process.env.SYMTYPE_LOG_LEVEL;
    dataDir = mkdtempSync(join(tmpdir(), "symtype-server-test-"));
    process.env.SYMTYPE_DATA_DIR = dataDir;
    process.env.NODE_ENV = "test";
    process.env.SYMTYPE_LOG_LEVEL = "silent";
    liveApps = new Set();
  });

  afterEach(async () => {
    await Promise.allSettled([...liveApps].map(({ app }) => app.close()));
    liveApps.clear();
    rmSync(dataDir, { recursive: true, force: true });
    restoreEnvironment("SYMTYPE_DATA_DIR", previousDataDir);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("SYMTYPE_LOG_LEVEL", previousLogLevel);
  });

  async function openApp(overrides: Partial<ServerConfig> = {}): Promise<AppContext> {
    const loaded = loadConfig();
    const context = await createApp({
      ...loaded,
      port: 0,
      webDist: join(dataDir, "web-dist-not-present"),
      isTest: true,
      ...overrides
    });
    await context.app.ready();
    liveApps.add(context);
    return context;
  }

  async function closeApp(context: AppContext): Promise<void> {
    if (!liveApps.delete(context)) return;
    await context.app.close();
  }

  function mutationHeaders(context: AppContext, extra: Record<string, string> = {}) {
    return {
      host: HOST,
      origin: ORIGIN,
      "x-symtype-csrf": context.csrfToken,
      ...extra
    };
  }

  async function createSession(
    context: AppContext,
    input: Partial<{
      kind: "calibration" | "training" | "test" | "game";
      mode: string;
      strategy: "adaptive" | "baseline";
      seed: number;
      focus: string[];
      includeInModel: boolean;
      stageId: "home" | "index" | "other" | "top" | "bottom" | "numbers" | "symbols" | "shift";
    }> = {}
  ): Promise<SessionRecord> {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(context),
      payload: {
        kind: "training",
        mode: "smart",
        strategy: "adaptive",
        seed: 17,
        focus: [],
        includeInModel: true,
        ...input
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ session: SessionRecord }>().session;
  }

  function createFixtureBlock(
    context: AppContext,
    session: SessionRecord,
    targetText: string,
    blockIndex = 0,
    blockType = "integration-fixture"
  ): BlockRecord {
    return context.database.addMicroBlock(
      session.lessonId,
      blockIndex,
      blockType,
      targetText,
      10_000 + blockIndex,
      "Deterministic integration fixture."
    ) as unknown as BlockRecord;
  }

  function eventPayload(
    session: SessionRecord,
    block: BlockRecord,
    events: readonly StoredEvent[],
    batchId = randomUUID()
  ) {
    return {
      batchId,
      lessonId: session.lessonId,
      blockId: block.id,
      events
    };
  }

  function event(
    sequence: number,
    targetChar: string,
    actualChar = targetChar,
    overrides: Partial<StoredEvent> = {}
  ): StoredEvent {
    const physicalCharacter = actualChar || targetChar;
    const physicalMapping = SYMMETRIC_LAYOUT.find(
      (key) =>
        (physicalCharacter === "\n" && key.code === "Enter") ||
        (physicalCharacter === "\t" && key.code === "Tab") ||
        key.unshifted === physicalCharacter ||
        key.shifted === physicalCharacter
    );
    const targetMapping = SYMMETRIC_LAYOUT.find(
      (key) =>
        (targetChar === "\n" && key.code === "Enter") ||
        (targetChar === "\t" && key.code === "Tab") ||
        key.unshifted === targetChar ||
        key.shifted === targetChar
    );
    const shifted =
      physicalMapping?.shifted === physicalCharacter &&
      physicalMapping.unshifted !== physicalCharacter;
    return {
      sequence,
      clientTimeMs: sequence * 200,
      targetChar,
      actualChar,
      physicalCode: physicalMapping?.code ?? `Key${physicalCharacter.toUpperCase()}`,
      shiftSide: shifted ? (physicalMapping?.hand === "left" ? "right" : "left") : "none",
      modifiers: { shift: shifted, capsLock: false },
      isCorrect: actualChar === targetChar,
      isCorrection: false,
      backspaceCount: 0,
      ikiMs: sequence === 0 ? null : 200,
      featureChar: targetChar,
      bigram: null,
      trigram: null,
      mappedHand: targetMapping?.hand ?? "unknown",
      mappedFinger: targetMapping?.finger ?? "unknown",
      keyboardRow: targetMapping?.row ?? "unknown",
      zone: targetMapping?.zone ?? "unknown",
      characterClass: "letter",
      contentMode: "smart",
      textPosition: sequence,
      isWordBoundary: false,
      isAfterError: false,
      wasRefocus: false,
      wasPaused: false,
      wasLongPause: false,
      wasThrottled: false,
      wasRepeat: false,
      ...overrides
    };
  }

  function localDaysAgo(days: number, hour = 12): { iso: string; localDate: string } {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    date.setDate(date.getDate() - days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return { iso: date.toISOString(), localDate: `${year}-${month}-${day}` };
  }

  test("health and local security reject rebinding, cross-origin mutation, and stale CSRF", async () => {
    const context = await openApp();
    const health = await context.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: HOST }
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      ok: true,
      service: "symtype",
      version: PRODUCT_VERSION,
      schemaVersion: migrations.at(-1)?.version,
      integrity: { ok: true, detail: "ok" }
    });
    expect(health.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.headers["x-frame-options"]).toBe("DENY");

    const rebound = await context.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "symtype.attacker.invalid" }
    });
    expect(rebound.statusCode).toBe(403);
    expect(rebound.json()).toMatchObject({ error: { code: "INVALID_HOST" } });

    const crossOrigin = await context.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: HOST, origin: "https://attacker.invalid" }
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.json()).toMatchObject({ error: { code: "INVALID_ORIGIN" } });

    const missingCsrf = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: { host: HOST, origin: ORIGIN },
      payload: { kind: "training", mode: "smart", seed: 1, focus: [] }
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ error: { code: "CSRF_FAILED" } });

    const viteAgainstProduction = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(context, { origin: "http://127.0.0.1:5173" }),
      payload: { kind: "training", mode: "smart", seed: 1, focus: [] }
    });
    expect(viteAgainstProduction.statusCode).toBe(403);

    await closeApp(context);
    process.env.NODE_ENV = "development";
    const development = await openApp({ isTest: false });
    process.env.NODE_ENV = "test";
    const viteProxyRequest = await development.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(development, { origin: "http://127.0.0.1:5173" }),
      payload: { kind: "training", mode: "smart", seed: 2, focus: [] }
    });
    expect(viteProxyRequest.statusCode).toBe(201);
  });

  test("session lifecycle is transactional, batch-idempotent, and reports both accuracy definitions", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const blockResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 101,
        mode: "smart",
        length: 40,
        focus: [],
        phase: "warmup"
      }
    });
    expect(blockResponse.statusCode).toBe(200);
    const block = blockResponse.json<{ block: BlockRecord }>().block;
    context.database.db
      .prepare("UPDATE micro_blocks SET target_text = ? WHERE id = ?")
      .run("abc", block.id);

    const outOfOrder = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        batchId: randomUUID(),
        lessonId: session.lessonId,
        blockId: block.id,
        events: [event(2, "c"), event(1, "b")]
      }
    });
    expect(outOfOrder.statusCode).toBe(400);

    const events = [
      event(0, "a", "a", { textPosition: 0 }),
      event(1, "b", "x", { textPosition: 1, isCorrect: false }),
      event(2, "b", "b", {
        textPosition: 1,
        isCorrection: true,
        backspaceCount: 1,
        isAfterError: true
      }),
      event(3, "c", "c", { textPosition: 2 })
    ];
    const batchId = randomUUID();
    const payload = { batchId, lessonId: session.lessonId, blockId: block.id, events };
    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      result: { duplicate: false, accepted: 4, checkpoint: 3 }
    });
    const resumable = await context.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${session.id}`,
      headers: { host: HOST }
    });
    expect(resumable.json()).toMatchObject({
      session: {
        keyboard_layout_id: "symmetric-default",
        layout_snapshot_version: 1,
        next_sequence: 4,
        lesson: { blocks: [expect.objectContaining({ id: block.id, resume_position: 3 })] }
      }
    });

    const duplicate = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      result: { duplicate: true, accepted: 4, checkpoint: 3 }
    });

    const changedDuplicate = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        ...payload,
        events: events.map((item, index) =>
          index === 0 ? { ...item, actualChar: "z", isCorrect: false } : item
        )
      }
    });
    expect(changedDuplicate.statusCode).toBe(409);

    const reusedSequence = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: { ...payload, batchId: randomUUID() }
    });
    expect(reusedSequence.statusCode).toBe(409);

    const completed = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 10_000 }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      saved: true,
      summary: {
        characters: 4,
        correct: 3,
        errors: 1,
        accuracy: 0.75,
        keystrokeAccuracy: 0.75,
        finalTextAccuracy: 1,
        rawWpm: 4.8,
        netWpm: 4.8,
        activeMs: 10_000,
        longestAccurateStreak: 2
      }
    });

    const completeAgain = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 99_999 }
    });
    expect(completeAgain.statusCode).toBe(200);
    expect(completeAgain.json<{ summary: { activeMs: number } }>().summary.activeMs).toBe(10_000);

    const retryAfterCompletion = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload
    });
    expect(retryAfterCompletion.statusCode).toBe(200);
    expect(retryAfterCompletion.json()).toMatchObject({ result: { duplicate: true } });

    const newAfterCompletion = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(4, "c", "c", { textPosition: 2 })])
    });
    expect(newAfterCompletion.statusCode).toBe(409);

    const statistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    expect(statistics.statusCode).toBe(200);
    const stats = statistics.json<{
      overview: {
        sessions: number;
        active_ms: number;
        characters: number;
        correct: number;
        errors: number;
        raw_wpm: number | null;
        net_wpm: number | null;
        keystroke_accuracy: number | null;
        consistency: number | null;
        stable_wpm: number | null;
        timing_samples: number;
      };
      trend: { character_count: number; raw_wpm: number; net_wpm: number }[];
      features: { feature_type: string; feature_value: string; sample_count: number }[];
    }>();
    expect(stats.overview).toMatchObject({
      sessions: 1,
      active_ms: 10_000,
      characters: 4,
      correct: 3,
      errors: 1,
      keystroke_accuracy: 0.75,
      consistency: null,
      stable_wpm: null,
      timing_samples: 2
    });
    expect(stats.overview.raw_wpm).toBeCloseTo(4.8);
    expect(stats.overview.net_wpm).toBeCloseTo(4.8);
    expect(stats.trend).toHaveLength(1);
    expect(stats.trend[0]).toMatchObject({ character_count: 4 });
    expect(stats.trend[0]?.raw_wpm).toBeCloseTo(4.8);
    expect(stats.trend[0]?.net_wpm).toBeCloseTo(4.8);

    const storedMetricSummary = JSON.parse(
      context.database.db
        .prepare("SELECT summary_json FROM sessions WHERE id = ?")
        .pluck()
        .get(session.id) as string
    ) as Record<string, unknown>;
    expect(storedMetricSummary).toMatchObject({ metricVersion: 1, uncorrectedErrors: 0 });
    const legacySummary: Record<string, unknown> = { ...storedMetricSummary, netWpm: 0 };
    delete legacySummary.metricVersion;
    delete legacySummary.uncorrectedErrors;
    context.database.db
      .prepare("UPDATE sessions SET summary_json = ? WHERE id = ?")
      .run(JSON.stringify(legacySummary), session.id);
    const withLegacySummary = context.database.getStatistics("all") as {
      overview: { raw_wpm: number; net_wpm: number };
    };
    expect(withLegacySummary.overview.raw_wpm).toBeCloseTo(4.8);
    expect(withLegacySummary.overview.net_wpm).toBeCloseTo(4.8);

    const legacyRetry = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 99_999 }
    });
    expect(legacyRetry.statusCode).toBe(200);
    expect(legacyRetry.json()).toMatchObject({ summary: { activeMs: 10_000, netWpm: 4.8 } });
    const legacySession = await context.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${session.id}`,
      headers: { host: HOST }
    });
    expect(
      JSON.parse(legacySession.json<{ session: { summary_json: string } }>().session.summary_json)
    ).toMatchObject({ activeMs: 10_000, netWpm: 4.8 });
    expect(context.database.getDashboard()).toMatchObject({
      lastSession: { summary: { activeMs: 10_000, netWpm: 4.8 } }
    });
    expect(context.database.exportCsv().split("\n")[1]).toContain('"4.8","4.8"');
    context.database.updateSettings({ experimentEnabled: true });
    const legacyExperiment = context.database.getStatistics("all") as {
      experiment: { groups: { strategy: string; netWpm: number | null }[] };
    };
    expect(
      legacyExperiment.experiment.groups.find((group) => group.strategy === "adaptive")?.netWpm
    ).toBe(4.8);
    expect(
      JSON.parse(
        context.database.db
          .prepare("SELECT summary_json FROM sessions WHERE id = ?")
          .pluck()
          .get(session.id) as string
      )
    ).toMatchObject({ netWpm: 0 });

    context.database.db
      .prepare("UPDATE sessions SET summary_json = NULL WHERE id = ?")
      .run(session.id);
    const withoutStoredSummary = context.database.getStatistics("all") as {
      overview: { raw_wpm: number; net_wpm: number };
    };
    expect(withoutStoredSummary.overview.raw_wpm).toBeCloseTo(4.8);
    expect(withoutStoredSummary.overview.net_wpm).toBeCloseTo(4.8);
    expect(
      stats.features.find(
        (feature) => feature.feature_type === "key" && feature.feature_value === "b"
      )?.sample_count
    ).toBe(2);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM keystroke_events").get()
    ).toEqual({ count: 4 });
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM event_batches").get()
    ).toEqual({ count: 1 });
  });

  test("aggregates period net WPM from total active time and final uncorrected errors", async () => {
    const context = await openApp();
    const sessionIds: string[] = [];
    const inputs = [
      { activeMs: 60_000, wrongFinalCharacter: false },
      { activeMs: 10_000, wrongFinalCharacter: true }
    ];

    for (const [sessionIndex, input] of inputs.entries()) {
      const session = await createSession(context, {
        seed: 120 + sessionIndex,
        includeInModel: false
      });
      sessionIds.push(session.id);
      const block = createFixtureBlock(context, session, "a".repeat(10));
      const accepted = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/events`,
        headers: mutationHeaders(context),
        payload: eventPayload(
          session,
          block,
          Array.from({ length: 10 }, (_, sequence) =>
            event(sequence, "a", input.wrongFinalCharacter && sequence === 9 ? "s" : "a", {
              textPosition: sequence
            })
          )
        )
      });
      expect(accepted.statusCode).toBe(200);
      const completed = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/complete`,
        headers: mutationHeaders(context),
        payload: { activeMs: input.activeMs }
      });
      expect(completed.statusCode).toBe(200);
    }

    const statistics = context.database.getStatistics("all") as {
      overview: {
        sessions: number;
        active_ms: number;
        characters: number;
        errors: number;
        raw_wpm: number;
        net_wpm: number;
      };
      trend: { raw_wpm: number; net_wpm: number }[];
    };
    expect(statistics.overview).toMatchObject({
      sessions: 2,
      active_ms: 70_000,
      characters: 20,
      errors: 1
    });
    expect(statistics.overview.raw_wpm).toBeCloseTo(24 / 7);
    expect(statistics.overview.net_wpm).toBeCloseTo(18 / 7);
    expect(statistics.overview.net_wpm).toBeLessThanOrEqual(statistics.overview.raw_wpm);
    expect(statistics.trend).toHaveLength(1);
    expect(statistics.trend[0]?.raw_wpm).toBeCloseTo(24 / 7);
    expect(statistics.trend[0]?.net_wpm).toBeCloseTo(18 / 7);

    const dashboard = context.database.getDashboard() as {
      today: { net_wpm: number };
      trend: { net_wpm: number }[];
    };
    expect(dashboard.today.net_wpm).toBeCloseTo(18 / 7);
    expect(dashboard.trend.at(-1)?.net_wpm).toBeCloseTo(18 / 7);
    const persistedDaily = context.database.db
      .prepare(
        `SELECT raw_wpm, net_wpm FROM daily_summaries
         WHERE profile_id = 'local-profile' AND kind = 'training'`
      )
      .get() as { raw_wpm: number; net_wpm: number };
    expect(persistedDaily.raw_wpm).toBeCloseTo(24 / 7);
    expect(persistedDaily.net_wpm).toBeCloseTo(18 / 7);

    for (const sessionId of sessionIds) {
      const stored = JSON.parse(
        context.database.db
          .prepare("SELECT summary_json FROM sessions WHERE id = ?")
          .pluck()
          .get(sessionId) as string
      ) as Record<string, unknown>;
      delete stored.metricVersion;
      delete stored.uncorrectedErrors;
      stored.netWpm = 0;
      context.database.db
        .prepare("UPDATE sessions SET summary_json = ? WHERE id = ?")
        .run(JSON.stringify(stored), sessionId);
    }
    const legacyStatistics = context.database.getStatistics("all") as typeof statistics;
    expect(legacyStatistics.overview.net_wpm).toBeCloseTo(18 / 7);
    expect(legacyStatistics.trend[0]?.net_wpm).toBeCloseTo(18 / 7);
    const legacyDashboard = context.database.getDashboard() as typeof dashboard;
    expect(legacyDashboard.today.net_wpm).toBeCloseTo(18 / 7);
    expect(legacyDashboard.trend.at(-1)?.net_wpm).toBeCloseTo(18 / 7);
  });

  test("15 persisted events remain 15 characters across dashboard and period analytics", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const target = "asdfjklqwertyui";
    const block = createFixtureBlock(context, session, target);
    const persisted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(
        session,
        block,
        [...target].map((character, sequence) =>
          event(sequence, character, character, { textPosition: sequence })
        )
      )
    });
    expect(persisted.statusCode).toBe(200);

    context.database.completeSession(session.id, 180_000);

    const dashboard = context.database.getDashboard() as {
      today: { sessions: number; active_ms: number; characters: number };
    };
    const statistics = context.database.getStatistics("7d") as {
      overview: { sessions: number; active_ms: number; characters: number };
    };
    const featureSamples = context.database.db
      .prepare("SELECT COALESCE(SUM(sample_count), 0) AS samples FROM feature_stats")
      .get() as { samples: number };

    expect(featureSamples.samples).toBeGreaterThan(target.length);
    expect(dashboard.today).toEqual(
      expect.objectContaining({ sessions: 1, active_ms: 180_000, characters: target.length })
    );
    expect(statistics.overview).toEqual(
      expect.objectContaining({ sessions: 1, active_ms: 180_000, characters: target.length })
    );
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM keystroke_events").get()
    ).toEqual({ count: target.length });
  });

  test("persists trailing correction checkpoints in completed and abandoned summaries", async () => {
    const context = await openApp();

    for (const disposition of ["complete", "abandon"] as const) {
      const session = await createSession(context);
      const block = createFixtureBlock(context, session, "ab");
      const accepted = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/events`,
        headers: mutationHeaders(context),
        payload: eventPayload(session, block, [
          event(0, "a"),
          event(1, "b", "x", { isCorrect: false })
        ])
      });
      expect(accepted.statusCode).toBe(200);

      if (disposition === "complete") {
        const outOfRange = await context.app.inject({
          method: "POST",
          url: `/api/v1/sessions/${session.id}/complete`,
          headers: mutationHeaders(context),
          payload: {
            activeMs: 30_000,
            correctionCheckpoint: { blockId: block.id, position: 3 }
          }
        });
        expect(outOfRange.statusCode).toBe(409);
        expect(outOfRange.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
      }

      const closed = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/${disposition}`,
        headers: mutationHeaders(context),
        payload: {
          ...(disposition === "complete" ? { activeMs: 30_000 } : {}),
          correctionCheckpoint: { blockId: block.id, position: 1 }
        }
      });
      expect(closed.statusCode).toBe(200);
      if (disposition === "complete") {
        const response = closed.json<{ summary: Record<string, unknown> }>();
        expect(response).toMatchObject({
          summary: { characters: 2, errors: 1, rawWpm: 0.8, netWpm: 0.8, finalTextAccuracy: 1 }
        });
        expect(response.summary).not.toHaveProperty("metricVersion");
        expect(response.summary).not.toHaveProperty("uncorrectedErrors");

        const publicSession = await context.app.inject({
          method: "GET",
          url: `/api/v1/sessions/${session.id}`,
          headers: { host: HOST }
        });
        expect(publicSession.statusCode).toBe(200);
        const publicSummary = JSON.parse(
          publicSession.json<{ session: { summary_json: string } }>().session.summary_json
        ) as Record<string, unknown>;
        expect(publicSummary).not.toHaveProperty("metricVersion");
        expect(publicSummary).not.toHaveProperty("uncorrectedErrors");

        const publicDashboard = await context.app.inject({
          method: "GET",
          url: "/api/v1/dashboard",
          headers: { host: HOST }
        });
        expect(publicDashboard.statusCode).toBe(200);
        const dashboardSummary = publicDashboard.json<{
          lastSession: { summary: Record<string, unknown> };
        }>().lastSession.summary;
        expect(dashboardSummary).not.toHaveProperty("metricVersion");
        expect(dashboardSummary).not.toHaveProperty("uncorrectedErrors");
      }

      const stored = context.database.db
        .prepare("SELECT status, summary_json FROM sessions WHERE id = ?")
        .get(session.id) as { status: string; summary_json: string };
      expect(stored.status).toBe(disposition === "complete" ? "completed" : "abandoned");
      expect(JSON.parse(stored.summary_json)).toMatchObject({
        characters: 2,
        errors: 1,
        netWpm: disposition === "complete" ? 0.8 : 24,
        finalTextAccuracy: 1,
        metricVersion: 1,
        uncorrectedErrors: 0
      });
    }
  });

  test("abandons sessions whose browser-derived active time contains fractional milliseconds", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "aaaaaaa");
    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(
        session,
        block,
        Array.from({ length: 7 }, (_, sequence) =>
          event(sequence, "a", "a", {
            ikiMs: sequence === 0 ? null : 200.1,
            textPosition: sequence
          })
        )
      )
    });
    expect(accepted.statusCode).toBe(200);

    const abandoned = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/abandon`,
      headers: mutationHeaders(context),
      payload: {}
    });
    expect(abandoned.statusCode).toBe(200);
    expect(abandoned.json()).toEqual({ ok: true });

    const stored = context.database.db
      .prepare("SELECT status, active_ms, summary_json FROM sessions WHERE id = ?")
      .get(session.id) as { status: string; active_ms: number; summary_json: string };
    expect(stored).toMatchObject({ status: "abandoned", active_ms: 1_201 });
    expect(JSON.parse(stored.summary_json)).toMatchObject({ activeMs: 1_201 });
  });

  test("rejects correction checkpoints for prior blocks and positions ahead of the event tail", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const priorBlock = createFixtureBlock(context, session, "ab");
    const latestBlock = createFixtureBlock(context, session, "cde", 1);

    const priorAccepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, priorBlock, [event(0, "a", "a", { textPosition: 0 })])
    });
    expect(priorAccepted.statusCode).toBe(200);
    const latestAccepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, latestBlock, [event(1, "c", "c", { textPosition: 0 })])
    });
    expect(latestAccepted.statusCode).toBe(200);

    for (const correctionCheckpoint of [
      { blockId: priorBlock.id, position: 0 },
      { blockId: latestBlock.id, position: 2 }
    ]) {
      const rejected = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/complete`,
        headers: mutationHeaders(context),
        payload: { activeMs: 30_000, correctionCheckpoint }
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
    }

    expect(
      context.database.db
        .prepare("SELECT status FROM sessions WHERE id = ?")
        .pluck()
        .get(session.id)
    ).toBe("active");
  });

  test("interrupted sessions recover once, reject late events, and can be abandoned with a summary", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "ab");
    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [
        event(0, "a"),
        event(1, "b", "x", { isCorrect: false })
      ])
    });
    expect(accepted.statusCode).toBe(200);

    const recovered = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/recover`,
      headers: mutationHeaders(context)
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      recovered: true,
      status: "completed",
      summary: { characters: 2, errors: 1 }
    });
    const recoveredAgain = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/recover`,
      headers: mutationHeaders(context),
      payload: {}
    });
    expect(recoveredAgain.json()).toEqual(recovered.json());

    const lateEvent = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(2, "c")])
    });
    expect(lateEvent.statusCode).toBe(409);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM daily_summaries").get()
    ).toEqual({ count: 1 });

    const abandoned = await createSession(context);
    const abandonedBlock = createFixtureBlock(context, abandoned, "q");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${abandoned.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(abandoned, abandonedBlock, [event(0, "q")])
    });
    const abandonedResult = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${abandoned.id}/recover`,
      headers: mutationHeaders(context),
      payload: { disposition: "abandon", activeMs: 1_250 }
    });
    expect(abandonedResult.json()).toMatchObject({
      recovered: true,
      status: "abandoned",
      summary: { characters: 1, activeMs: 1_250 }
    });
    const abandonedAgain = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${abandoned.id}/recover`,
      headers: mutationHeaders(context),
      payload: {}
    });
    expect(abandonedAgain.json()).toEqual(abandonedResult.json());
  });

  test("feature statistics persist robust IKI dispersion and a resistant learning slope", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const ikis = [null, 520, 500, 480, 460, 2_500, 420, 400, 380, 360, 340, 320];
    const block = createFixtureBlock(context, session, "a".repeat(ikis.length));
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(
        session,
        block,
        ikis.map((ikiMs, sequence) =>
          event(sequence, "a", "a", {
            ikiMs,
            textPosition: sequence,
            wasLongPause: sequence === 5
          })
        )
      )
    });
    expect(response.statusCode).toBe(200);
    const row = context.database.db
      .prepare(
        `SELECT sample_count, recent_window_json, iki_mad_ms, learning_slope
         FROM feature_stats
         WHERE profile_id = 'local-profile' AND feature_type = 'key' AND feature_value = 'a'`
      )
      .get() as {
      sample_count: number;
      recent_window_json: string;
      iki_mad_ms: number | null;
      learning_slope: number | null;
    };
    expect(row.sample_count).toBe(12);
    expect(JSON.parse(row.recent_window_json)).toHaveLength(12);
    expect(row.iki_mad_ms).toBeGreaterThan(0);
    expect(row.iki_mad_ms).toBeLessThan(100);
    expect(row.learning_slope).toBeGreaterThan(0);
  });

  test("completed event streams persist and expose actionable text and behavioral analysis", async () => {
    const context = await openApp();
    const textSession = await createSession(context);
    const blockResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${textSession.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: { blockIndex: 0, seed: 51, mode: "smart", length: 24, focus: [] }
    });
    expect(blockResponse.statusCode).toBe(200);
    const block = blockResponse.json<{ block: BlockRecord }>().block;
    const target = "asbookcat1Af";
    const actual = "saboookct!ag";
    context.database.db
      .prepare("UPDATE micro_blocks SET target_text = ? WHERE id = ?")
      .run(target, block.id);
    const textBatch = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${textSession.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        batchId: randomUUID(),
        lessonId: textSession.lessonId,
        blockId: block.id,
        events: Array.from(actual).map((actualChar, sequence) =>
          event(sequence, target[sequence] ?? "f", actualChar, {
            textPosition: sequence,
            ikiMs: sequence === 0 ? null : 100
          })
        )
      }
    });
    expect(textBatch.statusCode).toBe(200);
    const textComplete = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${textSession.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 4_000 }
    });
    expect(textComplete.statusCode).toBe(200);
    const textAnalysis = textComplete.json<{
      summary: {
        errorAnalysis: {
          textIssues: { kind: string; count: number }[];
        };
      };
    }>().summary.errorAnalysis;
    expect(textAnalysis.textIssues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining([
        "transposition",
        "repeat",
        "omission",
        "number-symbol-confusion",
        "shift-error",
        "adjacent-key-confusion"
      ])
    );
    expect(textAnalysis.textIssues.find((issue) => issue.kind === "transposition")?.count).toBe(1);

    const behaviorSession = await createSession(context);
    const behaviorEvents: StoredEvent[] = [];
    const add = (
      targetChar: string,
      ikiMs: number,
      actualChar = targetChar,
      overrides: Partial<StoredEvent> = {}
    ) => {
      const sequence = behaviorEvents.length;
      behaviorEvents.push(
        event(sequence, targetChar, actualChar, {
          ikiMs,
          textPosition: sequence,
          ...overrides
        })
      );
    };
    for (let index = 0; index < 6; index += 1) add("f", 100);
    for (let index = 0; index < 6; index += 1) add("j", 160);
    add("e", 220);
    add("d", 220);
    add("x", 220);
    add("c", 90, "v");
    add("T", 220, "T", { shiftSide: "left", modifiers: { shift: true } });
    add("A", 100, "a", { shiftSide: "none", modifiers: { shift: false } });
    add("a", 70, "s");
    add("s", 72, "d");
    add("d", 74);
    add("f", 73, "g");
    add("g", 71);
    for (const ikiMs of [100, 100, 101, 99, 100, 101]) add("a", ikiMs);
    for (const ikiMs of [110, 112, 108, 111, 109, 110]) add("s", ikiMs);
    [130, 150, 170, 140, 180, 160].forEach((ikiMs, index) =>
      add("d", ikiMs, index < 4 ? "d" : "f")
    );
    const behaviorBlock = createFixtureBlock(
      context,
      behaviorSession,
      behaviorEvents.map((item) => item.targetChar).join("")
    );
    const behaviorBatch = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${behaviorSession.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(behaviorSession, behaviorBlock, behaviorEvents)
    });
    expect(behaviorBatch.statusCode).toBe(200);
    const behaviorComplete = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${behaviorSession.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 9_000 }
    });
    expect(behaviorComplete.statusCode).toBe(200);
    const behaviorAnalysis = behaviorComplete.json<{
      summary: {
        errorAnalysis: {
          evidence: Record<string, { status: string; sampleCount: number }>;
          behavioralIssues: { kind: string; topFeatures: { feature: string }[] }[];
        };
      };
    }>().summary.errorAnalysis;
    const behavioralKinds = behaviorAnalysis.behavioralIssues.map((issue) => issue.kind);
    expect(behavioralKinds).toEqual(
      expect.arrayContaining([
        "correct-but-slow",
        "post-error-slowdown",
        "slow-bigram",
        "slow-trigram",
        "same-finger-cross-row",
        "hand-imbalance",
        "finger-imbalance",
        "shift-use-error",
        "error-burst",
        "suspected-fatigue"
      ])
    );
    const shiftFeatures = behaviorAnalysis.behavioralIssues
      .find((issue) => issue.kind === "shift-use-error")
      ?.topFeatures.map((feature) => feature.feature);
    expect(shiftFeatures).toEqual(expect.arrayContaining(["missing-shift", "same-hand-shift"]));
    expect(behaviorAnalysis.evidence.fatigue).toMatchObject({
      status: "sufficient",
      sampleCount: behaviorEvents.length
    });

    const stored = context.database.db
      .prepare("SELECT summary_json FROM sessions WHERE id = ?")
      .get(behaviorSession.id) as { summary_json: string };
    const storedSummary = JSON.parse(stored.summary_json) as {
      errorAnalysis: { behavioralIssues: unknown[] };
    };
    expect(storedSummary.errorAnalysis.behavioralIssues).toEqual(behaviorAnalysis.behavioralIssues);
    const statistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    expect(statistics.statusCode).toBe(200);
    const periodAnalysis = statistics.json<{
      errorAnalysis: { textIssues: { kind: string }[]; behavioralIssues: { kind: string }[] };
    }>().errorAnalysis;
    expect(periodAnalysis.textIssues.map((issue) => issue.kind)).toContain("transposition");
    expect(periodAnalysis.behavioralIssues.map((issue) => issue.kind)).toContain(
      "suspected-fatigue"
    );
  });

  test("sparse corrected sessions retain the observed error but do not invent timing findings", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "a");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [
        event(0, "a", "s", { ikiMs: null, textPosition: 0 }),
        event(1, "a", "a", {
          ikiMs: null,
          textPosition: 0,
          isCorrection: true,
          backspaceCount: 1
        })
      ])
    });
    const completed = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 1_000 }
    });
    const analysis = completed.json<{
      summary: {
        errorAnalysis: {
          baselineIkiMs: number | null;
          evidence: {
            timing: { status: string };
            combinations: { status: string };
            balance: { status: string };
            shift: { status: string };
            fatigue: { status: string };
          };
          textIssues: { kind: string; count: number }[];
          behavioralIssues: unknown[];
        };
      };
    }>().summary.errorAnalysis;
    expect(analysis.baselineIkiMs).toBeNull();
    expect(analysis.evidence.timing.status).toBe("insufficient");
    expect(analysis.evidence.combinations.status).toBe("insufficient");
    expect(analysis.evidence.balance.status).toBe("insufficient");
    expect(analysis.evidence.shift.status).toBe("insufficient");
    expect(analysis.evidence.fatigue.status).toBe("insufficient");
    expect(analysis.textIssues).toEqual([
      expect.objectContaining({ kind: "adjacent-key-confusion", count: 1 })
    ]);
    expect(analysis.behavioralIssues).toEqual([]);
  });

  test("abandoned traditional sessions never aggregate or unlock the next stage", async () => {
    const context = await openApp();
    const session = await createSession(context, {
      mode: "traditional",
      stageId: "home",
      focus: ["home"]
    });
    const block = createFixtureBlock(context, session, "a");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(0, "a")])
    });
    const abandoned = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/recover`,
      headers: mutationHeaders(context),
      payload: { disposition: "abandon", activeMs: 900 }
    });
    expect(abandoned.statusCode).toBe(200);
    expect(abandoned.json()).toMatchObject({ status: "abandoned" });
    expect(context.database.getTraditionalProgress().stages.slice(0, 2)).toEqual([
      { id: "home", order: 1, completed: false, unlocked: true },
      { id: "index", order: 2, completed: false, unlocked: false }
    ]);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM daily_summaries").get()
    ).toEqual({ count: 0 });
    expect(
      context.database.db
        .prepare(
          "SELECT current_days, longest_days, last_training_date FROM streaks WHERE profile_id = 'local-profile'"
        )
        .get()
    ).toEqual({ current_days: 0, longest_days: 0, last_training_date: null });
  });

  test("zero-event completion closes safely without inflating goals or streaks", async () => {
    const context = await openApp();
    const session = await createSession(context, { kind: "test", mode: "typing-test" });

    expect(context.database.completeSession(session.id, 60_000)).toMatchObject({
      characters: 0,
      activeMs: 60_000,
      netWpm: 0
    });
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM daily_summaries").get()
    ).toEqual({ count: 0 });
    expect(
      context.database.db
        .prepare(
          "SELECT current_days, longest_days, last_training_date FROM streaks WHERE profile_id = 'local-profile'"
        )
        .get()
    ).toEqual({ current_days: 0, longest_days: 0, last_training_date: null });
    expect(context.database.getStatistics("all")).toMatchObject({
      overview: { sessions: 0, active_ms: 0, characters: 0 }
    });

    const ranked = await context.app.inject({
      method: "POST",
      url: "/api/v1/tests",
      headers: mutationHeaders(context),
      payload: { sessionId: session.id, durationSeconds: 60 }
    });
    expect(ranked.statusCode).toBe(409);
    expect(ranked.json()).toMatchObject({ error: { code: "TEST_NO_EVIDENCE" } });
    expect(context.database.listTests()).toEqual([]);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM personal_bests").get()
    ).toEqual({ count: 0 });
  });

  test("preferences, goals, and layout activation commit atomically", async () => {
    const context = await openApp();
    const saved = await context.app.inject({
      method: "PUT",
      url: "/api/v1/preferences",
      headers: mutationHeaders(context),
      payload: {
        settings: { theme: "dark", activeLayoutId: "standard-default" },
        goal: { dailyMinutes: 20, targetWpm: 62, minimumAccuracy: 0.92 }
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        theme: "dark",
        activeLayoutId: "standard-default",
        targetWpm: 62,
        minimumAccuracy: 0.92
      },
      goal: { daily_minutes: 20, target_wpm: 62, minimum_accuracy: 0.92 }
    });
    expect(
      context.database.db.prepare("SELECT id FROM keyboard_layouts WHERE is_active = 1").all()
    ).toEqual([{ id: "standard-default" }]);

    const rejected = await context.app.inject({
      method: "PUT",
      url: "/api/v1/preferences",
      headers: mutationHeaders(context),
      payload: {
        settings: { theme: "light", activeLayoutId: "missing-layout" },
        goal: { dailyMinutes: 5, targetWpm: 20, minimumAccuracy: 0.8 }
      }
    });
    expect(rejected.statusCode).toBe(404);
    expect(context.database.getSettings()).toMatchObject({
      theme: "dark",
      activeLayoutId: "standard-default"
    });
    expect(context.database.getGoal()).toMatchObject({ daily_minutes: 20, target_wpm: 62 });
  });

  test("session layout snapshots normalize client mapping fields and keep wrong physical keys separate", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "c".repeat(7));
    await context.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: mutationHeaders(context),
      payload: { activeLayoutId: "standard-default" }
    });

    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(0, "c")])
    });
    expect(accepted.statusCode).toBe(200);
    expect(
      context.database.db
        .prepare("SELECT mapped_finger, zone FROM keystroke_events WHERE session_id = ?")
        .get(session.id)
    ).toEqual({ mapped_finger: "left-index", zone: "left-index" });

    const wrongPhysicalKey = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [
        event(1, "c", "m", { isCorrect: false, textPosition: 1 })
      ])
    });
    expect(wrongPhysicalKey.statusCode).toBe(200);
    expect(
      context.database.db
        .prepare(
          `SELECT physical_code, mapped_hand, mapped_finger, keyboard_row, zone
           FROM keystroke_events WHERE session_id = ? AND sequence = 1`
        )
        .get(session.id)
    ).toEqual({
      physical_code: "KeyM",
      mapped_hand: "left",
      mapped_finger: "left-index",
      keyboard_row: "bottom",
      zone: "left-index"
    });

    const untrustedFields: Partial<StoredEvent>[] = [
      { mappedHand: "right" },
      { mappedFinger: "right-index" },
      { keyboardRow: "number" },
      { zone: "right-index" },
      { mappedHand: "unknown" }
    ];
    const normalized = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(
        session,
        block,
        untrustedFields.map((fields, index) =>
          event(index + 2, "c", "c", { textPosition: index + 2, ...fields })
        )
      )
    });
    expect(normalized.statusCode).toBe(200);
    expect(
      context.database.db
        .prepare(
          `SELECT COUNT(*) AS count FROM keystroke_events
           WHERE session_id = ? AND mapped_hand = 'left' AND mapped_finger = 'left-index'
             AND keyboard_row = 'bottom' AND zone = 'left-index'`
        )
        .get(session.id)
    ).toEqual({ count: 7 });
  });

  test("traditional stages unlock sequentially and Shift usage is aggregated from events", async () => {
    const context = await openApp();
    const locked = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(context),
      payload: {
        kind: "training",
        mode: "traditional",
        stageId: "index",
        seed: 8,
        focus: ["index"]
      }
    });
    expect(locked.statusCode).toBe(409);

    const home = await createSession(context, {
      mode: "traditional",
      focus: ["home"],
      stageId: "home"
    });
    const homeBlock = createFixtureBlock(context, home, "AAA");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${home.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(home, homeBlock, [
        event(0, "A", "A", {
          shiftSide: "left",
          modifiers: { shift: true, capsLock: false }
        }),
        event(1, "A", "a", {
          shiftSide: "none",
          modifiers: { shift: false, capsLock: false },
          isCorrect: false
        }),
        event(2, "A", "A", {
          shiftSide: "none",
          modifiers: { shift: false, capsLock: true }
        })
      ])
    });
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${home.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 2_000 }
    });
    const progress = await context.app.inject({
      method: "GET",
      url: "/api/v1/traditional-progress",
      headers: { host: HOST }
    });
    const stages = progress.json<{
      stages: { id: string; completed: boolean; unlocked: boolean }[];
    }>().stages;
    expect(stages.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "home", completed: true, unlocked: true }),
      expect.objectContaining({ id: "index", completed: false, unlocked: true })
    ]);
    const statistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    expect(statistics.json()).toMatchObject({
      shiftSummary: { left: 1, right: 0, missing: 2, sameHand: 1, capsLock: 1 }
    });
  });

  test("formal tests persist dual accuracy, error evidence, and personal bests idempotently", async () => {
    const context = await openApp();
    const session = await createSession(context, { kind: "test", mode: "typing-test" });
    const block = createFixtureBlock(context, session, "qaz");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [
        event(0, "q"),
        event(1, "a", "s", { isCorrect: false }),
        event(2, "z")
      ])
    });
    const save = async () =>
      context.app.inject({
        method: "POST",
        url: "/api/v1/tests",
        headers: mutationHeaders(context),
        payload: { sessionId: session.id, durationSeconds: 30 }
      });
    const first = await save();
    const second = await save();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);

    const listed = await context.app.inject({
      method: "GET",
      url: "/api/v1/tests",
      headers: { host: HOST }
    });
    const tests = listed.json<{
      tests: { keystroke_accuracy: number; final_text_accuracy: number; errors_json: string }[];
    }>().tests;
    expect(tests).toHaveLength(1);
    expect(tests[0]?.keystroke_accuracy).toBeCloseTo(2 / 3, 3);
    expect(tests[0]?.final_text_accuracy).toBeCloseTo(2 / 3, 3);
    expect(JSON.parse(tests[0]?.errors_json ?? "{}")).toMatchObject({
      count: 1,
      topConfusions: [{ target: "a", actual: "s", physicalCode: "KeyS", count: 1 }],
      events: [{ target: "a", actual: "s", physicalCode: "KeyS", position: 1 }]
    });

    const storedSummary = JSON.parse(
      context.database.db
        .prepare("SELECT summary_json FROM sessions WHERE id = ?")
        .pluck()
        .get(session.id) as string
    ) as Record<string, unknown>;
    const canonicalNetWpm = Number(storedSummary.netWpm);
    delete storedSummary.metricVersion;
    delete storedSummary.uncorrectedErrors;
    storedSummary.netWpm = canonicalNetWpm + 7;
    context.database.db
      .prepare("UPDATE sessions SET summary_json = ? WHERE id = ?")
      .run(JSON.stringify(storedSummary), session.id);
    context.database.db
      .prepare("UPDATE tests SET net_wpm = ? WHERE session_id = ?")
      .run(canonicalNetWpm + 7, session.id);
    expect(context.database.listTests()[0]).toMatchObject({ net_wpm: canonicalNetWpm });
    expect(
      context.database.db
        .prepare("SELECT net_wpm FROM tests WHERE session_id = ?")
        .pluck()
        .get(session.id)
    ).toBe(canonicalNetWpm + 7);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM personal_bests").get()
    ).toEqual({ count: 2 });
  });

  test("direct formal-test completion persists a trailing Backspace checkpoint", async () => {
    const context = await openApp();
    const session = await createSession(context, { kind: "test", mode: "typing-test" });
    const block = createFixtureBlock(context, session, "ab");
    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(0, "a"), event(1, "b", "x")])
    });
    expect(accepted.statusCode).toBe(200);

    const saved = await context.app.inject({
      method: "POST",
      url: "/api/v1/tests",
      headers: mutationHeaders(context),
      payload: {
        sessionId: session.id,
        durationSeconds: 30,
        correctionCheckpoint: { blockId: block.id, position: 1 }
      }
    });

    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({
      summary: { characters: 2, errors: 1, finalTextAccuracy: 1, netWpm: 24 }
    });
    expect(context.database.listTests()).toEqual([
      expect.objectContaining({ net_wpm: 24, final_text_accuracy: 1 })
    ]);
    expect(
      JSON.parse(
        context.database.db
          .prepare("SELECT summary_json FROM sessions WHERE id = ?")
          .pluck()
          .get(session.id) as string
      )
    ).toMatchObject({ metricVersion: 1, uncorrectedErrors: 0, netWpm: 24 });
  });

  test("SQLite remains authoritative across app close and reopen", async () => {
    const first = await openApp();
    const settings = await first.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: mutationHeaders(first),
      payload: { theme: "dark", onboardingComplete: true }
    });
    expect(settings.statusCode).toBe(200);
    const session = await createSession(first);
    const block = createFixtureBlock(first, session, "a");
    const batchId = randomUUID();
    const saved = await first.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(first),
      payload: eventPayload(session, block, [event(0, "a")], batchId)
    });
    expect(saved.statusCode).toBe(200);
    await first.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(first),
      payload: { activeMs: 1_500 }
    });
    const oldCsrf = first.csrfToken;
    await closeApp(first);

    expect(existsSync(join(dataDir, "symtype.sqlite3"))).toBe(true);
    const reopened = await openApp();
    expect(reopened.csrfToken).not.toBe(oldCsrf);
    const bootstrap = await reopened.app.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: { host: HOST }
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      settings: { theme: "dark", onboardingComplete: true },
      storageAuthority: "server-sqlite",
      dataLocation: join(dataDir, "symtype.sqlite3")
    });
    const persisted = await reopened.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${session.id}`,
      headers: { host: HOST }
    });
    expect(persisted.statusCode).toBe(200);
    expect(persisted.json()).toMatchObject({
      session: {
        id: session.id,
        status: "completed",
        client_checkpoint: 0,
        next_sequence: 1,
        keyboard_layout_id: "symmetric-default"
      }
    });
    const staleCsrf = await reopened.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { host: HOST, origin: ORIGIN, "x-symtype-csrf": oldCsrf },
      payload: { theme: "light" }
    });
    expect(staleCsrf.statusCode).toBe(403);
  });

  test("JSON preview is a rollback-only dry run; restore makes a safety backup", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "qa");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(0, "q"), event(1, "a")])
    });
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 2_000 }
    });

    const exportedResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/json",
      headers: { host: HOST }
    });
    expect(exportedResponse.statusCode).toBe(200);
    const exported = exportedResponse.json<Record<string, unknown>>();

    await context.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: mutationHeaders(context),
      payload: { theme: "dark" }
    });
    const addedText = await context.app.inject({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(context),
      payload: { title: "After export", content: "local mutation", fileType: "txt" }
    });
    expect(addedText.statusCode).toBe(201);

    const preview = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: mutationHeaders(context),
      payload: exported
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      ok: true,
      summary: { profiles: 1, sessions: 1, events: 2, customTexts: 0 }
    });
    const afterPreview = await context.app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { host: HOST }
    });
    expect(afterPreview.json()).toMatchObject({ settings: { theme: "dark" } });

    const invalid = structuredClone(exported) as {
      data: { settings: { profile_id: string; value_json: string }[] };
    };
    invalid.data.settings[0]!.value_json = "{}";
    const rejected = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: mutationHeaders(context),
      payload: invalid
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: { code: "INVALID_BACKUP" } });
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/settings",
          headers: { host: HOST }
        })
      ).json()
    ).toMatchObject({ settings: { theme: "dark" } });

    const manualBackup = await context.app.inject({
      method: "POST",
      url: "/api/v1/backups",
      headers: mutationHeaders(context),
      payload: { reason: "integration-test" }
    });
    expect(manualBackup.statusCode).toBe(201);
    const backupPath = manualBackup.json<{ backup: { path: string } }>().backup.path;
    expect(readFileSync(backupPath).subarray(0, 15).toString()).toBe("SQLite format 3");

    const missingExportCsrf = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/sqlite",
      headers: { host: HOST }
    });
    expect(missingExportCsrf.statusCode).toBe(403);
    const sqliteExport = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/sqlite",
      headers: { host: HOST, "x-symtype-csrf": context.csrfToken }
    });
    expect(sqliteExport.statusCode).toBe(200);
    expect(sqliteExport.headers["content-type"]).toContain("application/vnd.sqlite3");
    expect(sqliteExport.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");
    const sqliteBytes = sqliteExport.rawPayload;

    const restored = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: mutationHeaders(context),
      payload: exported
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ restored: true, summary: { sessions: 1, events: 2 } });
    const restoredSettings = await context.app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { host: HOST }
    });
    expect(restoredSettings.json()).toMatchObject({ settings: { theme: "system" } });
    const texts = await context.app.inject({
      method: "GET",
      url: "/api/v1/custom-texts",
      headers: { host: HOST }
    });
    expect(texts.json()).toEqual({ texts: [] });
    const backups = await context.app.inject({
      method: "GET",
      url: "/api/v1/backups",
      headers: { host: HOST }
    });
    expect(
      backups
        .json<{ backups: { reason: string }[] }>()
        .backups.some((backup) => backup.reason === "pre-restore")
    ).toBe(true);

    const invalidSqlite = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/preview",
      headers: mutationHeaders(context, { "content-type": "application/vnd.sqlite3" }),
      payload: Buffer.from("not a database")
    });
    expect(invalidSqlite.statusCode).toBe(400);
    const sqlitePreview = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/preview",
      headers: mutationHeaders(context, { "content-type": "application/vnd.sqlite3" }),
      payload: sqliteBytes
    });
    expect(sqlitePreview.statusCode).toBe(200);
    const staged = sqlitePreview.json<{
      token: string;
      summary: { sessions: number; events: number; customTexts: number };
    }>();
    expect(staged.summary).toEqual(
      expect.objectContaining({ sessions: 1, events: 2, customTexts: 1 })
    );
    const sqliteCommit = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/commit",
      headers: mutationHeaders(context),
      payload: { token: staged.token }
    });
    expect(sqliteCommit.statusCode).toBe(200);
    expect(sqliteCommit.json()).toMatchObject({
      restored: true,
      sourceFormat: "sqlite",
      summary: { customTexts: 1 }
    });
    expect(context.database.getSettings()).toMatchObject({ theme: "dark" });
    expect(context.database.listCustomTexts()).toHaveLength(1);
    const reusedRestoreToken = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/commit",
      headers: mutationHeaders(context),
      payload: { token: staged.token }
    });
    expect(reusedRestoreToken.statusCode).toBe(404);
    expect(
      context.database.listBackups().some((backup) => backup.reason === "pre-sqlite-restore")
    ).toBe(true);
    expect(context.database.integrityCheck()).toEqual({ ok: true, detail: "ok" });
  });

  test("campaign and hardcore reset correctly and completion unlocks honest achievements", async () => {
    const context = await openApp();
    const initialProgress = await context.app.inject({
      method: "GET",
      url: "/api/v1/game/progress",
      headers: { host: HOST }
    });
    expect(initialProgress.json()).toMatchObject({
      unlockedLevel: 1,
      completedLevels: [],
      personalBests: [],
      achievements: []
    });

    const campaignResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/game/runs",
      headers: mutationHeaders(context),
      payload: { mode: "campaign", difficulty: "standard" }
    });
    const campaignId = String(campaignResponse.json<{ run: { id: string } }>().run.id);
    const campaignLevelOne = await levelResult(context, campaignId, "success", 0, true);
    const campaignLevelOneScore = campaignLevelOne.result.score;
    expect(campaignLevelOne.run).toMatchObject({
      current_level: 2,
      score: campaignLevelOneScore,
      alert_value: 0
    });
    const campaignFailure = await levelResult(context, campaignId, "failure", 87);
    expect(campaignFailure.result).toMatchObject({
      outcome: "failure",
      score: 0,
      errorFree: false,
      completedStages: 3
    });
    expect(campaignFailure.run).toMatchObject({
      current_level: 2,
      score: campaignLevelOneScore,
      alert_value: 0
    });
    const campaignLevels = campaignFailure.run.levels as {
      level_number: number;
      attempt_number: number;
      status: string;
      score: number;
      alert_value: number;
    }[];
    expect(campaignLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level_number: 1,
          attempt_number: 1,
          status: "success",
          score: campaignLevelOneScore
        }),
        expect.objectContaining({ level_number: 2, attempt_number: 1, status: "failure" }),
        expect.objectContaining({
          level_number: 2,
          attempt_number: 2,
          status: "active",
          score: 0,
          alert_value: 0
        })
      ])
    );

    const hardcoreResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/game/runs",
      headers: mutationHeaders(context),
      payload: { mode: "hardcore", difficulty: "adaptive" }
    });
    const hardcoreId = String(hardcoreResponse.json<{ run: { id: string } }>().run.id);
    const hardcoreLevelOne = await levelResult(context, hardcoreId, "success", 0);
    const hardcoreFailure = await levelResult(context, hardcoreId, "failure", 100);
    expect(hardcoreFailure.run).toMatchObject({ current_level: 1, score: 0, alert_value: 0 });
    expect(hardcoreFailure.run.levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level_number: 2, status: "failure" }),
        expect.objectContaining({ level_number: 1, attempt_number: 2, status: "active" })
      ])
    );
    const hardcoreLevelOneRetry = await levelResult(context, hardcoreId, "success", 0);
    expect(hardcoreLevelOneRetry.run).toMatchObject({ current_level: 2 });
    expect(hardcoreLevelOneRetry.run.levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level_number: 2, attempt_number: 1, status: "failure" }),
        expect.objectContaining({ level_number: 2, attempt_number: 2, status: "active" })
      ])
    );
    const secondHardcoreFailure = await levelResult(context, hardcoreId, "failure", 100);
    expect(secondHardcoreFailure.run).toMatchObject({ current_level: 1, score: 0, alert_value: 0 });
    expect(secondHardcoreFailure.run.levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level_number: 2, attempt_number: 2, status: "failure" }),
        expect.objectContaining({ level_number: 1, attempt_number: 3, status: "active" })
      ])
    );

    const hardResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/game/runs",
      headers: mutationHeaders(context),
      payload: { mode: "campaign", difficulty: "hard" }
    });
    const hardId = String(hardResponse.json<{ run: { id: string } }>().run.id);
    let hardRun: Record<string, unknown> = {};
    const hardScores: number[] = [];
    for (let level = 1; level <= 6; level += 1) {
      const completedLevel = await levelResult(context, hardId, "success", 0);
      hardRun = completedLevel.run;
      hardScores.push(completedLevel.result.score);
    }
    expect(hardRun).toMatchObject({
      status: "completed",
      current_level: 6,
      score: hardScores.reduce((total, score) => total + score, 0)
    });
    const achievements = await context.app.inject({
      method: "GET",
      url: "/api/v1/game/achievements",
      headers: { host: HOST }
    });
    expect(
      achievements
        .json<{ achievements: { achievement_id: string }[] }>()
        .achievements.map((achievement) => achievement.achievement_id)
    ).toEqual(
      expect.arrayContaining(["first-fiction-breach", "error-free-level", "hard-campaign"])
    );
    const progress = await context.app.inject({
      method: "GET",
      url: "/api/v1/game/progress",
      headers: { host: HOST }
    });
    const progressBody = progress.json<{
      unlockedLevel: number;
      completedLevels: number[];
      personalBests: { level: number; score: number }[];
    }>();
    expect(progressBody.unlockedLevel).toBe(6);
    expect(progressBody.completedLevels).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progressBody.personalBests).toEqual(
      expect.arrayContaining([
        {
          level: 1,
          score: Math.max(campaignLevelOneScore, hardcoreLevelOne.result.score, hardScores[0] ?? 0)
        },
        { level: 6, score: hardScores[5] }
      ])
    );

    const gameSession = await createSession(context, {
      kind: "game",
      mode: "pineapple-level-2",
      seed: 99
    });
    const gameBlock = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${gameSession.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 99,
        mode: "game-2",
        length: 48,
        focus: [],
        phase: "focus",
        gameRunId: campaignId,
        gameStage: 1
      }
    });
    expect(gameBlock.statusCode).toBe(200);
    expect(gameBlock.json<{ block: BlockRecord }>().block.target_text.length).toBeGreaterThan(0);

    const normalSession = await createSession(context);
    const invalidGameContext = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${normalSession.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 99,
        mode: "smart",
        length: 48,
        focus: [],
        phase: "focus",
        gameRunId: campaignId
      }
    });
    expect(invalidGameContext.statusCode).toBe(400);
  });

  test("custom text validation, exact resume offsets, and model opt-out are enforced", async () => {
    const context = await openApp();
    for (const payload of [
      { title: "Whitespace", content: " \n\t ", fileType: "txt" },
      { title: "Binary", content: "abc\0def", fileType: "txt" },
      { title: "Unsupported", content: "plain", fileType: "exe" }
    ]) {
      const rejected = await context.app.inject({
        method: "POST",
        url: "/api/v1/custom-texts",
        headers: mutationHeaders(context),
        payload
      });
      expect(rejected.statusCode).toBe(400);
    }

    const unsupported = await context.app.inject({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(context),
      payload: { title: "Smart punctuation", content: "plain — text", fileType: "txt" }
    });
    expect(unsupported.statusCode).toBe(400);
    const unsupportedError = unsupported.json<{ error: { code: string; message: string } }>().error;
    expect(unsupportedError.code).toBe("UNSUPPORTED_CUSTOM_TEXT_CHARACTER");
    expect(unsupportedError.message).toMatch(/U\+2014.*ANSI US/u);

    const content = "<script>alert('text only')</script>\nalpha beta gamma delta epsilon";
    const saved = await context.app.inject({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(context),
      payload: {
        title: "  Local source  ",
        content: content.replace(/\n/gu, "\r\n"),
        fileType: "ts",
        includeInModel: false
      }
    });
    expect(saved.statusCode).toBe(201);
    const text = saved.json<{ text: { id: string; title: string; content: string } }>().text;
    expect(text).toMatchObject({ title: "Local source", content });

    const outOfRange = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: content.length + 1 }
    });
    expect(outOfRange.statusCode).toBe(400);
    expect(outOfRange.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const session = await createSession(context, { mode: "custom", includeInModel: false });
    const firstBlockResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 2,
        mode: "custom",
        length: 20,
        focus: [],
        customTextId: text.id,
        phase: "focus"
      }
    });
    expect(firstBlockResponse.statusCode).toBe(200);
    const firstBlock = firstBlockResponse.json<{ block: BlockRecord }>().block;
    expect(firstBlock).toMatchObject({
      source_start: 0,
      source_length: 20,
      target_text: content.slice(0, 20)
    });
    const advanced = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 20, blockId: firstBlock.id }
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toEqual({ ok: true, readingPosition: 20 });
    const retry = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 20, blockId: firstBlock.id }
    });
    expect(retry.json()).toEqual({ ok: true, readingPosition: 20 });

    const secondBlockResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 1,
        seed: 3,
        mode: "custom",
        length: 20,
        focus: [],
        customTextId: text.id,
        phase: "focus"
      }
    });
    expect(secondBlockResponse.statusCode).toBe(200);
    const secondBlock = secondBlockResponse.json<{ block: BlockRecord }>().block;
    expect(secondBlock).toMatchObject({
      source_start: 20,
      source_length: 20,
      target_text: content.slice(20, 40)
    });
    const wrongBlockEnd = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 39, blockId: secondBlock.id }
    });
    expect(wrongBlockEnd.statusCode).toBe(400);
    expect(wrongBlockEnd.json()).toMatchObject({
      error: { code: "POSITION_BLOCK_MISMATCH" }
    });

    const otherTextResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(context),
      payload: { title: "Other", content: "unrelated local text", fileType: "txt" }
    });
    const otherTextId = otherTextResponse.json<{ text: { id: string } }>().text.id;
    const wrongText = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${otherTextId}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 40, blockId: secondBlock.id }
    });
    expect(wrongText.statusCode).toBe(409);
    expect(wrongText.json()).toMatchObject({ error: { code: "BLOCK_CONTEXT_MISMATCH" } });

    const unrelatedSession = await createSession(context, { mode: "smart" });
    const wrongSessionBlock = context.database.addMicroBlock(
      unrelatedSession.lessonId,
      0,
      "custom-context-fixture",
      content.slice(20, 40),
      4,
      "Wrong-session context fixture.",
      text.id,
      20
    ) as unknown as BlockRecord;
    const wrongSession = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 40, blockId: wrongSessionBlock.id }
    });
    expect(wrongSession.statusCode).toBe(409);
    expect(wrongSession.json()).toMatchObject({
      error: { code: "BLOCK_CONTEXT_MISMATCH" }
    });

    const gapBlock = context.database.addMicroBlock(
      session.lessonId,
      2,
      "custom-gap-fixture",
      content.slice(40, 60),
      5,
      "Out-of-order progress fixture.",
      text.id,
      40
    ) as unknown as BlockRecord;
    const gap = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 60, blockId: gapBlock.id }
    });
    expect(gap.statusCode).toBe(409);
    expect(gap.json()).toMatchObject({ error: { code: "PROGRESS_GAP" } });

    const ingested = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        batchId: randomUUID(),
        lessonId: session.lessonId,
        blockId: secondBlock.id,
        events: [event(0, content[20] ?? "a", content[20] ?? "a")]
      }
    });
    expect(ingested.statusCode).toBe(200);
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM keystroke_events").get()
    ).toEqual({ count: 1 });
    expect(
      context.database.db.prepare("SELECT COUNT(*) AS count FROM feature_stats").get()
    ).toEqual({ count: 0 });
    const secondAdvanced = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/custom-texts/${text.id}/progress`,
      headers: mutationHeaders(context),
      payload: { readingPosition: 40, blockId: secondBlock.id }
    });
    expect(secondAdvanced.json()).toEqual({ ok: true, readingPosition: 40 });
  });

  test("legacy restored custom text remains intact but cannot create an untypeable block", async () => {
    const context = await openApp();
    const legacy = context.database.saveCustomText({
      title: "Legacy Unicode",
      content: "preserved — content",
      fileType: "txt",
      includeInModel: false
    }) as { id: string };
    const session = await createSession(context, { mode: "custom", includeInModel: false });

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 2,
        mode: "custom",
        length: 20,
        focus: [],
        customTextId: legacy.id,
        phase: "focus"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "UNSUPPORTED_CUSTOM_TEXT_CHARACTER" }
    });
    expect(context.database.getCustomText(legacy.id)).toMatchObject({
      content: "preserved — content"
    });
  });

  test("scoped blocks use the active mapping and constrain generated characters", async () => {
    const context = await openApp();
    const session = await createSession(context);
    const scoped = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 73,
        mode: "smart",
        length: 48,
        focus: [],
        scopeLabels: ["左小指"],
        allowedCharacters: ["q", "a"],
        strictScope: true,
        phase: "focus"
      }
    });
    expect(scoped.statusCode).toBe(200);
    const scopedText = scoped.json<{ block: BlockRecord }>().block.target_text;
    expect([...scopedText].filter((character) => !/\s/u.test(character))).toSatisfy(
      (characters: string[]) =>
        characters.length > 0 && characters.every((character) => "qa".includes(character))
    );

    const mismatched = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 1,
        seed: 74,
        mode: "smart",
        length: 48,
        focus: [],
        scopeLabels: ["左小指"],
        allowedCharacters: ["x"],
        strictScope: true,
        phase: "focus"
      }
    });
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json()).toMatchObject({ error: { code: "SCOPE_CHARACTER_MISMATCH" } });

    const calibration = await createSession(context, {
      kind: "calibration",
      mode: "calibration",
      focus: ["index"]
    });
    const calibrationBlock = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${calibration.lessonId}/blocks/next`,
      headers: mutationHeaders(context),
      payload: {
        blockIndex: 0,
        seed: 75,
        mode: "calibration",
        length: 48,
        focus: ["index"],
        scopeLabels: ["index"],
        strictScope: true,
        phase: "focus"
      }
    });
    expect(calibrationBlock.statusCode).toBe(200);
    const calibrationText = calibrationBlock.json<{ block: BlockRecord }>().block.target_text;
    expect([...calibrationText].filter((character) => !/\s/u.test(character))).toSatisfy(
      (characters: string[]) =>
        characters.length > 0 && characters.every((character) => /[cbnm]/iu.test(character))
    );
  });

  test("statistics periods use local calendar boundaries for every event-derived view", async () => {
    const context = await openApp();
    const samples = [
      { daysAgo: 0, character: "a" },
      { daysAgo: 6, character: "b" },
      { daysAgo: 7, character: "c" },
      { daysAgo: 29, character: "d" },
      { daysAgo: 30, character: "e" }
    ];
    for (const sample of samples) {
      const session = await createSession(context);
      const block = createFixtureBlock(context, session, sample.character);
      await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/events`,
        headers: mutationHeaders(context),
        payload: eventPayload(session, block, [event(0, sample.character)])
      });
      context.database.completeSession(session.id, 1_000);
      const completed = localDaysAgo(sample.daysAgo);
      context.database.db
        .prepare("UPDATE sessions SET started_at = ?, completed_at = ? WHERE id = ?")
        .run(completed.iso, completed.iso, session.id);
    }
    context.database.db.prepare("DELETE FROM daily_summaries").run();
    const insertDaily = context.database.db.prepare(
      `INSERT INTO daily_summaries
       (profile_id, local_date, kind, active_ms, session_count, character_count, correct_count,
        raw_wpm, net_wpm, accuracy, consistency)
       VALUES('local-profile', ?, 'training', 1000, 1, 1, 1, 12, 12, 1, 1)`
    );
    for (const sample of samples) insertDaily.run(localDaysAgo(sample.daysAgo).localDate);

    const today = context.database.getStatistics("today") as {
      sinceLocalDate: string;
      overview: { sessions: number; characters: number };
      trend: { local_date: string }[];
      features: { feature_type: string; feature_value: string; sample_count: number }[];
      groups: { samples: number }[];
    };
    const sevenDays = context.database.getStatistics("7d") as typeof today;
    const thirtyDays = context.database.getStatistics("30d") as typeof today;
    const all = context.database.getStatistics("all") as typeof today;

    expect(today.sinceLocalDate).toBe(localDaysAgo(0, 0).localDate);
    expect(today.overview).toMatchObject({ sessions: 1, characters: 1 });
    expect(today.trend).toHaveLength(1);
    expect(today.features.filter((feature) => feature.feature_type === "key")).toEqual([
      expect.objectContaining({ feature_value: "a", sample_count: 1 })
    ]);
    expect(today.groups.reduce((sum, group) => sum + group.samples, 0)).toBe(1);

    expect(sevenDays.overview).toMatchObject({ sessions: 2, characters: 2 });
    expect(
      sevenDays.features
        .filter((feature) => feature.feature_type === "key")
        .map((feature) => feature.feature_value)
        .sort()
    ).toEqual(["a", "b"]);
    expect(thirtyDays.overview).toMatchObject({ sessions: 4, characters: 4 });
    expect(all.overview).toMatchObject({ sessions: 5, characters: 5 });
  });

  test("retention compares actual retest blocks only inside explicit 24h or 72h windows", async () => {
    const context = await openApp();
    const baseline = await createSession(context, { focus: ["a"] });
    const baselineBlock = context.database.addMicroBlock(
      baseline.lessonId,
      0,
      "focus",
      "aaaaaaaa",
      1,
      "initial exposure"
    );
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${baseline.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        batchId: randomUUID(),
        lessonId: baseline.lessonId,
        blockId: String(baselineBlock.id),
        events: Array.from({ length: 8 }, (_, sequence) =>
          event(sequence, "a", "a", { ikiMs: sequence === 0 ? null : 360, textPosition: sequence })
        )
      }
    });
    context.database.completeSession(baseline.id);

    const retest = await createSession(context, { focus: ["a"] });
    const retestBlock = context.database.addMicroBlock(
      retest.lessonId,
      0,
      "retest",
      "aaaaaaaa",
      2,
      "delayed retest"
    );
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${retest.id}/events`,
      headers: mutationHeaders(context),
      payload: {
        batchId: randomUUID(),
        lessonId: retest.lessonId,
        blockId: String(retestBlock.id),
        events: Array.from({ length: 8 }, (_, sequence) =>
          event(sequence, "a", "a", { ikiMs: sequence === 0 ? null : 300, textPosition: sequence })
        )
      }
    });
    context.database.completeSession(retest.id);

    const retestCompletedAt = String(
      (
        context.database.db
          .prepare("SELECT completed_at FROM sessions WHERE id = ?")
          .get(retest.id) as { completed_at: string }
      ).completed_at
    );
    const twentyFourHoursEarlier = new Date(
      new Date(retestCompletedAt).getTime() - 24 * 3_600_000
    ).toISOString();
    context.database.db
      .prepare("UPDATE sessions SET started_at = ?, completed_at = ? WHERE id = ?")
      .run(twentyFourHoursEarlier, twentyFourHoursEarlier, baseline.id);

    const retained24h = context.database.getDashboard().retention as Record<string, unknown>;
    expect(retained24h).toMatchObject({
      window: "24h",
      hoursGap: 24,
      sampleCount: 8,
      baselineSampleCount: 8,
      accuracyDelta: 0
    });
    expect(Number(retained24h.netWpmDelta)).toBeGreaterThan(0);

    const seventyTwoHoursEarlier = new Date(
      new Date(retestCompletedAt).getTime() - 72 * 3_600_000
    ).toISOString();
    context.database.db
      .prepare("UPDATE sessions SET started_at = ?, completed_at = ? WHERE id = ?")
      .run(seventyTwoHoursEarlier, seventyTwoHoursEarlier, baseline.id);
    expect(context.database.getDashboard().retention).toMatchObject({
      window: "72h",
      hoursGap: 72
    });

    const tenHoursEarlier = new Date(
      new Date(retestCompletedAt).getTime() - 10 * 3_600_000
    ).toISOString();
    context.database.db
      .prepare("UPDATE sessions SET started_at = ?, completed_at = ? WHERE id = ?")
      .run(tenHoursEarlier, tenHoursEarlier, baseline.id);
    expect(context.database.getDashboard().retention).toBeNull();
  });

  test("statistics return correct empty and sparse states", async () => {
    const context = await openApp();
    const empty = context.database.getStatistics("all") as {
      overview: {
        sessions: number;
        active_ms: number;
        characters: number;
        correct: number;
        errors: number;
      };
      trend: unknown[];
      features: unknown[];
      confusion: unknown[];
      groups: unknown[];
      recentErrors: unknown[];
    };
    expect(empty.overview).toEqual({
      sessions: 0,
      active_ms: 0,
      characters: 0,
      correct: 0,
      errors: 0,
      raw_wpm: null,
      net_wpm: null,
      keystroke_accuracy: null,
      consistency: null,
      stable_wpm: null,
      timing_samples: 0
    });
    expect(empty.trend).toEqual([]);
    expect(empty.features).toEqual([]);
    expect(empty.confusion).toEqual([]);
    expect(empty.groups).toEqual([]);
    expect(empty.recentErrors).toEqual([]);
    const emptyDashboard = await context.app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { host: HOST }
    });
    expect(emptyDashboard.json()).toMatchObject({ retention: null });

    const session = await createSession(context);
    const block = createFixtureBlock(context, session, "z");
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/events`,
      headers: mutationHeaders(context),
      payload: eventPayload(session, block, [event(0, "z", "x", { isCorrect: false })])
    });
    await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: 1_000 }
    });
    const sparse = context.database.getStatistics("all") as {
      overview: { sessions: number; characters: number; errors: number };
      confusion: { target_char: string; actual_char: string; count: number }[];
    };
    expect(sparse.overview).toMatchObject({ sessions: 1, characters: 1, errors: 1 });
    expect(sparse.confusion).toEqual([
      expect.objectContaining({ target_char: "z", actual_char: "x", count: 1 })
    ]);
  });

  test("optional algorithm experiment reports real samples, uncertainty, calibration, and feedback", async () => {
    const context = await openApp();
    context.database.updateSettings({ experimentEnabled: true });

    for (const [index, strategy] of (["adaptive", "baseline"] as const).entries()) {
      const session = await createSession(context, {
        kind: "training",
        mode: index === 0 ? "common-english" : "smart",
        strategy,
        seed: 800 + index
      });
      const block = context.database.addMicroBlock(
        session.lessonId,
        0,
        index === 0 ? "transfer" : "focus",
        "pineapple",
        800 + index,
        "experiment fixture"
      );
      const events = Array.from("pineapple", (character, sequence) =>
        event(sequence, character, character, {
          textPosition: sequence,
          contentMode: index === 0 ? "common-english" : "smart"
        })
      );
      const write = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/events`,
        headers: mutationHeaders(context),
        payload: {
          batchId: randomUUID(),
          lessonId: session.lessonId,
          blockId: String(block.id),
          events
        }
      });
      expect(write.statusCode).toBe(200);
      context.database.completeSession(session.id, 60_000);
      expect(
        context.database.saveSessionSubjectiveFeedback(session.id, {
          difficulty: 2 + index,
          fatigue: 1 + index
        })
      ).toEqual({ difficulty: 2 + index, fatigue: 1 + index });
    }

    const statistics = context.database.getStatistics("all") as {
      experiment: {
        enabled: boolean;
        daysObserved: number;
        eligibleForComparison: boolean;
        conclusion: string;
        groups: Array<{
          strategy: string;
          sessions: number;
          exposureEvents: number;
          accuracy: number | null;
          accuracy95HalfWidth: number | null;
          subjectiveSamples: number;
          brierScore: number | null;
          logLoss: number | null;
          thresholdSessionsEvaluated: number;
          thresholdTimingEligibleSessions: number;
          correctCharactersToThreshold: number | null;
          activeMinutesToThreshold: number | null;
          retention: Record<
            "24h" | "72h" | "7d",
            {
              status: string;
              pairCount: number;
              accuracyDelta: number | null;
              stableWpmDelta: number | null;
            }
          >;
          postErrorRecoverySamples: number;
          postErrorRecoveryMs: number | null;
          calibrationSampleCount: number;
          calibrationExpectedError: number | null;
          calibrationBuckets: { sampleCount: number }[];
          weaknessChange: {
            status: string;
            featureCount: number;
            accuracyDelta: number | null;
            medianIkiDeltaMs: number | null;
          };
        }>;
      };
    };
    expect(statistics.experiment).toMatchObject({
      enabled: true,
      daysObserved: 1,
      eligibleForComparison: false
    });
    expect(statistics.experiment.conclusion).toContain("尚无结论");
    expect(statistics.experiment.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategy: "adaptive",
          sessions: 1,
          exposureEvents: 9,
          accuracy: 1,
          subjectiveSamples: 1
        }),
        expect.objectContaining({
          strategy: "baseline",
          sessions: 1,
          exposureEvents: 9,
          accuracy: 1,
          subjectiveSamples: 1
        })
      ])
    );
    for (const group of statistics.experiment.groups) {
      expect(group.accuracy95HalfWidth).toBe(0);
      expect(group.brierScore).not.toBeNull();
      expect(group.logLoss).not.toBeNull();
      expect(group.thresholdSessionsEvaluated).toBe(1);
      expect(group.thresholdTimingEligibleSessions).toBe(0);
      expect(group.correctCharactersToThreshold).toBeNull();
      expect(group.activeMinutesToThreshold).toBeNull();
      expect(group.retention["24h"]).toMatchObject({
        status: "insufficient",
        pairCount: 0,
        accuracyDelta: null,
        stableWpmDelta: null
      });
      expect(group.retention["72h"].accuracyDelta).toBeNull();
      expect(group.retention["7d"].accuracyDelta).toBeNull();
      expect(group.postErrorRecoverySamples).toBe(0);
      expect(group.postErrorRecoveryMs).toBeNull();
      expect(group.calibrationSampleCount).toBe(9);
      expect(group.calibrationExpectedError).toBeNull();
      expect(group.calibrationBuckets.reduce((sum, bucket) => sum + bucket.sampleCount, 0)).toBe(9);
      expect(group.weaknessChange).toMatchObject({
        status: "insufficient",
        featureCount: 0,
        accuracyDelta: null,
        medianIkiDeltaMs: null
      });
    }
  });

  test("algorithm experiment derives threshold, retention, recovery, calibration, and weakness change from live SQLite events", async () => {
    const context = await openApp();
    context.database.updateSettings({
      experimentEnabled: true,
      targetWpm: 45,
      progressionAccuracy: 0.975
    });

    let fixtureSeed = 900;
    const persistBlock = async (input: {
      blockType: "focus" | "retest";
      targetText: string;
      completedAt: string;
      activeMs: number;
      buildEvent: (target: string, sequence: number) => StoredEvent;
    }) => {
      const session = await createSession(context, {
        kind: "training",
        mode: "smart",
        strategy: "adaptive",
        focus: ["a"],
        seed: fixtureSeed++
      });
      const block = context.database.addMicroBlock(
        session.lessonId,
        0,
        input.blockType,
        input.targetText,
        fixtureSeed,
        "live experiment evidence fixture"
      );
      const write = await context.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/events`,
        headers: mutationHeaders(context),
        payload: eventPayload(
          session,
          block as unknown as BlockRecord,
          Array.from(input.targetText, input.buildEvent)
        )
      });
      expect(write.statusCode).toBe(200);
      context.database.completeSession(session.id, input.activeMs);
      context.database.db
        .prepare("UPDATE sessions SET started_at = ?, completed_at = ? WHERE id = ?")
        .run(input.completedAt, input.completedAt, session.id);
      return session;
    };

    const anchor = Date.now();
    const atHoursAgo = (hours: number) => new Date(anchor - hours * 3_600_000).toISOString();
    const thresholdAt = atHoursAgo(240);
    await persistBlock({
      blockType: "focus",
      targetText: "a".repeat(30),
      completedAt: thresholdAt,
      activeMs: 60_000,
      buildEvent: (target, sequence) =>
        event(sequence, target, target, {
          ikiMs: sequence === 0 ? null : 200,
          textPosition: sequence
        })
    });

    const weakTargets = ["s", "d", "f"].map((target) => target.repeat(10)).join("");
    await persistBlock({
      blockType: "focus",
      targetText: weakTargets,
      completedAt: atHoursAgo(192),
      activeMs: 30_000,
      buildEvent: (target, sequence) => {
        const positionInFeature = sequence % 10;
        const actual = positionInFeature < 5 ? "x" : target;
        return event(sequence, target, actual, {
          ikiMs: sequence === 0 ? null : positionInFeature === 5 ? 420 : 400,
          isAfterError: positionInFeature === 5,
          textPosition: sequence
        });
      }
    });

    for (const pair of [
      { baselineHoursAgo: 26, retestHoursAgo: 2 },
      { baselineHoursAgo: 25, retestHoursAgo: 1 }
    ]) {
      await persistBlock({
        blockType: "focus",
        targetText: "a".repeat(8),
        completedAt: atHoursAgo(pair.baselineHoursAgo),
        activeMs: 8_000,
        buildEvent: (target, sequence) =>
          event(sequence, target, sequence === 7 ? "x" : target, {
            ikiMs: sequence === 0 ? null : 360,
            textPosition: sequence
          })
      });
      await persistBlock({
        blockType: "retest",
        targetText: "a".repeat(8),
        completedAt: atHoursAgo(pair.retestHoursAgo),
        activeMs: 8_000,
        buildEvent: (target, sequence) =>
          event(sequence, target, target, {
            ikiMs: sequence === 0 ? null : 300,
            textPosition: sequence
          })
      });
    }

    const response = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    expect(response.statusCode).toBe(200);
    const statistics = response.json<{
      experiment: {
        groups: Array<{
          strategy: "adaptive" | "baseline";
          thresholdTimingEligibleSessions: number;
          thresholdReachedAt: string | null;
          correctCharactersToThreshold: number | null;
          activeMinutesToThreshold: number | null;
          retention: Record<
            "24h" | "72h" | "7d",
            {
              status: "insufficient" | "descriptive";
              pairCount: number;
              baselineCharacters: number;
              retestCharacters: number;
              timingPairCount: number;
              accuracyDelta: number | null;
              stableWpmDelta: number | null;
            }
          >;
          postErrorRecoverySamples: number;
          postErrorRecoveryMs: number | null;
          calibrationSampleCount: number;
          calibrationExpectedError: number | null;
          calibrationBuckets: { sampleCount: number }[];
          weaknessChange: {
            status: "insufficient" | "limited" | "descriptive";
            featureCount: number;
            exposureEvents: number;
            improvedFeatureCount: number;
            accuracyDelta: number | null;
            medianIkiDeltaMs: number | null;
          };
        }>;
      };
    }>();
    const adaptive = statistics.experiment.groups.find((group) => group.strategy === "adaptive");
    expect(adaptive).toBeDefined();
    expect(adaptive).toMatchObject({
      thresholdTimingEligibleSessions: 1,
      thresholdReachedAt: thresholdAt,
      correctCharactersToThreshold: 30,
      activeMinutesToThreshold: 1,
      postErrorRecoverySamples: 3,
      postErrorRecoveryMs: 420,
      calibrationSampleCount: 92,
      weaknessChange: {
        status: "descriptive",
        featureCount: 3,
        exposureEvents: 30,
        improvedFeatureCount: 3,
        accuracyDelta: 1,
        medianIkiDeltaMs: null
      }
    });
    expect(adaptive?.retention["24h"]).toMatchObject({
      status: "descriptive",
      pairCount: 2,
      baselineCharacters: 16,
      retestCharacters: 16,
      timingPairCount: 2,
      accuracyDelta: 0.125
    });
    expect(adaptive?.retention["24h"].stableWpmDelta).toBeGreaterThan(0);
    expect(adaptive?.retention["72h"]).toMatchObject({
      status: "insufficient",
      pairCount: 0,
      accuracyDelta: null,
      stableWpmDelta: null
    });
    expect(adaptive?.retention["7d"].accuracyDelta).toBeNull();
    expect(adaptive?.calibrationExpectedError).not.toBeNull();
    expect(adaptive?.calibrationBuckets.reduce((sum, bucket) => sum + bucket.sampleCount, 0)).toBe(
      92
    );
  });

  test("100k-event dashboard and statistics queries stay below the local 5s evidence threshold", async () => {
    const context = await openApp();
    context.database.updateSettings({ experimentEnabled: true });
    const session = context.database.createSession({
      kind: "training",
      mode: "benchmark",
      strategy: "adaptive",
      seed: 11,
      focus: []
    });
    const sessionId = String(session.id);
    const serverTime = new Date().toISOString();
    context.database.db
      .prepare(
        `WITH RECURSIVE counter(value) AS (
             SELECT 0
             UNION ALL
             SELECT value + 1 FROM counter WHERE value < 99999
           )
           INSERT INTO keystroke_events (
             session_id, sequence, client_time_ms, server_time, target_char, actual_char,
             physical_code, shift_side, modifiers_json, is_correct, is_correction,
             backspace_count, iki_ms, feature_char, mapped_hand, mapped_finger,
             keyboard_row, zone, character_class, content_mode, text_position,
             is_word_boundary, is_after_error, was_refocus, was_paused, was_long_pause,
             was_throttled, was_repeat
           )
           SELECT ?, value, value * 180, ?, 'a', 'a', 'KeyA', 'none', '{}', 1, 0,
                  0, 180, 'a', 'left', 'left-pinky', 'home', 'left-pinky', 'letter',
                  'benchmark', value, 0, 0, 0, 0, 0, 0, 0
           FROM counter`
      )
      .run(sessionId, serverTime);
    context.database.completeSession(sessionId, 18_000_000);

    const startedAt = performance.now();
    const statistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    const dashboard = await context.app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { host: HOST }
    });
    const elapsedMs = performance.now() - startedAt;
    expect(statistics.statusCode).toBe(200);
    expect(dashboard.statusCode).toBe(200);
    expect(statistics.json()).toMatchObject({
      overview: { sessions: 1, characters: 100_000, correct: 100_000, errors: 0 },
      experiment: {
        enabled: true,
        groups: [
          expect.objectContaining({
            strategy: "adaptive",
            calibrationSampleCount: 100_000,
            correctCharactersToThreshold: 100_000
          }),
          expect.objectContaining({ strategy: "baseline", calibrationSampleCount: 0 })
        ]
      }
    });
    console.info(
      `[server benchmark] 100k-event statistics + dashboard: ${elapsedMs.toFixed(1)} ms`
    );
    expect(elapsedMs).toBeLessThan(5_000);
  }, 30_000);

  async function levelResult(
    context: AppContext,
    runId: string,
    outcome: "success" | "failure",
    alertValue: number,
    simulateLegacySummary = false
  ): Promise<{
    run: Record<string, unknown>;
    result: {
      outcome: "success" | "failure";
      score: number;
      alertValue: number;
      errorFree: boolean;
      completedStages: number;
      sessionId: string;
    };
  }> {
    const gameResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/game/runs/${runId}`,
      headers: { host: HOST }
    });
    expect(gameResponse.statusCode).toBe(200);
    const game = gameResponse.json<{
      run: { current_level: number; difficulty: "standard" | "hard" | "adaptive" };
    }>();
    const level = game.run.current_level;
    const session = await createSession(context, {
      kind: "game",
      mode: `pineapple-level-${level}`,
      strategy: "adaptive",
      seed: level * 7919
    });
    let nextSequence = 0;

    for (const stage of [1, 2, 3] as const) {
      const blockResponse = await context.app.inject({
        method: "POST",
        url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
        headers: mutationHeaders(context),
        payload: {
          blockIndex: stage - 1,
          seed: level * 7919,
          mode: `game-${level}`,
          length: 120,
          focus: [],
          phase: "focus",
          gameRunId: runId,
          gameStage: stage
        }
      });
      expect(blockResponse.statusCode).toBe(200);
      const block = blockResponse.json<{ block: BlockRecord }>().block;
      expect(block.target_text.length).toBeGreaterThan(0);
      const blockEvents = Array.from(block.target_text, (targetChar, textPosition) => {
        const shouldMiss =
          outcome === "failure" &&
          textPosition < block.target_text.length - 1 &&
          textPosition % 3 === 0;
        const actualChar = shouldMiss ? (targetChar.toLowerCase() === "x" ? "q" : "x") : targetChar;
        const typed = event(nextSequence, targetChar, actualChar, {
          textPosition,
          contentMode: `game-${level}`
        });
        nextSequence += 1;
        return typed;
      });
      for (let offset = 0; offset < blockEvents.length; offset += 100) {
        const batch = await context.app.inject({
          method: "POST",
          url: `/api/v1/sessions/${session.id}/events`,
          headers: mutationHeaders(context),
          payload: eventPayload(session, block, blockEvents.slice(offset, offset + 100))
        });
        expect(batch.statusCode).toBe(200);
      }
    }

    const completion = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/complete`,
      headers: mutationHeaders(context),
      payload: { activeMs: Math.max(1_000, nextSequence * 200) }
    });
    expect(completion.statusCode).toBe(200);
    const summary = completion.json<{
      summary: { correct: number; errors: number; keystrokeAccuracy: number; netWpm: number };
    }>().summary;
    if (outcome === "success") {
      expect(summary.errors).toBe(0);
      expect(summary.keystrokeAccuracy).toBe(1);
    } else {
      expect(summary.errors).toBeGreaterThan(0);
      expect(summary.keystrokeAccuracy).toBeLessThan(0.9);
    }

    if (simulateLegacySummary) {
      const legacy = JSON.parse(
        context.database.db
          .prepare("SELECT summary_json FROM sessions WHERE id = ?")
          .pluck()
          .get(session.id) as string
      ) as Record<string, unknown>;
      delete legacy.metricVersion;
      delete legacy.uncorrectedErrors;
      legacy.netWpm = 0;
      context.database.db
        .prepare("UPDATE sessions SET summary_json = ? WHERE id = ?")
        .run(JSON.stringify(legacy), session.id);
    }

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/game/runs/${runId}/level-result`,
      headers: mutationHeaders(context),
      payload: {
        sessionId: session.id,
        outcome,
        alertValue,
        ...(outcome === "failure" ? { failureReason: "accuracy-gate" } : {})
      }
    });
    expect(response.statusCode).toBe(200);
    const verified = response.json<{
      run: Record<string, unknown>;
      result: {
        outcome: "success" | "failure";
        score: number;
        alertValue: number;
        errorFree: boolean;
        completedStages: number;
        sessionId: string;
      };
    }>();
    expect(verified.result).toMatchObject({
      outcome,
      completedStages: 3,
      sessionId: session.id,
      errorFree: outcome === "success"
    });
    if (outcome === "success") {
      const rules = GAME_RULES[game.run.difficulty];
      const expectedScore = Math.min(
        1_000_000,
        Math.max(
          100,
          Math.round(
            summary.correct * rules.pointsPerCorrect +
              summary.keystrokeAccuracy * 500 +
              summary.netWpm * 5 -
              verified.result.alertValue * 3
          )
        )
      );
      expect(verified.result.score).toBe(expectedScore);
    } else {
      expect(verified.result.score).toBe(0);
    }
    if (simulateLegacySummary) {
      const stored = JSON.parse(
        context.database.db
          .prepare("SELECT summary_json FROM sessions WHERE id = ?")
          .pluck()
          .get(session.id) as string
      ) as Record<string, unknown>;
      expect(stored).toMatchObject({ netWpm: 0 });
      expect(stored).not.toHaveProperty("metricVersion");
    }
    return verified;
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
