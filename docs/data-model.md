# Data Model

SQLite is the authority. Every mutable entity belongs to the single local profile even though a
profile identifier is retained for deterministic tests and portable backups.

## Main entities

- `profiles`, `settings`: identity-free local profile and validated preferences/algorithm settings.
- `keyboard_layouts`, `key_mappings`: versioned preset copies and explicit physical-key overrides.
- `sessions`, `lessons`, `micro_blocks`: training/test/game lifecycle and reproducible generation seed.
- `event_batches`, `keystroke_events`: idempotency envelope and append-only observed training events.
- `feature_stats`, `daily_summaries`: derived behavior model and fast time-range aggregates.
- `goals`, `streaks`, `tests`, `personal_bests`: user intent and outcome records.
- `game_runs`, `game_levels`, `achievements`: campaign state separate from test rankings.
- `content_sources`, `custom_texts`: provenance, bounded plain-text content, and reading position.
  Bundled long-form passages use deterministic hidden `custom_texts` identities linked to built-in
  `content_sources`; user imports keep `source_id` null and remain the only rows shown by the custom
  text API.
- `backups`, `schema_migrations`: recovery metadata and append-only schema history.

## Event semantics

An event stores client monotonic offset and server receipt time, target/actual text, physical code,
modifiers, correctness/correction/backspace state, IKI, derived mapped hand/finger/row/zone/class,
position/boundary/error-after state, and pause/focus/throttling/repeat flags. Events come only from an
active training surface. IME composition keystrokes are ignored and never become training events.
Long-pause, refocus-first, repeat, and throttled events remain auditable but are excluded from
stable-speed estimates.

## Transactions

- Batch ingest validates the active session, inserts batch/events idempotently, updates checkpoint,
  and refreshes affected aggregates in one transaction.
- Period analytics count characters from `keystroke_events` joined only to the selected completed
  sessions. They do not join `feature_stats` or `daily_summaries`, so the multiple key/bigram/trigram/
  finger/zone feature observations produced by one keystroke cannot multiply the period character
  total. The Today dashboard uses the transactionally maintained `daily_summaries`; a regression
  checks that a 15-event session is reported as 15 characters by both projections.
- An empty periodic flush does not claim the in-flight sender slot. If a second caller queues a final
  block while another send is resolving, it waits for ownership and then drains again; completion
  cannot mistake an older empty flush for acknowledgment of the newly queued batch.
- The browser first drains its bounded, idempotent event queue. Session completion is a separate
  transaction that closes the lesson/session, stores the summary, updates the daily aggregate, and
  advances the streak from already-committed events. If the closed session has zero valid training-area
  characters, it remains auditable but does not create a daily-summary contribution or advance the
  streak; period statistics exclude it from effective-session and active-time totals. A zero-evidence
  formal test also skips the `tests` and `personal_bests` tables, while a direct ranking request is
  rejected with a stable `TEST_NO_EVIDENCE` error. For a non-empty formal test, its record and eligible
  personal best are written by the test endpoint in their own transaction. The UI does not show the
  saved completion state until every required request for that flow has succeeded; retries remain safe
  because event batches, session completion, and test creation are idempotent by durable identifiers.
- Bundled long-form progress advances monotonically only when persisted events cover every target
  position of a source-backed micro-block. Verified adjacent blocks may advance together, but a gap
  is never skipped; the evidence scan also recovers after a browser closes between a batch and the
  next-block request.
- Game failures retain immutable attempt history. A new current-level attempt receives one more than
  the persisted maximum attempt number for that run and level, including after repeated Hardcore
  whole-run resets; the active attempt starts at stage 1, score 0, and alert 0. Cumulative run score
  remains separate from the current-attempt HUD value.
- The single authoritative settings row is parsed strictly. Missing, malformed, or schema-invalid
  JSON raises a recovery diagnostic before any patch can write; defaults are seeded only for a truly
  new profile and never substitute for corrupted stored settings. A complete recognized legacy
  settings shape is a separate compatibility case described below, not a corruption fallback.
- Restore validates the complete candidate against the current schema in a rollback-only transaction,
  creates a pre-restore snapshot, and then imports only the allow-listed tables into the live database
  in one SQLite transaction. Foreign-key/application invariants are checked before commit and any
  failure rolls the import back without silently rebuilding the database. SQLite candidates also pass
  an isolated `quick_check` before staging; JSON restore performs a post-commit integrity check.

## Persisted JSON integrity

Migration v9, `reject_invalid_persisted_json`, adds `BEFORE INSERT` and `BEFORE UPDATE` triggers that
use SQLite `json_valid` to reject malformed JSON in the following authoritative columns:

| Table              | Columns                                |
| ------------------ | -------------------------------------- |
| `settings`         | `value_json`                           |
| `sessions`         | `summary_json`, `layout_snapshot_json` |
| `lessons`          | `focus_json`                           |
| `micro_blocks`     | `summary_json`                         |
| `keystroke_events` | `modifiers_json`                       |
| `feature_stats`    | `recent_window_json`                   |
| `tests`            | `errors_json`                          |
| `game_levels`      | `summary_json`                         |
| `achievements`     | `metadata_json`                        |

Nullable columns are checked whenever they contain a value. These triggers are deliberately only a
storage-syntax guard; they do not pretend that every valid JSON value has the correct domain shape.
Domain parsing uses shared Zod schemas for settings, layout snapshots, lesson focus, event modifiers,
feature windows, completed-session/error-analysis summaries, formal-test evidence, game-level
summaries, and generic persisted metadata objects. A malformed value or schema mismatch raises a
content-free recovery error that directs the user to a verified backup. Read paths must not replace a
corrupted authoritative value with defaults, an empty object/array, or a partially parsed value.

Migration v10, `backfill_legacy_test_dual_accuracy`, repairs the historical v5 default-column case:
when both newer accuracy columns are still zero and the original `accuracy` is nonzero, it copies the
original value into `keystroke_accuracy` and `final_text_accuracy`. A real zero-accuracy result and a
row with either newer metric already populated are left unchanged. Restore applies the equivalent
forward normalization by schema version: pre-v5 backups receive both columns from `accuracy`; v5–v9
rows left at the false-zero defaults are repaired; and a newer row with missing/non-finite metrics is
rejected.

Recognized historical JSON is handled by explicit, narrow upcasters before the current schema:

- Legacy settings must contain the entire original settings surface. Only subsequently introduced
  finger-color, progression, experiment, and six-weight fields may be absent; they receive documented
  defaults and the result must still pass the current settings schema. Truncated objects, unknown
  weight names, illegal ranges, and a progression threshold below the accuracy floor remain corrupt.
- Legacy session summaries must contain the original measured summary. Their original `accuracy` is
  preserved as both accuracy measures, `longestAccurateStreak` becomes zero, and unavailable error
  analysis is represented with zero samples and explicit `insufficient` evidence rather than invented
  findings. Invalid partial analysis is rejected. Both upcasts are in-memory views and do not rewrite
  the stored historical JSON merely because it was read.

An immutable session layout snapshot contains every one of the 54 ANSI-US physical codes exactly
once. Duplicate, unknown, or missing codes fail schema validation, and reconstruction throws rather
than filling a missing historical key from the current Symmetric preset. This preserves the mapping
that was authoritative when the session began.

Formal-test error JSON is internally consistent as well as structurally valid. `count` must equal the
stored event list, except for an explicitly recognized list capped at 100 events; `truncated` must
agree with that condition, and represented confusion counts cannot exceed the total. The UI may parse
the same shared schema defensively, but the server refuses a corrupted row instead of describing it as
zero errors.

`integrityCheck()` combines SQLite `quick_check`, `foreign_key_check`, JSON validity/container checks
for every column above, and domain-schema checks for every enumerated stored structure, including
event modifier objects. The distinction matters: the migration prevents new malformed JSON text,
while integrity/read checks also detect older or externally modified values whose JSON syntax is
valid but whose shape is not. Because a full schema scan is comparatively expensive, a cached result
is keyed by SQLite `total_changes()` plus `PRAGMA data_version`: same-connection and other-connection
writes both invalidate it. Backup, restore, and application-invariant boundaries request an explicit
fresh scan rather than relying on the cache.

JSON restore preview is a real rollback-only import into the current schema, followed by profile,
settings, default-layout, active-layout, goal, streak, foreign-key, and full integrity assertions. It
cannot mutate the live database. A confirmed JSON restore first creates a `pre-restore` snapshot,
imports only allow-listed tables in one transaction, and runs a post-commit integrity check. SQLite
candidates first pass signature/read-only `quick_check` and required-table/schema-version inspection,
then use the same candidate validation; cataloged SQLite snapshot creation/rotation also opens the
file read-only and checks foreign keys plus every persisted-JSON domain schema, including modifiers.
A confirmed restore creates `pre-sqlite-restore`. Any failed validation or invariant check leaves the
current database intact rather than rebuilding it.

## Portability

JSON exports include an explicit format marker, schema version, algorithm version, export time, and all
allow-listed durable tables; restore validates their structure and a rollback-only import before commit.
CSV is an analytical projection, not a restorable backup. Verified SQLite snapshots carry a SHA-256
checksum in the backup catalog. SQLite and JSON backup flows exclude logs and never require browser
storage.

## Cross-process authority invariant

A completed session is durable only if a newly started server process can reopen the same exact
SQLite file and reproduce its identity and totals without help from the writing browser. The release
acceptance records the completed session ID, contiguous event sequence, event characters, dashboard
session/character totals, all-time session/character/correct/error totals, and bootstrap database
path before shutdown. After graceful process exit and restart, a fresh WebKit process with an empty
browser context must obtain the identical API/export snapshot and render the same Today and Analytics
session/character totals. This verifies the product boundary directly: browser storage is neither a
backup nor a recovery input.
