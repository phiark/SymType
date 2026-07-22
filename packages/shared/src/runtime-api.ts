import { z } from "zod";

/**
 * Authoritative contracts for the current same-origin `/api/v1` runtime.
 *
 * SQLite/domain rows deliberately keep their existing snake_case fields. The
 * browser and Fastify import these exact schemas so a route cannot silently
 * drift behind a TypeScript assertion. This module is the sole current shared
 * contract surface.
 */

export const runtimeEntityIdSchema = z.string().trim().min(1).max(128);
export const runtimeUuidSchema = z.string().uuid();
export const runtimeUuidIdParamsSchema = z.object({ id: runtimeUuidSchema }).strict();
export const runtimeLessonIdParamsSchema = z.object({ lessonId: runtimeUuidSchema }).strict();
export const runtimeLayoutIdParamsSchema = z
  .object({ id: z.string().trim().min(1).max(80) })
  .strict();
export const runtimeCsrfQuerySchema = z
  .object({ csrf: z.string().min(1).max(256).optional() })
  .strict();
export const runtimeLongFormSourceIdSchema = z.union([
  runtimeUuidSchema,
  z.string().regex(/^builtin-long-form:[a-z0-9][a-z0-9-]*$/u)
]);
export const runtimeIsoDateTimeSchema = z.iso.datetime({ offset: true });
const runtimeNullableNumberSchema = z.number().finite().nullable();

export const runtimeSettingsLimits = Object.freeze({
  targetWpm: Object.freeze({ min: 5, max: 250, step: 1 }),
  accuracy: Object.freeze({ min: 0.5, max: 1, step: 0.005 }),
  defaultDurationMinutes: Object.freeze({ min: 2, max: 120, step: 1 }),
  dailyMinutes: Object.freeze({ min: 1, max: 240, step: 1 }),
  advancedWeight: Object.freeze({ min: 0, max: 2, step: 0.01 })
});

export const runtimeAdvancedWeightKeys = [
  "accuracy",
  "speed",
  "uncertainty",
  "transfer",
  "userFocus",
  "recovery"
] as const;

export const runtimeDefaultAdvancedWeights = Object.freeze({
  accuracy: 0.34,
  speed: 0.28,
  uncertainty: 0.12,
  transfer: 0.12,
  userFocus: 0.08,
  recovery: 0.06
});

export const runtimeAdvancedWeightsSchema = z
  .object({
    accuracy: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max),
    speed: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max),
    uncertainty: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max),
    transfer: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max),
    userFocus: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max),
    recovery: z
      .number()
      .min(runtimeSettingsLimits.advancedWeight.min)
      .max(runtimeSettingsLimits.advancedWeight.max)
  })
  .strict();

export const runtimeApiErrorSchema = z.object({
  error: z
    .object({
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(500)
    })
    .passthrough()
});

export const runtimeHealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("symtype"),
  version: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
  algorithmVersion: z.string().min(1),
  integrity: z.object({ ok: z.boolean(), detail: z.string() }),
  time: runtimeIsoDateTimeSchema
});

const runtimeSettingsObjectSchema = z.object({
  onboardingComplete: z.boolean(),
  calibrationComplete: z.boolean(),
  theme: z.enum(["system", "light", "dark"]),
  reducedMotion: z.boolean(),
  keyboardVisible: z.boolean(),
  keyboardFingerColors: z.boolean(),
  soundEnabled: z.boolean(),
  soundTheme: z.enum(["soft", "mechanical", "terminal"]),
  soundMode: z.enum(["all", "keys", "errors"]),
  volume: z.number().min(0).max(1),
  activeLayoutId: runtimeEntityIdSchema,
  stopOnError: z.boolean(),
  backspaceMode: z.enum(["enabled", "disabled", "words"]),
  fontSize: z.number().int().min(18).max(52),
  lineHeight: z.number().min(1.2).max(2.2),
  caretStyle: z.enum(["bar", "block", "underline"]),
  smoothScroll: z.boolean(),
  targetWpm: z
    .number()
    .min(runtimeSettingsLimits.targetWpm.min)
    .max(runtimeSettingsLimits.targetWpm.max),
  minimumAccuracy: z
    .number()
    .min(runtimeSettingsLimits.accuracy.min)
    .max(runtimeSettingsLimits.accuracy.max),
  progressionAccuracy: z
    .number()
    .min(runtimeSettingsLimits.accuracy.min)
    .max(runtimeSettingsLimits.accuracy.max),
  trainingBias: z.enum(["accuracy", "balanced", "speed"]),
  defaultDurationMinutes: z
    .number()
    .int()
    .min(runtimeSettingsLimits.defaultDurationMinutes.min)
    .max(runtimeSettingsLimits.defaultDurationMinutes.max),
  experimentEnabled: z.boolean(),
  advancedWeights: runtimeAdvancedWeightsSchema
});

export const runtimeSettingsSchema = runtimeSettingsObjectSchema.refine(
  (value) => value.progressionAccuracy >= value.minimumAccuracy,
  {
    path: ["progressionAccuracy"],
    message: "progressionAccuracy cannot be lower than minimumAccuracy"
  }
);

export const runtimeSettingsPatchSchema = runtimeSettingsObjectSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");

export const runtimeProfileRecordSchema = z
  .object({
    id: runtimeEntityIdSchema,
    display_name: z.string().min(1).max(160)
  })
  .passthrough();

export const runtimeGoalRecordSchema = z
  .object({
    daily_minutes: z
      .number()
      .int()
      .min(runtimeSettingsLimits.dailyMinutes.min)
      .max(runtimeSettingsLimits.dailyMinutes.max),
    target_wpm: z
      .number()
      .min(runtimeSettingsLimits.targetWpm.min)
      .max(runtimeSettingsLimits.targetWpm.max),
    minimum_accuracy: z
      .number()
      .min(runtimeSettingsLimits.accuracy.min)
      .max(runtimeSettingsLimits.accuracy.max)
  })
  .passthrough();

export const runtimeGoalInputSchema = z.object({
  dailyMinutes: z
    .number()
    .int()
    .min(runtimeSettingsLimits.dailyMinutes.min)
    .max(runtimeSettingsLimits.dailyMinutes.max),
  targetWpm: z
    .number()
    .min(runtimeSettingsLimits.targetWpm.min)
    .max(runtimeSettingsLimits.targetWpm.max),
  minimumAccuracy: z
    .number()
    .min(runtimeSettingsLimits.accuracy.min)
    .max(runtimeSettingsLimits.accuracy.max)
});

export const runtimeKeyboardMappingRecordSchema = z
  .object({
    physical_code: z.string().min(1).max(40),
    unshifted: z.string().max(4),
    shifted: z.string().max(4),
    hand: z.string().min(1).max(20),
    finger: z.string().min(1).max(32),
    keyboard_row: z.string().min(1).max(20),
    zone: z.string().min(1).max(32),
    key_width: z.number().positive()
  })
  .passthrough();

export const runtimeKeyboardLayoutRecordSchema = z
  .object({
    id: runtimeEntityIdSchema,
    name: z.string().min(1).max(160),
    preset: z.enum(["symmetric", "standard", "custom"]),
    is_active: z.union([z.literal(0), z.literal(1)]),
    mappings: z.array(runtimeKeyboardMappingRecordSchema)
  })
  .passthrough();

export const runtimeContentModeSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000)
  })
  .passthrough();

export const runtimeGameLevelDefinitionSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    level: z.number().int().min(1).max(6),
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000),
    objective: z.string().min(1).max(2_000)
  })
  .passthrough();

export const runtimeBootstrapResponseSchema = z.object({
  csrfToken: z.string().min(1).max(256),
  profile: runtimeProfileRecordSchema,
  settings: runtimeSettingsSchema,
  layouts: z.array(runtimeKeyboardLayoutRecordSchema),
  goal: runtimeGoalRecordSchema,
  contentModes: z.array(runtimeContentModeSchema),
  gameLevels: z.array(runtimeGameLevelDefinitionSchema),
  algorithmVersion: z.string().min(1),
  dataLocation: z.string().min(1),
  storageAuthority: z.literal("server-sqlite")
});

export const runtimeProfileResponseSchema = z.object({ profile: runtimeProfileRecordSchema });
export const runtimeSettingsResponseSchema = z.object({ settings: runtimeSettingsSchema });
export const runtimePreferencesRequestSchema = z.object({
  settings: runtimeSettingsPatchSchema,
  goal: runtimeGoalInputSchema
});
export const runtimePreferencesResponseSchema = z.object({
  settings: runtimeSettingsSchema,
  goal: runtimeGoalRecordSchema
});

export const runtimeLayoutsResponseSchema = z.object({
  layouts: z.array(runtimeKeyboardLayoutRecordSchema)
});
export const runtimeCreateLayoutRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    baseLayoutId: runtimeEntityIdSchema
  })
  .strict();
export const runtimeCreateLayoutResponseSchema = z.object({
  id: runtimeUuidSchema,
  layouts: z.array(runtimeKeyboardLayoutRecordSchema)
});
const runtimeMappingFingerSchema = z.enum([
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
export const runtimeReplaceLayoutMappingsRequestSchema = z
  .object({
    mappings: z
      .array(
        z
          .object({
            code: z.string().min(1).max(40),
            unshifted: z.string().max(4),
            shifted: z.string().max(4),
            hand: z.enum(["left", "right", "thumb"]),
            finger: runtimeMappingFingerSchema,
            row: z.enum(["number", "top", "home", "bottom", "space"]),
            zone: runtimeMappingFingerSchema,
            width: z.number().positive().max(8)
          })
          .strict()
      )
      .min(30)
      .max(110)
  })
  .strict();

export const runtimeCreateSessionSchema = z.object({
  kind: z.enum(["calibration", "training", "test", "game"]),
  mode: z.string().min(1).max(64),
  strategy: z.enum(["adaptive", "baseline"]).default("adaptive"),
  seed: z.number().int().min(0).max(2_147_483_647),
  focus: z.array(z.string().max(32)).max(128).default([]),
  stageId: z
    .enum(["home", "index", "other", "top", "bottom", "numbers", "symbols", "shift"])
    .optional(),
  includeInModel: z.boolean().default(true)
});

export const runtimeCreatedSessionSchema = z.object({
  id: runtimeUuidSchema,
  lessonId: runtimeUuidSchema,
  strategy: z.enum(["adaptive", "baseline"]),
  status: z.literal("active"),
  startedAt: runtimeIsoDateTimeSchema
});
export const runtimeCreateSessionResponseSchema = z.object({
  session: runtimeCreatedSessionSchema
});

export const runtimeMicroBlockRecordSchema = z
  .object({
    id: runtimeUuidSchema,
    lesson_id: runtimeUuidSchema,
    block_index: z.number().int().nonnegative(),
    block_type: z.string().min(1).max(128),
    target_text: z.string(),
    seed: z.number().int(),
    rationale: z.string(),
    source_text_id: runtimeLongFormSourceIdSchema.nullable().optional(),
    source_start: z.number().int().nonnegative().nullable().optional(),
    source_length: z.number().int().nonnegative().nullable().optional(),
    resume_position: z.number().int().nonnegative().optional()
  })
  .passthrough();

export const runtimeSessionRecordSchema = z
  .object({
    id: runtimeUuidSchema,
    kind: z.enum(["calibration", "training", "test", "game"]),
    mode: z.string().min(1).max(64),
    strategy: z.enum(["adaptive", "baseline"]),
    status: z.enum(["active", "paused", "completed", "abandoned"]),
    next_sequence: z.number().int().nonnegative(),
    lesson: z
      .object({ blocks: z.array(runtimeMicroBlockRecordSchema) })
      .passthrough()
      .nullable()
  })
  .passthrough();
export const runtimeSessionResponseSchema = z.object({ session: runtimeSessionRecordSchema });

export const runtimeStoredEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  clientTimeMs: z.number().nonnegative(),
  targetChar: z.string().max(8),
  actualChar: z.string().max(8),
  physicalCode: z.string().min(1).max(40),
  shiftSide: z.enum(["left", "right", "both", "none"]).default("none"),
  modifiers: z.record(z.string(), z.boolean()).default({}),
  isCorrect: z.boolean(),
  isCorrection: z.boolean().default(false),
  backspaceCount: z.number().int().nonnegative().max(100).default(0),
  ikiMs: z.number().nonnegative().max(120_000).nullable().default(null),
  featureChar: z.string().max(8).optional(),
  bigram: z.string().max(16).nullable().default(null),
  trigram: z.string().max(24).nullable().default(null),
  mappedHand: z.string().max(20).default("unknown"),
  mappedFinger: z.string().max(32).default("unknown"),
  keyboardRow: z.string().max(20).default("unknown"),
  zone: z.string().max(32).default("unknown"),
  characterClass: z.string().max(24).default("unknown"),
  contentMode: z.string().max(64).default("unknown"),
  textPosition: z.number().int().nonnegative(),
  isWordBoundary: z.boolean().default(false),
  isAfterError: z.boolean().default(false),
  wasRefocus: z.boolean().default(false),
  wasPaused: z.boolean().default(false),
  wasLongPause: z.boolean().default(false),
  wasThrottled: z.boolean().default(false),
  wasRepeat: z.boolean().default(false)
});

export const runtimeEventBatchSchema = z
  .object({
    batchId: runtimeUuidSchema,
    lessonId: runtimeUuidSchema.optional(),
    blockId: runtimeUuidSchema.optional(),
    events: z.array(runtimeStoredEventSchema).max(100)
  })
  .superRefine((batch, context) => {
    for (let index = 1; index < batch.events.length; index += 1) {
      const previous = batch.events[index - 1];
      const current = batch.events[index];
      if (previous && current && current.sequence <= previous.sequence) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message: "Event sequences must be strictly increasing"
        });
      }
    }
  });

export const runtimeEventBatchResponseSchema = z.object({
  result: z.object({
    duplicate: z.boolean(),
    accepted: z.number().int().nonnegative(),
    checkpoint: z.number().int().min(-1)
  })
});

export const runtimePauseSessionRequestSchema = z.object({ paused: z.boolean() });
export const runtimePauseSessionResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["paused", "active"])
});
export const runtimeCompleteSessionRequestSchema = z.object({
  activeMs: z.number().int().nonnegative().max(43_200_000).optional()
});

const runtimeErrorAnalysisEvidenceSchema = z.object({
  status: z.enum(["insufficient", "limited", "sufficient"]),
  sampleCount: z.number().int().nonnegative(),
  minimumSamples: z.number().int().nonnegative()
});
const runtimeErrorAnalysisIssueSchema = z.object({
  kind: z.string().min(1).max(80),
  count: z.number().int().nonnegative(),
  topFeatures: z.array(
    z.object({
      feature: z.string(),
      count: z.number().int().nonnegative(),
      severity: z.number().finite()
    })
  )
});
export const runtimeErrorAnalysisSchema = z.object({
  version: z.literal(1),
  eventCount: z.number().int().nonnegative(),
  validTimingSamples: z.number().int().nonnegative(),
  baselineIkiMs: runtimeNullableNumberSchema,
  evidence: z.record(z.string(), runtimeErrorAnalysisEvidenceSchema),
  textIssues: z.array(runtimeErrorAnalysisIssueSchema),
  behavioralIssues: z.array(runtimeErrorAnalysisIssueSchema)
});

export const runtimeSessionSummarySchema = z.object({
  characters: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  rawWpm: z.number().nonnegative(),
  netWpm: z.number().nonnegative(),
  keystrokeAccuracy: z.number().min(0).max(1),
  finalTextAccuracy: z.number().min(0).max(1),
  accuracy: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1),
  activeMs: z.number().int().nonnegative(),
  longestAccurateStreak: z.number().int().nonnegative(),
  feedback: z.object({ good: z.string(), bottleneck: z.string(), next: z.string() }),
  errorAnalysis: runtimeErrorAnalysisSchema
});
export const runtimeCompleteSessionResponseSchema = z.object({
  saved: z.literal(true),
  summary: runtimeSessionSummarySchema
});

export const runtimeSessionFeedbackRequestSchema = z.object({
  difficulty: z.number().int().min(1).max(5),
  fatigue: z.number().int().min(1).max(5)
});
export const runtimeSessionFeedbackResponseSchema = z.object({
  feedback: z.object({
    difficulty: z.number().int().min(1).max(5),
    fatigue: z.number().int().min(1).max(5)
  })
});
export const runtimeRecoverSessionRequestSchema = z.object({
  disposition: z.enum(["complete", "abandon"]).default("complete"),
  activeMs: z.number().int().nonnegative().max(43_200_000).optional()
});
export const runtimeRecoverSessionResponseSchema = z
  .object({
    recovered: z.boolean(),
    status: z.enum(["completed", "abandoned"]),
    summary: runtimeSessionSummarySchema
  })
  .passthrough();
export const runtimeOkResponseSchema = z.object({ ok: z.literal(true) }).passthrough();

export const runtimeNextBlockSchema = z.object({
  blockIndex: z.number().int().min(0).max(200),
  seed: z.number().int().min(0).max(2_147_483_647),
  mode: z.string().min(1).max(64),
  length: z.number().int().min(20).max(120).default(48),
  focus: z.array(z.string().max(32)).max(128).default([]),
  scopeLabels: z.array(z.string().min(1).max(32)).max(32).default([]),
  allowedCharacters: z
    .array(
      z
        .string()
        .min(1)
        .max(8)
        .refine((value) => [...value].length === 1)
    )
    .max(128)
    .default([]),
  strictScope: z.boolean().default(false),
  gameRunId: runtimeUuidSchema.optional(),
  gameStage: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  customTextId: runtimeUuidSchema.optional(),
  calibrationCategory: z
    .enum(["letters", "bigrams", "index", "digits", "symbols", "shift"])
    .optional(),
  phase: z.enum(["warmup", "focus", "retest", "transfer", "fluency", "explore"]).default("focus")
});

export const runtimeNextBlockResponseSchema = z.object({
  block: runtimeMicroBlockRecordSchema,
  adaptiveDebug: z
    .object({
      strategy: z.enum(["adaptive", "baseline"]),
      selectedFeatures: z.array(z.string()),
      selectedFeatureValues: z.array(z.string()),
      explanations: z.array(z.string()),
      candidateIds: z.array(z.string()),
      scopeLabels: z.array(z.string()),
      allowedCharacters: z.array(z.string()),
      strictScope: z.boolean()
    })
    .passthrough()
});

export const runtimeStatisticsQuerySchema = z
  .object({
    period: z.enum(["today", "7d", "30d", "all"]).default("7d")
  })
  .strict();
const runtimeOverviewSchema = z.object({
  sessions: z.number().int().nonnegative(),
  active_ms: z.number().nonnegative(),
  characters: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  raw_wpm: runtimeNullableNumberSchema,
  net_wpm: runtimeNullableNumberSchema,
  keystroke_accuracy: runtimeNullableNumberSchema,
  consistency: runtimeNullableNumberSchema,
  stable_wpm: runtimeNullableNumberSchema,
  timing_samples: z.number().int().nonnegative()
});
const runtimeFeatureStatisticSchema = z
  .object({
    feature_type: z.string().min(1),
    feature_value: z.string(),
    sample_count: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
    short_iki_ms: runtimeNullableNumberSchema,
    long_iki_ms: runtimeNullableNumberSchema,
    iki_mad_ms: runtimeNullableNumberSchema,
    learning_slope: runtimeNullableNumberSchema,
    last_practiced_at: runtimeIsoDateTimeSchema.nullable()
  })
  .passthrough();
const runtimeExperimentGroupSchema = z.object({
  strategy: z.enum(["adaptive", "baseline"]),
  sessions: z.number().int().nonnegative(),
  days: z.number().int().nonnegative(),
  activeMinutes: z.number().nonnegative(),
  characters: z.number().int().nonnegative(),
  correctCharacters: z.number().int().nonnegative(),
  exposureEvents: z.number().int().nonnegative(),
  netWpm: runtimeNullableNumberSchema,
  accuracy: runtimeNullableNumberSchema,
  accuracy95HalfWidth: runtimeNullableNumberSchema,
  effectiveCorrectCharactersPerMinute: runtimeNullableNumberSchema,
  transferGapWpm: runtimeNullableNumberSchema,
  subjectiveDifficulty: runtimeNullableNumberSchema,
  subjectiveFatigue: runtimeNullableNumberSchema,
  subjectiveSamples: z.number().int().nonnegative(),
  exitRate: runtimeNullableNumberSchema,
  brierScore: runtimeNullableNumberSchema,
  logLoss: runtimeNullableNumberSchema,
  thresholdTargetWpm: z.number().positive(),
  thresholdTargetAccuracy: z.number().min(0).max(1),
  thresholdMinimumTimingSamples: z.number().int().positive(),
  thresholdSessionsEvaluated: z.number().int().nonnegative(),
  thresholdTimingEligibleSessions: z.number().int().nonnegative(),
  thresholdReachedAt: runtimeIsoDateTimeSchema.nullable(),
  correctCharactersToThreshold: z.number().int().nonnegative().nullable(),
  activeMinutesToThreshold: z.number().nonnegative().nullable(),
  retention: z.object({
    "24h": z.object({
      status: z.enum(["insufficient", "descriptive"]),
      pairCount: z.number().int().nonnegative(),
      minimumPairs: z.number().int().positive(),
      baselineCharacters: z.number().int().nonnegative(),
      retestCharacters: z.number().int().nonnegative(),
      timingPairCount: z.number().int().nonnegative(),
      accuracyDelta: runtimeNullableNumberSchema,
      stableWpmDelta: runtimeNullableNumberSchema
    }),
    "72h": z.object({
      status: z.enum(["insufficient", "descriptive"]),
      pairCount: z.number().int().nonnegative(),
      minimumPairs: z.number().int().positive(),
      baselineCharacters: z.number().int().nonnegative(),
      retestCharacters: z.number().int().nonnegative(),
      timingPairCount: z.number().int().nonnegative(),
      accuracyDelta: runtimeNullableNumberSchema,
      stableWpmDelta: runtimeNullableNumberSchema
    }),
    "7d": z.object({
      status: z.enum(["insufficient", "descriptive"]),
      pairCount: z.number().int().nonnegative(),
      minimumPairs: z.number().int().positive(),
      baselineCharacters: z.number().int().nonnegative(),
      retestCharacters: z.number().int().nonnegative(),
      timingPairCount: z.number().int().nonnegative(),
      accuracyDelta: runtimeNullableNumberSchema,
      stableWpmDelta: runtimeNullableNumberSchema
    })
  }),
  postErrorRecoverySamples: z.number().int().nonnegative(),
  postErrorRecoveryMs: runtimeNullableNumberSchema,
  calibrationSampleCount: z.number().int().nonnegative(),
  calibrationMinimumSamples: z.number().int().positive(),
  calibrationExpectedError: runtimeNullableNumberSchema,
  calibrationBuckets: z.array(
    z.object({
      lower: z.number().min(0).max(1),
      upper: z.number().min(0).max(1),
      sampleCount: z.number().int().nonnegative(),
      meanPredicted: runtimeNullableNumberSchema,
      observedAccuracy: runtimeNullableNumberSchema,
      absoluteGap: runtimeNullableNumberSchema
    })
  ),
  weaknessChange: z.object({
    status: z.enum(["insufficient", "limited", "descriptive"]),
    featureCount: z.number().int().nonnegative(),
    minimumFeatures: z.number().int().positive(),
    exposureEvents: z.number().int().nonnegative(),
    improvedFeatureCount: z.number().int().nonnegative(),
    accuracyDelta: runtimeNullableNumberSchema,
    medianIkiDeltaMs: runtimeNullableNumberSchema
  })
});
export const runtimeStatisticsResponseSchema = z.object({
  period: z.enum(["today", "7d", "30d", "all"]),
  since: runtimeIsoDateTimeSchema,
  sinceLocalDate: z.iso.date(),
  overview: runtimeOverviewSchema,
  trend: z.array(
    z.object({
      local_date: z.iso.date(),
      kind: z.string(),
      active_ms: z.number().nonnegative(),
      character_count: z.number().int().nonnegative(),
      net_wpm: z.number().nonnegative(),
      raw_wpm: z.number().nonnegative(),
      accuracy: z.number().min(0).max(1),
      consistency: z.number().min(0).max(1)
    })
  ),
  features: z.array(runtimeFeatureStatisticSchema),
  confusion: z.array(
    z.object({
      target_char: z.string(),
      actual_char: z.string(),
      count: z.number().int().nonnegative()
    })
  ),
  groups: z.array(
    z
      .object({
        hand: z.string(),
        finger: z.string(),
        row: z.string(),
        zone: z.string(),
        class: z.string(),
        shift_side: z.string(),
        samples: z.number().int().positive(),
        accuracy: z.number().min(0).max(1),
        mean_iki_ms: runtimeNullableNumberSchema,
        median_iki_ms: runtimeNullableNumberSchema,
        iki_mad_ms: runtimeNullableNumberSchema,
        timing_samples: z.number().int().nonnegative()
      })
      .passthrough()
  ),
  recentErrors: z.array(
    z.object({
      session_id: runtimeUuidSchema,
      text_position: z.number().int().nonnegative(),
      target_char: z.string(),
      actual_char: z.string(),
      physical_code: z.string(),
      server_time: runtimeIsoDateTimeSchema
    })
  ),
  shiftSummary: z.object({
    left: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    both: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    sameHand: z.number().int().nonnegative(),
    capsLock: z.number().int().nonnegative()
  }),
  errorAnalysis: runtimeErrorAnalysisSchema,
  experiment: z.object({
    enabled: z.boolean(),
    assignment: z.enum(["disabled", "balanced-by-local-date"]),
    minimumDays: z.number().int().positive(),
    daysObserved: z.number().int().nonnegative(),
    eligibleForComparison: z.boolean(),
    conclusion: z.string(),
    groups: z.array(runtimeExperimentGroupSchema)
  })
});

export const runtimeDashboardResponseSchema = z.object({
  goal: runtimeGoalRecordSchema,
  streak: z
    .object({
      current_days: z.number().int().nonnegative(),
      longest_days: z.number().int().nonnegative(),
      last_training_date: z.iso.date().nullable()
    })
    .passthrough(),
  today: z.object({
    active_ms: z.number().nonnegative(),
    sessions: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
    net_wpm: z.number().nonnegative()
  }),
  trend: z.array(
    z.object({
      local_date: z.iso.date(),
      active_ms: z.number().nonnegative(),
      characters: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
      net_wpm: z.number().nonnegative()
    })
  ),
  weaknesses: z.array(
    z.object({
      feature_type: z.enum(["key", "bigram", "trigram"]),
      feature_value: z.string(),
      sample_count: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
      short_iki_ms: runtimeNullableNumberSchema,
      last_practiced_at: runtimeIsoDateTimeSchema.nullable()
    })
  ),
  lastSession: z
    .object({
      completedAt: runtimeIsoDateTimeSchema,
      summary: z.record(z.string(), z.unknown())
    })
    .nullable(),
  retention: z
    .object({
      window: z.enum(["24h", "72h"]),
      hoursGap: z.number().positive(),
      netWpmDelta: z.number().finite(),
      accuracyDelta: z.number().finite(),
      sampleCount: z.number().int().positive(),
      baselineSampleCount: z.number().int().positive()
    })
    .nullable()
});

export const runtimeGoalResponseSchema = z.object({ goal: runtimeGoalRecordSchema });
export const runtimeTraditionalProgressResponseSchema = z.object({
  stages: z.array(
    z.object({
      id: z.enum(["home", "index", "other", "top", "bottom", "numbers", "symbols", "shift"]),
      order: z.number().int().min(1).max(8),
      completed: z.boolean(),
      unlocked: z.boolean()
    })
  )
});

export const runtimeTestRecordSchema = z
  .object({
    id: runtimeUuidSchema,
    session_id: runtimeUuidSchema,
    duration_seconds: z.number().int().min(15).max(3600),
    raw_wpm: z.number().nonnegative(),
    net_wpm: z.number().nonnegative(),
    accuracy: z.number().min(0).max(1),
    consistency: z.number().min(0).max(1),
    errors_json: z.string(),
    errors_valid: z.boolean(),
    created_at: runtimeIsoDateTimeSchema,
    keystroke_accuracy: z.number().min(0).max(1),
    final_text_accuracy: z.number().min(0).max(1),
    mode: z.string().min(1).max(64)
  })
  .passthrough();
export const runtimeTestsResponseSchema = z.object({ tests: z.array(runtimeTestRecordSchema) });
export const runtimeCreateTestRequestSchema = z
  .object({
    sessionId: runtimeUuidSchema,
    durationSeconds: z.number().int().min(15).max(3600)
  })
  .strict();
export const runtimeCreateTestResponseSchema = z.object({
  id: runtimeUuidSchema,
  summary: runtimeSessionSummarySchema
});

export const runtimeCreateGameRunRequestSchema = z.object({
  mode: z.enum(["campaign", "hardcore"]),
  difficulty: z.enum(["standard", "hard", "adaptive"])
});
export const runtimeGameRunRecordSchema = z
  .object({
    id: runtimeUuidSchema,
    mode: z.enum(["campaign", "hardcore"]),
    difficulty: z.enum(["standard", "hard", "adaptive"]),
    status: z.string().min(1).max(32),
    current_level: z.number().int().min(1).max(6),
    score: z.number().int().nonnegative(),
    alert_value: z.number().min(0).max(100),
    levels: z.array(z.object({ level_number: z.number().int().min(1).max(6) }).passthrough())
  })
  .passthrough();
export const runtimeCreateGameRunResponseSchema = z.object({ run: runtimeGameRunRecordSchema });

const runtimeGamePlanSchema = z
  .object({
    tuning: z
      .object({
        timeLimitSeconds: z.number().positive(),
        requiredKeystrokeAccuracy: z.number().min(0).max(1)
      })
      .passthrough(),
    stages: z.array(
      z
        .object({
          stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
          title: z.string(),
          instruction: z.string(),
          targets: z.array(z.object({ text: z.string() }).passthrough())
        })
        .passthrough()
    )
  })
  .passthrough();
export const runtimeGameRunResponseSchema = z.object({
  run: runtimeGameRunRecordSchema,
  level: runtimeGameLevelDefinitionSchema,
  plan: runtimeGamePlanSchema,
  targetText: z.string().min(1)
});
export const runtimeGameLevelResultRequestSchema = z
  .object({
    sessionId: runtimeUuidSchema,
    outcome: z.enum(["success", "failure"]),
    alertValue: z.number().min(0).max(100),
    failureReason: z.enum(["alert-maxed", "timeout", "accuracy-gate"]).optional()
  })
  .refine(
    (value) =>
      (value.outcome === "failure" && value.failureReason != null) ||
      (value.outcome === "success" && value.failureReason == null),
    { message: "failureReason must match outcome" }
  )
  .strict();
export const runtimeGameLevelResultResponseSchema = z.object({
  run: runtimeGameRunRecordSchema,
  result: z.object({
    outcome: z.enum(["success", "failure"]),
    score: z.number().int().nonnegative(),
    alertValue: z.number().min(0).max(100),
    errorFree: z.boolean(),
    completedStages: z.number().int().min(0).max(3),
    sessionId: runtimeUuidSchema
  })
});

export const runtimeAchievementRecordSchema = z
  .object({
    achievement_id: z.string().min(1).max(128),
    unlocked_at: runtimeIsoDateTimeSchema,
    metadata_json: z.string()
  })
  .passthrough();
export const runtimeAchievementsResponseSchema = z.object({
  achievements: z.array(runtimeAchievementRecordSchema)
});
const runtimeGameProgressRunSchema = z
  .object({
    id: runtimeUuidSchema,
    mode: z.enum(["campaign", "hardcore"]),
    difficulty: z.enum(["standard", "hard", "adaptive"]),
    status: z.enum(["active", "completed"]),
    current_level: z.number().int().min(1).max(6),
    score: z.number().int().nonnegative(),
    alert_value: z.number().min(0).max(100),
    started_at: runtimeIsoDateTimeSchema,
    completed_at: runtimeIsoDateTimeSchema.nullable(),
    personal_best: z.union([z.literal(0), z.literal(1)])
  })
  .passthrough();
export const runtimeGameProgressResponseSchema = z.object({
  unlockedLevel: z.number().int().min(1).max(6),
  completedLevels: z.array(z.number().int().min(1).max(6)),
  personalBests: z.array(
    z.object({ level: z.number().int().min(1).max(6), score: z.number().int().nonnegative() })
  ),
  achievements: z.array(runtimeAchievementRecordSchema),
  levels: z.array(
    z
      .object({
        level: z.number().int().min(1).max(6),
        level_number: z.number().int().min(1).max(6),
        completed: z.boolean(),
        unlocked: z.boolean(),
        bestScore: z.number().int().nonnegative().nullable()
      })
      .passthrough()
  ),
  runs: z.array(runtimeGameProgressRunSchema),
  activeRun: runtimeGameProgressRunSchema.nullable(),
  personalBest: z.number().int().nonnegative().nullable()
});

const runtimeCustomTextBaseSchema = z.object({
  id: runtimeUuidSchema,
  title: z.string().min(1).max(160),
  file_type: z.enum(["txt", "md", "json", "js", "ts"]),
  character_count: z.number().int().nonnegative().max(1_000_000),
  word_count: z.number().int().nonnegative(),
  include_in_model: z.union([z.literal(0), z.literal(1)]),
  reading_position: z.number().int().nonnegative().max(1_000_000),
  created_at: runtimeIsoDateTimeSchema,
  updated_at: runtimeIsoDateTimeSchema
});
export const runtimeCustomTextRecordSchema = runtimeCustomTextBaseSchema.passthrough();
export const runtimeCustomTextDetailRecordSchema = runtimeCustomTextBaseSchema
  .extend({ content: z.string().max(1_000_000) })
  .passthrough();
export const runtimeCustomTextsResponseSchema = z.object({
  texts: z.array(runtimeCustomTextRecordSchema)
});
export const runtimeCustomTextResponseSchema = z.object({
  text: runtimeCustomTextDetailRecordSchema
});
export const runtimeCreateCustomTextRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    content: z
      .string()
      .min(1)
      .max(1_000_000)
      .refine((content) => content.trim().length > 0 && !content.includes("\0")),
    fileType: z.enum(["txt", "md", "json", "js", "ts"]),
    includeInModel: z.boolean().default(false)
  })
  .strict();
export const runtimeCreateCustomTextResponseSchema = z.object({
  text: runtimeCustomTextDetailRecordSchema
});

export const runtimeCustomTextProgressRequestSchema = z
  .object({
    blockId: runtimeUuidSchema,
    readingPosition: z.number().int().nonnegative().max(100_000_000).optional()
  })
  .strict();
export const runtimeCustomTextProgressResponseSchema = z.object({
  ok: z.literal(true),
  readingPosition: z.number().int().nonnegative()
});

const runtimeBackupSummarySchema = z.object({
  profiles: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  customTexts: z.number().int().nonnegative(),
  gameRuns: z.number().int().nonnegative()
});
export const runtimeJsonBackupSchema = z
  .object({
    format: z.literal("symtype-json-backup"),
    schemaVersion: z.number().int().positive(),
    algorithmVersion: z.string().min(1),
    exportedAt: runtimeIsoDateTimeSchema,
    data: z.record(z.string(), z.array(z.record(z.string(), z.unknown())))
  })
  .passthrough();
export const runtimeImportPreviewResponseSchema = z.object({
  ok: z.literal(true),
  summary: runtimeBackupSummarySchema
});
export const runtimeImportCommitResponseSchema = z
  .object({
    restored: z.literal(true),
    summary: runtimeBackupSummarySchema
  })
  .passthrough();
export const runtimeSqlitePreviewResponseSchema = z.object({
  ok: z.literal(true),
  token: runtimeUuidSchema,
  expiresAt: runtimeIsoDateTimeSchema,
  summary: runtimeBackupSummarySchema
});
export const runtimeSqliteCommitRequestSchema = z.object({ token: runtimeUuidSchema });

export const runtimeBackupListRecordSchema = z
  .object({
    id: runtimeUuidSchema,
    path: z.string().min(1),
    reason: z.string().min(1).max(100),
    byte_size: z.number().int().nonnegative(),
    schema_version: z.number().int().positive(),
    checksum: z.string().min(1),
    created_at: runtimeIsoDateTimeSchema
  })
  .passthrough();
export const runtimeBackupsResponseSchema = z.object({
  backups: z.array(runtimeBackupListRecordSchema)
});
export const runtimeCreateBackupRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(100).default("manual") })
  .strict()
  .default({ reason: "manual" });
export const runtimeCreatedBackupRecordSchema = z.object({
  id: runtimeUuidSchema,
  path: z.string().min(1),
  filename: z.string().min(1),
  reason: z.string().min(1).max(100),
  byteSize: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive(),
  checksum: z.string().min(1),
  createdAt: runtimeIsoDateTimeSchema
});
export const runtimeCreateBackupResponseSchema = z.object({
  backup: runtimeCreatedBackupRecordSchema
});

export const runtimeDiagnosticsResponseSchema = z
  .object({
    integrity: z.object({ ok: z.boolean(), detail: z.string() }),
    schemaVersion: z.number().int().nonnegative(),
    databaseFile: z.string().min(1)
  })
  .strict();
export const runtimeDiagnosticSnapshotResponseSchema = runtimeDiagnosticsResponseSchema.extend({
  diagnosticPath: z.string().min(1)
});

export interface RuntimeApiContract {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly path: RegExp;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly request?: z.ZodType;
  readonly requestBody?: "json" | "binary" | "json-or-text";
  readonly requestContentTypes?: readonly string[];
  readonly response: z.ZodType;
}

export interface RuntimeNonJsonApiContract {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly path: RegExp;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly responseBody: "csv" | "sqlite";
  readonly responseContentTypes: readonly string[];
  readonly csrfProtectedRead?: boolean;
}

/** Every JSON route validated on both sides of the local HTTP boundary. */
export const runtimeApiContracts: readonly RuntimeApiContract[] = [
  {
    id: "health",
    method: "GET",
    path: /^\/api\/v1\/health$/u,
    response: runtimeHealthResponseSchema
  },
  {
    id: "bootstrap",
    method: "GET",
    path: /^\/api\/v1\/bootstrap$/u,
    response: runtimeBootstrapResponseSchema
  },
  {
    id: "profile",
    method: "GET",
    path: /^\/api\/v1\/profile$/u,
    response: runtimeProfileResponseSchema
  },
  {
    id: "settings.read",
    method: "GET",
    path: /^\/api\/v1\/settings$/u,
    response: runtimeSettingsResponseSchema
  },
  {
    id: "settings.patch",
    method: "PATCH",
    path: /^\/api\/v1\/settings$/u,
    request: runtimeSettingsPatchSchema,
    response: runtimeSettingsResponseSchema
  },
  {
    id: "preferences.put",
    method: "PUT",
    path: /^\/api\/v1\/preferences$/u,
    request: runtimePreferencesRequestSchema,
    response: runtimePreferencesResponseSchema
  },
  {
    id: "layouts.read",
    method: "GET",
    path: /^\/api\/v1\/layouts$/u,
    response: runtimeLayoutsResponseSchema
  },
  {
    id: "layouts.create",
    method: "POST",
    path: /^\/api\/v1\/layouts$/u,
    request: runtimeCreateLayoutRequestSchema,
    response: runtimeCreateLayoutResponseSchema
  },
  {
    id: "layouts.mappings.replace",
    method: "PUT",
    path: /^\/api\/v1\/layouts\/(?<id>[^/]+)\/mappings$/u,
    params: runtimeLayoutIdParamsSchema,
    request: runtimeReplaceLayoutMappingsRequestSchema,
    response: runtimeOkResponseSchema
  },
  {
    id: "sessions.create",
    method: "POST",
    path: /^\/api\/v1\/sessions$/u,
    request: runtimeCreateSessionSchema,
    response: runtimeCreateSessionResponseSchema
  },
  {
    id: "sessions.read",
    method: "GET",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)$/u,
    params: runtimeUuidIdParamsSchema,
    response: runtimeSessionResponseSchema
  },
  {
    id: "sessions.events",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/events$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeEventBatchSchema,
    response: runtimeEventBatchResponseSchema
  },
  {
    id: "sessions.events-beacon",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/events\/beacon$/u,
    params: runtimeUuidIdParamsSchema,
    query: runtimeCsrfQuerySchema,
    request: runtimeEventBatchSchema,
    requestBody: "json-or-text",
    response: runtimeEventBatchResponseSchema
  },
  {
    id: "sessions.pause",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/pause$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimePauseSessionRequestSchema,
    response: runtimePauseSessionResponseSchema
  },
  {
    id: "sessions.complete",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/complete$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeCompleteSessionRequestSchema,
    response: runtimeCompleteSessionResponseSchema
  },
  {
    id: "sessions.feedback",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/feedback$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeSessionFeedbackRequestSchema,
    response: runtimeSessionFeedbackResponseSchema
  },
  {
    id: "sessions.recover",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/recover$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeRecoverSessionRequestSchema,
    response: runtimeRecoverSessionResponseSchema
  },
  {
    id: "sessions.abandon",
    method: "POST",
    path: /^\/api\/v1\/sessions\/(?<id>[^/]+)\/abandon$/u,
    params: runtimeUuidIdParamsSchema,
    response: runtimeOkResponseSchema
  },
  {
    id: "lessons.next-block",
    method: "POST",
    path: /^\/api\/v1\/lessons\/(?<lessonId>[^/]+)\/blocks\/next$/u,
    params: runtimeLessonIdParamsSchema,
    request: runtimeNextBlockSchema,
    response: runtimeNextBlockResponseSchema
  },
  {
    id: "dashboard",
    method: "GET",
    path: /^\/api\/v1\/dashboard$/u,
    response: runtimeDashboardResponseSchema
  },
  {
    id: "statistics",
    method: "GET",
    path: /^\/api\/v1\/statistics$/u,
    query: runtimeStatisticsQuerySchema,
    response: runtimeStatisticsResponseSchema
  },
  {
    id: "goals.read",
    method: "GET",
    path: /^\/api\/v1\/goals$/u,
    response: runtimeGoalResponseSchema
  },
  {
    id: "goals.update",
    method: "PUT",
    path: /^\/api\/v1\/goals$/u,
    request: runtimeGoalInputSchema,
    response: runtimeGoalResponseSchema
  },
  {
    id: "traditional-progress",
    method: "GET",
    path: /^\/api\/v1\/traditional-progress$/u,
    response: runtimeTraditionalProgressResponseSchema
  },
  {
    id: "tests.read",
    method: "GET",
    path: /^\/api\/v1\/tests$/u,
    response: runtimeTestsResponseSchema
  },
  {
    id: "tests.create",
    method: "POST",
    path: /^\/api\/v1\/tests$/u,
    request: runtimeCreateTestRequestSchema,
    response: runtimeCreateTestResponseSchema
  },
  {
    id: "game.create",
    method: "POST",
    path: /^\/api\/v1\/game\/runs$/u,
    request: runtimeCreateGameRunRequestSchema,
    response: runtimeCreateGameRunResponseSchema
  },
  {
    id: "game.read",
    method: "GET",
    path: /^\/api\/v1\/game\/runs\/(?<id>[^/]+)$/u,
    params: runtimeUuidIdParamsSchema,
    response: runtimeGameRunResponseSchema
  },
  {
    id: "game.level-result",
    method: "POST",
    path: /^\/api\/v1\/game\/runs\/(?<id>[^/]+)\/level-result$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeGameLevelResultRequestSchema,
    response: runtimeGameLevelResultResponseSchema
  },
  {
    id: "game.achievements",
    method: "GET",
    path: /^\/api\/v1\/game\/achievements$/u,
    response: runtimeAchievementsResponseSchema
  },
  {
    id: "game.progress",
    method: "GET",
    path: /^\/api\/v1\/game\/progress$/u,
    response: runtimeGameProgressResponseSchema
  },
  {
    id: "custom-text.read-all",
    method: "GET",
    path: /^\/api\/v1\/custom-texts$/u,
    response: runtimeCustomTextsResponseSchema
  },
  {
    id: "custom-text.read",
    method: "GET",
    path: /^\/api\/v1\/custom-texts\/(?<id>[^/]+)$/u,
    params: runtimeUuidIdParamsSchema,
    response: runtimeCustomTextResponseSchema
  },
  {
    id: "custom-text.create",
    method: "POST",
    path: /^\/api\/v1\/custom-texts$/u,
    request: runtimeCreateCustomTextRequestSchema,
    response: runtimeCreateCustomTextResponseSchema
  },
  {
    id: "custom-text.progress",
    method: "PATCH",
    path: /^\/api\/v1\/custom-texts\/(?<id>[^/]+)\/progress$/u,
    params: runtimeUuidIdParamsSchema,
    request: runtimeCustomTextProgressRequestSchema,
    response: runtimeCustomTextProgressResponseSchema
  },
  {
    id: "export.json",
    method: "GET",
    path: /^\/api\/v1\/export\/json$/u,
    response: runtimeJsonBackupSchema
  },
  {
    id: "backups.read",
    method: "GET",
    path: /^\/api\/v1\/backups$/u,
    response: runtimeBackupsResponseSchema
  },
  {
    id: "backups.create",
    method: "POST",
    path: /^\/api\/v1\/backups$/u,
    request: runtimeCreateBackupRequestSchema,
    response: runtimeCreateBackupResponseSchema
  },
  {
    id: "import.json.preview",
    method: "POST",
    path: /^\/api\/v1\/import\/preview$/u,
    request: runtimeJsonBackupSchema,
    response: runtimeImportPreviewResponseSchema
  },
  {
    id: "import.json.commit",
    method: "POST",
    path: /^\/api\/v1\/import\/commit$/u,
    request: runtimeJsonBackupSchema,
    response: runtimeImportCommitResponseSchema
  },
  {
    id: "import.sqlite.preview",
    method: "POST",
    path: /^\/api\/v1\/import\/sqlite\/preview$/u,
    requestBody: "binary",
    requestContentTypes: [
      "application/vnd.sqlite3",
      "application/x-sqlite3",
      "application/octet-stream"
    ],
    response: runtimeSqlitePreviewResponseSchema
  },
  {
    id: "import.sqlite.commit",
    method: "POST",
    path: /^\/api\/v1\/import\/sqlite\/commit$/u,
    request: runtimeSqliteCommitRequestSchema,
    response: runtimeImportCommitResponseSchema
  },
  {
    id: "diagnostics.read",
    method: "GET",
    path: /^\/api\/v1\/diagnostics$/u,
    response: runtimeDiagnosticsResponseSchema
  },
  {
    id: "diagnostics.snapshot.create",
    method: "POST",
    path: /^\/api\/v1\/diagnostics\/snapshot$/u,
    response: runtimeDiagnosticSnapshotResponseSchema
  }
];

/** Routes whose successful body intentionally is not JSON and cannot use a Zod response schema. */
export const runtimeNonJsonApiContracts: readonly RuntimeNonJsonApiContract[] = [
  {
    id: "export.csv",
    method: "GET",
    path: /^\/api\/v1\/export\/csv$/u,
    responseBody: "csv",
    responseContentTypes: ["text/csv"]
  },
  {
    id: "export.sqlite",
    method: "GET",
    path: /^\/api\/v1\/export\/sqlite$/u,
    query: runtimeCsrfQuerySchema,
    responseBody: "sqlite",
    responseContentTypes: ["application/vnd.sqlite3"],
    csrfProtectedRead: true
  }
];

export function findRuntimeApiContract(
  method: string,
  requestPath: string
): RuntimeApiContract | undefined {
  const path = requestPath.split("?", 1)[0] ?? requestPath;
  const normalizedMethod = method.toUpperCase();
  return runtimeApiContracts.find(
    (contract) => contract.method === normalizedMethod && contract.path.test(path)
  );
}

export function findRuntimeNonJsonApiContract(
  method: string,
  requestPath: string
): RuntimeNonJsonApiContract | undefined {
  const path = requestPath.split("?", 1)[0] ?? requestPath;
  const normalizedMethod = method.toUpperCase();
  return runtimeNonJsonApiContracts.find(
    (contract) => contract.method === normalizedMethod && contract.path.test(path)
  );
}

/** Extract named path captures from the registered route expression for browser-side validation. */
export function runtimePathParamsFromUrl(
  contract: Pick<RuntimeApiContract | RuntimeNonJsonApiContract, "path">,
  requestPath: string
): Record<string, string> {
  const path = requestPath.split("?", 1)[0] ?? requestPath;
  const groups = contract.path.exec(path)?.groups ?? {};
  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => {
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, ""];
      }
    })
  );
}

/** Preserve duplicate query keys as arrays so strict scalar schemas reject ambiguous input. */
export function runtimeQueryFromUrl(requestPath: string): Record<string, string | string[]> {
  const queryStart = requestPath.indexOf("?");
  const query = queryStart === -1 ? "" : requestPath.slice(queryStart + 1);
  const result: Record<string, string | string[]> = {};
  new URLSearchParams(query).forEach((value, key) => {
    const current = result[key];
    result[key] =
      current === undefined
        ? value
        : Array.isArray(current)
          ? [...current, value]
          : [current, value];
  });
  return result;
}

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeStoredEvent = z.infer<typeof runtimeStoredEventSchema>;
export type RuntimeEventBatch = z.infer<typeof runtimeEventBatchSchema>;
export type RuntimeBootstrapData = z.infer<typeof runtimeBootstrapResponseSchema>;
export type RuntimeSessionSummary = z.infer<typeof runtimeSessionSummarySchema>;
export type RuntimeStatistics = z.infer<typeof runtimeStatisticsResponseSchema>;
export type RuntimeDashboard = z.infer<typeof runtimeDashboardResponseSchema>;
export type RuntimeTraditionalProgress = z.infer<typeof runtimeTraditionalProgressResponseSchema>;
export type RuntimeTestRecord = z.infer<typeof runtimeTestRecordSchema>;
export type RuntimeAchievementRecord = z.infer<typeof runtimeAchievementRecordSchema>;
export type RuntimeGameProgress = z.infer<typeof runtimeGameProgressResponseSchema>;
export type RuntimeCustomTextRecord = z.infer<typeof runtimeCustomTextRecordSchema>;
export type RuntimeBackupRecord = z.infer<typeof runtimeBackupListRecordSchema>;
