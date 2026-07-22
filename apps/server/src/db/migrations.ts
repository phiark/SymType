export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_local_profile_and_training_model",
    sql: `
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT 'Local typist',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE keyboard_layouts (
        id TEXT PRIMARY KEY,
        profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        preset TEXT NOT NULL CHECK(preset IN ('symmetric','standard','custom')),
        base_layout_id TEXT REFERENCES keyboard_layouts(id),
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE key_mappings (
        layout_id TEXT NOT NULL REFERENCES keyboard_layouts(id) ON DELETE CASCADE,
        physical_code TEXT NOT NULL,
        unshifted TEXT NOT NULL,
        shifted TEXT NOT NULL,
        hand TEXT NOT NULL,
        finger TEXT NOT NULL,
        keyboard_row TEXT NOT NULL,
        zone TEXT NOT NULL,
        key_width REAL NOT NULL DEFAULT 1,
        PRIMARY KEY(layout_id, physical_code)
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('calibration','training','test','game')),
        mode TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'adaptive',
        status TEXT NOT NULL CHECK(status IN ('active','paused','completed','abandoned')),
        seed INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        client_checkpoint INTEGER NOT NULL DEFAULT 0,
        active_ms INTEGER NOT NULL DEFAULT 0,
        algorithm_version TEXT NOT NULL,
        summary_json TEXT
      );

      CREATE TABLE lessons (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lesson_index INTEGER NOT NULL,
        focus_json TEXT NOT NULL,
        explanation TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(session_id, lesson_index)
      );

      CREATE TABLE micro_blocks (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        block_index INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        target_text TEXT NOT NULL,
        seed INTEGER NOT NULL,
        rationale TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        summary_json TEXT,
        UNIQUE(lesson_id, block_index)
      );

      CREATE TABLE event_batches (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY(session_id, batch_id)
      );

      CREATE TABLE keystroke_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
        block_id TEXT REFERENCES micro_blocks(id) ON DELETE SET NULL,
        sequence INTEGER NOT NULL,
        client_time_ms REAL NOT NULL,
        server_time TEXT NOT NULL,
        target_char TEXT NOT NULL,
        actual_char TEXT NOT NULL,
        physical_code TEXT NOT NULL,
        shift_side TEXT NOT NULL DEFAULT 'none',
        modifiers_json TEXT NOT NULL,
        is_correct INTEGER NOT NULL CHECK(is_correct IN (0,1)),
        is_correction INTEGER NOT NULL DEFAULT 0 CHECK(is_correction IN (0,1)),
        backspace_count INTEGER NOT NULL DEFAULT 0,
        iki_ms REAL,
        feature_char TEXT NOT NULL,
        bigram TEXT,
        trigram TEXT,
        mapped_hand TEXT NOT NULL,
        mapped_finger TEXT NOT NULL,
        keyboard_row TEXT NOT NULL,
        zone TEXT NOT NULL,
        character_class TEXT NOT NULL,
        content_mode TEXT NOT NULL,
        text_position INTEGER NOT NULL,
        is_word_boundary INTEGER NOT NULL DEFAULT 0 CHECK(is_word_boundary IN (0,1)),
        is_after_error INTEGER NOT NULL DEFAULT 0 CHECK(is_after_error IN (0,1)),
        was_refocus INTEGER NOT NULL DEFAULT 0 CHECK(was_refocus IN (0,1)),
        was_paused INTEGER NOT NULL DEFAULT 0 CHECK(was_paused IN (0,1)),
        was_long_pause INTEGER NOT NULL DEFAULT 0 CHECK(was_long_pause IN (0,1)),
        was_throttled INTEGER NOT NULL DEFAULT 0 CHECK(was_throttled IN (0,1)),
        was_repeat INTEGER NOT NULL DEFAULT 0 CHECK(was_repeat IN (0,1)),
        UNIQUE(session_id, sequence)
      );

      CREATE INDEX idx_keystrokes_session_position ON keystroke_events(session_id, sequence);
      CREATE INDEX idx_keystrokes_server_time ON keystroke_events(server_time);
      CREATE INDEX idx_keystrokes_feature ON keystroke_events(feature_char, server_time);
      CREATE INDEX idx_keystrokes_bigram ON keystroke_events(bigram, server_time);
      CREATE INDEX idx_keystrokes_zone ON keystroke_events(zone, server_time);

      CREATE TABLE feature_stats (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        feature_type TEXT NOT NULL,
        feature_value TEXT NOT NULL,
        short_alpha REAL NOT NULL DEFAULT 2,
        short_beta REAL NOT NULL DEFAULT 1,
        long_alpha REAL NOT NULL DEFAULT 2,
        long_beta REAL NOT NULL DEFAULT 1,
        short_iki_ms REAL,
        long_iki_ms REAL,
        iki_mad_ms REAL,
        sample_count INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        recent_window_json TEXT NOT NULL DEFAULT '[]',
        last_practiced_at TEXT,
        learning_slope REAL,
        algorithm_version TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(profile_id, feature_type, feature_value)
      );

      CREATE TABLE daily_summaries (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        local_date TEXT NOT NULL,
        kind TEXT NOT NULL,
        active_ms INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        character_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        raw_wpm REAL NOT NULL DEFAULT 0,
        net_wpm REAL NOT NULL DEFAULT 0,
        accuracy REAL NOT NULL DEFAULT 0,
        consistency REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(profile_id, local_date, kind)
      );

      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        daily_minutes INTEGER NOT NULL DEFAULT 10,
        target_wpm REAL NOT NULL DEFAULT 45,
        minimum_accuracy REAL NOT NULL DEFAULT 0.94,
        effective_from TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE streaks (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        current_days INTEGER NOT NULL DEFAULT 0,
        longest_days INTEGER NOT NULL DEFAULT 0,
        last_training_date TEXT
      );

      CREATE TABLE tests (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
        duration_seconds INTEGER NOT NULL,
        raw_wpm REAL NOT NULL,
        net_wpm REAL NOT NULL,
        accuracy REAL NOT NULL,
        consistency REAL NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE personal_bests (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        value REAL NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        achieved_at TEXT NOT NULL,
        PRIMARY KEY(profile_id, category)
      );

      CREATE TABLE game_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('campaign','hardcore')),
        difficulty TEXT NOT NULL CHECK(difficulty IN ('standard','hard','adaptive')),
        status TEXT NOT NULL,
        current_level INTEGER NOT NULL DEFAULT 1,
        score INTEGER NOT NULL DEFAULT 0,
        alert_value REAL NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        personal_best INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE game_levels (
        run_id TEXT NOT NULL REFERENCES game_runs(id) ON DELETE CASCADE,
        level_number INTEGER NOT NULL,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        alert_value REAL NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        summary_json TEXT,
        PRIMARY KEY(run_id, level_number, attempt_number)
      );

      CREATE TABLE achievements (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY(profile_id, achievement_id)
      );

      CREATE TABLE content_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        license TEXT NOT NULL,
        source_url TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE custom_texts (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source_id TEXT REFERENCES content_sources(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        file_type TEXT NOT NULL,
        character_count INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        include_in_model INTEGER NOT NULL DEFAULT 0 CHECK(include_in_model IN (0,1)),
        reading_position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE backups (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        reason TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: "event_batch_payload_fingerprint",
    sql: `
      ALTER TABLE event_batches ADD COLUMN payload_hash TEXT;
    `
  },
  {
    version: 3,
    name: "session_feature_model_opt_in",
    sql: `
      ALTER TABLE sessions ADD COLUMN include_in_model INTEGER NOT NULL DEFAULT 1
        CHECK(include_in_model IN (0,1));
    `
  },
  {
    version: 4,
    name: "custom_text_block_source_offsets",
    sql: `
      ALTER TABLE micro_blocks ADD COLUMN source_text_id TEXT
        REFERENCES custom_texts(id) ON DELETE SET NULL;
      ALTER TABLE micro_blocks ADD COLUMN source_start INTEGER;
      ALTER TABLE micro_blocks ADD COLUMN source_length INTEGER;
    `
  },
  {
    version: 5,
    name: "test_dual_accuracy_metrics",
    sql: `
      ALTER TABLE tests ADD COLUMN keystroke_accuracy REAL NOT NULL DEFAULT 0;
      ALTER TABLE tests ADD COLUMN final_text_accuracy REAL NOT NULL DEFAULT 0;
    `
  },
  {
    version: 6,
    name: "immutable_session_keyboard_layout_snapshot",
    sql: `
      ALTER TABLE sessions ADD COLUMN keyboard_layout_id TEXT
        REFERENCES keyboard_layouts(id) ON DELETE RESTRICT;
      ALTER TABLE sessions ADD COLUMN layout_snapshot_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE sessions ADD COLUMN layout_snapshot_json TEXT;
    `
  },
  {
    version: 7,
    name: "traditional_course_stage_identity",
    sql: `
      ALTER TABLE sessions ADD COLUMN stage_id TEXT;
    `
  },
  {
    version: 8,
    name: "period_statistics_and_retest_indexes",
    sql: `
      CREATE INDEX idx_sessions_profile_completed
        ON sessions(profile_id, status, completed_at);
      CREATE INDEX idx_micro_blocks_type_lesson
        ON micro_blocks(block_type, lesson_id);
      CREATE INDEX idx_keystrokes_block_sequence
        ON keystroke_events(block_id, sequence);
    `
  },
  {
    version: 9,
    name: "reject_invalid_persisted_json",
    sql: `
      CREATE TRIGGER validate_settings_json_insert BEFORE INSERT ON settings BEGIN
        SELECT CASE WHEN json_valid(NEW.value_json) <> 1
          THEN RAISE(ABORT, 'settings.value_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_settings_json_update BEFORE UPDATE OF value_json ON settings BEGIN
        SELECT CASE WHEN json_valid(NEW.value_json) <> 1
          THEN RAISE(ABORT, 'settings.value_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_sessions_json_insert BEFORE INSERT ON sessions BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'sessions.summary_json must be valid JSON') END;
        SELECT CASE WHEN NEW.layout_snapshot_json IS NOT NULL
                          AND json_valid(NEW.layout_snapshot_json) <> 1
          THEN RAISE(ABORT, 'sessions.layout_snapshot_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_sessions_json_update
      BEFORE UPDATE OF summary_json, layout_snapshot_json ON sessions BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'sessions.summary_json must be valid JSON') END;
        SELECT CASE WHEN NEW.layout_snapshot_json IS NOT NULL
                          AND json_valid(NEW.layout_snapshot_json) <> 1
          THEN RAISE(ABORT, 'sessions.layout_snapshot_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_lessons_json_insert BEFORE INSERT ON lessons BEGIN
        SELECT CASE WHEN json_valid(NEW.focus_json) <> 1
          THEN RAISE(ABORT, 'lessons.focus_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_lessons_json_update BEFORE UPDATE OF focus_json ON lessons BEGIN
        SELECT CASE WHEN json_valid(NEW.focus_json) <> 1
          THEN RAISE(ABORT, 'lessons.focus_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_micro_blocks_json_insert BEFORE INSERT ON micro_blocks BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'micro_blocks.summary_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_micro_blocks_json_update
      BEFORE UPDATE OF summary_json ON micro_blocks BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'micro_blocks.summary_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_keystroke_events_json_insert BEFORE INSERT ON keystroke_events BEGIN
        SELECT CASE WHEN json_valid(NEW.modifiers_json) <> 1
          THEN RAISE(ABORT, 'keystroke_events.modifiers_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_keystroke_events_json_update
      BEFORE UPDATE OF modifiers_json ON keystroke_events BEGIN
        SELECT CASE WHEN json_valid(NEW.modifiers_json) <> 1
          THEN RAISE(ABORT, 'keystroke_events.modifiers_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_feature_stats_json_insert BEFORE INSERT ON feature_stats BEGIN
        SELECT CASE WHEN json_valid(NEW.recent_window_json) <> 1
          THEN RAISE(ABORT, 'feature_stats.recent_window_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_feature_stats_json_update
      BEFORE UPDATE OF recent_window_json ON feature_stats BEGIN
        SELECT CASE WHEN json_valid(NEW.recent_window_json) <> 1
          THEN RAISE(ABORT, 'feature_stats.recent_window_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_tests_json_insert BEFORE INSERT ON tests BEGIN
        SELECT CASE WHEN json_valid(NEW.errors_json) <> 1
          THEN RAISE(ABORT, 'tests.errors_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_tests_json_update BEFORE UPDATE OF errors_json ON tests BEGIN
        SELECT CASE WHEN json_valid(NEW.errors_json) <> 1
          THEN RAISE(ABORT, 'tests.errors_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_game_levels_json_insert BEFORE INSERT ON game_levels BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'game_levels.summary_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_game_levels_json_update
      BEFORE UPDATE OF summary_json ON game_levels BEGIN
        SELECT CASE WHEN NEW.summary_json IS NOT NULL AND json_valid(NEW.summary_json) <> 1
          THEN RAISE(ABORT, 'game_levels.summary_json must be valid JSON') END;
      END;

      CREATE TRIGGER validate_achievements_json_insert BEFORE INSERT ON achievements BEGIN
        SELECT CASE WHEN json_valid(NEW.metadata_json) <> 1
          THEN RAISE(ABORT, 'achievements.metadata_json must be valid JSON') END;
      END;
      CREATE TRIGGER validate_achievements_json_update
      BEFORE UPDATE OF metadata_json ON achievements BEGIN
        SELECT CASE WHEN json_valid(NEW.metadata_json) <> 1
          THEN RAISE(ABORT, 'achievements.metadata_json must be valid JSON') END;
      END;
    `
  },
  {
    version: 10,
    name: "backfill_legacy_test_dual_accuracy",
    sql: `
      UPDATE tests
      SET keystroke_accuracy = accuracy,
          final_text_accuracy = accuracy
      WHERE keystroke_accuracy = 0
        AND final_text_accuracy = 0
        AND accuracy <> 0;
    `
  }
];
