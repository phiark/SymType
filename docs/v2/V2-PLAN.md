# SymType 2.0 Delivery Plan

**Last update:** 2026-07-23
**Method:** Document-driven release convergence
**Release state:** PR #2 is merged; Issue #3 corrections passed the local release gates and await the
normal branch/PR/CI/review workflow

## Purpose

Ship SymType 2.0 without adding or removing a V1 user function or risking local SQLite history.
V2-D014 permits corrected fixed outputs only where focused evidence confirms implementation drift
from the existing V1 business contract. Work now follows release value: data safety, startup, visible
product behavior, browser compatibility, and release evidence. Performance, maintenance, and
documentation work does not expand without a confirmed release problem.

## Current release snapshot

- Supported Node.js 22.16.0 builds, starts, and passes the current strict type check.
- Literal V1 golden tests freeze lesson selection, metrics, keyboard behavior, event conversion,
  settings, history, game state, export, and restore.
- The final product replay collected 74 Chromium/WebKit tests: 73 passed and the duplicated
  lifecycle-owner case was intentionally skipped once. It completed in 8.0 minutes.
- Gate 2 has a repeatable five-fragment baseline in
  `reports/performance/v1-baseline.json`. It covers empty startup, 100,000 events, common product
  reads and writes, the real Fastify child event loop, Chromium/WebKit typing, and bundle size.
- No product-level release blocker or dead user control was found in the current source audit.
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
  candidate commit `a10e9a8` on `main`; PR #2 delivered the Issue #1 branch. Issue #3 is isolated on
  `fix/3-review-correctness-gaps`.
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
  one-time approval waiver used for bootstrap PR #2; the normal review gate applies to Issue #3.
- The official ASD-STE100 Issue 9 PDF is unavailable. The normative review remains externally
  blocked and does not block independent product work.

## Release convergence classification

| Class           | Work                                                                           | Reason and exit                                                                                                        |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Release Blocker | Final Node.js 22 `npm run check`                                               | The current candidate cannot be published with an unverified final tree.                                               |
| Release Blocker | Core Chromium and WebKit acceptance                                            | Recheck startup, training completion, persistence, analytics, restore, and game after release edits.                   |
| Release Blocker | GitHub CI and merge authorization                                              | Issue #3 passed local final gates; its PR, current CI, independent approval, and merge remain required.                |
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

## Gate status

| Gate                         | Release exit                                                | Status      | Evidence or disposition                              |
| ---------------------------- | ----------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| 0. Protect current state     | Supported install, build, start, health                     | Done        | Node 22 clean install/build/start evidence           |
| 1. Freeze V1 behavior        | Literal business outputs and contracts pass                 | Done        | 22 golden tests plus full V1 suites                  |
| 2. Minimal credible baseline | Correct empty/100k, child-process, browser, bundle evidence | Done        | `reports/performance/v1-baseline.json`               |
| 3. Optimize bottlenecks      | Only act on a proven release problem                        | Cancelled   | No release-level optimization is required            |
| 4. Converge interface        | Fix only confirmed visible/accessibility regressions        | Done        | Final Chromium/WebKit review passed                  |
| 5. Converge code             | Remove confirmed dead source/dependency only                | Done        | Bounded cleanup and release checks passed            |
| 6. Conform documents         | Official Issue 9 review                                     | Blocked     | User must provide the official PDF local path        |
| 7. Accept and publish        | Check, core E2E, data safety, CI, merge authorization       | In progress | Local Issue #3 gates pass; PR/CI/review/merge remain |

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

1. Commit the bounded Issue #3 corrections atomically, push `fix/3-review-correctness-gaps`, open its
   linked PR, pass current CI and independent review, resolve every conversation, and squash merge
   only after the branch is current.

## GitHub bootstrap decision

The empty remote had no `main` from which a numbered branch could be created. Commit `95aa3e5`
created the documented file-free bootstrap and was pushed to `main`. Issue #1 and branch
`chore/1-symtype-2-release` were then created from that base. The entire reviewed project entered
through PR #2 and was squash-merged as `a10e9a8`; no product file was committed directly to `main`.

## Active risks

| Risk                                                    | Control                                                                   | State              |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------ |
| Initial product import had no older Git baseline        | Literal goldens, raw baseline, PR #2 history, current Issue #3 diff       | Controlled         |
| Active Homebrew Node resolves to 25                     | Use explicit Node 22.16.0 PATH in release commands                        | Controlled         |
| `gh` CLI token is invalid                               | Use Git credential, connector, and authenticated Chrome where available   | Controlled         |
| Branch-rule save requires GitHub sudo mode              | Owner confirmed access; the complete `main` rule is saved                 | Resolved           |
| Clean CI lacked workspace `dist` type entry points      | Root npm `prepare`; isolated and GitHub checks pass                       | Resolved           |
| Official STE PDF is absent                              | Do not use unofficial summaries; request only the local official PDF path | Externally blocked |
| 100k all-time stats blocks the local event loop briefly | Keep observable; optimize only after real user evidence                   | Accepted           |

## Outcomes

Gates 0, 1, 2, 4, and 5 are complete; Gate 3 is cancelled by evidence and Gate 6 is externally
blocked. PR #2 delivered the release candidate to `main` as `a10e9a8`. Issue #3 corrects the bounded
contract drift authorized by V2-D014; its final local Node 22, regression, data-safety, launcher, and
Chromium/WebKit gates are green. Gate 7 remains open only for the normal Issue #3
commit/PR/CI/review/merge workflow; no Optional performance or maintenance-platform work is reopened.
