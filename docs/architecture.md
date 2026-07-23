# Architecture

## Runtime shape

SymType is a same-origin local web application. In development, Vite proxies `/api` to Fastify. In
local production, Fastify serves `apps/web/dist`, the JSON API, health, and client-route fallback.
The server binds only to loopback. No service worker, cloud dependency, account, or telemetry exists.

```text
Browser (React + Query) -> /api/v1 -> Fastify validation/security -> domain services -> SQLite
                                      |                           -> backup/export files
                                      +-> built static client
```

## Workspace boundaries

- `shared` owns facts and algorithms: physical codes, mappings, schemas, metrics, classification,
  scheduling, and game state transitions.
- `content` owns bundled strings, generators, provenance, and fictional game narrative.
- `server` owns time, transactions, data paths, migrations, backups, summaries, and authorization of
  local mutations.
- `web` owns interaction, presentation, transient unsubmitted input, audio, and batch transport.

Dependencies point inward: apps may depend on packages; packages do not depend on apps.

## Server domain and repository boundary

`apps/server/src/db/database.ts` is the SQLite repository adapter. It owns parameterized SQL,
transactions, persisted-row selection, and conversion into typed row/evidence inputs. Session error
analysis and summaries, period feature/group aggregation, and the adaptive-versus-baseline experiment
report live respectively in `domain/session-analysis.ts`, `domain/statistics-analysis.ts`, and
`domain/experiment-analysis.ts`. Those domain modules accept plain typed data (and an injected clock
where calendar time matters), return plain results, and may depend on shared algorithms; they do not
open SQLite, import migrations/config/filesystem APIs, or contain SQL primitives.

This boundary keeps behavioral rules independently deterministic without pretending that every query
needs a separate service. `architecture-boundaries.test.ts` scans the domain, Fastify orchestration,
and shared sources for forbidden infrastructure/SQL coupling and verifies that the repository calls
all three analyzers. The analyzers also have direct table-driven tests for dual accuracy and aligned
text errors, robust timing/feature aggregation, retention/calibration/report gating, empty evidence,
and malformed persisted evidence. Database integration remains responsible for proving that the same
rules are reached through real SQLite rows.

All externally supplied values are bound parameters. Dynamic table/column identifiers exist only in
closed migration/backup allow-lists, never from request text. A repository regression stores a
layout name, custom-text title/body, and backup reason containing quote-breaking SQL, a `DROP TABLE`
fragment, and HTML-like text; it then reads the exact strings back and verifies the profile table is
unchanged. That test demonstrates the actual boundary instead of relying only on a source scan.

## API contracts

`packages/shared/src/runtime-api.ts` is the authoritative public Zod contract for current `/api/v1`
routes. Its route registry classifies every declared route, lets Fastify validate registered JSON 2xx
payloads before serialization, and lets the Web client validate matching JSON request/response bodies
at the transport boundary. CSV and SQLite byte responses are explicit non-JSON contracts with pinned
content types rather than unsafe JSON casts. Named path parameters and query objects are also parsed by
shared schemas on both sides before transport/dispatch. All 46 declared routes therefore have exactly
one registry classification, and no secondary or competing package export exists. The deprecated
legacy schema module is intentionally absent from the shared package root.

## Persistence and failure model

SQLite runs with WAL, `foreign_keys=ON`, `busy_timeout=5000`, and `synchronous=NORMAL`. Event batches
have `(session_id, batch_id)` uniqueness and events have `(session_id, sequence)` uniqueness. A retry
therefore returns the committed result without duplicating events. The client flushes at 24 events or
3 seconds and checkpoints on visibility loss. On `pagehide`, it makes a best-effort `sendBeacon`
attempt for printable event batches; if the browser rejects that handoff it falls back to a keepalive
fetch. Lesson completion waits for event and
summary transactions before confirming saved state. If a completed micro-block cannot flush events,
advance source progress, or load its next block, the client retains that exact pending completion and
offers an idempotent retry; it never silently re-enables a completion-latched input or pretends the
next block was saved. A trailing Backspace has no character-producing event to batch, so completion or
explicit save may carry a correction checkpoint for the current block. The server verifies that the
block belongs to the session, is the latest block in canonical event-sequence order, and the position
is behind that block's reconstructed tail, then reconstructs the final summary without inventing a
keystroke event. Once completion is latched, the surface rejects further character and Backspace
input while its save is pending. After an unexpected Practice-page interruption, any batches that
arrived are retained and the session is abandoned rather than counted as completed; page lifecycle
delivery itself is not claimed as an atomic save. Persisted summaries keep a schema-validated
internal metric version and final uncorrected-error count; ordinary user-facing session and history
projections strip that internal evidence. Every user-facing summary, test-history, experiment,
game-settlement, and CSV projection rebuilds the same evidence from authoritative events for valid
historical summaries that predate the version marker when event evidence exists. Raw JSON and SQLite
backup/export surfaces are preservation formats and intentionally retain the stored internal fields.
Valid legacy summaries without events retain their stored metrics rather than fabricating evidence;
neither canonical read path rewrites SQLite history or backup content.

Before any pending forward migration changes an existing database, the repository creates a private
SQLite snapshot with `VACUUM INTO`, verifies its integrity, foreign keys, schema version, row counts,
and checksum, and only then applies the migration transaction. This protection also covers the
standalone migration command. At most two verified snapshots are retained for the same version path;
failure to remove a stale old file preserves its catalog metadata for retry and cannot discard the
required new recovery point or block migration. Normal canonical event batches update feature
evidence incrementally; a rare batch ordered before already-modeled evidence scans only the same
profile's canonical session-start, session-ID, and event-sequence history, folds affected features in
memory, and writes each touched feature once so network arrival cannot change the learned model.

Migration v9 rejects malformed JSON text at SQLite insert/update time for all authoritative JSON
columns. Shared persisted-data schemas then validate domain shape when rows are materialized; a
malformed, truncated, or unrecognized authoritative value stops the operation with recovery guidance
instead of falling back to defaults. Narrow settings/session-summary upcasters accept only complete
recognized historical shapes and preserve measured values without rewriting the stored row. Session
layout snapshots require all 54 unique ANSI-US physical codes and never borrow a missing key from the
current preset. Migration v10 and restore-time normalization preserve historical test accuracy that
predates the dual-accuracy columns.

Database health combines SQLite, foreign-key, JSON container, and domain-schema checks, including
event modifiers and formal-test evidence consistency. Its cache key combines same-connection
`total_changes()` with cross-connection `PRAGMA data_version`; safety-critical backup/restore checks
force a refresh. Backup preview exercises the allow-listed import and application invariants inside a
forced rollback. Cataloged SQLite files receive read-only quick/FK/persisted-JSON checks, and confirmed
JSON/SQLite restore creates a safety snapshot and uses a transaction, with JSON restore also receiving
an explicit post-commit integrity check. The database is never silently recreated after corruption or
migration/restore failure.

## Local security boundary

`SYMTYPE_HOST` is validated before Fastify or SQLite is opened and may be only `127.0.0.1`,
`localhost`, or `::1`; direct server execution cannot opt into a LAN/wildcard bind. Incoming Host
headers are independently restricted to loopback. Non-GET requests require a same-origin `Origin`
(when present) and the boot-time CSRF token returned in the bootstrap response and sent in
`X-SymType-CSRF`. CORS is not enabled. Fastify automatic request logging is disabled so request URLs,
query strings, and CSRF tokens cannot enter logs; explicit startup, shutdown, route-template, and
error diagnostics remain available without request bodies or secret headers. Responses set a
restrictive CSP, `frame-ancestors 'none'`, nosniff, and no-referrer. Imported content has a bounded
size/extension and is always rendered as text. API errors use stable codes and never return stack
traces. `GET /api/v1/diagnostics` only reads integrity/schema/file-name metadata; writing a local
diagnostic snapshot requires the CSRF-protected `POST /api/v1/diagnostics/snapshot` mutation.

## Browser compatibility

The client uses standards supported by the latest two Chrome/Safari versions. `KeyboardEvent.code`
is the physical identity; `key` is retained only as observed input. Composition and repeats are
ignored. Web Audio is created/resumed from an explicit click and reused with tiny oscillators/envelopes.

## UI system

The Web app uses React, TanStack Query for server state, accessible Radix dialog/switch/tabs
primitives, Lucide icons, Recharts, and one repository-owned tokenized stylesheet. The stylesheet
provides the 8px rhythm, semantic color variables, component states, responsive rules, reduced-motion
behavior, and light/dark/system themes. It is the documented equivalent-maintainability deviation
from the initially recommended Tailwind utility compiler: there is no second styling authority or
runtime CSS dependency, and visual regression/a11y gates protect the shared primitives.

Settings consumes the shared legal ranges and the exact six-key advanced-weight contract; the server
revalidates the same schema. A save captures an edit revision, so changes made while the request is in
flight remain dirty and cannot be mislabeled as saved. The primary settings and goal write uses one
SQLite transaction. Backup-list loading/failure is scoped to the data section instead of replacing the
whole settings page, and failures use assertive alert semantics while ordinary success uses a polite
status notification. These behaviors do not by themselves mark the broader API-contract migration
complete.

## Performance

Typing events are accumulated inside `TypingSurface`, outside broad page state, and the current glyph
window is memoized. Parent progress is reported only at the initial state, every four attempts,
completion, or a sparse-input catch-up after 400 ms; idle timer ticks cannot notify the practice page.
A fixed-clock React Profiler regression accepts a 24-key burst while the page-shell surrogate commits
exactly eight times. No network or SQLite call occurs per keystroke.

The production-path Playwright performance case types a seeded 20–60-character block in Chromium and
WebKit, reconciles the exact events, and requires every write to contain 2–24 events with fewer writes
than keys. It also records animation-frame gaps and Long Tasks API evidence where available. The
current regression ceilings are a sub-250 ms maximum frame gap, no observed task at or above 100 ms,
and less than 150 ms cumulative long-task time. These are conservative release-harness thresholds,
not promises for every computer. Statistical queries use indexed events and precomputed daily/feature
aggregates; large-data integration tests seed 100,000 events and record wall time. The repeatable
commands, latest focused result, and limitations live in `docs/performance.md`.

## Test-data isolation

Playwright's Chromium and WebKit servers use separate repository-local SQLite directories. Each
server start resolves its target beneath `.symtype-test-data`, rejects unsafe instance/port input,
and removes only that exact engine-scoped directory before launch. This keeps a screenshot run from
displaying completed sessions accumulated by earlier runs while preserving production databases,
whose application-data locations are never selected by the E2E launcher. Server integration tests
also create a fresh temporary data directory per case.

Stateful visual cases additionally establish their own fixture through the public JSON export,
schema-validated preview, and confirmed restore boundary. `restoreFreshE2eState` removes progress,
resets bundled reading positions/default layouts, and applies explicit settings without mocks or a
private reset API. Calibration uses seed `424242`; engine-specific baselines tolerate at most a 0.1%
pixel difference so remaining timing-derived digits cannot conceal structural drift.

The cross-browser persistence acceptance is deliberately separate from those disposable per-engine
fixtures. The Chromium project owns that case exactly once, starts a production Fastify/static-client
process on a reserved loopback port with a uniquely created OS-temporary `SYMTYPE_DATA_DIR`, and
completes a nonzero course in a fresh Chromium process. It then requires a graceful server exit,
restarts the production process against the same SQLite path and port, and opens a fresh WebKit
process/context with no cookies or browser-storage entries. Today, Analytics, bootstrap, dashboard,
all-time statistics, and the JSON event export must agree exactly across the process boundary. A
successful case removes only its prefix-validated generated fixture; a failure preserves the fixture
path in its attachment for diagnosis and never selects a production application-data directory.

## Automated runtime boundary

The release browser suite installs request interception before opening any product route. For the
Today, Train, Test, Game, Analytics, and Settings idle states, the only permitted HTTP(S) origin is
the current Playwright project's exact `baseURL` origin, including its engine-specific loopback port.
WS(S) attempts are intercepted before connection and may reach only the equivalent transport origin
with the same scheme security, host, and port. The same focused gate rejects uncaught page errors,
`console.error` output, and local responses with a 5xx status. This dynamic check complements the
static no-CDN/no-telemetry source scan; it does not replace intentional disconnected-state coverage,
which runs separately against an explicitly stopped local service.
