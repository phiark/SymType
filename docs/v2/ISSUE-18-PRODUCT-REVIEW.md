# Issue 18: product journey and measured performance

Review date: 2026-09-07. Issue: [#18](https://github.com/phiark/SymType/issues/18).
Baseline: `origin/main` at `481a2cb`. Candidate: `refactor/18-product-experience`.

The product goal is a clear loop: choose a useful practice, type without ambiguity, understand the
result, and return with saved progress. This review covers Today, Train, Test, Game, Analytics,
Settings, active input, pause/exit, error recovery, and the local SQLite execution path.

The maintainer's current request explicitly reopens product experience and measured performance
work. V1 functions, routes, settings, metrics, training choices, and game rules remain the contract.
This branch also incorporates the reviewed source of the unfinished Issue 14 correction batch via
`git cherry-pick -x 1352c05`; its earlier browser limitations are historical, not current evidence.
The separate macOS packaging branch and its untracked screenshots are untouched.

## Findings and decisions

| Priority | Reproducible problem                                                                        | Product consequence                                                                         | Implemented response                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P1       | Save/exit or recover a session with fractional browser IKI and no explicit integer duration | Summary validation returns HTTP 500 and the session cannot close                            | Quantize only the inferred aggregate to the existing integer-ms contract; preserve raw timing; verify restart/export          |
| P1       | Complete a micro-block, then receive identical text under a new block ID                    | Input state stays complete and the next block cannot proceed normally                       | Reset at persisted block identity; preserve the mounted input and focus                                                       |
| P1       | Read all-time analysis repeatedly with the deterministic 100k-event fixture                 | Each read recomputes the same aggregates and blocks the local server for about a second     | Four-period derived cache, checked against SQLite changes and calendar boundaries; original calculations retained             |
| P1       | A previously open page requests a lazy module replaced by a local update                    | Default router error exposes a developer screen with no recovery action                     | Plain recovery screen, explicit reload, a working home link, and accurate saved/unsaved-state guidance                        |
| P2       | Open Train with no selected mode                                                            | Sixteen scope controls compete with twelve equally weighted choices                         | Optional scope disclosure and two mode groups, with Smart as the visible starting point; every mode remains available         |
| P2       | Navigate from a scrolled settings page to Analytics, or follow the experiment settings link | Destination starts at the previous scroll position, obscuring the primary task              | Apply route focus/scroll after lazy content mounts; honor existing section hashes                                             |
| P2       | Open or close a configuration panel inserted above the mode grid                            | Keyboard position and visual position no longer match the action                            | Focus the opened heading and return focus to the initiating card on close                                                     |
| P2       | Scroll from changed settings to the backup section                                          | The only Save button leaves the viewport                                                    | Sticky search/save toolbar and section scroll offsets; unchanged server revision checks                                       |
| P2       | Open Game on a 1024px desktop                                                               | New-task action follows the entire level catalogue                                          | Put existing difficulty/rules/start controls before the catalogue                                                             |
| P2       | Open Analytics                                                                              | An unused algorithm experiment precedes the user's trend                                    | Move personal trends immediately after metrics and preserve the experiment at the end                                         |
| P2       | Open Today with no historical trend                                                         | The route downloads chart code that has nothing to draw                                     | Load the chart component only when real trend data exists                                                                     |
| P2       | Read the active typing surface and pause                                                    | Filled current cue resembles completed input; pause exit and keyboard alignment are unclear | Incorporate the five-state glyphs, ANSI geometry, home-key/zone cues, contained pause actions, and guarded exit from Issue 14 |
| P3       | Read dashboard and settings instructions                                                    | Storage engine, audio API, and test implementation details compete with the task            | Shorter task-oriented copy, compact dashboard hierarchy, and existing privacy/backup facts where useful                       |

No new metric, adaptive weighting formula, route, setting, dependency, database schema, or remote
service is introduced. V2-D017 corrects fractional inferred duration at the existing integer-ms
persistence boundary; raw browser timings are unchanged. The automatic-text terminal-whitespace correction is the previously accepted
V2-D015 defect fix; imported content is not trimmed or rewritten. The fixed-output suite verifies
this exception and all unchanged contracts. Browser keys still describe expected mapping, never a
detected physical finger.

## Design basis

Progressive disclosure makes secondary choices available at the moment they help; it must preserve
discoverability and reversible access. The scope summary therefore shows the active filters even
when closed. See [NN/g's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/).

Keyboard focus must remain visible and unobscured when persistent UI is added. Primary controls
retain the repository's 44px target convention; the settings toolbar uses matching scroll offsets.
See [WCAG focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)
and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Responsiveness is measured along the input and server paths instead of inferred from smaller source
files. See [web.dev's INP guidance](https://web.dev/articles/optimize-inp). SQLite remains authoritative:
[`total_changes()`](https://www.sqlite.org/c3ref/total_changes.html) detects this connection's writes,
while [`data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) detects other
connections' commits. Transactions bypass the cache because rollbacks do not rewind total changes.
Returned reports are cloned so callers cannot corrupt later responses. Calendar boundaries also
invalidate reports without a write. A new database instance starts with an empty cache.

## Visual and interaction evidence

All review captures use synthetic local data. Before/after images are original browser captures,
not mockups. The manual baseline and candidate were viewed at 1280×720 in Codex's in-app browser.
The automated matrix separately covers Chromium and WebKit, 1024px, desktop, dark mode, 200%
reflow, focus, and axe. This is not a physical Safari manual-run claim.

| Step                              | Before evidence                                     | Candidate evidence                                | Health                                                   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Today: choose the next practice   | [Before](evidence/issue-18/before/02-today.png)     | [After](evidence/issue-18/after/02-today.png)     | Primary action and daily progress are visible together   |
| Train: choose a path              | [Before](evidence/issue-18/before/03-train.png)     | [After](evidence/issue-18/after/03-train.png)     | Guided options lead; optional scope remains discoverable |
| Test: select a measured test      | [Before](evidence/issue-18/before/04-test.png)      | [After](evidence/issue-18/after/04-test.png)      | Preset/custom duration contract retained                 |
| Game: configure and start         | [Before](evidence/issue-18/before/05-game.png)      | [After](evidence/issue-18/after/05-game.png)      | Start is visible before the catalogue                    |
| Analytics: read personal progress | [Before](evidence/issue-18/before/06-analytics.png) | [After](evidence/issue-18/after/06-analytics.png) | Personal trends precede experiment configuration         |
| Settings: change and save         | [Before](evidence/issue-18/before/07-settings.png)  | [After](evidence/issue-18/after/07-settings.png)  | Save remains reachable in later groups                   |
| Ready: understand the next step   | [Before](evidence/issue-18/before/08-ready.png)     | [After](evidence/issue-18/after/08-ready.png)     | Human-readable mode and accurate sound/save state        |
| Active input                      | [Before](evidence/issue-18/before/09-active.png)    | [After](evidence/issue-18/after/09-active.png)    | Current input, history and mapped key have distinct cues |
| Pause and exit                    | [Before](evidence/issue-18/before/10-paused.png)    | [After](evidence/issue-18/after/10-paused.png)    | Continue/exit and guarded completion remain reachable    |

## Measurement and verification

Measurements use Node.js 22.16.0, SQLite 3.53.2, Apple M3 Pro/arm64 and the same deterministic
100k fixture (`434253c1…e62093`). Server results use five warm-ups and 20 timed requests per operation.
Raw fragments and full-report equality hashes are in
[`reports/performance/issue-18`](../../reports/performance/issue-18/).

| Measurement                                 | Before                 | Candidate          | Interpretation                                      |
| ------------------------------------------- | ---------------------- | ------------------ | --------------------------------------------------- |
| 100k all-time statistics, repeated-read p95 | 979.45 ms              | 1.75 ms            | SQLite revision unchanged; cache hit                |
| 100k dashboard p95                          | 2.49 ms                | 2.43 ms            | No meaningful regression                            |
| 100k full report, one cold profile          | 1007.94 ms             | 1099.50 ms         | Still about one second; no cold speedup claim       |
| Empty statistics p95                        | Not remeasured         | 0.96 ms            | Final empty-fixture smoke                           |
| Empty service health p95                    | Not remeasured         | 224.21 ms          | 20 isolated first/cached-backup trials              |
| Launcher app-work p95                       | Not remeasured         | 750.80 ms          | Existing supported-runtime startup path             |
| Chromium input-to-next-frame p95            | Not remeasured         | 7.08 ms            | Instrumented short local replay                     |
| WebKit input-to-next-frame p95              | Not remeasured         | 15.00 ms           | Instrumented short local replay                     |
| Persisted mixed-input events                | Not remeasured         | 141 in each engine | Every captured event reconciles with SQLite         |
| Empty Today chart request                   | Eager chart dependency | Deferred           | Approximately 103 KB gzip chart asset not requested |

The complete 100k report is equal before/after, not merely its overview. Browser paint timings are
short controlled replay proxies, not population INP claims. The client run records two load samples
per profile and a short input stream; it also verifies one AudioContext, no remote media, no listener
or timer growth, and no unreleased sound nodes. Full 30-minute stability and million-event work remain
optional. Raw fragments retain their actual source revision/capture metadata.

The final command results are recorded in the [acceptance log](evidence/issue-18/ACCEPTANCE.md).

The performance replay additionally found and now tests the fractional-timing save/exit defect
(V2-D017). This was a product failure, not a benchmark exemption. The initial bundle helper assumed
`npm` was adjacent to the selected Node binary; this runtime layout has them in different locations.
Bundle evidence therefore follows an explicit successful `npm run build -w @symtype/web -- --manifest`
and uses `run-bundle.mjs --no-build`, accurately labelled in its metadata. The ordinary production
build also passes through `npm run check`.

## Risk, limits, and rollback

A first all-time report after a write still computes the original aggregates and can occupy the
server for about a second on the 100k fixture. Repeated reads are the optimized case. The cache is
bounded to the four existing periods and trades a small amount of server memory for avoiding this
repeated work. Short browser measurements are interaction evidence, not a 30-minute stability or
million-event claim. A trial median-selection rewrite was discarded because profiling did not show
a useful cold-read improvement.

Revert the Issue 18 commits through a reviewed PR and restart the local service. No migration is
added, and rollback never deletes, replaces, or rebuilds the user's database. A pre-existing tab may
need a reload after either upgrade or rollback. In the injected WebKit module-failure case, ordinary
reload can reuse the failed module; the recovery page therefore also provides a plain home link and
restart guidance. The test proves reload is invoked, the home route remains usable, and saved settings
survive; it does not claim that reload clears every browser module cache. Existing JSON/SQLite restore validation and automatic
pre-restore backup remain required and tested.

Delivery requires the final CI result, resolved conversations and an independent approving review.
The official STE PDF review remains externally blocked and separate from this implementation.
