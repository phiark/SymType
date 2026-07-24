import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";

const HOST = "127.0.0.1:4173";
const ORIGIN = `http://${HOST}`;

describe("runtime adaptive sequence semantics", () => {
  const directories: string[] = [];
  const contexts: AppContext[] = [];

  afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(({ app }) => app.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("keeps a weak bigram typed and exposes it intact without rewriting a persisted block", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "symtype-runtime-sequence-"));
    directories.push(dataDir);
    const context = await createApp({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "symtype.log"),
      webDist: join(dataDir, "missing-web-dist"),
      isTest: true
    });
    contexts.push(context);
    await context.app.ready();
    const headers = {
      host: HOST,
      origin: ORIGIN,
      "x-symtype-csrf": context.csrfToken
    };

    const now = new Date().toISOString();
    context.database.db
      .prepare(
        `INSERT INTO feature_stats
         (profile_id, feature_type, feature_value, short_alpha, short_beta,
          long_alpha, long_beta, short_iki_ms, long_iki_ms, sample_count,
          recent_window_json, algorithm_version, updated_at)
         VALUES ('local-profile', 'bigram', 'ct', 2, 28, 3, 12, 560, 480, 30,
                 '[false,false,false,true]', 'test-runtime', ?)`
      )
      .run(now);

    const sessionResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers,
      payload: {
        kind: "training",
        mode: "smart",
        strategy: "adaptive",
        seed: 7301,
        focus: ["ct"],
        includeInModel: true
      }
    });
    expect(sessionResponse.statusCode).toBe(201);
    const session = sessionResponse.json<{ session: { lessonId: string } }>().session;
    const request = {
      method: "POST" as const,
      url: `/api/v1/lessons/${session.lessonId}/blocks/next`,
      headers,
      payload: {
        blockIndex: 0,
        seed: 991,
        mode: "smart",
        length: 48,
        focus: ["ct"],
        scopeLabels: [],
        allowedCharacters: [],
        strictScope: false,
        phase: "focus"
      }
    };

    const firstResponse = await context.app.inject(request);
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json<{
      block: { id: string; target_text: string; rationale: string };
      adaptiveDebug: {
        selectedFeatures: string[];
        selectedFeatureValues: string[];
        candidateIds: string[];
      };
    }>();
    expect(first.adaptiveDebug.selectedFeatures).toContain("bigram:ct");
    expect(first.adaptiveDebug.selectedFeatureValues).toContain("ct");
    expect(first.adaptiveDebug.candidateIds).toContain("smart:focus:bigram%3Act");
    expect(first.block.target_text).toContain("ct");
    expect(first.block.target_text).not.toMatch(/\s$/u);
    expect(first.block.rationale).toContain("ct");

    const replayResponse = await context.app.inject(request);
    expect(replayResponse.statusCode).toBe(200);
    const replay = replayResponse.json<{ block: { id: string; target_text: string } }>();
    expect(replay.block.id).toBe(first.block.id);
    expect(replay.block.target_text).toBe(first.block.target_text);
  });
});
