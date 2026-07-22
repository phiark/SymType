import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FIXED_NOW, GoldenHarness } from "./v1-golden.fixture.js";

describe.sequential("V1 server game and backup goldens", () => {
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

  test("freezes campaign current-level and hardcore full-run reset rules", async () => {
    const context = await harness.openApp();
    const campaign = context.database.createGameRun("campaign", "standard") as { id: string };
    context.database.updateGameLevel(campaign.id, "success", 100, 4, true);
    const campaignFailure = context.database.updateGameLevel(
      campaign.id,
      "failure",
      0,
      100,
      false,
      undefined,
      "timeout"
    ) as { current_level: number; score: number; alert_value: number; levels: unknown[] };
    expect({
      currentLevel: campaignFailure.current_level,
      score: campaignFailure.score,
      alert: campaignFailure.alert_value,
      levels: campaignFailure.levels
    }).toEqual({
      currentLevel: 2,
      score: 100,
      alert: 0,
      levels: [
        expect.objectContaining({
          level_number: 1,
          attempt_number: 1,
          status: "success",
          score: 100,
          alert_value: 4,
          summary_json: '{"cycle":1,"errorFree":true}'
        }),
        expect.objectContaining({
          level_number: 2,
          attempt_number: 1,
          status: "failure",
          score: 0,
          alert_value: 100,
          summary_json: '{"cycle":1,"errorFree":false,"failureReason":"timeout"}'
        }),
        expect.objectContaining({
          level_number: 2,
          attempt_number: 2,
          status: "active",
          score: 0,
          alert_value: 0,
          summary_json: '{"cycle":1}'
        })
      ]
    });

    const hardcore = context.database.createGameRun("hardcore", "hard") as { id: string };
    context.database.updateGameLevel(hardcore.id, "success", 200, 2);
    const hardcoreFailure = context.database.updateGameLevel(
      hardcore.id,
      "failure",
      0,
      100,
      false,
      undefined,
      "alert-maxed"
    ) as { current_level: number; score: number; alert_value: number; levels: unknown[] };
    expect({
      currentLevel: hardcoreFailure.current_level,
      score: hardcoreFailure.score,
      alert: hardcoreFailure.alert_value,
      levels: hardcoreFailure.levels
    }).toEqual({
      currentLevel: 1,
      score: 0,
      alert: 0,
      levels: [
        expect.objectContaining({
          level_number: 1,
          attempt_number: 1,
          status: "success",
          score: 200,
          summary_json: '{"cycle":1,"errorFree":false}'
        }),
        expect.objectContaining({
          level_number: 1,
          attempt_number: 2,
          status: "active",
          score: 0,
          summary_json: '{"cycle":2}'
        }),
        expect.objectContaining({
          level_number: 2,
          attempt_number: 1,
          status: "failure",
          score: 0,
          alert_value: 100,
          summary_json: '{"cycle":1,"errorFree":false,"failureReason":"alert-maxed"}'
        })
      ]
    });
  });

  test("freezes six-level completion and personal-best projections", async () => {
    const context = await harness.openApp();
    const winning = context.database.createGameRun("campaign", "adaptive") as { id: string };
    for (const score of [100, 200, 300, 400, 500, 600]) {
      context.database.updateGameLevel(winning.id, "success", score, 0);
    }
    const completed = context.database.getGameRun(winning.id) as Record<string, unknown>;
    expect({
      mode: completed.mode,
      difficulty: completed.difficulty,
      status: completed.status,
      currentLevel: completed.current_level,
      score: completed.score,
      personalBest: completed.personal_best
    }).toEqual({
      mode: "campaign",
      difficulty: "adaptive",
      status: "completed",
      currentLevel: 6,
      score: 2_100,
      personalBest: 1
    });
    const lower = context.database.createGameRun("campaign", "adaptive") as { id: string };
    for (const score of [10, 20, 30, 40, 50, 60]) {
      context.database.updateGameLevel(lower.id, "success", score, 0);
    }
    expect(
      context.database.db
        .prepare(
          `SELECT score, personal_best FROM game_runs
           WHERE difficulty = 'adaptive' ORDER BY score`
        )
        .all()
    ).toEqual([
      { score: 210, personal_best: 0 },
      { score: 2_100, personal_best: 1 }
    ]);
    const progress = context.database.getGameProgress();
    expect({
      unlockedLevel: progress.unlockedLevel,
      completedLevels: progress.completedLevels,
      personalBests: progress.personalBests,
      personalBest: progress.personalBest
    }).toEqual({
      unlockedLevel: 6,
      completedLevels: [1, 2, 3, 4, 5, 6],
      personalBests: [
        { level: 1, score: 100 },
        { level: 2, score: 200 },
        { level: 3, score: 300 },
        { level: 4, score: 400 },
        { level: 5, score: 500 },
        { level: 6, score: 600 }
      ],
      personalBest: 2_100
    });
  });

  test("restores a canonical JSON export to equivalent user data", async () => {
    const context = await harness.openApp();
    context.database.updateSettings({ theme: "light", targetWpm: 61 });
    const session = harness.createSession(context);
    const block = harness.createBlock(context, session, "qa");
    harness.ingest(context, session, block, [
      harness.event({ sequence: 0, targetChar: "q", physicalCode: "KeyQ", textPosition: 0 }),
      harness.event({
        sequence: 1,
        targetChar: "a",
        physicalCode: "KeyA",
        textPosition: 1,
        overrides: { ikiMs: 240 }
      })
    ]);
    context.database.completeSession(session.id, 2_000);
    const exported = context.database.exportJson() as {
      format: string;
      schemaVersion: number;
      algorithmVersion: string;
      exportedAt: string;
      data: Record<string, Record<string, unknown>[]>;
    };
    expect(Object.keys(exported.data)).toEqual([
      "profiles",
      "settings",
      "keyboard_layouts",
      "key_mappings",
      "sessions",
      "lessons",
      "micro_blocks",
      "event_batches",
      "keystroke_events",
      "feature_stats",
      "daily_summaries",
      "goals",
      "streaks",
      "tests",
      "personal_bests",
      "game_runs",
      "game_levels",
      "achievements",
      "content_sources",
      "custom_texts"
    ]);
    expect(context.database.validateJsonBackup(exported)).toEqual({
      ok: true,
      summary: { profiles: 1, sessions: 1, events: 2, customTexts: 0, gameRuns: 0 }
    });

    context.database.updateSettings({ theme: "dark", targetWpm: 99 });
    context.database.createGameRun("campaign", "standard");
    const restored = await context.database.restoreJsonBackup(exported);
    expect(Object.keys(restored).sort()).toEqual(["restored", "safetyBackup", "summary"]);
    expect(restored).toMatchObject({
      restored: true,
      summary: { profiles: 1, sessions: 1, events: 2, customTexts: 0, gameRuns: 0 },
      safetyBackup: { reason: "pre-restore", schemaVersion: 10 }
    });
    const after = context.database.exportJson() as typeof exported;
    expect({
      format: after.format,
      schemaVersion: after.schemaVersion,
      algorithmVersion: after.algorithmVersion,
      data: after.data
    }).toEqual({
      format: "symtype-json-backup",
      schemaVersion: 10,
      algorithmVersion: "adaptive-v1",
      data: exported.data
    });
    expect(context.database.integrityCheck({ refresh: true })).toEqual({ ok: true, detail: "ok" });
  });
});
