import { COMMON_ENGLISH_WORD_SET } from "./words.js";
import { countFocusHits, normalizeFocusCharacters, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { Seed } from "./types.js";

const ONSETS = [
  "b",
  "bl",
  "br",
  "c",
  "ch",
  "cl",
  "cr",
  "d",
  "dr",
  "f",
  "fl",
  "fr",
  "g",
  "gl",
  "gr",
  "h",
  "j",
  "k",
  "l",
  "m",
  "n",
  "p",
  "pl",
  "pr",
  "qu",
  "r",
  "s",
  "sh",
  "sl",
  "sm",
  "sn",
  "sp",
  "st",
  "sw",
  "t",
  "th",
  "tr",
  "v",
  "w",
  "wh",
  "y",
  "z"
] as const;

const NUCLEI = ["a", "ai", "e", "ea", "ee", "i", "o", "oa", "oo", "ou", "u"] as const;
const CODAS = [
  "",
  "b",
  "ck",
  "d",
  "f",
  "g",
  "k",
  "l",
  "m",
  "n",
  "nd",
  "ng",
  "p",
  "r",
  "s",
  "sh",
  "st",
  "t",
  "th",
  "x"
] as const;

const UNSAFE_OR_MISLEADING_FRAGMENTS = [
  "admin",
  "attack",
  "bomb",
  "drug",
  "hack",
  "kill",
  "login",
  "pass",
  "secret",
  "token"
] as const;

export type PseudowordCapitalization = "lower" | "title" | "mixed";

export interface GeneratedPseudoword {
  readonly text: string;
  readonly syllables: number;
  readonly focusHits: number;
  readonly sourceId: "symtype-original-practice-v1";
  readonly isRealWord: false;
}

export interface GeneratePseudowordsOptions {
  readonly seed: Seed;
  readonly count: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly focus?: FocusInput;
  readonly capitalization?: PseudowordCapitalization;
}

function makeCandidate(random: SeededRandom, syllableCount: number): string {
  let result = "";
  for (let syllable = 0; syllable < syllableCount; syllable += 1) {
    result += random.pick(ONSETS);
    result += random.pick(NUCLEI);
    const shouldUseCoda = syllable === syllableCount - 1 || random.chance(0.42);
    if (shouldUseCoda) {
      result += random.pick(CODAS);
    }
  }
  return result;
}

function isReadableCandidate(candidate: string, minLength: number, maxLength: number): boolean {
  if (candidate.length < minLength || candidate.length > maxLength) {
    return false;
  }
  if (COMMON_ENGLISH_WORD_SET.has(candidate)) {
    return false;
  }
  if (UNSAFE_OR_MISLEADING_FRAGMENTS.some((fragment) => candidate.includes(fragment))) {
    return false;
  }
  return (
    /^[a-z]+$/.test(candidate) &&
    !/(.)\1\1/.test(candidate) &&
    !/[aeiou]{3}/.test(candidate) &&
    !/[bcdfghjklmnpqrstvwxyz]{5}/.test(candidate)
  );
}

function applyCapitalization(
  value: string,
  style: PseudowordCapitalization,
  random: SeededRandom
): string {
  if (style === "title") {
    return value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1);
  }
  if (style === "mixed") {
    return [...value]
      .map((character, index) =>
        index === 0 || random.chance(0.2) ? character.toLocaleUpperCase("en-US") : character
      )
      .join("");
  }
  return value;
}

function chooseSyllableCount(random: SeededRandom, maxLength: number): number {
  if (maxLength <= 5) {
    return 1;
  }
  if (maxLength <= 8) {
    return random.chance(0.7) ? 2 : 1;
  }
  return random.weightedPick([1, 2, 3] as const, (count) => (count === 2 ? 3 : 1));
}

export function generatePseudowords(
  options: GeneratePseudowordsOptions
): readonly GeneratedPseudoword[] {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new RangeError("Pseudoword count must be a positive integer.");
  }
  const minLength = options.minLength ?? 4;
  const maxLength = options.maxLength ?? 10;
  if (minLength < 2 || maxLength < minLength || maxLength > 16) {
    throw new RangeError("Pseudoword length bounds must be between 2 and 16.");
  }

  const focus = normalizeFocusCharacters(options.focus).filter((character) =>
    /^[a-z]$/.test(character)
  );
  const random = new SeededRandom(options.seed);
  const seen = new Set<string>();
  const generated: GeneratedPseudoword[] = [];

  for (let index = 0; index < options.count; index += 1) {
    const candidates: Array<{ text: string; syllables: number; focusHits: number }> = [];
    for (let attempt = 0; attempt < 96; attempt += 1) {
      const syllables = chooseSyllableCount(random, maxLength);
      const text = makeCandidate(random, syllables);
      if (!seen.has(text) && isReadableCandidate(text, minLength, maxLength)) {
        candidates.push({ text, syllables, focusHits: countFocusHits(text, focus) });
      }
      if (candidates.length >= 12) {
        break;
      }
    }
    if (candidates.length === 0) {
      throw new Error("Unable to generate a pseudoword within the requested constraints.");
    }

    const selected = random.weightedPick(candidates, (candidate) => {
      const focusWeight = focus.length === 0 ? 1 : 1 + candidate.focusHits * 5;
      const midpoint = (minLength + maxLength) / 2;
      const lengthWeight = 1 / (1 + Math.abs(candidate.text.length - midpoint) * 0.15);
      return focusWeight * lengthWeight;
    });
    seen.add(selected.text);
    generated.push({
      text: applyCapitalization(selected.text, options.capitalization ?? "lower", random),
      syllables: selected.syllables,
      focusHits: selected.focusHits,
      sourceId: "symtype-original-practice-v1",
      isRealWord: false
    });
  }

  return generated;
}
