export interface IkiObservation {
  readonly ikiMs: number | null;
  readonly correct: boolean;
  readonly repeated?: boolean;
  readonly afterFocus?: boolean;
  readonly afterPause?: boolean;
  readonly longPause?: boolean;
  readonly throttled?: boolean;
}

export interface IkiFilterOptions {
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly correctOnly: boolean;
}

export const DEFAULT_IKI_FILTER: IkiFilterOptions = Object.freeze({
  minimumMs: 25,
  maximumMs: 3_000,
  correctOnly: true
});

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

export function rawWpm(typedCharacters: number, durationMs: number): number {
  assertFiniteNonNegative(typedCharacters, "typedCharacters");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return typedCharacters / 5 / (durationMs / 60_000);
}

/** Net WPM subtracts one five-character word per uncorrected error. */
export function netWpm(
  typedCharacters: number,
  uncorrectedErrors: number,
  durationMs: number
): number {
  assertFiniteNonNegative(uncorrectedErrors, "uncorrectedErrors");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  const minutes = durationMs / 60_000;
  return Math.max(0, rawWpm(typedCharacters, durationMs) - uncorrectedErrors / minutes);
}

export function keystrokeAccuracy(correct: number, attempted: number): number {
  assertFiniteNonNegative(correct, "correct");
  assertFiniteNonNegative(attempted, "attempted");
  if (correct > attempted) {
    throw new RangeError("correct cannot exceed attempted");
  }
  return attempted === 0 ? 1 : correct / attempted;
}

export function levenshteinDistance(first: string, second: string): number {
  const a = Array.from(first);
  const b = Array.from(second);
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const deletion = (previous[column] ?? Number.POSITIVE_INFINITY) + 1;
      const insertion = (current[column - 1] ?? Number.POSITIVE_INFINITY) + 1;
      const substitution =
        (previous[column - 1] ?? Number.POSITIVE_INFINITY) + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(deletion, insertion, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * Final-text accuracy uses normalized edit distance. The denominator is the
 * longer of target and submitted text so extra input is not hidden.
 */
export function finalTextAccuracy(target: string, submitted: string): number {
  const denominator = Math.max(Array.from(target).length, Array.from(submitted).length);
  if (denominator === 0) {
    return 1;
  }
  return Math.max(0, 1 - levenshteinDistance(target, submitted) / denominator);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("median requires at least one value");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("median accepts only finite values");
  }
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[middle] ?? 0;
  }
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

export function medianAbsoluteDeviation(values: readonly number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function ewma(values: readonly number[], alpha: number): number | null {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new RangeError("alpha must be in (0, 1]");
  }
  if (values.length === 0) {
    return null;
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("ewma accepts only finite values");
  }
  let estimate = values[0] ?? 0;
  for (let index = 1; index < values.length; index += 1) {
    estimate = alpha * (values[index] ?? estimate) + (1 - alpha) * estimate;
  }
  return estimate;
}

/** Winsorizes extreme pauses at median +/- threshold * MAD before EWMA. */
export function robustEwma(
  values: readonly number[],
  alpha = 0.2,
  madThreshold = 4
): number | null {
  if (values.length === 0) {
    return null;
  }
  if (!Number.isFinite(madThreshold) || madThreshold <= 0) {
    throw new RangeError("madThreshold must be positive");
  }
  const center = median(values);
  const mad = medianAbsoluteDeviation(values);
  if (mad === 0) {
    return ewma(
      values.map((value) => (value > center ? center : value)),
      alpha
    );
  }
  const scale = 1.4826 * mad;
  const lower = center - madThreshold * scale;
  const upper = center + madThreshold * scale;
  return ewma(
    values.map((value) => Math.min(upper, Math.max(lower, value))),
    alpha
  );
}

export function filterValidIkis(
  observations: readonly IkiObservation[],
  options: IkiFilterOptions = DEFAULT_IKI_FILTER
): number[] {
  if (
    !Number.isFinite(options.minimumMs) ||
    !Number.isFinite(options.maximumMs) ||
    options.minimumMs < 0 ||
    options.maximumMs <= options.minimumMs
  ) {
    throw new RangeError("Invalid IKI filter bounds");
  }
  return observations.flatMap((observation) => {
    const value = observation.ikiMs;
    if (
      value === null ||
      !Number.isFinite(value) ||
      value < options.minimumMs ||
      value > options.maximumMs ||
      (options.correctOnly && !observation.correct) ||
      observation.repeated === true ||
      observation.afterFocus === true ||
      observation.afterPause === true ||
      observation.longPause === true ||
      observation.throttled === true
    ) {
      return [];
    }
    return [value];
  });
}

/** 0-1 rhythm consistency derived from robust relative dispersion. */
export function rhythmConsistency(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const center = median(values);
  if (center <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, 1 - (1.4826 * medianAbsoluteDeviation(values)) / center));
}

export interface TypingMetricsInput {
  readonly typedCharacters: number;
  readonly correctKeystrokes: number;
  readonly attemptedKeystrokes: number;
  readonly uncorrectedErrors: number;
  readonly durationMs: number;
  readonly targetText: string;
  readonly submittedText: string;
  readonly ikiObservations: readonly IkiObservation[];
}

export interface TypingMetrics {
  readonly rawWpm: number;
  readonly netWpm: number;
  readonly keystrokeAccuracy: number;
  readonly finalTextAccuracy: number;
  readonly medianIkiMs: number | null;
  readonly madIkiMs: number | null;
  readonly consistency: number | null;
  readonly validIkiSamples: number;
}

export function calculateTypingMetrics(input: TypingMetricsInput): TypingMetrics {
  const ikis = filterValidIkis(input.ikiObservations);
  return {
    rawWpm: rawWpm(input.typedCharacters, input.durationMs),
    netWpm: netWpm(input.typedCharacters, input.uncorrectedErrors, input.durationMs),
    keystrokeAccuracy: keystrokeAccuracy(input.correctKeystrokes, input.attemptedKeystrokes),
    finalTextAccuracy: finalTextAccuracy(input.targetText, input.submittedText),
    medianIkiMs: ikis.length > 0 ? median(ikis) : null,
    madIkiMs: ikis.length > 0 ? medianAbsoluteDeviation(ikis) : null,
    consistency: rhythmConsistency(ikis),
    validIkiSamples: ikis.length
  };
}
