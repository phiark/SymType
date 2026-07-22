import { describe, expect, it } from "vitest";

import { createFeatureStats, updateFeatureStats, type FeatureStats } from "./feature-stats.js";
import {
  adjustDifficulty,
  allocateLessonPhases,
  calculateAdaptivePriority,
  createSeededRandom,
  forgettingBoost,
  generateMicroBlock,
  scheduleAdaptiveFeatures,
  scheduleKeybrLikeBaseline,
  scoreTextCandidate,
  type SchedulableFeature,
  type TextCandidate
} from "./training-engine.js";

function observedStats(
  id: string,
  kind: "character" | "bigram",
  outcomes: readonly { correct: boolean; ikiMs: number }[],
  startAt = 1_000
): FeatureStats {
  let stats = createFeatureStats(id, kind);
  outcomes.forEach((outcome, index) => {
    stats = updateFeatureStats(stats, {
      ...outcome,
      observedAtMs: startAt + index,
      eligibleForSpeed: true
    });
  });
  return stats;
}

describe("seeded randomness", () => {
  it("replays a seed exactly and separates different seeds", () => {
    const first = createSeededRandom("lesson-42");
    const replay = createSeededRandom("lesson-42");
    const other = createSeededRandom("lesson-43");
    const firstValues = Array.from({ length: 5 }, () => first.next());
    expect(Array.from({ length: 5 }, () => replay.next())).toEqual(firstValues);
    expect(Array.from({ length: 5 }, () => other.next())).not.toEqual(firstValues);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe("adaptive priority", () => {
  const base = {
    accuracy: 0.95,
    targetAccuracy: 0.97,
    ikiMs: 250,
    targetIkiMs: 200,
    sampleCount: 20,
    uncertainty: 0.2,
    hoursSincePractice: 24,
    transferValue: 0.5,
    userFocus: 0,
    recentExposure: 0,
    fatigue: 0,
    errorRecoverySlowdown: 0,
    totalSamplesAcrossCandidates: 100
  } as const;

  it("prioritizes a genuine accuracy/speed shortfall", () => {
    const normal = calculateAdaptivePriority(base);
    const weak = calculateAdaptivePriority({ ...base, accuracy: 0.7, ikiMs: 400 });
    expect(weak.priority).toBeGreaterThan(normal.priority);
    expect(weak.accuracyShortfall).toBe(1);
    expect(weak.speedShortfall).toBe(1);
  });

  it("does not multiply new evidence to zero", () => {
    const unknown = calculateAdaptivePriority({
      ...base,
      ikiMs: null,
      sampleCount: 0,
      uncertainty: 1,
      hoursSincePractice: null
    });
    expect(unknown.confidenceGate).toBe(0.45);
    expect(unknown.explorationBonus).toBeGreaterThan(0);
    expect(unknown.priority).toBeGreaterThan(0);
  });

  it("boosts forgotten/user-focus candidates and penalizes overuse/fatigue", () => {
    const focused = calculateAdaptivePriority({
      ...base,
      hoursSincePractice: 720,
      userFocus: 1,
      transferValue: 1
    });
    const overused = calculateAdaptivePriority({
      ...base,
      recentExposure: 1,
      fatigue: 1
    });
    expect(focused.priority).toBeGreaterThan(overused.priority);
    expect(forgettingBoost(720)).toBeGreaterThan(forgettingBoost(1));
  });

  it("rejects malformed normalized signals instead of propagating NaN", () => {
    expect(() => calculateAdaptivePriority({ ...base, fatigue: Number.NaN })).toThrow(
      /Invalid adaptive-priority input/
    );
    expect(() => calculateAdaptivePriority({ ...base, userFocus: 2 })).toThrow(
      /Invalid adaptive-priority input/
    );
  });
});

describe("adaptive and comparator scheduling", () => {
  const features: readonly SchedulableFeature[] = [
    {
      id: "char:c",
      kind: "character",
      stats: observedStats(
        "char:c",
        "character",
        Array.from({ length: 12 }, (_, index) => ({
          correct: index % 3 !== 0,
          ikiMs: 360
        }))
      ),
      targetIkiMs: 200
    },
    {
      id: "char:t",
      kind: "character",
      stats: observedStats(
        "char:t",
        "character",
        Array.from({ length: 20 }, () => ({ correct: true, ikiMs: 180 }))
      ),
      targetIkiMs: 200,
      recentExposure: 1
    },
    {
      id: "bigram:ct",
      kind: "bigram",
      stats: observedStats(
        "bigram:ct",
        "bigram",
        Array.from({ length: 12 }, (_, index) => ({
          correct: index % 4 !== 0,
          ikiMs: 480
        }))
      ),
      targetIkiMs: 220,
      transferValue: 1
    },
    {
      id: "char:q",
      kind: "character",
      stats: createFeatureStats("char:q", "character"),
      targetIkiMs: 200
    }
  ];

  it("is deterministic and can target a slow combination", () => {
    const first = scheduleAdaptiveFeatures(features, {
      seed: 7,
      nowMs: 86_400_000,
      count: 3
    });
    const replay = scheduleAdaptiveFeatures(features, {
      seed: 7,
      nowMs: 86_400_000,
      count: 3
    });
    expect(first.map(({ id }) => id)).toEqual(replay.map(({ id }) => id));
    expect(first.map(({ id }) => id)).toContain("bigram:ct");
    expect(first.every(({ explanation }) => explanation.length > 0)).toBe(true);
  });

  it("keeps the keybr-like comparator limited to single characters", () => {
    const baseline = scheduleKeybrLikeBaseline(features, { seed: "baseline", count: 4 });
    expect(baseline.map(({ id }) => id)).not.toContain("bigram:ct");
    expect(baseline).toHaveLength(3);
    expect(baseline.map(({ id }) => id)).toContain("char:q");
  });
});

describe("micro-block scoring and generation", () => {
  const candidates: readonly TextCandidate[] = [
    {
      id: "focus-ct",
      text: "act tact contact exact",
      features: ["bigram:ct", "char:c"],
      naturalness: 0.8,
      difficulty: 0.55,
      category: "english"
    },
    {
      id: "fluent",
      text: "the rain moves over the plain",
      features: ["char:t"],
      naturalness: 1,
      difficulty: 0.35,
      category: "english"
    },
    {
      id: "code",
      text: "const total = count + 1;",
      features: ["bigram:ct", "char:c"],
      naturalness: 0.65,
      difficulty: 0.7,
      category: "code"
    }
  ];

  it("rewards focus density more in blocked practice", () => {
    const focused = scoreTextCandidate(candidates[0]!, {
      phase: "blocked",
      focusFeatures: ["bigram:ct"],
      targetDifficulty: 0.55
    });
    const fluent = scoreTextCandidate(candidates[1]!, {
      phase: "blocked",
      focusFeatures: ["bigram:ct"],
      targetDifficulty: 0.55
    });
    expect(focused.focusDensity).toBeGreaterThan(fluent.focusDensity);
    expect(focused.score).toBeGreaterThan(fluent.score);
  });

  it.each(["warmup", "blocked", "interleave", "transfer", "fluency", "explore"] as const)(
    "creates a bounded, deterministic %s micro-block",
    (phase) => {
      const options = {
        seed: `phase:${phase}`,
        phase,
        focusFeatures: ["bigram:ct"],
        candidates,
        targetLength: 42
      } as const;
      const first = generateMicroBlock(options);
      const replay = generateMicroBlock(options);
      expect(first).toEqual(replay);
      expect(first.length).toBeGreaterThanOrEqual(20);
      expect(first.length).toBeLessThanOrEqual(60);
      expect(first.text.length).toBe(first.length);
      expect(first.explanation.length).toBeGreaterThan(0);
    }
  );

  it("honors content-category scope", () => {
    const block = generateMicroBlock({
      seed: 1,
      phase: "transfer",
      focusFeatures: ["char:c"],
      candidates,
      allowedCategories: ["code"],
      targetLength: 30
    });
    expect(new Set(block.candidateIds)).toEqual(new Set(["code"]));
  });

  it("exposes a scheduled bigram intact even when a fluent candidate ranks higher", () => {
    const block = generateMicroBlock({
      seed: "runtime-sequence",
      phase: "transfer",
      focusFeatures: ["bigram:ct"],
      candidates: [
        {
          id: "fluent",
          text: "the rain moves over the quiet plain",
          features: [],
          naturalness: 1,
          difficulty: 0.5
        },
        {
          id: "sequence",
          text: "ct calm practice ct steady rhythm",
          features: ["bigram:ct"],
          naturalness: 0.15,
          difficulty: 0.7
        }
      ],
      targetLength: 36
    });

    expect(block.text).toContain("ct");
    expect(block.text.startsWith("ct")).toBe(true);
    expect(block.focusFeatures).toEqual(["bigram:ct"]);
    expect(block.candidateIds[0]).toBe("sequence");
    expect(
      generateMicroBlock({
        seed: "runtime-sequence-label",
        phase: "blocked",
        focusFeatures: ["bigram:ct"],
        candidates: [
          {
            id: "sequence",
            text: "ct calm practice ct steady rhythm",
            features: ["bigram:ct"],
            naturalness: 0.15,
            difficulty: 0.7
          }
        ],
        targetLength: 30
      }).explanation
    ).toContain("c→t");
  });

  it("falls back safely and terminates with no eligible candidates", () => {
    const block = generateMicroBlock({
      seed: 99,
      phase: "explore",
      focusFeatures: ["char:x"],
      candidates: [],
      targetLength: 40
    });
    expect(block.length).toBe(40);
    expect(block.candidateIds).toEqual([]);
    expect(block.explanation).toMatch(/伪词/);
  });

  it("keeps phase allocations normalized and accuracy-sensitive", () => {
    const low = allocateLessonPhases(0.9, 5);
    const high = allocateLessonPhases(0.99, 5);
    expect(low.reduce((sum, item) => sum + item.fraction, 0)).toBeCloseTo(1);
    expect(high.reduce((sum, item) => sum + item.fraction, 0)).toBeCloseTo(1);
    expect(low.find(({ phase }) => phase === "blocked")?.fraction).toBeGreaterThan(
      high.find(({ phase }) => phase === "blocked")?.fraction ?? 0
    );
    expect(low.map(({ phase }) => phase)).toEqual([
      "warmup",
      "blocked",
      "interleave",
      "transfer",
      "fluency"
    ]);
  });

  it.each([5, 10])(
    "keeps the %d-minute low/mid/high phase mix inside the documented ranges",
    (durationMinutes) => {
      for (const accuracy of [0.9, 0.95, 0.99]) {
        const allocation = allocateLessonPhases(accuracy, durationMinutes);
        const fraction = (phase: (typeof allocation)[number]["phase"]) =>
          allocation.find((entry) => entry.phase === phase)?.fraction ?? 0;
        const comfort = fraction("warmup") + fraction("fluency");

        expect(allocation.reduce((sum, item) => sum + item.fraction, 0)).toBeCloseTo(1);
        expect(fraction("blocked")).toBeGreaterThanOrEqual(0.35);
        expect(fraction("blocked")).toBeLessThanOrEqual(0.5);
        expect(fraction("interleave")).toBeGreaterThanOrEqual(0.2);
        expect(fraction("interleave")).toBeLessThanOrEqual(0.3);
        expect(fraction("transfer")).toBeGreaterThanOrEqual(0.15);
        expect(fraction("transfer")).toBeLessThanOrEqual(0.25);
        expect(comfort).toBeGreaterThanOrEqual(0.1);
        expect(comfort).toBeLessThanOrEqual(0.2 + Number.EPSILON);
      }
    }
  );

  it("protects accuracy before increasing difficulty", () => {
    expect(adjustDifficulty(0.5, 0.9, 100, 0)).toMatchObject({
      difficulty: 0.42,
      direction: "decrease"
    });
    expect(adjustDifficulty(0.5, 0.98, 10, 0)).toMatchObject({
      difficulty: 0.5,
      direction: "hold"
    });
    expect(adjustDifficulty(0.5, 0.98, 40, 0)).toMatchObject({
      difficulty: 0.58,
      direction: "increase"
    });
    expect(adjustDifficulty(0.5, 0.99, 40, 0.8).direction).toBe("decrease");
  });
});
