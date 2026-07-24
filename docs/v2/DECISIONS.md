# SymType 2.0 Decision Log

## V2-D001: Use the current worktree as the V1 source baseline

**Date:** 2026-07-22
**State:** Accepted

The repository has no commit. All files are untracked. The project cannot use Git history for a V1
comparison.

Freeze V1 with fixed-output tests, source inventories, command results, and raw performance data.
Do not reset or discard any current file.

## V2-D002: Keep the document gate blocked without the official Issue 9 PDF

**Date:** 2026-07-22
**State:** Accepted

The local search did not find an official ASD-STE100 Issue 9 PDF. Continue independent engineering
work. Do not declare Gate 6 complete before the normative review.

## V2-D003: Use `docs/product-spec.md` as the available V1 product contract

**Date:** 2026-07-22
**State:** Accepted

`Codex-Prompt-SymType.md` is not present. `docs/product-spec.md` and the V1 requirement matrix are the
available repository contracts. The supplied V2 prompt does not replace them.

## V2-D004: Finish the pending V1 replay before a V2 optimization

**Date:** 2026-07-22
**State:** Accepted

The latest complete V1 browser checkpoint predates later focused regression work. Run the pending
focused game test and the full current suite. Record failures as Gate 0 baseline evidence.

## V2-D005: Use the installed Node.js 22.16.0 runtime for the fresh baseline

**Date:** 2026-07-22
**State:** Accepted

The Homebrew `node@24` path resolves to Node.js 25.3.0. Node.js 25 is unsupported and cannot load the
current native SQLite module. Use the installed NVM Node.js 22.16.0 runtime for Gate 0. Rebuild the
native module with that runtime before the replay.

## V2-D006: Freeze maintenance debt before large splits

**Date:** 2026-07-22
**State:** Accepted

The baseline has 30 hard file exceptions when the production launcher is included. It also has 220
trial function-rule violations. Add a checker that rejects a new violation or growth first. Complete
Gate 1 goldens before a large split. Split each file by responsibility, not only by line count.

The current dependency graph has no cycle and no cross-workspace deep import. Preserve those results.

## V2-D007: Use reviewed literal projections as the V1 behavior lock

**Date:** 2026-07-22
**State:** Accepted

Tests that compare two calls to the same implementation do not freeze a V1 result. Gate 1 adds
literal projections for shared logic, browser input conversion, and server business data. Generated
IDs and wall-clock values are excluded only when they do not affect the business result.

Run `npm run test:regression` in every V2 change gate. Do not update a literal expected value unless
a confirmed defect decision permits the business change.

## V2-D008: Use one versioned performance metric contract

**Date:** 2026-07-22
**State:** Accepted

Each performance fragment uses a stable metric ID and records raw samples when a metric has repeated
measurements. A summary can contain count, median, p95, p99, or a scalar value. The release contract
keeps the unit and required statistic with each budget.

If V1 meets a budget, V2 cannot regress by more than five percent. If V1 misses a budget, V2 must
improve by at least twenty percent and meet the absolute budget. A missing metric is a failed result.

## V2-D009: Converge Gate 2 on a minimal credible release baseline

**Date:** 2026-07-22
**State:** Accepted; supersedes the release-gate scope in V2-D008

Gate 2 requires empty and 100k evidence for startup, common product operations, the browser typing
path, the actual Fastify child process, and the production bundle. A 1m suite, 30-minute memory run,
exhaustive route budgets, and performance-framework expansion are Optional.

The existing broad comparison contract may remain as a diagnostic tool. Missing Optional metrics
must not block the SymType 2.0 release, and `npm run check` does not invoke that comparison.

## V2-D010: Do not optimize the measured 100k baseline before release

**Date:** 2026-07-22
**State:** Accepted

The 100k all-time statistics query is visible at about 0.91 seconds p95 and blocks the single local
Fastify event loop while it runs. Today, saving, lesson generation, and typing remain fast. This is
usable for the local single-user product and does not justify an architecture or database rewrite.

Reconsider only with a repeatable user-relevant failure, a located hotspot, a focused safe change,
unchanged V1 goldens, and a before/after result.

## V2-D011: Bootstrap the empty GitHub repository with an empty main commit

**Date:** 2026-07-22
**State:** Accepted and completed

The target repository exists but has no refs. Create one empty repository-bootstrap commit on
`main`, then create the tracking Issue and branch `chore/<issue>-symtype-2-release`. All product
files enter through that Pull Request. This narrow initialization exception is required because an
empty repository has no base branch for a PR.

## V2-D012: Build internal workspace entry points during dependency installation

**Date:** 2026-07-22
**State:** Accepted

The first clean GitHub Actions run failed in type-aware ESLint because `@symtype/shared` and
`@symtype/content` intentionally publish their local workspace entry points from `dist`, while a
clean checkout had not built those entry points. Existing local `dist` files masked the problem.

Keep the production package exports unchanged. Add one root `build:packages` command and invoke it
through npm's standard root `prepare` lifecycle after dependency installation. This makes clean
`npm ci` produce the same internal type entry points as a normal local install without weakening
ESLint, changing application behavior, or adding a separate CI-only path.

## V2-D013: Permit a one-time approval waiver for bootstrap PR #2

**Date:** 2026-07-22
**State:** Accepted by the repository maintainer

PR #2 has a clean final diff, no unresolved review threads, passing local release checks, passing
Chromium/WebKit acceptance, and passing push and pull-request CI. The repository has no distinct
reviewer available for its first product import, so the maintainer explicitly authorized disabling
the independent-approval requirement and merging the already verified PR directly.

This is a one-time bootstrap exception, not a change to the durable development process. Keep the
pull-request, Node 22 status check, up-to-date branch, resolved-conversation, linear-history,
no-bypass, no-force-push, and no-deletion protections active during the merge. Restore the
independent-approval requirement immediately afterwards for future changes.

## V2-D014: Correct confirmed contract drift instead of preserving stale expected values

**Date:** 2026-07-22
**State:** Accepted for Issue #3

The whole-repository review confirmed five correctness and data-safety defects: existing databases
could migrate without a recovery snapshot; delayed event batches could make feature models depend on
network arrival order; server and live typing metrics disagreed with the documented shared net-WPM
contract; a final Backspace correction could be absent from a completion summary; and unsupported
custom-text characters could be persisted even though the trainer has no physical-key mapping for
them.

Fix these defects without adding or removing a user function, changing the schema version, rewriting
historical custom text, or inventing browser evidence. This decision supplies the confirmed-defect
exception required by V2-D007 for the net-WPM literal goldens because `docs/product-spec.md` and the
existing shared metric function already define the authoritative exact rule: subtract each final
uncorrected error once per active minute and floor at zero. The prior server clamp and all-attempt
error count were implementation drift, not the V1 business contract. Every changed literal must be
paired with focused regression evidence.

## V2-D015: Correct the confirmed focused-training defects without expanding V1

**Date:** 2026-07-24
**State:** Accepted by the repository maintainer for Issues #8, #10, #11, #13, #14, and #15

Maintainer testing and the attached Keybr interaction references confirmed six bounded defects: the
current target could look completed, the virtual keyboard discarded authoritative ANSI coordinates
and made finger zones hard to scan, generated automatic text could end on an invisible separator,
pause exposed no guarded exit action, implementation jargon leaked into routine copy, and active
training retained redundant rationale/count/storage chrome.

Fix those defects as convergence work. Preserve input events, mappings, metrics, session lifecycle,
persistence, routes, settings, and all imported/custom content. Issue #13 is the only authorized
literal lesson-output correction: remove terminal whitespace at the automatic generator boundary,
update the fixed golden transparently, and leave candidate choice, scoring, rationale, historic
blocks, and user-authored bytes unchanged. The visual fixes may strengthen existing state cues and
reuse the existing guarded exit owner; they may not add a mode, setting, shortcut, or unguarded
navigation path.

## Confirmed defects

This section records only defects confirmed during V2 work. Add a regression test before a fix.

- CI-001: Clean-checkout lint could not resolve internal workspace package types before their
  `dist` entry points existed. V2-D012 passed an isolated Node 22.16.0 offline `npm ci` followed by
  the complete `npm run check`. GitHub Actions run 29904308912 then passed the independent Linux
  runner verification for commit `ed1aae9`.
- PERF-001: The server fragment exposed the measurement machine's absolute fixture path. Evidence
  now stores the deterministic manifest-relative path (or a custom fixture basename), with a
  focused regression test; measured values and V1 product behavior are unchanged.
- UI-001: `TypingSurface` transient visual, focus, and completion timers could outlive an unmounted
  surface. The component now owns and clears those timers; a focused unmount regression prevents
  late React updates without changing typing results.
- DATA-001: Existing databases could enter a forward migration without a verified recovery snapshot.
  Direct and standalone migration now create a mode-0600, integrity-checked pre-migration SQLite
  snapshot before the first schema change, and failed migrations preserve it.
- METRIC-001: Server summaries and live typing could clamp or count errors differently from the
  documented shared net-WPM contract. The canonical `TypingSurface` and server summary/projection
  paths now use the shared functions with reconstructed final uncorrected errors; legacy public
  summaries, tests, experiments, game settlement, and CSV exports materialize canonical values
  without rewriting history. V2-D014 authorizes the corrected goldens.
- INPUT-001: A Backspace made after the last persisted character event could correct the visible text
  without correcting the saved summary. Completion and explicit save now send a bounded,
  session-owned correction checkpoint for the latest sequenced block without fabricating an event;
  completion-latched surfaces reject further character or Backspace input while saving.
- INPUT-002: New custom text could contain characters outside the immutable ANSI-US input map.
  Import and API boundaries now normalize line endings and reject the first unsupported code point;
  historical rows are preserved and fail lesson generation with recovery guidance.
- MODEL-001: A delayed lower-sequence event batch could update feature evidence after newer events and
  make the model depend on receive order. That rare path now folds only touched features from the
  same profile's canonical session/event order and writes each once; normal in-order batches remain
  incremental.
- UI-002: A filled block caret made the next untyped glyph resemble completed history. Current,
  untouched, correct, incorrect, and corrected states now expose distinct semantic and non-color
  presentation while retaining current-position scrolling and event output.
- UI-003: The virtual keyboard centered every row instead of consuming shared ANSI columns, and
  encoded finger zones with subtle borders. Rendering now derives row placement and key widths from
  the shared layout and combines five paired finger-class colors (pinky, ring, middle, index, thumb)
  with left/right labels, zone boundaries, home-key marks, and target cues.
- LESSON-001: Candidate truncation could retain only a leading separator as the final generated
  character. Automatic generation now removes terminal whitespace after assembly; V2-D015 authorizes
  the paired fixed-output correction without trimming imported or custom text.
- UI-004: The paused typing overlay offered only resume. It now exposes keyboard-contained Continue
  and Exit actions, with Exit delegating to the existing save/confirm/navigation owner.
- COPY-001: Routine UI surfaced storage-engine names and raw implementation errors. Presentation now
  maps semantic contexts to actionable, redacted user copy while expert backup controls retain
  accurate format terminology.
- UI-005: Focused training repeated storage, phase, rationale, and block-count chrome around the lesson.
  The active state now keeps accessible progress and save/recovery status while removing those
  redundant visual labels.
