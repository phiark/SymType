# SymType 2.0 Requirements Matrix

**Last update:** 2026-07-23
**Status values:** Verified, Blocked, Optional, Cancelled

`Class` records release priority. `Status` records the current outcome. Every requirement row has
an explicit disposition.

| ID         | Requirement                                              | Class           | Implementation or evidence                                                          | Verification                                        | Status    |
| ---------- | -------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | --------- |
| V2-SCP-001 | Add or remove no user feature                            | Required        | `docs/v2/V2-SCOPE.md` and route inventory                                           | literal public-contract goldens                     | Verified  |
| V2-SCP-002 | Preserve the V1 business contract                        | Release Blocker | shared metric contract, V2-D014, corrected literal goldens                          | 22 regression tests and final E2E                   | Verified  |
| V2-SCP-003 | Preserve user data                                       | Release Blocker | pre-migration snapshots, idempotency, correction checkpoints, export/restore suites | migration, event-ingest, and API integration suites | Verified  |
| V2-G0-001  | Record Git and worktree state                            | Required        | `docs/v2/V2-PLAN.md`                                                                | `git status --short --branch`                       | Verified  |
| V2-G0-002  | Build with supported Node.js                             | Release Blocker | Node.js 22.16.0 release tree                                                        | final `npm run check`                               | Verified  |
| V2-G0-003  | Start production service                                 | Release Blocker | isolated Node 22 launcher acceptance                                                | schema 10, health, reuse, shutdown                  | Verified  |
| V2-G0-004  | Classify current failures correctly                      | Required        | V2 plan and decisions                                                               | environment/product distinction                     | Verified  |
| V2-G1-001  | Freeze lesson and selection outputs                      | Release Blocker | shared literal golden suites                                                        | regression suite                                    | Verified  |
| V2-G1-002  | Freeze event and metric outputs                          | Release Blocker | shared, Web, and server goldens corrected under V2-D014                             | 22-test regression suite                            | Verified  |
| V2-G1-003  | Freeze modifiers and error policies                      | Release Blocker | Web and shared goldens                                                              | regression suite                                    | Verified  |
| V2-G1-004  | Freeze persistence and settings                          | Release Blocker | server literal goldens and verified pre-migration recovery snapshots                | integration suites                                  | Verified  |
| V2-G1-005  | Freeze history and game results                          | Release Blocker | shared/server literal goldens                                                       | integration suites                                  | Verified  |
| V2-G1-006  | Freeze export and restore results                        | Release Blocker | canonical database projection                                                       | integration suites                                  | Verified  |
| V2-G2-001  | Deterministic empty and 100k fixtures                    | Required        | fixture generator, manifest, hashes                                                 | integrity/FK/semantic validation                    | Verified  |
| V2-G2-002  | Record raw minimal production baseline                   | Required        | `reports/performance/v1-baseline.json`                                              | five fragments; no machine absolute paths           | Verified  |
| V2-G2-003  | Record empty startup and health                          | Required        | startup fragment                                                                    | 20 samples, median/p95                              | Verified  |
| V2-G2-004  | Record Chromium/WebKit input hot path                    | Required        | P3 client fragment                                                                  | persisted events and latency                        | Verified  |
| V2-G2-005  | Record 100k API, query, and child-loop work              | Required        | database/server fragments                                                           | all-time count and IPC source                       | Verified  |
| V2-G2-006  | Record 30-minute memory and 1m scale                     | Optional        | short memory smoke and stable fixture support                                       | not a release gate                                  | Optional  |
| V2-G2-007  | Smoke Today, completion, and Analytics on 100k           | Required        | focused performance Playwright test                                                 | 100,248 final characters; source fixture unchanged  | Verified  |
| V2-G3-001  | Optimize only a confirmed user-relevant hotspot          | Required        | `docs/v2/DECISIONS.md`                                                              | evidence rule                                       | Verified  |
| V2-G3-002  | Maintain a full before/after comparison platform         | Optional        | existing compare script                                                             | not invoked by release gate                         | Optional  |
| V2-G3-003  | Rewrite architecture to satisfy old theoretical budgets  | Cancelled       | no release-level bottleneck found                                                   | not applicable                                      | Cancelled |
| V2-G4-001  | Reuse evidence when no visual redesign occurs            | Required        | 30-image V1 matrix and rubric                                                       | final two-engine visual path passed                 | Verified  |
| V2-G4-002  | Perform a V2 visual redesign                             | Cancelled       | no confirmed visual-design defect                                                   | not applicable                                      | Cancelled |
| V2-G4-003  | Pass critical 1024/desktop Chromium/WebKit views         | Release Blocker | final complete Playwright replay                                                    | visual matrix and runtime-boundary pass             | Verified  |
| V2-G4-004  | Preserve keyboard/focus/axe behavior                     | Release Blocker | transient timers are owned by the typing surface                                    | unmount regression and both engines pass            | Verified  |
| V2-G4-005  | Record a physical Safari manual run                      | Optional        | WebKit remains automated release evidence                                           | manual environment only                             | Optional  |
| V2-G5-001  | Enforce all historic file-size limits                    | Cancelled       | legacy debt inventory                                                               | no release value shown                              | Cancelled |
| V2-G5-002  | Enforce all complexity and parameter limits              | Cancelled       | legacy debt inventory                                                               | no release value shown                              | Cancelled |
| V2-G5-003  | Preserve the cycle-free workspace graph                  | Required        | architecture audit                                                                  | no module/workspace cycles                          | Verified  |
| V2-G5-004  | Prevent type escapes and compile strictly                | Required        | ESLint and TypeScript strict                                                        | final lint/typecheck passed                         | Verified  |
| V2-G5-005  | Build a new coverage platform                            | Cancelled       | existing behavior suites are retained                                               | not applicable                                      | Cancelled |
| V2-G5-006  | Remove confirmed duplicate source and unused dependency  | Required        | shadow API source and unused Radix Tabs removed                                     | 22 goldens, lint, typecheck, build pass             | Verified  |
| V2-G6-001  | Build a new STE checker platform                         | Cancelled       | no release dependency                                                               | not applicable                                      | Cancelled |
| V2-G6-002  | Keep the existing concise term/conformance record        | Optional        | `docs/ste/terms.yml` and conformance file                                           | document review                                     | Optional  |
| V2-G6-003  | Complete official Issue 9 review                         | External        | `ASD-STE100-CONFORMANCE.md`                                                         | official local PDF required                         | Blocked   |
| V2-G7-001  | Pass final non-browser release gate                      | Release Blocker | 62 Vitest files, 452 pass, 1 skip; builds pass                                      | Node.js 22.16.0 `npm run check`                     | Verified  |
| V2-G7-002  | Pass core Chromium and WebKit E2E                        | Release Blocker | 74 collected: 73 pass, 1 intentional skip                                           | full production replay, 8.0 minutes                 | Verified  |
| V2-G7-003  | Accept minimal performance evidence                      | Required        | Gate 2 baseline and 100k product smoke                                              | no release-level blocker                            | Verified  |
| V2-G7-004  | Pass clean one-click start                               | Release Blocker | offline isolated install/start/rebuild smoke                                        | port fallback, health, reuse, modes, shutdown       | Verified  |
| V2-G7-005  | Record explicit bootstrap merge authorization            | Release Blocker | PR #2, release evidence, and V2-D013                                                | merged as `a10e9a8` under the one-time waiver       | Verified  |
| V2-GIT-001 | Persist Issue/branch/commit/PR workflow                  | Required        | AGENTS, CONTRIBUTING, templates                                                     | Prettier and YAML parse                             | Verified  |
| V2-GIT-002 | Run applicable CI on push and PR                         | Release Blocker | workflow plus V2-D012 clean-install preparation                                     | required Node 22 check on both triggers             | Verified  |
| V2-GIT-003 | Create traceable Issue, numbered branch, commits, and PR | Release Blocker | Issues #1/#3, numbered branches, commits, and PRs #2/#4                             | remote SHAs and PR metadata verified                | Verified  |
| V2-GIT-004 | Protect `main` and require review/checks                 | Required        | saved classic rule plus Squash-only and auto-delete                                 | PR, approval, current CI/branch, no bypass          | Verified  |

## Incorporated V1 function contract

`docs/requirements-matrix.md` remains the authoritative 164-ID V1 traceability record. V2 cannot
remove, renumber, weaken, or silently close one of those rows.

| V1 area                                         | V2 compatibility evidence                        | State                           |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| Foundation, launch, security, API               | clean install/start plus 46-route manifest       | Frozen                          |
| SQLite, settings, events, export, restore       | canonical goldens and data-safety suites         | Frozen; final replay passed     |
| Keyboard, onboarding, Today, all training modes | shared/browser suites and literal events         | Frozen                          |
| Tests, analytics, adaptive engine               | history/statistics/algorithm goldens             | Frozen                          |
| Six-level game                                  | dual-engine flows and literal state trajectories | Frozen                          |
| UI, accessibility, sound                        | visual/axe/audio/WebKit suites                   | Frozen; final replay passed     |
| Documents and research                          | V1 document set plus V2 decisions                | Official STE PDF review blocked |
