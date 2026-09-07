# SymType 2.0 Delivery Plan

**Last update:** 2026-09-07
**Method:** Document-driven release convergence
**Release state:** `main` remains at PR #4 (`481a2cb`). Issue #18 is the current product
experience and measured-performance candidate on `refactor/18-product-experience`.
The unfinished Issue 14 corrections are incorporated with their original source attribution.
Implementation acceptance is recorded in [the Issue 18 review](ISSUE-18-PRODUCT-REVIEW.md).
CI and independent approving review remain required before merge.

## Purpose

Ship SymType 2.0 without adding or removing a V1 user function or risking local SQLite history.
V2-D014 permits corrected fixed outputs only where focused evidence confirms implementation drift
from the existing V1 business contract. Work now follows release value: data safety, startup, visible
product behavior, browser compatibility, and release evidence. Performance, maintenance, and
documentation work does not expand without a confirmed release problem.

## Issue 18 current plan

The maintainer's 2026-09-07 request reopens UI/UX, operation, and measured performance convergence.
[V2-D016](DECISIONS.md#v2-d016-product-journey-convergence-and-revision-validated-statistics)
bounds this work to existing V1 functions. The active Issue, branch, evidence and rollback record are
in [ISSUE-18-PRODUCT-REVIEW.md](ISSUE-18-PRODUCT-REVIEW.md).

1. Protect the existing packaging worktree and use a separate worktree based on current main.
2. Capture all six surfaces and the typing/exit loop before modifying the product.
3. Address confirmed choice hierarchy, focus, save reachability, input state and recovery defects.
4. Optimize repeated statistics and empty-dashboard loading with equivalent data outputs.
5. Re-run fixed outputs, the full quality gate, both browser engines, visual/axe evidence and the
   minimal empty/100k performance baseline.
6. Publish the linked PR; require CI, resolved conversations and independent approval before merge.

The sections below retain the July release history. Their old counts, cancelled-design disposition,
and Chrome-profile block describe that earlier checkpoint; the Issue 18 review and current
requirements matrix supersede those candidate-status statements. The official STE PDF remains
externally blocked. Optional scale and maintenance platforms remain outside the release gate.

## Historical release snapshot (2026-07-24)

- Supported Node.js 22.16.0 builds, starts, and passes the current strict type check.
- Literal V1 golden tests freeze lesson selection, metrics, keyboard behavior, event conversion,
  settings, history, game state, export, and restore.
- The final product replay collected 74 Chromium/WebKit tests: 73 passed and the duplicated
  lifecycle-owner case was intentionally skipped once. It completed in 8.0 minutes.
- Gate 2 has a repeatable five-fragment baseline in
  `reports/performance/v1-baseline.json`. It covers empty startup, 100,000 events, common product
  reads and writes, the real Fastify child event loop, Chromium/WebKit typing, and bundle size.
- The prior source-only audit found no dead control. Later maintainer testing confirmed six
  focused-session defects; V2-D015 bounds their correction without reopening product scope.
- The final focused data-safety replay passed seven migration, event-integrity, settings,
  persistence, export, backup, restore, and canonical-history files with 34 tests.
- The final Node.js 22.16.0 `npm run check` passed lint, strict type checks, 62 Vitest files with
  452 tests passed and one intentional skip, and all four builds. The separate literal regression
  suite passed all 22 tests.
- The final isolated launcher smoke passed offline clean install/build/migration, occupied-port
  fallback, schema 10 health, live reuse, private POSIX modes, damaged-output rebuild, lockfile
  planning, and graceful shutdown.
- The final two-engine replay passed visual/reflow/axe, every training mode, formal tests, restore,
  service restart plus fresh-browser SQLite history, runtime boundaries, and all game paths without
  a release-level console error.
- Release cleanup now cancels typing-surface transient timers on unmount, preventing late React
  updates while leaving keystroke and completion results unchanged.
- The target GitHub repository has the file-free bootstrap commit `95aa3e5` and merged release
  candidate commit `a10e9a8` on `main`; PR #2 delivered the Issue #1 branch. PR #4 delivered the
  Issue #3 corrections to `main` as `481a2cb`.
- PR CI run 29903653128 exposed one clean-checkout infrastructure defect: type-aware lint ran
  before internal workspace `dist` entry points existed. V2-D012 records the bounded fix; no
  product logic or lint rule changes.
- During bootstrap PR #2, an isolated source copy without `.git`, `node_modules`, or any `dist`
  passed Node 22.16.0 offline `npm ci`, automatically ran `prepare`, then passed the complete
  421-test, 22-golden, four-build `npm run check`.
- The corresponding GitHub Actions run 29904308912 passed install, formatting, lint, typecheck,
  tests, and build for the clean-checkout repair commit `ed1aae9`.
- Repository settings allow only Squash Merge and automatically delete merged branches. The saved
  `main` rule normally requires a current PR, one independent approval of the latest push, the Node
  22 check, current branches, resolved conversations, linear history, and no administrator bypass;
  force pushes and deletion remain disabled. V2-D013 records the historical maintainer-authorized
  one-time approval waiver used for bootstrap PR #2; the normal review gate applies to subsequent
  issue work.
- The official ASD-STE100 Issue 9 PDF is unavailable. The normative review remains externally
  blocked and does not block independent product work.

## Historical release convergence classification

| Class           | Work                                                                           | Reason and exit                                                                                                        |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Release Blocker | Final Node.js 22 `npm run check`                                               | The current candidate cannot be published with an unverified final tree.                                               |
| Release Blocker | Core Chromium and WebKit acceptance                                            | Recheck startup, training completion, persistence, analytics, restore, and game after release edits.                   |
| Release Blocker | GitHub CI and merge authorization                                              | Publish the six-issue branch; a later PR still requires current CI, approval, resolved conversations, and merge.       |
| Required        | 100k product smoke                                                             | Verify Today, training completion, and common Analytics behavior against the populated fixture.                        |
| Required        | Data-safety release replay                                                     | Recheck event idempotency, migration, export, restore, and database integrity on copies.                               |
| Required        | Repository workflow files                                                      | Persist contribution, Issue, PR, CI, version, changelog, and release rules using real commands.                        |
| Required        | Confirmed dead-source cleanup                                                  | Remove only the duplicate runtime API source and the confirmed unused direct dependency, then rerun goldens and build. |
| Optional        | 1,000,000-event suite and 30-minute memory run                                 | Useful scale evidence, but no current release failure requires it.                                                     |
| Optional        | Per-route benchmarks, extensive query-plan snapshots, real Safari manual check | Additional evidence that does not replace the required Chromium/WebKit release pass.                                   |
| Optional        | Compression, source-map, and initial chart-loading investigation               | Current local bundle and route behavior are usable; no measured user blocker exists.                                   |
| Cancelled       | Unproven architecture or database rewrite                                      | The 100k result is usable and no safe, necessary hotspot change has been justified.                                    |
| Cancelled       | Full file-size, complexity, coverage, and maintenance platform                 | Existing debt is recorded; framework expansion would delay higher-value release work.                                  |
| Cancelled       | New V2 visual redesign or duplicate screenshot platform                        | No visual redesign is justified; use existing visual evidence plus focused review of corrected interactions.           |
| Cancelled       | New STE checker platform                                                       | Keep only the external official-PDF review blocker and the existing concise record.                                    |

## Historical gate status

| Gate                         | Release exit                                                | Status      | Evidence or disposition                       |
| ---------------------------- | ----------------------------------------------------------- | ----------- | --------------------------------------------- |
| 0. Protect current state     | Supported install, build, start, health                     | Done        | Node 22 clean install/build/start evidence    |
| 1. Freeze V1 behavior        | Literal business outputs and contracts pass                 | Done        | 22 golden tests plus full V1 suites           |
| 2. Minimal credible baseline | Correct empty/100k, child-process, browser, bundle evidence | Done        | `reports/performance/v1-baseline.json`        |
| 3. Optimize bottlenecks      | Only act on a proven release problem                        | Cancelled   | No release-level optimization is required     |
| 4. Converge interface        | Fix only confirmed visible/accessibility regressions        | In progress | Issues #8/#10/#11/#14/#15 correction batch    |
| 5. Converge code             | Remove confirmed dead source/dependency only                | Done        | Bounded cleanup and release checks passed     |
| 6. Conform documents         | Official Issue 9 review                                     | Blocked     | User must provide the official PDF local path |
| 7. Accept and publish        | Check, core E2E, data safety, CI, merge authorization       | In progress | Six-issue branch publication and review       |

## Gate 0 and Gate 1 evidence

| Check                               | Result                                             |
| ----------------------------------- | -------------------------------------------------- |
| Isolated `npm ci --offline`         | 529 packages, zero audit vulnerabilities           |
| Production build and no-open start  | Pass; schema 10, integrity `ok`, graceful shutdown |
| Literal V1 regression suite         | 8 files, 22 passed                                 |
| Complete non-browser checkpoint     | 52 files, 404 passed, 1 intentional skip           |
| Complete Chromium/WebKit checkpoint | 73 passed, 1 intentional skip                      |
| Six-level game in both engines      | Pass                                               |

Node.js 25 cannot load the installed native SQLite ABI. That is an unsupported-environment result,
not a product failure. Release commands use Node.js 22.16.0.

## Gate 2 result

The baseline is repeatable from the scripts listed in `docs/v2/PERFORMANCE-BASELINE.md`. Measurement
validity was corrected before closure:

- populated statistics use the all-time period and return all 100,000 fixture events;
- the event-loop histogram runs inside the built Fastify child and reports over IPC;
- fixture hashes, schema 10, integrity, foreign keys, event linkage, and category mix are checked;
- committed fixture evidence uses the manifest-relative path, never a measurement-machine path;
- browser input persists the exact 141-event stream in both Chromium/WebKit measurement paths;
- no 1m or 30-minute result is required to close Gate 2.

Key results on the Apple M3 Pro test machine:

| Operation                         | Result             | Release interpretation                               |
| --------------------------------- | ------------------ | ---------------------------------------------------- |
| Empty health ready p95            | 315 ms             | Acceptable                                           |
| Launcher application work p95     | 1.20 s             | Acceptable                                           |
| 100k dashboard p95                | 0.23 ms            | Acceptable                                           |
| 100k all-time statistics p95      | 911 ms             | Visible but usable local query; no rewrite justified |
| Event batch save p95              | 2.31 ms            | Acceptable                                           |
| Next micro-block p95              | 2.77 ms            | Acceptable                                           |
| SQLite hot query p95              | 29.20 ms           | Acceptable                                           |
| Typing handler p95 / p99          | 0.20 / 1.19 ms     | Acceptable                                           |
| Combined input-to-paint p95 / p99 | 15.0 / 16.95 ms    | Acceptable                                           |
| Persisted browser events          | 141 exact          | Acceptable                                           |
| Practice JS / CSS gzip            | 165.95 / 11.66 KiB | Acceptable                                           |

The child event-loop p99 reaches 1.14 seconds during the synchronous 100k all-time statistics call.
This confirms what the HTTP response already shows; it does not affect typing, saving, Today, or
lesson generation. The query remains below roughly one second at p95 and is not a release blocker
for a single-user local application. Record it as an Optional future target if real use shows pain.

## Active release work

1. Close Issues #8, #10, #11, #13, #14, and #15 without changing mappings, event semantics,
   metrics, routes, settings, imported/custom text, or game/session ownership.
2. Run the final Node 22 non-browser gate and literal regression suite.
3. Review the corrected focused session in Chrome, then run and inspect the applicable browser
   gates after Chrome control is available.
4. Push the issue-linked branch only after the evidence below supports keeping every correction.

## Current focused correction record

| Issue | Confirmed cause                                                                                                                 | Smallest correction                                                                                                                       | Focused evidence                                                                                     | Keep or revert                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| #8    | Ordinary active practice repeated phase, rationale, block count, and storage chrome around the target                           | Remove only those ordinary active-state labels; retain progress, metrics, calibration category, save/recovery, pause, and exit            | Component assertions, including retained calibration category; Chrome focused-session review pending | Keep if Chrome retains hierarchy and all controls; otherwise revert the presentation-only removal  |
| #10   | The virtual keyboard used centered flex rows instead of the shared ANSI `column`/`width` geometry; zone borders were too subtle | Render the existing 54 mappings on a 120-subcolumn grid and strengthen color plus boundary/home-key cues                                  | Geometry/component assertions and Keybr reference-feature review; combined Chrome comparison pending | Keep only if 54 mappings remain exact and 1024/200% has no page overflow                           |
| #11   | Pause exposed only resume even though Practice and Game already owned safe exit flows                                           | Add keyboard-contained Continue/Exit actions and delegate Exit to the existing owner                                                      | Component focus/delegation tests; Chrome pause-to-confirm walkthrough pending                        | Keep only if event flush/confirmation semantics and focus restoration remain unchanged             |
| #13   | Candidate truncation could leave only the next separator at the hard cap                                                        | Trim terminal whitespace at the generator boundary; if that crosses the 20-character floor, fill only from the already selected candidate | Fixed-seed exact/provenance tests, server response assertion, and 22 literal goldens                 | Keep only if candidate order/IDs/score remain traceable and custom/imported text is byte-unchanged |
| #14   | The filled block caret visually resembled completed history and corrected state lacked an independent cue                       | Use an outlined current cue, expose five semantic states, and add dotted corrected plus accessible labels                                 | Component state/accessibility assertions; Chrome five-state review pending                           | Keep only if scrolling, input events, and screen-reader names remain stable                        |
| #15   | Routine catch paths rendered raw server messages and ordinary pages exposed storage-engine vocabulary                           | Centralize redacted, state-aware recovery copy while retaining structured machine codes and expert backup terminology                     | Presentation/component tests cover raw-path/token/storage redaction and actionable structured states | Keep only if every recovery action stays accurate and no raw diagnostic reaches ordinary UI        |

### Current verification checkpoint

- Node.js 22.16.0 `npm run check` passed on the final implementation tree: zero-warning lint,
  strict root/workspace type checks, 63 test files with 480 passed and one intentional
  runtime-conditional skip, 22/22 literal regressions, and all production builds.
- Chrome is the maintainer-selected manual-review browser for this batch. The running Chrome profile
  does not currently have the ChatGPT Chrome Extension installed/enabled, so Chrome interaction,
  screenshots, and visual sign-off remain pending. Safari evidence is intentionally not used as a
  substitute.
- Three maintainer-supplied Keybr screenshots were reviewed for ANSI silhouette, high-luminance
  finger zones, home-key/target cues, and current-position treatment. They are interaction
  references, not copied assets; the five other screenshots named by the original matrix remain
  unavailable.
- Chrome screenshots, 1024/200% reflow, accessibility checks, and the affected browser flows remain
  pending until Chrome control is available. Do not mark this batch visually complete or publish
  replacement baselines before that review.

## GitHub bootstrap decision

The empty remote had no `main` from which a numbered branch could be created. Commit `95aa3e5`
created the documented file-free bootstrap and was pushed to `main`. Issue #1 and branch
`chore/1-symtype-2-release` were then created from that base. The entire reviewed project entered
through PR #2 and was squash-merged as `a10e9a8`; no product file was committed directly to `main`.

## Historical risk record

| Risk                                                    | Control                                                                    | State              |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| Initial product import had no older Git baseline        | Literal goldens, raw baseline, PR #2 history, current six-issue diff       | Controlled         |
| Active Homebrew Node resolves to 25                     | Use explicit Node 22.16.0 PATH in release commands                         | Controlled         |
| GitHub operations require live authentication/network   | Recheck CLI credentials and remote reachability when publishing the branch | Controlled         |
| Branch-rule save requires GitHub sudo mode              | Owner confirmed access; the complete `main` rule is saved                  | Resolved           |
| Clean CI lacked workspace `dist` type entry points      | Root npm `prepare`; isolated and GitHub checks pass                        | Resolved           |
| Official STE PDF is absent                              | Do not use unofficial summaries; request only the local official PDF path  | Externally blocked |
| 100k all-time stats blocks the local event loop briefly | Keep observable; optimize only after real user evidence                    | Accepted           |

## Historical outcomes

Gates 0, 1, 2, and 5 are complete; Gate 3 is cancelled by evidence and Gate 6 is externally
blocked. PR #2 delivered the release candidate to `main` as `a10e9a8`, and PR #4 delivered the
Issue #3 convergence fixes as `481a2cb`. Gate 4 is reopened only for the six confirmed,
maintainer-reported focused-session defects recorded above. Gate 7 remains open for the final-tree
checks, branch publication, CI, review, and merge workflow; no Optional performance or
maintenance-platform work is reopened.
