import { generateDataEntryItems } from "./data-entry.js";
import type { FocusInput } from "./focus.js";
import { selectLongFormSample } from "./long-form.js";
import { generatePseudowords } from "./pseudowords.js";
import { SeededRandom } from "./seed.js";
import { generateCommonEnglishSentences } from "./sentences.js";
import { selectPracticeSnippet } from "./snippets.js";
import type { PracticeContentModeId, Seed } from "./types.js";
import { selectCommonWords } from "./words.js";

export interface ContentModeDefinition {
  readonly id: PracticeContentModeId;
  readonly label: string;
  readonly description: string;
  readonly acceptsFocus: boolean;
  readonly source: "generated" | "curated" | "mixed";
}

export const CONTENT_MODES: readonly ContentModeDefinition[] = Object.freeze([
  {
    id: "smart",
    label: "Smart lesson",
    description: "Natural text selected with extra weight for requested focus characters.",
    acceptsFocus: true,
    source: "mixed"
  },
  {
    id: "traditional",
    label: "Traditional zones",
    description: "Short common-word groups suitable for a constrained key zone.",
    acceptsFocus: true,
    source: "curated"
  },
  {
    id: "weakness",
    label: "Weakness rescue",
    description: "Dense, short common-word practice around explicit focus characters.",
    acceptsFocus: true,
    source: "curated"
  },
  {
    id: "common-english",
    label: "Common English",
    description: "Original natural sentences assembled from common vocabulary.",
    acceptsFocus: true,
    source: "generated"
  },
  {
    id: "pseudowords",
    label: "Pseudowords",
    description: "Clearly labeled, readable English-shaped nonwords.",
    acceptsFocus: true,
    source: "generated"
  },
  {
    id: "data-entry",
    label: "Numbers and data entry",
    description: "Fictional numeric, date, time, currency, and table-style values.",
    acceptsFocus: false,
    source: "generated"
  },
  {
    id: "punctuation",
    label: "Punctuation and symbols",
    description: "Original prose containing varied ANSI punctuation.",
    acceptsFocus: true,
    source: "curated"
  },
  {
    id: "shift",
    label: "Capitalization and Shift",
    description: "Mixed title case, abbreviations, and capitalized words.",
    acceptsFocus: true,
    source: "generated"
  },
  {
    id: "source-code",
    label: "Source code",
    description: "Short original benign samples in five common web languages.",
    acceptsFocus: true,
    source: "curated"
  },
  {
    id: "long-form",
    label: "Books and long-form",
    description: "Original prose plus a documented public-domain excerpt.",
    acceptsFocus: true,
    source: "curated"
  },
  {
    id: "typing-test",
    label: "Typing test",
    description: "Seeded common-English sentences for repeatable tests.",
    acceptsFocus: false,
    source: "generated"
  },
  {
    id: "mixed",
    label: "Mixed transfer",
    description: "Natural English, data, punctuation, and pseudowords in one sample.",
    acceptsFocus: true,
    source: "mixed"
  }
]);

const CONTENT_MODE_IDS = new Set<PracticeContentModeId>(CONTENT_MODES.map((mode) => mode.id));

export interface GeneratePracticeTextOptions {
  readonly mode: PracticeContentModeId;
  readonly seed: Seed;
  /** Desired maximum number of Unicode characters. */
  readonly length: number;
  readonly focus?: FocusInput;
}

function repeatToLength(text: string, minimumLength: number, separator: string): string {
  const cleaned = text.trim();
  if (cleaned.length === 0) {
    throw new Error("Generated practice content was empty.");
  }
  let result = cleaned;
  while ([...result].length < minimumLength) {
    result += `${separator}${cleaned}`;
  }
  return result;
}

function trimAtReadableBoundary(text: string, maximumLength: number): string {
  const characters = [...text];
  if (characters.length <= maximumLength) {
    return text.trimEnd();
  }
  const prefix = characters.slice(0, maximumLength).join("");
  const minimumBoundary = Math.floor(maximumLength * 0.78);
  for (let index = prefix.length - 1; index >= minimumBoundary; index -= 1) {
    const character = prefix[index];
    if (character !== undefined && /[\s.,;:!?)}\]]/.test(character)) {
      return prefix.slice(0, index + 1).trimEnd();
    }
  }
  return prefix.trimEnd();
}

function fitText(text: string, length: number, separator = " "): string {
  return trimAtReadableBoundary(repeatToLength(text, length, separator), length);
}

function sentenceText(seed: Seed, length: number, focus: FocusInput | undefined): string {
  const count = Math.max(1, Math.ceil(length / 52) + 1);
  return generateCommonEnglishSentences({
    seed,
    count,
    ...(focus === undefined ? {} : { focus })
  })
    .map((entry) => entry.text)
    .join(" ");
}

function wordText(
  seed: Seed,
  length: number,
  focus: FocusInput | undefined,
  denseFocus: boolean
): string {
  const count = Math.max(3, Math.ceil(length / 5) + 2);
  const words = selectCommonWords({
    seed,
    count,
    minLength: denseFocus ? 2 : 1,
    maxLength: denseFocus ? 8 : 12,
    ...(focus === undefined ? {} : { focus })
  });
  return words.join(" ");
}

function pseudowordText(seed: Seed, length: number, focus: FocusInput | undefined): string {
  const count = Math.max(2, Math.ceil(length / 7) + 2);
  return generatePseudowords({
    seed,
    count,
    ...(focus === undefined ? {} : { focus })
  })
    .map((entry) => entry.text)
    .join(" ");
}

function shiftText(seed: Seed, length: number, focus: FocusInput | undefined): string {
  const words = selectCommonWords({
    seed,
    count: Math.max(4, Math.ceil(length / 6) + 2),
    minLength: 2,
    ...(focus === undefined ? {} : { focus })
  });
  return words
    .map((word, index) => {
      if (index % 7 === 5) {
        return word.toLocaleUpperCase("en-US");
      }
      if (index % 3 === 0) {
        return word.charAt(0).toLocaleUpperCase("en-US") + word.slice(1);
      }
      return word;
    })
    .join(" ");
}

function mixedText(seed: Seed, length: number, focus: FocusInput | undefined): string {
  const random = new SeededRandom(seed);
  const partLength = Math.max(24, Math.ceil(length / 4));
  const parts = [
    sentenceText(random.integer(0, 0xffff_ffff), partLength, focus),
    pseudowordText(random.integer(0, 0xffff_ffff), partLength, focus),
    generateDataEntryItems({ seed: random.integer(0, 0xffff_ffff), count: 5 })
      .map((entry) => entry.text)
      .join(" | "),
    selectPracticeSnippet({
      seed: random.integer(0, 0xffff_ffff),
      kind: "punctuation",
      ...(focus === undefined ? {} : { focus })
    }).text
  ];
  return random.shuffle(parts).join("\n");
}

/**
 * Stable high-level API used by the web and server packages. Generation is
 * deterministic for the same complete option object and never accesses a
 * network or ambient random source.
 */
export function generatePracticeText(options: GeneratePracticeTextOptions): string {
  if (!CONTENT_MODE_IDS.has(options.mode)) {
    throw new RangeError(`Unsupported practice content mode: ${String(options.mode)}`);
  }
  if (!Number.isInteger(options.length) || options.length < 20 || options.length > 20_000) {
    throw new RangeError("Practice text length must be an integer from 20 to 20000.");
  }

  const focus = options.focus;
  let generated: string;
  switch (options.mode) {
    case "smart":
      generated = sentenceText(`${options.seed}:smart`, options.length, focus);
      break;
    case "traditional":
      generated = wordText(`${options.seed}:traditional`, options.length, focus, false);
      break;
    case "weakness":
      generated = wordText(`${options.seed}:weakness`, options.length, focus, true);
      break;
    case "common-english":
    case "typing-test":
      generated = sentenceText(
        `${options.seed}:${options.mode}`,
        options.length,
        options.mode === "typing-test" ? undefined : focus
      );
      break;
    case "pseudowords":
      generated = pseudowordText(`${options.seed}:pseudowords`, options.length, focus);
      break;
    case "data-entry":
      generated = generateDataEntryItems({
        seed: `${options.seed}:data-entry`,
        count: Math.max(4, Math.ceil(options.length / 12) + 2)
      })
        .map((entry) => entry.text)
        .join(" | ");
      break;
    case "punctuation":
      generated = selectPracticeSnippet({
        seed: `${options.seed}:punctuation`,
        kind: "punctuation",
        ...(focus === undefined ? {} : { focus })
      }).text;
      break;
    case "shift":
      generated = shiftText(`${options.seed}:shift`, options.length, focus);
      break;
    case "source-code":
      generated = selectPracticeSnippet({
        seed: `${options.seed}:source-code`,
        kind: "code",
        ...(focus === undefined ? {} : { focus })
      }).text;
      break;
    case "long-form":
      generated = selectLongFormSample({
        seed: `${options.seed}:long-form`,
        ...(focus === undefined ? {} : { focus })
      }).text;
      break;
    case "mixed":
      generated = mixedText(`${options.seed}:mixed`, options.length, focus);
      break;
  }

  return fitText(generated, options.length, generated.includes("\n") ? "\n" : " ");
}
