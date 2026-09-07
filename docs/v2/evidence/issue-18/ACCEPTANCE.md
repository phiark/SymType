# Issue 18 acceptance evidence

Date: 2026-09-07. Issue: [#18](https://github.com/phiark/SymType/issues/18).
Pull Request: [#19](https://github.com/phiark/SymType/pull/19).
Product source: `e818c6dafd02d55a2257f1eec86ff1c804a60646` on
`refactor/18-product-experience`. Documentation and reviewed PNGs follow in a separate evidence
commit. Base: merged PR #4, `481a2cbe41824295ed9baed5f86648e4abd01af4`.

The original packaging worktree remains on `feature/5-macos-dmg` with its five pre-existing
untracked PNGs. All runs here use isolated synthetic test/fixture databases. No user history,
operating-system setting, network configuration, dependency, API route or migration was changed.

## Local quality gate

Runtime: Node.js 22.16.0, npm 11.7.0, SQLite 3.53.2, macOS arm64 / Apple M3 Pro.
The selected Node is on PATH for every command; the host's unsupported Node 25 is not used.

| Command/check                                                                                                                         | Actual outcome                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                              | Clean locked dependency installation completed with supported Node during worktree setup; lockfile unchanged                                                     |
| `npm run format:check`                                                                                                                | Pass: full-repository Prettier check                                                                                                                             |
| `npm run check`                                                                                                                       | Pass: zero-warning ESLint, strict root/workspace typecheck, 64 Vitest files / 487 tests passed / one intentional runtime-conditional skip, all production builds |
| `npm run test:regression` (also included in check)                                                                                    | Pass: eight files / 22 literal V1 regressions                                                                                                                    |
| `npm run test:e2e`                                                                                                                    | Pass without snapshot-update flag: 85 passed, one intentional WebKit duplicate of the Chromium-owned cross-browser restart scenario; 7.4 minutes                 |
| `npx playwright test tests/e2e/product-journey.spec.ts`                                                                               | Pass: 12 cases across Chromium and WebKit; these are also included in the full 85-pass run                                                                       |
| `npx playwright test --config=playwright.performance.config.ts --project=chromium-local tests/performance/100k-product-smoke.spec.ts` | Pass: Today → five real micro-blocks → completion → populated Analytics, 100,245 final characters; source fixture unchanged                                      |
| `node --import tsx scripts/perf/run-client.mjs --short --skip-build`                                                                  | Pass: release Chromium load profile and both local-engine load/input profiles; release-profile duplicate typing test intentionally skipped                       |
| `node --import tsx scripts/perf/run-startup.mjs --samples 10`                                                                         | Pass: 20 health and 20 launcher-work measurements across first/cached-backup states                                                                              |
| `npm run build -w @symtype/web -- --manifest`, then `run-bundle.mjs --no-build`                                                       | Pass: explicit production manifest build; bundle fragment honestly retains `clean: false` for its separate no-build inspection                                   |
| `git diff --check`; latest `origin/main` ancestry                                                                                     | Pass; current main remains `481a2cb` and is an ancestor                                                                                                          |

The 100k invocation sets `SYMTYPE_PERF_FIXTURE_PATH=.symtype-perf-data/fixtures/100k.sqlite3`, a
separate observation output directory and a unique run ID. Performance runs follow the quality/browser
runs rather than compete with them. Full server reads use five warm-ups and 20 timed samples. Browser
load uses two samples per profile and a five-second mixed-input replay; these are limited local
measurements, not a population INP or 30-minute stability study.

## Data and performance proof

[Raw fragments](../../../../reports/performance/issue-18/) preserve source/capture metadata. The
full-report equivalence fragment records matching SHA-256 values. Server before/after measurements
were captured at `481a2cb` / `7df81ec`; subsequent commits modify only web navigation/recovery. Final
client/startup/bundle runs use `e818c6d`. Dirty metadata reflects pending docs and reviewed images;
all product source was committed. These revisions are stated rather than relabelled as one run.

- Fixture SHA-256: `434253c1e5dcd4a1d8a8bb252745711e6abe6c10a06d0780072658f583e62093` before and after.
- Repeated all-time statistics p95: 979.45 → 1.75 ms at unchanged SQLite revision. The single cold
  full-report profile remains 1099.50 ms; no cold speedup is claimed.
- SQLite cache tests cover own writes, another connection's commit, rollback, date boundaries and
  isolation of returned objects. Transactions bypass the cache and capacity is four periods.
- Fractional browser timing: abandon/recover both pass, integer aggregate summary survives restart,
  raw 1250.25 ms IKI remains unchanged and JSON export succeeds. Existing integer cases stay literal.
- Final input-to-next-rAF p95: Chromium 7.08 ms, WebKit 15.00 ms; handler p95 0.20 ms. Each engine
  persists all 141 attempted mixed-input events in eight batches, with one AudioContext, no media
  requests, no listener/timer growth and no unreleased audio nodes.
- Empty health p95 224.21 ms; launcher app-work p95 750.80 ms. OS browser launch is not measured.
- Practice JS 169.93 KiB gzip, CSS 12.35 KiB gzip. Empty Today avoids requesting the approximately
  103 KB gzip chart asset; a browser network assertion verifies this conditional path.

Before/after input and startup timings were not newly measured as a paired experiment; the final
runs establish the candidate's actual behavior. The performance gain claim is restricted to the
paired repeated-statistics path and the observed conditional chart request.

## Visual and functional review

All 30 tracked Chromium/WebKit PNGs were opened at original resolution on 2026-09-07 and reviewed
in browser pairs. The final suite compares these baselines without `--update-snapshots`.
[UI-REVIEW-006](../../../ui-rubric.md) records the seven-dimension result and its limits.

The separate original [before](before/)/[after](after/) captures use the in-app browser at 1280×720.
The walkthrough covered all six routes, ready state, correct/incorrect/corrected/current/untouched
glyphs, physical keyboard target cues, pause, keyboard selection of Exit, guarded Save and Exit,
settings navigation and backup controls. The [product review](../../ISSUE-18-PRODUCT-REVIEW.md)
links each step and explains what changed. A physical Safari listening run is not claimed.

Automated evidence additionally covers 1024px overflow, 200% reflow, light/dark/system themes,
reduced motion, axe, configuration focus return, route top/hash focus, sticky Save, all twelve
training modes, all six game levels, tests, export/validated restore with pre-restore backup, and a
real server restart followed by a new WebKit browser reading the same SQLite history.

The recovery case deliberately serves a lazy module as HTTP 503, verifies plain guidance and a
reload action, removes the injected failure, and proves the home route works with a persisted setting.
WebKit can reuse a failed module after ordinary reload, so the explicit home link remains necessary.
No unsupported claim that reload always clears module failures is made. Injected failure diagnostics
are expected; normal-flow console/runtime assertions pass.

## Delivery and limitations

Local product acceptance is complete. [PR #19](https://github.com/phiark/SymType/pull/19) must still have current passing CI, resolved
conversations and at least one independent approving review before merge. No self-approval or branch
protection bypass is authorized. The PR is the live record for these external states.

The V1 matrix retains 164 IDs: 139 Verified, 23 In progress, one external Blocked and one Planned.
Uncollected historic-browser, native-launcher/listening and longitudinal evidence stays explicit;
V2 separately records whether it is required or optional. The remaining five Keybr references and
official STE PDF are external inputs. No new platform, full-scale benchmark or external review is
fabricated to close those rows.

Rollback is a reviewed code revert and local-service restart. No migration or database downgrade is
required. Never delete/rebuild user data as part of rollback; validated restore still requires its
automatic current-database backup.
