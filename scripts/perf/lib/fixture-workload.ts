import { SYMMETRIC_PRESET } from "@symtype/shared";
import type Database from "better-sqlite3";

import {
  addDailyAggregate,
  insertAchievement,
  insertDailySummaries,
  insertFeatureStats
} from "./fixture-aggregates.js";
import { FIXED_PROFILE_ID, FIXTURE_SEED } from "./fixture-constants.js";
import { insertEvents } from "./fixture-event-insert.js";
import { buildTargetText } from "./fixture-events.js";
import {
  blockType,
  buildSessionPlans,
  type DailyAggregate,
  type SessionPlan
} from "./fixture-model.js";
import { buildSummary, insertGameResult, insertTestResult } from "./fixture-results.js";
import { algorithmVersion } from "./fixture-schema.js";

export { buildSessionPlans } from "./fixture-model.js";

export function insertFixtureWorkload(database: Database.Database, eventCount: number): void {
  if (eventCount === 0) return;
  const plans = buildSessionPlans(eventCount);
  const daily = new Map<string, DailyAggregate>();
  const insertAll = database.transaction(() => {
    for (const plan of plans) insertSession(database, plan, daily);
    insertDailySummaries(database, daily);
    insertAchievement(database, plans);
  });
  insertAll();
  insertFeatureStats(database);
}

function insertSession(
  database: Database.Database,
  plan: SessionPlan,
  daily: Map<string, DailyAggregate>
): void {
  const targetText = buildTargetText(plan.eventCount);
  insertSessionHierarchy(database, plan, targetText);
  const evidence = insertEvents(database, plan, targetText);
  const summary = buildSummary(plan.eventCount, evidence);
  database
    .prepare("UPDATE sessions SET summary_json = ? WHERE id = ?")
    .run(JSON.stringify(summary), plan.sessionId);
  database
    .prepare("UPDATE micro_blocks SET summary_json = ? WHERE id = ?")
    .run(
      JSON.stringify({ characters: summary.characters, correct: summary.correct }),
      plan.blockId
    );
  if (plan.kind === "test") insertTestResult(database, plan, summary, evidence.errorEvents);
  if (plan.kind === "game") insertGameResult(database, plan, summary);
  addDailyAggregate(daily, plan, summary);
}

function insertSessionHierarchy(
  database: Database.Database,
  plan: SessionPlan,
  targetText: string
): void {
  database
    .prepare(
      `INSERT INTO sessions
       (id, profile_id, kind, mode, strategy, status, seed, started_at, completed_at,
        client_checkpoint, active_ms, algorithm_version, summary_json, include_in_model,
        keyboard_layout_id, layout_snapshot_version, layout_snapshot_json, stage_id)
       VALUES(?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, NULL, ?,
              'symmetric-default', 1, ?, NULL)`
    )
    .run(
      plan.sessionId,
      FIXED_PROFILE_ID,
      plan.kind,
      plan.mode,
      plan.index % 2 === 0 ? "adaptive" : "baseline",
      FIXTURE_SEED + plan.index,
      plan.startedAt,
      plan.completedAt,
      plan.eventCount - 1,
      plan.eventCount * 200,
      algorithmVersion(),
      Number(plan.kind === "training"),
      keyboardSnapshot()
    );
  database
    .prepare(
      `INSERT INTO lessons
       (id, session_id, lesson_index, focus_json, explanation, started_at, completed_at)
       VALUES(?, ?, 0, '["e","er","A&"]', 'Fixed performance fixture.', ?, ?)`
    )
    .run(plan.lessonId, plan.sessionId, plan.startedAt, plan.completedAt);
  database
    .prepare(
      `INSERT INTO micro_blocks
       (id, lesson_id, block_index, block_type, target_text, seed, rationale, started_at,
        completed_at, summary_json)
       VALUES(?, ?, 0, ?, ?, ?, 'Fixed performance fixture.', ?, ?, NULL)`
    )
    .run(
      plan.blockId,
      plan.lessonId,
      blockType(plan.kind),
      targetText,
      FIXTURE_SEED + plan.index,
      plan.startedAt,
      plan.completedAt
    );
}

function keyboardSnapshot(): string {
  return JSON.stringify({
    version: 1,
    layout: { id: "symmetric-default", name: "Symmetric（默认）", preset: "symmetric" },
    mappings: SYMMETRIC_PRESET.keys.map((key) => ({
      physical_code: key.code,
      unshifted: key.unshifted ?? "",
      shifted: key.shifted ?? "",
      hand: key.hand,
      finger: key.finger,
      keyboard_row: key.row,
      zone: key.zone,
      key_width: key.width
    }))
  });
}
