import { describe, expect, it } from "vitest";

import {
  calculateTypingMetrics,
  generateMicroBlock,
  scheduleAdaptiveFeatures,
  type FeatureKind,
  type SchedulableFeature,
  type TextCandidate
} from "./index.js";

const round = (value: number): number => Number(value.toFixed(12));

interface FixedFeatureInput {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly accuracy: readonly [number, number];
  readonly timing: readonly [number | null, number, number | null, number];
  readonly signals: readonly [number, number, number, number, number];
}

function fixedFeature(input: FixedFeatureInput): SchedulableFeature {
  const [iki, samples, lastPracticedAtMs, targetIkiMs] = input.timing;
  const [transferValue, userFocus, recentExposure, fatigue, errorRecoverySlowdown] = input.signals;
  return {
    id: input.id,
    kind: input.kind,
    stats: {
      featureId: input.id,
      kind: input.kind,
      shortAccuracy: { alpha: input.accuracy[0], beta: input.accuracy[1] },
      longAccuracy: { alpha: 109, beta: 21 },
      shortIkiMs: iki,
      longIkiMs: iki,
      ikiMadMs: iki === null ? null : 40,
      sampleCount: samples,
      speedSampleCount: samples,
      lastPracticedAtMs,
      correctStreak: 0,
      recentOutcomes: [],
      recentIkisMs: [],
      algorithmVersion: 1
    },
    targetIkiMs,
    transferValue,
    userFocus,
    recentExposure,
    fatigue,
    errorRecoverySlowdown
  };
}

describe("V1 golden training outputs", () => {
  it("freezes one fixed-seed generated lesson block", () => {
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
    const block = generateMicroBlock({
      seed: "v1-lesson-golden",
      phase: "blocked",
      focusFeatures: ["bigram:ct", "char:c"],
      candidates,
      targetLength: 48,
      minimumLength: 20,
      maximumLength: 60,
      targetDifficulty: 0.55
    });
    expect({ ...block, score: round(block.score) }).toEqual({
      text: "act tact contact exact const total = count + 1;",
      phase: "blocked",
      focusFeatures: ["bigram:ct", "char:c"],
      candidateIds: ["focus-ct", "code", "fluent"],
      length: 47,
      score: 0.489130434783,
      explanation: "集中练习 c→t、c",
      seed: "v1-lesson-golden"
    });
  });

  it("freezes adaptive selection, priorities, and explanations", () => {
    const features = [
      fixedFeature({
        id: "char:c",
        kind: "character",
        accuracy: [14, 6],
        timing: [360, 20, 86_400_000, 200],
        signals: [0.7, 1, 0.1, 0.1, 0.3]
      }),
      fixedFeature({
        id: "bigram:ct",
        kind: "bigram",
        accuracy: [16, 4],
        timing: [480, 24, 0, 220],
        signals: [1, 0.4, 0.05, 0.1, 0.5]
      }),
      fixedFeature({
        id: "char:t",
        kind: "character",
        accuracy: [38, 2],
        timing: [180, 40, 169_200_000, 200],
        signals: [0.4, 0, 0.8, 0, 0]
      }),
      fixedFeature({
        id: "char:q",
        kind: "character",
        accuracy: [9, 1],
        timing: [null, 0, null, 200],
        signals: [0.4, 0, 0, 0, 0]
      })
    ];
    const keys = [
      "priority",
      "accuracyShortfall",
      "speedShortfall",
      "uncertainty",
      "confidenceGate",
      "forgettingBoost",
      "explorationBonus",
      "transferMultiplier",
      "focusMultiplier",
      "overusePenalty",
      "fatiguePenalty"
    ] as const;
    const actual = scheduleAdaptiveFeatures(features, {
      seed: "v1-adaptive-golden",
      nowMs: 172_800_000,
      count: 3,
      targetAccuracy: 0.97
    }).map(({ id, priority, explanation, breakdown }) =>
      [id, explanation, round(priority), ...keys.map((key) => round(breakdown[key]))].join("|")
    );
    expect(actual).toEqual([
      "char:c|短期准确率 70%，低于目标|1.206807446021|1.206807445061|1|0.8|0.8|0.818943856706|1.19775021196|0.091990178114|1.175|1.35|0.03|0.035",
      "bigram:ct|短期准确率 80%，低于目标|1.136433547164|1.136433546259|0.772727272727|1|0.698297248755|0.855021574036|1.289698824238|0.08431039088|1.25|1.14|0.015|0.035",
      "char:q|样本较少，安排探索复测|0.624694662135|0.624694661242|0.318181818182|0.35|0.723627226987|0.45|1.25|0.421551954401|1.1|1|0|0"
    ]);
  });
});

describe("V1 golden event-derived metrics", () => {
  it("freezes speed, accuracy, robust IKI, and excluded-event handling", () => {
    const result = calculateTypingMetrics({
      typedCharacters: 60,
      correctKeystrokes: 9,
      attemptedKeystrokes: 12,
      uncorrectedErrors: 2,
      durationMs: 30_000,
      targetText: "Pine 42!",
      submittedText: "Pine 4?!",
      ikiObservations: [
        { ikiMs: 100, correct: true },
        { ikiMs: 120, correct: true },
        { ikiMs: 140, correct: true },
        { ikiMs: 160, correct: true },
        { ikiMs: 300, correct: true },
        { ikiMs: 80, correct: false },
        { ikiMs: 90, correct: true, repeated: true },
        { ikiMs: 110, correct: true, afterFocus: true },
        { ikiMs: 130, correct: true, afterPause: true },
        { ikiMs: 150, correct: true, longPause: true },
        { ikiMs: 170, correct: true, throttled: true },
        { ikiMs: 4_000, correct: true },
        { ikiMs: null, correct: true }
      ]
    });
    expect({
      ...result,
      consistency: result.consistency === null ? null : round(result.consistency)
    }).toEqual({
      rawWpm: 24,
      netWpm: 20,
      keystrokeAccuracy: 0.75,
      finalTextAccuracy: 0.875,
      medianIkiMs: 140,
      madIkiMs: 20,
      consistency: 0.7882,
      validIkiSamples: 5
    });
  });
});
