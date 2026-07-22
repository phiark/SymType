import { countFocusHits, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { Seed } from "./types.js";

export interface SentenceTemplate {
  readonly id: string;
  readonly template: string;
  readonly tone: "plain" | "question" | "dialogue";
  readonly sourceId: "symtype-original-practice-v1";
}

const SLOTS = Object.freeze({
  adjective: ["amazing", "bright", "calm", "clear", "gentle", "quiet", "small", "steady", "warm"],
  subject: [
    "artist",
    "baker",
    "gardener",
    "juggler",
    "maker",
    "musician",
    "quiz maker",
    "reader",
    "student",
    "teacher"
  ],
  verb: ["checks", "carries", "finds", "keeps", "makes", "opens", "reads", "writes"],
  baseVerb: ["check", "carry", "find", "keep", "make", "open", "read", "write"],
  object: [
    "a careful note",
    "a clean page",
    "a dozen puzzle cards",
    "a fresh idea",
    "a short list",
    "the final line",
    "the next chapter",
    "the simple plan",
    "three blue cards"
  ],
  place: [
    "at the corner table",
    "beside the open window",
    "in the quiet room",
    "near the garden gate",
    "under the warm lamp"
  ],
  pluralSubject: ["friends", "readers", "students", "teachers", "travelers", "writers"],
  pluralVerb: ["build", "check", "find", "keep", "notice", "practice", "share", "write"],
  time: ["after lunch", "at first light", "before noon", "each evening", "every morning"]
} as const);

type SlotName = keyof typeof SLOTS;

export const COMMON_ENGLISH_SENTENCE_TEMPLATES: readonly SentenceTemplate[] = Object.freeze([
  {
    id: "simple-observation",
    template: "The {adjective} {subject} {verb} {object}.",
    tone: "plain",
    sourceId: "symtype-original-practice-v1"
  },
  {
    id: "place-observation",
    template: "The {subject} {verb} {object} {place}.",
    tone: "plain",
    sourceId: "symtype-original-practice-v1"
  },
  {
    id: "timed-routine",
    template: "{time}, the {subject} {verb} {object}.",
    tone: "plain",
    sourceId: "symtype-original-practice-v1"
  },
  {
    id: "plural-routine",
    template: "{pluralSubject} {pluralVerb} together {place}.",
    tone: "plain",
    sourceId: "symtype-original-practice-v1"
  },
  {
    id: "gentle-question",
    template: "Can the {adjective} {subject} {baseVerb} {object}?",
    tone: "question",
    sourceId: "symtype-original-practice-v1"
  },
  {
    id: "short-dialogue",
    template: '"Please {pluralVerb} {object}," said the {subject}.',
    tone: "dialogue",
    sourceId: "symtype-original-practice-v1"
  }
]);

export interface GeneratedSentence {
  readonly id: string;
  readonly text: string;
  readonly templateId: string;
  readonly wordCount: number;
  readonly focusHits: number;
  readonly sourceId: "symtype-original-practice-v1";
}

export interface GenerateSentencesOptions {
  readonly seed: Seed;
  readonly count: number;
  readonly focus?: FocusInput;
  readonly allowedTones?: readonly SentenceTemplate["tone"][];
}

function renderTemplate(template: string, random: SeededRandom): string {
  return template.replaceAll(/\{([A-Za-z]+)\}/g, (_match: string, rawSlot: string) => {
    if (!(rawSlot in SLOTS)) {
      throw new Error(`Unknown sentence slot: ${rawSlot}`);
    }
    return random.pick(SLOTS[rawSlot as SlotName]);
  });
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function generateCommonEnglishSentences(
  options: GenerateSentencesOptions
): readonly GeneratedSentence[] {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new RangeError("Sentence count must be a positive integer.");
  }
  const tones = new Set(options.allowedTones ?? ["plain", "question", "dialogue"]);
  const templates = COMMON_ENGLISH_SENTENCE_TEMPLATES.filter((template) =>
    tones.has(template.tone)
  );
  if (templates.length === 0) {
    throw new RangeError("At least one sentence tone must be enabled.");
  }

  const random = new SeededRandom(options.seed);
  const results: GeneratedSentence[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const candidates = Array.from({ length: 8 }, () => {
      const template = random.pick(templates);
      const text = renderTemplate(template.template, random);
      return { template, text, focusHits: countFocusHits(text, options.focus) };
    });
    const selected = random.weightedPick(candidates, (candidate) => 1 + candidate.focusHits * 2);
    results.push({
      id: `sentence-${String(index + 1).padStart(3, "0")}`,
      text: selected.text,
      templateId: selected.template.id,
      wordCount: countWords(selected.text),
      focusHits: selected.focusHits,
      sourceId: "symtype-original-practice-v1"
    });
  }
  return results;
}
