import { describe, expect, it } from "vitest";

import {
  calculateTypingMetrics,
  ewma,
  filterValidIkis,
  finalTextAccuracy,
  keystrokeAccuracy,
  levenshteinDistance,
  median,
  medianAbsoluteDeviation,
  netWpm,
  rawWpm,
  rhythmConsistency,
  robustEwma,
  type IkiObservation
} from "./metrics.js";

describe("typing speed and accuracy", () => {
  it.each([
    [250, 60_000, 50],
    [125, 30_000, 50],
    [0, 60_000, 0],
    [50, 0, 0]
  ])("calculates raw WPM for %s characters in %s ms", (characters, duration, expected) => {
    expect(rawWpm(characters, duration)).toBe(expected);
  });

  it("subtracts uncorrected errors per minute for net WPM", () => {
    expect(netWpm(250, 5, 60_000)).toBe(45);
    expect(netWpm(10, 50, 60_000)).toBe(0);
  });

  it.each([
    [98, 100, 0.98],
    [0, 0, 1],
    [0, 10, 0]
  ])("calculates keystroke accuracy", (correct, attempted, expected) => {
    expect(keystrokeAccuracy(correct, attempted)).toBe(expected);
  });

  it("rejects impossible counts", () => {
    expect(() => keystrokeAccuracy(2, 1)).toThrow(/cannot exceed/);
    expect(() => rawWpm(-1, 1_000)).toThrow(/non-negative/);
  });

  it.each([
    ["kitten", "sitting", 3],
    ["same", "same", 0],
    ["", "abc", 3],
    ["café", "cafe", 1]
  ])("computes Unicode-safe edit distance", (first, second, expected) => {
    expect(levenshteinDistance(first, second)).toBe(expected);
  });

  it.each([
    ["hello", "hello", 1],
    ["hello", "hallo", 0.8],
    ["hello", "hello!", 5 / 6],
    ["", "", 1]
  ])("normalizes final-text accuracy", (target, actual, expected) => {
    expect(finalTextAccuracy(target, actual)).toBeCloseTo(expected);
  });
});

describe("robust interval metrics", () => {
  it.each([
    [[3], 3],
    [[3, 1, 2], 2],
    [[1, 2, 3, 100], 2.5]
  ] as const)("calculates median for %j", (values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it("calculates median absolute deviation", () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 100])).toBe(1);
  });

  it("calculates an EWMA without mutating values", () => {
    const values = [100, 200, 300];
    expect(ewma(values, 0.5)).toBe(225);
    expect(values).toEqual([100, 200, 300]);
    expect(ewma([], 0.5)).toBeNull();
  });

  it("limits a single long pause in robust EWMA", () => {
    const normal = robustEwma([100, 102, 98, 101, 99], 0.3);
    const withPause = robustEwma([100, 102, 98, 101, 99, 10_000], 0.3);
    expect(normal).not.toBeNull();
    expect(withPause).not.toBeNull();
    expect(Math.abs(withPause! - normal!)).toBeLessThan(10);
  });

  it("filters pauses, focus boundaries, repeats, throttling, and incorrect keys", () => {
    const observations: IkiObservation[] = [
      { ikiMs: 100, correct: true },
      { ikiMs: 120, correct: false },
      { ikiMs: 140, correct: true, repeated: true },
      { ikiMs: 160, correct: true, afterFocus: true },
      { ikiMs: 180, correct: true, afterPause: true },
      { ikiMs: 200, correct: true, longPause: true },
      { ikiMs: 220, correct: true, throttled: true },
      { ikiMs: 10, correct: true },
      { ikiMs: 4_000, correct: true },
      { ikiMs: null, correct: true }
    ];
    expect(filterValidIkis(observations)).toEqual([100]);
  });

  it("uses robust relative dispersion for consistency", () => {
    expect(rhythmConsistency([100, 100, 100])).toBe(1);
    expect(rhythmConsistency([100])).toBeNull();
    expect(rhythmConsistency([50, 100, 150])!).toBeLessThan(0.5);
  });
});

describe("combined metrics", () => {
  it("reports both accuracy definitions and sample evidence", () => {
    expect(
      calculateTypingMetrics({
        typedCharacters: 250,
        correctKeystrokes: 98,
        attemptedKeystrokes: 100,
        uncorrectedErrors: 1,
        durationMs: 60_000,
        targetText: "hello",
        submittedText: "hallo",
        ikiObservations: [
          { ikiMs: 100, correct: true },
          { ikiMs: 110, correct: true },
          { ikiMs: 120, correct: true },
          { ikiMs: 5_000, correct: true, longPause: true }
        ]
      })
    ).toMatchObject({
      rawWpm: 50,
      netWpm: 49,
      keystrokeAccuracy: 0.98,
      finalTextAccuracy: 0.8,
      medianIkiMs: 110,
      madIkiMs: 10,
      validIkiSamples: 3
    });
  });
});
