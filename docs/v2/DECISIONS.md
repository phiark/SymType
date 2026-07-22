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
**State:** Accepted, pending GitHub authentication

The target repository exists but has no refs. Create one empty repository-bootstrap commit on
`main`, then create the tracking Issue and branch `chore/<issue>-symtype-2-release`. All product
files enter through that Pull Request. This narrow initialization exception is required because an
empty repository has no base branch for a PR.

## Confirmed defects

This section records only defects confirmed during V2 work. Add a regression test before a fix.

No V2 defect is recorded yet.
