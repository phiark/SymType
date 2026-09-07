import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { GoldenHarness } from "./v1-golden.fixture.js";
import type { AppContext } from "../src/app.js";

let harness: GoldenHarness;
let context: AppContext;

afterEach(async () => {
  vi.useRealTimers();
  await harness?.dispose();
});

async function fixture() {
  harness = new GoldenHarness();
  context = await harness.openApp();
  return context.database;
}

function completeSample() {
  const session = harness.createSession(context);
  const block = harness.createBlock(context, session, "a");
  harness.ingest(context, session, block, [
    harness.event({ sequence: 0, targetChar: "a", physicalCode: "KeyA", textPosition: 0 })
  ]);
  context.database.completeSession(session.id, 1000);
}

describe("SQLite-authoritative statistics cache", () => {
  test("isolates returned objects and invalidates after new completed evidence", async () => {
    const database = await fixture();
    const initial = database.getStatistics("all");
    const saved = structuredClone(initial);
    initial.overview = { characters: 999 };
    expect(database.getStatistics("all")).toEqual(saved);
    completeSample();
    expect(database.getStatistics("all").overview).toMatchObject({ characters: 1, sessions: 1 });
    expect(database.getStatistics("all").overview).toMatchObject({ characters: 1, sessions: 1 });
  });

  test("invalidates after commits from another SQLite connection", async () => {
    const database = await fixture();
    completeSample();
    database.getStatistics("all");
    const writer = new Database(database.config.databasePath);
    try {
      writer.prepare("UPDATE sessions SET status = 'abandoned' WHERE status = 'completed'").run();
      expect(database.getStatistics("all").overview).toMatchObject({ characters: 0, sessions: 0 });
    } finally {
      writer.close();
    }
  });

  test("does not retain reports computed from a rolled-back transaction", async () => {
    const database = await fixture();
    completeSample();
    database.getStatistics("all");
    database.db.exec("BEGIN");
    try {
      database.db
        .prepare("UPDATE sessions SET status = 'abandoned' WHERE status = 'completed'")
        .run();
      expect(database.getStatistics("all").overview).toMatchObject({ characters: 0 });
    } finally {
      database.db.exec("ROLLBACK");
    }
    expect(database.getStatistics("all").overview).toMatchObject({ characters: 1 });
  });

  test("refreshes period bounds when the local calendar day changes without a write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 21, 12));
    const database = await fixture();
    completeSample();
    expect(database.getStatistics("today").overview).toMatchObject({ characters: 1 });
    vi.setSystemTime(new Date(2026, 6, 22, 12));
    expect(database.getStatistics("today")).toMatchObject({
      sinceLocalDate: "2026-07-22",
      overview: { characters: 0 }
    });
    expect(database.getStatistics("all").overview).toMatchObject({ characters: 1 });
  });
});
