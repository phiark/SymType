import { countFocusHits, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { Seed } from "./types.js";

export type CommonnessBand = "core" | "common" | "extended";

export interface WordEntry {
  readonly text: string;
  readonly commonnessBand: CommonnessBand;
  readonly sourceId: "symtype-curated-common-words-v1";
}

const CORE_WORDS = [
  "a",
  "about",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "back",
  "be",
  "because",
  "been",
  "before",
  "but",
  "by",
  "can",
  "come",
  "could",
  "day",
  "did",
  "do",
  "down",
  "each",
  "even",
  "every",
  "find",
  "first",
  "for",
  "from",
  "get",
  "give",
  "go",
  "good",
  "great",
  "had",
  "has",
  "have",
  "he",
  "help",
  "her",
  "here",
  "him",
  "his",
  "how",
  "I",
  "if",
  "in",
  "into",
  "is",
  "it",
  "just",
  "know",
  "like",
  "little",
  "long",
  "look",
  "made",
  "make",
  "many",
  "may",
  "me",
  "more",
  "most",
  "much",
  "my",
  "new",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "people",
  "right",
  "said",
  "see",
  "she",
  "so",
  "some",
  "take",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "think",
  "this",
  "time",
  "to",
  "two",
  "up",
  "us",
  "use",
  "very",
  "want",
  "was",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "work",
  "would",
  "year",
  "you",
  "your"
] as const;

const COMMON_WORDS = [
  "across",
  "air",
  "along",
  "always",
  "answer",
  "around",
  "ask",
  "away",
  "begin",
  "between",
  "book",
  "both",
  "bring",
  "build",
  "care",
  "carry",
  "change",
  "check",
  "city",
  "clear",
  "close",
  "color",
  "course",
  "early",
  "easy",
  "enough",
  "family",
  "far",
  "feel",
  "few",
  "follow",
  "form",
  "friend",
  "full",
  "group",
  "hand",
  "home",
  "house",
  "idea",
  "keep",
  "kind",
  "last",
  "learn",
  "left",
  "letter",
  "life",
  "light",
  "line",
  "list",
  "move",
  "near",
  "never",
  "next",
  "night",
  "number",
  "often",
  "open",
  "part",
  "place",
  "plan",
  "point",
  "read",
  "real",
  "run",
  "same",
  "school",
  "seem",
  "set",
  "small",
  "sound",
  "spell",
  "start",
  "state",
  "still",
  "story",
  "study",
  "such",
  "sure",
  "tell",
  "text",
  "thought",
  "three",
  "through",
  "together",
  "too",
  "try",
  "turn",
  "under",
  "until",
  "walk",
  "water",
  "while",
  "word",
  "world",
  "write",
  "young"
] as const;

const EXTENDED_WORDS = [
  "amazing",
  "balance",
  "breeze",
  "bright",
  "calm",
  "canvas",
  "circle",
  "corner",
  "daily",
  "detail",
  "dozen",
  "effort",
  "evening",
  "garden",
  "gentle",
  "freeze",
  "improve",
  "interval",
  "journey",
  "keyboard",
  "lantern",
  "measure",
  "minute",
  "morning",
  "natural",
  "notice",
  "pattern",
  "pause",
  "practice",
  "puzzle",
  "quiet",
  "rhythm",
  "river",
  "size",
  "steady",
  "window",
  "zero",
  "zone"
] as const;

function entries(words: readonly string[], commonnessBand: CommonnessBand): WordEntry[] {
  return words.map((text) => ({
    text,
    commonnessBand,
    sourceId: "symtype-curated-common-words-v1"
  }));
}

export const COMMON_ENGLISH_WORDS: readonly WordEntry[] = Object.freeze([
  ...entries(CORE_WORDS, "core"),
  ...entries(COMMON_WORDS, "common"),
  ...entries(EXTENDED_WORDS, "extended")
]);

export const COMMON_ENGLISH_WORD_SET: ReadonlySet<string> = new Set(
  COMMON_ENGLISH_WORDS.map((entry) => entry.text.toLocaleLowerCase("en-US"))
);

export interface SelectCommonWordsOptions {
  readonly seed: Seed;
  readonly count: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly focus?: FocusInput;
  readonly bands?: readonly CommonnessBand[];
}

export function selectCommonWords(options: SelectCommonWordsOptions): readonly string[] {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new RangeError("Word count must be a positive integer.");
  }
  const minLength = options.minLength ?? 1;
  const maxLength = options.maxLength ?? 14;
  if (minLength < 1 || maxLength < minLength) {
    throw new RangeError("Word length bounds are invalid.");
  }
  const bands = new Set(options.bands ?? ["core", "common", "extended"]);
  const candidates = COMMON_ENGLISH_WORDS.filter(
    (entry) =>
      entry.text.length >= minLength &&
      entry.text.length <= maxLength &&
      bands.has(entry.commonnessBand)
  );
  if (candidates.length === 0) {
    throw new RangeError("No common words match the requested bounds.");
  }

  const random = new SeededRandom(options.seed);
  const result: string[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const selected = random.weightedPick(candidates, (entry) => {
      const focusHits = countFocusHits(entry.text, options.focus);
      const focusWeight = focusHits === 0 ? 1 : 3 + focusHits;
      const bandWeight =
        entry.commonnessBand === "core" ? 1.5 : entry.commonnessBand === "common" ? 1.2 : 1;
      const repeatPenalty =
        result.at(-1)?.toLocaleLowerCase("en-US") === entry.text.toLocaleLowerCase("en-US")
          ? 0.15
          : 1;
      return focusWeight * bandWeight * repeatPenalty;
    });
    result.push(selected.text);
  }
  return result;
}
