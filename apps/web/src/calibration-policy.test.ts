import { describe, expect, it } from "vitest";

import {
  activeElapsedMs,
  CALIBRATION_DEFAULT_ACTIVE_MS,
  CALIBRATION_MAX_ACTIVE_MS,
  CALIBRATION_MIN_ACTIVE_MS,
  CALIBRATION_MIN_SAMPLES_PER_CATEGORY,
  calibrationCategoryForBlock,
  calibrationCompletionDecision,
  resolveCalibrationActiveMs
} from "./calibration-policy";

function samples(category: string, count = CALIBRATION_MIN_SAMPLES_PER_CATEGORY): string[] {
  return Array.from({ length: count }, () => `calibration-${category}`);
}

describe("calibration active-time policy", () => {
  it("clamps requested calibration time to the promised three-to-five-minute window", () => {
    expect(resolveCalibrationActiveMs(0.25)).toBe(CALIBRATION_MIN_ACTIVE_MS);
    expect(resolveCalibrationActiveMs(4)).toBe(CALIBRATION_DEFAULT_ACTIVE_MS);
    expect(resolveCalibrationActiveMs(20)).toBe(CALIBRATION_MAX_ACTIVE_MS);
    expect(resolveCalibrationActiveMs(Number.NaN)).toBe(CALIBRATION_DEFAULT_ACTIVE_MS);
  });

  it("subtracts paused time from the monotonic active clock", () => {
    expect(
      activeElapsedMs({
        startedAtMs: 1_000,
        nowMs: 181_000,
        pausedAtMs: 61_000,
        pausedTotalMs: 0,
        paused: true
      })
    ).toBe(60_000);
    expect(
      activeElapsedMs({
        startedAtMs: 1_000,
        nowMs: 241_000,
        pausedAtMs: 0,
        pausedTotalMs: 120_000,
        paused: false
      })
    ).toBe(120_000);
  });

  it("rotates selected categories without introducing skipped categories", () => {
    const selected = ["letters", "index", "symbols"];
    expect(
      Array.from({ length: 7 }, (_, index) => calibrationCategoryForBlock(selected, index))
    ).toEqual(["letters", "index", "symbols", "letters", "index", "symbols", "letters"]);
  });

  it("does not complete before the target even after every selected category has samples", () => {
    const decision = calibrationCompletionDecision({
      elapsedActiveMs: CALIBRATION_MIN_ACTIVE_MS - 1,
      targetActiveMs: CALIBRATION_MIN_ACTIVE_MS,
      selectedCategories: ["letters", "symbols"],
      contentModes: [...samples("letters"), ...samples("symbols")],
      atBlockBoundary: true
    });
    expect(decision).toMatchObject({
      shouldComplete: false,
      coverageComplete: true,
      remainingMs: 1,
      reason: "collecting"
    });
  });

  it("finishes at a block boundary after the target and can stop mid-block at five minutes", () => {
    const contentModes = [...samples("letters"), ...samples("symbols")];
    expect(
      calibrationCompletionDecision({
        elapsedActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
        targetActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
        selectedCategories: ["letters", "symbols"],
        contentModes,
        atBlockBoundary: false
      }).reason
    ).toBe("waiting-for-boundary");
    expect(
      calibrationCompletionDecision({
        elapsedActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
        targetActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
        selectedCategories: ["letters", "symbols"],
        contentModes,
        atBlockBoundary: true
      }).shouldComplete
    ).toBe(true);
    expect(
      calibrationCompletionDecision({
        elapsedActiveMs: CALIBRATION_MAX_ACTIVE_MS,
        targetActiveMs: CALIBRATION_MAX_ACTIVE_MS,
        selectedCategories: ["letters", "symbols"],
        contentModes,
        atBlockBoundary: false
      }).shouldComplete
    ).toBe(true);
  });

  it("keeps sampling after the target for coverage, but never exceeds the five-minute cap", () => {
    const beforeCap = calibrationCompletionDecision({
      elapsedActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
      targetActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
      selectedCategories: ["letters", "index", "symbols"],
      contentModes: [...samples("letters"), ...samples("symbols")],
      atBlockBoundary: true
    });
    expect(beforeCap.shouldComplete).toBe(false);
    expect(beforeCap.reason).toBe("needs-coverage");
    expect(beforeCap.sampleCounts).toEqual({
      letters: CALIBRATION_MIN_SAMPLES_PER_CATEGORY,
      index: 0,
      symbols: CALIBRATION_MIN_SAMPLES_PER_CATEGORY
    });

    const atCap = calibrationCompletionDecision({
      elapsedActiveMs: CALIBRATION_MAX_ACTIVE_MS,
      targetActiveMs: CALIBRATION_DEFAULT_ACTIVE_MS,
      selectedCategories: ["letters", "index", "symbols"],
      contentModes: [...samples("letters"), ...samples("symbols")],
      atBlockBoundary: false
    });
    expect(atCap.shouldComplete).toBe(true);
    expect(atCap.coverageComplete).toBe(false);
    expect(atCap.reason).toBe("complete");
  });
});
