# SymType Progress Evidence Log

This chronological log is the execution record for document-driven development. Each entry states
the reason for work, changed scope, verification evidence, and remaining risk. `PLANS.md` controls
sequence; `docs/requirements-matrix.md` controls traceability; `docs/decisions.md` controls durable
product and architecture choices.

## 2026-07-21 — Repository reconciliation after continuation

### Purpose

Establish a trustworthy current baseline before additional feature work. The prior documentation
still described an empty/not-built repository and therefore could not be used as release evidence.

### Observed state

- The npm-workspaces implementation, server SQLite layer, launchers, Web UI, deterministic engine,
  content, tests, and product documentation are present.
- Recent implementation includes server-authoritative event normalization, verified automatic
  backups, sequence-aware adaptive blocks, deterministic simulation, sequential built-in long-form
  progress, robust WPM/consistency analytics, monotonic game timing, and safe session-exit guards.
- The initial `docs/requirements-matrix.md` and UI rubric described an empty/not-built repository.
  This pass replaced that stale baseline with current evidence while keeping browser-dependent claims
  conservative.
- Eight Keybr reference screenshots named in the brief are absent. Only screenshot-specific mapping
  comparison (`KEY-010`) is externally blocked.
- `tests/e2e/game.spec 2.ts` and `apps/web/src/pages/TrainPage 2.tsx` are obsolete weaker duplicates
  of canonical files and are not imported. Generated E2E databases/reports also contain Finder-style
  numbered copies; these are test artifacts, not authoritative product data.
- The working tree has no committed baseline; all repository files are currently untracked.

### Verification started

- Product Design audit instructions and local saved-context preflight were read; no saved product
  context exists.
- File inventory, duplicate checksums, and the current plan/rubric/matrix were inspected.
- Removed the proven-obsolete `tests/e2e/game.spec 2.ts` and
  `apps/web/src/pages/TrainPage 2.tsx`; canonical sources are unchanged.
- Formatted `apps/server/src/db/database.ts` and ran
  `npm run typecheck --workspace @symtype/server`: passed on 2026-07-21.
- Ran `npm test --workspace @symtype/server -- app.integration.test.ts`: 1 file, 21 tests,
  all passed. This is current evidence for the strict session/event/restore/statistics/game
  integration fixtures.
- Ran the full server workspace verification: 4 test files / 30 tests passed; `apps/server`
  ESLint passed with zero warnings; server Prettier check passed.
- Playwright inventory currently contains 17 flows × 2 engines (34 cases), but only one of the
  eight required screenshot baselines exists (`analytics` on Chromium). Seven baselines and all
  1024px screenshot evidence remain unresolved; the normal E2E release gate is not yet green.
- Full `lint`, `typecheck`, unit/integration, build, Chromium, and WebKit results are intentionally
  pending the fresh quality audit; earlier partial results will not be promoted to current evidence.

### Fresh quality evidence

- `npm run check` passed on the current default Node 25 diagnostic runtime: ESLint zero warnings;
  strict root/workspace typecheck; 29 Vitest files / 270 tests passed; shared/content/Web production
  builds and Fastify server bundle succeeded. Node 25 remains unsupported for daily use.
- `npm run format:check` passed after removing the two obsolete source duplicates and formatting the
  changed database, documentation, and E2E files.
- The server integration benchmark reported the 100k-event statistics + dashboard query below the
  local 5-second evidence guard (approximately 0.4–0.45 seconds on this Mac in the audit runs). This
  is machine-specific evidence, not a universal performance guarantee.
- A supported Node 24.3.0 isolated offline launcher smoke passed dependency reuse/build, schema v8
  migration, occupied-port fallback, health/integrity, instance reuse, and graceful shutdown. A
  direct Node 24 test against the Node-25-built working `node_modules` correctly failed only because
  the native `better-sqlite3` ABI differed; the launcher rebuild path is the supported transition.

### Quality gaps retained

- The data-integrity gap was closed with `apps/server/test/backup-migration.test.ts` (7 cases) and
  `apps/server/test/event-ingest-integrity.test.ts` (5 cases). The tests now prove same-day automatic
  backup deduplication, checksum/corruption replacement, seven-valid-snapshot rotation, v1→v8
  history-preserving migration, transactional migration rollback, rejection of forged immutable
  event facts, server normalization of derived dimensions, sequence-order repair of
  `is_after_error`, and batch-idempotency conflict handling.
- Focused verification passed 2 files / 12 tests; the expanded server suite passed 6 files / 42
  tests, followed by server strict typecheck, zero-warning ESLint, Prettier, and production build.
  No production defect was exposed, so this pass added only regression evidence.
- One audit run observed jsdom SVG casing warnings around the Today chart. Immediate isolated and
  full Web reruns were clean (15 files / 60 tests); retain console monitoring in E2E rather than
  treating the non-reproduced warning as an active defect.

### Next gate

1. Complete persisted-micro-block coverage for every practice mode and reconcile content-mode tags.
2. Close the shared API-contract, capability-model, calibration, experiment, and game-personalization
   audit gaps with focused tests.
3. Run Chromium/WebKit E2E, generate the missing visual baselines, and inspect every current image.
4. Re-run `npm run check` after all code changes, then reconcile every matrix row and UI rubric score
   from those exact results.

### Requirements reconciliation (historical 2026-07-21 baseline)

- Reconciled all 164 stable requirement IDs against the code, tests, audit findings, and progress log
  available at that checkpoint. It contained 36 `Verified`, 126 `In progress`, one deliberately `Planned`
  final-delivery row (`DOC-008`), and one externally `Blocked` screenshot comparison (`KEY-010`).
- Browser-, visual-, auditory-, and full-workflow requirements were not promoted merely because a
  source file or collected Playwright case exists. Their evidence cells now name the exact remaining
  proof or known semantic gap.
- Corrected `docs/data-model.md`: the Web client drains event batches first; completion and formal
  test/PB persistence use separate idempotent transactions, and the completion UI waits for every
  required request. The previous wording incorrectly described one all-encompassing transaction.

## 2026-07-21 — Active remediation batch

### Planned scope and evidence

- Repair the discovered built-in long-form contract mismatch (`builtin-long-form:*` source IDs were
  rejected by a UUID-only response schema), then prove a real persisted block for every practice
  mode through Chromium and WebKit.
- Make Standard and Hard Pineapple Breach target selection respond to the same current-weakness
  signal already used by Adaptive, with smaller deterministic weighting so their documented
  difficulty character remains intact. Verify seeded determinism, focus preference, and no-focus
  fallback in content tests.
- Expand current visual/a11y evidence at 1024px, dark theme, active typing, exit confirmation,
  completion, and deterministic error states. Snapshot baselines will be generated and accepted only
  after manual image inspection in both engines.
- Consolidate high-risk API contracts around shared Zod schemas and add drift tests without
  weakening the server's local trust boundary.
- Promote authoritative `content_mode` from an event-only dimension into the rolling/period feature
  model and expose it in Analytics, with ingestion/statistics/UI tests. This must not let custom-text
  opt-out sessions influence the long-term model.
- Make Today recommendations state sample size, relative gap to the configured target rhythm, and
  days since the last practice instead of presenting only a raw IKI. Keep sparse/invalid timestamps
  explicit and avoid diagnostic language.
- Add direct Web Audio service tests for one-context reuse, all seven cue names, volume/theme
  configuration, key-only/error-only filters, disabled sound, and nonblocking unlock failure. This
  complements but does not replace the WebKit gesture E2E and final real-Safari listening check.
- Complete the live adaptive-vs-baseline report with threshold characters/minutes, 24h/72h/7d
  retention evidence, post-error recovery, calibration buckets, and weakness exposure-after-change.
  Missing scheduled retests or sparse buckets must remain null/insufficient rather than borrowing
  simulated outcomes or claiming significance.
- Close the remaining non-game browser gaps with server-reconciled scenarios for Today plan
  propagation, Shift/Caps/IME/repeat/refocus event semantics, guarded navigation, and live sound
  trigger/filter wiring. AudioContext instrumentation may prove synthesis calls but cannot be
  described as an audible real-Safari listening result.
- Rehearse the release documentation and launchers against their actual scripts: supported Node
  bounds, repository-relative working directory, dependency/build stamps, migration/health/reuse,
  OS data/log/backup paths, offline daily startup, browser opening, readable failure behavior, and
  platform-specific limitations. Only defects demonstrated by source or repeatable checks may be
  changed.

### Risks

- Contract changes must accept explicit local source identifiers without relaxing unrelated UUID
  identifiers.
- Weakness weighting must not make Standard/Hard unpredictable, starve level-specific targets, or
  alter pass/fail thresholds.
- Visual snapshots must not encode transient IDs, timestamps, animation frames, or seeded content
  that differs between engines.

### Pineapple weakness-personalization result

- Replaced the Adaptive-only selection switch with deterministic weakness weighting for all three
  difficulties. Standard uses a restrained multiplier, Hard uses a stronger multiplier, and
  Adaptive remains the strongest; time, accuracy, alert, and target-count difficulty rules are
  unchanged. Empty weakness input still produces deterministic neutral sampling.
- Added a 160-seed distribution regression for each difficulty using the fictional Vault Phrase
  pool. Focused plans expose the requested weak character more often than neutral plans, while the
  existing exact-seed replay tests continue to pass.
- Verification passed: content suite 1 file / 24 tests, content strict typecheck, zero-warning ESLint,
  and Prettier. This closes the audited production-code gap; a current full-game browser run remains
  required before `GAM-003` can be promoted from `In progress`.

### Pineapple Breach full state-machine acceptance

- Expanded `tests/e2e/game.spec.ts` to seven serial acceptance flows per engine. The matrix now starts
  Standard, Hard, and Adaptive against their current weakness-aware authored pools; completes all six
  levels through physical-key typing; fails and cleanly retries every Campaign level; fails Hardcore
  at each level 1–6 and proves a whole-run reset; exercises a real monotonic timeout, the three-stage
  accuracy gate, and blur pause/manual resume without moving the deadline.
- Four product defects were found and fixed. A real window blur now pauses the shared typing surface,
  not only a document visibility change. Fractional final-level active time is rounded before the
  strict completion contract. Repeated Hardcore cycles allocate `game_levels.attempt_number` from
  the persisted maximum instead of colliding at attempt one. The reset HUD reads the latest active
  level attempt so it visibly reports current-level score zero rather than the prior cumulative run
  score.
- Both UI and SQLite are reconciled on reset: stage 1, current level/run as applicable, score 0,
  alert 0, retained failed-attempt history, and a successful retry. The timeout and accuracy-gate
  flows verify the persisted failure reason, while blur testing proves the visible timer freezes and
  resumes from the same monotonic deadline.
- Focused verification passed: Chromium 7/7 in 44.6 seconds; WebKit 7/7 in about one minute; the
  repeated-Hardcore integration regression 1/1; affected server/Web/root typechecks; targeted
  zero-warning ESLint. Port 4173 was confirmed released after the run. These are diagnostic-Node-25
  browser results and still require the final supported-LTS release pass.

### Persisted practice-mode result

- Upgraded `modes-input.spec.ts` from server-only block generation to real UI typing for ten built-in
  mode families. Each case completes a visible micro-block, observes the successful event POST and
  next-block boundary, exits through the guarded UI, then reconciles the SQLite export for session
  kind/mode/status, exact event count, contiguous sequence, block identity, and authoritative
  `content_mode`.
- The browser helper now emits ANSI physical codes and uses the opposite Shift side for uppercase and
  symbols. This exercises the same server normalization boundary as real typing instead of relying on
  `keyboard.type` text insertion.
- The pass exposed a real long-form failure: `builtin-long-form:*` source identifiers were rejected
  by a UUID-only response schema. The shared contract was narrowed to accept only the explicit local
  source-ID form in addition to UUID custom-text IDs; the previously failing block now succeeds.
- Focused result: 12/12 Playwright cases passed across Chromium and WebKit in about 1.4 minutes;
  Prettier, targeted ESLint, and shared/Web typechecks passed. The run used diagnostic Node 25 and is
  valid browser-behavior evidence, not the supported-Node release-runtime gate.

### Visual/accessibility coverage implementation

- Added `tests/e2e/visual-matrix.spec.ts`. It defines 18 unaccepted image baselines covering five
  primary routes at 1024×768, dark active calibration, the exit dialog, completion, and a
  deterministic disconnected/bootstrap error state. It also checks document overflow, dynamic axe
  WCAG A/AA results, dialog focus containment, typing-surface focus, completion-heading focus, and a
  WebKit-compatible Option+Tab path.
- Fixed three defects exposed by those assertions: onboarding progress is now a semantic progressbar
  with values; dark danger-button contrast uses a dedicated foreground token; and native select
  controls in dark completion feedback have explicit readable background/border/text colors.
- Functional evidence passed across both engines with snapshots ignored: all 8 new assertion paths;
  a focused dynamic-state run passed 2/2. Onboarding unit tests passed 5/5, followed by ESLint,
  Prettier, and root typecheck. Playwright now collects 42 cases across six specs.
- No image was generated or accepted by the agent. The root visual gate must create all 18 baselines,
  inspect each image, repair visible issues, and then run the suite normally; the UI rubric remains
  unscored until that evidence exists.

### Calibration active-time repair

- Replaced the one-short-block calibration stop condition with a pure, deterministic policy in
  `apps/web/src/calibration-policy.ts`. Calibration requests are constrained to 3–5 active minutes
  (four minutes by default), rotate only the selected categories through short micro-groups, require
  at least 12 recorded events per selected category at the normal completion boundary, and retain a
  strict five-minute active-time cap for sparse input.
- Calibration elapsed time is based on `performance.now()` with paused intervals subtracted. The UI
  now exposes remaining active time and a semantic progressbar; ordinary lessons and formal tests
  retain their existing completion branches. The result builder still emits a row for every selected
  category and labels insufficient coverage honestly if the hard cap is reached.
- Focused verification passed: calibration-policy unit suite 6/6; strict Web typecheck; targeted
  zero-warning ESLint and Prettier; Chromium/WebKit selected-category E2E 2/2 with Playwright Clock.
  The browser test proves category rotation/repetition, no early completion, two paused wall-clock
  minutes excluded, completion at 240000–241999 active ms, and selected-only persisted summaries.
  A smart-course regression also passed 2/2 across both engines, preserving its five-block behavior.
- The duration evidence uses Playwright's browser-native clock plus pure policy tests, not a literal
  four-minute human typing run. The polling loop can observe the hard cap up to roughly 200 ms late,
  while the persisted active duration is frozen before asynchronous completion begins. Current
  calibration-result screenshots remain part of the final visual gate.

### API contract hardening result

- Made `packages/shared/src/runtime-api.ts` the sole package-root export for current `/api/v1` Zod
  contracts and added a route registry. The legacy `api-schemas.ts` remains explicitly deprecated for
  compatibility but is no longer exported as a competing public contract.
- Fastify now validates registered high-risk successful responses before serialization and reuses
  shared request schemas. The Web API client validates matching requests before send and responses on
  receipt; bootstrap/settings/session-summary Web types are inferred from those same schemas.
- At this first checkpoint, registered health/bootstrap/profile/settings/preferences,
  session/event/block/statistics, game run/result, and JSON/SQLite import routes. The then-secondary
  layout/dashboard/goal/test/custom-text/backup/export boundary was closed by the later full-route
  consolidation section below; this paragraph is retained as chronological evidence, not current state.
- Added shared/Web drift tests and a server contract integration test. The long-form source schema is
  narrowly `UUID | builtin-long-form:<stable-slug>` and rejects arbitrary/path-traversal-like IDs.
- A current root `npm run check` passed after this batch: lint, strict typecheck, 32 test files / 289
  tests, and every production build. Focused totals were shared 160, Web 62, server 43; the registered
  server contract integration passed 1/1. Central docs were then updated and require a fresh format
  check before the next gate.

### Custom-text progress trust-boundary result

- Closed the arbitrary monotonic-position bypass on
  `PATCH /api/v1/custom-texts/:id/progress`. `blockId` is now required and must identify the matching
  persisted custom-text micro-block; optional `readingPosition` is only an exact endpoint assertion.
  The unused database method that advanced to an arbitrary supplied position was removed.
- The shared strict request/response contract is registered for both Fastify and the Web client. The
  existing UI already sent block identity plus endpoint, so normal behavior remains compatible while
  forged clients can no longer skip unread text.
- Focused evidence passed: shared runtime schema 8/8, Web API 5/5, server integration 21/21, all three
  affected workspace typechecks, zero-warning targeted ESLint, and Prettier. Integration cases cover
  missing block, wrong text/session, gaps, endpoint mismatch, idempotent retry, and contiguous 20→40
  advancement. A fresh custom-text browser run remains part of the final E2E gate.

### Content-mode capability result

- Added server-derived `content-mode` to both long-term `feature_stats` updates and period-scoped
  feature reconstruction. It uses the immutable session/block context, never the client-supplied
  mode, and still honors `include_in_model`; opted-out custom-text sessions do not update the durable
  model.
- Analytics now exposes localized feature selectors, including 内容模式, and presents the same sample,
  accuracy/interval, robust timing, and learning-slope evidence used by other feature dimensions.
- Focused verification passed: server event-integrity suite 7/7, Analytics component suite 5/5,
  server/Web strict typechecks, zero-warning targeted ESLint, and Prettier. The new server test proves
  authoritative mode aggregation, opt-out exclusion, and period-statistics exposure.

### Explainable Today recommendation result

- Today now explains the leading weak feature with its type/value, sample count, short-term accuracy,
  robust short-term IKI, percentage gap to the configured target-WPM rhythm, and days since practice.
  Sparse speed or missing/invalid recency stays explicit; wording describes observed behavior and
  does not claim a physical-finger or neurological diagnosis.
- Focused verification passed: Today component suite 2/2, Web strict typecheck, zero-warning targeted
  ESLint, and Prettier. The deterministic fixture proves a 349 ms `ct` interval is reported as 31%
  slower than the configured 45 WPM rhythm with 42 samples and a two-day retest gap.

### Live adaptive-versus-baseline evidence report

- Completed the personal experiment report over server-authoritative SQLite training sessions and
  events. Each strategy now reports correct characters and active minutes to the configured stable
  WPM/accuracy threshold, 24h/72h/7d focus-to-retest pairs, median eligible post-error recovery IKI,
  sequential Beta prediction Brier/log loss plus five calibration buckets/ECE, and first-five versus
  last-five change for observed weak characters. Existing transfer gap, effective correct
  characters/minute, subjective difficulty/fatigue, exit rate, samples, and uncertainty remain in the
  same evidence surface.
- Sparse evidence is structural rather than cosmetic: threshold values stay null without at least 20
  eligible timing samples in a qualifying session; retention requires two unique context-matched
  focus/retest pairs in explicit 18–36h, 60–84h, or 144–192h windows; post-error recovery needs three
  valid samples; calibration ECE needs 30 events and a displayed bucket needs five; weakness aggregate
  change needs three initially weak characters with ten observations each. The comparison remains
  “尚无结论” before 14 observed days and five completed sessions per strategy and never claims
  significance or causality.
- The query groups events into session/block/character indexes once before calculating strategy
  metrics, avoiding repeated whole-table scans. The enabled-experiment 100k fixture returned
  statistics plus dashboard in 755.5 ms on this Mac, within the local five-second evidence guard;
  this remains machine-specific rather than a universal performance promise.
- Focused verification passed: server integration 22/22 (including sparse and populated live
  fixtures), Analytics component 5/5, shared runtime-contract 8/8, shared/server/Web strict
  typechecks, zero-warning targeted ESLint, and Prettier. The current Analytics experiment visuals
  still belong to the final Chromium/WebKit visual gate.

### Web Audio service evidence

- Exported the already-used `SoundEngine` class for isolated tests without changing its singleton
  product instance. A fake standards-compatible AudioContext verifies the real synthesis calls and
  allocation behavior rather than bypassing the service.
- The service suite proves one reusable context across repeated unlocks, configured master volume,
  all seven required cue names, oscillator/envelope start-stop scheduling, keys-only and errors-only
  filters, zero allocation while disabled, and a resolved `false` rather than a thrown error when
  gesture unlock fails.
- Focused verification passed: audio suite 3/3, Web strict typecheck, zero-warning targeted ESLint,
  and Prettier. This complements the existing WebKit gesture-flow E2E; real Safari listening and
  every live trigger remain release evidence still to collect.

### Today, input-boundary, audio-wiring, and navigation acceptance

- Today now has an accessible accuracy-first/balanced/speed selector initialized from the persisted
  server setting. All 5/10/15/20-minute choices, “system decides,” and the dominant primary action
  propagate the selected mode, duration, bias, and auto-choice flag; the primary action uses the
  system-computed remaining-goal duration rather than silently falling back to a fixed shortcut. The
  ready screen repeats the effective duration, intent, and system-choice state before a session starts.
- A real four-block Shift session now reconciles contiguous SQLite events for missing Shift,
  same-hand Shift, Caps Lock, the first key after focus loss/pause, and the subsequent flag clear.
  IME-composition and repeat events are ignored; completion error analysis and period Shift totals
  agree with the raw persisted event deltas.
- Injected standards-shaped AudioContext instrumentation in both engines proves live key, space,
  error, 50-key milestone, and completion triggers, a single reused context/resume path, and Settings
  all/keys-only/errors-only filters. Alarm/success remain covered by the game path and the seven-cue
  service suite. This is synthesis/API wiring evidence, not a claim that headless automation heard
  hardware output or that real Safari audio was manually auditioned.
- Same-app Back now opens the guarded exit dialog, cancel cleanly resumes, and a hard refresh after a
  24-event batch recovers/abandons the interrupted session without losing sequences 0–23. The test
  exposed and fixed a React Router blocker race that immediately reopened the dialog after cancel.
- Focused evidence passed: Today/TypingSurface/navigation Vitest 3 files / 15 tests; Web and root
  strict typechecks; targeted zero-warning ESLint and Prettier; new browser acceptance 8/8 (four
  Chromium + four WebKit) in 46.7 seconds. Headless focus loss uses a real dispatched browser
  `FocusEvent` because tab foreground switching is nondeterministic, and Caps Lock uses a native
  `KeyboardEvent.getModifierState` fixture because Playwright cannot lock that modifier consistently;
  both then traverse production listeners and reconcile SQLite.

### Cross-platform Playwright runner correction

- The launcher audit found that `playwright.config.ts` embedded POSIX-only inline environment
  assignment in `webServer.command`, so `npm run test:e2e` could not start from Windows `cmd.exe`.
  Test-only defaults now live inside `tests/e2e/start-server.mjs` and the configured command is the
  platform-neutral `node tests/e2e/start-server.mjs`.
- Static verification passed: start-server syntax, targeted zero-warning ESLint, Prettier, root
  no-emit TypeScript, and Playwright collection of 56 cases across seven specs. The complete browser
  suite after this runner change remains part of the release gate.

### Complete shared API request/response contract

- The authoritative registry now classifies all 45 route declarations found in `app.ts`: 43 JSON
  contracts and two intentional non-JSON download contracts. A source-enumeration drift test proves a
  one-to-one match in both directions, so an added or removed route cannot silently escape review.
- All JSON request bodies and successful responses, plus every named path parameter and query object,
  use shared Zod schemas. Fastify validates params/query before route dispatch and 2xx payloads before
  serialization; the Web transport derives named params/query from the actual URL and rejects an
  invalid request locally. Route handlers reuse the same schemas instead of retaining private copies.
- CSV and SQLite downloads remain honest byte boundaries rather than fake JSON: the registry pins
  response kind and Content-Type, SQLite download/read protection retains CSRF, SQLite upload pins its
  accepted media types, and staged candidates still pass database integrity validation.
- Focused evidence passed: shared contract 11/11, Web API 9/9, server contract integration 6/6, and
  strict typechecks for all three workspaces. The subsequent Node 24 root gate passed these changes in
  the combined 36-file / 325-case suite.

### Supported-Node combined non-browser release gate

- Rebuilt the native SQLite binding for Node 24.3.0, then ran `npm run format:check` and the complete
  `npm run check` with that supported runtime. Format, zero-warning ESLint, root plus all workspace
  strict typechecks, 36 Vitest files, and every production build passed.
- Vitest reported 324 passed and one environment-conditional skip out of 325 cases. The skipped
  launcher assertion is the branch that rejects an unsupported Node release; it is intentionally
  skipped when the current runtime is supported and remains covered by the earlier diagnostic-runtime
  launcher fixture.
- Vite built 2,482 modules and Fastify's bundled entry successfully. This is the first current combined
  gate after API, training-policy, completion-retry, notice, and settings-integrity remediation; the
  screenshot-generating E2E run remains the next gate.

### First full visual-release run findings

- The first Node 24 `--update-snapshots` run executed all 58 collected cases and generated the new
  visual-matrix images, but correctly failed the release gate: 39 passed, 8 failed, and 11 later serial
  cases did not run after their prerequisite failure. No failed result is counted as acceptance.
- One real accessibility defect appeared only under WebKit's contrast calculation: seven-pixel
  heatmap percentages inherited semi-transparent text over data-dependent green cells and fell as low
  as about 3.8:1. The fix must use an opaque, sufficiently dark text token and rerun Axe in both engines.
- The onboarding “试听并解锁声音” path could unlock without an audible preview when a previous
  server-backed errors-only filter remained active: it always requested the filtered normal-key cue.
  The preview must select an allowed cue for the current sound mode while keeping the reusable context.
- Two Settings assertions became ambiguous after the accessible live region and dismissible visible
  notice intentionally exposed identical copy. Tests must target the visible notice button by role
  rather than weakening or removing the screen-reader announcement.
- The built-in-mode acceptance imposed the smart-course-only 20-character lower bound on every other
  content family; a valid generated block contained 18 characters. The mode test will verify a
  non-empty bounded real block and SQLite reconciliation, while the separate smart generator tests
  continue enforcing 20–60 characters.

### One-click launcher and release-document reconciliation

- Reconciled `README.md`, `.env.example`, `docs/launcher.md`, all three wrappers, and the shared Node
  coordinator. First install explicitly includes development dependencies even when the caller has
  `NODE_ENV=production` or an npm omit setting, while unchanged daily startup remains offline and
  skips both install and build.
- Build state now inventories every production artifact with size and SHA-256 and fingerprints
  relevant source/assets/environment inputs. A missing or damaged lazy chunk, CSS file, source map,
  or other production artifact therefore triggers a rebuild instead of leaving a partially runnable
  client.
- New macOS/Linux application-data directories and database/log/backup files use owner-only
  permissions. Empty or relative platform data roots fall back safely, and an existing override
  symlink that resolves to a filesystem root is rejected.
- Focused verification passed: launcher Vitest 9/9, server strict TypeScript, scoped zero-warning
  ESLint, Prettier, Node syntax checks, and POSIX wrapper syntax. An isolated offline smoke under Node
  24.3.0 passed production-environment first install, build, schema-v8 migration, occupied-port
  fallback, live-instance reuse, 0700/0600 permissions, unchanged restart, damaged-artifact rebuild,
  lockfile-change dry-run, and graceful shutdown.
- Host boundaries remain explicit: the executable flow was run on macOS with `--no-open`; Windows
  wrapper behavior is statically tested but not run on Windows, Linux `xdg-open` was not exercised on
  a Linux desktop, and no automation result is presented as proof that a real GUI browser was opened.
- During reconciliation, `docs/data-model.md` was corrected to describe the actual restore design:
  rollback-only candidate validation, pre-restore snapshot, and allow-listed table import in one live
  SQLite transaction. The product does not close and atomically replace the database file on restore.

### Release-candidate static audit remediation plan

- A read-only source/dependency audit found three concrete release blockers: micro-block completion
  failures after the typing surface has latched completion can lack a visible retry path; the notice
  file omits the MPL-2.0 Axe browser-test dependency; and corrupted authoritative settings JSON can
  silently fall back to defaults and later be overwritten.
- The remediation contract is: retain/retry the same completed block without generating duplicate
  events or advancing content; add the missing third-party license family; and make settings corruption
  a loud diagnostic that cannot be converted into defaults by an ordinary settings patch. Each fix
  requires a focused regression before the combined Node 24 gate.
- The same audit found no product TODO/FIXME/coming-soon marker, fake/empty button, dead local link,
  browser durable-storage use, CDN/telemetry/runtime remote endpoint, unsafe imported-HTML rendering,
  user-derived SQL interpolation, or non-fictional attack material. Those are preliminary static
  passes and will be rechecked after remediation.

### Authoritative-settings corruption guard

- `getSettings` no longer passes malformed or schema-invalid authoritative JSON through the generic
  optional-field fallback helper. A missing row, invalid JSON, or invalid runtime schema now raises a
  content-free diagnostic directing recovery from a verified backup; `updateSettings` and the combined
  preferences transaction fail before writing because they must read the authoritative row first.
- The new server regression corrupts the live row with both malformed JSON and a structurally invalid
  object, then proves reads and writes fail loudly and the exact corrupt value is not replaced by
  defaults. Focused evidence passed: 1 file / 2 tests, server strict TypeScript, targeted zero-warning
  ESLint, and Prettier.

### Micro-block completion recovery and notice reconciliation

- Practice completion now keeps one pending completion record and an in-flight guard until either the
  next block is loaded or final session persistence succeeds. A batch flush, source-progress update,
  or next-block failure leaves the completed text visible with the specific failure and a “重试保存并继续”
  action instead of silently returning to an input surface whose completion latch is closed.
- Retry reuses the same durable event queue and completion data. Batch identity remains idempotent,
  next-block creation remains unique by lesson/index, and source progress remains monotonic, so a lost
  response cannot duplicate events or skip text. Starting a genuinely new session clears the pending
  completion explicitly.
- Two new Practice component regressions prove a next-block failure posts the event batch once and
  resumes at the same next index, while a custom-progress failure retries an identical PATCH body and
  does not advance before acknowledgment. Focused affected tests pass 19/19; the full Web suite passes
  18 files / 80 tests, with Web strict TypeScript, zero-warning ESLint, and Prettier also green.
- `THIRD_PARTY_NOTICES.md` now records `@axe-core/playwright`/`axe-core` under MPL-2.0 and reconciles
  the remaining direct MIT development families. This closes the different-license omission found by
  the static release audit; dependency/license inventory will still be repeated at final freeze.

### Training-policy documentation and range audit plan

- A document/code comparison found that the published priority pseudocode described obsolete
  coefficients and additive transfer/focus terms. The document is being corrected to the exact
  production formula, including the six user-adjustable defaults and the fixed exploration,
  forgetting, overuse, and fatigue coefficients; `ENG-005` remains evidence-backed only after that
  reconciliation and its focused tests pass.
- The same audit found that five-minute allocation used a 17% retest share and could shift too much
  remaining time into fluency. The intended model counts `warmup + fluency` as the comfortable-control
  share. Allocation will be constrained and table-tested so blocked focus stays 35–50%, retest 20–30%,
  transfer 15–25%, and combined comfort/exploration 10–20% for low/mid/high evidence at both short and
  ordinary durations.

### Training-policy formula and allocation reconciliation

- Replaced the obsolete priority pseudocode with the exact production calculation: the shipped six
  advanced coefficients, 0.45 confidence floor, logarithmic forgetting term, UCB-style exploration,
  transfer/focus multipliers, and bounded overuse/fatigue deductions now match
  `calculateAdaptivePriority`. The documentation explicitly says the final score has no artificial
  upper clamp and is used only for relative ordering.
- Short and ordinary phase allocations now keep focus, retest, transfer, and combined
  warmup-plus-fluency shares inside the documented engineering ranges at low, middle, and promotion
  accuracy. The five-minute cycle no longer drops retest below 20%; high-accuracy transfer reaches the
  documented 25% ceiling while accuracy-first practice retains the larger focus share.
- Focused verification passed: shared training-engine suite 21/21, shared strict TypeScript, targeted
  zero-warning ESLint, and Prettier. The range assertions cover both 5- and 10-minute policies and use
  only machine-epsilon tolerance for floating-point addition.

### Preliminary release-surface scan

- A repository scan found no product `TODO`, `FIXME`, `coming soon`, unimplemented marker, hardcoded
  disabled control, empty click handler, or `href="#"`. Matches were limited to SQL placeholder
  terminology, real form placeholders, tests/docs, and Git's sample hook.
- Runtime-source URL scanning found only loopback development/test addresses plus the documented
  Keybr notice URL; no CDN, remote font, analytics, telemetry, or error-reporting endpoint was found.
- Browser-storage API references occur only in E2E steps that deliberately clear local/session
  storage to prove SQLite authority. No application source registers a service worker or uses browser
  storage as durable product state.
- This is preliminary static evidence, not the final dead-control/network-console audit; the latter
  remains tied to the complete browser suite and manual visual pass.
- `npm ls --omit=dev --depth=0` reconciled the direct runtime tree with
  `THIRD_PARTY_NOTICES.md` (Fastify/static, better-sqlite3/SQLite, Zod, React/Router, TanStack Query,
  Radix, Recharts, and Lucide). A live `npm audit --omit=dev --json` on 2026-07-21 reported zero
  known production vulnerabilities across the resolved 203-package production tree.
- Release-source preflight on 2026-07-21 confirmed the official Node schedule still lists 24 and 22
  as LTS and 25 as EOL, matching the launcher constraint. All three supplied OpenAI documentation
  URLs resolve; the Codex best-practices URL now redirects to the official ChatGPT Learn guide, while
  current model guidance still recommends selecting reasoning effort through representative
  evaluation and the prompt guide still documents separate identity/instructions/examples/context.

### UX/E2E audit findings (superseded pre-remediation baseline)

The following 34-case inventory is retained as the investigation input that drove later fixes. It is
not the current release state: subsequent dated sections record 56 collected cases plus current
focused mode, calibration, game, Today/input/audio, and visual-functional results.

- Playwright collects 34 cases: 17 flows in Chromium and WebKit. Collection is not a pass result.
- Existing E2E strongly covers onboarding settings, a five-block smart course, browser-storage
  clearing, partial calibration, custom-text continuation, a completed formal test, all six game
  levels, Campaign reset at every level, one later Hardcore reset, blur pause, and six idle routes.
- Most non-smart practice modes currently prove only server block generation, not persisted typing,
  completion, or correct long-term `content_mode` attribution.
- Browser gaps remain for Today CTA, Caps Lock/same-hand Shift/refocus, actual page-level back/refresh
  ordering, complete sound trigger/filter behavior, Hardcore failure at each level, Hard/Adaptive,
  timeout/accuracy-gate, score/alert zeroing, and resuming a monotonic clock after focus returns.
- Axe/overflow checks cover six idle routes at 1440×900 and 1024×900 only. Onboarding, active
  practice/test/game, dialogs, completion/error states, dark theme, keyboard Tab order, 200% zoom,
  and Safari focus-ring evidence remain pending.
- Four screenshot assertions imply eight engine baselines, but only one baseline exists. No 1024px,
  dark, active training, game, settings, or error-state visual evidence exists yet.

### First complete visual generation and current remediation checkpoint

- The first full update run produced the 20-image visual matrix; the following focused replay filled
  the two missing WebKit completion/calibration images, so all 28 defined PNG paths now exist. Image
  generation is not acceptance. The latest focused replay ended 22 passed / 4 failed: both engines
  hit one backup-notice strict-locator ambiguity, WebKit found 4.31:1 mapping-header contrast, and one
  WebKit route-refresh helper used an over-broad date-heading regular expression.
- A read-only image review inspected every image available at that checkpoint. It found unequal
  accumulated browser histories, automation-only 1,000+ WPM values, WebKit's onboarding progress at
  the left edge, inconsistent native range/select presentation, browser-native English connection
  errors, and a zero-character completion presented as success. These findings block rubric scoring.
- Current unverified remediation uses exact visible-notice/date locators, centers the fixed onboarding
  progress indicator explicitly, raises mapping-header contrast/weight, normalizes native connection
  failures to stable Chinese copy, gives range/select controls explicit sizing and cross-WebKit track/
  thumb styling, and removes the heavy focus outline from programmatically focused noninteractive
  completion/onboarding headings while retaining DOM focus.
- Chromium and WebKit E2E now have independent freshly reset SQLite directories and ports. The root
  `pretest:e2e` build prevents concurrent test servers from racing a shared production build. The
  visual spec runs first, and paced fake-clock typing replaces implausible zero-interval screenshot
  fixtures without weakening production timing filters.
- A zero-event completion now closes safely but skips daily-summary/streak aggregation and renders a
  neutral “no valid input” result rather than a success state. A server regression and the visual
  completion flow must pass before this is accepted.
- The first isolated-server replay exposed an event-flush race rather than a fixture-only problem: an
  empty periodic flush could still own the in-flight promise when a short final block was queued, so
  completion awaited the older empty promise and closed before posting the new batch. `sendPending`
  now avoids empty in-flight work and loops after concurrent flush ownership changes; a regression
  reproduces the empty-flush/final-batch interleaving and passes. The same replay also showed that
  paced calibration typing must be included in expected active time, while a two-minute paused window
  remains excluded; the clock assertion now derives its bound from the exact paced character count.
- No requirement has been promoted from these changes. Next evidence is focused Chromium/WebKit,
  then a non-update full run, all-image second review, current-tree Node 24 `check`, and the explicit
  same-history restart/browser-switch demonstration.

### Post-remediation focused browser result

- After rebuilding the production client, the corrected 24-case subset passed 24/24 in 2.3 minutes:
  Chromium and WebKit each passed the five-state visual matrix, full primary-route axe checks,
  analytics/settings/backup/storage persistence, onboarding/audio unlock, paced smart completion,
  timed category calibration, and client-route refresh. The run regenerated every screenshot touched
  by those flows with the isolated per-engine databases.
- This is a focused `--update-snapshots` result, not the final release gate. The current 28 PNGs now
  require a second human inspection; afterward the entire suite must pass without snapshot update so
  checked-in pixels, functional assertions, and current production code are tested together.

### Analytics screenshot-count investigation

- The 1024 px Analytics images written at 12:58/13:01 showed 43 sessions / 4,404 characters in
  Chromium and 88 sessions / 8,886 characters in WebKit, while the Today images showed the current
  day's one 15-character calibration. Inspection found no SQL fan-out: the period overview performs
  `COUNT(keystroke_events.id)` over completed sessions and never joins the many feature rows emitted
  per keystroke. The larger values were completed sessions retained in the old engine databases from
  prior E2E invocations; a seven-day view was correctly including those records while Today was
  limited to the current local date.
- The engine-scoped E2E launcher was changed after those images were captured to remove only its
  validated `.symtype-test-data/e2e-{engine}` directory at server start. This is the correct fixture
  fix: it prevents cross-run screenshot history without weakening production analytics or deleting a
  user's application-data database. Chromium and WebKit remain isolated on separate ports/directories.
- A new server integration regression persists one 15-character session, confirms its expanded
  feature sample total is greater than 15, and then requires both Today and seven-day analytics to
  report exactly one session, 180,000 ms, and 15 characters. It passed under the project's Node
  24.3.0 runtime, first in isolation (`1 passed, 23 skipped`) and then as part of the complete server
  integration file (`24 passed` in 2.92 seconds). Server strict typecheck and focused ESLint also
  passed. An initial invocation under the shell's incompatible Node
  ABI failed before app creation because the installed `better-sqlite3` binary targeted Node module
  ABI 137 while that shell required 141; this was an environment invocation error, not a product-test
  failure.

### Second 28-image review and credibility remediation

- A second original-resolution inspection covered all 28 defined PNGs. It confirmed the onboarding
  centering, paced non-zero completion, heatmap contrast, dark active surface, exit dialog, route
  reflow, and page-level overflow fixes. It also proved that the evidence set was temporally mixed:
  16 visual-matrix images predated the later connection-copy, zero-event, focus, and native-control
  source changes, so their visible failures cannot be signed off or silently treated as current.
- The review found a new P1 data-integrity defect rather than a cosmetic fixture difference: after a
  15-character calibration, Today reported 15 characters while the seven-day Analytics view showed
  4,404 or 8,886 characters. That multiplier cannot represent real practice. A focused server query
  investigation and integration regression are required before regenerating Analytics evidence.
- Calibration screenshots showed truthful per-category timing speeds around 93–96 WPM beside a
  whole-session 3.4–3.5 WPM calculated across a four-minute active window with only 71–73 sampled
  characters. The values use different denominators and are individually reproducible, but their
  juxtaposition is misleading. DEC-046 changes the calibration completion summary to valid activity,
  valid sample count, accuracy, and rhythm consistency; ordinary training and formal-test summaries
  retain net/raw WPM. The browser regression now requires those calibration labels and rejects the
  generic net-WPM card.
- Current visual scores remain deliberately unassigned. The next evidence checkpoint is: fix the
  Analytics multiplier; rebuild; regenerate every visual-matrix and calibration image from clean,
  isolated databases; re-inspect all 28 current files; then run the complete suite without snapshot
  update. No UI or analytics requirement is promoted from this review alone.
- The focused investigation disproved an Analytics SQL fan-out: `getStatistics` counts events from a
  completed-session CTE without joining feature aggregates, and a new 15-event integration regression
  proves that both Today and the seven-day overview remain at 15 even after many feature samples are
  derived. The old 4,404/8,886 images predated scoped E2E cleanup. Current isolated databases contain
  only the events generated by the current run.
- A second test-harness issue explained why those old pixels survived `--update-snapshots`: the visual
  comparison permitted a 1% whole-image difference, so stale numeric labels and several compact game
  state labels could fit under the threshold, while Playwright's default `changed` update mode did not
  rewrite them. DEC-047 moves fresh-install route/reflow captures ahead of stateful tests, asserts the
  zero-event Analytics fixture through API and rendered text, lowers tolerance to 0.1%, and requires
  `--update-snapshots=all` for the one intentional full regeneration.
- The first post-source focused replay passed 18/18 in Chromium/WebKit, but it ran under the shell's
  unsupported Node 25 and therefore is diagnostic visual evidence only. `playwright.config.ts` now
  launches both web servers through the Playwright process's exact `process.execPath`; the next replay
  will invoke the Playwright CLI directly with Node 24 so native SQLite cannot be rebuilt for a
  different ABI mid-gate.

### Critical-route runtime boundary gate

- Added a focused browser release check for the server-backed idle states of Today, Train, Test,
  Game, Analytics, and Settings. Request and WebSocket interception is installed before the first
  page navigation; HTTP(S) is limited to the exact current Playwright `baseURL` origin and WS(S) to
  its equivalent transport origin with the same security, host, and engine-specific port. Any other
  transport is recorded and blocked before it can leave the browser.
- The same run records all `console.error` messages, uncaught page errors, and local 5xx responses and
  requires every list to remain empty. The intentional disconnected-state scenario remains separate
  and unchanged, so its expected local outage is not hidden behind an allowlist.
- Focused verification used Node 24.3.0 and Playwright 1.61.1 against both configured engines:
  `runtime-boundary.spec.ts` passed 2/2 (Chromium and WebKit) in 21.2 seconds. Targeted Prettier and
  zero-warning ESLint checks also passed. This is focused evidence only; the complete non-update E2E
  release run remains a separate gate.

### No-evidence qualification and remaining browser-boundary additions

- The zero-event rule now applies consistently beyond the daily summary: period Analytics excludes
  the closed session from effective-session/active-time totals, the client does not submit it to the
  formal-test ranking, and a direct ranking request receives `TEST_NO_EVIDENCE` without creating a
  `tests` or `personal_bests` row. The completed session remains available for audit/recovery.
- The server integration regression now proves all of those invariants together with the unchanged
  zero daily-summary/streak state. Node 24 verification passed the complete server integration file
  (24/24 in 2.77 seconds) and both server/Web strict typechecks. A new dark visual state advances a
  15-second formal test without typing, requires the neutral no-evidence copy, checks axe/overflow,
  and rechecks the zero Analytics overview; its two engine screenshots are pending regeneration.
- The formal-test browser matrix now routes all 15/30/60/120-second presets, completes a non-preset
  37-second test with Playwright Clock, and checks the authoritative `duration_seconds`. The existing
  real-time 15-second flow remains responsible for countdown, dual accuracy, error detail, subjective
  feedback, and ranking UI. The focused Node 24 Chromium/WebKit replay passed together with the input
  boundary addition: 4/4 in 24.9 seconds.
- The active-session input-boundary flow now focuses the restart toolbar control, types
  `qwerty123` outside the training textbox, and requires `0/N` before continuing. Its existing exact
  SQLite event-count and contiguous-sequence assertions then prove those outside keys never entered
  the queue or database. The same focused Node 24 dual-engine replay passed 4/4 in 24.9 seconds; matrix
  promotion remains deferred until the release evidence is reconciled.

### Real restart and fresh-browser SQLite authority gate

- Added `persistence-restart-cross-browser.spec.ts`, owned only by the outer Chromium project so the
  service-lifecycle scenario runs once. It launches its own built production server with
  `process.execPath`, a reserved loopback port, and a unique OS-temporary data directory that cannot
  overlap the ordinary Chromium/WebKit visual databases or any production application-data path.
- A fresh Chromium process completes a real four-micro-block adaptive training flow through the UI,
  waits for the saved completion, and records the exact session ID, contiguous exported events,
  dashboard/all-time totals, and bootstrap SQLite path. The test requires the first service to exit
  cleanly, restarts a new process on the same port and data directory, then opens a separately
  launched WebKit process/context with zero cookies, LocalStorage entries, or SessionStorage entries.
  WebKit must render the same Today and all-time Analytics totals, and its API/export snapshot must be
  byte-for-value equivalent for the recorded durable fields.
- Final focused acceptance under Node 24.3.0 and Playwright 1.61.1 passed 1/1 in 11.5 seconds. The
  actual run persisted session `2868b650-943c-43ec-88a4-0f2ff6564994` with exactly 1 completed session and 188
  contiguous keystroke events/characters at
  `/var/folders/vk/0p5yjvbd5mjbhpr2gwz4xyfh0000gn/T/symtype-restart-cross-browser-CV9oPa/data/symtype.sqlite3`;
  after restart, the fresh WebKit Today, Analytics, bootstrap, dashboard, statistics, and export reads
  all matched 1 session / 188 characters. Both server shutdowns returned code 0. The successful
  temporary fixture was then removed by its validated prefix-scoped cleanup.
- Targeted Prettier, zero-warning ESLint, and the root E2E TypeScript configuration also passed. This
  closes the explicit real-restart/different-browser evidence gap; it does not substitute for the
  complete non-update E2E release run.

### Neutral zero-evidence completion and refreshed visual baselines

- `PracticePage` now applies the server's evidence qualification to every completion surface. With
  zero valid characters it omits metric cards, generic performance feedback, calibration results,
  and subjective difficulty/fatigue controls. The neutral card instead states that the session was
  safely closed, lists what was not counted, and offers return/restart actions. Four browser
  assertions prevent the zero-state from regaining `净 WPM`, `做得好`, or `主观难度` labels.
- The two dark zero-evidence screenshots were intentionally regenerated under Node 24 after the
  semantic fix; Chromium/WebKit passed 2/2 in 8.3 seconds. Original-resolution inspection confirms
  equivalent hierarchy, readable contrast, no false success metric, and no clipping at 1024×900.
- A second legacy Analytics baseline still contained state from an older contaminated database (six
  minutes, 30 characters and generated feature rows). Side-by-side inspection against the current
  fresh database confirmed that the new 0-minute/0-character sparse page is the intended truthful
  state. Only those two engine baselines were regenerated, and their focused update run passed 2/2
  in 19.1 seconds. A complete non-update replay remains required.

### Settings export and JSON restore browser acceptance

- Added a real Settings UI flow that first completes a one-character 15-second formal test, then
  downloads and reads all three artifacts. It verifies the CSV header and test row, JSON format/schema/
  algorithm metadata plus persisted session/event/settings content, and the SQLite file signature.
- A malformed JSON upload now produces stable Chinese copy stating that the current database was not
  changed and never exposes a restore action. The same flow uploads the downloaded valid JSON,
  verifies the profile/session/event preview, changes the live theme, accepts the destructive
  confirmation, proves the previous light theme returns after reload, and finds a `pre-restore`
  safety snapshot through the API.
- The new test passed in both Chromium and WebKit during its first focused execution. That run's only
  two failures were the intentionally reviewed legacy Analytics images described above; all four
  non-screenshot tests, including both export/restore executions, passed. The final authoritative
  result will be the next complete non-update suite.

### Persisted JSON integrity and direct-server security boundary

- Reconciled the current implementation before changing documentation. Migration v9
  (`reject_invalid_persisted_json`) installs insert/update `json_valid` triggers for the ten
  authoritative JSON columns across settings, sessions, lessons, micro-blocks, events, feature
  statistics, formal tests, game levels, and achievements. Shared persisted-data schemas validate
  domain shape; authoritative read paths raise recovery diagnostics instead of substituting defaults
  or empty values.
- Database health now combines `quick_check`, `foreign_key_check`, JSON validity/top-level container
  checks, and persisted domain-schema checks. JSON preview performs a rollback-only allow-listed
  import plus application-invariant audit and therefore cannot mutate live data. Confirmed JSON and
  SQLite restores create `pre-restore` or `pre-sqlite-restore` safety snapshots and import in a
  transaction; invalid content is rejected without silently rebuilding the database.
- Direct execution validates `SYMTYPE_HOST` against the exact `127.0.0.1`, `localhost`, and `::1`
  allow-list before Fastify or SQLite opens. Incoming Host, Origin, and mutation CSRF checks remain
  independent. Automatic request logging is disabled, explicit serializers retain only safe route
  context and redact secrets, `GET /api/v1/diagnostics` is read-only, and writing the local diagnostic
  file requires the CSRF-protected `POST /api/v1/diagnostics/snapshot` route.
- Current focused Node 24.3.0 evidence: the shared production TypeScript build passed; persisted-JSON,
  backup/migration, server-security, and runtime-contract Vitest suites passed 5 files / 39 tests; the
  server strict TypeScript check passed; targeted ESLint passed with zero warnings; and the four
  updated documents passed Prettier. Exact commands:

  ```text
  /opt/homebrew/Cellar/node/24.3.0/bin/node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.build.json
  /opt/homebrew/Cellar/node/24.3.0/bin/node node_modules/vitest/vitest.mjs run packages/shared/src/persisted-json.test.ts apps/server/test/persisted-json-integrity.test.ts apps/server/test/backup-migration.test.ts apps/server/test/security-boundaries.test.ts packages/shared/src/runtime-api.test.ts --reporter=dot
  /opt/homebrew/Cellar/node/24.3.0/bin/node node_modules/typescript/bin/tsc -p apps/server/tsconfig.json --noEmit
  /opt/homebrew/Cellar/node/24.3.0/bin/node node_modules/eslint/bin/eslint.js apps/server/src/app.ts apps/server/src/config.ts apps/server/src/db/database.ts apps/server/src/db/migrations.ts apps/server/test/security-boundaries.test.ts apps/server/test/persisted-json-integrity.test.ts packages/shared/src/runtime-api.ts packages/shared/src/persisted-json.ts packages/shared/src/runtime-api.test.ts packages/shared/src/persisted-json.test.ts --max-warnings 0
  /opt/homebrew/Cellar/node/24.3.0/bin/node node_modules/prettier/bin/prettier.cjs --check docs/data-model.md docs/architecture.md docs/decisions.md docs/progress-log.md
  ```

- This is focused boundary evidence only. A new complete `npm run check` and the final non-update
  Chromium/WebKit E2E run have not been executed after these changes and are not recorded as passing.

### Release-candidate gate replay and independent integrity audit

- The complete non-interactive quality gate was replayed with Node 24.3.0 at the front of `PATH` so
  every npm child process used the same supported ABI as `better-sqlite3`. `npm run check` passed:
  zero-warning ESLint, root and all-workspace strict TypeScript checks, 39 Vitest files with 345 tests
  passed and one intentional skip, and all four production builds. An earlier shell invocation let npm
  child scripts resolve unsupported Node 25, producing only native-module ABI-load failures; that
  invocation is retained as harness evidence and is not counted as a product result.
- The first complete non-update Playwright replay after migration v9 ran all configured Chromium and
  WebKit projects. It produced 59 passes, six failures, one intentional skip, and two tests not run
  after their serial predecessor failed. The six failures reduce to three engine-independent causes:
  dark-theme no-sample heatmap labels fail WCAG contrast; the Analytics full-page snapshot inherits
  prior suite data/theme instead of establishing its own state; and the calibration snapshot contains
  timing-derived numeric drift. Game success and every per-level Campaign/Hardcore failure path,
  practice modes, formal-test durations, event boundaries, export/restore, production restart plus a
  fresh cross-browser SQLite read, and the runtime network/console boundary all passed in that run.
  No screenshot baseline is being updated until the state-isolation and contrast fixes are reviewed.
- A second read-only release audit found four additional data-safety defects that prevent release
  sign-off despite the passing unit gate: semantic `modifiers_json` corruption can pass health/SQLite
  preview; legitimate older settings/session summaries have no explicit upcast; historical tests can
  acquire false zero dual-accuracy values; and an incomplete layout snapshot can be accepted then
  silently supplemented from the current Symmetric preset. It also found snapshot semantic-validation,
  settings contract/range/save-race, contradictory test-error evidence, and synchronous health-scan
  risks. These are active release blockers and are being fixed with forward migrations and regression
  tests; DEC-050 must not be interpreted as final acceptance until that follow-up closes them.

### Persisted compatibility, Settings, and visual root-cause closeout

- The independent integrity findings above were closed in the current implementation. Migration v10
  forward-fills both test accuracy metrics only for legacy false-zero rows; pre-v5 and v5–v9 JSON/
  SQLite restore candidates receive the equivalent schema-version-aware normalization. Complete
  historical settings and session summaries have explicit narrow upcasters that preserve original
  accuracy, mark unavailable analysis as insufficient, and do not rewrite stored history. Truncated
  or invalid lookalikes still fail with verified-backup guidance. DEC-050 is therefore strengthened
  by a compatibility boundary, not treated as evidence that silent fallback was acceptable.
- Session layout snapshots now require the complete unique 54-code ANSI-US set and never supplement
  missing history from the current preset. Semantic health includes `modifiers_json`, internally
  consistent formal-test error counts/truncation/confusions, and every other persisted JSON schema.
  The same deep JSON checks apply when cataloged SQLite backups are created/rotated and when a restore
  candidate is previewed. Health caching uses `total_changes()` plus `PRAGMA data_version`, while
  backup/restore/invariant boundaries explicitly refresh it.
- Advanced weights are now exactly six shared keys with shared defaults and the `0–2` legal range;
  missing/unknown keys and out-of-range values fail. Settings renders the complete shared ranges. Its
  edit/save revision prevents a request from acknowledging changes made while that request was in
  flight; the later edits remain dirty for the next save. Backup-list failure stays inside the data
  section with retry, and save/backup failures use assertive `alert` semantics instead of the polite
  success channel.
- The supported Node 24.3.0 non-browser gate was replayed after these fixes. `npm run check` passed
  zero-warning lint, strict typechecks, 39 Vitest files with 360 tests passed and one intentional skip,
  and all production builds. This supersedes the earlier 345-test checkpoint for the current unit/
  integration/build surface; it does not substitute for browser release evidence.
- The prior six browser failures were reduced to three shared root causes and each received a direct
  fix: observed heatmap keys now use a contrast-safe foreground while retaining per-key text, a
  keyboard-navigable table, ARIA labels, and a non-color summary; `restoreFreshE2eState` now clears
  progress through real export → preview → commit instead of inheriting suite data/theme; and the
  calibration capture uses seed `424242` with a 0.1% pixel-drift ceiling. The focused accessibility
  route sweep and calibration flow passed in both Chromium and WebKit; the isolated Analytics flow
  subsequently passed 2/2 in the two engines.
- Original-resolution review covered the latest two calibration baselines (1280×1183 Chromium,
  1280×1152 WebKit) and two Analytics baselines (1280×2597 Chromium, 1280×2543 WebKit). Both
  calibration images show the complete four-metric summary, optional self-rating controls, all three
  selected region baselines, and bottom actions without clipping. Both Analytics images show the same
  truthful zero-session/light-theme state through the final aggregation cards, with no inherited
  statistics, horizontal clipping, or false heatmap data. Engine-specific text/timing metrics differ
  slightly as expected; hierarchy and state meaning remain equivalent.
- The complete 68-case non-update Chromium/WebKit suite has **not** been replayed after all fixes and
  remains the release browser gate. The ongoing API-contract refactor, including API-006, is also not
  marked complete by this checkpoint and requires its own final reconciliation and rerun.

### Typing-path profiler gate

- Rechecked the hot input boundary rather than inferring performance from `memo`. `TypingSurface`
  already kept glyph/key feedback local and reported coarse parent progress every four attempts, but
  its time branch could still notify the whole practice page on idle 500 ms clock ticks. The report
  condition now requires an attempt change, preserving sparse-input catch-up after 400 ms without
  producing idle page updates.
- Added a repeatable React `Profiler` regression around a page-shell surrogate. Under a fixed clock,
  all 24 accepted key events still reach the event callback, progress reports occur at attempts
  0/4/8/12/16/20/24, the final reported position is 24, and the shell commits exactly eight times
  rather than once per key. The method and evidence boundary are maintained in
  `docs/performance.md`.
- Focused Node 24.3.0 evidence: `TypingSurface.test.tsx` passed 11/11 in 0.78 seconds and the Web
  strict TypeScript check passed. Targeted Prettier initially detected the deliberately multiline
  condition and rewrote it; the focused suite will be included again in the final merged gate.
- Added a production-path browser gate that creates a seeded smart session, types a complete 20–60
  character physical-key block, records real `/events` mutations, and measures animation-frame gaps
  plus Long Tasks API entries where supported. It requires exact event reconciliation, 2–24 events
  per request, fewer writes than keys, a sub-250 ms maximum frame gap, and bounded long-task time.
  Each default-reporter run attaches its raw project/batch/performance JSON. The focused pre-domain-
  refactor build passed Chromium and WebKit 2/2 in 6.2 seconds; final evidence still requires the
  rebuilt complete suite.

### Release static and license inventory checkpoint

- Repeated source scans across `apps`, `packages`, `scripts`, and `tests`. There is no empty
  `onClick`/`onSubmit`, permanently disabled control, `href="#"`, `dangerouslySetInnerHTML`,
  `innerHTML`, `eval`, `new Function`, runtime telemetry/CDN endpoint, or product TODO/FIXME/
  coming-soon marker. The only `placeholder` implementation match is a parameterized SQL placeholder
  builder; remaining matches are content-test terminology and real form hints.
- Both POSIX launch wrappers retain executable mode; the Windows batch file is intentionally a
  normal non-executable text file on this filesystem. The current source/test/script inventory is
  165 TypeScript/TSX/MJS files.
- Audited every license identifier recorded in `package-lock.json`: 484 MIT packages plus permissive
  ISC/BSD/Apache/0BSD/BlueOak/MIT-0 combinations, 14 MPL-2.0 entries, one CC0-1.0 entry, one
  Python-2.0 entry, one dual MIT/WTFPL entry, and one CC-BY-4.0 entry. `caniuse-lite` is the sole
  CC-BY-4.0 package and is build/test browser-compatibility data; it is now named explicitly in
  `THIRD_PARTY_NOTICES.md`. This is a lockfile metadata inventory, not external legal advice.
- Node 24 npm's cached advisory database also completed both `npm audit --offline --omit=dev` and
  `npm audit --offline` with zero reported vulnerabilities. Offline audit currency is bounded by the
  local npm cache, so this evidence does not claim knowledge of advisories published after that cache
  was populated.
- The release host is macOS 27.0 build 26A5378n on arm64 with Node 24.3.0/npm 11.7.0. Playwright
  1.61.1 pins Chromium 149.0.7827.55 and WebKit 26.5; separately installed system browsers are Chrome
  150.0.7871.127 and Safari 27.0. Automated evidence therefore covers the pinned Chromium/WebKit pair
  on this host, not two separately installed historical major releases of Chrome and Safari.

### Pure domain analysis and parameterized repository boundary

- Closed the API-006 architecture gap without moving persistence into the route layer.
  `apps/server/src/db/database.ts` remains the SQLite repository adapter responsible for
  parameterized queries, transactions, and typed row materialization. Session error/summary logic,
  period feature/group aggregation, and adaptive-versus-baseline reporting now live in
  `domain/session-analysis.ts`, `domain/statistics-analysis.ts`, and
  `domain/experiment-analysis.ts`. These modules accept plain typed evidence, return plain values,
  and contain no SQLite, filesystem, config, migration, transaction, or SQL primitive.
- Added direct domain regressions for correction-aware dual accuracy, timing eligibility, robust
  text alignment including a 481-character trailing error, malformed authoritative modifier JSON,
  evidence merging, local calendar windows, median/MAD/Theil-Sen slope, feature/group aggregation,
  experiment empty state, uncertainty/calibration gating, and retention pairing.
- `architecture-boundaries.test.ts` recursively scans the domain modules and shared/Fastify
  orchestration boundaries for forbidden imports or SQL, then verifies that the repository delegates
  to all three analyzers. `sql-parameterization.integration.test.ts` stores quote-breaking SQL and
  HTML-like fragments in a layout name, custom-text title/body, and backup reason, reads the exact
  values back, and proves the profile table remains intact. Dynamic identifiers remain restricted to
  closed migration/backup allow-lists.
- The supported Node 24.3.0 merged non-browser gate after this extraction passed: zero-warning lint,
  root plus every workspace strict typecheck, 44 Vitest files with 377 tests passed and one intentional
  runtime-conditional skip, and all four production builds. The long aligned-text focused regression
  also passed 5/5. DEC-058 records the resulting durable boundary.

### Rebuilt browser, launcher, and visual checkpoint

- The complete production-build Playwright replay after the domain/profiler changes collected 70
  Chromium/WebKit cases and finished in about 6.0 minutes with 69 passed and one intentional skip.
  The skip is the WebKit copy of the production restart/cross-browser lifecycle case; Chromium owns
  that case once and it itself starts fresh Chromium and WebKit processes. The run persisted session
  `c5a00d06-1d0d-4d67-a257-418837940906`, gracefully restarted the real server against the same
  SQLite path, and reconciled one session / 188 characters from a browser-clean WebKit context.
- That same complete run passed both real typing-performance cases. Each generated a seeded 20–60
  character block, persisted the exact count in 2–24-event batches with fewer requests than keys,
  and satisfied the frame-gap/Long Tasks ceilings documented in `docs/performance.md`. The attached
  per-project JSON remains the machine-specific raw evidence; it is not a universal latency claim.
- Replayed `scripts/launcher-full-smoke.mjs --offline` with Node 24.3.0 from a source-only temporary
  copy and an intentionally wrong caller directory. It completed cached `npm ci --include=dev`, all
  builds, schema v10 migration, occupied-port fallback from 63177 to 63190, health/live-instance reuse,
  private POSIX file modes, an unchanged offline restart, damaged-output rebuild, lockfile-change
  dry-run, graceful shutdown, and fixture cleanup. It did not open Finder/the default browser and does
  not convert the source-only Windows/Linux wrapper review into execution evidence on those systems.
- Reviewed all 30 current Chromium/WebKit PNG baselines in three contact sheets, pairing the primary
  routes, responsive/reflow states, calibration, typing/completion/error states, theme, settings,
  game, and Analytics captures. No visible clipping, horizontal overflow, false populated statistics,
  broken hierarchy, or engine-semantic mismatch was observed. Earlier original-resolution review of
  the tall calibration and Analytics pairs remains recorded above. The eight external Keybr reference
  screenshots are still absent, so this evidence cannot claim screenshot-specific parity.

### Post-checkpoint regression additions and pending merged gate

- Added focused typing-policy coverage for stop-on-error and disabled/whole-word Backspace, plus a
  Settings regression that restores all six advanced weights from the shared defaults and persists
  the exact `/api/v1/preferences` payload. The affected two Web files passed 21/21 after correcting
  the test's expected endpoint.
- Added a populated Analytics browser flow that creates four real smart micro-blocks including an
  error/correction, then reconciles server session/character/error totals, trend, key/bigram/trigram/
  finger/zone/class features, confusion, groups, recent-error context, and the honest insufficient
  experiment conclusion with the rendered page. Chromium and WebKit passed 2/2 in 9.7 seconds after
  correcting an overly specific status-role locator.
- Reused the Web Audio probe in the six-level Campaign failure/retry path and now requires both the
  Terminal-theme alarm and success cue while preserving one AudioContext/resume boundary. The focused
  Campaign-failure run passed both configured projects (2/2); the result file reports no failed test.
- These additions happened after the 44-file non-browser and 70-case browser checkpoints above.
  Therefore their focused results do **not** make those earlier totals final merged-tree evidence.
  The next release action is a supported-Node `npm run check`, a complete non-update Chromium/WebKit
  replay, then the requirements-matrix/UI-rubric reconciliation. Until those finish, the project is
  explicitly still in release-candidate audit rather than final delivery.

### Active persisted-data and game-evidence follow-up

- A new independent pass is revalidating the persisted-data recovery boundaries already implemented:
  recognized legacy settings/session-summary upcasts, schema-aware v5–v9 false-zero test-accuracy
  backfill, the complete unique 54-code immutable keyboard snapshot, semantic modifier and formal-test
  error consistency, and failure-with-recovery-guidance for malformed lookalikes. It is also tracing
  the exact six advanced-weight keys/defaults/range through shared schemas, storage, engine, and UI,
  including every Settings legal range, revision-safe save acknowledgement, and section-local backup
  error/retry behavior. Earlier full-gate evidence is historical context; the focused results from
  this follow-up and its final merged rerun are pending and must be recorded before status promotion.
- Pineapple Breach E2E is being extended beyond campaign reset mechanics to prove achievement and
  personal-best persistence after a real reload, and to prove game sessions remain separate from
  formal-test rankings. No pass count is recorded for this in-progress change. Both browser projects
  and the final merged suite remain required.

## 2026-07-23: Issue #3 local correctness closure

### Confirmed-defect repair

- The whole-repository review closed five bounded correctness and data-safety gaps under V2-D014:
  verified private pre-migration snapshots now protect both direct and standalone forward migration;
  delayed lower-sequence event batches rebuild only affected feature evidence from canonical
  same-profile order; the canonical `TypingSurface` and server projections use the shared WPM
  contract with final uncorrected errors; completion and explicit save can carry a verified trailing
  correction checkpoint without inventing an event; and new custom text is normalized and rejected
  at the first unsupported ANSI-US code point while historical rows remain unchanged.
- The public runtime schemas, persisted-summary upcast, dashboard/statistics/test/experiment/game/CSV
  projections, and literal goldens were reconciled without changing schema version 10 or adding or
  removing a user function. Raw JSON and SQLite backup/export formats continue to preserve stored
  rows, including internal metric evidence.
- The merged release-candidate baseline now exists at `a10e9a8` from PR #2. Issue #3 is isolated on
  `fix/3-review-correctness-gaps`, so its source and documentation diff can be reviewed against that
  committed baseline.

### Final local release evidence

- Supported Node.js 22.16.0 `npm run check` passed zero-warning lint, strict root/workspace type
  checks, 62 Vitest files with 452 tests passed and one intentional runtime-conditional skip, and all
  four production builds.
- `npm run test:regression` passed all eight files and 22 literal regression tests. The focused
  seven-file migration/event/settings/persistence/export/backup/restore/canonical-history replay
  passed 34 tests.
- The production Chromium/WebKit suite collected 74 cases and passed 73 with one intentional
  duplicate lifecycle-owner skip in 8.0 minutes. It covered current visual/reflow/axe states, all
  training modes, formal tests, restore, a real service restart plus fresh-browser SQLite history,
  runtime boundaries, and every game path without a release-level console error.
- The deterministic 100k product smoke rendered Today, completed five real micro-blocks, and rendered
  Analytics with 100,248 events while preserving the source fixture hash. The final isolated launcher
  smoke also passed its offline install/build/migration, occupied-port, health/reuse, private-mode,
  damaged-output rebuild, lockfile-planning, and graceful-shutdown checks.

### Delivery state

- Local Issue #3 acceptance and documentation reconciliation are complete. Repository delivery is
  still pending the required atomic commit, push, linked Pull Request, current CI, one independent
  approval, resolved conversations, and squash merge. No local gate result is presented as proof that
  those external workflow steps have already happened.
