import { countFocusHits, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { Seed } from "./types.js";

export interface LongFormSample {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly text: string;
  readonly wordCount: number;
  readonly paragraphCount: number;
  readonly sourceId: string;
  readonly licenseId: string;
  readonly provenance: "original" | "public-domain";
  readonly language: "en-US";
  readonly notes: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sample(
  definition: Omit<LongFormSample, "wordCount" | "paragraphCount" | "language">
): LongFormSample {
  return {
    ...definition,
    wordCount: countWords(definition.text),
    paragraphCount: definition.text.split(/\n\s*\n/).length,
    language: "en-US"
  };
}

export const LONG_FORM_SAMPLES: readonly LongFormSample[] = Object.freeze([
  sample({
    id: "quiet-workshop",
    title: "The Quiet Workshop",
    author: "SymType contributors",
    text: `Mara opened the workshop just after sunrise. The room was plain, but every object had a useful place. Pencils rested in a shallow blue tray, paper waited in three neat stacks, and a small clock made a soft sound above the door. She liked the first calm minutes of the day, before the street grew busy and the tables filled with half-finished ideas.

Her first task was simple: repair a wooden box whose lid would not close. She checked each corner, found one loose pin, and wrote the measurement in her notebook. Instead of rushing, she tested the hinge twice. The lid settled into place with a quiet click. Mara smiled, marked the task complete, and moved the box to the ready shelf.

By midmorning, two students arrived for their weekly lesson. Mara did not hand them a fixed set of steps. She asked each student to look closely, name the problem, and choose one careful action. When a piece slipped, they paused and tried again. When an idea worked, they explained why. The workshop stayed quiet, yet it never felt still. Small choices gathered into steady progress, one clear motion at a time.`,
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    provenance: "original",
    notes: "Original general-English practice prose written for SymType."
  }),
  sample({
    id: "market-in-light-rain",
    title: "A Market in Light Rain",
    author: "SymType contributors",
    text: `A light rain began as Eli reached the market square. No one hurried away. The baker pulled a striped cover over the bread, the flower seller moved her bright jars under the awning, and a child held both hands out to catch the smallest drops. The stone path turned silver, reflecting signs, baskets, and passing shoes.

Eli had come for apples, mint, and a roll of plain paper. He read his short list twice, then walked from stall to stall. At the fruit table, he chose six firm apples and placed them gently in a cloth bag. At the herb stand, he compared two bunches of mint before picking the one with the clearest scent. The paper took longer to find, but an older vendor pointed to a narrow shelf beside a stack of maps.

When the rain stopped, the square seemed brighter than before. Drops hung from the awnings, carts rolled across the wet stones, and the crowd found its rhythm again. Eli folded the list, thanked the vendor, and took the long way home through the garden.`,
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    provenance: "original",
    notes: "Original general-English practice prose written for SymType."
  }),
  sample({
    id: "wizard-of-oz-prairie-excerpt",
    title: "The Wonderful Wizard of Oz: Prairie excerpt",
    author: "L. Frank Baum",
    text: `Dorothy lived in the midst of the great Kansas prairies, with Uncle Henry, who was a farmer, and Aunt Em, who was the farmer's wife. Their house was small, for the lumber to build it had to be carried by wagon many miles. There were four walls, a floor and a roof, which made one room; and this room contained a rusty looking cookstove, a cupboard for the dishes, a table, three or four chairs, and the beds.

Uncle Henry never laughed. He worked hard from morning till night and did not know what joy was. He was gray also, from his long beard to his rough boots, and he looked stern and solemn, and rarely spoke.`,
    sourceId: "baum-wizard-oz-1900-chapter-1",
    licenseId: "public-domain-united-states",
    provenance: "public-domain",
    notes:
      "Short excerpt from a work published in 1900; see the bundled content notice for jurisdiction guidance."
  })
]);

export const BUILT_IN_LONG_FORM_TEXT_PREFIX = "builtin-long-form:";

/** Stable SQLite identity for bundled passages; the source ID remains separate provenance. */
export function builtInLongFormTextId(sampleId: string): string {
  if (!LONG_FORM_SAMPLES.some((sample) => sample.id === sampleId)) {
    throw new RangeError(`Unknown bundled long-form sample: ${sampleId}`);
  }
  return `${BUILT_IN_LONG_FORM_TEXT_PREFIX}${sampleId}`;
}

export function getLongFormSample(sampleId: string): LongFormSample | undefined {
  return LONG_FORM_SAMPLES.find((sample) => sample.id === sampleId);
}

export interface SelectLongFormOptions {
  readonly seed: Seed;
  readonly focus?: FocusInput;
  readonly provenance?: LongFormSample["provenance"];
}

export function selectLongFormSample(options: SelectLongFormOptions): LongFormSample {
  const candidates = LONG_FORM_SAMPLES.filter(
    (entry) => options.provenance === undefined || entry.provenance === options.provenance
  );
  if (candidates.length === 0) {
    throw new RangeError("No long-form sample matches the requested provenance.");
  }
  const random = new SeededRandom(options.seed);
  return random.weightedPick(candidates, (entry) => 1 + countFocusHits(entry.text, options.focus));
}
