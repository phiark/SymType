export type TrainingStrategy = "adaptive" | "baseline";

/** Keeps one strategy for a full local calendar day so sessions do not oscillate within a day. */
export function strategyForLocalDate(
  experimentEnabled: boolean,
  date = new Date()
): TrainingStrategy {
  if (!experimentEnabled) return "adaptive";
  const localDay = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  );
  return localDay % 2 === 0 ? "adaptive" : "baseline";
}
