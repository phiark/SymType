import { describe, expect, it } from "vitest";

import {
  findRuntimeApiContract,
  findRuntimeNonJsonApiContract,
  runtimeApiContracts,
  runtimeBootstrapResponseSchema,
  runtimeCreateSessionSchema,
  runtimeCustomTextProgressRequestSchema,
  runtimeDiagnosticSnapshotResponseSchema,
  runtimeDiagnosticsResponseSchema,
  runtimeEventBatchSchema,
  runtimeGoalInputSchema,
  runtimeLongFormSourceIdSchema,
  runtimeMicroBlockRecordSchema,
  runtimeNextBlockSchema,
  runtimeNonJsonApiContracts,
  runtimePathParamsFromUrl,
  runtimeQueryFromUrl,
  runtimeDefaultAdvancedWeights,
  runtimeSettingsLimits,
  runtimeSettingsPatchSchema,
  runtimeSettingsSchema
} from "./runtime-api.js";

describe("local runtime API contracts", () => {
  it("accepts the server-authoritative settings shape", () => {
    expect(
      runtimeSettingsSchema.parse({
        onboardingComplete: true,
        calibrationComplete: false,
        theme: "system",
        reducedMotion: false,
        keyboardVisible: true,
        keyboardFingerColors: true,
        soundEnabled: true,
        soundTheme: "soft",
        soundMode: "all",
        volume: 0.35,
        activeLayoutId: "symmetric-default",
        stopOnError: false,
        backspaceMode: "enabled",
        fontSize: 30,
        lineHeight: 1.65,
        caretStyle: "bar",
        smoothScroll: true,
        targetWpm: 45,
        minimumAccuracy: 0.94,
        progressionAccuracy: 0.975,
        trainingBias: "balanced",
        defaultDurationMinutes: 10,
        experimentEnabled: false,
        advancedWeights: runtimeDefaultAdvancedWeights
      }).activeLayoutId
    ).toBe("symmetric-default");
  });

  it("rejects a progression threshold below the protection floor", () => {
    const result = runtimeSettingsSchema.safeParse({
      onboardingComplete: true,
      calibrationComplete: false,
      theme: "system",
      reducedMotion: false,
      keyboardVisible: true,
      keyboardFingerColors: true,
      soundEnabled: true,
      soundTheme: "soft",
      soundMode: "all",
      volume: 0.35,
      activeLayoutId: "symmetric-default",
      stopOnError: false,
      backspaceMode: "enabled",
      fontSize: 30,
      lineHeight: 1.65,
      caretStyle: "bar",
      smoothScroll: true,
      targetWpm: 45,
      minimumAccuracy: 0.98,
      progressionAccuracy: 0.94,
      trainingBias: "balanced",
      defaultDurationMinutes: 10,
      experimentEnabled: false,
      advancedWeights: runtimeDefaultAdvancedWeights
    });
    expect(result.success).toBe(false);
  });

  it("requires the complete fixed advanced-weight set and rejects unknown weights", () => {
    expect(
      runtimeSettingsPatchSchema.safeParse({ advancedWeights: { accuracy: 0.34 } }).success
    ).toBe(false);
    expect(
      runtimeSettingsPatchSchema.safeParse({
        advancedWeights: { ...runtimeDefaultAdvancedWeights, typo: 0.2 }
      }).success
    ).toBe(false);
    expect(
      runtimeSettingsPatchSchema.safeParse({
        advancedWeights: {
          ...runtimeDefaultAdvancedWeights,
          recovery: runtimeSettingsLimits.advancedWeight.max
        }
      }).success
    ).toBe(true);
    expect(
      runtimeSettingsPatchSchema.safeParse({
        advancedWeights: {
          ...runtimeDefaultAdvancedWeights,
          recovery: runtimeSettingsLimits.advancedWeight.max + 0.01
        }
      }).success
    ).toBe(false);
  });

  it("accepts the documented settings and goal boundary values", () => {
    const base = runtimeSettingsSchema.parse({
      onboardingComplete: true,
      calibrationComplete: false,
      theme: "system",
      reducedMotion: false,
      keyboardVisible: true,
      keyboardFingerColors: true,
      soundEnabled: true,
      soundTheme: "soft",
      soundMode: "all",
      volume: 0.35,
      activeLayoutId: "symmetric-default",
      stopOnError: false,
      backspaceMode: "enabled",
      fontSize: 30,
      lineHeight: 1.65,
      caretStyle: "bar",
      smoothScroll: true,
      targetWpm: runtimeSettingsLimits.targetWpm.max,
      minimumAccuracy: runtimeSettingsLimits.accuracy.min,
      progressionAccuracy: runtimeSettingsLimits.accuracy.max,
      trainingBias: "balanced",
      defaultDurationMinutes: runtimeSettingsLimits.defaultDurationMinutes.max,
      experimentEnabled: false,
      advancedWeights: runtimeDefaultAdvancedWeights
    });
    expect(base.targetWpm).toBe(250);
    expect(base.defaultDurationMinutes).toBe(120);
    expect(
      runtimeGoalInputSchema.parse({
        dailyMinutes: runtimeSettingsLimits.dailyMinutes.max,
        targetWpm: runtimeSettingsLimits.targetWpm.min,
        minimumAccuracy: runtimeSettingsLimits.accuracy.max
      })
    ).toEqual({ dailyMinutes: 240, targetWpm: 5, minimumAccuracy: 1 });
  });

  it("validates monotonically ordered event batches", () => {
    const base = {
      clientTimeMs: 20,
      targetChar: "c",
      actualChar: "c",
      physicalCode: "KeyC",
      shiftSide: "none" as const,
      modifiers: {},
      isCorrect: true,
      isCorrection: false,
      backspaceCount: 0,
      ikiMs: 120,
      bigram: null,
      trigram: null,
      mappedHand: "left",
      mappedFinger: "left-index",
      keyboardRow: "bottom",
      zone: "left-index",
      characterClass: "lowercase",
      contentMode: "smart",
      textPosition: 0,
      isWordBoundary: false,
      isAfterError: false,
      wasRefocus: false,
      wasPaused: false,
      wasLongPause: false,
      wasThrottled: false,
      wasRepeat: false
    };
    const result = runtimeEventBatchSchema.safeParse({
      batchId: "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd",
      events: [
        { ...base, sequence: 2 },
        { ...base, sequence: 1, textPosition: 1 }
      ]
    });
    expect(result.success).toBe(false);
  });

  it("bounds deterministic session and block requests", () => {
    expect(
      runtimeCreateSessionSchema.parse({
        kind: "training",
        mode: "smart",
        seed: 42,
        focus: ["c", "ct"]
      }).strategy
    ).toBe("adaptive");
    expect(
      runtimeNextBlockSchema.parse({
        blockIndex: 0,
        seed: 42,
        mode: "smart",
        focus: []
      }).length
    ).toBe(48);
  });

  it("registers unique runtime route contracts and resolves dynamic paths", () => {
    const allIds = [...runtimeApiContracts, ...runtimeNonJsonApiContracts].map(
      (contract) => contract.id
    );
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(findRuntimeApiContract("POST", "/api/v1/sessions")?.id).toBe("sessions.create");
    expect(
      findRuntimeApiContract("POST", "/api/v1/sessions/f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd/events")
        ?.id
    ).toBe("sessions.events");
    expect(findRuntimeApiContract("GET", "/api/v1/statistics?period=30d")?.id).toBe("statistics");
    expect(findRuntimeApiContract("GET", "/api/v1/dashboard")?.id).toBe("dashboard");
    expect(findRuntimeApiContract("POST", "/api/v1/custom-texts")?.id).toBe("custom-text.create");
    expect(findRuntimeApiContract("GET", "/api/v1/backups")?.id).toBe("backups.read");
    expect(findRuntimeNonJsonApiContract("GET", "/api/v1/export/csv")?.responseBody).toBe("csv");
    expect(findRuntimeNonJsonApiContract("GET", "/api/v1/export/sqlite")?.csrfProtectedRead).toBe(
      true
    );
    expect(findRuntimeApiContract("GET", "/api/v1/not-a-route")).toBeUndefined();
  });

  it("matches dynamic route templates before validating named path parameters", () => {
    const validPath = "/api/v1/sessions/f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd";
    const contract = findRuntimeApiContract("GET", validPath);
    expect(contract?.id).toBe("sessions.read");
    expect(contract?.params?.safeParse(runtimePathParamsFromUrl(contract, validPath)).success).toBe(
      true
    );

    const invalidPath = "/api/v1/sessions/not-a-uuid";
    const invalidContract = findRuntimeApiContract("GET", invalidPath);
    expect(invalidContract?.id).toBe("sessions.read");
    expect(
      invalidContract?.params?.safeParse(runtimePathParamsFromUrl(invalidContract, invalidPath))
        .success
    ).toBe(false);

    const lessonPath = "/api/v1/lessons/a7818f7b-0819-43bb-ae60-6cf9c13e671b/blocks/next";
    const lesson = findRuntimeApiContract("POST", lessonPath);
    expect(lesson).toBeDefined();
    if (!lesson) throw new Error("Expected the lesson route contract");
    expect(runtimePathParamsFromUrl(lesson, lessonPath)).toEqual({
      lessonId: "a7818f7b-0819-43bb-ae60-6cf9c13e671b"
    });
  });

  it("strictly validates registered statistics, beacon, and SQLite query strings", () => {
    const statistics = findRuntimeApiContract("GET", "/api/v1/statistics?period=30d");
    expect(
      statistics?.query?.safeParse(runtimeQueryFromUrl("/api/v1/statistics?period=30d")).success
    ).toBe(true);
    expect(statistics?.query?.safeParse(runtimeQueryFromUrl("/api/v1/statistics")).success).toBe(
      true
    );
    expect(
      statistics?.query?.safeParse(runtimeQueryFromUrl("/api/v1/statistics?period=year")).success
    ).toBe(false);
    expect(
      statistics?.query?.safeParse(runtimeQueryFromUrl("/api/v1/statistics?period=7d&extra=1"))
        .success
    ).toBe(false);
    expect(
      statistics?.query?.safeParse(runtimeQueryFromUrl("/api/v1/statistics?period=7d&period=30d"))
        .success
    ).toBe(false);

    const beacon = findRuntimeApiContract(
      "POST",
      "/api/v1/sessions/f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd/events/beacon?csrf=token"
    );
    expect(
      beacon?.query?.safeParse(
        runtimeQueryFromUrl(
          "/api/v1/sessions/f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd/events/beacon?csrf=token"
        )
      ).success
    ).toBe(true);

    const sqlite = findRuntimeNonJsonApiContract("GET", "/api/v1/export/sqlite?csrf=token");
    expect(
      sqlite?.query?.safeParse(runtimeQueryFromUrl("/api/v1/export/sqlite?csrf=token")).success
    ).toBe(true);
    expect(
      sqlite?.query?.safeParse(runtimeQueryFromUrl("/api/v1/export/sqlite?unexpected=1")).success
    ).toBe(false);
  });

  it("fails malformed secondary route requests and responses at the shared boundary", () => {
    const createText = findRuntimeApiContract("POST", "/api/v1/custom-texts");
    expect(
      createText?.request?.safeParse({
        title: "",
        content: "\0",
        fileType: "exe",
        includeInModel: false
      }).success
    ).toBe(false);
    const dashboard = findRuntimeApiContract("GET", "/api/v1/dashboard");
    expect(dashboard?.response.safeParse({ fabricated: true }).success).toBe(false);
    const sqlitePreview = findRuntimeApiContract("POST", "/api/v1/import/sqlite/preview");
    expect(sqlitePreview?.requestBody).toBe("binary");
    expect(sqlitePreview?.requestContentTypes).toContain("application/vnd.sqlite3");
  });

  it("separates read-only diagnostics from the CSRF-protected snapshot mutation", () => {
    const read = findRuntimeApiContract("GET", "/api/v1/diagnostics");
    const create = findRuntimeApiContract("POST", "/api/v1/diagnostics/snapshot");
    expect(read?.id).toBe("diagnostics.read");
    expect(create?.id).toBe("diagnostics.snapshot.create");

    const summary = {
      integrity: { ok: true, detail: "ok" },
      schemaVersion: 8,
      databaseFile: "symtype.sqlite3"
    };
    expect(runtimeDiagnosticsResponseSchema.safeParse(summary).success).toBe(true);
    expect(
      runtimeDiagnosticsResponseSchema.safeParse({
        ...summary,
        diagnosticPath: "/tmp/diagnostic-summary.json"
      }).success
    ).toBe(false);
    expect(
      runtimeDiagnosticSnapshotResponseSchema.safeParse({
        ...summary,
        diagnosticPath: "/tmp/diagnostic-summary.json"
      }).success
    ).toBe(true);
  });

  it("keeps bootstrap authority fields mandatory", () => {
    const result = runtimeBootstrapResponseSchema.safeParse({
      csrfToken: "local-token",
      profile: { id: "local-profile", display_name: "Local typist" },
      settings: {},
      layouts: [],
      goal: {},
      contentModes: [],
      gameLevels: [],
      algorithmVersion: "symtype-adaptive-v1",
      dataLocation: "/tmp/symtype.sqlite3"
    });
    expect(result.success).toBe(false);
  });

  it("accepts bounded built-in source identifiers in persisted micro-blocks", () => {
    expect(
      runtimeMicroBlockRecordSchema.safeParse({
        id: "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd",
        lesson_id: "a7818f7b-0819-43bb-ae60-6cf9c13e671b",
        block_index: 0,
        block_type: "long-form",
        target_text: "A local public-domain excerpt.",
        seed: 7,
        rationale: "Resume from the SQLite-backed reading position.",
        source_text_id: "builtin-long-form:public-domain-sample",
        source_start: 0,
        source_length: 30
      }).success
    ).toBe(true);
    expect(
      runtimeLongFormSourceIdSchema.safeParse("f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd").success
    ).toBe(true);
    expect(
      runtimeLongFormSourceIdSchema.safeParse("builtin-long-form:quiet-workshop").success
    ).toBe(true);
    expect(runtimeLongFormSourceIdSchema.safeParse("builtin-long-form:../../secret").success).toBe(
      false
    );
    expect(runtimeLongFormSourceIdSchema.safeParse("arbitrary-local-id").success).toBe(false);
  });

  it("requires server-issued micro-block evidence for custom-text progress", () => {
    expect(runtimeCustomTextProgressRequestSchema.safeParse({ readingPosition: 40 }).success).toBe(
      false
    );
    expect(
      runtimeCustomTextProgressRequestSchema.safeParse({
        blockId: "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd"
      }).success
    ).toBe(true);
    expect(
      runtimeCustomTextProgressRequestSchema.safeParse({
        blockId: "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd",
        readingPosition: 40
      }).success
    ).toBe(true);
  });
});
