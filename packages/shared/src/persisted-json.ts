import { z } from "zod";

import { SYMMETRIC_LAYOUT } from "./keyboard-layout.js";
import {
  runtimeDefaultAdvancedWeights,
  runtimeSessionSummarySchema,
  runtimeSettingsSchema,
  type RuntimeSettings
} from "./runtime-api.js";

const handSchema = z.enum(["left", "right", "thumb"]);
const fingerSchema = z.enum([
  "left-pinky",
  "left-ring",
  "left-middle",
  "left-index",
  "right-index",
  "right-middle",
  "right-ring",
  "right-pinky",
  "thumb"
]);
const keyboardRowSchema = z.enum(["number", "top", "home", "bottom", "space"]);

const ansiUsPhysicalCodes = Object.freeze(SYMMETRIC_LAYOUT.map(({ code }) => code));
const ansiUsPhysicalCodeSet = new Set(ansiUsPhysicalCodes);
const ansiUsPhysicalKeys = new Map(SYMMETRIC_LAYOUT.map((key) => [key.code, key]));

export const persistedLayoutSnapshotSchema = z
  .object({
    version: z.literal(1),
    layout: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      preset: z.enum(["symmetric", "standard", "custom"])
    }),
    mappings: z.array(
      z.object({
        physical_code: z.string().min(1),
        unshifted: z.string().max(4),
        shifted: z.string().max(4),
        hand: handSchema,
        finger: fingerSchema,
        keyboard_row: keyboardRowSchema,
        zone: fingerSchema,
        key_width: z.number().positive().max(8)
      })
    )
  })
  .superRefine(({ mappings }, context) => {
    const seen = new Set<string>();
    for (const [index, mapping] of mappings.entries()) {
      if (seen.has(mapping.physical_code)) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index, "physical_code"],
          message: `Duplicate ANSI physical code: ${mapping.physical_code}`
        });
      }
      seen.add(mapping.physical_code);
      if (!ansiUsPhysicalCodeSet.has(mapping.physical_code)) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index, "physical_code"],
          message: `Unknown ANSI physical code: ${mapping.physical_code}`
        });
        continue;
      }
      const physical = ansiUsPhysicalKeys.get(mapping.physical_code);
      if (!physical) continue;
      if (
        mapping.unshifted !== (physical.unshifted ?? "") ||
        mapping.shifted !== (physical.shifted ?? "") ||
        mapping.keyboard_row !== physical.row ||
        mapping.key_width !== physical.width
      ) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index],
          message: `ANSI physical key geometry or characters changed: ${mapping.physical_code}`
        });
      }
      const expectedHand = mapping.finger === "thumb" ? "thumb" : mapping.finger.split("-")[0];
      if (mapping.hand !== expectedHand || mapping.zone !== mapping.finger) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index, "finger"],
          message: `Finger, hand, and zone do not agree: ${mapping.physical_code}`
        });
      }
    }
    for (const code of ansiUsPhysicalCodes) {
      if (!seen.has(code)) {
        context.addIssue({
          code: "custom",
          path: ["mappings"],
          message: `Missing ANSI physical code: ${code}`
        });
      }
    }
  });

export const persistedLessonFocusSchema = z.array(z.string().min(1).max(128)).max(256);
export const persistedFeatureWindowSchema = z.array(z.number().finite().min(0).max(3_000)).max(40);
export const persistedModifiersSchema = z.record(z.string(), z.boolean());

/**
 * Settings stored before progression/experiments/finger-colour preferences were
 * introduced did not carry a schema discriminator. Requiring the complete
 * original settings surface distinguishes a legitimate legacy row from a
 * truncated object such as `{}`; only the later fields are upcast.
 */
const persistedSettingsLegacyV1Schema = z
  .object({
    onboardingComplete: z.boolean(),
    calibrationComplete: z.boolean(),
    theme: z.enum(["system", "light", "dark"]),
    reducedMotion: z.boolean(),
    keyboardVisible: z.boolean(),
    soundEnabled: z.boolean(),
    soundTheme: z.enum(["soft", "mechanical", "terminal"]),
    soundMode: z.enum(["all", "keys", "errors"]),
    volume: z.number().min(0).max(1),
    activeLayoutId: z.string().trim().min(1).max(128),
    stopOnError: z.boolean(),
    backspaceMode: z.enum(["enabled", "disabled", "words"]),
    fontSize: z.number().int().min(18).max(52),
    lineHeight: z.number().min(1.2).max(2.2),
    caretStyle: z.enum(["bar", "block", "underline"]),
    smoothScroll: z.boolean(),
    targetWpm: z.number().min(5).max(250),
    minimumAccuracy: z.number().min(0.5).max(1),
    trainingBias: z.enum(["accuracy", "balanced", "speed"]),
    defaultDurationMinutes: z.number().int().min(2).max(120),
    keyboardFingerColors: z.boolean().optional(),
    progressionAccuracy: z.number().min(0.5).max(1).optional(),
    experimentEnabled: z.boolean().optional(),
    advancedWeights: z.record(z.string(), z.number().min(0).max(2)).optional()
  })
  .passthrough()
  .transform((legacy): RuntimeSettings => {
    const minimumAccuracy = legacy.minimumAccuracy;
    return {
      ...legacy,
      keyboardFingerColors: legacy.keyboardFingerColors ?? true,
      progressionAccuracy: legacy.progressionAccuracy ?? Math.max(minimumAccuracy, 0.975),
      experimentEnabled: legacy.experimentEnabled ?? false,
      advancedWeights: {
        ...runtimeDefaultAdvancedWeights,
        ...(legacy.advancedWeights ?? {})
      }
    };
  })
  .pipe(runtimeSettingsSchema);

export const persistedSettingsSchema = z.union([
  runtimeSettingsSchema,
  persistedSettingsLegacyV1Schema
]);

const persistedErrorAnalysisEvidenceSchema = z.object({
  status: z.enum(["insufficient", "limited", "sufficient"]),
  sampleCount: z.number().int().nonnegative(),
  minimumSamples: z.number().int().nonnegative()
});
const persistedErrorAnalysisIssueSchema = z.object({
  kind: z.enum([
    "transposition",
    "adjacent-key-confusion",
    "number-symbol-confusion",
    "shift-error",
    "substitution",
    "omission",
    "repeat",
    "insertion",
    "correct-but-slow",
    "post-error-slowdown",
    "slow-bigram",
    "slow-trigram",
    "same-finger-cross-row",
    "hand-imbalance",
    "finger-imbalance",
    "shift-use-error",
    "error-burst",
    "suspected-fatigue"
  ]),
  count: z.number().int().nonnegative(),
  topFeatures: z.array(
    z.object({
      feature: z.string(),
      count: z.number().int().nonnegative(),
      severity: z.number().finite()
    })
  )
});
const persistedErrorAnalysisSchema = z.object({
  version: z.literal(1),
  eventCount: z.number().int().nonnegative(),
  validTimingSamples: z.number().int().nonnegative(),
  baselineIkiMs: z.number().finite().nullable(),
  evidence: z.object({
    text: persistedErrorAnalysisEvidenceSchema,
    timing: persistedErrorAnalysisEvidenceSchema,
    combinations: persistedErrorAnalysisEvidenceSchema,
    balance: persistedErrorAnalysisEvidenceSchema,
    shift: persistedErrorAnalysisEvidenceSchema,
    fatigue: persistedErrorAnalysisEvidenceSchema
  }),
  textIssues: z.array(persistedErrorAnalysisIssueSchema),
  behavioralIssues: z.array(persistedErrorAnalysisIssueSchema)
});

function legacyUnavailableErrorAnalysis(eventCount: number) {
  const evidence = (minimumSamples: number) => ({
    status: "insufficient" as const,
    sampleCount: 0,
    minimumSamples
  });
  return {
    version: 1 as const,
    eventCount,
    validTimingSamples: 0,
    baselineIkiMs: null,
    evidence: {
      text: evidence(1),
      timing: evidence(5),
      combinations: evidence(8),
      balance: evidence(10),
      shift: evidence(1),
      fatigue: evidence(18)
    },
    textIssues: [],
    behavioralIssues: []
  };
}

const persistedSessionSummaryCurrentSchema = runtimeSessionSummarySchema
  .extend({
    errorAnalysis: persistedErrorAnalysisSchema,
    metricVersion: z.literal(1).optional(),
    uncorrectedErrors: z.number().int().nonnegative().optional(),
    subjectiveFeedback: z
      .object({
        difficulty: z.number().int().min(1).max(5),
        fatigue: z.number().int().min(1).max(5),
        savedAt: z.string().datetime({ offset: true })
      })
      .optional()
  })
  .passthrough()
  .superRefine((summary, context) => {
    const hasVersion = summary.metricVersion != null;
    const hasErrorCount = summary.uncorrectedErrors != null;
    if (hasVersion !== hasErrorCount) {
      context.addIssue({
        code: "custom",
        path: [hasVersion ? "uncorrectedErrors" : "metricVersion"],
        message: "Session metric evidence must include both version and uncorrected error count"
      });
    }
    if (summary.uncorrectedErrors != null && summary.uncorrectedErrors > summary.characters) {
      context.addIssue({
        code: "custom",
        path: ["uncorrectedErrors"],
        message: "Uncorrected error count cannot exceed session characters"
      });
    }
  });

/**
 * Session summaries written before dual accuracy and error-analysis fields were
 * added are structurally version 0. Their accuracy can be preserved exactly;
 * unavailable derived evidence is represented explicitly instead of treating
 * the whole row as corruption or inventing analysis.
 */
const persistedSessionSummaryLegacyV0Schema = runtimeSessionSummarySchema
  .omit({
    keystrokeAccuracy: true,
    finalTextAccuracy: true,
    errorAnalysis: true,
    longestAccurateStreak: true
  })
  .extend({
    keystrokeAccuracy: z.number().min(0).max(1).optional(),
    finalTextAccuracy: z.number().min(0).max(1).optional(),
    longestAccurateStreak: z.number().int().nonnegative().optional(),
    errorAnalysis: persistedErrorAnalysisSchema.optional(),
    subjectiveFeedback: z
      .object({
        difficulty: z.number().int().min(1).max(5),
        fatigue: z.number().int().min(1).max(5),
        savedAt: z.string().datetime({ offset: true })
      })
      .optional()
  })
  .passthrough()
  .transform((legacy) => ({
    ...legacy,
    keystrokeAccuracy: legacy.keystrokeAccuracy ?? legacy.accuracy,
    finalTextAccuracy: legacy.finalTextAccuracy ?? legacy.accuracy,
    longestAccurateStreak: legacy.longestAccurateStreak ?? 0,
    errorAnalysis: legacy.errorAnalysis ?? legacyUnavailableErrorAnalysis(legacy.characters)
  }))
  .pipe(persistedSessionSummaryCurrentSchema);

export const persistedSessionSummarySchema = z.union([
  persistedSessionSummaryCurrentSchema,
  persistedSessionSummaryLegacyV0Schema
]);

export const persistedTestErrorsSchema = z
  .object({
    count: z.number().int().nonnegative(),
    truncated: z.boolean().optional(),
    topConfusions: z
      .array(
        z.object({
          target: z.string(),
          actual: z.string(),
          physicalCode: z.string().min(1),
          count: z.number().int().positive()
        })
      )
      .max(20),
    events: z
      .array(
        z.object({
          target: z.string(),
          actual: z.string(),
          physicalCode: z.string().min(1),
          position: z.number().int().nonnegative()
        })
      )
      .max(100)
  })
  .superRefine((value, context) => {
    const evidenceIsComplete = value.count === value.events.length;
    const evidenceIsLegacyCapped = value.count > 100 && value.events.length === 100;
    if (!evidenceIsComplete && !evidenceIsLegacyCapped) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "Error count must match the stored events or an explicit 100-event cap"
      });
    }
    if (value.truncated === true && !evidenceIsLegacyCapped) {
      context.addIssue({
        code: "custom",
        path: ["truncated"],
        message: "truncated is only valid when more than 100 errors were capped"
      });
    }
    if (value.truncated === false && !evidenceIsComplete) {
      context.addIssue({
        code: "custom",
        path: ["truncated"],
        message: "A non-truncated error list must contain every counted event"
      });
    }
    const representedConfusions = value.topConfusions.reduce(
      (sum, confusion) => sum + confusion.count,
      0
    );
    if (representedConfusions > value.count) {
      context.addIssue({
        code: "custom",
        path: ["topConfusions"],
        message: "Confusion counts cannot exceed the total error count"
      });
    }
  })
  .transform((value) => ({
    ...value,
    truncated: value.truncated ?? value.count > value.events.length
  }));

export const persistedGameLevelSummarySchema = z
  .object({
    cycle: z.number().int().positive(),
    errorFree: z.boolean().optional(),
    sessionId: z.string().uuid().optional(),
    failureReason: z.enum(["alert-maxed", "timeout", "accuracy-gate"]).optional()
  })
  .passthrough();

export const persistedJsonObjectSchema = z.record(z.string(), z.unknown());

export type PersistedLayoutSnapshot = z.infer<typeof persistedLayoutSnapshotSchema>;
export type PersistedSessionSummary = z.infer<typeof persistedSessionSummarySchema>;
export type PersistedTestErrors = z.infer<typeof persistedTestErrorsSchema>;
