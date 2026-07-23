# SymType 2.1 Release Evidence

**Candidate:** 2.1.0 build 1
**Issue:** #5
**State:** Source implementation in progress; no DMG is accepted yet

## Immutable candidate identity

| Field                | Required value                                                     | Recorded value        |
| -------------------- | ------------------------------------------------------------------ | --------------------- |
| Full commit          | 40-character release commit                                        | Pending               |
| Node                 | 24.18.0 / ABI 137 / arm64                                          | Pending package audit |
| macOS minimum        | 15.0                                                               | Pending Mach-O audit  |
| Bundle ID            | `com.zerolab.symtype`                                              | Pending plist audit   |
| Node archive SHA-256 | `4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6` | Enforced by source    |
| DMG SHA-256          | generated `.sha256` value                                          | Pending               |

## Build and automated checks

Use a clean Issue branch commit:

```sh
npm ci
npm run macos:validate -- --require-toolchain
npm run format:check
npm run check
npm run test:regression
npm run macos:test
xcodebuild test \
  -project apps/macos/SymType.xcodeproj \
  -scheme SymType \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/SymTypeTests \
  CODE_SIGNING_ALLOWED=NO
npm run test:e2e
npm run macos:package
```

| Check                                                      | Result             | Evidence          |
| ---------------------------------------------------------- | ------------------ | ----------------- |
| Structural macOS release validation                        | Pending final head | command log       |
| Formatting, lint, typecheck, unit/integration, four builds | Pending final head | command log / CI  |
| V1 fixed-output regression                                 | Pending final head | command log / CI  |
| Native unit and UI tests                                   | Pending full Xcode | xcodebuild result |
| Chromium and WebKit E2E                                    | Pending final head | Playwright report |
| Clean archive/install/build/prune                          | Pending package    | release log       |
| Embedded Node/SQLite ABI load                              | Pending package    | release audit     |
| Manifest/hash/allowlist/Mach-O/dependency/signature audit  | Pending package    | release result    |
| DMG verify and size                                        | Pending package    | release result    |
| macOS 15 arm64 CI                                          | Pending PR head    | Actions run       |

This development machine currently has Command Line Tools but not a complete active Xcode
installation. Native Xcode build, XCUITest, signed app assembly, and DMG evidence remain blocked
locally until full Xcode is installed. This is an environment blocker, not passing evidence.

## Performance evidence

| Evidence                                        | Result  |
| ----------------------------------------------- | ------- |
| Refreshed source baseline, same commit and Node | Pending |
| Installed packaged-app raw samples              | Pending |
| Evaluator result                                | Pending |
| Empty/100k startup gates                        | Pending |
| WebKit typing and 24-event persistence gates    | Pending |
| 30-minute heap/RSS/CPU gate                     | Pending |
| App/DMG size gate                               | Pending |

Follow [PERFORMANCE-METHODOLOGY.md](PERFORMANCE-METHODOLOGY.md). Historical 2.0 measurements are
context only and must not populate these fields.

## Clean-host and manual evidence

Record machine/macOS build, exact candidate SHA, result, and evidence path for:

- DMG mount, drag to `/Applications`, Finder Open confirmation, and offline launch without system
  Node;
- app/data paths containing spaces and Chinese characters;
- all primary routes, keyboard focus, IME composition, audio, alerts, CSV/JSON/SQLite export, and
  JSON/SQLite restore preview/commit;
- `Cmd-W`, Dock reopen, active-session cancel/quit, pending sub-batch flush, and 30 start/quit cycles
  without orphan processes, locks, or WAL loss;
- unexpected owned-Node termination, explicit restart prompt, replacement handshake validation, and
  clear warning that unacknowledged input may require retyping;
- same-version service reuse and incompatible-service conflict without killing either owner;
- old database upgrade, WebKit data clearing, app deletion/reinstall, and fallback browser launcher
  with history preserved;
- icon review at 16, 32, 64, 128, 256, 512, and 1024 px;
- console/network inspection confirming no product error, remote request, account, telemetry, or
  cloud dependency.

## Approval

Do not mark this record Released until the Pull Request is current, every required CI job passes,
all conversations are resolved, one independent approval covers the latest push, and all Pending
release gates above have concrete evidence.
