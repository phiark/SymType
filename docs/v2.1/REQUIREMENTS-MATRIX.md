# SymType 2.1 Requirements Matrix

**Last update:** 2026-07-23
**Release:** 2.1.0 build 1
**Issue:** #5

`docs/v2/REQUIREMENTS-MATRIX.md` remains the historical V2 convergence record. This matrix adds
desktop-distribution requirements without changing a V1/V2 row.

| ID      | Requirement                                                         | Evidence                                          | Current state                       |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| M21-001 | Preserve every V1/V2 route, function, algorithm, and database table | V1 goldens, API manifest, Chromium/WebKit suites  | Required                            |
| M21-002 | Preserve browser launchers and application-support data location    | launcher smoke; upgrade/manual replay             | Required                            |
| M21-003 | AppKit + WKWebView shell; no Electron/Tauri/telemetry/cloud         | source and dependency audit                       | Implemented source; review pending  |
| M21-004 | Apple Silicon only, macOS 15+, `com.zerolab.symtype`                | plist, `lipo`, `otool` audit                      | Automated                           |
| M21-005 | Embed exact Node 24.18.0 archive and verify pinned SHA-256          | release script and manifest                       | Automated                           |
| M21-006 | Use Node 24 first on `PATH`; rebuild/load SQLite at ABI 137         | package log and runtime audit                     | Automated                           |
| M21-007 | Set deployment target 15.0 for Swift and SQLite addon               | build environment and Mach-O load-command audit   | Automated                           |
| M21-008 | Build from a clean committed archive with locked install            | release script log                                | Automated                           |
| M21-009 | Include only server/Web/internal packages/production closure        | allowlist and dependency inventory                | Automated                           |
| M21-010 | Exclude maps, dev/test/example/cache files and local paths          | bundle audit                                      | Automated                           |
| M21-011 | Fixed app layout; runtime never calls npm or writes bundle          | manifest/native tests/manual read-only run        | Required                            |
| M21-012 | Numeric manifest schema and complete resource hashes                | JS/Swift tests and package audit                  | Automated                           |
| M21-013 | All Mach-O arm64-only with system/bundle-relative dependencies      | `file`, `lipo`, `otool` audit                     | Automated                           |
| M21-014 | Ad-hoc inside-out signing and strict verification                   | `codesign --verify --deep --strict`               | Automated                           |
| M21-015 | UDZO DMG with only app and Applications link                        | mounted-volume inspection and `hdiutil verify`    | Automated/manual                    |
| M21-016 | App ≤ 200 MiB and DMG ≤ 120 MiB                                     | package audit and performance evaluator           | Automated                           |
| M21-017 | Bind verified loopback origin and retain Host/Origin/CSRF controls  | server/native integration tests                   | Required                            |
| M21-018 | Verify nonce, PID, build, schema, integrity before WebView load     | native/server protocol tests                      | Required                            |
| M21-019 | Single instance; never kill a compatible external service           | native lifecycle tests and manual conflict replay | Required                            |
| M21-020 | `Cmd-W` retains state; Dock activation reopens in ≤ 300 ms p95      | native test and packaged samples                  | Required                            |
| M21-021 | `Cmd-Q` flushes or cancels visibly; graceful stop, no silent kill   | bridge/native tests and 30-cycle replay           | Required                            |
| M21-022 | Parent-watch EOF prevents orphan Node after shell failure           | server/native test and process inspection         | Required                            |
| M21-023 | Exact-origin navigation; external HTTPS uses default browser        | navigation tests                                  | Required                            |
| M21-024 | Native import/export panels preserve server validation              | unit/UI/manual data replay                        | Required                            |
| M21-025 | Original icon remains legible from 16 through 1024 px               | ICNS generator and visual review                  | Generator automated; review pending |
| M21-026 | Same-commit source/DMG evidence, at least 20 raw samples            | performance JSON/evaluator                        | Pending package                     |
| M21-027 | Meet every startup, typing, persistence, memory, CPU, and size gate | evaluation JSON                                   | Pending package                     |
| M21-028 | Pass Node 22 quality, goldens, Chromium and WebKit                  | CI and release log                                | Pending final head                  |
| M21-029 | Pass macOS 15 arm64 Node 24 native/package job                      | GitHub Actions artifact                           | Pending final head                  |
| M21-030 | Clean macOS 15 offline install/upgrade/uninstall/data replay        | manual evidence                                   | Pending clean host                  |
| M21-031 | Internal build makes no Developer ID/notarization claim             | release notes/artifact inspection                 | Required                            |
| M21-032 | Issue, branch, PR, passing CI, approval, resolved conversations     | GitHub records                                    | Pending PR                          |
| M21-033 | Unexpected owned-Node exit offers an explicit, validated restart    | native source, UI test, and manual crash replay   | Implemented source; review pending  |

`Automated` means the repository contains an enforcing check; it does not mean the final release
artifact has already passed it. Only the linked release evidence may change a release requirement to
Verified.
