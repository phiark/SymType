import { SYMMETRIC_PRESET, type KeyDefinition } from "@symtype/shared";

interface PatternEntry {
  readonly target: string;
  readonly actual?: string;
  readonly shift?: boolean;
  readonly capsLock?: boolean;
  readonly shiftSide?: "left" | "right";
  readonly backspaces?: number;
}

export interface FixtureEvent {
  readonly sequence: number;
  readonly target: string;
  readonly actual: string;
  readonly physicalCode: string;
  readonly shiftSide: "left" | "right" | "none";
  readonly modifiersJson: string;
  readonly correct: number;
  readonly correction: number;
  readonly backspaces: number;
  readonly ikiMs: number | null;
  readonly hand: string;
  readonly finger: string;
  readonly row: string;
  readonly zone: string;
  readonly characterClass: string;
  readonly afterError: number;
  readonly refocus: number;
  readonly longPause: number;
}

const EVENT_PATTERN: readonly PatternEntry[] = Object.freeze([
  { target: "a" },
  { target: "f" },
  { target: "j" },
  { target: "k" },
  { target: "A", shift: true, shiftSide: "right" },
  { target: "7" },
  { target: "&", shift: true, shiftSide: "left" },
  { target: ";" },
  { target: " " },
  { target: "e", actual: "r" },
  { target: "e" },
  { target: "O", shift: true, shiftSide: "left" },
  { target: "?", shift: true, shiftSide: "left" },
  { target: "0" },
  { target: "-" },
  { target: "_", shift: true, shiftSide: "left" },
  { target: "z" },
  { target: "m" },
  { target: "t", backspaces: 1 },
  { target: "." },
  { target: "B", capsLock: true },
  { target: "5" },
  { target: "%", shift: true, shiftSide: "right" },
  { target: "/" }
]);

export function buildTargetText(count: number): string {
  let result = "";
  for (let index = 0; index < count; index += 1) result += patternAt(index).target;
  return result;
}

export function eventAt(sequence: number): FixtureEvent {
  const pattern = patternAt(sequence);
  const targetKey = keyForCharacter(pattern.target);
  const actual = pattern.actual ?? pattern.target;
  const actualKey = keyForCharacter(actual);
  const correct = Number(actual === pattern.target);
  const backspaces = pattern.backspaces ?? 0;
  return {
    sequence,
    target: pattern.target,
    actual,
    physicalCode: actualKey.code,
    shiftSide: pattern.shiftSide ?? "none",
    modifiersJson: JSON.stringify({
      shift: pattern.shift ?? false,
      capsLock: pattern.capsLock ?? false
    }),
    correct,
    correction: Number(backspaces > 0),
    backspaces,
    ikiMs: sequence === 0 ? null : sequence % 113 === 0 ? 500 : 200,
    hand: targetKey.hand,
    finger: targetKey.finger,
    row: targetKey.row,
    zone: targetKey.zone,
    characterClass: characterClass(pattern.target),
    afterError: Number(
      sequence > 0 &&
        (patternAt(sequence - 1).actual ?? patternAt(sequence - 1).target) !==
          patternAt(sequence - 1).target
    ),
    refocus: Number(sequence === 0),
    longPause: Number(sequence > 0 && sequence % 211 === 0)
  };
}

export function summarizeEventPattern(count: number): {
  readonly correct: number;
  readonly errors: number;
  readonly longestStreak: number;
} {
  let correct = 0;
  let longestStreak = 0;
  let streak = 0;
  for (let index = 0; index < count; index += 1) {
    if (eventAt(index).correct === 1) {
      correct += 1;
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else streak = 0;
  }
  return { correct, errors: count - correct, longestStreak };
}

function patternAt(index: number): PatternEntry {
  const entry = EVENT_PATTERN[index % EVENT_PATTERN.length];
  if (!entry) throw new Error("Fixture event pattern is empty");
  return entry;
}

function keyForCharacter(character: string): KeyDefinition {
  const key = SYMMETRIC_PRESET.keys.find(
    (candidate) => candidate.unshifted === character || candidate.shifted === character
  );
  if (!key) throw new Error(`Fixture character is not on ANSI US QWERTY: ${character}`);
  return key;
}

function characterClass(character: string): string {
  if (/[a-z]/u.test(character)) return "lowercase";
  if (/[A-Z]/u.test(character)) return "uppercase";
  if (/\d/u.test(character)) return "digit";
  if (/\s/u.test(character)) return "whitespace";
  return "symbol";
}
