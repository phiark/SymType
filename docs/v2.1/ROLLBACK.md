# SymType 2.1 Rollback and Data Preservation

## Rollback boundary

The macOS app is a distribution layer. It does not add a migration, database table, training rule,
or public API route. Removing the app therefore does not require a data conversion.

## User rollback

1. Quit SymType with `Cmd-Q` and confirm that no owned SymType Node process remains.
2. Move `/Applications/SymType.app` to Trash.
3. Start the existing source distribution with `start.command`, `start.sh`, or
   `npm run start:local`.

Do not remove `~/Library/Application Support/SymType`; it contains the authoritative database and
backups. Clearing WKWebView/browser data must not remove history.

The internal ad-hoc build may trigger Finder's Open confirmation when quarantined. Do not work
around this by disabling Gatekeeper or broadly deleting quarantine attributes.

## Release rollback

- Withdraw the DMG and its checksum together; retain its full commit, manifest, CI logs, and failure
  evidence.
- Re-publish the last verified source launcher instructions. Do not silently substitute an older
  DMG under the same filename or checksum.
- Classify the failure before changing code: packaging/signature, embedded runtime/ABI, native
  lifecycle, server/data integrity, WebKit compatibility, or measured performance.
- Reproduce against a copy of the user's data. Never repair a failed migration by rebuilding the
  database, and never delete user data as part of app uninstall.
- A corrected binary uses a new monotonically increasing `CFBundleVersion`, matching manifest build
  number, new DMG checksum, new evidence, and the normal Issue/PR/review workflow.

If a future release introduces a database migration, this no-conversion rollback procedure no
longer applies; that release must define and test its own data rollback boundary.
