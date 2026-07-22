import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SYMMETRIC_LAYOUT,
  findRuntimeApiContract,
  findRuntimeNonJsonApiContract,
  runtimeApiContracts,
  runtimeBootstrapResponseSchema,
  runtimeCompleteSessionResponseSchema,
  runtimeCreateGameRunResponseSchema,
  runtimeCreateSessionResponseSchema,
  runtimeEventBatchResponseSchema,
  runtimeGameRunResponseSchema,
  runtimeHealthResponseSchema,
  runtimeImportPreviewResponseSchema,
  runtimeJsonBackupSchema,
  runtimeNextBlockResponseSchema,
  runtimeNonJsonApiContracts,
  runtimeProfileResponseSchema,
  runtimeSettingsResponseSchema,
  runtimeStatisticsResponseSchema
} from "@symtype/shared";
import type { InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const HOST = "127.0.0.1:4173";
const ORIGIN = `http://${HOST}`;

describe.sequential("shared runtime API contracts", () => {
  let context: AppContext;
  let dataDir = "";
  let previousDataDir: string | undefined;
  let previousNodeEnv: string | undefined;
  let previousLogLevel: string | undefined;

  beforeEach(async () => {
    previousDataDir = process.env.SYMTYPE_DATA_DIR;
    previousNodeEnv = process.env.NODE_ENV;
    previousLogLevel = process.env.SYMTYPE_LOG_LEVEL;
    dataDir = mkdtempSync(join(tmpdir(), "symtype-contract-test-"));
    process.env.SYMTYPE_DATA_DIR = dataDir;
    process.env.NODE_ENV = "test";
    process.env.SYMTYPE_LOG_LEVEL = "silent";
    context = await createApp({
      ...loadConfig(),
      port: 0,
      webDist: join(dataDir, "web-dist-not-present"),
      isTest: true
    });
    await context.app.ready();
  });

  afterEach(async () => {
    await context.app.close();
    rmSync(dataDir, { recursive: true, force: true });
    restoreEnvironment("SYMTYPE_DATA_DIR", previousDataDir);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("SYMTYPE_LOG_LEVEL", previousLogLevel);
  });

  function mutationHeaders() {
    return {
      host: HOST,
      origin: ORIGIN,
      "x-symtype-csrf": context.csrfToken
    };
  }

  test("profile, settings, session, lesson, event, statistics, game, and import stay in contract", async () => {
    const health = await context.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: HOST }
    });
    expect(health.statusCode).toBe(200);
    expect(runtimeHealthResponseSchema.safeParse(health.json()).success).toBe(true);

    const bootstrap = await context.app.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: { host: HOST }
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(runtimeBootstrapResponseSchema.safeParse(bootstrap.json()).success).toBe(true);

    const profile = await context.app.inject({
      method: "GET",
      url: "/api/v1/profile",
      headers: { host: HOST }
    });
    expect(runtimeProfileResponseSchema.safeParse(profile.json()).success).toBe(true);

    const settings = await context.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: mutationHeaders(),
      payload: { targetWpm: 48 }
    });
    expect(settings.statusCode).toBe(200);
    expect(runtimeSettingsResponseSchema.safeParse(settings.json()).success).toBe(true);

    const created = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(),
      payload: { kind: "training", mode: "smart", seed: 17, focus: [] }
    });
    expect(created.statusCode).toBe(201);
    const createdSession = runtimeCreateSessionResponseSchema.parse(created.json()).session;

    const nextBlock = await context.app.inject({
      method: "POST",
      url: `/api/v1/lessons/${createdSession.lessonId}/blocks/next`,
      headers: mutationHeaders(),
      payload: { blockIndex: 0, seed: 19, mode: "smart", focus: [], phase: "warmup" }
    });
    expect(nextBlock.statusCode).toBe(200);
    expect(runtimeNextBlockResponseSchema.safeParse(nextBlock.json()).success).toBe(true);

    const eventBatch = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${createdSession.id}/events`,
      headers: mutationHeaders(),
      payload: { batchId: "b15d5f3f-9442-45fd-8952-213383588e93", events: [] }
    });
    expect(eventBatch.statusCode).toBe(200);
    expect(runtimeEventBatchResponseSchema.safeParse(eventBatch.json()).success).toBe(true);

    const completed = await context.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${createdSession.id}/complete`,
      headers: mutationHeaders(),
      payload: { activeMs: 1_000 }
    });
    expect(completed.statusCode).toBe(200);
    expect(runtimeCompleteSessionResponseSchema.safeParse(completed.json()).success).toBe(true);

    const statistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics?period=all",
      headers: { host: HOST }
    });
    expect(statistics.statusCode).toBe(200);
    expect(runtimeStatisticsResponseSchema.safeParse(statistics.json()).success).toBe(true);

    const gameCreated = await context.app.inject({
      method: "POST",
      url: "/api/v1/game/runs",
      headers: mutationHeaders(),
      payload: { mode: "campaign", difficulty: "standard" }
    });
    expect(gameCreated.statusCode).toBe(201);
    const run = runtimeCreateGameRunResponseSchema.parse(gameCreated.json()).run;
    const game = await context.app.inject({
      method: "GET",
      url: `/api/v1/game/runs/${run.id}`,
      headers: { host: HOST }
    });
    expect(game.statusCode).toBe(200);
    expect(runtimeGameRunResponseSchema.safeParse(game.json()).success).toBe(true);

    const exported = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/json",
      headers: { host: HOST }
    });
    const backup = runtimeJsonBackupSchema.parse(exported.json());
    const preview = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: mutationHeaders(),
      payload: backup
    });
    expect(preview.statusCode).toBe(200);
    expect(runtimeImportPreviewResponseSchema.safeParse(preview.json()).success).toBe(true);
  });

  test("every declared JSON route is registered and every non-JSON route is explicitly classified", () => {
    const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const routePattern = /app\.(get|post|put|patch)\("(\/api\/v1\/[^"?]+)"/gu;
    const routes = [...source.matchAll(routePattern)].map((match) => ({
      method: String(match[1]).toUpperCase(),
      template: String(match[2]),
      path: String(match[2]).replace(
        /:[a-zA-Z][a-zA-Z0-9_]*/gu,
        "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd"
      )
    }));
    expect(routes).toHaveLength(runtimeApiContracts.length + runtimeNonJsonApiContracts.length);

    const matchedJson = new Set<string>();
    const matchedNonJson = new Set<string>();
    for (const route of routes) {
      const jsonContract = findRuntimeApiContract(route.method, route.path);
      const nonJsonContract = findRuntimeNonJsonApiContract(route.method, route.path);
      expect(
        Number(jsonContract != null) + Number(nonJsonContract != null),
        `${route.method} ${route.template} must have exactly one runtime classification`
      ).toBe(1);
      if (route.template.includes(":")) {
        expect(
          (jsonContract ?? nonJsonContract)?.params,
          `${route.method} ${route.template} must validate shared path parameters`
        ).toBeDefined();
      }
      if (jsonContract) matchedJson.add(jsonContract.id);
      if (nonJsonContract) matchedNonJson.add(nonJsonContract.id);
    }
    expect([...matchedJson].sort()).toEqual(runtimeApiContracts.map((item) => item.id).sort());
    expect([...matchedNonJson].sort()).toEqual(
      runtimeNonJsonApiContracts.map((item) => item.id).sort()
    );
  });

  test("secondary JSON routes validate real SQLite-backed responses through the registry", async () => {
    const injectJson = async (
      options: InjectOptions & {
        method: "GET" | "POST" | "PUT" | "PATCH";
        url: string;
      }
    ) => {
      const response = await context.app.inject(options);
      expect(response.statusCode).toBeGreaterThanOrEqual(200);
      expect(response.statusCode).toBeLessThan(300);
      const method = options.method;
      const url = options.url;
      const contract = findRuntimeApiContract(method, url);
      expect(contract, `${method} ${url} must be registered`).toBeDefined();
      expect(contract?.response.safeParse(response.json()).success).toBe(true);
      return response;
    };

    const layouts = await injectJson({
      method: "GET",
      url: "/api/v1/layouts",
      headers: { host: HOST }
    });
    expect(layouts.json<{ layouts: unknown[] }>().layouts.length).toBeGreaterThanOrEqual(2);
    const createdLayout = await injectJson({
      method: "POST",
      url: "/api/v1/layouts",
      headers: mutationHeaders(),
      payload: { name: "Contract layout", baseLayoutId: "symmetric-default" }
    });
    const createdLayoutBody = createdLayout.json<{
      id: string;
      layouts: Array<{
        id: string;
        mappings: Array<{
          physical_code: string;
          unshifted: string;
          shifted: string;
          hand: "left" | "right" | "thumb";
          finger:
            | "left-pinky"
            | "left-ring"
            | "left-middle"
            | "left-index"
            | "right-index"
            | "right-middle"
            | "right-ring"
            | "right-pinky"
            | "thumb";
          keyboard_row: "number" | "top" | "home" | "bottom" | "space";
          zone:
            | "left-pinky"
            | "left-ring"
            | "left-middle"
            | "left-index"
            | "right-index"
            | "right-middle"
            | "right-ring"
            | "right-pinky"
            | "thumb";
          key_width: number;
        }>;
      }>;
    }>();
    const customLayout = createdLayoutBody.layouts.find(
      (layout) => layout.id === createdLayoutBody.id
    );
    expect(customLayout).toBeDefined();
    await injectJson({
      method: "PUT",
      url: `/api/v1/layouts/${createdLayoutBody.id}/mappings`,
      headers: mutationHeaders(),
      payload: {
        mappings: customLayout?.mappings.map((mapping) => ({
          code: mapping.physical_code,
          unshifted: mapping.unshifted,
          shifted: mapping.shifted,
          hand: mapping.hand,
          finger: mapping.finger,
          row: mapping.keyboard_row,
          zone: mapping.zone,
          width: mapping.key_width
        }))
      }
    });

    for (const url of [
      "/api/v1/dashboard",
      "/api/v1/goals",
      "/api/v1/traditional-progress",
      "/api/v1/tests",
      "/api/v1/game/achievements",
      "/api/v1/game/progress",
      "/api/v1/custom-texts",
      "/api/v1/backups",
      "/api/v1/diagnostics",
      "/api/v1/export/json"
    ]) {
      await injectJson({ method: "GET", url, headers: { host: HOST } });
    }

    await injectJson({
      method: "POST",
      url: "/api/v1/diagnostics/snapshot",
      headers: mutationHeaders()
    });

    await injectJson({
      method: "PUT",
      url: "/api/v1/goals",
      headers: mutationHeaders(),
      payload: { dailyMinutes: 12, targetWpm: 52, minimumAccuracy: 0.95 }
    });

    const customText = await injectJson({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(),
      payload: {
        title: "Contract text",
        content: "Pineapple typing evidence.",
        fileType: "txt",
        includeInModel: false
      }
    });
    const customTextId = customText.json<{ text: { id: string } }>().text.id;
    await injectJson({
      method: "GET",
      url: `/api/v1/custom-texts/${customTextId}`,
      headers: { host: HOST }
    });
    await injectJson({ method: "GET", url: "/api/v1/custom-texts", headers: { host: HOST } });

    const testSession = await injectJson({
      method: "POST",
      url: "/api/v1/sessions",
      headers: mutationHeaders(),
      payload: { kind: "test", mode: "typing-test", seed: 71, focus: [] }
    });
    const testSessionRecord = testSession.json<{
      session: { id: string; lessonId: string };
    }>().session;
    const testBlockResponse = await injectJson({
      method: "POST",
      url: `/api/v1/lessons/${testSessionRecord.lessonId}/blocks/next`,
      headers: mutationHeaders(),
      payload: { blockIndex: 0, seed: 73, mode: "typing-test", focus: [], phase: "warmup" }
    });
    const testBlock = testBlockResponse.json<{
      block: { id: string; target_text: string };
    }>().block;
    const targetChar = Array.from(testBlock.target_text)[0] ?? "a";
    const targetBinding = SYMMETRIC_LAYOUT.find(
      (key) => key.unshifted === targetChar || key.shifted === targetChar
    );
    expect(targetBinding, `Missing ANSI binding for ${JSON.stringify(targetChar)}`).toBeDefined();
    const shifted = targetBinding?.shifted === targetChar && targetBinding.unshifted !== targetChar;
    await injectJson({
      method: "POST",
      url: `/api/v1/sessions/${testSessionRecord.id}/events`,
      headers: mutationHeaders(),
      payload: {
        batchId: "62da813e-3c91-4c4a-95dd-673f81aa4ac5",
        lessonId: testSessionRecord.lessonId,
        blockId: testBlock.id,
        events: [
          {
            sequence: 0,
            clientTimeMs: 100,
            targetChar,
            actualChar: targetChar,
            physicalCode: targetBinding?.code ?? "KeyA",
            shiftSide: shifted ? (targetBinding?.hand === "left" ? "right" : "left") : "none",
            modifiers: { shift: shifted, capsLock: false },
            isCorrect: true,
            textPosition: 0
          }
        ]
      }
    });
    await injectJson({
      method: "POST",
      url: `/api/v1/sessions/${testSessionRecord.id}/complete`,
      headers: mutationHeaders(),
      payload: { activeMs: 15_000 }
    });
    await injectJson({
      method: "POST",
      url: "/api/v1/tests",
      headers: mutationHeaders(),
      payload: { sessionId: testSessionRecord.id, durationSeconds: 15 }
    });
    await injectJson({ method: "GET", url: "/api/v1/tests", headers: { host: HOST } });
    await injectJson({
      method: "POST",
      url: "/api/v1/game/runs",
      headers: mutationHeaders(),
      payload: { mode: "campaign", difficulty: "standard" }
    });
    await injectJson({ method: "GET", url: "/api/v1/game/progress", headers: { host: HOST } });
    await injectJson({
      method: "POST",
      url: "/api/v1/backups",
      headers: mutationHeaders(),
      payload: { reason: "contract-test" }
    });
  });

  test("binary route metadata preserves content types and SQLite CSRF protection", async () => {
    const csvContract = findRuntimeNonJsonApiContract("GET", "/api/v1/export/csv");
    expect(csvContract).toMatchObject({ responseBody: "csv" });
    expect(csvContract?.csrfProtectedRead).toBeUndefined();
    const csv = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/csv",
      headers: { host: HOST }
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");

    const denied = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/sqlite",
      headers: { host: HOST }
    });
    expect(denied.statusCode).toBe(403);

    const sqliteContract = findRuntimeNonJsonApiContract("GET", "/api/v1/export/sqlite");
    expect(sqliteContract).toMatchObject({ responseBody: "sqlite", csrfProtectedRead: true });
    const sqlite = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/sqlite",
      headers: mutationHeaders()
    });
    expect(sqlite.statusCode).toBe(200);
    expect(sqlite.headers["content-type"]).toContain("application/vnd.sqlite3");

    const previewContract = findRuntimeApiContract("POST", "/api/v1/import/sqlite/preview");
    expect(previewContract?.requestBody).toBe("binary");
    expect(previewContract?.requestContentTypes).toContain("application/vnd.sqlite3");
    const preview = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/preview",
      headers: { ...mutationHeaders(), "content-type": "application/vnd.sqlite3" },
      payload: sqlite.rawPayload
    });
    expect(preview.statusCode).toBe(200);
    expect(previewContract?.response.safeParse(preview.json()).success).toBe(true);

    const wrongContentType = await context.app.inject({
      method: "POST",
      url: "/api/v1/import/sqlite/preview",
      headers: mutationHeaders(),
      payload: { not: "sqlite" }
    });
    expect(wrongContentType.statusCode).toBe(415);
    expect(wrongContentType.json()).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" }
    });
  });

  test("shared request and response boundaries reject malformed secondary route data", async () => {
    const invalidRequest = await context.app.inject({
      method: "POST",
      url: "/api/v1/custom-texts",
      headers: mutationHeaders(),
      payload: { title: "", content: "\0", fileType: "exe", includeInModel: false }
    });
    expect(invalidRequest.statusCode).toBe(400);
    expect(invalidRequest.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    context.database.getDashboard = () => ({ fabricated: true });
    const invalidResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { host: HOST }
    });
    expect(invalidResponse.statusCode).toBe(500);
    expect(invalidResponse.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  test("shared path and query contracts reject invalid request locations at Fastify", async () => {
    const invalidPath = await context.app.inject({
      method: "GET",
      url: "/api/v1/sessions/not-a-uuid",
      headers: { host: HOST }
    });
    expect(invalidPath.statusCode).toBe(400);
    expect(invalidPath.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    for (const url of ["/api/v1/statistics?period=year", "/api/v1/statistics?period=7d&extra=1"]) {
      const invalidStatistics = await context.app.inject({
        method: "GET",
        url,
        headers: { host: HOST }
      });
      expect(invalidStatistics.statusCode).toBe(400);
      expect(invalidStatistics.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" }
      });
    }

    const defaultStatistics = await context.app.inject({
      method: "GET",
      url: "/api/v1/statistics",
      headers: { host: HOST }
    });
    expect(defaultStatistics.statusCode).toBe(200);

    const invalidSqliteQuery = await context.app.inject({
      method: "GET",
      url: "/api/v1/export/sqlite?unexpected=1",
      headers: mutationHeaders()
    });
    expect(invalidSqliteQuery.statusCode).toBe(400);
    expect(invalidSqliteQuery.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });

    const invalidBeaconQuery = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions/f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd/events/beacon?extra=1",
      headers: mutationHeaders(),
      payload: { batchId: "a7818f7b-0819-43bb-ae60-6cf9c13e671b", events: [] }
    });
    expect(invalidBeaconQuery.statusCode).toBe(400);
    expect(invalidBeaconQuery.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
