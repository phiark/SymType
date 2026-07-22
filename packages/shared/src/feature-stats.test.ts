import { describe, expect, it } from "vitest";

import {
  approximateBetaInterval,
  betaMean,
  betaVariance,
  conservativeStableIki,
  createFeatureStats,
  updateBeta,
  updateFeatureStats
} from "./feature-stats.js";

describe("Beta accuracy posterior", () => {
  it("starts with a gentle accuracy prior and updates evidence", () => {
    const posterior = updateBeta({ alpha: 9, beta: 1 }, 8, 2);
    expect(posterior).toEqual({ alpha: 17, beta: 3 });
    expect(betaMean(posterior)).toBe(0.85);
  });

  it("reduces uncertainty as sample evidence grows", () => {
    expect(betaVariance({ alpha: 90, beta: 10 })).toBeLessThan(betaVariance({ alpha: 9, beta: 1 }));
    const [low, high] = approximateBetaInterval({ alpha: 90, beta: 10 });
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeLessThan(high);
  });

  it("rejects malformed evidence", () => {
    expect(() => updateBeta({ alpha: 1, beta: 1 }, -1, 0)).toThrow();
    expect(() => betaMean({ alpha: 0, beta: 1 })).toThrow();
  });
});

describe("feature rolling and long-term estimates", () => {
  it("maintains separate short and long outcomes, streak, and robust speed evidence", () => {
    let stats = createFeatureStats("char:c", "character", 3);
    const observations = [100, 110, 120, 115, 105, 5_000];
    for (const [index, ikiMs] of observations.entries()) {
      stats = updateFeatureStats(stats, {
        correct: true,
        ikiMs,
        observedAtMs: 1_000 + index,
        eligibleForSpeed: ikiMs < 3_000
      });
    }
    stats = updateFeatureStats(stats, {
      correct: false,
      ikiMs: 90,
      observedAtMs: 2_000,
      eligibleForSpeed: false
    });
    expect(stats.sampleCount).toBe(7);
    expect(stats.speedSampleCount).toBe(5);
    expect(stats.correctStreak).toBe(0);
    expect(stats.shortIkiMs).toBeGreaterThan(100);
    expect(stats.shortIkiMs).toBeLessThan(120);
    expect(stats.algorithmVersion).toBe(3);
    expect(conservativeStableIki(stats)).not.toBeNull();
  });

  it("bounds recent windows", () => {
    let stats = createFeatureStats("bigram:ct", "bigram");
    for (let index = 0; index < 80; index += 1) {
      stats = updateFeatureStats(stats, {
        correct: index % 4 !== 0,
        ikiMs: 100 + index,
        observedAtMs: index,
        eligibleForSpeed: true
      });
    }
    expect(stats.recentOutcomes).toHaveLength(30);
    expect(stats.recentIkisMs).toHaveLength(50);
    expect(stats.longAccuracy.alpha + stats.longAccuracy.beta).toBe(90);
  });

  it("does not allow an ineligible pause into speed estimates", () => {
    const initial = createFeatureStats("char:a", "character");
    const updated = updateFeatureStats(initial, {
      correct: true,
      ikiMs: 9_000,
      observedAtMs: 100,
      eligibleForSpeed: false
    });
    expect(updated.shortIkiMs).toBeNull();
    expect(updated.speedSampleCount).toBe(0);
  });

  it("rejects invalid model versions and update parameters", () => {
    expect(() => createFeatureStats("char:a", "character", 0)).toThrow(/positive integer/);
    expect(() =>
      updateFeatureStats(
        createFeatureStats("char:a", "character"),
        {
          correct: true,
          ikiMs: 100,
          observedAtMs: 100,
          eligibleForSpeed: true
        },
        { shortWindow: 10, speedWindow: 10, shortAlpha: 2, longAlpha: 0.1 }
      )
    ).toThrow(/EWMA alphas/);
  });
});
