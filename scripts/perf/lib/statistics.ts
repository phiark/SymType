export interface SampleSummary {
  readonly samples: number[];
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
}

/** R-7 linear interpolation, the default used by common statistical tools. */
export function quantile(samples: readonly number[], probability: number): number {
  if (samples.length === 0) throw new Error("At least one finite sample is required");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Quantile probability must be between zero and one");
  }
  const sorted = samples.map(assertFinite).sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("Quantile index is unavailable");
  return lower + (upper - lower) * (position - lowerIndex);
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
  const rawSamples = samples.map(assertFinite);
  return {
    samples: rawSamples,
    count: rawSamples.length,
    median: quantile(rawSamples, 0.5),
    p95: quantile(rawSamples, 0.95),
    p99: quantile(rawSamples, 0.99)
  };
}

function assertFinite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Performance samples must be finite numbers");
  return value;
}
