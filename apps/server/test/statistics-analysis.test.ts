import { describe, expect, test } from "vitest";

import {
  buildPeriodFeatures,
  buildPeriodGroups,
  median,
  medianAbsoluteDeviation,
  periodBounds,
  robustLearningSlope,
  type PeriodFeatureRow,
  type PeriodGroupRow
} from "../src/domain/statistics-analysis.js";

function featureRow(overrides: Partial<PeriodFeatureRow> = {}): PeriodFeatureRow {
  return {
    feature_char: "a",
    bigram: "ta",
    trigram: "sta",
    mapped_hand: "left",
    mapped_finger: "left-pinky",
    keyboard_row: "home",
    zone: "left-pinky",
    character_class: "lowercase",
    content_mode: "smart",
    is_correct: 1,
    iki_ms: 200,
    was_long_pause: 0,
    was_refocus: 0,
    was_paused: 0,
    was_throttled: 0,
    was_repeat: 0,
    server_time: "2026-07-21T08:00:00.000Z",
    ...overrides
  };
}

function groupRow(overrides: Partial<PeriodGroupRow> = {}): PeriodGroupRow {
  const source = featureRow(overrides);
  return {
    mapped_hand: source.mapped_hand,
    mapped_finger: source.mapped_finger,
    keyboard_row: source.keyboard_row,
    zone: source.zone,
    character_class: source.character_class,
    shift_side: "none",
    is_correct: source.is_correct,
    iki_ms: source.iki_ms,
    was_long_pause: source.was_long_pause,
    was_refocus: source.was_refocus,
    was_paused: source.was_paused,
    was_throttled: source.was_throttled,
    was_repeat: source.was_repeat,
    ...overrides
  };
}

describe("statistics analysis domain", () => {
  test("resolves deterministic local calendar windows", () => {
    const reference = new Date(2026, 6, 21, 15, 30, 0);
    expect(periodBounds("today", reference).localDate).toBe("2026-07-21");
    expect(periodBounds("7d", reference).localDate).toBe("2026-07-15");
    expect(periodBounds("30d", reference).localDate).toBe("2026-06-22");
    expect(periodBounds("all", reference)).toEqual({
      instant: "1970-01-01T00:00:00.000Z",
      localDate: "1970-01-01"
    });
  });

  test("uses robust medians, MAD, and a directionally meaningful learning slope", () => {
    expect(median([9, 1, 5, 3])).toBe(4);
    expect(medianAbsoluteDeviation([100, 101, 102, 103, 900])).toBe(1);
    expect(robustLearningSlope([300, 290, 280, 270, 260, 250, 240, 230])).toBeGreaterThan(0);
  });

  test("aggregates period features without treating excluded timing as speed evidence", () => {
    const rows = [
      featureRow(),
      featureRow({ is_correct: 0, iki_ms: 100 }),
      featureRow({ iki_ms: 2_000, was_refocus: 1 })
    ];
    const key = buildPeriodFeatures(rows).find(
      (feature) => feature.feature_type === "key" && feature.feature_value === "a"
    );
    expect(key).toMatchObject({ sample_count: 3, accuracy: 2 / 3, short_iki_ms: 200 });
  });

  test("builds group summaries with robust timing and compatibility alias", () => {
    const groups = buildPeriodGroups([
      groupRow({ iki_ms: 180 }),
      groupRow({ iki_ms: 200 }),
      groupRow({ iki_ms: 220 }),
      groupRow({ iki_ms: 240 }),
      groupRow({ iki_ms: 260 }),
      groupRow({ is_correct: 0, iki_ms: 100 })
    ]);
    expect(groups[0]).toMatchObject({
      samples: 6,
      timing_samples: 5,
      median_iki_ms: 220,
      mean_iki_ms: 220,
      iki_mad_ms: 20
    });
  });
});
