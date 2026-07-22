export const CALIBRATION_DEFAULT_ACTIVE_MS = 4 * 60_000;
export const CALIBRATION_MIN_ACTIVE_MS = 3 * 60_000;
export const CALIBRATION_MAX_ACTIVE_MS = 5 * 60_000;
export const CALIBRATION_BLOCK_LENGTH = 20;
export const CALIBRATION_MIN_SAMPLES_PER_CATEGORY = 12;

export interface ActiveElapsedInput {
  startedAtMs: number;
  nowMs: number;
  pausedAtMs: number;
  pausedTotalMs: number;
  paused: boolean;
}

export interface CalibrationCompletionInput {
  elapsedActiveMs: number;
  targetActiveMs: number;
  selectedCategories: readonly string[];
  contentModes: readonly string[];
  atBlockBoundary: boolean;
}

export interface CalibrationCompletionDecision {
  shouldComplete: boolean;
  coverageComplete: boolean;
  remainingMs: number;
  sampleCounts: Readonly<Record<string, number>>;
  reason: "collecting" | "waiting-for-boundary" | "needs-coverage" | "complete";
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function resolveCalibrationActiveMs(requestedMinutes: number): number {
  if (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0)
    return CALIBRATION_DEFAULT_ACTIVE_MS;
  return (
    Math.min(
      CALIBRATION_MAX_ACTIVE_MS / 60_000,
      Math.max(CALIBRATION_MIN_ACTIVE_MS / 60_000, requestedMinutes)
    ) * 60_000
  );
}

export function activeElapsedMs(input: ActiveElapsedInput): number {
  const startedAtMs = finiteNonNegative(input.startedAtMs);
  if (startedAtMs === 0) return 0;
  const nowMs = finiteNonNegative(input.nowMs);
  const pausedAtMs = finiteNonNegative(input.pausedAtMs);
  const endpoint = input.paused && pausedAtMs > 0 ? pausedAtMs : nowMs;
  return Math.max(0, endpoint - startedAtMs - finiteNonNegative(input.pausedTotalMs));
}

export function calibrationCategoryForBlock<T extends string>(
  selectedCategories: readonly T[],
  blockIndex: number
): T | undefined {
  if (selectedCategories.length === 0 || !Number.isInteger(blockIndex) || blockIndex < 0)
    return undefined;
  return selectedCategories[blockIndex % selectedCategories.length];
}

export function calibrationCompletionDecision(
  input: CalibrationCompletionInput
): CalibrationCompletionDecision {
  const categories = [...new Set(input.selectedCategories.filter(Boolean))];
  const sampleCounts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const contentMode of input.contentModes) {
    const category = contentMode.startsWith("calibration-")
      ? contentMode.slice("calibration-".length)
      : "";
    if (category in sampleCounts) sampleCounts[category] = (sampleCounts[category] ?? 0) + 1;
  }

  const coverageComplete =
    categories.length > 0 &&
    categories.every(
      (category) => (sampleCounts[category] ?? 0) >= CALIBRATION_MIN_SAMPLES_PER_CATEGORY
    );
  const elapsedActiveMs = finiteNonNegative(input.elapsedActiveMs);
  const targetActiveMs = Math.min(
    CALIBRATION_MAX_ACTIVE_MS,
    Math.max(CALIBRATION_MIN_ACTIVE_MS, finiteNonNegative(input.targetActiveMs))
  );
  const remainingMs = Math.max(0, targetActiveMs - elapsedActiveMs);
  const targetReached = elapsedActiveMs >= targetActiveMs;
  const hardLimitReached = elapsedActiveMs >= CALIBRATION_MAX_ACTIVE_MS;
  const shouldComplete =
    hardLimitReached || (coverageComplete && input.atBlockBoundary && targetReached);

  let reason: CalibrationCompletionDecision["reason"] = "collecting";
  if (shouldComplete) reason = "complete";
  else if (targetReached && !coverageComplete) reason = "needs-coverage";
  else if (targetReached) reason = "waiting-for-boundary";

  return { shouldComplete, coverageComplete, remainingMs, sampleCounts, reason };
}
