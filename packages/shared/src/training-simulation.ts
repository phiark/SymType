import {
  betaMean,
  conservativeStableIki,
  createFeatureStats,
  updateFeatureStats,
  type FeatureKind,
  type FeatureStats
} from "./feature-stats.js";
import { median, robustEwma } from "./metrics.js";
import {
  createSeededRandom,
  scheduleAdaptiveFeatures,
  scheduleKeybrLikeBaseline,
  type SchedulableFeature
} from "./training-engine.js";

export type SimulationStrategy = "adaptive" | "keybr-like-baseline";

export interface SimulatedUserFeature {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly initialAccuracy: number;
  readonly initialIkiMs: number;
  readonly targetIkiMs: number;
  readonly minimumIkiMs?: number;
  readonly accuracyLearningRate?: number;
  readonly speedLearningRate?: number;
  readonly accuracyForgettingPerDay?: number;
  readonly speedForgettingPerDay?: number;
  readonly transferValue?: number;
  /** Evaluation-only features are never offered to either scheduler. */
  readonly eligibleForTraining?: boolean;
  /** Evaluation-only features marked here form the held-out transfer set. */
  readonly unseenTransfer?: boolean;
  /** Defaults to the token length encoded by char:/bigram:/trigram:. */
  readonly charactersPerExposure?: number;
}

export interface SimulationMasteryThreshold {
  readonly accuracy: number;
  readonly stableWpm: number;
  readonly minimumSamplesPerFeature: number;
}

export interface SimulationEvidencePolicy {
  readonly minimumSessions: number;
  readonly minimumEventsPerStrategy: number;
  readonly minimumRetentionFeatures: number;
  readonly minimumTransferFeatures: number;
}

export interface SchedulerSimulationOptions {
  readonly seed: string | number;
  readonly features: readonly SimulatedUserFeature[];
  readonly sessions?: number;
  readonly roundsPerSession?: number;
  readonly selectedFeaturesPerRound?: number;
  readonly exposuresPerSelection?: number;
  readonly sessionSpacingHours?: number;
  readonly startAtMs?: number;
  readonly targetAccuracy?: number;
  readonly mastery?: SimulationMasteryThreshold;
  readonly masteryFeatureIds?: readonly string[];
  readonly evidencePolicy?: SimulationEvidencePolicy;
  readonly maximumStarvationGapRounds?: number;
  readonly maximumOscillationRate?: number;
  readonly outlierTolerance?: number;
}

export interface SimulationReplayEvent {
  readonly strategy: SimulationStrategy;
  readonly sessionIndex: number;
  readonly selectionRound: number;
  readonly featureId: string;
  readonly featureKind: FeatureKind;
  readonly observedAtMs: number;
  readonly predictedCorrectProbability: number;
  readonly correct: boolean;
  readonly ikiMs: number;
  readonly eligibleForSpeed: boolean;
  readonly characterCount: number;
  readonly targetIkiMs: number;
}

export interface FeatureStarvationDiagnostic {
  readonly passed: boolean;
  readonly eligibleFeatureCount: number;
  readonly exposedFeatureCount: number;
  readonly maximumAllowedGapRounds: number;
  readonly maximumGapRoundsByFeature: Readonly<Record<string, number>>;
  readonly starvedFeatureIds: readonly string[];
}

export interface SelectionOscillationDiagnostic {
  readonly status: "pass" | "fail" | "insufficient";
  readonly passed: boolean;
  readonly rapidReturnCount: number;
  readonly possibleRapidReturns: number;
  readonly rate: number;
  readonly maximumAllowedRate: number;
}

export interface SingleOutlierDiagnostic {
  readonly status: "pass" | "fail" | "insufficient";
  readonly passed: boolean;
  readonly evaluatedFeatureCount: number;
  readonly maximumRelativeChange: number | null;
  readonly maximumAllowedRelativeChange: number;
  readonly worstFeatureId: string | null;
}

export interface CalibrationMetrics {
  readonly sampleCount: number;
  readonly brierScore: number | null;
  readonly logLoss: number | null;
}

export interface ThresholdEfficiencyMetrics {
  readonly reached: boolean;
  readonly charactersPresented: number | null;
  readonly correctCharacters: number | null;
  readonly activeMinutes: number | null;
}

export interface FeatureExposureChange {
  readonly featureId: string;
  readonly exposures: number;
  readonly initialPredictedAccuracy: number | null;
  readonly finalPosteriorAccuracy: number;
  readonly posteriorAccuracyChange: number | null;
  readonly observedAccuracyChange: number | null;
}

export interface SimulationReplayEvaluation {
  readonly eventCount: number;
  readonly charactersPresented: number;
  readonly correctCharacters: number;
  readonly activeMinutes: number;
  readonly correctCharactersPerMinute: number | null;
  readonly threshold: ThresholdEfficiencyMetrics;
  readonly calibration: CalibrationMetrics;
  readonly exposureChange: readonly FeatureExposureChange[];
  readonly starvation: FeatureStarvationDiagnostic;
  readonly oscillation: SelectionOscillationDiagnostic;
  readonly outlierRobustness: SingleOutlierDiagnostic;
}

export interface ModeledRetentionMetric {
  readonly delayHours: 24 | 72 | 168;
  readonly modeled: true;
  readonly featureCount: number;
  readonly expectedAccuracy: number | null;
  readonly stableWpm: number | null;
}

export interface ModeledTransferMetric {
  readonly modeled: true;
  readonly trainedFeatureCount: number;
  readonly unseenFeatureCount: number;
  /** Held-out expected WPM minus trained expected WPM; negative means a transfer gap. */
  readonly unseenMinusTrainedWpm: number | null;
  readonly unseenMinusTrainedAccuracy: number | null;
}

export interface StrategySimulationResult {
  readonly strategy: SimulationStrategy;
  readonly seed: string;
  readonly sessions: number;
  readonly events: readonly SimulationReplayEvent[];
  readonly replay: SimulationReplayEvaluation;
  readonly retention: readonly ModeledRetentionMetric[];
  readonly transfer: ModeledTransferMetric;
}

export interface SimulationComparisonDelta {
  readonly correctCharactersPerMinute: number | null;
  readonly charactersToThreshold: number | null;
  readonly minutesToThreshold: number | null;
  readonly retention24hWpm: number | null;
  readonly retention72hWpm: number | null;
  readonly retention7dWpm: number | null;
  readonly unseenTransferGapWpm: number | null;
  readonly brierScore: number | null;
  readonly logLoss: number | null;
}

export interface AdaptiveBaselineSimulationReport {
  readonly seed: string;
  readonly adaptive: StrategySimulationResult;
  readonly baseline: StrategySimulationResult;
  readonly deltaAdaptiveMinusBaseline: SimulationComparisonDelta;
  readonly evidenceStatus: "尚无结论" | "仅可描述";
  readonly conclusion: string;
  readonly limitations: readonly string[];
}

interface LatentFeatureState {
  readonly definition: SimulatedUserFeature;
  accuracy: number;
  ikiMs: number;
}

const DEFAULT_MASTERY: SimulationMasteryThreshold = Object.freeze({
  accuracy: 0.95,
  stableWpm: 35,
  minimumSamplesPerFeature: 20
});

const DEFAULT_EVIDENCE_POLICY: SimulationEvidencePolicy = Object.freeze({
  minimumSessions: 14,
  minimumEventsPerStrategy: 200,
  minimumRetentionFeatures: 3,
  minimumTransferFeatures: 2
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nullableDifference(first: number | null, second: number | null): number | null {
  return first === null || second === null ? null : round(first - second);
}

function stableWpmFromIki(ikiMs: number | null): number | null {
  return ikiMs === null || ikiMs <= 0 ? null : 12_000 / ikiMs;
}

function tokenLength(feature: SimulatedUserFeature): number {
  if (feature.charactersPerExposure !== undefined) {
    return feature.charactersPerExposure;
  }
  const token = feature.id.replace(/^(char|bigram|trigram):/, "");
  if (feature.kind === "bigram") return Math.max(1, Array.from(token).length || 2);
  if (feature.kind === "trigram") return Math.max(1, Array.from(token).length || 3);
  return 1;
}

function assertUnitInterval(value: number, name: string, allowZero = true): void {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : Number.EPSILON) || value > 1) {
    throw new RangeError(`${name} must be in ${allowZero ? "[0, 1]" : "(0, 1]"}`);
  }
}

function validateFeature(feature: SimulatedUserFeature): void {
  if (feature.id.trim().length === 0) throw new Error("Simulation feature id cannot be empty");
  assertUnitInterval(feature.initialAccuracy, "initialAccuracy");
  if (!Number.isFinite(feature.initialIkiMs) || feature.initialIkiMs <= 0) {
    throw new RangeError("initialIkiMs must be positive");
  }
  if (!Number.isFinite(feature.targetIkiMs) || feature.targetIkiMs <= 0) {
    throw new RangeError("targetIkiMs must be positive");
  }
  if (
    feature.minimumIkiMs !== undefined &&
    (!Number.isFinite(feature.minimumIkiMs) ||
      feature.minimumIkiMs <= 0 ||
      feature.minimumIkiMs > feature.initialIkiMs)
  ) {
    throw new RangeError("minimumIkiMs must be positive and no slower than initialIkiMs");
  }
  for (const [name, value] of [
    ["accuracyLearningRate", feature.accuracyLearningRate],
    ["speedLearningRate", feature.speedLearningRate],
    ["accuracyForgettingPerDay", feature.accuracyForgettingPerDay],
    ["speedForgettingPerDay", feature.speedForgettingPerDay],
    ["transferValue", feature.transferValue]
  ] as const) {
    if (value !== undefined) assertUnitInterval(value, name);
  }
  if (
    feature.charactersPerExposure !== undefined &&
    (!Number.isInteger(feature.charactersPerExposure) || feature.charactersPerExposure < 1)
  ) {
    throw new RangeError("charactersPerExposure must be a positive integer");
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function normalizedOptions(options: SchedulerSimulationOptions): Required<
  Pick<
    SchedulerSimulationOptions,
    | "sessions"
    | "roundsPerSession"
    | "selectedFeaturesPerRound"
    | "exposuresPerSelection"
    | "sessionSpacingHours"
    | "startAtMs"
    | "targetAccuracy"
    | "maximumOscillationRate"
    | "outlierTolerance"
  >
> & {
  readonly mastery: SimulationMasteryThreshold;
  readonly evidencePolicy: SimulationEvidencePolicy;
} {
  const normalized = {
    sessions: options.sessions ?? 14,
    roundsPerSession: options.roundsPerSession ?? 8,
    selectedFeaturesPerRound: options.selectedFeaturesPerRound ?? 3,
    exposuresPerSelection: options.exposuresPerSelection ?? 4,
    sessionSpacingHours: options.sessionSpacingHours ?? 24,
    startAtMs: options.startAtMs ?? 1_700_000_000_000,
    targetAccuracy: options.targetAccuracy ?? 0.97,
    maximumOscillationRate: options.maximumOscillationRate ?? 0.35,
    outlierTolerance: options.outlierTolerance ?? 0.15,
    mastery: options.mastery ?? DEFAULT_MASTERY,
    evidencePolicy: options.evidencePolicy ?? DEFAULT_EVIDENCE_POLICY
  };
  validatePositiveInteger(normalized.sessions, "sessions");
  validatePositiveInteger(normalized.roundsPerSession, "roundsPerSession");
  validatePositiveInteger(normalized.selectedFeaturesPerRound, "selectedFeaturesPerRound");
  validatePositiveInteger(normalized.exposuresPerSelection, "exposuresPerSelection");
  if (!Number.isFinite(normalized.sessionSpacingHours) || normalized.sessionSpacingHours < 0) {
    throw new RangeError("sessionSpacingHours must be non-negative");
  }
  if (!Number.isFinite(normalized.startAtMs) || normalized.startAtMs < 0) {
    throw new RangeError("startAtMs must be non-negative");
  }
  assertUnitInterval(normalized.targetAccuracy, "targetAccuracy", false);
  assertUnitInterval(normalized.mastery.accuracy, "mastery accuracy", false);
  if (!Number.isFinite(normalized.mastery.stableWpm) || normalized.mastery.stableWpm <= 0) {
    throw new RangeError("mastery stableWpm must be positive");
  }
  validatePositiveInteger(
    normalized.mastery.minimumSamplesPerFeature,
    "mastery minimumSamplesPerFeature"
  );
  validatePositiveInteger(normalized.evidencePolicy.minimumSessions, "minimumSessions");
  validatePositiveInteger(
    normalized.evidencePolicy.minimumEventsPerStrategy,
    "minimumEventsPerStrategy"
  );
  validatePositiveInteger(
    normalized.evidencePolicy.minimumRetentionFeatures,
    "minimumRetentionFeatures"
  );
  validatePositiveInteger(
    normalized.evidencePolicy.minimumTransferFeatures,
    "minimumTransferFeatures"
  );
  assertUnitInterval(normalized.maximumOscillationRate, "maximumOscillationRate");
  assertUnitInterval(normalized.outlierTolerance, "outlierTolerance");
  return normalized;
}

function featureStatsForScheduler(
  features: readonly SimulatedUserFeature[],
  stats: ReadonlyMap<string, FeatureStats>,
  recentRounds: readonly (readonly string[])[]
): SchedulableFeature[] {
  const denominator = Math.max(1, recentRounds.length);
  return features
    .filter((feature) => feature.eligibleForTraining !== false)
    .map((feature) => ({
      id: feature.id,
      kind: feature.kind,
      stats: stats.get(feature.id) ?? createFeatureStats(feature.id, feature.kind),
      targetIkiMs: feature.targetIkiMs,
      transferValue: feature.transferValue ?? 0.5,
      recentExposure:
        recentRounds.filter((round) => round.includes(feature.id)).length / denominator
    }));
}

function strategyEligibleIds(
  strategy: SimulationStrategy,
  features: readonly SimulatedUserFeature[]
): string[] {
  return features
    .filter(
      (feature) =>
        feature.eligibleForTraining !== false &&
        (strategy === "adaptive" ||
          feature.kind === "character" ||
          feature.kind === "shifted-character")
    )
    .map((feature) => feature.id);
}

export function diagnoseFeatureStarvation(
  selectionHistory: readonly (readonly string[])[],
  eligibleFeatureIds: readonly string[],
  maximumAllowedGapRounds = Math.max(4, Math.ceil(selectionHistory.length / 2))
): FeatureStarvationDiagnostic {
  if (!Number.isInteger(maximumAllowedGapRounds) || maximumAllowedGapRounds < 0) {
    throw new RangeError("maximumAllowedGapRounds must be a non-negative integer");
  }
  const uniqueIds = [...new Set(eligibleFeatureIds)].sort();
  const maximumGapRoundsByFeature: Record<string, number> = {};
  const starvedFeatureIds: string[] = [];
  let exposedFeatureCount = 0;
  for (const featureId of uniqueIds) {
    const selectedRounds = selectionHistory.flatMap((round, index) =>
      round.includes(featureId) ? [index] : []
    );
    if (selectedRounds.length > 0) exposedFeatureCount += 1;
    let maximumGap =
      selectedRounds.length === 0 ? selectionHistory.length : (selectedRounds[0] ?? 0);
    for (let index = 1; index < selectedRounds.length; index += 1) {
      maximumGap = Math.max(
        maximumGap,
        (selectedRounds[index] ?? 0) - (selectedRounds[index - 1] ?? 0) - 1
      );
    }
    if (selectedRounds.length > 0) {
      maximumGap = Math.max(maximumGap, selectionHistory.length - 1 - (selectedRounds.at(-1) ?? 0));
    }
    maximumGapRoundsByFeature[featureId] = maximumGap;
    if (selectedRounds.length === 0 || maximumGap > maximumAllowedGapRounds) {
      starvedFeatureIds.push(featureId);
    }
  }
  return {
    passed: starvedFeatureIds.length === 0,
    eligibleFeatureCount: uniqueIds.length,
    exposedFeatureCount,
    maximumAllowedGapRounds,
    maximumGapRoundsByFeature,
    starvedFeatureIds
  };
}

export function diagnoseSelectionOscillation(
  selectionHistory: readonly (readonly string[])[],
  eligibleFeatureIds: readonly string[],
  maximumAllowedRate = 0.35
): SelectionOscillationDiagnostic {
  assertUnitInterval(maximumAllowedRate, "maximumAllowedRate");
  const uniqueIds = [...new Set(eligibleFeatureIds)];
  let rapidReturnCount = 0;
  const possibleRapidReturns = uniqueIds.length * Math.max(0, selectionHistory.length - 2);
  for (const featureId of uniqueIds) {
    for (let index = 0; index + 2 < selectionHistory.length; index += 1) {
      if (
        selectionHistory[index]?.includes(featureId) === true &&
        selectionHistory[index + 1]?.includes(featureId) === false &&
        selectionHistory[index + 2]?.includes(featureId) === true
      ) {
        rapidReturnCount += 1;
      }
    }
  }
  const rate = possibleRapidReturns === 0 ? 0 : rapidReturnCount / possibleRapidReturns;
  const status =
    possibleRapidReturns === 0 ? "insufficient" : rate <= maximumAllowedRate ? "pass" : "fail";
  return {
    status,
    passed: status === "pass",
    rapidReturnCount,
    possibleRapidReturns,
    rate: round(rate),
    maximumAllowedRate
  };
}

export function diagnoseSingleOutlierRobustness(
  ikiSamplesByFeature: Readonly<Record<string, readonly number[]>>,
  maximumAllowedRelativeChange = 0.15,
  outlierFactor = 25
): SingleOutlierDiagnostic {
  assertUnitInterval(maximumAllowedRelativeChange, "maximumAllowedRelativeChange");
  if (!Number.isFinite(outlierFactor) || outlierFactor <= 1) {
    throw new RangeError("outlierFactor must be greater than one");
  }
  let evaluatedFeatureCount = 0;
  let maximumRelativeChange: number | null = null;
  let worstFeatureId: string | null = null;
  for (const [featureId, samples] of Object.entries(ikiSamplesByFeature).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const finite = samples.filter((value) => Number.isFinite(value) && value > 0);
    if (finite.length < 5) continue;
    const center = median(finite);
    const baseline = robustEwma(finite, 0.2);
    const withOutlier = robustEwma([...finite, center * outlierFactor], 0.2);
    if (baseline === null || withOutlier === null || baseline <= 0) continue;
    evaluatedFeatureCount += 1;
    const relativeChange = Math.abs(withOutlier - baseline) / baseline;
    if (maximumRelativeChange === null || relativeChange > maximumRelativeChange) {
      maximumRelativeChange = relativeChange;
      worstFeatureId = featureId;
    }
  }
  return {
    status:
      evaluatedFeatureCount === 0 || maximumRelativeChange === null
        ? "insufficient"
        : maximumRelativeChange <= maximumAllowedRelativeChange
          ? "pass"
          : "fail",
    passed:
      evaluatedFeatureCount > 0 &&
      maximumRelativeChange !== null &&
      maximumRelativeChange <= maximumAllowedRelativeChange,
    evaluatedFeatureCount,
    maximumRelativeChange: maximumRelativeChange === null ? null : round(maximumRelativeChange),
    maximumAllowedRelativeChange,
    worstFeatureId
  };
}

function reachedMastery(
  stats: ReadonlyMap<string, FeatureStats>,
  masteryFeatureIds: readonly string[],
  threshold: SimulationMasteryThreshold
): boolean {
  if (masteryFeatureIds.length === 0) return false;
  return masteryFeatureIds.every((featureId) => {
    const feature = stats.get(featureId);
    if (feature === undefined || feature.sampleCount < threshold.minimumSamplesPerFeature) {
      return false;
    }
    const stableWpm = stableWpmFromIki(conservativeStableIki(feature));
    return (
      betaMean(feature.longAccuracy) >= threshold.accuracy &&
      stableWpm !== null &&
      stableWpm >= threshold.stableWpm
    );
  });
}

export function evaluateSimulationReplay(
  events: readonly SimulationReplayEvent[],
  options: {
    readonly eligibleFeatureIds: readonly string[];
    readonly masteryFeatureIds: readonly string[];
    readonly mastery?: SimulationMasteryThreshold;
    readonly maximumStarvationGapRounds?: number;
    readonly maximumOscillationRate?: number;
    readonly outlierTolerance?: number;
  }
): SimulationReplayEvaluation {
  const mastery = options.mastery ?? DEFAULT_MASTERY;
  // Recorded order is authoritative. Re-sorting equal/overlapping timestamps
  // could change a valid replay when sessions intentionally have no spacing.
  const ordered = [...events];
  const stats = new Map<string, FeatureStats>();
  const outcomes = new Map<string, boolean[]>();
  const predictions = new Map<string, number>();
  const ikiSamples: Record<string, number[]> = {};
  const selectionByRound = new Map<number, Set<string>>();
  let charactersPresented = 0;
  let correctCharacters = 0;
  let activeMs = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  let threshold: ThresholdEfficiencyMetrics = {
    reached: false,
    charactersPresented: null,
    correctCharacters: null,
    activeMinutes: null
  };

  for (const event of ordered) {
    if (
      !Number.isFinite(event.predictedCorrectProbability) ||
      event.predictedCorrectProbability < 0 ||
      event.predictedCorrectProbability > 1 ||
      !Number.isFinite(event.ikiMs) ||
      event.ikiMs <= 0 ||
      !Number.isInteger(event.characterCount) ||
      event.characterCount < 1
    ) {
      throw new RangeError("Replay event contains invalid probability, timing, or character count");
    }
    const probability = clamp(event.predictedCorrectProbability, 1e-6, 1 - 1e-6);
    const outcome = event.correct ? 1 : 0;
    brierTotal += (probability - outcome) ** 2;
    logLossTotal -= outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability);
    if (!predictions.has(event.featureId)) {
      predictions.set(event.featureId, event.predictedCorrectProbability);
    }
    const current =
      stats.get(event.featureId) ?? createFeatureStats(event.featureId, event.featureKind);
    const updated = updateFeatureStats(current, {
      correct: event.correct,
      ikiMs: event.ikiMs,
      observedAtMs: event.observedAtMs,
      eligibleForSpeed: event.eligibleForSpeed
    });
    stats.set(event.featureId, updated);
    outcomes.set(event.featureId, [...(outcomes.get(event.featureId) ?? []), event.correct]);
    if (event.eligibleForSpeed) {
      ikiSamples[event.featureId] = [...(ikiSamples[event.featureId] ?? []), event.ikiMs];
    }
    const selected = selectionByRound.get(event.selectionRound) ?? new Set<string>();
    selected.add(event.featureId);
    selectionByRound.set(event.selectionRound, selected);
    charactersPresented += event.characterCount;
    if (event.correct) correctCharacters += event.characterCount;
    activeMs += event.ikiMs * event.characterCount;
    if (!threshold.reached && reachedMastery(stats, options.masteryFeatureIds, mastery)) {
      threshold = {
        reached: true,
        charactersPresented,
        correctCharacters,
        activeMinutes: round(activeMs / 60_000)
      };
    }
  }

  const highestRound = Math.max(-1, ...selectionByRound.keys());
  const selectionHistory = Array.from({ length: highestRound + 1 }, (_, index) => [
    ...(selectionByRound.get(index) ?? [])
  ]);
  const maximumGap =
    options.maximumStarvationGapRounds ?? Math.max(4, Math.ceil(selectionHistory.length / 2));
  const exposureChange = [...new Set([...options.eligibleFeatureIds, ...stats.keys()])]
    .sort()
    .map((featureId): FeatureExposureChange => {
      const feature = stats.get(featureId);
      const featureOutcomes = outcomes.get(featureId) ?? [];
      const windowSize = Math.min(20, Math.floor(featureOutcomes.length / 2));
      const observedAccuracyChange =
        windowSize < 5
          ? null
          : featureOutcomes.slice(-windowSize).filter(Boolean).length / windowSize -
            featureOutcomes.slice(0, windowSize).filter(Boolean).length / windowSize;
      const initial = predictions.get(featureId) ?? null;
      const finalAccuracy = betaMean(
        feature?.longAccuracy ?? createFeatureStats(featureId, "character").longAccuracy
      );
      return {
        featureId,
        exposures: feature?.sampleCount ?? 0,
        initialPredictedAccuracy: initial,
        finalPosteriorAccuracy: round(finalAccuracy),
        posteriorAccuracyChange: initial === null ? null : round(finalAccuracy - initial),
        observedAccuracyChange:
          observedAccuracyChange === null ? null : round(observedAccuracyChange)
      };
    });

  return {
    eventCount: ordered.length,
    charactersPresented,
    correctCharacters,
    activeMinutes: round(activeMs / 60_000),
    correctCharactersPerMinute:
      activeMs <= 0 ? null : round(correctCharacters / (activeMs / 60_000)),
    threshold,
    calibration: {
      sampleCount: ordered.length,
      brierScore: ordered.length === 0 ? null : round(brierTotal / ordered.length),
      logLoss: ordered.length === 0 ? null : round(logLossTotal / ordered.length)
    },
    exposureChange,
    starvation: diagnoseFeatureStarvation(selectionHistory, options.eligibleFeatureIds, maximumGap),
    oscillation: diagnoseSelectionOscillation(
      selectionHistory,
      options.eligibleFeatureIds,
      options.maximumOscillationRate ?? 0.35
    ),
    outlierRobustness: diagnoseSingleOutlierRobustness(ikiSamples, options.outlierTolerance ?? 0.15)
  };
}

function applyForgetting(state: LatentFeatureState, elapsedHours: number): void {
  const elapsedDays = elapsedHours / 24;
  const accuracyRate = state.definition.accuracyForgettingPerDay ?? 0.004;
  const speedRate = state.definition.speedForgettingPerDay ?? 0.006;
  // The 0.72 floor is an explicit simulated-user assumption, not a biological claim.
  state.accuracy = 0.72 + (state.accuracy - 0.72) * Math.exp(-accuracyRate * elapsedDays);
  state.ikiMs *= Math.exp(speedRate * elapsedDays);
}

function projectedLatent(
  state: LatentFeatureState,
  delayHours: number
): { accuracy: number; ikiMs: number } {
  const copy: LatentFeatureState = {
    definition: state.definition,
    accuracy: state.accuracy,
    ikiMs: state.ikiMs
  };
  applyForgetting(copy, delayHours);
  return { accuracy: copy.accuracy, ikiMs: copy.ikiMs };
}

function modeledRetention(
  states: ReadonlyMap<string, LatentFeatureState>,
  masteryFeatureIds: readonly string[]
): ModeledRetentionMetric[] {
  return ([24, 72, 168] as const).map((delayHours) => {
    const projections = masteryFeatureIds.flatMap((featureId) => {
      const state = states.get(featureId);
      return state === undefined ? [] : [projectedLatent(state, delayHours)];
    });
    return {
      delayHours,
      modeled: true,
      featureCount: projections.length,
      expectedAccuracy:
        projections.length === 0
          ? null
          : round(
              projections.reduce((sum, projection) => sum + projection.accuracy, 0) /
                projections.length
            ),
      stableWpm:
        projections.length === 0
          ? null
          : round(
              projections.reduce(
                (sum, projection) => sum + (stableWpmFromIki(projection.ikiMs) ?? 0),
                0
              ) / projections.length
            )
    };
  });
}

function modeledTransfer(states: ReadonlyMap<string, LatentFeatureState>): ModeledTransferMetric {
  const trained = [...states.values()].filter(
    (state) => state.definition.eligibleForTraining !== false
  );
  const unseen = [...states.values()].filter((state) => state.definition.unseenTransfer === true);
  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const trainedWpm = mean(trained.map((state) => stableWpmFromIki(state.ikiMs) ?? 0));
  const unseenWpm = mean(unseen.map((state) => stableWpmFromIki(state.ikiMs) ?? 0));
  const trainedAccuracy = mean(trained.map((state) => state.accuracy));
  const unseenAccuracy = mean(unseen.map((state) => state.accuracy));
  return {
    modeled: true,
    trainedFeatureCount: trained.length,
    unseenFeatureCount: unseen.length,
    unseenMinusTrainedWpm:
      trainedWpm === null || unseenWpm === null ? null : round(unseenWpm - trainedWpm),
    unseenMinusTrainedAccuracy:
      trainedAccuracy === null || unseenAccuracy === null
        ? null
        : round(unseenAccuracy - trainedAccuracy)
  };
}

export function simulateSchedulerStrategy(
  strategy: SimulationStrategy,
  options: SchedulerSimulationOptions
): StrategySimulationResult {
  if (options.features.length === 0) throw new Error("Simulation requires at least one feature");
  options.features.forEach(validateFeature);
  if (new Set(options.features.map(({ id }) => id)).size !== options.features.length) {
    throw new Error("Simulation feature ids must be unique");
  }
  const normalized = normalizedOptions(options);
  const trainingFeatures = options.features.filter(
    (feature) => feature.eligibleForTraining !== false
  );
  const eligibleIds = strategyEligibleIds(strategy, options.features);
  if (eligibleIds.length === 0) {
    throw new Error(`${strategy} has no eligible training features`);
  }
  const requestedMasteryIds =
    options.masteryFeatureIds === undefined ? eligibleIds : [...options.masteryFeatureIds];
  const masteryFeatureIds = requestedMasteryIds.filter((id) => eligibleIds.includes(id));
  if (masteryFeatureIds.length !== requestedMasteryIds.length) {
    throw new Error("masteryFeatureIds must be eligible for the selected strategy");
  }

  const random = createSeededRandom(`${String(options.seed)}:${strategy}:outcomes`);
  const latent = new Map<string, LatentFeatureState>(
    options.features.map((feature) => [
      feature.id,
      { definition: feature, accuracy: feature.initialAccuracy, ikiMs: feature.initialIkiMs }
    ])
  );
  const stats = new Map<string, FeatureStats>(
    trainingFeatures.map((feature) => [feature.id, createFeatureStats(feature.id, feature.kind)])
  );
  const events: SimulationReplayEvent[] = [];
  const recentRounds: string[][] = [];
  let activeWithinSessionMs = 0;
  let selectionRound = 0;

  for (let sessionIndex = 0; sessionIndex < normalized.sessions; sessionIndex += 1) {
    if (sessionIndex > 0) {
      for (const state of latent.values()) applyForgetting(state, normalized.sessionSpacingHours);
    }
    activeWithinSessionMs = 0;
    for (let roundIndex = 0; roundIndex < normalized.roundsPerSession; roundIndex += 1) {
      const candidates = featureStatsForScheduler(trainingFeatures, stats, recentRounds);
      const schedulerOptions = {
        seed: `${String(options.seed)}:${strategy}:${sessionIndex}:${roundIndex}`,
        count: normalized.selectedFeaturesPerRound,
        targetAccuracy: normalized.targetAccuracy
      };
      const selected =
        strategy === "adaptive"
          ? scheduleAdaptiveFeatures(candidates, {
              ...schedulerOptions,
              nowMs:
                normalized.startAtMs +
                sessionIndex * normalized.sessionSpacingHours * 3_600_000 +
                activeWithinSessionMs
            })
          : scheduleKeybrLikeBaseline(candidates, schedulerOptions);
      const selectedIds = selected.map(({ id }) => id);
      recentRounds.push(selectedIds);
      if (recentRounds.length > 8) recentRounds.shift();

      for (const selectedFeature of selected) {
        const state = latent.get(selectedFeature.id);
        if (state === undefined) continue;
        for (let exposure = 0; exposure < normalized.exposuresPerSelection; exposure += 1) {
          const current = stats.get(state.definition.id);
          if (current === undefined) continue;
          const predictedCorrectProbability = betaMean(current.shortAccuracy);
          const correct = random.next() < state.accuracy;
          const jitter = 0.88 + random.next() * 0.24;
          const ikiMs = state.ikiMs * jitter * (correct ? 1 : 1.08);
          const characterCount = tokenLength(state.definition);
          const observedAtMs =
            normalized.startAtMs +
            sessionIndex * normalized.sessionSpacingHours * 3_600_000 +
            activeWithinSessionMs;
          events.push({
            strategy,
            sessionIndex,
            selectionRound,
            featureId: state.definition.id,
            featureKind: state.definition.kind,
            observedAtMs,
            predictedCorrectProbability,
            correct,
            ikiMs,
            eligibleForSpeed: correct,
            characterCount,
            targetIkiMs: state.definition.targetIkiMs
          });
          stats.set(
            state.definition.id,
            updateFeatureStats(current, {
              correct,
              ikiMs,
              observedAtMs,
              eligibleForSpeed: correct
            })
          );
          const accuracyRate = state.definition.accuracyLearningRate ?? 0.012;
          const speedRate = state.definition.speedLearningRate ?? 0.015;
          const minimumIkiMs = state.definition.minimumIkiMs ?? state.definition.targetIkiMs * 0.82;
          state.accuracy = clamp(
            state.accuracy + accuracyRate * (0.995 - state.accuracy) * (correct ? 1 : 0.55),
            0,
            0.995
          );
          if (correct) {
            state.ikiMs = Math.max(
              minimumIkiMs,
              state.ikiMs + speedRate * (minimumIkiMs - state.ikiMs)
            );
          }
          activeWithinSessionMs += ikiMs * characterCount;
        }
      }
      selectionRound += 1;
    }
  }

  const replay = evaluateSimulationReplay(events, {
    eligibleFeatureIds: eligibleIds,
    masteryFeatureIds,
    mastery: normalized.mastery,
    ...(options.maximumStarvationGapRounds === undefined
      ? {}
      : { maximumStarvationGapRounds: options.maximumStarvationGapRounds }),
    maximumOscillationRate: normalized.maximumOscillationRate,
    outlierTolerance: normalized.outlierTolerance
  });
  return {
    strategy,
    seed: String(options.seed),
    sessions: normalized.sessions,
    events,
    replay,
    retention: modeledRetention(latent, masteryFeatureIds),
    transfer: modeledTransfer(latent)
  };
}

function retentionWpm(result: StrategySimulationResult, delayHours: 24 | 72 | 168): number | null {
  return result.retention.find((item) => item.delayHours === delayHours)?.stableWpm ?? null;
}

function comparisonEvidenceIsSufficient(
  adaptive: StrategySimulationResult,
  baseline: StrategySimulationResult,
  policy: SimulationEvidencePolicy
): boolean {
  return (
    adaptive.sessions >= policy.minimumSessions &&
    baseline.sessions >= policy.minimumSessions &&
    adaptive.replay.eventCount >= policy.minimumEventsPerStrategy &&
    baseline.replay.eventCount >= policy.minimumEventsPerStrategy &&
    adaptive.retention.every((metric) => metric.featureCount >= policy.minimumRetentionFeatures) &&
    baseline.retention.every((metric) => metric.featureCount >= policy.minimumRetentionFeatures) &&
    adaptive.transfer.unseenFeatureCount >= policy.minimumTransferFeatures &&
    baseline.transfer.unseenFeatureCount >= policy.minimumTransferFeatures
  );
}

export function compareAdaptiveAndBaselineSimulation(
  options: SchedulerSimulationOptions
): AdaptiveBaselineSimulationReport {
  const normalized = normalizedOptions(options);
  const adaptive = simulateSchedulerStrategy("adaptive", options);
  const baseline = simulateSchedulerStrategy("keybr-like-baseline", options);
  const sufficient = comparisonEvidenceIsSufficient(adaptive, baseline, normalized.evidencePolicy);
  return {
    seed: String(options.seed),
    adaptive,
    baseline,
    deltaAdaptiveMinusBaseline: {
      correctCharactersPerMinute: nullableDifference(
        adaptive.replay.correctCharactersPerMinute,
        baseline.replay.correctCharactersPerMinute
      ),
      charactersToThreshold: nullableDifference(
        adaptive.replay.threshold.charactersPresented,
        baseline.replay.threshold.charactersPresented
      ),
      minutesToThreshold: nullableDifference(
        adaptive.replay.threshold.activeMinutes,
        baseline.replay.threshold.activeMinutes
      ),
      retention24hWpm: nullableDifference(retentionWpm(adaptive, 24), retentionWpm(baseline, 24)),
      retention72hWpm: nullableDifference(retentionWpm(adaptive, 72), retentionWpm(baseline, 72)),
      retention7dWpm: nullableDifference(retentionWpm(adaptive, 168), retentionWpm(baseline, 168)),
      unseenTransferGapWpm: nullableDifference(
        adaptive.transfer.unseenMinusTrainedWpm,
        baseline.transfer.unseenMinusTrainedWpm
      ),
      brierScore: nullableDifference(
        adaptive.replay.calibration.brierScore,
        baseline.replay.calibration.brierScore
      ),
      logLoss: nullableDifference(
        adaptive.replay.calibration.logLoss,
        baseline.replay.calibration.logLoss
      )
    },
    evidenceStatus: sufficient ? "仅可描述" : "尚无结论",
    conclusion: sufficient
      ? "仅可描述：结果来自已声明参数的离线模拟，可用于发现调度缺陷，但不能证明真实用户学习优势或统计显著性。"
      : "尚无结论：模拟轮次、事件量、保留特征或未见迁移特征未达到预设证据门槛。",
    limitations: [
      "模拟用户的学习率、遗忘率和节奏分布是工程假设，不是神经或动作学习诊断。",
      "24h、72h 与 7 天保留以及未见文本迁移是模型投影，必须由真实延迟复测验证。",
      "本地 keybr-like baseline 只比较单字符弱项加权，不声称复刻 Keybr 的当前或私有算法。",
      "描述性差值不等于因果效果，也不构成对真实用户更快学习的承诺。"
    ]
  };
}
