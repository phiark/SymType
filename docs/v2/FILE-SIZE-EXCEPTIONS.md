# SymType 2.0 Legacy File-Size Exceptions

**State:** Baseline inventory complete
**Last update:** 2026-07-22

## Rule

This file can list only a legacy file that exceeded a V2 hard limit before V2 implementation. A new
production file cannot enter this list.

Each entry must contain the file path, current logical lines, reason, owner, and split condition. An
exception does not waive the function, complexity, dependency, or type rules.

## Exceptions

| File path                                           | Logical lines | Reason                                                           | Owner            | Split condition                                                                             |
| --------------------------------------------------- | ------------: | ---------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `apps/web/src/styles.css`                           |          3792 | Legacy global style monolith                                     | Web UI           | Split into tokens, base, shell, feature, and responsive files before Gate 4 closes          |
| `apps/server/src/db/database.ts`                    |          3373 | Legacy repository facade and queries                             | Server data      | Split by repository domain after database goldens pass                                      |
| `apps/server/test/app.integration.test.ts`          |          2534 | Legacy cross-domain integration suite                            | Server tests     | Split by API domain after Gate 1 fixtures exist                                             |
| `packages/shared/src/runtime-api.ts`                |          1425 | Legacy combined API schemas and manifest                         | Shared contracts | Split by API domain after the 46-route manifest is frozen                                   |
| `apps/web/src/pages/PracticePage.tsx`               |          1205 | Legacy session controller and view                               | Web practice     | Split lifecycle, calibration, summary, and view after the performance baseline exists       |
| `apps/server/src/app.ts`                            |          1199 | Legacy combined Fastify registration                             | Server API       | Split route plugins after API and data goldens pass                                         |
| `apps/web/src/pages/GamePage.tsx`                   |          1147 | Legacy game controller and view                                  | Web game         | Split controller and sections after game goldens pass                                       |
| `apps/web/src/pages/AnalyticsPage.tsx`              |          1098 | Legacy analytics controller and views                            | Web analytics    | Split filters, summaries, charts, and details after history goldens pass                    |
| `apps/web/src/pages/SettingsPage.tsx`               |          1059 | Legacy grouped settings controller and views                     | Web settings     | Split existing settings sections after settings goldens pass                                |
| `packages/shared/src/keyboard-layout.ts`            |           975 | Keyboard data, presets, and parsing share one file               | Shared keyboard  | Split data, presets, parsing, and mapping after mapping goldens pass                        |
| `packages/shared/src/training-simulation.ts`        |           905 | Simulation model, replay, and report share one file              | Shared training  | Split by simulation responsibility after scheduler goldens pass                             |
| `docs/progress-log.md`                              |           881 | V1 append-only project history                                   | Documentation    | Replace with a short index and archived phase files during Gate 6                           |
| `apps/web/src/pages/TrainPage.tsx`                  |           855 | Legacy mode selection and configuration view                     | Web training     | Split existing mode sections after route goldens pass                                       |
| `scripts/start-local.mjs`                           |           763 | Legacy launcher coordinator                                      | Local runtime    | Split environment, dependency, build, server, and browser steps after launcher goldens pass |
| `packages/shared/src/training-engine.ts`            |           674 | Scoring, scheduling, and text choice share one file              | Shared training  | Split after lesson and adaptive goldens pass                                                |
| `apps/server/src/domain/experiment-analysis.ts`     |           584 | Combined experiment calculations                                 | Server domain    | Split by metric family after history goldens pass                                           |
| `apps/web/src/components/TypingSurface.tsx`         |           536 | Input controller, timing, scroll, audio, and view share one file | Web typing       | Split only after input goldens and V1 hot-path traces exist                                 |
| `apps/server/src/domain/session-analysis.ts`        |           528 | Combined session summary analyses                                | Server domain    | Split by analysis family after session goldens pass                                         |
| `apps/server/test/api-contract.integration.test.ts` |           515 | Combined API contract suite                                      | Server tests     | Split by route group after the literal manifest test exists                                 |
| `packages/content/src/pineapple-breach.ts`          |           513 | Game data and selection logic share one file                     | Content          | Split immutable data from logic after game goldens pass                                     |
| `tests/e2e/game.spec.ts`                            |           502 | Complete game acceptance matrix                                  | E2E tests        | Split success, failure, and pause flows after Gate 1                                        |
| `packages/shared/src/error-classification.ts`       |           481 | Alignment and behavioral classification share one file           | Shared analysis  | Split after fixed classification goldens pass                                               |
| `apps/web/src/pages/AnalyticsPage.test.tsx`         |           420 | Combined analytics component suite                               | Web tests        | Split by visible analytics section during page split                                        |
| `tests/e2e/core-input-sound-navigation.spec.ts`     |           402 | Input, sound, and navigation flows share one file                | E2E tests        | Split by behavior domain after Gate 1                                                       |
| `packages/shared/src/persisted-json.ts`             |           342 | Multiple persisted schema families share one file                | Shared data      | Split by stored entity after restore goldens pass                                           |
| `packages/content/src/words.ts`                     |           336 | Corpus data and word-selection logic share one file              | Content          | Separate pure corpus data before any corpus exclusion                                       |
| `packages/shared/src/game-state.ts`                 |           314 | Game rules exceed the production hard limit                      | Shared game      | Split state transitions and scoring after game goldens pass                                 |
| `apps/web/src/pages/TodayPage.tsx`                  |           307 | Dashboard controller and sections share one file                 | Web Today        | Extract existing sections after dashboard goldens pass                                      |
| `apps/web/src/pages/OnboardingPage.tsx`             |           306 | Onboarding controller and steps share one file                   | Web onboarding   | Extract steps after onboarding regression passes                                            |
| `apps/web/src/pages/TestsPage.tsx`                  |           253 | Test selection, results, and personal records share one page     | Web tests UI     | Extract existing sections after test-history goldens pass                                   |

## Target-only files

Ten additional files exceed a target but not a hard limit. The checker must warn on these files and
must reject growth. They do not receive a hard-limit exception.

`tests/e2e/persistence-restart-cross-browser.spec.ts`, `tests/e2e/analytics-settings.spec.ts`,
`packages/shared/src/runtime-api.test.ts`, `apps/server/test/event-ingest-integrity.test.ts`,
`apps/server/test/backup-migration.test.ts`, `packages/shared/src/training-engine.test.ts`,
`tests/e2e/modes-input.spec.ts`, `packages/content/src/practice.ts`,
`apps/server/src/domain/statistics-analysis.ts`, and `apps/web/src/hooks/usePersistentEvents.ts` are
in this group.
