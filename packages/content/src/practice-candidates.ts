import { generatePracticeText } from "./practice.js";
import type { PracticeContentModeId, Seed } from "./types.js";

/**
 * Structural counterpart of the shared training engine's TextCandidate.  The
 * content package intentionally does not depend on the scheduler package, so
 * the server can pass these values across that boundary without a dependency
 * cycle.
 */
export interface PracticeTextCandidate {
  readonly id: string;
  readonly text: string;
  readonly features: readonly string[];
  readonly naturalness: number;
  readonly difficulty: number;
  readonly recentUses?: number;
  readonly category: string;
}

export interface GeneratePracticeCandidatesOptions {
  readonly mode: PracticeContentModeId;
  readonly seed: Seed;
  readonly length: number;
  /** Typed scheduler IDs such as `key:c`, `bigram:ct`, and `trigram:the`. */
  readonly focusFeatures: readonly string[];
  readonly count?: number;
}

const FEATURE_ID = /^(key|char|bigram|trigram):(.+)$/u;
const SAFE_FILL_WORDS = ["calm", "clear", "steady", "short", "lesson", "rhythm"] as const;

export function practiceFeatureValue(featureId: string): string {
  return FEATURE_ID.exec(featureId)?.[2] ?? featureId;
}

function isTypedPracticeFeature(featureId: string): boolean {
  const match = FEATURE_ID.exec(featureId);
  if (!match) return false;
  const kind = match[1];
  const length = [...(match[2] ?? "")].length;
  if (kind === "key" || kind === "char") return length === 1;
  if (kind === "bigram") return length === 2;
  return length === 3;
}

function containsFeature(text: string, featureId: string): boolean {
  const value = practiceFeatureValue(featureId);
  if (value.length === 0) return false;
  return text.toLocaleLowerCase("en-US").includes(value.toLocaleLowerCase("en-US"));
}

function naturalnessForMode(mode: PracticeContentModeId): number {
  if (mode === "common-english" || mode === "typing-test" || mode === "long-form") return 0.95;
  if (mode === "smart" || mode === "traditional" || mode === "mixed") return 0.82;
  if (mode === "source-code" || mode === "punctuation" || mode === "shift") return 0.72;
  if (mode === "pseudowords" || mode === "weakness") return 0.58;
  return 0.65;
}

function focusedDrillText(featureId: string, length: number, offset: number): string {
  const token = practiceFeatureValue(featureId);
  const words = [token];
  let cursor = 0;
  while ([...words.join(" ")].length < length) {
    words.push(SAFE_FILL_WORDS[(cursor + offset) % SAFE_FILL_WORDS.length] ?? "steady");
    // Reintroduce the feature frequently without separating a bigram/trigram
    // into independent character drills.
    if (cursor % 2 === 1) words.push(token);
    cursor += 1;
  }
  return [...words.join(" ")].slice(0, length).join("").trimEnd();
}

/**
 * Builds a deterministic candidate pool for runtime micro-block scoring.
 * Every typed focus ID remains intact, and every valid focus ID receives a
 * candidate that begins with its exact token.  That makes sequence exposure a
 * hard content invariant rather than an accidental consequence of weighting
 * the sequence's individual characters.
 */
export function generatePracticeCandidates(
  options: GeneratePracticeCandidatesOptions
): readonly PracticeTextCandidate[] {
  const count = options.count ?? 8;
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    throw new RangeError("Candidate count must be an integer from 1 to 32.");
  }
  if (!Number.isInteger(options.length) || options.length < 20 || options.length > 120) {
    throw new RangeError("Candidate length must be an integer from 20 to 120.");
  }

  const focusFeatures = [...new Set(options.focusFeatures.filter(isTypedPracticeFeature))].slice(
    0,
    3
  );
  const focusValues = focusFeatures.map(practiceFeatureValue);
  const naturalness = naturalnessForMode(options.mode);
  const largestToken = Math.max(1, ...focusValues.map((value) => [...value].length));
  const separators = Math.max(0, focusFeatures.length - 1);
  const focusedLength = Math.max(
    largestToken,
    Math.min(18, Math.floor((options.length - separators) / Math.max(1, focusFeatures.length)))
  );
  const generated: PracticeTextCandidate[] = Array.from({ length: count }, (_, index) => {
    const text = generatePracticeText({
      mode: options.mode,
      seed: `${String(options.seed)}:candidate:${String(index)}`,
      length: options.length,
      ...(focusValues.length === 0 ? {} : { focus: focusValues })
    });
    return {
      id: `${options.mode}:generated:${String(index)}`,
      text,
      features: focusFeatures.filter((feature) => containsFeature(text, feature)),
      naturalness,
      difficulty: Math.min(0.9, 0.35 + index * 0.04),
      category: options.mode
    };
  });

  const focused = focusFeatures.map((feature, index): PracticeTextCandidate => ({
    id: `${options.mode}:focus:${encodeURIComponent(feature)}`,
    text: focusedDrillText(feature, focusedLength, index),
    features: [feature],
    naturalness: feature.startsWith("key:") || feature.startsWith("char:") ? 0.5 : 0.38,
    difficulty: feature.startsWith("trigram:") ? 0.72 : feature.startsWith("bigram:") ? 0.62 : 0.48,
    category: options.mode
  }));

  return [...focused, ...generated];
}
