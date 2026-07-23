const MAX_LONG_TASKS = 64;

export const WEB_PERFORMANCE_MARK_NAMES = {
  bootstrapStarted: "symtype:web-bootstrap-started",
  reactRenderSubmitted: "symtype:react-render-submitted",
  interactivePaint: "symtype:interactive-paint"
} as const;

type WebPerformancePhase =
  "webBootstrapStartedMs" | "reactRenderSubmittedMs" | "interactivePaintMs";

export interface WebLongTaskTiming {
  startTimeMs: number;
  durationMs: number;
}

export interface WebPerformanceSnapshot {
  schemaVersion: 1;
  clock: "window-performance-time-origin";
  timeOriginEpochMs: number;
  longTaskSupported: boolean;
  marks: Partial<Record<WebPerformancePhase, number>>;
  longTasks: WebLongTaskTiming[];
  droppedLongTaskCount: number;
}

export interface SymTypePerformanceReader {
  snapshot(): WebPerformanceSnapshot;
}

declare global {
  interface Window {
    symtypePerformance?: SymTypePerformanceReader;
  }
}

interface PerformanceProbeRuntime {
  readonly timeOrigin: number;
  readonly longTaskSupported: boolean;
  now(): number;
  mark(name: string): void;
  scheduleFrame(callback: () => void): void;
  subscribeLongTasks?(
    callback: (entries: readonly WebLongTaskTiming[]) => void
  ): (() => void) | undefined;
}

export interface WebPerformanceProbe {
  markReactRenderSubmitted(): void;
  scheduleInteractivePaint(): void;
  snapshot(): WebPerformanceSnapshot;
  disconnect(): void;
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}

function browserRuntime(): PerformanceProbeRuntime {
  const supported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;

  return {
    timeOrigin: performance.timeOrigin,
    longTaskSupported: supported,
    now: () => performance.now(),
    mark: (name) => {
      if (typeof performance.mark === "function") performance.mark(name);
    },
    scheduleFrame: (callback) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => callback());
      } else {
        window.setTimeout(callback, 0);
      }
    },
    ...(supported
      ? {
          subscribeLongTasks: (callback: (entries: readonly WebLongTaskTiming[]) => void) => {
            try {
              const observer = new PerformanceObserver((list) => {
                callback(
                  list.getEntries().map((entry) => ({
                    startTimeMs: entry.startTime,
                    durationMs: entry.duration
                  }))
                );
              });
              try {
                observer.observe({ type: "longtask", buffered: true });
              } catch {
                observer.observe({ entryTypes: ["longtask"] });
              }
              return () => observer.disconnect();
            } catch {
              return undefined;
            }
          }
        }
      : {})
  };
}

export function createWebPerformanceProbe(
  runtime: PerformanceProbeRuntime = browserRuntime()
): WebPerformanceProbe {
  const marks: Partial<Record<WebPerformancePhase, number>> = {};
  const longTasks: WebLongTaskTiming[] = [];
  let droppedLongTaskCount = 0;
  let interactivePaintScheduled = false;

  const recordMark = (phase: WebPerformancePhase, performanceName: string): void => {
    if (marks[phase] !== undefined) return;
    marks[phase] = roundedMilliseconds(runtime.now());
    runtime.mark(performanceName);
  };
  const recordLongTasks = (entries: readonly WebLongTaskTiming[]): void => {
    for (const entry of entries) {
      if (
        !Number.isFinite(entry.startTimeMs) ||
        !Number.isFinite(entry.durationMs) ||
        entry.startTimeMs < 0 ||
        entry.durationMs <= 0
      ) {
        continue;
      }
      if (longTasks.length === MAX_LONG_TASKS) {
        longTasks.shift();
        droppedLongTaskCount += 1;
      }
      longTasks.push({
        startTimeMs: roundedMilliseconds(entry.startTimeMs),
        durationMs: roundedMilliseconds(entry.durationMs)
      });
    }
  };
  const unsubscribe = runtime.subscribeLongTasks?.(recordLongTasks);
  const longTaskSupported = runtime.longTaskSupported && unsubscribe !== undefined;

  recordMark("webBootstrapStartedMs", WEB_PERFORMANCE_MARK_NAMES.bootstrapStarted);

  return {
    markReactRenderSubmitted() {
      recordMark("reactRenderSubmittedMs", WEB_PERFORMANCE_MARK_NAMES.reactRenderSubmitted);
    },
    scheduleInteractivePaint() {
      if (interactivePaintScheduled || marks.interactivePaintMs !== undefined) return;
      interactivePaintScheduled = true;
      runtime.scheduleFrame(() => {
        runtime.scheduleFrame(() => {
          recordMark("interactivePaintMs", WEB_PERFORMANCE_MARK_NAMES.interactivePaint);
        });
      });
    },
    snapshot() {
      return {
        schemaVersion: 1,
        clock: "window-performance-time-origin",
        timeOriginEpochMs: runtime.timeOrigin,
        longTaskSupported,
        marks: { ...marks },
        longTasks: longTasks.map((entry) => ({ ...entry })),
        droppedLongTaskCount
      };
    },
    disconnect() {
      unsubscribe?.();
    }
  };
}

let installedProbe: WebPerformanceProbe | undefined;

export function installWebPerformanceProbe(): WebPerformanceProbe {
  installedProbe?.disconnect();
  const probe = createWebPerformanceProbe();
  installedProbe = probe;
  try {
    Object.defineProperty(window, "symtypePerformance", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        snapshot: () => probe.snapshot()
      } satisfies SymTypePerformanceReader)
    });
  } catch {
    // Instrumentation must never prevent the local product from opening.
  }
  return probe;
}

export function scheduleWebInteractivePaint(): void {
  installedProbe?.scheduleInteractivePaint();
}
