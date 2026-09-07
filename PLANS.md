# SymType Delivery Plan

**Last reconciled:** 2026-09-07
**Working method:** document-driven; every implementation pass begins from this plan and the
requirements matrix, and every completed pass records evidence in `docs/progress-log.md`.

SymType 2.0 is now an active convergence release. `docs/v2/V2-SCOPE.md`,
`docs/v2/V2-PLAN.md`, and `docs/v2/REQUIREMENTS-MATRIX.md` control all new work. V2 cannot add or
remove a V1 user function or silently redefine its business contract; V2-D014 permits corrected
fixed outputs only for confirmed implementation drift with focused regression evidence.

The current candidate is Issue #18 on `refactor/18-product-experience`, based on merged PR #4
(`481a2cb`). Its [product review](docs/v2/ISSUE-18-PRODUCT-REVIEW.md) and
[acceptance log](docs/v2/evidence/issue-18/ACCEPTANCE.md) control current evidence. Earlier command
counts below remain historical. The separate macOS distribution PR #6 is not part of this branch.

## Purpose

Build a daily-use local typing trainer for ANSI US QWERTY with configurable Symmetric finger zoning,
adaptive lessons, actionable analytics, safe local data management, and Pineapple Breach.

## Context

The workspace began empty on 2026-07-20. Node 25.3.0 and npm 11.7.0 were present; the supported
runtime target is active Node LTS 22/24 (Node 24 recommended). The prompt referred to eight Keybr screenshots, but no
image files were exposed in the workspace, so screenshot-specific mapping comparison is tracked as a
transparent evidence limitation. Public Keybr behavior is a functional reference only.

## Architecture

An npm workspace contains a React/Vite browser client, one Fastify process that serves `/api/v1` and
the production client, a SQLite repository/migration adapter, pure server-domain analyzers,
deterministic shared algorithms, and offline bundled content. Browser state is disposable; all
completed work is server-authoritative.

## Milestones

| Phase | Deliverable                           | Dependency | Exit verification                      | Status          |
| ----- | ------------------------------------- | ---------- | -------------------------------------- | --------------- |
| 1     | Repo, docs, health, SQLite, launchers | None       | build + health + route refresh         | Done            |
| 2     | High-risk persisted typing slice      | 1          | events survive restart/browser switch  | Done            |
| 3     | All practice modes and input settings | 2          | mode E2E in both engines               | Done            |
| 4     | Adaptive engine and baseline          | 2          | deterministic unit/simulation suite    | Done            |
| 5     | Analytics and data safety             | 2, 4       | empty/small/100k + restore tests       | Done            |
| 6     | Six-level game                        | 2, 4       | success/reset/hardcore E2E             | Done            |
| 7     | Visual/accessibility polish           | 3, 5, 6    | Chromium/WebKit screenshots            | Done            |
| 8     | Release-candidate audit               | All        | Issue #18 tracks CI, review, and merge | Delivery active |

## Progress

- [x] Complete the Issue #18 product audit, original before/after captures and source changes within
      the V1 function contract; retain the Issue #14 source attribution and regression exceptions.
- [x] Pass current Node 22 checks: 64 Vitest files, 487 passed and one intentional skip, 22 literal
      regressions, production builds; full browser suite: 85 passed and one lifecycle-owner skip.
- [x] Review all 30 current browser PNGs and manually use the candidate's training/pause/exit path;
      verify 100k Today → completion → Analytics with 100,245 final events and the source hash intact.
- [ ] Complete Issue #18 repository delivery through the linked PR's CI and independent approval.

### Historical implementation checkpoints

- [x] Closed the Issue #3 whole-repository correctness pass with verified pre-migration snapshots,
      receive-order-independent feature repair, canonical `TypingSurface`/server WPM projections, a
      bounded trailing-correction checkpoint, and shared new-custom-text validation without changing
      schema version or historical imported rows.
- [x] Ran the final Issue #3 local gates under Node.js 22.16.0: `npm run check` passed 62 Vitest files
      with 452 tests and one intentional skip, the 22-test literal regression suite passed, and all
      four production builds passed. The complete production browser replay collected 74 cases:
      73 passed with one intentional lifecycle-owner skip in 8.0 minutes.
- [x] Close the second independent persisted-data audit: semantic modifier validation, explicit
      legacy JSON upcasts, historical dual-accuracy repair, complete immutable layout snapshots,
      semantic snapshot validation, aligned settings contracts, and bounded health work.
- [x] Repair the current full-suite browser failures without weakening acceptance: dark heatmap
      contrast, self-contained real-data Analytics capture, and stable calibration visual evidence;
      the subsequent complete non-update Chromium/WebKit replay passed 69 cases with one intentional
      project-owner skip, and all 30 current PNGs received a paired visual review.
- [x] Replayed the merged post-domain `npm run check` under Node 24.3.0: zero-warning lint, root and
      workspace strict typechecks, 44 Vitest files / 377 passed / one intentional skip, and all four
      production builds passed.
- [x] Added a repeatable React Profiler gate for the typing path: a deterministic 24-key burst
      accepts all 24 events while the page-shell surrogate commits exactly 8 times; focused Web tests
      pass 11/11 and the method/result are recorded in `docs/performance.md`.
- [x] Closed API-006 by moving session, statistics, and experiment analysis behind three pure domain
      modules; static boundary tests prohibit SQL/infrastructure coupling, and an integration test
      proves attack-shaped user values remain parameterized data.
- [x] Rehearsed the complete launcher coordinator from a source-only temporary copy under supported
      Node 24: clean offline install/build, schema v10 migration, occupied-port fallback, health and
      live-instance reuse, POSIX private modes, unchanged offline restart, damaged-output rebuild,
      lockfile-change decision, graceful shutdown, and cleanup all passed.
- [x] Replay `npm run check` and the complete Chromium/WebKit suite after the later typing-policy,
      Settings-reset, populated-Analytics, and game-audio regressions; do not reuse the preceding
      counts as final merged-tree evidence. The fresh supported Node.js 22.16.0 gate passed 44 files,
      382 tests, and one intentional skip. The complete browser gate passed 73 tests and had one
      intentional WebKit project-owner skip.
- [x] Complete the active persisted-data/Settings re-audit with focused evidence for recognized
      legacy JSON upcasts, v5–v9 dual-accuracy backfill, complete immutable keyboard snapshots, the
      strict six-weight/range contract, revision-safe saves and section-local backup failure, and
      formal-test error consistency; then include those tests in the same final merged gate.
- [x] Finish the strengthened game acceptance for achievement/personal-best persistence after reload
      and explicit separation from formal-test ranking, then include both engines in the final replay.

- [x] Inspected the empty workspace, runtime, CLI tools, and screenshot availability.
- [x] Recorded initial product and safety invariants.
- [x] Completed workspace, SQLite migration, production build, health, launcher reuse/port fallback,
      and readable unsupported-Node diagnostics.
- [x] Added explicit Symmetric/Standard maps, deterministic engine/content modules, 196+ unit and
      integration tests, and Chromium/WebKit browser runtimes.
- [x] Implemented the full navigation surface, twelve training entry points, persisted typing,
      calibration feedback, analytics, data controls, and six-level game UI.
- [x] Independent audit found and drove fixes for false-save behavior, active mapping propagation,
      custom-text opt-out/progress, test pause timing, bounded event buffering, and game block identity.
- [x] Implemented runtime candidate scoring, sequence-aware adaptive blocks, robust analytics,
      automatic verified backups, server-authoritative event normalization, sequential built-in
      long-form progress, and guarded training/game exits.
- [x] Repaired strict event-ingest fixtures without weakening the trust boundary; full server suite
      passes 4 files / 30 tests, including 21 integration cases.
- [x] Added named backup/migration/event-trust regression suites; the expanded server suite passes
      6 files / 42 tests and proves rotation, corruption replacement, migration rollback,
      server-authoritative normalization, sequence repair, and idempotent-batch conflicts.
- [x] Completed the first 164-row evidence reconciliation (36 Verified / 126 In progress / one
      Planned / one Blocked at that historical checkpoint); corrected the documented
      completion/test transaction boundary. Later passes continue to promote rows only from evidence.
- [x] Made Standard, Hard, and Adaptive Pineapple targets respond deterministically to the current
      weakness signal with difficulty-specific weighting; content suite passes 24 tests.
- [x] Upgraded mode E2E from block generation to real UI typing and SQLite reconciliation; 12/12
      Chromium/WebKit cases pass with physical ANSI codes and opposite-side Shift input.
- [x] Established one exported runtime API schema/route registry for high-risk routes, validated
      server success responses and Web request/response boundaries, and closed the long-form source-ID
      500; root check passes 32 files / 289 tests.
- [x] Added authoritative content-mode capability aggregation with opt-out protection and an Analytics
      selector; focused server/Web suites, typechecks, lint, and format pass.
- [x] Made Today weakness recommendations cite sample size, configured target-rhythm gap, and recency;
      focused component/type/lint/format checks pass.
- [x] Added direct Web Audio allocation/filter/failure tests covering one context and all seven cues;
      focused suite 3/3 plus type/lint/format passes.
- [x] Removed custom-text arbitrary-position advancement: progress now requires matching persisted
      micro-block evidence; shared/Web/server focused suites and type/lint/format pass.
- [x] Completed the live SQLite adaptive-versus-baseline report: threshold efficiency, explicit
      24h/72h/7d pairs, recovery, calibration, weakness exposure/change, sparse-null semantics and
      enabled 100k performance are covered by shared/server/Web tests.
- [x] Repaired calibration timing and coverage semantics: the baseline now runs for four active
      minutes by default within the 3–5 minute contract, excludes paused time, rotates selected
      categories, enforces per-category evidence at the normal boundary, and passed focused
      Chromium/WebKit clock-driven E2E plus ordinary-training regression.
- [x] Expanded the Pineapple browser matrix across both engines: all difficulties, six-level success,
      every Campaign and Hardcore failure/reset, visible zero score/alert, timeout, accuracy gate,
      and blur pause/resume now pass 7/7 per engine with SQLite reconciliation.
- [x] Expanded non-game browser acceptance across both engines: Today CTA/all plan choices, guarded
      Back and refresh recovery, Caps/Shift/IME/repeat/refocus persistence, live key/space/error/
      milestone/completion audio wiring, and sound filters pass 8/8 with SQLite reconciliation.
- [x] Ran/fixed the complete Chromium/WebKit E2E and visual matrix. The latest rebuilt checkpoint
      collected 70 cases, passed 69 with one intentional skip in about six minutes, and all 30 current
      screenshots were reviewed in Chromium/WebKit route/state/flow pairs without observed clipping,
      overflow, false statistics, or engine-semantic drift.
- [x] Extended axe/overflow/keyboard assertions beyond idle routes to onboarding, active training,
      exit dialog, completion, dark theme, and disconnected state in both engines; 200% zoom remains
      a manual/RC check.
- [x] Reconcile README and all three one-click launchers against supported-Node, offline/reuse/port,
      migration, log/data/backup, browser-open, and readable-failure requirements, with runnable
      macOS evidence and honest static-only Windows/Linux evidence on this host.
- [x] Demonstrate one persisted history through an actual service restart and then read that same
      SQLite history from the other supported browser engine; storage clearing alone is insufficient.
- [x] Run the final Issue #3 local release-candidate gates and reconcile the current requirement
      evidence without promoting unavailable manual or external evidence.
- [x] Commit and push the Issue #3 branch, then open linked, ready-for-review PR #4 against `main`.
- [ ] Pass final-head CI and one independent approval, resolve conversations, and squash merge only
      after the branch is current.

## Document-driven execution protocol

1. Select work only from an unresolved requirement or a recorded audit finding.
2. Record scope, risk, and intended verification in `docs/progress-log.md` before changing code.
3. Implement the smallest coherent change without weakening tests or data invariants.
4. Run the named verification commands and record exact pass/fail evidence.
5. Update this plan, `docs/requirements-matrix.md`, `docs/decisions.md`, and relevant design/data
   documents in the same pass. A file existing is never sufficient evidence for “Verified.”
6. Keep only Done, Blocked, or reasoned Cancelled items at release sign-off.

## Acceptance Criteria

The authoritative criteria are the original specification and `docs/requirements-matrix.md`. In
particular: one-click local startup, server SQLite persistence across browser reset, correct explicit
key mapping, real adaptive micro-blocks, every named mode, real audio, actionable analytics, safe
backup/restore, six complete game levels, and green quality commands in Chromium and WebKit.

## Decision Log

- D-001: Use one local Fastify origin for production to reduce security and persistence ambiguity.
- D-002: Require Node 22.12.x or Node 24.x LTS. Node 25 is accepted only through an explicit
  diagnostic/test override and is not a supported daily runtime.
- D-003: Keep physical key mapping in `packages/shared`; UI may never infer finger from characters.
- D-004: Use browser Web Audio synthesis so no network or licensed audio asset is needed.

## Risks

- Native SQLite installation varies by Node ABI; launcher diagnostics must distinguish Node mismatch.
- Safari key/audio behavior requires real WebKit acceptance tests and a user-gesture unlock path.
- Large raw-event datasets need indexes, aggregate tables, and bounded query windows.
- A broad surface can hide inert controls; matrix and final independent route/control audit prevent it.

## Surprises & Discoveries

- Referenced screenshots were not present in the directory at kickoff; visual target is therefore the
  written independent UI specification, not a claim of screenshot parity.
- The 2026-07-21 reconciliation found stale duplicate generated artifacts and two obsolete duplicate
  sources (`tests/e2e/game.spec 2.ts` and `apps/web/src/pages/TrainPage 2.tsx`). Their canonical
  counterparts contain the later, stronger functionality; neither duplicate is imported.
- The requirements matrix and UI rubric described an empty/not-built repository despite a
  substantial implementation. The matrix is now reconciled row by row; browser-dependent rows stay
  In progress until fresh visual/E2E evidence, and no bulk “Verified” promotion was used.
- At the initial Gate 0 checkpoint the repository had no committed product baseline and all files were
  untracked. PR #2 later entered the reviewed project through the required workflow and was
  squash-merged as `a10e9a8`; the Issue #3 review now uses that Git baseline in addition to the file
  inventory, dependency/license review, source scans, and recorded checksums.
- The original calibration flow could finish after one 52-character block per selected category,
  contradicting the specified 3–5 minute baseline. The corrected policy measures active monotonic
  time, rotates small category samples, and separates the normal evidence boundary from a five-minute
  safety cap.
- The first complete game matrix exposed defects that happy-path unit coverage did not: actual window
  blur was not handled, the final long level could submit fractional milliseconds to an integer API,
  repeated Hardcore resets reused an attempt key, and the HUD conflated cumulative run score with the
  reset attempt score. Each defect now has a browser or integration regression.
- The Windows E2E entrypoint was not actually portable because Playwright used POSIX inline
  environment assignment. Moving test defaults into its Node bootstrap keeps the release command
  identical on macOS, Linux, and Windows without changing production configuration.
- Restore does not replace the open SQLite file: validated JSON or staged SQLite table data is applied
  to the live schema in a single transaction after a safety snapshot. The earlier data-model wording
  described a different close/replace/reopen design and was corrected to match the tested implementation.
- The first complete 28-image render set exposed that one shared E2E database makes cross-engine
  screenshots inherit different prior histories. Release E2E now assigns Chromium and WebKit their
  own freshly reset data directory and loopback port, while keeping the same test order and fixtures.
- A completed timer with zero valid characters previously produced a success icon and advanced daily
  aggregates. The corrected contract closes the session safely but excludes it from goals/streaks and
  labels the completion state as having no valid input.

## Recovery

Migrations run within guarded transactions and never silently rebuild a failed database. Restore
always creates a verified current-database backup first; migration failure leaves the source file in
place with a readable diagnostic. `SYMTYPE_DATA_DIR` allows isolated development/test recovery.

## Outcomes & Retrospective

The historical post-domain Node 24 checkpoint passed `npm run check` with 44 Vitest files, 377 passes
and one intentional skip. Its rebuilt browser checkpoint collected 70 cases and passed 69 with one
intentional skip in about six minutes. Those results remain useful historical evidence, including the
real restart/fresh-WebKit read and production typing-performance gate, but they are not the current
candidate counts.

The final Issue #3 local candidate gate supersedes them: Node.js 22.16.0 `npm run check` passed
zero-warning lint, strict root/workspace type checks, 62 Vitest files with 452 passes and one
intentional skip, the complete 22-test literal regression suite, and all four builds. The rebuilt
production browser gate collected 74 Chromium/WebKit cases and passed 73 with one intentional
lifecycle-owner skip in 8.0 minutes. The focused seven-file data-safety replay passed 34 tests, the
isolated launcher smoke passed, and current requirement/document evidence is reconciled. Local
acceptance is complete, and commits `59f4275`/`df9f123` are published in linked PR #4. At this
publication checkpoint, final-head CI, one independent approval, resolved conversations, and squash
merge remain before repository delivery is complete; PR #4 is the authoritative live record.

The expanded experiment-enabled 100k path now measures approximately 755.5 ms for statistics plus
dashboard on this Mac. It exercises the live calibration/retention/report calculations and supersedes
the earlier lighter-query number for that richer path; neither result is a portable SLA.

The September 7 Issue #18 candidate supersedes earlier UI/performance acceptance: focused input and
keyboard cues, primary task order, settings save, navigation focus, failed-page recovery, repeated
statistics caching and fractional-timing recovery are validated together. Full 100k report equality
and revision invalidation protect existing algorithms; no migration or business-rule redesign is
introduced. The first statistics read remains about one second. See the current acceptance log for
source-specific measurements and remaining independent approval. This is not a formal release.
