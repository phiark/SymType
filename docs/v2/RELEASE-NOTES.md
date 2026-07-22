# SymType 2.0 Release Notes

**State:** Release candidate; not tagged or merged
**Last update:** 2026-07-22

## Product

SymType 2.0 is the first GitHub release candidate for the complete local-first trainer. It preserves
the V1 product contract: Symmetric/Standard/custom ANSI mappings, calibration, Today plans, twelve
training modes, timed tests, actionable analytics, local audio, safe import/export/backup/restore,
and all six Pineapple Breach levels.

The convergence work adds no user feature and changes no fixed lesson, metric, event, keyboard,
history, or game result.

## Release engineering

- Packages are versioned `2.0.0`.
- Literal V1 outputs are frozen by 22 golden tests.
- A deterministic empty/100k performance baseline covers the actual Fastify child, Chromium,
  WebKit, SQLite operations, and production bundle.
- The 100k Today → five-micro-block completion → populated Analytics smoke passed without changing
  the source fixture.
- The obsolete runtime API shadow source and unused Radix Tabs dependency were removed.
- Typing-surface transient callbacks are cancelled on unmount, preventing late visual or
  completion updates after the training view closes.
- Contribution rules, Issue/PR templates, CI, changelog, and the Issue #1 branch workflow are stored
  in the repository.
- GitHub Actions run 29904308912 passed the clean Linux install, formatting, lint, typecheck, tests,
  and build after the workspace-entry-point repair.

## Compatibility and data

- Supported runtime remains Node.js 22 LTS or 24 LTS; the release machine uses Node.js 22.16.0.
- SQLite schema remains version 10. No destructive migration was added.
- Existing settings, history, lessons, tests, game progress, imported content, and backups retain
  their V1 meaning.
- Browser storage remains non-authoritative; clearing or changing browsers does not remove SQLite
  history.

## Performance

The 100k all-time statistics request is visible at about 0.91 seconds p95 and briefly blocks the
single local server while it aggregates. Today, event saves, next-block generation, and typing are
fast. This is accepted for the local single-user release; no architecture rewrite is justified.

See `docs/v2/PERFORMANCE-RESULTS.md` for the complete bounded evidence and honest limits.

## External acceptance still required before merge/tag

- Complete GitHub sudo-mode confirmation and save the prepared `main` protection rule.
- Obtain one approval from a distinct GitHub reviewer; the author cannot approve the author's PR.

The official ASD-STE100 Issue 9 PDF is unavailable. Formal normative STE review remains externally
Blocked; the minimum user action is to provide the official PDF as a readable local file path. The
eight requested Keybr screenshots are also absent, so their clean-room functional inventory remains
Blocked without affecting independently specified product behavior.
