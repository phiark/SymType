import { EVENTS_PER_SESSION, deterministicUuid, fixtureTimestamp } from "./fixture-constants.js";

export type SessionKind = "training" | "test" | "game";

export interface SessionPlan {
  readonly index: number;
  readonly eventCount: number;
  readonly kind: SessionKind;
  readonly sessionId: string;
  readonly lessonId: string;
  readonly blockId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly mode: string;
}

export interface ErrorEvent {
  readonly target: string;
  readonly actual: string;
  readonly physicalCode: string;
  readonly position: number;
}

export interface EventEvidence {
  readonly correct: number;
  readonly longestStreak: number;
  readonly errorEvents: ErrorEvent[];
}

export interface FixtureSummary {
  readonly characters: number;
  readonly correct: number;
  readonly errors: number;
  readonly rawWpm: number;
  readonly netWpm: number;
  readonly keystrokeAccuracy: number;
  readonly finalTextAccuracy: number;
  readonly accuracy: number;
  readonly consistency: number;
  readonly activeMs: number;
  readonly longestAccurateStreak: number;
  readonly feedback: { readonly good: string; readonly bottleneck: string; readonly next: string };
  readonly errorAnalysis: Record<string, unknown>;
}

export interface DailyAggregate {
  activeMs: number;
  sessions: number;
  characters: number;
  correct: number;
  rawWeighted: number;
  netWeighted: number;
  accuracyWeighted: number;
  consistencyWeighted: number;
}

export function buildSessionPlans(eventCount: number): readonly SessionPlan[] {
  const sessionCount = Math.max(3, Math.ceil(eventCount / EVENTS_PER_SESSION));
  const quotient = Math.floor(eventCount / sessionCount);
  const remainder = eventCount % sessionCount;
  return Array.from({ length: sessionCount }, (_, index) => {
    const count = quotient + Number(index < remainder);
    const kind = sessionKind(index);
    const startedAt = fixtureTimestamp(index);
    return {
      index,
      eventCount: count,
      kind,
      sessionId: deterministicUuid("session", index),
      lessonId: deterministicUuid("lesson", index),
      blockId: deterministicUuid("block", index),
      startedAt,
      completedAt: new Date(Date.parse(startedAt) + count * 200).toISOString(),
      mode: sessionMode(kind, index)
    };
  });
}

export function blockType(kind: SessionKind): string {
  return kind === "training" ? "focus" : kind === "test" ? "test" : "game-stage";
}

export function contentMode(plan: SessionPlan): string {
  return plan.kind === "game" ? `game-${(plan.index % 6) + 1}` : plan.mode;
}

function sessionKind(index: number): SessionKind {
  return index % 3 === 0 ? "training" : index % 3 === 1 ? "test" : "game";
}

function sessionMode(kind: SessionKind, index: number): string {
  if (kind === "training") return "smart";
  if (kind === "test") return "timed";
  return `pineapple-level-${(index % 6) + 1}`;
}
