import { SYMMETRIC_PRESET } from "@symtype/shared";
import { describe, expect, test } from "vitest";

import {
  analyzeSessionErrors,
  calculateSessionSummary,
  classifyAlignedText,
  mergeErrorAnalysis,
  summarizeFinalText,
  unavailableErrorAnalysis,
  type SummaryEventRow
} from "../src/domain/session-analysis.js";

function row(
  sequence: number,
  target: string,
  actual = target,
  overrides: Partial<SummaryEventRow> = {}
): SummaryEventRow {
  return {
    sequence,
    is_correct: actual === target ? 1 : 0,
    iki_ms: sequence === 0 ? null : 200,
    was_long_pause: 0,
    was_refocus: 0,
    was_throttled: 0,
    was_repeat: 0,
    target_char: target,
    actual_char: actual,
    block_id: "block-1",
    text_position: sequence,
    is_correction: 0,
    backspace_count: 0,
    shift_side: "none",
    modifiers_json: "{}",
    mapped_hand: "left",
    mapped_finger: "left-pinky",
    keyboard_row: "home",
    was_paused: 0,
    ...overrides
  };
}

describe("session analysis domain", () => {
  test("calculates dual accuracy, speed eligibility, and correction-aware final text", () => {
    const rows = [
      row(0, "a", "s"),
      row(1, "a", "a", { text_position: 0, is_correction: 1, backspace_count: 1 }),
      row(2, "b", "b", { iki_ms: 200, text_position: 1 })
    ];
    const summary = calculateSessionSummary(rows, 1_000);
    expect(summary).toMatchObject({
      characters: 3,
      correct: 2,
      errors: 1,
      keystrokeAccuracy: 0.6667,
      finalTextAccuracy: 1,
      longestAccurateStreak: 2,
      activeMs: 1_000
    });
    expect(summary.feedback.bottleneck).toContain("1 次错误");
  });

  test("uses the canonical short-test penalty for only errors left in the submitted text", () => {
    const corrected = calculateSessionSummary(
      [
        row(0, "a", "s"),
        row(1, "a", "a", { text_position: 0, is_correction: 1, backspace_count: 1 }),
        row(2, "b")
      ],
      30_000
    );
    expect(corrected).toMatchObject({ rawWpm: 1.2, netWpm: 1.2, finalTextAccuracy: 1 });

    const oneRemainingError = calculateSessionSummary(
      Array.from({ length: 10 }, (_, sequence) => row(sequence, "a", sequence === 9 ? "s" : "a")),
      30_000
    );
    expect(oneRemainingError).toMatchObject({ rawWpm: 4, netWpm: 2 });
  });

  test("applies a trailing correction checkpoint without inventing a keystroke", () => {
    const rows = [row(0, "a"), row(1, "b", "x")];
    const checkpoint = {
      blockId: "block-1",
      position: 1
    };
    const summary = calculateSessionSummary(rows, 30_000, undefined, checkpoint);

    expect(summary).toMatchObject({
      characters: 2,
      errors: 1,
      rawWpm: 0.8,
      netWpm: 0.8,
      finalTextAccuracy: 1
    });
    expect(summarizeFinalText(rows, checkpoint)).toEqual({
      characters: 1,
      correct: 1,
      uncorrectedErrors: 0
    });
  });

  test("classifies text and timing from repository-neutral rows", () => {
    const rows = Array.from("aaaaaaaa", (target, sequence) =>
      row(sequence, target, sequence === 0 ? "s" : target, {
        iki_ms: sequence === 0 ? null : 220,
        text_position: sequence
      })
    );
    const analysis = analyzeSessionErrors({
      rows,
      blockTargets: new Map([["block-1", "aaaaaaaa"]]),
      preset: SYMMETRIC_PRESET,
      targetWpm: 45
    });
    expect(analysis.eventCount).toBe(8);
    expect(analysis.validTimingSamples).toBe(7);
    expect(analysis.evidence.timing.status).not.toBe("insufficient");
    expect(analysis.textIssues.reduce((sum, issue) => sum + issue.count, 0)).toBeGreaterThan(0);
  });

  test("rejects malformed authoritative modifier JSON instead of inventing evidence", () => {
    expect(() =>
      analyzeSessionErrors({
        rows: [row(0, "a", "a", { modifiers_json: "{" })],
        blockTargets: new Map([["block-1", "a"]]),
        preset: SYMMETRIC_PRESET,
        targetWpm: 45
      })
    ).toThrow(/keystroke modifiers JSON is corrupted/u);
  });

  test("chunks long aligned text without dropping a trailing error", () => {
    const target = `${"a".repeat(480)}b`;
    const actual = `${"a".repeat(480)}n`;
    const issues = classifyAlignedText(target, actual, SYMMETRIC_PRESET);
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: "b", actual: "n" })])
    );
  });

  test("merges evidence conservatively and preserves insufficient empty state", () => {
    const empty = unavailableErrorAnalysis(0);
    const one = analyzeSessionErrors({
      rows: [row(0, "a")],
      blockTargets: new Map([["block-1", "a"]]),
      preset: SYMMETRIC_PRESET,
      targetWpm: 45
    });
    expect(mergeErrorAnalysis([])).toEqual(empty);
    expect(mergeErrorAnalysis([one, one])).toMatchObject({
      eventCount: 2,
      evidence: { text: { sampleCount: 2, status: "sufficient" } }
    });
  });
});
