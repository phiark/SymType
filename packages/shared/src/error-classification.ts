import {
  areKeysAdjacent,
  getBindingForCharacter,
  SYMMETRIC_PRESET,
  type Finger,
  type Hand,
  type KeyboardPreset,
  type KeyboardRow,
  type ShiftAssessment
} from "./keyboard-layout.js";
import { median, medianAbsoluteDeviation } from "./metrics.js";

export type TextErrorKind =
  | "transposition"
  | "adjacent-key-confusion"
  | "number-symbol-confusion"
  | "shift-error"
  | "substitution"
  | "omission"
  | "repeat"
  | "insertion";

export interface TextErrorIssue {
  readonly kind: TextErrorKind;
  readonly target: string;
  readonly actual: string;
  readonly targetStart: number;
  readonly targetEnd: number;
  readonly actualStart: number;
  readonly actualEnd: number;
}

type AlignmentOperation = "match" | "substitution" | "insertion" | "deletion" | "transposition";

interface AlignmentCell {
  readonly cost: number;
  readonly operation: AlignmentOperation;
}

function chooseCell(candidates: readonly AlignmentCell[]): AlignmentCell {
  const operationPreference: Record<AlignmentOperation, number> = {
    match: 0,
    transposition: 1,
    substitution: 2,
    deletion: 3,
    insertion: 4
  };
  return [...candidates].sort(
    (first, second) =>
      first.cost - second.cost ||
      operationPreference[first.operation] - operationPreference[second.operation]
  )[0] as AlignmentCell;
}

function buildAlignment(target: readonly string[], actual: readonly string[]): AlignmentCell[][] {
  const matrix: AlignmentCell[][] = Array.from(
    { length: target.length + 1 },
    () => new Array<AlignmentCell>(actual.length + 1)
  );
  matrix[0]![0] = { cost: 0, operation: "match" };
  for (let row = 1; row <= target.length; row += 1) {
    matrix[row]![0] = { cost: row, operation: "deletion" };
  }
  for (let column = 1; column <= actual.length; column += 1) {
    matrix[0]![column] = { cost: column, operation: "insertion" };
  }

  for (let row = 1; row <= target.length; row += 1) {
    for (let column = 1; column <= actual.length; column += 1) {
      const candidates: AlignmentCell[] = [];
      const isMatch = target[row - 1] === actual[column - 1];
      candidates.push({
        cost: (matrix[row - 1]?.[column - 1]?.cost ?? 0) + (isMatch ? 0 : 1),
        operation: isMatch ? "match" : "substitution"
      });
      candidates.push({
        cost: (matrix[row - 1]?.[column]?.cost ?? 0) + 1,
        operation: "deletion"
      });
      candidates.push({
        cost: (matrix[row]?.[column - 1]?.cost ?? 0) + 1,
        operation: "insertion"
      });
      if (
        row >= 2 &&
        column >= 2 &&
        target[row - 2] === actual[column - 1] &&
        target[row - 1] === actual[column - 2] &&
        target[row - 2] !== target[row - 1]
      ) {
        candidates.push({
          cost: (matrix[row - 2]?.[column - 2]?.cost ?? 0) + 1,
          operation: "transposition"
        });
      }
      matrix[row]![column] = chooseCell(candidates);
    }
  }
  return matrix;
}

function classifySubstitution(
  target: string,
  actual: string,
  preset: KeyboardPreset
): TextErrorKind {
  const targetBinding = getBindingForCharacter(preset, target);
  const actualBinding = getBindingForCharacter(preset, actual);
  if (targetBinding !== undefined && actualBinding !== undefined) {
    if (
      targetBinding.key.code === actualBinding.key.code &&
      targetBinding.shifted !== actualBinding.shifted
    ) {
      return targetBinding.key.category === "number" ? "number-symbol-confusion" : "shift-error";
    }
    if (areKeysAdjacent(preset, targetBinding.key.code, actualBinding.key.code)) {
      return "adjacent-key-confusion";
    }
  }
  if (target.toLocaleLowerCase("en-US") === actual.toLocaleLowerCase("en-US")) {
    return "shift-error";
  }
  return "substitution";
}

/**
 * Optimal-string-alignment backtracking treats an adjacent swap as one edit,
 * consuming both target and actual characters. It therefore cannot also emit
 * two replacement errors for the same swap.
 */
export function classifyTextErrors(
  targetText: string,
  actualText: string,
  preset: KeyboardPreset = SYMMETRIC_PRESET
): TextErrorIssue[] {
  const target = Array.from(targetText);
  const actual = Array.from(actualText);
  const matrix = buildAlignment(target, actual);
  const reversed: TextErrorIssue[] = [];
  let row = target.length;
  let column = actual.length;
  while (row > 0 || column > 0) {
    const operation = matrix[row]?.[column]?.operation;
    if (operation === "match") {
      row -= 1;
      column -= 1;
      continue;
    }
    if (operation === "transposition") {
      reversed.push({
        kind: "transposition",
        target: `${target[row - 2] ?? ""}${target[row - 1] ?? ""}`,
        actual: `${actual[column - 2] ?? ""}${actual[column - 1] ?? ""}`,
        targetStart: row - 2,
        targetEnd: row,
        actualStart: column - 2,
        actualEnd: column
      });
      row -= 2;
      column -= 2;
      continue;
    }
    if (operation === "substitution") {
      const targetCharacter = target[row - 1] ?? "";
      const actualCharacter = actual[column - 1] ?? "";
      reversed.push({
        kind: classifySubstitution(targetCharacter, actualCharacter, preset),
        target: targetCharacter,
        actual: actualCharacter,
        targetStart: row - 1,
        targetEnd: row,
        actualStart: column - 1,
        actualEnd: column
      });
      row -= 1;
      column -= 1;
      continue;
    }
    if (operation === "deletion") {
      reversed.push({
        kind: "omission",
        target: target[row - 1] ?? "",
        actual: "",
        targetStart: row - 1,
        targetEnd: row,
        actualStart: column,
        actualEnd: column
      });
      row -= 1;
      continue;
    }
    if (operation === "insertion") {
      const inserted = actual[column - 1] ?? "";
      const previousActual = actual[column - 2];
      const previousTarget = target[row - 1];
      const nextActual = actual[column];
      const nextTarget = target[row];
      reversed.push({
        kind:
          inserted === previousActual ||
          inserted === previousTarget ||
          inserted === nextActual ||
          inserted === nextTarget
            ? "repeat"
            : "insertion",
        target: "",
        actual: inserted,
        targetStart: row,
        targetEnd: row,
        actualStart: column - 1,
        actualEnd: column
      });
      column -= 1;
      continue;
    }
    throw new Error(`Unable to backtrack text alignment at ${row}:${column}`);
  }
  return reversed.reverse();
}

export interface TypingSignalEvent {
  readonly target: string;
  readonly actual: string;
  readonly correct: boolean;
  readonly ikiMs: number | null;
  /** Mapping-derived metadata. These fields never claim to observe the physical finger used. */
  readonly mappedFinger?: Finger | null;
  readonly mappedHand?: Hand | null;
  readonly keyboardRow?: KeyboardRow | null;
  readonly shiftAssessment?: ShiftAssessment;
  readonly excludedFromSpeed?: boolean;
}

export type BehavioralIssueKind =
  | "correct-but-slow"
  | "post-error-slowdown"
  | "slow-bigram"
  | "slow-trigram"
  | "same-finger-cross-row"
  | "hand-imbalance"
  | "finger-imbalance"
  | "shift-use-error"
  | "error-burst"
  | "suspected-fatigue";

export interface BehavioralIssue {
  readonly kind: BehavioralIssueKind;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly feature: string;
  readonly observed: number;
  readonly baseline: number;
  readonly severity: number;
}

export interface BehavioralAnalysisOptions {
  readonly baselineIkiMs: number;
  readonly minimumGroupSamples?: number;
  readonly slowRatio?: number;
  readonly imbalanceRatio?: number;
  readonly fatigueWindow?: number;
  readonly preset?: KeyboardPreset;
}

interface MappedEvent extends TypingSignalEvent {
  readonly finger: Finger | null;
  readonly hand: Hand | null;
  readonly row: KeyboardRow | null;
}

function mapEvent(event: TypingSignalEvent, preset: KeyboardPreset): MappedEvent {
  const binding = getBindingForCharacter(preset, event.target);
  return {
    ...event,
    finger: event.mappedFinger ?? binding?.key.finger ?? null,
    hand: event.mappedHand ?? binding?.key.hand ?? null,
    row: event.keyboardRow ?? binding?.key.row ?? null
  };
}

function validIki(event: TypingSignalEvent): event is TypingSignalEvent & { ikiMs: number } {
  return (
    event.correct &&
    event.excludedFromSpeed !== true &&
    event.ikiMs !== null &&
    Number.isFinite(event.ikiMs) &&
    event.ikiMs > 0
  );
}

function extractValidIkis(events: readonly TypingSignalEvent[]): number[] {
  return events.flatMap((event) => (validIki(event) ? [event.ikiMs] : []));
}

function groupedImbalance(
  events: readonly MappedEvent[],
  selector: (event: MappedEvent) => string | null,
  kind: "hand-imbalance" | "finger-imbalance",
  minimumSamples: number,
  ratio: number
): BehavioralIssue[] {
  const groups = new Map<string, number[]>();
  for (const event of events) {
    const key = selector(event);
    if (key !== null && validIki(event)) {
      const values = groups.get(key);
      if (values) values.push(event.ikiMs);
      else groups.set(key, [event.ikiMs]);
    }
  }
  const eligible = [...groups.entries()]
    .filter(([, values]) => values.length >= minimumSamples)
    .map(([name, values]) => ({ name, center: median(values) }));
  if (eligible.length < 2) {
    return [];
  }
  const fastest = Math.min(...eligible.map((group) => group.center));
  return eligible
    .filter((group) => group.center > fastest * ratio)
    .map((group) => ({
      kind,
      startIndex: 0,
      endIndex: events.length,
      feature: group.name,
      observed: group.center,
      baseline: fastest,
      severity: Math.min(1, group.center / fastest - 1)
    }));
}

export function classifyBehavioralIssues(
  inputEvents: readonly TypingSignalEvent[],
  options: BehavioralAnalysisOptions
): BehavioralIssue[] {
  if (!Number.isFinite(options.baselineIkiMs) || options.baselineIkiMs <= 0) {
    throw new RangeError("baselineIkiMs must be positive");
  }
  const slowRatio = options.slowRatio ?? 1.45;
  const imbalanceRatio = options.imbalanceRatio ?? 1.25;
  const minimumSamples = options.minimumGroupSamples ?? 5;
  const preset = options.preset ?? SYMMETRIC_PRESET;
  const events = inputEvents.map((event) => mapEvent(event, preset));
  const issues: BehavioralIssue[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) {
      continue;
    }
    if (validIki(event) && event.ikiMs > options.baselineIkiMs * slowRatio) {
      issues.push({
        kind: "correct-but-slow",
        startIndex: index,
        endIndex: index + 1,
        feature: event.target,
        observed: event.ikiMs,
        baseline: options.baselineIkiMs,
        severity: Math.min(1, event.ikiMs / options.baselineIkiMs - 1)
      });
    }
    const previous = events[index - 1];
    if (
      previous !== undefined &&
      !previous.correct &&
      validIki(event) &&
      event.ikiMs > options.baselineIkiMs * 1.3
    ) {
      issues.push({
        kind: "post-error-slowdown",
        startIndex: index - 1,
        endIndex: index + 1,
        feature: `${previous.target}${event.target}`,
        observed: event.ikiMs,
        baseline: options.baselineIkiMs,
        severity: Math.min(1, event.ikiMs / options.baselineIkiMs - 1)
      });
    }
    if (
      previous !== undefined &&
      validIki(previous) &&
      validIki(event) &&
      event.ikiMs > options.baselineIkiMs * 1.35
    ) {
      issues.push({
        kind: "slow-bigram",
        startIndex: index - 1,
        endIndex: index + 1,
        feature: `${previous.target}${event.target}`,
        observed: event.ikiMs,
        baseline: options.baselineIkiMs,
        severity: Math.min(1, event.ikiMs / options.baselineIkiMs - 1)
      });
      if (
        previous.finger !== null &&
        previous.finger === event.finger &&
        previous.row !== null &&
        event.row !== null &&
        previous.row !== event.row
      ) {
        issues.push({
          kind: "same-finger-cross-row",
          startIndex: index - 1,
          endIndex: index + 1,
          feature: `${previous.target}${event.target}`,
          observed: event.ikiMs,
          baseline: options.baselineIkiMs,
          severity: Math.min(1, event.ikiMs / options.baselineIkiMs - 1)
        });
      }
    }
    const twoBack = events[index - 2];
    if (
      twoBack !== undefined &&
      previous !== undefined &&
      validIki(twoBack) &&
      validIki(previous) &&
      validIki(event) &&
      median([previous.ikiMs, event.ikiMs]) > options.baselineIkiMs * 1.35
    ) {
      issues.push({
        kind: "slow-trigram",
        startIndex: index - 2,
        endIndex: index + 1,
        feature: `${twoBack.target}${previous.target}${event.target}`,
        observed: median([previous.ikiMs, event.ikiMs]),
        baseline: options.baselineIkiMs,
        severity: Math.min(1, median([previous.ikiMs, event.ikiMs]) / options.baselineIkiMs - 1)
      });
    }
    if (
      event.shiftAssessment !== undefined &&
      event.shiftAssessment !== "correct-opposite-hand" &&
      event.shiftAssessment !== "not-required"
    ) {
      issues.push({
        kind: "shift-use-error",
        startIndex: index,
        endIndex: index + 1,
        feature: event.shiftAssessment,
        observed: 1,
        baseline: 0,
        severity: 1
      });
    }
  }

  issues.push(
    ...groupedImbalance(
      events,
      (event) => (event.hand === "thumb" ? null : event.hand),
      "hand-imbalance",
      minimumSamples,
      imbalanceRatio
    ),
    ...groupedImbalance(
      events,
      (event) => event.finger,
      "finger-imbalance",
      minimumSamples,
      imbalanceRatio
    )
  );

  for (let start = 0; start + 5 <= events.length; start += 1) {
    const window = events.slice(start, start + 5);
    const errors = window.filter((event) => !event.correct).length;
    const ikis = extractValidIkis(window);
    if (errors >= 3 && ikis.length >= 2 && median(ikis) < options.baselineIkiMs * 0.85) {
      issues.push({
        kind: "error-burst",
        startIndex: start,
        endIndex: start + 5,
        feature: window.map((event) => event.target).join(""),
        observed: errors / 5,
        baseline: 0.06,
        severity: Math.min(1, errors / 5)
      });
    }
  }

  const fatigueWindow = options.fatigueWindow ?? 18;
  if (events.length >= fatigueWindow) {
    const recent = events.slice(-fatigueWindow);
    const third = Math.floor(recent.length / 3);
    const early = recent.slice(0, third);
    const late = recent.slice(-third);
    const earlyIkis = extractValidIkis(early);
    const lateIkis = extractValidIkis(late);
    const earlyAccuracy = early.filter((event) => event.correct).length / early.length;
    const lateAccuracy = late.filter((event) => event.correct).length / late.length;
    if (
      earlyIkis.length >= 3 &&
      lateIkis.length >= 3 &&
      median(lateIkis) > median(earlyIkis) * 1.12 &&
      lateAccuracy < earlyAccuracy - 0.08 &&
      medianAbsoluteDeviation(lateIkis) > medianAbsoluteDeviation(earlyIkis) * 1.1
    ) {
      issues.push({
        kind: "suspected-fatigue",
        startIndex: events.length - fatigueWindow,
        endIndex: events.length,
        feature: "recent-window",
        observed: median(lateIkis),
        baseline: median(earlyIkis),
        severity: Math.min(1, median(lateIkis) / median(earlyIkis) - 1)
      });
    }
  }
  return issues;
}
