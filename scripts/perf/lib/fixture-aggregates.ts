import type Database from "better-sqlite3";

import { FIXED_PROFILE_ID } from "./fixture-constants.js";
import type { DailyAggregate, FixtureSummary, SessionKind, SessionPlan } from "./fixture-model.js";
import { algorithmVersion } from "./fixture-schema.js";

export function addDailyAggregate(
  daily: Map<string, DailyAggregate>,
  plan: SessionPlan,
  summary: FixtureSummary
): void {
  const key = `${plan.completedAt.slice(0, 10)}:${plan.kind}`;
  const value = daily.get(key) ?? emptyDaily();
  value.activeMs += summary.activeMs;
  value.sessions += 1;
  value.characters += summary.characters;
  value.correct += summary.correct;
  value.rawWeighted += summary.rawWpm * summary.characters;
  value.netWeighted += summary.netWpm * summary.characters;
  value.accuracyWeighted += summary.accuracy * summary.characters;
  value.consistencyWeighted += summary.consistency * summary.characters;
  daily.set(key, value);
}

export function insertDailySummaries(
  database: Database.Database,
  aggregates: ReadonlyMap<string, DailyAggregate>
): void {
  const insert = database.prepare(
    `INSERT INTO daily_summaries
     (profile_id, local_date, kind, active_ms, session_count, character_count, correct_count,
      raw_wpm, net_wpm, accuracy, consistency)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [key, value] of aggregates) {
    const [date, kind] = key.split(":") as [string, SessionKind];
    insert.run(
      FIXED_PROFILE_ID,
      date,
      kind,
      value.activeMs,
      value.sessions,
      value.characters,
      value.correct,
      value.rawWeighted / value.characters,
      value.netWeighted / value.characters,
      value.accuracyWeighted / value.characters,
      value.consistencyWeighted / value.characters
    );
  }
}

export function insertAchievement(
  database: Database.Database,
  plans: readonly SessionPlan[]
): void {
  const game = plans.find((plan) => plan.kind === "game");
  if (!game) return;
  database
    .prepare(
      `INSERT INTO achievements(profile_id, achievement_id, unlocked_at, metadata_json)
       VALUES(?, 'first-breach', ?, '{"level":1}')`
    )
    .run(FIXED_PROFILE_ID, game.completedAt);
}

export function insertFeatureStats(database: Database.Database): void {
  const columns = [
    ["key", "feature_char"],
    ["bigram", "bigram"],
    ["trigram", "trigram"],
    ["finger", "mapped_finger"],
    ["hand", "mapped_hand"],
    ["row", "keyboard_row"],
    ["zone", "zone"],
    ["class", "character_class"],
    ["content-mode", "content_mode"]
  ] as const;
  const insert = database.transaction(() => {
    for (const [featureType, column] of columns) insertFeatureType(database, featureType, column);
  });
  insert();
}

function insertFeatureType(database: Database.Database, featureType: string, column: string): void {
  database
    .prepare(
      `INSERT INTO feature_stats
       (profile_id, feature_type, feature_value, short_alpha, short_beta, long_alpha, long_beta,
        short_iki_ms, long_iki_ms, iki_mad_ms, sample_count, current_streak, recent_window_json,
        last_practiced_at, learning_slope, algorithm_version, updated_at)
       SELECT ?, ?, ${column}, 2 + SUM(is_correct), 1 + SUM(1 - is_correct),
              2 + SUM(is_correct), 1 + SUM(1 - is_correct),
              AVG(CASE WHEN is_correct = 1 THEN iki_ms END),
              AVG(CASE WHEN is_correct = 1 THEN iki_ms END), 0, COUNT(*), 0, '[200]',
              MAX(server_time), 0, ?, MAX(server_time)
       FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
       WHERE s.include_in_model = 1 AND ${column} IS NOT NULL AND ${column} <> ''
       GROUP BY ${column}`
    )
    .run(FIXED_PROFILE_ID, featureType, algorithmVersion());
}

function emptyDaily(): DailyAggregate {
  return {
    activeMs: 0,
    sessions: 0,
    characters: 0,
    correct: 0,
    rawWeighted: 0,
    netWeighted: 0,
    accuracyWeighted: 0,
    consistencyWeighted: 0
  };
}
