# SymType Engineering Guide

## Mission

Deliver a private, local-first ANSI US QWERTY typing trainer whose default finger zoning is
Symmetric. SQLite on the local server is the sole authority for settings, progress, events, game
state, and imported content. Never claim that browser events detect the user's physical finger.

SymType 2.0 is a convergence release. Do not add, remove, or redefine a V1 user function. Read
`docs/v2/V2-SCOPE.md`, `docs/v2/V2-PLAN.md`, and `docs/v2/REQUIREMENTS-MATRIX.md` before V2 work.

## Required delivery workflow

Read this file at the start of every task. `main` is the only stable branch: never develop on it,
commit product changes to it, force-push it, or merge work whose checks or review are incomplete.

Every product, test, documentation, refactor, or configuration change follows this sequence:

1. Create or confirm a GitHub Issue with reproducible context and acceptance criteria.
2. Update local `main` from `origin/main`, then create one issue-scoped branch named
   `feature/<issue>-slug`, `fix/<issue>-slug`, `hotfix/<issue>-slug`,
   `refactor/<issue>-slug`, `docs/<issue>-slug`, `test/<issue>-slug`, or
   `chore/<issue>-slug`.
3. Make the smallest complete change, keep commits atomic, and reference the Issue.
4. Run targeted checks while developing and the required quality gate before handoff.
5. Push the branch and open a Pull Request that links the Issue, records test evidence, risks, and
   rollback steps.
6. Merge only after CI passes, the branch is current, review conversations are resolved, and at
   least one approving review exists. Prefer squash merge, then delete the merged branch.

The sole bootstrap exception is an empty, file-free initialization commit on `main` when the remote
repository has no commit at all. It may not contain source, documentation, workflow, or configuration
files. Once that commit exists, every repository file must enter through the workflow above. See
`CONTRIBUTING.md` for the complete policy.

## Repository map

- `apps/web`: React/Vite client and accessible product UI.
- `apps/server`: Fastify API, local security boundary, SQLite repositories, migrations, backups.
- `packages/shared`: API schemas, physical keyboard data, deterministic metrics and training logic.
- `packages/content`: bundled original/public-domain training and fictional game content.
- `tests/e2e`: Chromium and WebKit end-to-end and visual checks.
- `docs`: product, architecture, algorithms, data safety, decisions, rubric, and traceability.
- `docs/v2`: the V2 scope, gated plan, audits, measurements, decisions, and release evidence.

## Commands

- `npm run dev`: watch all workspaces.
- `npm run start:local`: build/migrate/start the single local server, then open its verified URL.
- `npm run start:local:no-open`: same local lifecycle without opening a browser (automation/headless use).
- `npm run format:check`: verify formatting without modifying files.
- `npm run check`: lint, strict typecheck, unit/integration tests, production build.
- `npm run test:regression`: run the fixed-output V1 regression suite.
- `npm run test:e2e`: Chromium and WebKit acceptance tests.

## Code rules

- TypeScript strict; validate every API boundary with shared Zod schemas.
- Domain logic is deterministic and side-effect free. Any randomness accepts an explicit seed.
- SQL is parameterized, migrations are append-only, and related persistence happens in transactions.
- UI does not duplicate authoritative server state. TanStack Query owns server state.
- Record only keys typed inside the active training surface. Ignore IME composition and OS repeats.
- Render imported text as text, never HTML. Do not log custom content or event payloads.
- Batch keystrokes; never synchronously write SQLite on every key.
- Keep current visible micro-block stable. Adapt only after a block boundary.
- Avoid fake statistics, hidden disabled controls, remote assets, telemetry, and placeholder actions.
- Use system fonts and Lucide icons. Color must never be the sole signal.

## Design invariants

- Desktop first, functional at 1024 px without horizontal scrolling.
- 8 px spacing rhythm, readable typing measure, 44 px primary targets, visible focus rings.
- One restrained accent plus semantic colors; light, dark, system, and reduced-motion paths.
- Navigation is Today, Train, Test, Game, Analytics, Settings; hide distractions during typing.

## Data and security invariants

- Bind to `127.0.0.1`; validate Host and Origin; deny cross-origin mutation.
- Use a per-process CSRF value and same-origin custom header for mutations.
- WAL, foreign keys, busy timeout, bounded queues, idempotent event batches, graceful shutdown.
- Restore only after schema/content validation and an automatic backup of the current database.
- Never silently rebuild a failed database or migration.
- Game strings are conspicuously fictional: no real domains, IPs, commands, credentials, or BIP-39.

## Definition of done

An item is done only when implementation, automated verification, visual/manual evidence, docs, and
the requirement matrix agree. No unexplained pending items, key TODOs, dead controls, console errors,
or history loss across restart/browser reset. V2 requires fixed-output regression evidence and the
minimal empty/100k performance baseline. Optional scale/maintenance work cannot block release, and
the official STE review remains externally Blocked until its PDF is supplied. `npm run check` and
Chromium/WebKit E2E must pass. Repository delivery is not complete until the linked Pull Request has
passing CI, an approving review, resolved conversations, and recorded acceptance evidence.
