# SymType 2.1 macOS Performance Methodology

**Status:** Required release method; measurements pending a packaged clean commit
**Comparison unit:** the same full Git commit under Node.js 24.18.0 arm64

## Evidence set

Store raw, reviewable JSON without personal content:

```text
reports/performance/macos/source-baseline.json
reports/performance/macos/packaged-app.json
reports/performance/macos/evaluation.json
```

Both input documents use schema version 1 and record:

- `kind`: `source-baseline` or `packaged-app`;
- the same 40-character `commitSha`;
- `nodeVersion: "24.18.0"`, `nodeAbi: "137"`, `architecture: "arm64"`, and
  `minimumMacOS: "15.0"`;
- machine model, physical memory, macOS build, power state, thermal state, and measurement time;
- fixture ID, fixture SHA-256, schema version, integrity result, foreign-key result, and whether the
  daily backup already existed;
- raw sample arrays, not only a reported percentile.

The required metadata shape is:

```json
{
  "schemaVersion": 1,
  "kind": "packaged-app",
  "commitSha": "40 lowercase hexadecimal characters",
  "nodeVersion": "24.18.0",
  "nodeAbi": "137",
  "architecture": "arm64",
  "minimumMacOS": "15.0",
  "measuredAt": "2026-07-23T00:00:00.000Z",
  "environment": {
    "machineModel": "MacBookPro18,3",
    "physicalMemoryBytes": 34359738368,
    "macOSBuild": "24G90",
    "powerSource": "ac",
    "thermalState": "nominal"
  },
  "fixture": {
    "id": "symtype-100k-v1",
    "sha256": "64 lowercase hexadecimal characters",
    "schemaVersion": 10,
    "integrityOk": true,
    "foreignKeysOk": true,
    "dailyBackupCases": ["present", "absent-reset-each-sample"]
  },
  "run": {
    "installedPath": "/Applications/SymType.app",
    "offline": true,
    "systemNodeAvailable": false
  },
  "metrics": {}
}
```

`powerSource` is `ac` or `battery`; thermal state is `nominal`, `fair`, `serious`, or `critical`.
The source document uses `"kind": "source-baseline"` and `"run": {"mode":
"production-source"}`. The evaluator requires identical machine model, physical memory, macOS
build, fixture ID, fixture hash, and fixture schema across the pair.

Do not reuse the SymType 2.0 numbers as current evidence. The source baseline and installed app must
come from the exact Issue #5 release commit. Each latency/CPU distribution requires at least 20
samples. The evaluator uses a conventional median and nearest-rank p95/p99.

## Controlled runs

1. Build the clean source once with the pinned runtime. Create and validate the deterministic empty
   and 100k fixtures.
2. Measure the source control using the production server and Web build, not Vite development mode.
3. Create the DMG from the same commit, copy the app to `/Applications`, and disconnect network
   access. Ensure the test account has no system Node on `PATH`.
4. Separate first launch/Gatekeeper interaction from normal startup samples. Restart the whole app
   between cold samples; retain the same window for warm-reopen samples.
5. Measure the 100k same-day case with today's backup present. Measure first-daily-backup startup
   from a copied fixture without today's backup; reset the copy for every trial.
6. Persist a real 24-event batch. Verify the database count, IDs, and values after every trial.
7. Run the existing deterministic typing stream in WKWebView. Ignore IME composition and OS repeat
   exactly as the product does; report input-to-paint and any task at least 50 ms.
8. Run the 30-minute memory sample at a fixed route/workload. Report start/end renderer heap,
   server RSS, retained growth, idle CPU, and orphan-process count.
9. Record app/DMG byte sizes from the audited release output.

The evaluation command is:

```sh
npm run perf:macos:evaluate -- \
  --baseline reports/performance/macos/source-baseline.json \
  --packaged reports/performance/macos/packaged-app.json \
  --output reports/performance/macos/evaluation.json
```

It exits non-zero for missing metadata, commit mismatch, insufficient samples, a short memory run,
or any failed budget.

## Release budgets

| Metric                              |                  Required result |
| ----------------------------------- | -------------------------------: |
| Empty app launch to interactive p95 |                       ≤ 2,000 ms |
| 100k same-day startup p95           |                       ≤ 2,000 ms |
| 100k first-daily-backup startup p95 |                       ≤ 5,000 ms |
| Hidden-window warm reopen p95       |                         ≤ 300 ms |
| WebKit input-to-paint p95 / p99     |                     ≤ 30 / 50 ms |
| Real 24-event persistence p95 / p99 |                    ≤ 50 / 100 ms |
| Flush and next-block completion p95 |                         ≤ 200 ms |
| 100k all-time Analytics p95         | ≤ refreshed source baseline + 5% |
| 30-minute renderer heap growth      |               ≤ 15% and ≤ 20 MiB |
| 30-minute server RSS growth         |                         ≤ 20 MiB |
| Idle CPU median / p95               |                        ≤ 1% / 3% |
| App / DMG size                      |                  ≤ 200 / 120 MiB |

Use `os_signpost` and server timestamps to distinguish native launch, child spawn, database
initialization, automatic backup, first content paint, and interactivity. Store signpost exports or
Instruments summaries with the release evidence, but never record custom text, keystroke payloads,
database contents, credentials, or personal paths.

## Failure protocol

A miss does not authorize an architecture rewrite. Profile the failing phase, add a deterministic
regression, make one focused change, and repeat the same samples. Keep the change only when fixed
outputs remain identical and the measured failure improves. The known 100k Analytics query remains
an observation unless the refreshed packaged result exceeds its relative gate.
