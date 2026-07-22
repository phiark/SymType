import { median, medianAbsoluteDeviation } from "./metrics.js";

export interface BetaPosterior {
  readonly alpha: number;
  readonly beta: number;
}

export const DEFAULT_ACCURACY_PRIOR: BetaPosterior = Object.freeze({
  alpha: 9,
  beta: 1
});

function validatePosterior(posterior: BetaPosterior): void {
  if (
    !Number.isFinite(posterior.alpha) ||
    !Number.isFinite(posterior.beta) ||
    posterior.alpha <= 0 ||
    posterior.beta <= 0
  ) {
    throw new RangeError("Beta parameters must be finite and positive");
  }
}

export function updateBeta(
  posterior: BetaPosterior,
  successes: number,
  failures: number
): BetaPosterior {
  validatePosterior(posterior);
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(failures) ||
    successes < 0 ||
    failures < 0
  ) {
    throw new RangeError("Beta observations must be non-negative integers");
  }
  return {
    alpha: posterior.alpha + successes,
    beta: posterior.beta + failures
  };
}

export function betaMean(posterior: BetaPosterior): number {
  validatePosterior(posterior);
  return posterior.alpha / (posterior.alpha + posterior.beta);
}

export function betaVariance(posterior: BetaPosterior): number {
  validatePosterior(posterior);
  const total = posterior.alpha + posterior.beta;
  return (posterior.alpha * posterior.beta) / (total * total * (total + 1));
}

/**
 * A bounded normal approximation suitable for UI uncertainty bands. It is
 * deliberately labelled approximate; low-sample decisions use the posterior
 * variance directly rather than pretending this is an exact beta quantile.
 */
export function approximateBetaInterval(
  posterior: BetaPosterior,
  zScore = 1.96
): readonly [number, number] {
  if (!Number.isFinite(zScore) || zScore <= 0) {
    throw new RangeError("zScore must be positive");
  }
  const mean = betaMean(posterior);
  const margin = zScore * Math.sqrt(betaVariance(posterior));
  return [Math.max(0, mean - margin), Math.min(1, mean + margin)];
}

export type FeatureKind =
  | "character"
  | "shifted-character"
  | "bigram"
  | "trigram"
  | "finger"
  | "hand"
  | "row"
  | "zone"
  | "class"
  | "content-mode";

export interface FeatureObservation {
  readonly correct: boolean;
  readonly ikiMs: number | null;
  readonly observedAtMs: number;
  readonly eligibleForSpeed: boolean;
}

export interface FeatureStats {
  readonly featureId: string;
  readonly kind: FeatureKind;
  readonly shortAccuracy: BetaPosterior;
  readonly longAccuracy: BetaPosterior;
  readonly shortIkiMs: number | null;
  readonly longIkiMs: number | null;
  readonly ikiMadMs: number | null;
  readonly sampleCount: number;
  readonly speedSampleCount: number;
  readonly lastPracticedAtMs: number | null;
  readonly correctStreak: number;
  readonly recentOutcomes: readonly boolean[];
  readonly recentIkisMs: readonly number[];
  readonly algorithmVersion: number;
}

export function createFeatureStats(
  featureId: string,
  kind: FeatureKind,
  algorithmVersion = 1
): FeatureStats {
  if (featureId.trim().length === 0) {
    throw new Error("featureId cannot be empty");
  }
  if (!Number.isInteger(algorithmVersion) || algorithmVersion < 1) {
    throw new RangeError("algorithmVersion must be a positive integer");
  }
  return {
    featureId,
    kind,
    shortAccuracy: { ...DEFAULT_ACCURACY_PRIOR },
    longAccuracy: { ...DEFAULT_ACCURACY_PRIOR },
    shortIkiMs: null,
    longIkiMs: null,
    ikiMadMs: null,
    sampleCount: 0,
    speedSampleCount: 0,
    lastPracticedAtMs: null,
    correctStreak: 0,
    recentOutcomes: [],
    recentIkisMs: [],
    algorithmVersion
  };
}

export interface FeatureUpdateOptions {
  readonly shortWindow: number;
  readonly speedWindow: number;
  readonly shortAlpha: number;
  readonly longAlpha: number;
}

export const DEFAULT_FEATURE_UPDATE_OPTIONS: FeatureUpdateOptions = Object.freeze({
  shortWindow: 30,
  speedWindow: 50,
  shortAlpha: 0.3,
  longAlpha: 0.05
});

export function updateFeatureStats(
  current: FeatureStats,
  observation: FeatureObservation,
  options: FeatureUpdateOptions = DEFAULT_FEATURE_UPDATE_OPTIONS
): FeatureStats {
  if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < 0) {
    throw new RangeError("observedAtMs must be a non-negative finite timestamp");
  }
  if (
    !Number.isInteger(options.shortWindow) ||
    !Number.isInteger(options.speedWindow) ||
    options.shortWindow < 1 ||
    options.speedWindow < 1 ||
    !Number.isFinite(options.shortAlpha) ||
    !Number.isFinite(options.longAlpha) ||
    options.shortAlpha <= 0 ||
    options.shortAlpha > 1 ||
    options.longAlpha <= 0 ||
    options.longAlpha > 1
  ) {
    throw new RangeError("Feature windows and EWMA alphas must be valid");
  }
  const recentOutcomes = [...current.recentOutcomes, observation.correct].slice(
    -options.shortWindow
  );
  const successes = recentOutcomes.filter(Boolean).length;
  const failures = recentOutcomes.length - successes;
  const shortAccuracy = updateBeta(DEFAULT_ACCURACY_PRIOR, successes, failures);
  const longAccuracy = updateBeta(
    current.longAccuracy,
    observation.correct ? 1 : 0,
    observation.correct ? 0 : 1
  );

  const isSpeedSample =
    observation.correct &&
    observation.eligibleForSpeed &&
    observation.ikiMs !== null &&
    Number.isFinite(observation.ikiMs) &&
    observation.ikiMs > 0;
  const recentIkisMs = isSpeedSample
    ? [...current.recentIkisMs, observation.ikiMs].slice(-options.speedWindow)
    : [...current.recentIkisMs];
  const sampleIki = isSpeedSample ? observation.ikiMs : null;
  const shortIkiMs =
    sampleIki === null
      ? current.shortIkiMs
      : current.shortIkiMs === null
        ? sampleIki
        : options.shortAlpha * sampleIki + (1 - options.shortAlpha) * current.shortIkiMs;
  const longIkiMs =
    sampleIki === null
      ? current.longIkiMs
      : current.longIkiMs === null
        ? sampleIki
        : options.longAlpha * sampleIki + (1 - options.longAlpha) * current.longIkiMs;

  return {
    ...current,
    shortAccuracy,
    longAccuracy,
    shortIkiMs,
    longIkiMs,
    ikiMadMs: recentIkisMs.length > 0 ? medianAbsoluteDeviation(recentIkisMs) : null,
    sampleCount: current.sampleCount + 1,
    speedSampleCount: current.speedSampleCount + (isSpeedSample ? 1 : 0),
    lastPracticedAtMs: observation.observedAtMs,
    correctStreak: observation.correct ? current.correctStreak + 1 : 0,
    recentOutcomes,
    recentIkisMs
  };
}

export function conservativeStableIki(stats: FeatureStats): number | null {
  if (stats.recentIkisMs.length < 5) {
    return null;
  }
  return median(stats.recentIkisMs) + 1.4826 * medianAbsoluteDeviation(stats.recentIkisMs);
}
