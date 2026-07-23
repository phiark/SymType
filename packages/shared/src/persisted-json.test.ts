import { describe, expect, test } from "vitest";

import {
  persistedFeatureWindowSchema,
  persistedLayoutSnapshotSchema,
  persistedSessionSummarySchema,
  persistedSettingsSchema,
  persistedTestErrorsSchema
} from "./persisted-json.js";
import { SYMMETRIC_LAYOUT } from "./keyboard-layout.js";

function snapshotMappings() {
  return SYMMETRIC_LAYOUT.map((key) => ({
    physical_code: key.code,
    unshifted: key.unshifted ?? "",
    shifted: key.shifted ?? "",
    hand: key.hand,
    finger: key.finger,
    keyboard_row: key.row,
    zone: key.zone,
    key_width: key.width
  }));
}

const legacySettings = {
  onboardingComplete: true,
  calibrationComplete: true,
  theme: "dark",
  reducedMotion: false,
  keyboardVisible: true,
  soundEnabled: true,
  soundTheme: "soft",
  soundMode: "all",
  volume: 0.4,
  activeLayoutId: "symmetric-default",
  stopOnError: false,
  backspaceMode: "enabled",
  fontSize: 30,
  lineHeight: 1.6,
  caretStyle: "bar",
  smoothScroll: true,
  targetWpm: 45,
  minimumAccuracy: 0.94,
  trainingBias: "balanced",
  defaultDurationMinutes: 10
} as const;

const legacySummary = {
  characters: 20,
  correct: 18,
  errors: 2,
  rawWpm: 40,
  netWpm: 36,
  accuracy: 0.9,
  consistency: 0.8,
  activeMs: 6_000,
  feedback: { good: "good", bottleneck: "bottleneck", next: "next" }
};

describe("persisted JSON schemas", () => {
  test("accepts internally consistent test evidence and rejects mismatched counts", () => {
    expect(
      persistedTestErrorsSchema.safeParse({ count: 0, topConfusions: [], events: [] }).success
    ).toBe(true);
    expect(persistedTestErrorsSchema.safeParse({}).success).toBe(false);
    expect(
      persistedTestErrorsSchema.safeParse({
        count: 2,
        topConfusions: [],
        events: [{ target: "a", actual: "s", physicalCode: "KeyS", position: 0 }]
      }).success
    ).toBe(false);
    expect(
      persistedTestErrorsSchema.safeParse({
        count: 101,
        topConfusions: [],
        events: Array.from({ length: 100 }, (_, position) => ({
          target: "a",
          actual: "s",
          physicalCode: "KeyS",
          position
        }))
      }).success
    ).toBe(true);
  });

  test("requires each ANSI physical code exactly once in a layout snapshot", () => {
    const snapshot = {
      version: 1,
      layout: { id: "layout", name: "Layout", preset: "symmetric" },
      mappings: snapshotMappings()
    } as const;
    expect(persistedLayoutSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      persistedLayoutSnapshotSchema.safeParse({
        ...snapshot,
        mappings: snapshot.mappings.slice(1)
      }).success
    ).toBe(false);
    expect(
      persistedLayoutSnapshotSchema.safeParse({
        ...snapshot,
        mappings: [...snapshot.mappings, snapshot.mappings[0]]
      }).success
    ).toBe(false);
    expect(
      persistedLayoutSnapshotSchema.safeParse({
        ...snapshot,
        mappings: [...snapshot.mappings, { ...snapshot.mappings[0], physical_code: "NotAnsi" }]
      }).success
    ).toBe(false);
    expect(
      persistedLayoutSnapshotSchema.safeParse({
        ...snapshot,
        mappings: snapshot.mappings.map((mapping) =>
          mapping.physical_code === "KeyC" ? { ...mapping, unshifted: "x" } : mapping
        )
      }).success
    ).toBe(false);
    expect(
      persistedLayoutSnapshotSchema.safeParse({
        ...snapshot,
        mappings: snapshot.mappings.map((mapping) =>
          mapping.physical_code === "KeyC"
            ? { ...mapping, hand: "right" as const, zone: "right-index" as const }
            : mapping
        )
      }).success
    ).toBe(false);
  });

  test("upcasts legitimate legacy settings but rejects truncated or invalid rows", () => {
    expect(persistedSettingsSchema.parse(legacySettings)).toMatchObject({
      keyboardFingerColors: true,
      progressionAccuracy: 0.975,
      experimentEnabled: false,
      advancedWeights: { accuracy: 0.34 }
    });
    expect(
      persistedSettingsSchema.parse({ ...legacySettings, advancedWeights: { accuracy: 0.5 } })
    ).toMatchObject({
      advancedWeights: {
        accuracy: 0.5,
        speed: 0.28,
        uncertainty: 0.12,
        transfer: 0.12,
        userFocus: 0.08,
        recovery: 0.06
      }
    });
    expect(persistedSettingsSchema.safeParse({}).success).toBe(false);
    expect(
      persistedSettingsSchema.safeParse({ ...legacySettings, progressionAccuracy: 0.5 }).success
    ).toBe(false);
  });

  test("upcasts legacy session accuracy without inventing analysis evidence", () => {
    expect(persistedSessionSummarySchema.parse(legacySummary)).toMatchObject({
      keystrokeAccuracy: 0.9,
      finalTextAccuracy: 0.9,
      longestAccurateStreak: 0,
      errorAnalysis: {
        version: 1,
        eventCount: 20,
        validTimingSamples: 0,
        evidence: { timing: { status: "insufficient", sampleCount: 0 } },
        textIssues: [],
        behavioralIssues: []
      }
    });
    expect(
      persistedSessionSummarySchema.parse({
        ...legacySummary,
        metricVersion: 1,
        uncorrectedErrors: 2
      })
    ).toMatchObject({ metricVersion: 1, uncorrectedErrors: 2 });
    expect(
      persistedSessionSummarySchema.safeParse({ ...legacySummary, metricVersion: 1 }).success
    ).toBe(false);
    expect(
      persistedSessionSummarySchema.safeParse({
        ...legacySummary,
        metricVersion: 1,
        uncorrectedErrors: 21
      }).success
    ).toBe(false);
    expect(
      persistedSessionSummarySchema.safeParse({
        ...legacySummary,
        errorAnalysis: { version: 1 }
      }).success
    ).toBe(false);
  });

  test("caps the robust feature window at forty finite observations", () => {
    expect(persistedFeatureWindowSchema.safeParse([0, 125, 3_000]).success).toBe(true);
    expect(
      persistedFeatureWindowSchema.safeParse(Array.from({ length: 41 }, () => 125)).success
    ).toBe(false);
    expect(persistedFeatureWindowSchema.safeParse([Number.NaN]).success).toBe(false);
  });
});
