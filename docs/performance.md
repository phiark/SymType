# Performance evidence

This document records repeatable performance checks for interaction paths that cannot be accepted
from code inspection alone. Results are evidence from the stated environment, not universal hardware
claims.

## Typing path

### Invariant

- Every accepted keystroke updates the isolated `TypingSurface` immediately.
- The surrounding practice page receives coarse progress at most every four attempts, at completion,
  or after a 400 ms sparse-input interval. Idle timer ticks do not notify the page.
- Keystrokes enter the bounded client queue and are persisted as batches; the UI never performs one
  SQLite request per accepted key.

### Repeatable profiler check

`apps/web/src/components/TypingSurface.test.tsx` includes a React `Profiler` around a page-shell
surrogate and drives a deterministic 24-key burst. The check requires all 24 key events to be
accepted while page-shell commits are exactly 8 (initial mount, initial report, then six coarse
updates), remain below 12, and the final reported position reaches 24. A separate assertion requires
parent progress reports to be exactly attempts 0, 4, 8, 12, 16, 20, and 24 under the same fixed
clock.

Run it with the supported Node runtime:

```sh
npm --workspace @symtype/web test -- TypingSurface.test.tsx
```

This measures React commit isolation in jsdom. Chromium/WebKit acceptance still covers the real
input, batching, focus, pause, and persistence paths; it does not substitute for profiling on every
possible computer.

**Latest result (2026-07-21, Node 24.3.0):** 11/11 focused component tests passed in 0.78 seconds;
the 24-key profiler case observed the required 8 page-shell commits.

### Browser burst gate

`tests/e2e/performance.spec.ts` starts a real seeded smart session in each Playwright engine, types
the generated 20–60 character physical-key block, captures actual mutation requests, and then exits
through the persisted abandon path. It requires:

- the number of `/events` requests to be lower than the character count;
- every request to contain 2–24 events and all batches together to contain exactly the target count;
- the maximum animation-frame gap during the input burst to remain below 250 ms;
- where the engine exposes the Long Tasks API, no observed task at or above 100 ms and less than
  150 ms cumulative long-task time.

The frame threshold is a conservative regression ceiling for this Mac/automation harness, not a
portable promise of input latency. WebKit's frame-gap path remains mandatory even if that engine does
not expose `longtask` entries. Record the focused and complete-suite result below only after it has
actually run against the production build.

**Focused result (2026-07-21, pre-domain-refactor production build):** Chromium and WebKit passed
2/2 in 6.2 seconds. Each run attaches `typing-performance-evidence.json` to the Playwright result;
the final release evidence must come from the rebuilt, complete browser suite rather than treating
this focused result as sign-off.

## Server query scale

The integration suite seeds the large-event fixture and records the local-machine duration for the
100,000-event analytics path. The release record belongs in `docs/progress-log.md` after each final
candidate run so stale timings are not presented as current.
