# SymType 2.0 Architecture Audit

**State:** Bounded release cleanup complete; broad remediation cancelled
**Last update:** 2026-07-22

## Scope

This audit covers module boundaries, dependency direction, file size, function size, complexity,
type escapes, dead sources, and unused dependencies.

## Required boundaries

- React code can call the typed API client. It cannot contain database or training rules.
- Fastify routes can validate and coordinate work. They cannot contain database query details.
- Database code cannot import React or UI concepts.
- Shared domain logic must be deterministic and independent of browser and database adapters.
- Feature code cannot use a deep internal import across a package boundary.
- The package graph cannot contain a cycle.

## Baseline observations

- TypeScript strict mode is enabled.
- The repository uses npm workspaces for the Web app, server, shared logic, and content.
- The worktree contains names that can indicate stale duplicate sources, such as a ` 2` suffix.
- Large legacy files require measured logical-line counts before a split plan.
- The browser router has nine named V1 paths and one catch-all redirect.
- The shared API registry contains 44 JSON contracts and two binary contracts.
- The schema contains 22 application tables, including `schema_migrations`.
- The obsolete `packages/shared/src/runtime-api 2.ts` shadow source was confirmed and removed after
  the API manifest goldens passed.

These observations are not release findings. Gate 5 will add exact paths, counts, and verification.

## Audit results

The logical-line scan found 29 hard-limit violations and 10 target-only violations in the standard
TypeScript, CSS, test, and Markdown categories. The production launcher adds one JavaScript legacy
exception. `docs/v2/FILE-SIZE-EXCEPTIONS.md` records each hard exception.

A trial of the required function rules found 220 violations in 73 files:

- 86 complexity violations.
- 131 function-size violations.
- Three parameter-count violations.

The highest complexity values are 94 in `GamePage`, 93 in `PracticePage`, 66 in the event-ingest
transaction, and 61 in the typing keyboard callback.

The dependency scan found 126 first-party code files and 263 internal edges. It found no module
cycle, no workspace cycle, and no cross-workspace deep import.

Strict TypeScript is active. The scan found no explicit `any`, `@ts-ignore`, `@ts-nocheck`, or
ESLint disable directive. It found one production `as unknown as` in the Vite configuration and four
production non-null assertions in error classification.

`packages/content/tsconfig.json` does not extend the root base configuration. This creates compiler
option drift.

## Confirmed maintenance findings

### A-001: Dead runtime API shadow source — closed

`packages/shared/src/runtime-api 2.ts` has no import. It differs from the current registry. The
shared build compiles it to duplicate output with a space in the file name.

Gate 1 froze the 46-route API manifest. The shadow source was removed; final API goldens and the
clean build provide closure evidence.

### A-002: One direct Web dependency is unused — closed

`@radix-ui/react-tabs` had no source, test, or configuration import. It was removed from the Web
manifest and lockfile after Gate 1. The final install/build/E2E replay provides closure evidence.

### A-003: Scope rules have two implementations

Server scope rules in `apps/server/src/app.ts` and browser scope rules in
`apps/web/src/keyboard.ts` differ in labels, aliases, and the `index` special case. This is a drift
risk. Freeze current outputs before a shared pure-function refactor.

### A-004: The installation tree has stale workspace links

The current `node_modules/@symtype` directory has four extraneous links with a ` 2` suffix. They are
not in the lockfile. Validate their removal in a clean `npm ci` copy. Do not change business code for
this installation-tree issue.

## Audit actions

- [x] Record production and test logical-line outliers.
- [x] Record functions above the hard limit.
- [x] Record complexity and parameter violations.
- [x] Record dependency cycles and deep internal imports.
- [x] Record `any`, `ts-ignore`, and non-null assertion use.
- [x] Confirm duplicate and dead sources with import and test evidence.
- [x] Record unused dependencies with build and runtime evidence.
- [x] Cancel broad legacy splitting unless a release defect requires a focused change.

## Findings

Findings A-001 and A-002 are closed. A-003 remains Optional and A-004 was absent in the isolated
clean install. No large split is authorized for this release.

## Remediation order

1. Keep the existing cycle, deep-import, strict-type, and public-contract checks.
2. Reopen a legacy split only for a reproducible user or data-safety defect.
3. Do not add a maintenance platform during release convergence.

## Contract-freeze risk

The API contract test detects drift between Fastify and the shared registry. It does not detect the
same route removal from both places. Gate 1 must freeze the literal 46-entry manifest.

Migration tests protect historical data behavior. They do not freeze the complete table manifest.
Gate 1 must freeze the 22 table names before a database refactor.
