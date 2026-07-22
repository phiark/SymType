# SymType 2.0 Performance Results

**State:** Minimal Gate 2 baseline accepted
**Last update:** 2026-07-22
**Raw evidence:** `reports/performance/v1-baseline.json`

## Result

Gate 2 is Done. The baseline is repeatable, the populated query window is correct, the Fastify
child is the measured process, and no release-level performance blocker was found at 100,000
events. No optimization is authorized by the current evidence.

| Surface                        | Sample/result |   Median |      p95 |      p99 | Assessment      |
| ------------------------------ | ------------: | -------: | -------: | -------: | --------------- |
| Empty health readiness         |            20 |   240 ms |   315 ms |   331 ms | Pass            |
| Launcher application work      |            20 |   869 ms | 1,200 ms | 1,201 ms | Pass            |
| Empty dashboard                |            20 |  0.09 ms |  0.15 ms |  0.16 ms | Pass            |
| 100k dashboard                 |            20 |  0.12 ms |  0.23 ms |  0.28 ms | Pass            |
| 100k all-time statistics       |            20 |   757 ms |   911 ms | 1,202 ms | Usable; observe |
| SQLite hot query               |            20 | 25.27 ms | 29.20 ms | 36.24 ms | Pass            |
| Server event saves             |            40 |  1.13 ms |  2.31 ms |  4.46 ms | Pass            |
| Next micro-block               |            20 |  2.33 ms |  2.77 ms |  2.88 ms | Pass            |
| Typing handler                 |           203 |  0.10 ms |  0.20 ms |  1.19 ms | Pass            |
| Chromium/WebKit input to paint |           406 |   4.0 ms |  15.0 ms | 16.95 ms | Pass            |
| Browser event persistence      |     141 exact |        — |        — |        — | Pass            |
| Long task during typing        |             0 |        — |        — |        — | Pass            |
| Key-to-audio schedule          |           282 |  0.10 ms |   1.0 ms |  1.90 ms | Pass            |

## 100k product smoke

The user-visible 100,000-event smoke passed on the production server and Chromium local profile.
The server used an isolated trial copy; the source fixture SHA-256 remained
`434253c1e5dcd4a1d8a8bb252745711e6abe6c10a06d0780072658f583e62093` before and after the run.

| Evidence          | Result                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Environment       | macOS arm64, Node.js 22.16.0, Chromium 149.0.7827.55                                                              |
| Fixture           | 100 sessions, 100,000 events, 4,200 errors                                                                        |
| Today             | Fixture-backed recommendation rendered in 992 ms                                                                  |
| Course            | Five real micro-blocks completed and 248 events persisted in 808 ms of automation wall time                       |
| Analytics         | “All” returned 100,248 events; overview, heatmap, confusion, groups, and three feature views rendered in 1,986 ms |
| Direct API checks | Dashboard 3–5 ms; `statistics?period=all` 819–838 ms                                                              |
| Complete smoke    | 6,445 ms inside the test; Playwright reported one pass in 9.3 s                                                   |

Command:

```sh
SYMTYPE_PERF_FIXTURE_PATH=.symtype-perf-data/fixtures/100k.sqlite3 \
SYMTYPE_PERF_OBSERVATION_DIR=reports/performance/fragments \
SYMTYPE_PERF_RUN_ID=100k-product-smoke \
npm exec playwright -- test --config=playwright.performance.config.ts \
  --project=chromium-local tests/performance/100k-product-smoke.spec.ts
```

Raw observation: `reports/performance/fragments/chromium-local.100k-product-smoke.json`. This is a
repeatable product smoke, not a statistically sampled latency claim. It found no release-blocking
stall in Today, course completion, or the common populated Analytics path.

## Bundle inventory

| Item                     |     Result | Assessment             |
| ------------------------ | ---------: | ---------------------- |
| Practice JavaScript gzip | 165.95 KiB | Pass                   |
| Practice CSS gzip        |  11.66 KiB | Pass                   |
| Largest lazy chunk gzip  | 100.52 KiB | Pass                   |
| Local identity transfer  | 585.57 KiB | Optional investigation |
| Remote fonts/requests    |          0 | Pass                   |

The local server sends identity-encoded static files. Loopback transfer is not a release blocker,
and changing the serving stack only to improve that number is not justified. Production source
maps and Today chart loading are recorded as Optional cleanup, not hidden as passes.

## Event-loop interpretation

The child-process histogram reaches p99 1.14 seconds while the synchronous all-time statistics
request scans and aggregates 100,000 events. This is the same visible cost as the 0.91-second HTTP
p95, not an unrelated parent-process error. Typing, event saves, dashboard, and lesson generation
remain fast. Optimize this query only if repeated real use shows unacceptable delay and a focused
change preserves all V1 golden outputs.

## Nonblocking evidence

An eight-second Chromium memory smoke passed with about 1.84% retained-heap growth and no route
retention signal. It is not presented as a 30-minute stability result. The 1m fixture support and
query plans may remain for diagnosis, but neither is a release gate.
