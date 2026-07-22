import { countFocusHits, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { CodeLanguage, Seed } from "./types.js";

export interface PracticeSnippet {
  readonly id: string;
  readonly title: string;
  readonly language: CodeLanguage;
  readonly text: string;
  readonly tags: readonly string[];
  readonly sourceId: "symtype-original-practice-v1";
  readonly licenseId: "symtype-original-content-cc0";
  readonly safety: "benign-original-training-content";
}

export const PUNCTUATION_SNIPPETS: readonly PracticeSnippet[] = Object.freeze([
  {
    id: "punctuation-checklist",
    title: "A tidy checklist",
    language: "plain-text",
    text: "Pack three things: a map, a pen, and a small lamp. Ready? Yes; everything is here.",
    tags: ["colon", "comma", "question-mark", "semicolon"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "punctuation-quote",
    title: "A brief reply",
    language: "plain-text",
    text: '"Turn left, then pause," Mira said. "Did you see the blue sign?"',
    tags: ["quotes", "comma", "question-mark"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "punctuation-brackets",
    title: "Notes in pairs",
    language: "plain-text",
    text: "The note [marked 7] belongs beside the tray (not under it); the other note is blank.",
    tags: ["brackets", "parentheses", "semicolon"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  }
]);

export const CODE_SNIPPETS: readonly PracticeSnippet[] = Object.freeze([
  {
    id: "javascript-fruit-filter",
    title: "Filter a fruit tray",
    language: "javascript",
    text: 'const tray = ["lime", "mint", "peach"];\nconst ready = tray.filter((item) => item.length > 4);',
    tags: ["array", "arrow-function", "brackets"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "typescript-crate-type",
    title: "Describe a crate",
    language: "typescript",
    text: 'type Crate = { label: string; count: number };\nconst crate: Crate = { label: "sun-plum", count: 7 };',
    tags: ["type", "object", "punctuation"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "json-station-card",
    title: "Read a station card",
    language: "json",
    text: '{\n  "station": "pineapple-lab-fiction",\n  "active": true,\n  "items": 4\n}',
    tags: ["object", "quotes", "indentation"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "html-status-section",
    title: "Mark up a status note",
    language: "html",
    text: '<section aria-label="Fruit status">\n  <h2>Crate ready</h2>\n  <p>Three bright tags remain.</p>\n</section>',
    tags: ["tags", "attributes", "angle-brackets"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  },
  {
    id: "css-status-card",
    title: "Style a status card",
    language: "css",
    text: ".status-card {\n  display: grid;\n  gap: 0.75rem;\n  border: 1px solid currentColor;\n}",
    tags: ["braces", "colon", "semicolon"],
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    safety: "benign-original-training-content"
  }
]);

export interface SelectSnippetOptions {
  readonly seed: Seed;
  readonly focus?: FocusInput;
  readonly languages?: readonly CodeLanguage[];
  readonly kind?: "punctuation" | "code" | "any";
}

export function selectPracticeSnippet(options: SelectSnippetOptions): PracticeSnippet {
  const kind = options.kind ?? "any";
  const pool = [
    ...(kind === "code" ? [] : PUNCTUATION_SNIPPETS),
    ...(kind === "punctuation" ? [] : CODE_SNIPPETS)
  ].filter(
    (snippet) => options.languages === undefined || options.languages.includes(snippet.language)
  );
  if (pool.length === 0) {
    throw new RangeError("No practice snippet matches the requested filters.");
  }
  const random = new SeededRandom(options.seed);
  return random.weightedPick(
    pool,
    (snippet) => 1 + countFocusHits(snippet.text, options.focus) * 2
  );
}
