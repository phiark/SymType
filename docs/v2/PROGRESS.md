# SymType 2.0 Progress Log

## 2026-07-22: Gate 0

### Contract setup

- Read the supplied SymType 2.0 prompt.
- Created the V2 scope, plan, decision log, requirements matrix, and release evidence files.
- Linked the V2 contract from `AGENTS.md` and `PLANS.md`.
- Searched the workspace, Desktop tree, and attachment tree for the official Issue 9 PDF.
- Asked the user for the local PDF path and kept Gate 6 blocked.

### Current-state protection

- Recorded that the repository has no commit and all files are untracked.
- Recorded Node.js runtime drift and selected installed Node.js 22.16.0.
- Rebuilt the native SQLite module for that supported runtime.
- Passed lint, strict type checks, 382 tests, one intentional skip, and four production builds.
- Passed 73 complete Chromium/WebKit E2E tests with one intentional skip.
- Passed the selected strengthened six-level game flow in both engines.
- Started the production no-open launcher on loopback.
- Verified schema version 10, algorithm version `adaptive-v1`, and database integrity.
- Verified the graceful shutdown log after `SIGINT`.

### Clean-copy evidence

- Copied source files to an isolated temporary directory without build or install output.
- Passed `npm ci --offline` from the lockfile.
- Installed 529 packages and reported zero audit vulnerabilities.
- Passed the clean production build.
- Confirmed four canonical workspace links and no stale ` 2` link.
- Loaded native SQLite 3.53.2 with Node.js 22.16.0.

### Audit results

- Found strong V1 behavior coverage but no literal-output golden suite.
- Found 46 public API contracts and 22 database tables that need literal manifests.
- Found 30 legacy hard file-size exceptions when the launcher is included.
- Found 220 trial function-rule violations.
- Found no dependency cycle and no cross-workspace deep import.
- Confirmed one dead runtime API shadow source and one unused direct Web dependency.
- Found that the current performance smoke tests do not meet the V2 baseline contract.

### Gate result

Gate 0 is complete. Gate 1 is active.

## 2026-07-22: Gate 1

### Shared behavior freeze

- Added literal seeded lesson and adaptive selection outputs.
- Added literal WPM, accuracy, and IKI outputs.
- Added literal keyboard parsing and Symmetric boundary outputs.
- Added the exact 46-entry runtime API manifest.
- Added literal game alert, score, timeout, reset, completion, personal-best, and achievement paths.

### Browser input freeze

- Added a fixed-clock canonical key sequence with all 29 emitted event fields.
- Added Shift, Caps Lock, digit, symbol, wrong-key, and whitespace events.
- Added exact progress, WPM, accuracy, and glyph-state results.
- Added character, disabled, and word Backspace policies.
- Added stop-on-error, continue, IME exclusion, and repeat exclusion results.

### Server data freeze

- Added the exact 22-table schema manifest and schema version 10.
- Added authoritative stored-event normalization and recovery results.
- Added a full non-default settings and active-layout reopen result.
- Added fixed-date dashboard, statistics, formal test, and personal-best results.
- Added Campaign, Hardcore, completion, and lower-run personal-best results.
- Added the 20-table JSON export manifest and restore-equivalence digest.

### Verification

- `npm run test:regression`: eight files and 22 tests passed.
- `npm run check`: 52 files, 404 tests passed, and one intentional test skipped.
- Lint, strict type checks, golden replay, and all four production builds passed.
- `npm run format:check` passed.
- All new golden files stayed below the 400-line hard limit.

### Gate result

Gate 1 is complete. Gate 2 is active.
