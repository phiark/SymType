import { performance } from "node:perf_hooks";

export const STARTUP_PHASES = [
  "appConstructionStarted",
  "databaseReady",
  "automaticBackupStarted",
  "automaticBackupFinished",
  "appConstructionFinished",
  "listenerReady"
] as const;

export type StartupPhase = (typeof STARTUP_PHASES)[number];

export interface StartupTimingSnapshot {
  schemaVersion: 1;
  clock: "node-performance-time-origin";
  nodeProcessStartedAt: string;
  nodeProcessStartMs: 0;
  automaticBackupOutcome?: "created" | "current";
  marks: Partial<Record<`${StartupPhase}Ms`, number>>;
}

interface StartupClock {
  now(): number;
  readonly timeOrigin: number;
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}

/**
 * A bounded, process-local startup timeline. It records one monotonic value per
 * known phase and never includes request data, paths, or user content.
 */
export class StartupTimeline {
  private readonly clock: StartupClock;
  private readonly phaseMarks = new Map<StartupPhase, number>();
  private automaticBackupOutcome: "created" | "current" | undefined;
  readonly nodeProcessStartedAt: string;

  constructor(clock: StartupClock = performance) {
    this.clock = clock;
    this.nodeProcessStartedAt = new Date(clock.timeOrigin).toISOString();
  }

  mark(phase: StartupPhase): number {
    const existing = this.phaseMarks.get(phase);
    if (existing !== undefined) return existing;
    const value = roundedMilliseconds(this.clock.now());
    this.phaseMarks.set(phase, value);
    return value;
  }

  recordAutomaticBackupOutcome(outcome: "created" | "current"): void {
    this.automaticBackupOutcome ??= outcome;
  }

  snapshot(): StartupTimingSnapshot {
    const marks: Partial<Record<`${StartupPhase}Ms`, number>> = {};
    for (const phase of STARTUP_PHASES) {
      const value = this.phaseMarks.get(phase);
      if (value !== undefined) marks[`${phase}Ms`] = value;
    }
    return {
      schemaVersion: 1,
      clock: "node-performance-time-origin",
      nodeProcessStartedAt: this.nodeProcessStartedAt,
      nodeProcessStartMs: 0,
      ...(this.automaticBackupOutcome
        ? { automaticBackupOutcome: this.automaticBackupOutcome }
        : {}),
      marks
    };
  }
}
