import type { PersistedSessionSummary } from "@symtype/shared";
import { describe, expect, test } from "vitest";

import {
  buildExperimentReport,
  type ExperimentEvent,
  type ExperimentSession,
  type ExperimentSettings,
  type ExperimentStrategy
} from "../src/domain/experiment-analysis.js";
import { unavailableErrorAnalysis } from "../src/domain/session-analysis.js";

const settings: ExperimentSettings = {
  experimentEnabled: true,
  targetWpm: 45,
  progressionAccuracy: 0.975
};

function summary(characters: number, correct = characters): PersistedSessionSummary {
  return {
    characters,
    correct,
    errors: characters - correct,
    rawWpm: 60,
    netWpm: 58,
    keystrokeAccuracy: correct / characters,
    finalTextAccuracy: correct / characters,
    accuracy: correct / characters,
    consistency: 0.9,
    activeMs: 60_000,
    longestAccurateStreak: correct,
    feedback: { good: "good", bottleneck: "bottleneck", next: "next" },
    errorAnalysis: unavailableErrorAnalysis(characters)
  };
}

function session(
  id: string,
  strategy: ExperimentStrategy,
  startedAt: string,
  overrides: Partial<ExperimentSession> = {}
): ExperimentSession {
  return {
    id,
    strategy,
    mode: "smart",
    status: "completed",
    activeMs: 60_000,
    summary: summary(30),
    startedAt,
    completedAt: startedAt,
    ...overrides
  };
}

function event(
  sessionId: string,
  strategy: ExperimentStrategy,
  sequence: number,
  overrides: Partial<ExperimentEvent> = {}
): ExperimentEvent {
  return {
    sessionId,
    strategy,
    sessionMode: "smart",
    completedAt: "2026-07-01T00:00:00.000Z",
    sequence,
    serverTime: "2026-07-01T00:00:00.000Z",
    targetChar: "a",
    isCorrect: 1,
    ikiMs: sequence === 0 ? null : 200,
    wasLongPause: 0,
    wasRefocus: 0,
    wasPaused: 0,
    wasThrottled: 0,
    wasRepeat: 0,
    isAfterError: 0,
    blockId: null,
    blockType: null,
    focusJson: null,
    ...overrides
  };
}

describe("experiment analysis domain", () => {
  test("keeps disabled experiments explicitly empty", () => {
    expect(
      buildExperimentReport({
        settings: { ...settings, experimentEnabled: false },
        sessions: [],
        events: []
      })
    ).toMatchObject({
      enabled: false,
      assignment: "disabled",
      eligibleForComparison: false,
      groups: [
        { strategy: "adaptive", sessions: 0, brierScore: null },
        { strategy: "baseline", sessions: 0, brierScore: null }
      ]
    });
  });

  test("derives uncertainty, calibration, threshold, and honest comparison gating", () => {
    const startedAt = "2026-07-01T00:00:00.000Z";
    const sessions = [session("adaptive-1", "adaptive", startedAt)];
    const events = Array.from({ length: 30 }, (_, sequence) =>
      event("adaptive-1", "adaptive", sequence)
    );
    const report = buildExperimentReport({ settings, sessions, events }) as {
      daysObserved: number;
      eligibleForComparison: boolean;
      conclusion: string;
      groups: Array<Record<string, unknown>>;
    };
    const adaptive = report.groups[0] as {
      brierScore: number;
      logLoss: number;
      calibrationExpectedError: number;
      thresholdReachedAt: string;
      correctCharactersToThreshold: number;
      accuracy95HalfWidth: number;
    };
    expect(report).toMatchObject({ daysObserved: 1, eligibleForComparison: false });
    expect(report.conclusion).toContain("尚无结论");
    expect(adaptive.brierScore).toBeGreaterThanOrEqual(0);
    expect(adaptive.logLoss).toBeGreaterThanOrEqual(0);
    expect(adaptive.calibrationExpectedError).toBeGreaterThanOrEqual(0);
    expect(adaptive.thresholdReachedAt).toBe(startedAt);
    expect(adaptive.correctCharactersToThreshold).toBe(30);
    expect(adaptive.accuracy95HalfWidth).toBe(0);
  });

  test("pairs focus and retest blocks once inside the declared 24h window", () => {
    const baselineTime = "2026-07-01T00:00:00.000Z";
    const retestTime = "2026-07-02T00:00:00.000Z";
    const sessions = [
      session("base-1", "adaptive", baselineTime, { summary: summary(8, 7), activeMs: 8_000 }),
      session("retest-1", "adaptive", retestTime, { summary: summary(8), activeMs: 8_000 })
    ];
    const baseline = Array.from({ length: 8 }, (_, sequence) =>
      event("base-1", "adaptive", sequence, {
        completedAt: baselineTime,
        isCorrect: sequence === 7 ? 0 : 1,
        ikiMs: sequence === 0 ? null : 360,
        blockId: "focus-1",
        blockType: "focus",
        focusJson: '["a"]'
      })
    );
    const retest = Array.from({ length: 8 }, (_, sequence) =>
      event("retest-1", "adaptive", sequence, {
        completedAt: retestTime,
        ikiMs: sequence === 0 ? null : 300,
        blockId: "retest-1",
        blockType: "retest",
        focusJson: '["a"]'
      })
    );
    const report = buildExperimentReport({
      settings,
      sessions,
      events: [...baseline, ...retest]
    }) as {
      groups: Array<{ strategy: string; retention: Record<string, Record<string, unknown>> }>;
    };
    const adaptive = report.groups.find((group) => group.strategy === "adaptive");
    expect(adaptive?.retention["24h"]).toMatchObject({
      status: "insufficient",
      pairCount: 1,
      minimumPairs: 2,
      baselineCharacters: 8,
      retestCharacters: 8,
      accuracyDelta: null,
      stableWpmDelta: null
    });
  });
});
