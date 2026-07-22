# SymType 2.0 Scope

**Status:** Active contract
**Date:** 2026-07-22
**Upgrade prompt SHA-256:** `e64eaee6d4a1f306b8afdc5fb12c3b8a695e966ea04ae2945e860978484266d9`

## Purpose

SymType 2.0 is a convergence release. It improves measured performance, the existing interface,
and maintenance quality. It does not add a user feature.

## Normative repository sources

- `docs/product-spec.md` is the available V1 product contract.
- `docs/requirements-matrix.md` is the V1 traceability record.
- `docs/architecture.md`, `docs/data-model.md`, and `docs/training-engine.md` define V1 design rules.
- `AGENTS.md` defines durable repository rules.
- `PLANS.md` and `docs/progress-log.md` record the V1 delivery state.
- The supplied SymType 2.0 prompt defines this release contract.

`Codex-Prompt-SymType.md` is not present. The V2 work does not replace or weaken the available V1
contract.

## Allowed work

- Measure and optimize startup, route load, React render work, and the typing event path.
- Measure and optimize Fastify work, SQLite reads, and safe event batches.
- Remove confirmed dead code and unused dependencies.
- Converge existing visual tokens, layouts, components, and interaction states.
- Refactor code to meet module, file-size, complexity, and dependency rules.
- Add tests, audit scripts, deterministic fixtures, and release evidence.
- Correct a confirmed defect after a regression test records the old defect.
- Update first-party technical documents.

## Prohibited work

- Do not add or remove a user function.
- Do not add a page, route, mode, metric, setting, shortcut, sound, chart, or game rule.
- Do not change the key map, training algorithm, weights, unlock rules, lesson rules, or scores.
- Do not change WPM, accuracy, consistency, timer, or statistic definitions.
- Do not change game state rules.
- Do not reduce precision or test scope to meet a budget.
- Do not move authoritative data out of the local SQLite service.
- Do not add login, sync, telemetry, cloud services, advertisements, Docker, or a desktop shell.
- Do not replace the core React, Vite, Fastify, SQLite, Node.js, or TypeScript architecture.
- Do not update dependencies broadly without a measured need.
- Do not push a commit or create a pull request without user approval.

## V1 browser routes

| Route            | Existing surface                          | Contract state |
| ---------------- | ----------------------------------------- | -------------- |
| `/`              | Today and onboarding entry                | Preserve       |
| `/train`         | Training mode selection                   | Preserve       |
| `/train/session` | Practice and calibration session          | Preserve       |
| `/test`          | Timed test selection and personal records | Preserve       |
| `/test/session`  | Formal timed test                         | Preserve       |
| `/game`          | Pineapple Breach campaign and progress    | Preserve       |
| `/game/play`     | Active Pineapple Breach level             | Preserve       |
| `/analytics`     | Personal statistics and filters           | Preserve       |
| `/settings/*`    | Grouped settings and data tools           | Preserve       |

Unknown browser routes continue to redirect to `/`.

## V1 modes

The release preserves these training modes:

1. Smart course.
2. Traditional zones.
3. Weakness rescue.
4. Common English.
5. Pseudowords.
6. Numbers and data entry.
7. Punctuation and symbols.
8. Case and Shift.
9. Source code.
10. Custom text.
11. Books and long text.
12. Timed tests.

The release preserves the six Pineapple Breach levels. It also preserves Standard, Hard, and
Adaptive difficulty. Campaign and Hardcore reset rules do not change.

## V1 dialogs and user states

The release preserves onboarding, calibration, session exit confirmation, restore preview and
confirmation, unsupported import errors, disconnected states, empty analytics, populated analytics,
loading states, saving states, pause, focus loss, session recovery, completion, game failure, and
game success.

## V1 setting groups

The release preserves theme, motion, sound, typing behavior, typing presentation, virtual keyboard,
mapping, goals, adaptive controls, experiment controls, data export, backup, restore, and diagnostics.
Server settings remain authoritative.

## V1 API contract

The shared runtime registry defines the public `/api/v1` contract. The release preserves health,
bootstrap, profile, settings, preferences, layouts, sessions, events, lessons, dashboard,
statistics, goals, traditional progress, tests, game, custom text, export, backup, import, and
diagnostic operations.

The registry in `packages/shared/src/runtime-api.ts` is the route inventory. Golden and integration
tests must detect a removed route or a changed response contract.

## V1 database contract

The release preserves these tables and their business meaning:

- `schema_migrations`
- `profiles`
- `settings`
- `keyboard_layouts`
- `key_mappings`
- `sessions`
- `lessons`
- `micro_blocks`
- `event_batches`
- `keystroke_events`
- `feature_stats`
- `daily_summaries`
- `goals`
- `streaks`
- `tests`
- `personal_bests`
- `game_runs`
- `game_levels`
- `achievements`
- `content_sources`
- `custom_texts`
- `backups`

No V2 work can alter stored business results. Test migrations on a copy. Make a safety backup before
an additive production migration.

## Startup and data contract

The release preserves `start.command`, `start.bat`, `start.sh`, `npm run start:local`, and
`npm run start:local:no-open`.

The service binds to `127.0.0.1`. The operating-system application data directory remains the
default. `SYMTYPE_DATA_DIR` remains the supported override. Browser storage is not authoritative.

## Golden behavior contract

Gate 1 must record fixed outputs for seeded lesson generation, adaptive selection, event conversion,
metrics, keyboard modifiers, Backspace policies, recovery, settings, history, game rules, export,
and restore. A large refactor cannot start before these tests pass.

## Evidence rule

Every change batch must record a measurement, a confirmed cause, a focused change, behavior tests,
a related performance test, and a keep-or-revert result in `docs/v2/V2-PLAN.md`.
