# Local launcher contract

`scripts/start-local.mjs` is the single cross-platform coordinator. The three root wrappers only
resolve their own directory, invoke that coordinator, and keep an interactive error window visible.

## Supported runtime

- Node.js 22 LTS, version 22.12 or newer; or Node.js 24 LTS. The package engine range is
  `>=22.12 <23 || >=24 <25`.
- npm 10 or newer.
- `SYMTYPE_ALLOW_UNSUPPORTED_NODE=1` bypasses the Node check only for diagnostics. It does not make
  an unsupported ABI a release target and does not suppress install/build/runtime errors.

The 22.12 floor follows Vite's runtime requirement. The launcher never downloads or switches Node
on the user's behalf.

## State machine

1. Resolve the repository from `import.meta.url` and change to it. The caller's current directory is
   irrelevant.
2. Resolve/create the OS application-data and log directories.
3. Validate Node/npm, then validate any saved `server-info.json`. A reusable URL must use plain HTTP
   on loopback, belong to a live PID, name the SQLite file in this exact application-data directory,
   answer `/api/v1/health`, identify service `symtype`, and report a passing SQLite integrity check.
4. If no instance is healthy, take an ephemeral launcher lock. Concurrent launchers wait for and
   reuse the first healthy process rather than starting duplicate servers.
5. Hash `package-lock.json`. Run `npm ci --include=dev` on first launcher-managed use, a changed
   lockfile, an incomplete dependency directory, or an OS/CPU architecture change. A platform change
   needs a fresh locked install because npm may have selected platform-specific optional packages
   throughout the dependency tree. Explicitly including the local build toolchain keeps first launch
   correct even when the caller exports `NODE_ENV=production` or configures npm to omit dev
   dependencies. When the OS and architecture are unchanged and only the Node ABI changes, rebuild
   `better-sqlite3` without reinstalling the dependency tree. State lives under ignored `node_modules`.
6. Hash production source/config inputs and verify all required outputs, including the assets named
   by Vite's HTML entry. A successful build records a size/SHA-256 manifest for every file under the
   four production output directories, so a missing or modified lazy chunk, stylesheet, source map,
   or package output also forces a rebuild. Run the production build only when an output is absent,
   empty, internally incomplete, damaged, or the fingerprint is stale.
7. Run forward database migrations/integrity checking.
8. Start the built server as a managed child with stdout/stderr appended to the app-data log. The
   server asks for the configured preferred port and falls back to an OS-selected port on collision.
9. Accept only a fresh `server-info.json` whose PID is the child PID, then wait up to 30 seconds for
   a healthy API response.
10. Open the final URL with the OS default browser unless `--no-open` or
    `SYMTYPE_OPEN_BROWSER=0` was supplied.
11. Keep ownership of a newly started server so Ctrl+C, terminal close, and Playwright teardown stop
    it instead of leaking a background process. A launcher that only reuses another healthy instance
    returns immediately and never claims ownership of that process.

The launcher does not delete, replace, or silently reconstruct a failed database. Database and
migration errors remain visible and point to the logs.

An explicit `SYMTYPE_DATA_DIR` may be relative to the repository or absolute, but the filesystem
root is rejected so database, lock, and log files cannot be placed at that dangerously broad scope.
Existing symlinks are resolved before this check, so a link to the root cannot bypass it.
Blank or relative `XDG_DATA_HOME`/`APPDATA` values are not trusted as OS data roots; the platform
fallback is used instead. `.env.example` documents optional variables, but the launcher does not
implicitly load a `.env` file.

## Files in the application-data directory

- `symtype.sqlite3` plus SQLite WAL/SHM files while running: authoritative data.
- `backups/*.sqlite3`: rotated application-created snapshots.
- `logs/symtype.log`: server stdout/stderr and startup separators.
- `logs/launcher.log`: dependency/build/migration/health coordinator log.
- `server-info.json`: last ready URL, PID, start time, and database path.
- `launcher.lock`: ephemeral concurrency lock; stale locks are removed only when their owner is no
  longer alive or the record is older than ten minutes.

On POSIX systems the coordinator, production server, and standalone migration entry point use an
owner-only `077` umask for newly created data, logs, staging files, and backups. Windows relies on the
current user's `%APPDATA%` ACL. Existing file modes are not silently rewritten.

## Diagnostic verification

`node scripts/start-local.mjs --dry-run --no-open` validates the environment and prints dependency
and build decisions without installing, building, migrating, starting, or opening a browser. On a
non-supported development runtime, prefix it with `SYMTYPE_ALLOW_UNSUPPORTED_NODE=1` (POSIX) or set
that variable in the current Windows shell. A real release smoke must still use Node 22.12+ or
Node 24.

The automated dry-run suite is intentionally safe for the working checkout and application data:

```sh
npx vitest run apps/server/test/launcher.test.ts --config vitest.config.ts
```

It verifies the supported/unsupported runtime paths, argument rejection, wrong-cwd behavior, both
POSIX wrappers, the Windows wrapper contract, the dependency decision table for ABI versus platform
changes, and that dry-run creates no database, server metadata, or lock. It uses a temporary data
directory and never prints arbitrary environment variables.

The full release smoke makes an isolated source-only fixture under the OS temporary directory, then
performs a production-environment clean install, build, migration, occupied-port fallback, health
check, live second-launcher reuse, unchanged offline restart, damaged-output rebuild, lockfile-change
dry-run decision, POSIX owner-only modes, and graceful shutdown:

```sh
node scripts/launcher-full-smoke.mjs --node /path/to/node-24
```

Use `--offline` only when the npm cache is already populated. The fixture copier has a narrow
allowlist, ignores symlinks, `.env` files (except `.env.example`), databases, logs, browser profiles,
and test artifacts, and removes the fixture on completion. `--keep` is available only for deliberate
failure diagnosis. This smoke never uses the normal SymType application-data directory.

The script covers all of those cases except two launchers racing before either instance is healthy;
that concurrency path remains covered by the coordinator state machine and should be exercised
manually for a release that changes locking. Confirm the URL and log paths when doing that focused
manual check. The isolated fixture is removed automatically unless `--keep` was requested.

Launcher fingerprinting reads production source/config only under `apps` and `packages`; it never
walks the application-data directory, home directory, browser profiles, imported custom text, or
keystroke data. The coordinator logs its fixed operational decisions and child command output, but
does not enumerate or print the process environment.
