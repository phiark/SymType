# Changelog

This file records user-visible changes only after they have passed acceptance and entered `main`.
Changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories, and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) where the project version applies.

## [Unreleased]

### Added

- First complete local-first SymType release candidate: onboarding, twelve training modes, timed
  tests, SQLite-backed analytics and backup/restore, and the six-level Pineapple Breach game.
- Reproducible empty/100k release baseline for startup, common product operations, browser typing,
  the real Fastify child event loop, and bundle size.
- Durable Issue, numbered branch, Pull Request, CI, review, and squash-merge workflow.

### Changed

- Package and workspace versions are prepared as `2.0.0`.
- V2 release work is explicitly classified as Release Blocker, Required, Optional, or Cancelled so
  unproven optimization and maintenance-platform work cannot delay product acceptance.

### Fixed

- Migrations now create and verify a private pre-migration SQLite snapshot before changing an
  existing database, including the standalone migration path.
- The canonical `TypingSurface` and server summary/projection paths now use the shared WPM contract;
  net WPM penalizes only final uncorrected errors, including short timed tests and read-only
  projections of legacy history.
- A trailing Backspace can now remove a corrected final-position error when a session is completed
  or explicitly saved, without inventing a persisted keystroke event.
- Custom text now normalizes line endings and rejects unsupported non-ANSI-US characters before
  persistence while leaving historical imported content unchanged.
- Delayed out-of-order event batches now rebuild only their affected feature models from the same
  profile's canonical session/event order, so receive order cannot change learned statistics.
- Populated performance statistics now measure the all-time 100k fixture instead of an empty fixed
  date/7-day mismatch.
- Fastify event-loop evidence is collected from the actual server child process rather than the
  benchmark runner.
- Removed an obsolete duplicate runtime API source and the unused Radix Tabs dependency without
  changing the frozen 46-route API contract.

This section remains Unreleased until the linked Pull Request has passing CI, an independent
approval, and is merged to `main`.
