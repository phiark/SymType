export interface DatabaseQueryContext {
  readonly profileId: string;
  readonly since: string;
  readonly sinceDate: string;
  readonly latestSessionId: string;
}

export interface HotDatabaseQuery {
  readonly id: string;
  readonly sql: string;
  readonly parameters: (context: DatabaseQueryContext) => readonly unknown[];
}

export const HOT_DATABASE_QUERIES: readonly HotDatabaseQuery[] = Object.freeze([
  {
    id: "overview_counts",
    sql: `WITH selected_sessions AS (
            SELECT s.id, s.active_ms FROM sessions s
            WHERE s.profile_id = ? AND s.completed_at >= ? AND s.status = 'completed'
              AND EXISTS (SELECT 1 FROM keystroke_events e WHERE e.session_id = s.id)
          ), event_totals AS (
            SELECT COUNT(e.id) AS characters, COALESCE(SUM(e.is_correct), 0) AS correct
            FROM keystroke_events e JOIN selected_sessions s ON s.id = e.session_id
          )
          SELECT (SELECT COUNT(*) FROM selected_sessions) AS sessions,
                 COALESCE((SELECT SUM(active_ms) FROM selected_sessions), 0) AS active_ms,
                 event_totals.characters, event_totals.correct
          FROM event_totals`,
    parameters: ({ profileId, since }) => [profileId, since]
  },
  {
    id: "recent_errors",
    sql: `SELECT e.session_id, e.text_position, e.target_char, e.actual_char, e.physical_code,
                 e.server_time
          FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
          WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
            AND e.is_correct = 0
          ORDER BY e.id DESC LIMIT 20`,
    parameters: ({ profileId, since }) => [profileId, since]
  },
  {
    id: "weakness_model",
    sql: `SELECT feature_type, feature_value, sample_count,
                 short_alpha / (short_alpha + short_beta) AS accuracy, short_iki_ms
          FROM feature_stats
          WHERE profile_id = ? AND feature_type IN ('key','bigram','trigram')
          ORDER BY ((1.0 - short_alpha / (short_alpha + short_beta)) * 0.6
                    + MIN(1.0, COALESCE(short_iki_ms, 600) / 900.0) * 0.4) DESC
          LIMIT 3`,
    parameters: ({ profileId }) => [profileId]
  },
  {
    id: "confusion_top",
    sql: `SELECT target_char, actual_char, COUNT(*) AS count
          FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
          WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?
            AND e.is_correct = 0
          GROUP BY target_char, actual_char ORDER BY count DESC LIMIT 30`,
    parameters: ({ profileId, since }) => [profileId, since]
  },
  {
    id: "shift_summary",
    sql: `SELECT
            COALESCE(SUM(CASE WHEN shift_side = 'left' THEN 1 ELSE 0 END), 0) AS left_count,
            COALESCE(SUM(CASE WHEN shift_side = 'right' THEN 1 ELSE 0 END), 0) AS right_count,
            COALESCE(SUM(CASE WHEN json_extract(modifiers_json, '$.capsLock') = 1
                              THEN 1 ELSE 0 END), 0) AS caps_lock_count
          FROM keystroke_events e JOIN sessions s ON s.id = e.session_id
          WHERE s.profile_id = ? AND s.status = 'completed' AND s.completed_at >= ?`,
    parameters: ({ profileId, since }) => [profileId, since]
  },
  {
    id: "session_checkpoint",
    sql: `SELECT COALESCE(MAX(sequence) + 1, 0) AS next_sequence
          FROM keystroke_events WHERE session_id = ?`,
    parameters: ({ latestSessionId }) => [latestSessionId]
  },
  {
    id: "daily_trend",
    sql: `SELECT local_date, kind, active_ms, character_count, net_wpm, raw_wpm,
                 accuracy, consistency
          FROM daily_summaries WHERE profile_id = ? AND local_date >= ?
          ORDER BY local_date, kind`,
    parameters: ({ profileId, sinceDate }) => [profileId, sinceDate]
  }
]);
