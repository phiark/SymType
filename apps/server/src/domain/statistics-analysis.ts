export type StatisticsPeriod = "today" | "7d" | "30d" | "all";

export interface PeriodBounds {
  instant: string;
  localDate: string;
}

export interface PeriodFeatureRow {
  feature_char: string;
  bigram: string | null;
  trigram: string | null;
  mapped_hand: string;
  mapped_finger: string;
  keyboard_row: string;
  zone: string;
  character_class: string;
  content_mode: string;
  is_correct: number;
  iki_ms: number | null;
  was_long_pause: number;
  was_refocus: number;
  was_paused: number;
  was_throttled: number;
  was_repeat: number;
  server_time: string;
}

export interface PeriodGroupRow {
  mapped_hand: string;
  mapped_finger: string;
  keyboard_row: string;
  zone: string;
  character_class: string;
  shift_side: string;
  is_correct: number;
  iki_ms: number | null;
  was_long_pause: number;
  was_refocus: number;
  was_paused: number;
  was_throttled: number;
  was_repeat: number;
}

interface PeriodFeatureAccumulator {
  feature_type: string;
  feature_value: string;
  sample_count: number;
  correct_count: number;
  short_iki_ms: number | null;
  long_iki_ms: number | null;
  recent_ikis: number[];
  last_practiced_at: string | null;
}

function dateInLocalCalendar(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Resolve a report window from one injected wall-clock reading. */
export function periodBounds(period: StatisticsPeriod, reference = new Date()): PeriodBounds {
  if (period === "all") {
    return { instant: "1970-01-01T00:00:00.000Z", localDate: "1970-01-01" };
  }
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "30d") start.setDate(start.getDate() - 29);
  return { instant: start.toISOString(), localDate: dateInLocalCalendar(start) };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower == null || upper == null ? null : (lower + upper) / 2;
}

export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  if (values.length < 5) return null;
  const center = median(values);
  return center == null ? null : median(values.map((value) => Math.abs(value - center)));
}

/**
 * A positive value means IKI is improving. The Theil-Sen median pairwise slope resists a few
 * bursts or pauses far better than ordinary least squares on this small rolling window.
 */
export function robustLearningSlope(values: readonly number[]): number | null {
  if (values.length < 8) return null;
  const slopes: number[] = [];
  for (let left = 0; left < values.length - 1; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const leftValue = values[left];
      const rightValue = values[right];
      if (leftValue == null || rightValue == null) continue;
      slopes.push((rightValue - leftValue) / (right - left));
    }
  }
  const slope = median(slopes);
  const center = median(values);
  if (slope == null || center == null || center <= 0) return null;
  return Number((-slope / center).toFixed(6));
}

function eligibleIki(row: PeriodFeatureRow | PeriodGroupRow): number | null {
  return row.is_correct === 1 &&
    row.iki_ms != null &&
    row.iki_ms >= 25 &&
    row.iki_ms <= 3000 &&
    row.was_long_pause === 0 &&
    row.was_refocus === 0 &&
    row.was_paused === 0 &&
    row.was_throttled === 0 &&
    row.was_repeat === 0
    ? row.iki_ms
    : null;
}

export function buildPeriodFeatures(rows: readonly PeriodFeatureRow[]): Record<string, unknown>[] {
  const features = new Map<string, PeriodFeatureAccumulator>();
  for (const row of rows) {
    const timing = eligibleIki(row);
    const pairs: [string, string | null][] = [
      ["key", row.feature_char],
      ["bigram", row.bigram],
      ["trigram", row.trigram],
      ["hand", row.mapped_hand],
      ["finger", row.mapped_finger],
      ["row", row.keyboard_row],
      ["zone", row.zone],
      ["class", row.character_class],
      ["content-mode", row.content_mode]
    ];
    for (const [featureType, featureValue] of pairs) {
      if (!featureValue || featureValue === "unknown") continue;
      const key = `${featureType}\0${featureValue}`;
      const feature = features.get(key) ?? {
        feature_type: featureType,
        feature_value: featureValue,
        sample_count: 0,
        correct_count: 0,
        short_iki_ms: null,
        long_iki_ms: null,
        recent_ikis: [],
        last_practiced_at: null
      };
      feature.sample_count += 1;
      feature.correct_count += row.is_correct;
      feature.last_practiced_at = row.server_time;
      if (timing != null) {
        feature.short_iki_ms =
          feature.short_iki_ms == null ? timing : feature.short_iki_ms * 0.82 + timing * 0.18;
        feature.long_iki_ms =
          feature.long_iki_ms == null ? timing : feature.long_iki_ms * 0.96 + timing * 0.04;
        feature.recent_ikis.push(timing);
        if (feature.recent_ikis.length > 40) feature.recent_ikis.shift();
      }
      features.set(key, feature);
    }
  }
  return [...features.values()]
    .map((feature) => ({
      feature_type: feature.feature_type,
      feature_value: feature.feature_value,
      sample_count: feature.sample_count,
      accuracy: feature.correct_count / feature.sample_count,
      short_iki_ms: feature.short_iki_ms,
      long_iki_ms: feature.long_iki_ms,
      iki_mad_ms: medianAbsoluteDeviation(feature.recent_ikis),
      learning_slope: robustLearningSlope(feature.recent_ikis),
      last_practiced_at: feature.last_practiced_at
    }))
    .sort((left, right) => {
      const typeOrder = String(left.feature_type).localeCompare(String(right.feature_type));
      if (typeOrder !== 0) return typeOrder;
      const sampleOrder = Number(right.sample_count) - Number(left.sample_count);
      return sampleOrder || String(left.feature_value).localeCompare(String(right.feature_value));
    })
    .slice(0, 1200);
}

export function buildPeriodGroups(rows: readonly PeriodGroupRow[]): Record<string, unknown>[] {
  const groups = new Map<
    string,
    {
      hand: string;
      finger: string;
      row: string;
      zone: string;
      class: string;
      shift_side: string;
      samples: number;
      correct: number;
      ikis: number[];
    }
  >();
  for (const row of rows) {
    const values = [
      row.mapped_hand,
      row.mapped_finger,
      row.keyboard_row,
      row.zone,
      row.character_class,
      row.shift_side
    ];
    const key = values.join("\0");
    const group = groups.get(key) ?? {
      hand: row.mapped_hand,
      finger: row.mapped_finger,
      row: row.keyboard_row,
      zone: row.zone,
      class: row.character_class,
      shift_side: row.shift_side,
      samples: 0,
      correct: 0,
      ikis: []
    };
    group.samples += 1;
    group.correct += row.is_correct;
    const timing = eligibleIki(row);
    if (timing != null) group.ikis.push(timing);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((left, right) => right.samples - left.samples)
    .slice(0, 100)
    .map(({ correct, ikis, ...group }) => {
      const center = median(ikis);
      return {
        ...group,
        accuracy: correct / group.samples,
        timing_samples: ikis.length,
        median_iki_ms: center,
        iki_mad_ms: medianAbsoluteDeviation(ikis),
        // Kept for one API compatibility cycle; its value is now the robust median.
        mean_iki_ms: center
      };
    });
}
