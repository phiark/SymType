import type { PersistedSessionSummary } from "@symtype/shared";

import { median, medianAbsoluteDeviation } from "./statistics-analysis.js";

export type ExperimentStrategy = "adaptive" | "baseline";

export interface ExperimentSettings {
  experimentEnabled: boolean;
  targetWpm: number;
  progressionAccuracy: number;
}

export interface ExperimentSession {
  id: string;
  strategy: ExperimentStrategy;
  mode: string;
  status: string;
  activeMs: number;
  summary: PersistedSessionSummary | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ExperimentEvent {
  sessionId: string;
  strategy: ExperimentStrategy;
  sessionMode: string;
  completedAt: string;
  sequence: number;
  serverTime: string;
  targetChar: string;
  isCorrect: number;
  ikiMs: number | null;
  wasLongPause: number;
  wasRefocus: number;
  wasPaused: number;
  wasThrottled: number;
  wasRepeat: number;
  isAfterError: number;
  blockId: string | null;
  blockType: string | null;
  focusJson: string | null;
}

const THRESHOLD_MINIMUM_TIMING_SAMPLES = 20;
const RETENTION_MINIMUM_PAIRS = 2;
const CALIBRATION_MINIMUM_SAMPLES = 30;
const WEAKNESS_MINIMUM_FEATURES = 3;

function emptyRetention() {
  return {
    status: "insufficient" as const,
    pairCount: 0,
    minimumPairs: RETENTION_MINIMUM_PAIRS,
    baselineCharacters: 0,
    retestCharacters: 0,
    timingPairCount: 0,
    accuracyDelta: null,
    stableWpmDelta: null
  };
}

function emptyCalibrationBuckets() {
  return Array.from({ length: 5 }, (_, index) => ({
    lower: index / 5,
    upper: (index + 1) / 5,
    sampleCount: 0,
    meanPredicted: null,
    observedAccuracy: null,
    absoluteGap: null
  }));
}

function emptyGroup(strategy: ExperimentStrategy, settings: ExperimentSettings) {
  return {
    strategy,
    sessions: 0,
    days: 0,
    activeMinutes: 0,
    characters: 0,
    correctCharacters: 0,
    exposureEvents: 0,
    netWpm: null,
    accuracy: null,
    accuracy95HalfWidth: null,
    effectiveCorrectCharactersPerMinute: null,
    transferGapWpm: null,
    subjectiveDifficulty: null,
    subjectiveFatigue: null,
    subjectiveSamples: 0,
    exitRate: null,
    brierScore: null,
    logLoss: null,
    thresholdTargetWpm: settings.targetWpm,
    thresholdTargetAccuracy: settings.progressionAccuracy,
    thresholdMinimumTimingSamples: THRESHOLD_MINIMUM_TIMING_SAMPLES,
    thresholdSessionsEvaluated: 0,
    thresholdTimingEligibleSessions: 0,
    thresholdReachedAt: null,
    correctCharactersToThreshold: null,
    activeMinutesToThreshold: null,
    retention: {
      "24h": emptyRetention(),
      "72h": emptyRetention(),
      "7d": emptyRetention()
    },
    postErrorRecoverySamples: 0,
    postErrorRecoveryMs: null,
    calibrationSampleCount: 0,
    calibrationMinimumSamples: CALIBRATION_MINIMUM_SAMPLES,
    calibrationExpectedError: null,
    calibrationBuckets: emptyCalibrationBuckets(),
    weaknessChange: {
      status: "insufficient" as const,
      featureCount: 0,
      minimumFeatures: WEAKNESS_MINIMUM_FEATURES,
      exposureEvents: 0,
      improvedFeatureCount: 0,
      accuracyDelta: null,
      medianIkiDeltaMs: null
    }
  };
}

function eligibleIki(event: ExperimentEvent): number | null {
  return event.isCorrect === 1 &&
    event.ikiMs != null &&
    event.ikiMs >= 25 &&
    event.ikiMs <= 3000 &&
    event.wasLongPause === 0 &&
    event.wasRefocus === 0 &&
    event.wasPaused === 0 &&
    event.wasThrottled === 0 &&
    event.wasRepeat === 0
    ? event.ikiMs
    : null;
}

function conservativeWpm(
  source: readonly ExperimentEvent[],
  minimumSamples: number
): number | null {
  const values = source.flatMap((event) => {
    const value = eligibleIki(event);
    return value == null ? [] : [value];
  });
  if (values.length < minimumSamples) return null;
  const center = median(values);
  const dispersion = medianAbsoluteDeviation(values);
  return center == null || dispersion == null
    ? null
    : 12_000 / Math.max(25, center + 1.4826 * dispersion);
}

function accuracyOf(source: readonly ExperimentEvent[]): number | null {
  return source.length
    ? source.filter((event) => event.isCorrect === 1).length / source.length
    : null;
}

interface ExperimentBlock {
  id: string;
  strategy: ExperimentStrategy;
  mode: string;
  completedAt: string;
  blockType: string;
  focusJson: string;
  events: ExperimentEvent[];
}

function collectExperimentEvidence(events: readonly ExperimentEvent[]) {
  const sessionEvents = new Map<string, ExperimentEvent[]>();
  const blockEvents = new Map<string, ExperimentBlock>();
  for (const event of events) {
    const storedSessionEvents = sessionEvents.get(event.sessionId);
    if (storedSessionEvents) storedSessionEvents.push(event);
    else sessionEvents.set(event.sessionId, [event]);
    if (!event.blockId || !event.blockType) continue;
    const block = blockEvents.get(event.blockId) ?? {
      id: event.blockId,
      strategy: event.strategy,
      mode: event.sessionMode,
      completedAt: event.completedAt,
      blockType: event.blockType,
      focusJson: event.focusJson ?? "[]",
      events: []
    };
    block.events.push(event);
    blockEvents.set(event.blockId, block);
  }
  return { sessionEvents, blockEvents };
}

function buildRetention(
  blocks: readonly ExperimentBlock[],
  strategy: ExperimentStrategy,
  targetHours: number,
  minimumHours: number,
  maximumHours: number
) {
  const strategyBlocks = blocks.filter(
    (block) => block.strategy === strategy && block.events.length >= 5
  );
  const baselinesByContext = new Map<string, ExperimentBlock[]>();
  for (const block of strategyBlocks) {
    if (block.blockType !== "focus") continue;
    const key = `${block.mode}\0${block.focusJson}`;
    const stored = baselinesByContext.get(key);
    if (stored) stored.push(block);
    else baselinesByContext.set(key, [block]);
  }
  const pairs: { baseline: ExperimentBlock; retest: ExperimentBlock }[] = [];
  const usedBaselineIds = new Set<string>();
  for (const retest of strategyBlocks) {
    if (retest.blockType !== "retest") continue;
    const retestTime = new Date(retest.completedAt).getTime();
    const candidates = (baselinesByContext.get(`${retest.mode}\0${retest.focusJson}`) ?? [])
      .map((baseline) => ({
        baseline,
        gapHours: (retestTime - new Date(baseline.completedAt).getTime()) / 3_600_000
      }))
      .filter(
        (candidate) =>
          !usedBaselineIds.has(candidate.baseline.id) &&
          candidate.gapHours >= minimumHours &&
          candidate.gapHours <= maximumHours
      )
      .sort(
        (left, right) =>
          Math.abs(left.gapHours - targetHours) - Math.abs(right.gapHours - targetHours) ||
          new Date(right.baseline.completedAt).getTime() -
            new Date(left.baseline.completedAt).getTime()
      );
    const selected = candidates[0]?.baseline;
    if (selected) {
      usedBaselineIds.add(selected.id);
      pairs.push({ baseline: selected, retest });
    }
  }
  const accuracyDeltas = pairs.flatMap(({ baseline, retest }) => {
    const before = accuracyOf(baseline.events);
    const after = accuracyOf(retest.events);
    return before == null || after == null ? [] : [after - before];
  });
  const timingDeltas = pairs.flatMap(({ baseline, retest }) => {
    const before = conservativeWpm(baseline.events, 5);
    const after = conservativeWpm(retest.events, 5);
    return before == null || after == null ? [] : [after - before];
  });
  const enoughPairs = pairs.length >= RETENTION_MINIMUM_PAIRS;
  return {
    status: enoughPairs ? ("descriptive" as const) : ("insufficient" as const),
    pairCount: pairs.length,
    minimumPairs: RETENTION_MINIMUM_PAIRS,
    baselineCharacters: pairs.reduce((sum, pair) => sum + pair.baseline.events.length, 0),
    retestCharacters: pairs.reduce((sum, pair) => sum + pair.retest.events.length, 0),
    timingPairCount: timingDeltas.length,
    accuracyDelta:
      enoughPairs && accuracyDeltas.length === pairs.length
        ? Number(
            (accuracyDeltas.reduce((sum, value) => sum + value, 0) / accuracyDeltas.length).toFixed(
              4
            )
          )
        : null,
    stableWpmDelta:
      enoughPairs && timingDeltas.length >= RETENTION_MINIMUM_PAIRS
        ? Number(
            (timingDeltas.reduce((sum, value) => sum + value, 0) / timingDeltas.length).toFixed(2)
          )
        : null
  };
}

function buildGroup(input: {
  strategy: ExperimentStrategy;
  settings: ExperimentSettings;
  sessions: readonly ExperimentSession[];
  events: readonly ExperimentEvent[];
  sessionEvents: ReadonlyMap<string, ExperimentEvent[]>;
  blocks: readonly ExperimentBlock[];
}) {
  const { strategy, settings, sessions, events, sessionEvents, blocks } = input;
  const allSessions = sessions.filter((session) => session.strategy === strategy);
  const summaries = allSessions.filter(
    (session): session is ExperimentSession & { summary: PersistedSessionSummary } =>
      session.status === "completed" && session.summary != null
  );
  const characters = summaries.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.summary.characters) || 0),
    0
  );
  const correctCharacters = summaries.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.summary.correct) || 0),
    0
  );
  const activeMs = summaries.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.activeMs) || 0),
    0
  );
  const weightedNetWpm = summaries.reduce(
    (sum, entry) =>
      sum +
      (Number(entry.summary.netWpm) || 0) * Math.max(0, Number(entry.summary.characters) || 0),
    0
  );
  const modeWpm = (modes: ReadonlySet<string>) => {
    const matching = summaries.filter((entry) => modes.has(entry.mode));
    const weight = matching.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.summary.characters) || 0),
      0
    );
    return weight
      ? matching.reduce(
          (sum, entry) =>
            sum +
            (Number(entry.summary.netWpm) || 0) *
              Math.max(0, Number(entry.summary.characters) || 0),
          0
        ) / weight
      : null;
  };
  const transferWpm = modeWpm(
    new Set(["common-english", "pseudowords", "long-form", "source-code", "custom"])
  );
  const focusWpm = modeWpm(new Set(["smart", "rescue", "traditional"]));
  const subjective = summaries.flatMap((entry) => {
    const difficulty = Number(entry.summary.subjectiveFeedback?.difficulty);
    const fatigue = Number(entry.summary.subjectiveFeedback?.fatigue);
    return Number.isFinite(difficulty) && Number.isFinite(fatigue) ? [{ difficulty, fatigue }] : [];
  });
  const strategyEvents = events.filter((event) => event.strategy === strategy);
  const betaByCharacter = new Map<string, { alpha: number; beta: number }>();
  const calibrationBuckets = Array.from({ length: 5 }, (_, index) => ({
    lower: index / 5,
    upper: (index + 1) / 5,
    predictions: [] as number[],
    outcomes: [] as number[]
  }));
  let brierTotal = 0;
  let logLossTotal = 0;
  for (const event of strategyEvents) {
    const posterior = betaByCharacter.get(event.targetChar) ?? { alpha: 2, beta: 1 };
    const probability = posterior.alpha / (posterior.alpha + posterior.beta);
    const outcome = event.isCorrect ? 1 : 0;
    brierTotal += (probability - outcome) ** 2;
    const clipped = Math.min(1 - 1e-6, Math.max(1e-6, probability));
    logLossTotal -= outcome * Math.log(clipped) + (1 - outcome) * Math.log(1 - clipped);
    const bucket = calibrationBuckets[Math.min(4, Math.floor(probability * 5))];
    bucket?.predictions.push(probability);
    bucket?.outcomes.push(outcome);
    if (outcome) posterior.alpha += 1;
    else posterior.beta += 1;
    betaByCharacter.set(event.targetChar, posterior);
  }
  const renderedCalibrationBuckets = calibrationBuckets.map((bucket) => {
    const sampleCount = bucket.outcomes.length;
    const enough = sampleCount >= 5;
    const meanPredicted = enough
      ? bucket.predictions.reduce((sum, value) => sum + value, 0) / sampleCount
      : null;
    const observedAccuracy = enough
      ? bucket.outcomes.reduce((sum, value) => sum + value, 0) / sampleCount
      : null;
    return {
      lower: bucket.lower,
      upper: bucket.upper,
      sampleCount,
      meanPredicted: meanPredicted == null ? null : Number(meanPredicted.toFixed(4)),
      observedAccuracy: observedAccuracy == null ? null : Number(observedAccuracy.toFixed(4)),
      absoluteGap:
        meanPredicted == null || observedAccuracy == null
          ? null
          : Number(Math.abs(meanPredicted - observedAccuracy).toFixed(4))
    };
  });
  const calibrationExpectedError =
    strategyEvents.length >= CALIBRATION_MINIMUM_SAMPLES
      ? calibrationBuckets.reduce((sum, bucket) => {
          if (bucket.outcomes.length === 0) return sum;
          const meanPrediction =
            bucket.predictions.reduce((total, value) => total + value, 0) /
            bucket.predictions.length;
          const observed =
            bucket.outcomes.reduce((total, value) => total + value, 0) / bucket.outcomes.length;
          return (
            sum +
            Math.abs(meanPrediction - observed) * (bucket.outcomes.length / strategyEvents.length)
          );
        }, 0)
      : null;

  let cumulativeCorrect = 0;
  let cumulativeActiveMs = 0;
  let thresholdTimingEligibleSessions = 0;
  let thresholdReachedAt: string | null = null;
  let correctCharactersToThreshold: number | null = null;
  let activeMinutesToThreshold: number | null = null;
  for (const entry of summaries) {
    const sessionCorrect = Math.max(0, Number(entry.summary.correct) || 0);
    const sessionActiveMs = Math.max(0, Number(entry.activeMs) || 0);
    cumulativeCorrect += sessionCorrect;
    cumulativeActiveMs += sessionActiveMs;
    const observed = sessionEvents.get(entry.id) ?? [];
    const stableWpm = conservativeWpm(observed, THRESHOLD_MINIMUM_TIMING_SAMPLES);
    if (stableWpm != null) thresholdTimingEligibleSessions += 1;
    const sessionAccuracy = accuracyOf(observed);
    if (
      thresholdReachedAt == null &&
      stableWpm != null &&
      sessionAccuracy != null &&
      stableWpm >= settings.targetWpm &&
      sessionAccuracy >= settings.progressionAccuracy
    ) {
      thresholdReachedAt = entry.completedAt ?? entry.startedAt;
      correctCharactersToThreshold = cumulativeCorrect;
      activeMinutesToThreshold = Number((cumulativeActiveMs / 60_000).toFixed(2));
    }
  }

  const postErrorRecoveryValues = strategyEvents.flatMap((event) => {
    const value = eligibleIki(event);
    return event.isAfterError === 1 && value != null ? [value] : [];
  });

  const eventsByCharacter = new Map<string, ExperimentEvent[]>();
  for (const event of strategyEvents) {
    const stored = eventsByCharacter.get(event.targetChar);
    if (stored) stored.push(event);
    else eventsByCharacter.set(event.targetChar, [event]);
  }
  const weaknessChanges = [...eventsByCharacter.values()].flatMap((characterEvents) => {
    if (characterEvents.length < 10) return [];
    const first = characterEvents.slice(0, 5);
    const last = characterEvents.slice(-5);
    const firstAccuracy = accuracyOf(first) ?? 0;
    const lastAccuracy = accuracyOf(last) ?? 0;
    const firstIki = median(
      first.flatMap((event) => {
        const value = eligibleIki(event);
        return value == null ? [] : [value];
      })
    );
    const lastIki = median(
      last.flatMap((event) => {
        const value = eligibleIki(event);
        return value == null ? [] : [value];
      })
    );
    const firstWpm = firstIki == null ? null : 12_000 / firstIki;
    if (
      firstAccuracy >= settings.progressionAccuracy &&
      (firstWpm == null || firstWpm >= settings.targetWpm)
    ) {
      return [];
    }
    const accuracyDelta = lastAccuracy - firstAccuracy;
    const ikiDelta = firstIki == null || lastIki == null ? null : lastIki - firstIki;
    return [
      {
        exposureEvents: characterEvents.length,
        accuracyDelta,
        ikiDelta,
        improved: accuracyDelta > 0 || (accuracyDelta === 0 && ikiDelta != null && ikiDelta < 0)
      }
    ];
  });
  const weaknessFeatureCount = weaknessChanges.length;
  const enoughWeaknessFeatures = weaknessFeatureCount >= WEAKNESS_MINIMUM_FEATURES;
  const weaknessIkiDeltas = weaknessChanges.flatMap((change) =>
    change.ikiDelta == null ? [] : [change.ikiDelta]
  );
  const accuracy = characters ? correctCharacters / characters : null;
  const accuracy95HalfWidth =
    accuracy == null ? null : 1.96 * Math.sqrt((accuracy * (1 - accuracy)) / characters);
  return {
    strategy,
    sessions: summaries.length,
    days: new Set(summaries.map((entry) => entry.startedAt.slice(0, 10))).size,
    activeMinutes: Number((activeMs / 60_000).toFixed(2)),
    characters,
    correctCharacters,
    exposureEvents: strategyEvents.length,
    netWpm: characters ? Number((weightedNetWpm / characters).toFixed(2)) : null,
    accuracy: accuracy == null ? null : Number(accuracy.toFixed(4)),
    accuracy95HalfWidth:
      accuracy95HalfWidth == null ? null : Number(accuracy95HalfWidth.toFixed(4)),
    effectiveCorrectCharactersPerMinute: activeMs
      ? Number((correctCharacters / (activeMs / 60_000)).toFixed(2))
      : null,
    transferGapWpm:
      transferWpm == null || focusWpm == null ? null : Number((transferWpm - focusWpm).toFixed(2)),
    subjectiveDifficulty: subjective.length
      ? Number(
          (
            subjective.reduce((sum, value) => sum + value.difficulty, 0) / subjective.length
          ).toFixed(2)
        )
      : null,
    subjectiveFatigue: subjective.length
      ? Number(
          (subjective.reduce((sum, value) => sum + value.fatigue, 0) / subjective.length).toFixed(2)
        )
      : null,
    subjectiveSamples: subjective.length,
    exitRate: allSessions.length
      ? Number(
          (
            allSessions.filter((session) => session.status === "abandoned").length /
            allSessions.length
          ).toFixed(4)
        )
      : null,
    brierScore: strategyEvents.length
      ? Number((brierTotal / strategyEvents.length).toFixed(4))
      : null,
    logLoss: strategyEvents.length
      ? Number((logLossTotal / strategyEvents.length).toFixed(4))
      : null,
    thresholdTargetWpm: settings.targetWpm,
    thresholdTargetAccuracy: settings.progressionAccuracy,
    thresholdMinimumTimingSamples: THRESHOLD_MINIMUM_TIMING_SAMPLES,
    thresholdSessionsEvaluated: summaries.length,
    thresholdTimingEligibleSessions,
    thresholdReachedAt,
    correctCharactersToThreshold,
    activeMinutesToThreshold,
    retention: {
      "24h": buildRetention(blocks, strategy, 24, 18, 36),
      "72h": buildRetention(blocks, strategy, 72, 60, 84),
      "7d": buildRetention(blocks, strategy, 168, 144, 192)
    },
    postErrorRecoverySamples: postErrorRecoveryValues.length,
    postErrorRecoveryMs:
      postErrorRecoveryValues.length >= 3
        ? Number((median(postErrorRecoveryValues) ?? 0).toFixed(1))
        : null,
    calibrationSampleCount: strategyEvents.length,
    calibrationMinimumSamples: CALIBRATION_MINIMUM_SAMPLES,
    calibrationExpectedError:
      calibrationExpectedError == null ? null : Number(calibrationExpectedError.toFixed(4)),
    calibrationBuckets: renderedCalibrationBuckets,
    weaknessChange: {
      status: enoughWeaknessFeatures
        ? ("descriptive" as const)
        : weaknessFeatureCount > 0
          ? ("limited" as const)
          : ("insufficient" as const),
      featureCount: weaknessFeatureCount,
      minimumFeatures: WEAKNESS_MINIMUM_FEATURES,
      exposureEvents: weaknessChanges.reduce((sum, change) => sum + change.exposureEvents, 0),
      improvedFeatureCount: weaknessChanges.filter((change) => change.improved).length,
      accuracyDelta: enoughWeaknessFeatures
        ? Number(
            (
              weaknessChanges.reduce((sum, change) => sum + change.accuracyDelta, 0) /
              weaknessFeatureCount
            ).toFixed(4)
          )
        : null,
      medianIkiDeltaMs:
        enoughWeaknessFeatures && weaknessIkiDeltas.length >= WEAKNESS_MINIMUM_FEATURES
          ? Number((median(weaknessIkiDeltas) ?? 0).toFixed(1))
          : null
    }
  };
}

/** Build the full experiment report from already validated repository rows. */
export function buildExperimentReport(input: {
  settings: ExperimentSettings;
  sessions: readonly ExperimentSession[];
  events: readonly ExperimentEvent[];
}): Record<string, unknown> {
  const { settings, sessions, events } = input;
  if (!settings.experimentEnabled) {
    return {
      enabled: false,
      assignment: "disabled",
      minimumDays: 14,
      daysObserved: 0,
      eligibleForComparison: false,
      conclusion: "训练算法实验未开启；没有进行策略比较。",
      groups: [emptyGroup("adaptive", settings), emptyGroup("baseline", settings)]
    };
  }

  const { sessionEvents, blockEvents } = collectExperimentEvidence(events);
  const blocks = [...blockEvents.values()];
  const groups = (["adaptive", "baseline"] as const).map((strategy) =>
    buildGroup({ strategy, settings, sessions, events, sessionEvents, blocks })
  );
  const daysObserved = new Set(sessions.map((session) => session.startedAt.slice(0, 10))).size;
  const eligibleForComparison = daysObserved >= 14 && groups.every((group) => group.sessions >= 5);
  return {
    enabled: true,
    assignment: "balanced-by-local-date",
    minimumDays: 14,
    daysObserved,
    eligibleForComparison,
    conclusion: eligibleForComparison
      ? "已有描述性双策略样本；仍不宣称统计显著或因果优势。"
      : "尚无结论：至少需要 14 个训练日且两种策略各 5 次已完成训练。",
    groups
  };
}
