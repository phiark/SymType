# SymType 2.0 Minimal Performance Baseline

**State:** Complete
**Last update:** 2026-07-22

## Release question

The baseline answers one bounded question: does SymType remain usable for a local single user with
an empty database and with 100,000 persisted events? It is not a general performance laboratory.

## Required scope

- empty database startup and health;
- deterministic 100,000-event practice/test/game mixture;
- Today/dashboard, settings, all-time statistics, event save, lesson generation, and completion
  smoke;
- the event-loop histogram from the actual built Fastify child process;
- Chromium and WebKit typing input, paint, persistence, and audio scheduling;
- production bundle size and remote-asset scan;
- environment, commands, cache limitations, raw samples, median, p95, and p99 where applicable.

The 1,000,000-event run, 30-minute memory run, exhaustive route benchmarks, and broad query-plan
archive are Optional. They do not block this release.

## Reproduction

Use Node.js 22.16.0 and the current production build:

```sh
npm run perf:fixtures
npm run perf:startup
npm run perf:database
npm run perf:server
npm run perf:bundle
npm run perf:client
npm run perf:baseline:assemble
```

The commands write five fragments under `reports/performance/fragments/` and atomically assemble
`reports/performance/v1-baseline.json`.

## Measurement validity

- The fixture seed, UTC timestamp, time zone, profile, schema, and content mix are fixed.
- Every fixture is checked with SQLite integrity, foreign-key, event-linkage, batch, and summary
  counts plus SHA-256.
- Populated statistics use `period=all`; the 100k observation must report exactly 100,000
  characters. This prevents a fixed-date fixture from being mistaken for an empty 7-day window.
- The Fastify server starts as a child with a preload monitor. Event-loop reset and snapshot travel
  over IPC, so the measurement cannot accidentally describe the runner parent.
- HTTP and database samples are warm after explicit untimed requests. OS page cache is not
  controlled and is disclosed in every fragment.
- The short client run is the release hot-path baseline. Its two load samples are smoke evidence,
  not a basis for micro-optimization; the hundreds of typing events are the latency evidence.

## Environment

- Apple M3 Pro, 11 logical cores, 18 GiB memory;
- macOS/Darwin arm64;
- Node.js 22.16.0, npm 10.9.2;
- SQLite 3.53.2;
- Playwright Chromium 149 and WebKit 26.5 for the final client fragment.

The active Homebrew Node.js 25 installation is unsupported and is not a release environment.

## Honest limits

This is one local machine and a synthetic deterministic data set. It establishes repeatability and
detects obvious release-level stalls. It does not claim universal hardware performance or prove
that every future database size is fast.
