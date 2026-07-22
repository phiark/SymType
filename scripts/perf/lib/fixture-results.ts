import type Database from "better-sqlite3";

import { FIXED_PROFILE_ID, deterministicUuid } from "./fixture-constants.js";
import type { ErrorEvent, EventEvidence, FixtureSummary, SessionPlan } from "./fixture-model.js";

export function buildSummary(eventCount: number, evidence: EventEvidence): FixtureSummary {
  const errors = eventCount - evidence.correct;
  const activeMs = eventCount * 200;
  const minutes = activeMs / 60_000;
  const rawWpm = eventCount / 5 / minutes;
  const netWpm = Math.max(0, rawWpm - errors / minutes);
  const accuracy = evidence.correct / eventCount;
  return {
    characters: eventCount,
    correct: evidence.correct,
    errors,
    rawWpm,
    netWpm,
    keystrokeAccuracy: accuracy,
    finalTextAccuracy: accuracy,
    accuracy,
    consistency: 0.92,
    activeMs,
    longestAccurateStreak: evidence.longestStreak,
    feedback: {
      good: "Fixed fixture accuracy evidence.",
      bottleneck: errors > 0 ? "Fixed e to r confusion." : "No fixture errors.",
      next: "Repeat the fixed transfer block."
    },
    errorAnalysis: errorAnalysis(eventCount, errors)
  };
}

export function insertTestResult(
  database: Database.Database,
  plan: SessionPlan,
  summary: FixtureSummary,
  errors: readonly ErrorEvent[]
): void {
  const durationSeconds = Math.max(15, Math.ceil(summary.activeMs / 1_000));
  const errorPayload = {
    count: errors.length,
    truncated: false,
    topConfusions: errors.length
      ? [{ target: "e", actual: "r", physicalCode: "KeyR", count: errors.length }]
      : [],
    events: errors
  };
  database
    .prepare(
      `INSERT INTO tests
       (id, session_id, duration_seconds, raw_wpm, net_wpm, accuracy, consistency, errors_json,
        created_at, keystroke_accuracy, final_text_accuracy)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      deterministicUuid("test", plan.index),
      plan.sessionId,
      durationSeconds,
      summary.rawWpm,
      summary.netWpm,
      summary.accuracy,
      summary.consistency,
      JSON.stringify(errorPayload),
      plan.completedAt,
      summary.keystrokeAccuracy,
      summary.finalTextAccuracy
    );
  database
    .prepare(
      `INSERT INTO personal_bests(profile_id, category, value, session_id, achieved_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, category) DO UPDATE SET value = MAX(value, excluded.value)`
    )
    .run(
      FIXED_PROFILE_ID,
      `test-net-wpm:${durationSeconds}`,
      summary.netWpm,
      plan.sessionId,
      plan.completedAt
    );
}

export function insertGameResult(
  database: Database.Database,
  plan: SessionPlan,
  summary: FixtureSummary
): void {
  const runId = deterministicUuid("game-run", plan.index);
  const level = (plan.index % 6) + 1;
  const score = summary.correct * 10;
  const alertValue = Math.min(99, summary.errors * 1.5);
  database
    .prepare(
      `INSERT INTO game_runs
       (id, profile_id, mode, difficulty, status, current_level, score, alert_value, started_at,
        completed_at, personal_best)
       VALUES(?, ?, 'campaign', 'standard', 'completed', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      runId,
      FIXED_PROFILE_ID,
      level,
      score,
      alertValue,
      plan.startedAt,
      plan.completedAt,
      score
    );
  database
    .prepare(
      `INSERT INTO game_levels
       (run_id, level_number, attempt_number, status, score, alert_value, started_at,
        completed_at, summary_json)
       VALUES(?, ?, 1, 'completed', ?, ?, ?, ?, ?)`
    )
    .run(
      runId,
      level,
      score,
      alertValue,
      plan.startedAt,
      plan.completedAt,
      JSON.stringify({ cycle: 1, errorFree: summary.errors === 0, sessionId: plan.sessionId })
    );
}

function errorAnalysis(eventCount: number, errors: number): Record<string, unknown> {
  const evidence = (sampleCount: number, minimumSamples: number) => ({
    status: sampleCount < minimumSamples ? ("insufficient" as const) : ("sufficient" as const),
    sampleCount,
    minimumSamples
  });
  return {
    version: 1,
    eventCount,
    validTimingSamples: Math.max(0, eventCount - errors - 1),
    baselineIkiMs: 200,
    evidence: {
      text: evidence(errors, 1),
      timing: evidence(eventCount - 1, 5),
      combinations: evidence(eventCount - 2, 8),
      balance: evidence(eventCount, 10),
      shift: evidence(eventCount, 1),
      fatigue: evidence(eventCount, 18)
    },
    textIssues: errors > 0 ? [substitutionIssue(errors)] : [],
    behavioralIssues: []
  };
}

function substitutionIssue(count: number): Record<string, unknown> {
  return {
    kind: "substitution",
    count,
    topFeatures: [{ feature: "e→r", count, severity: 1 }]
  };
}
