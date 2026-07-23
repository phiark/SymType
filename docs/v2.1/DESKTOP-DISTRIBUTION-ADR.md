# Decision: Native macOS Distribution for SymType 2.1

**Status:** Accepted for Issue #5
**Date:** 2026-07-23
**Decision owner:** SymType maintainers

## Context

SymType 2.0 deliberately excluded a desktop shell. That historical scope remains correct and is not
rewritten. SymType 2.1 introduces a distribution layer after 2.0 while preserving all browser
routes, API contracts, training behavior, and SQLite data semantics.

The compatibility boundary also preserves metric math: the existing integer `activeMs`
persistence/API field is rounded at that boundary only, while WPM continues to use the original
fractional measured duration.

The application must run offline on Apple Silicon without a system Node.js installation. SQLite in
the existing application-support directory remains authoritative; WebKit storage is only a cache.
The first distribution is for personal/internal testing and must not claim Developer ID signing or
Apple notarization.

## Decision

- Build an AppKit application containing one WKWebView and one supervised Fastify child process.
- Support arm64 and macOS 15.0 or later with bundle identifier `com.zerolab.symtype`.
- Embed the official Node.js 24.18.0 arm64 executable. The accepted archive is
  `node-v24.18.0-darwin-arm64.tar.xz` with SHA-256
  `4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6`.
- Package the built server, built Web client, internal packages, and only the installed production
  dependency closure under `Contents/Resources/app`. Runtime code never invokes npm or writes the
  application bundle.
- The native application always uses `~/Library/Application Support/SymType`. Browser/source
  launchers retain their existing `SYMTYPE_DATA_DIR` override; do not add a second desktop database
  or silently migrate/rebuild a failed database.
- Keep `start.command`, `start.sh`, `start.bat`, and the npm local launchers as supported fallback
  paths.

The bundle layout is fixed:

```text
SymType.app/
  Contents/
    MacOS/SymType
    Helpers/node
    Resources/
      app/
        package.json
        server/index.js
        server/package.json
        web/
        node_modules/
      licenses/
      release-manifest.json
```

The numeric release manifest schema is:

```json
{
  "schemaVersion": 1,
  "productVersion": "2.1.0",
  "buildNumber": 1,
  "commitSha": "40 lowercase hexadecimal characters",
  "architecture": "arm64",
  "minimumMacOS": "15.0",
  "nodeVersion": "24.18.0",
  "nodeAbi": 137,
  "resources": [
    {
      "path": "Helpers/node",
      "bytes": 0,
      "sha256": "64 lowercase hexadecimal characters"
    }
  ]
}
```

Every file below `Contents/Helpers` and `Contents/Resources`, except the manifest itself, is listed
with a byte count and hash. The shell validates critical resources before launching Node.

## Security and lifecycle consequences

- The service still binds to `127.0.0.1`; Host, Origin, CSRF, schema, and integrity checks remain
  server-owned.
- A random launch nonce and verified child PID tie the native shell to its own service. A compatible
  external service may be reused but is never killed; an incompatible owner is reported as a
  conflict.
- Before opening SQLite, each service atomically publishes a tokenized `server-runtime.lock`.
  Another live PID owning the same data directory is rejected without touching the database.
  Stale recovery and release first move the lock to a private path, then validate its PID/token
  record before deleting it.
- `Cmd-W` hides the single retained window. Its save acknowledgement has a five-second bound, and a
  stale callback cannot hide a replacement WebView.
- `Cmd-Q` reveals a hidden window and uses the typed Web lifecycle bridge. Time spent in the
  existing user confirmation has no fixed deadline; renderer liveness and the subsequent local
  flush remain bounded. After confirmation the shell requests graceful child shutdown. If Node has
  not exited within ten seconds, the user may retry or cancel; the app never silently sends
  `SIGKILL`.
- Recovery prompts, replacement startup, and termination are serialized. Cancelling termination
  resumes a deferred crash recovery; confirming termination rechecks process ownership and always
  follows the same owned-server shutdown path.
- A parent-watch pipe prevents an orphan service after a native crash. If the owned Node process
  stops unexpectedly, the shell clears only that dead child, offers an explicit service restart,
  validates the replacement before reloading WebKit, and warns that input not yet acknowledged by
  SQLite may need to be retyped.
- Main-frame navigation is limited to the verified loopback origin. User-initiated HTTPS links open
  in the default browser; other external navigation and popups are rejected.
- Import and export continue through the existing API validation and backup paths. Native open/save
  panels grant a destination; they do not parse or mutate user content.

## Packaging consequences

`scripts/macos/build-release.mjs` packages only a clean committed HEAD. It performs an isolated
`npm ci`, the complete `npm run check` gate (including the production build), and then a production
prune with the embedded Node first on `PATH`. It rebuilds
`better-sqlite3` against the embedded headers, then proves that it loads under ABI 137.
`MACOSX_DEPLOYMENT_TARGET=15.0` is explicit for both the addon and native shell.

Source maps, development dependencies, tests, examples, documentation caches, and local build
paths are excluded. Every Mach-O must be arm64-only, link only through system or bundle-relative
paths, and declare a minimum macOS version no newer than 15.0. The licenses directory contains the
project and Node licenses, dependency license files, a deterministic production-package inventory,
and an SPDX 2.3 SBOM tied to the release commit.

Internal artifacts are signed ad hoc from the inside out and verified with `codesign`. The UDZO DMG
contains only `SymType.app` and an `/Applications` symlink, is checked with `hdiutil verify`, and has
a separate SHA-256 file. The read-only mounted copy is independently checked against its release
manifest and with `codesign --verify --deep --strict` before that checksum is emitted.

Public distribution is a later decision requiring Developer ID Application signing, Hardened
Runtime, timestamping, `notarytool`, and stapling. Internal users may need Finder's **Open**
confirmation for a quarantined build; documentation must not recommend disabling Gatekeeper or
removing quarantine attributes globally.

## Rejected alternatives

- Electron duplicates Chromium and Node, increasing memory and artifact size without product value.
- Tauri or a Node single-executable application adds another runtime/toolchain or an immature
  packaging constraint without removing the need for the native WebKit lifecycle.
- Copying the developer's `node_modules`, a system Node executable, or existing `dist` directories
  is non-reproducible and may embed the wrong SQLite ABI.
- Changing SQLite pragmas, adding workers/caches, or rewriting analytics during packaging is
  speculative. Performance work requires a measured failure and before/after evidence.
