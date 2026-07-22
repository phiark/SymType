import type { RuntimeSettings } from "@symtype/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AppContext } from "../src/app.js";
import { FIXED_NOW, GoldenHarness, type SessionIds } from "./v1-golden.fixture.js";

const NON_DEFAULT_SETTINGS: RuntimeSettings = {
  onboardingComplete: true,
  calibrationComplete: true,
  theme: "dark",
  reducedMotion: true,
  keyboardVisible: false,
  keyboardFingerColors: false,
  soundEnabled: false,
  soundTheme: "terminal",
  soundMode: "errors",
  volume: 0.72,
  activeLayoutId: "standard-default",
  stopOnError: true,
  backspaceMode: "words",
  fontSize: 42,
  lineHeight: 2.05,
  caretStyle: "underline",
  smoothScroll: false,
  targetWpm: 83,
  minimumAccuracy: 0.955,
  progressionAccuracy: 0.99,
  trainingBias: "speed",
  defaultDurationMinutes: 37,
  experimentEnabled: true,
  advancedWeights: {
    accuracy: 0.41,
    speed: 0.27,
    uncertainty: 0.13,
    transfer: 0.09,
    userFocus: 0.07,
    recovery: 0.03
  }
};

function createFixedTestHistory(
  harness: GoldenHarness,
  context: AppContext
): { session: SessionIds; testId: string } {
  const session = harness.createSession(context, { kind: "test", mode: "typing-test" });
  const block = harness.createBlock(context, session, "qaz");
  harness.ingest(context, session, block, [
    harness.event({ sequence: 0, targetChar: "q", physicalCode: "KeyQ", textPosition: 0 }),
    harness.event({
      sequence: 1,
      targetChar: "a",
      actualChar: "s",
      physicalCode: "KeyS",
      textPosition: 1,
      overrides: { isCorrect: false, ikiMs: 280 }
    }),
    harness.event({
      sequence: 2,
      targetChar: "z",
      physicalCode: "KeyZ",
      textPosition: 2,
      overrides: { ikiMs: 300 }
    })
  ]);
  const summary = context.database.completeSession(session.id, 6_000);
  return { session, testId: context.database.saveTest(session.id, 30, summary) };
}

describe.sequential("V1 server settings and history goldens", () => {
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

  test("round-trips every non-default setting through SQLite and reopen", async () => {
    const first = await harness.openApp();
    expect(first.database.updateSettings(NON_DEFAULT_SETTINGS)).toEqual(NON_DEFAULT_SETTINGS);
    expect(
      first.database.db.prepare("SELECT id, is_active FROM keyboard_layouts ORDER BY id").all()
    ).toEqual([
      { id: "standard-default", is_active: 1 },
      { id: "symmetric-default", is_active: 0 }
    ]);
    expect(first.database.db.prepare("SELECT version FROM settings").get()).toEqual({ version: 2 });
    await harness.closeApp(first);

    const reopened = await harness.openApp();
    expect(reopened.database.getSettings()).toEqual(NON_DEFAULT_SETTINGS);
    expect(reopened.database.db.prepare("SELECT version FROM settings").get()).toEqual({
      version: 2
    });
  });

  test("freezes dashboard and all-time statistics at a fixed date", async () => {
    const context = await harness.openApp();
    createFixedTestHistory(harness, context);
    const dashboard = context.database.getDashboard() as {
      today: Record<string, unknown>;
      trend: Record<string, unknown>[];
      lastSession: { completedAt: string; summary: Record<string, unknown> };
    };
    expect({
      today: dashboard.today,
      trend: dashboard.trend,
      lastSession: {
        completedAt: dashboard.lastSession.completedAt,
        characters: dashboard.lastSession.summary.characters,
        rawWpm: dashboard.lastSession.summary.rawWpm,
        netWpm: dashboard.lastSession.summary.netWpm,
        accuracy: dashboard.lastSession.summary.accuracy
      }
    }).toEqual({
      today: { active_ms: 6_000, sessions: 1, characters: 3, accuracy: 2 / 3, net_wpm: 5 },
      trend: [
        {
          local_date: "2025-02-14",
          active_ms: 6_000,
          characters: 3,
          accuracy: 2 / 3,
          net_wpm: 5
        }
      ],
      lastSession: {
        completedAt: "2025-02-14T08:00:00.000Z",
        characters: 3,
        rawWpm: 6,
        netWpm: 5,
        accuracy: 0.6667
      }
    });

    const statistics = context.database.getStatistics("all");
    expect({
      period: statistics.period,
      since: statistics.since,
      sinceLocalDate: statistics.sinceLocalDate,
      overview: statistics.overview,
      trend: statistics.trend,
      confusion: statistics.confusion,
      shiftSummary: statistics.shiftSummary
    }).toEqual({
      period: "all",
      since: "1970-01-01T00:00:00.000Z",
      sinceLocalDate: "1970-01-01",
      overview: {
        sessions: 1,
        active_ms: 6_000,
        characters: 3,
        correct: 2,
        errors: 1,
        raw_wpm: 5.999999999999999,
        net_wpm: 0,
        keystroke_accuracy: 2 / 3,
        consistency: null,
        stable_wpm: null,
        timing_samples: 1
      },
      trend: [
        {
          local_date: "2025-02-14",
          kind: "test",
          active_ms: 6_000,
          character_count: 3,
          net_wpm: 5,
          raw_wpm: 6,
          accuracy: 0.6667,
          consistency: 1
        }
      ],
      confusion: [{ target_char: "a", actual_char: "s", count: 1 }],
      shiftSummary: { left: 0, right: 0, both: 0, missing: 0, sameHand: 0, capsLock: 0 }
    });
  });

  test("freezes formal-test history and personal-best rows", async () => {
    const context = await harness.openApp();
    const { session, testId } = createFixedTestHistory(harness, context);
    const history = context.database.listTests().map((row) => ({
      id: row.id === testId ? "<test-id>" : row.id,
      session_id: row.session_id === session.id ? "<session-id>" : row.session_id,
      duration_seconds: row.duration_seconds,
      raw_wpm: row.raw_wpm,
      net_wpm: row.net_wpm,
      accuracy: row.accuracy,
      consistency: row.consistency,
      errors_json: JSON.parse(String(row.errors_json)) as unknown,
      created_at: row.created_at,
      keystroke_accuracy: row.keystroke_accuracy,
      final_text_accuracy: row.final_text_accuracy,
      mode: row.mode,
      errors_valid: row.errors_valid
    }));
    expect(history).toEqual([
      {
        id: "<test-id>",
        session_id: "<session-id>",
        duration_seconds: 30,
        raw_wpm: 6,
        net_wpm: 5,
        accuracy: 0.6667,
        consistency: 1,
        errors_json: {
          count: 1,
          truncated: false,
          topConfusions: [{ target: "a", actual: "s", physicalCode: "KeyS", count: 1 }],
          events: [{ target: "a", actual: "s", physicalCode: "KeyS", position: 1 }]
        },
        created_at: "2025-02-14T08:00:00.000Z",
        keystroke_accuracy: 0.6667,
        final_text_accuracy: 0.6667,
        mode: "typing-test",
        errors_valid: true
      }
    ]);
    expect(
      context.database.db
        .prepare("SELECT category, value FROM personal_bests ORDER BY category")
        .all()
    ).toEqual([
      { category: "test-accuracy:30", value: 0.6667 },
      { category: "test-net-wpm:30", value: 5 }
    ]);
  });
});
