import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { eventAt } from "./fixture-events.js";
import { contentMode, type EventEvidence, type SessionPlan } from "./fixture-model.js";

export function insertEvents(
  database: Database.Database,
  plan: SessionPlan,
  targetText: string
): EventEvidence {
  const insert = eventInsertStatement(database);
  const errors: EventEvidence["errorEvents"] = [];
  let correct = 0;
  let streak = 0;
  let longestStreak = 0;
  for (let sequence = 0; sequence < plan.eventCount; sequence += 1) {
    const event = eventAt(sequence);
    insert.run(eventParameters(plan, event, targetText));
    if (event.correct === 1) {
      correct += 1;
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
      errors.push({
        target: event.target,
        actual: event.actual,
        physicalCode: event.physicalCode,
        position: sequence
      });
    }
  }
  insertBatch(database, plan);
  return { correct, longestStreak, errorEvents: errors };
}

function eventInsertStatement(database: Database.Database): Database.Statement {
  return database.prepare(
    `INSERT INTO keystroke_events
     (session_id, lesson_id, block_id, sequence, client_time_ms, server_time, target_char,
      actual_char, physical_code, shift_side, modifiers_json, is_correct, is_correction,
      backspace_count, iki_ms, feature_char, bigram, trigram, mapped_hand, mapped_finger,
      keyboard_row, zone, character_class, content_mode, text_position, is_word_boundary,
      is_after_error, was_refocus, was_paused, was_long_pause, was_throttled, was_repeat)
     VALUES
     (@sessionId, @lessonId, @blockId, @sequence, @clientTimeMs, @serverTime, @target,
      @actual, @physicalCode, @shiftSide, @modifiersJson, @correct, @correction,
      @backspaces, @ikiMs, @target, @bigram, @trigram, @hand, @finger, @row, @zone,
      @characterClass, @contentMode, @sequence, @wordBoundary, @afterError, @refocus,
      0, @longPause, 0, 0)`
  );
}

function eventParameters(
  plan: SessionPlan,
  event: ReturnType<typeof eventAt>,
  targetText: string
): Record<string, unknown> {
  const sequence = event.sequence;
  return {
    ...event,
    sessionId: plan.sessionId,
    lessonId: plan.lessonId,
    blockId: plan.blockId,
    clientTimeMs: sequence * 200,
    serverTime: plan.completedAt,
    bigram: sequence > 0 ? targetText.slice(sequence - 1, sequence + 1) : null,
    trigram: sequence > 1 ? targetText.slice(sequence - 2, sequence + 1) : null,
    contentMode: contentMode(plan),
    wordBoundary: Number(/\s/u.test(event.target))
  };
}

function insertBatch(database: Database.Database, plan: SessionPlan): void {
  const payloadHash = createHash("sha256")
    .update(`${plan.sessionId}:${plan.eventCount}`)
    .digest("hex");
  database
    .prepare(
      `INSERT INTO event_batches
       (session_id, batch_id, first_sequence, last_sequence, event_count, received_at, payload_hash)
       VALUES(?, ?, 0, ?, ?, ?, ?)`
    )
    .run(
      plan.sessionId,
      `fixture-batch-${plan.index}`,
      plan.eventCount - 1,
      plan.eventCount,
      plan.completedAt,
      payloadHash
    );
}
