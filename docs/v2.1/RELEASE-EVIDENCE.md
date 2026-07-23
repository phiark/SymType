# SymType 2.1 Release Evidence

**Candidate:** 2.1.0 build 1
**Issue:** #5
**State:** Automated internal DMG candidate verified; clean-host, formal performance, and approval
gates remain pending

## Immutable candidate identity

| Field                | Required value                                                     | Recorded value                                  |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Full commit          | 40-character release commit                                        | Final PR-head workflow artifact and PR evidence |
| Node                 | 24.18.0 / ABI 137 / arm64                                          | Verified by package audit                       |
| macOS minimum        | 15.0                                                               | Verified by plist and Mach-O audit              |
| Bundle ID            | `com.zerolab.symtype`                                              | Verified by plist and native tests              |
| Node archive SHA-256 | `4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6` | Verified before extraction                      |
| DMG SHA-256          | generated `.sha256` value                                          | Final PR-head workflow artifact and PR evidence |

Commit, DMG, and artifact digests are intentionally recorded in Pull Request #6 and its final-head
Actions artifact rather than hard-coded here: changing this ledger changes the commit and therefore
the manifest and DMG digest.

## Build and automated checks

Use a clean Issue branch commit:

```sh
npm ci
npm run macos:validate -- --require-toolchain
npm run format:check
npm run check
npm run test:regression
npm run macos:test
npm run macos:icon
xcodebuild test \
  -project apps/macos/SymType.xcodeproj \
  -scheme SymType \
  -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/SymTypeTests \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=YES \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY=- \
  DEVELOPMENT_TEAM= \
  ONLY_ACTIVE_ARCH=YES \
  ARCHS=arm64 \
  MACOSX_DEPLOYMENT_TARGET=15.0
npm run test:e2e
npm run macos:package
```

| Check                                                      | Result   | Evidence                                  |
| ---------------------------------------------------------- | -------- | ----------------------------------------- |
| Structural macOS release validation                        | Verified | final-head macOS package run              |
| Formatting, lint, typecheck, unit/integration, four builds | Verified | final-head Node 22 and clean package runs |
| V1 fixed-output regression                                 | Verified | final-head Node 22 and clean package runs |
| Native unit and UI tests                                   | Verified | final-head Xcode/XCUITest result          |
| Chromium and WebKit E2E                                    | Verified | final-head Playwright result              |
| Clean archive/install/build/prune                          | Verified | final-head release log                    |
| Embedded Node/SQLite ABI load                              | Verified | final-head release audit                  |
| Manifest/hash/allowlist/Mach-O/dependency/signature audit  | Verified | final-head release result                 |
| DMG verify and size                                        | Verified | final-head release result                 |
| macOS 15 arm64 CI                                          | Verified | Pull Request #6 Actions runs              |

This development machine has Command Line Tools but not a complete active Xcode installation.
Local Xcode/XCUITest execution remains unavailable; the final-head macOS 15 arm64 CI job supplies
that automated evidence. Clean-user-host and interactive manual evidence are still separate gates.

## Performance evidence

| Evidence                                        | Result                               |
| ----------------------------------------------- | ------------------------------------ |
| Refreshed source baseline, same commit and Node | Pending                              |
| Installed packaged-app raw samples              | Pending                              |
| Evaluator result                                | Pending                              |
| Empty/100k startup gates                        | Pending                              |
| WebKit typing and 24-event persistence gates    | Pending                              |
| 30-minute heap/RSS/CPU gate                     | Pending                              |
| App/DMG size gate                               | Verified by final-head package audit |

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
- a second service targeting the same data directory fails before opening SQLite while the original
  owner remains healthy and its integrity/data remain unchanged;
- old database upgrade, WebKit data clearing, app deletion/reinstall, and fallback browser launcher
  with history preserved;
- icon review at 16, 32, 64, 128, 256, 512, and 1024 px;
- console/network inspection confirming no product error, remote request, account, telemetry, or
  cloud dependency.

## Approval

Do not mark this record Released until the Pull Request is current, every required CI job passes,
all conversations are resolved, one independent approval covers the latest push, and all Pending
release gates above have concrete evidence.
