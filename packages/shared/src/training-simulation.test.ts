import { describe, expect, it } from "vitest";

import {
  compareAdaptiveAndBaselineSimulation,
  diagnoseFeatureStarvation,
  diagnoseSelectionOscillation,
  diagnoseSingleOutlierRobustness,
  evaluateSimulationReplay,
  simulateSchedulerStrategy,
  type SchedulerSimulationOptions,
  type SimulatedUserFeature
} from "./training-simulation.js";

const scenarioFeatures: readonly SimulatedUserFeature[] = [
  {
    id: "char:c",
    kind: "character",
    initialAccuracy: 0.82,
    initialIkiMs: 350,
    targetIkiMs: 230,
    accuracyLearningRate: 0.02,
    speedLearningRate: 0.025
  },
  {
    id: "char:t",
    kind: "character",
    initialAccuracy: 0.94,
    initialIkiMs: 265,
    targetIkiMs: 220
  },
  {
    id: "char:n",
    kind: "character",
    initialAccuracy: 0.91,
    initialIkiMs: 285,
    targetIkiMs: 220
  },
  {
    id: "char:m",
    kind: "character",
    initialAccuracy: 0.9,
    initialIkiMs: 295,
    targetIkiMs: 225
  },
  {
    id: "bigram:ct",
    kind: "bigram",
    initialAccuracy: 0.78,
    initialIkiMs: 390,
    targetIkiMs: 245,
    transferValue: 1,
    accuracyLearningRate: 0.025
  },
  {
    id: "char:x-held-out",
    kind: "character",
    initialAccuracy: 0.88,
    initialIkiMs: 310,
    targetIkiMs: 230,
    eligibleForTraining: false,
    unseenTransfer: true
  },
  {
    id: "bigram:nm-held-out",
    kind: "bigram",
    initialAccuracy: 0.84,
    initialIkiMs: 340,
    targetIkiMs: 250,
    eligibleForTraining: false,
    unseenTransfer: true
  }
];

function scenario(overrides: Partial<SchedulerSimulationOptions> = {}): SchedulerSimulationOptions {
  return {
    seed: "sim-regression-17",
    features: scenarioFeatures,
    sessions: 14,
    roundsPerSession: 8,
    selectedFeaturesPerRound: 3,
    exposuresPerSelection: 4,
    maximumStarvationGapRounds: 30,
    mastery: {
      accuracy: 0.9,
      stableWpm: 25,
      minimumSamplesPerFeature: 10
    },
    masteryFeatureIds: ["char:c", "char:t", "char:n", "char:m"],
    ...overrides
  };
}

describe("deterministic scheduler simulation and replay", () => {
  it("replays the same seed byte-for-byte and changes with another seed", () => {
    const first = compareAdaptiveAndBaselineSimulation(scenario());
    const replay = compareAdaptiveAndBaselineSimulation(scenario());
    const other = compareAdaptiveAndBaselineSimulation(scenario({ seed: "sim-regression-18" }));

    expect(replay).toEqual(first);
    expect(other.adaptive.events).not.toEqual(first.adaptive.events);
    expect(first.adaptive.replay.eventCount).toBeGreaterThan(200);
    expect(first.baseline.replay.eventCount).toBeGreaterThan(200);
  });

  it("recomputes metrics from the immutable event replay", () => {
    const result = simulateSchedulerStrategy("adaptive", scenario({ sessions: 4 }));
    const replay = evaluateSimulationReplay(result.events, {
      eligibleFeatureIds: ["char:c", "char:t", "char:n", "char:m", "bigram:ct"],
      masteryFeatureIds: ["char:c", "char:t", "char:n", "char:m"],
      mastery: {
        accuracy: 0.9,
        stableWpm: 25,
        minimumSamplesPerFeature: 10
      },
      maximumStarvationGapRounds: 30
    });

    expect(replay).toEqual(result.replay);
    expect(replay.charactersPresented).toBeGreaterThanOrEqual(replay.correctCharacters);
    expect(replay.correctCharactersPerMinute).toBeGreaterThan(0);
    expect(replay.calibration.brierScore).toBeGreaterThanOrEqual(0);
    expect(replay.calibration.logLoss).toBeGreaterThanOrEqual(0);
    expect(replay.exposureChange.some((item) => item.exposures > 0)).toBe(true);
  });
});

describe("scheduler safety diagnostics", () => {
  it("detects feature starvation and verifies broad exposure in a long seeded run", () => {
    const missing = diagnoseFeatureStarvation(
      [["char:a"], ["char:a"], ["char:a"]],
      ["char:a", "char:b"],
      2
    );
    expect(missing.passed).toBe(false);
    expect(missing.starvedFeatureIds).toEqual(["char:b"]);

    const result = simulateSchedulerStrategy("adaptive", scenario());
    expect(result.replay.starvation.exposedFeatureCount).toBe(5);
    expect(result.replay.starvation.passed).toBe(true);
  });

  it("flags pathological A-B-A selection reversals without labelling ordinary rotation", () => {
    const pathological = diagnoseSelectionOscillation(
      [["char:a"], ["char:b"], ["char:a"], ["char:b"], ["char:a"]],
      ["char:a", "char:b"],
      0.2
    );
    expect(pathological.passed).toBe(false);
    expect(pathological.rapidReturnCount).toBeGreaterThan(0);

    const result = simulateSchedulerStrategy("adaptive", scenario());
    expect(result.replay.oscillation.passed).toBe(true);
    expect(result.replay.oscillation.rate).toBeLessThanOrEqual(0.35);
  });

  it("keeps one extreme eligible IKI from dominating the robust estimate", () => {
    const diagnostic = diagnoseSingleOutlierRobustness({
      "char:c": [240, 245, 238, 250, 242, 247, 241],
      "char:t": [210, 208, 212, 209, 211, 210]
    });
    expect(diagnostic.evaluatedFeatureCount).toBe(2);
    expect(diagnostic.passed).toBe(true);
    expect(diagnostic.maximumRelativeChange).toBeLessThan(0.15);
  });
});

describe("honest adaptive-versus-baseline report", () => {
  it("includes threshold, retention, transfer, calibration, and exposure scaffolding", () => {
    const report = compareAdaptiveAndBaselineSimulation(scenario());

    expect(report.evidenceStatus).toBe("仅可描述");
    expect(report.conclusion).toMatch(/不能证明.*学习优势|不能证明真实用户/);
    expect(report.adaptive.replay.threshold.reached).toBe(true);
    expect(report.adaptive.retention.map(({ delayHours }) => delayHours)).toEqual([24, 72, 168]);
    expect(report.adaptive.retention.every(({ modeled }) => modeled)).toBe(true);
    expect(report.adaptive.transfer.unseenFeatureCount).toBe(2);
    expect(report.adaptive.transfer.unseenMinusTrainedWpm).not.toBeNull();
    expect(report.deltaAdaptiveMinusBaseline).toHaveProperty("charactersToThreshold");
    expect(report.deltaAdaptiveMinusBaseline).toHaveProperty("retention72hWpm");
    expect(report.deltaAdaptiveMinusBaseline).toHaveProperty("brierScore");
    const bigramExposure = report.adaptive.replay.exposureChange.find(
      ({ featureId }) => featureId === "bigram:ct"
    );
    expect(bigramExposure?.exposures).toBeGreaterThan(0);
    expect(report.limitations.join(" ")).toMatch(/工程假设/);
    expect(report.limitations.join(" ")).toMatch(/不声称复刻 Keybr/);
  });

  it("returns the exact sparse-evidence state instead of inferring a winner", () => {
    const report = compareAdaptiveAndBaselineSimulation(
      scenario({ sessions: 2, roundsPerSession: 2, exposuresPerSelection: 2 })
    );
    expect(report.evidenceStatus).toBe("尚无结论");
    expect(report.conclusion).toMatch(/^尚无结论：/);
    expect(report).not.toHaveProperty("winner");
  });

  it("does not let comparator-only limitations masquerade as adaptive starvation", () => {
    const report = compareAdaptiveAndBaselineSimulation(scenario());
    expect(report.baseline.replay.starvation.eligibleFeatureCount).toBe(4);
    expect(
      report.baseline.replay.exposureChange.find(({ featureId }) => featureId === "bigram:ct")
    ).toBeUndefined();
    expect(report.adaptive.replay.starvation.eligibleFeatureCount).toBe(5);
  });
});

describe("simulation input contracts", () => {
  it("rejects duplicate, malformed, and comparator-ineligible scenarios", () => {
    expect(() =>
      simulateSchedulerStrategy("adaptive", {
        seed: 1,
        features: [scenarioFeatures[0]!, scenarioFeatures[0]!]
      })
    ).toThrow(/unique/);
    expect(() =>
      simulateSchedulerStrategy("adaptive", {
        seed: 1,
        features: [{ ...scenarioFeatures[0]!, initialAccuracy: 2 }]
      })
    ).toThrow(/initialAccuracy/);
    expect(() =>
      simulateSchedulerStrategy("keybr-like-baseline", {
        seed: 1,
        features: [scenarioFeatures[4]!]
      })
    ).toThrow(/no eligible/);
  });
});
