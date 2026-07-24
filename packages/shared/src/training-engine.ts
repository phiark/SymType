import { betaMean, betaVariance, type FeatureStats } from "./feature-stats.js";
import {
  getBindingForCharacter,
  SYMMETRIC_PRESET,
  type KeyboardPreset
} from "./keyboard-layout.js";

export interface RandomSource {
  next(): number;
}

function hashSeed(seed: string | number): number {
  const value = String(seed);
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Deterministic Mulberry32 PRNG for reproducible lessons and failures. */
export function createSeededRandom(seed: string | number): RandomSource {
  let state = hashSeed(seed);
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    }
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface PriorityWeights {
  readonly accuracy: number;
  readonly speed: number;
  readonly uncertainty: number;
  readonly errorRecovery: number;
  readonly forgetting: number;
  readonly transfer: number;
  readonly userFocus: number;
  readonly overusePenalty: number;
  readonly fatiguePenalty: number;
  readonly exploration: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = Object.freeze({
  accuracy: 0.42,
  speed: 0.3,
  uncertainty: 0.18,
  errorRecovery: 0.1,
  forgetting: 0.45,
  transfer: 0.25,
  userFocus: 0.35,
  overusePenalty: 0.3,
  fatiguePenalty: 0.35,
  exploration: 0.2
});

export interface PriorityInput {
  readonly accuracy: number;
  readonly targetAccuracy: number;
  readonly ikiMs: number | null;
  readonly targetIkiMs: number;
  readonly sampleCount: number;
  readonly uncertainty: number;
  readonly hoursSincePractice: number | null;
  readonly transferValue: number;
  readonly userFocus: number;
  readonly recentExposure: number;
  readonly fatigue: number;
  readonly errorRecoverySlowdown: number;
  readonly totalSamplesAcrossCandidates: number;
}

export interface PriorityBreakdown {
  readonly priority: number;
  readonly accuracyShortfall: number;
  readonly speedShortfall: number;
  readonly uncertainty: number;
  readonly confidenceGate: number;
  readonly forgettingBoost: number;
  readonly explorationBonus: number;
  readonly transferMultiplier: number;
  readonly focusMultiplier: number;
  readonly overusePenalty: number;
  readonly fatiguePenalty: number;
}

export function forgettingBoost(hoursSincePractice: number | null): number {
  if (hoursSincePractice === null) {
    return 1.25;
  }
  if (!Number.isFinite(hoursSincePractice) || hoursSincePractice < 0) {
    throw new RangeError("hoursSincePractice must be null or non-negative");
  }
  // No material boost during the same sitting; approaches 1.8 over long gaps.
  return Math.min(1.8, 1 + 0.18 * Math.log1p(hoursSincePractice / 12));
}

export function calculateAdaptivePriority(
  input: PriorityInput,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS
): PriorityBreakdown {
  if (
    !Number.isFinite(input.accuracy) ||
    !Number.isFinite(input.targetAccuracy) ||
    input.accuracy < 0 ||
    input.accuracy > 1 ||
    input.targetAccuracy <= 0 ||
    input.targetAccuracy > 1 ||
    !Number.isFinite(input.targetIkiMs) ||
    input.targetIkiMs <= 0 ||
    (input.ikiMs !== null && (!Number.isFinite(input.ikiMs) || input.ikiMs <= 0)) ||
    !Number.isFinite(input.sampleCount) ||
    input.sampleCount < 0 ||
    !Number.isFinite(input.totalSamplesAcrossCandidates) ||
    input.totalSamplesAcrossCandidates < 0 ||
    [
      input.uncertainty,
      input.transferValue,
      input.userFocus,
      input.recentExposure,
      input.fatigue,
      input.errorRecoverySlowdown
    ].some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new RangeError("Invalid adaptive-priority input");
  }
  const accuracyShortfall = clamp01(
    (input.targetAccuracy - input.accuracy) / Math.max(0.08, input.targetAccuracy - 0.75)
  );
  const speedShortfall =
    input.ikiMs === null ? 0.35 : clamp01((input.ikiMs - input.targetIkiMs) / input.targetIkiMs);
  const uncertainty = clamp01(input.uncertainty);
  // Evidence raises confidence, but the 0.45 floor prevents new items from
  // being multiplied to zero. UCB exploration separately seeks information.
  const confidenceGate = 0.45 + 0.55 * (1 - Math.exp(-input.sampleCount / 18));
  const forgetting = forgettingBoost(input.hoursSincePractice);
  const explorationBonus =
    weights.exploration *
    Math.sqrt(
      Math.log(Math.max(2, input.totalSamplesAcrossCandidates + 1)) /
        Math.max(1, input.sampleCount + 1)
    );
  const transferMultiplier = 1 + weights.transfer * clamp01(input.transferValue);
  const focusMultiplier = 1 + weights.userFocus * clamp01(input.userFocus);
  const overusePenalty = weights.overusePenalty * clamp01(input.recentExposure);
  const fatiguePenalty = weights.fatiguePenalty * clamp01(input.fatigue);
  const weightedShortfall =
    weights.accuracy * accuracyShortfall +
    weights.speed * speedShortfall +
    weights.uncertainty * uncertainty +
    weights.errorRecovery * clamp01(input.errorRecoverySlowdown);
  const positive =
    weightedShortfall *
      confidenceGate *
      (1 + weights.forgetting * (forgetting - 1)) *
      transferMultiplier *
      focusMultiplier +
    explorationBonus;
  return {
    priority: Math.max(0, positive - overusePenalty - fatiguePenalty),
    accuracyShortfall,
    speedShortfall,
    uncertainty,
    confidenceGate,
    forgettingBoost: forgetting,
    explorationBonus,
    transferMultiplier,
    focusMultiplier,
    overusePenalty,
    fatiguePenalty
  };
}

export interface SchedulableFeature {
  readonly id: string;
  readonly kind: string;
  readonly stats: FeatureStats;
  readonly targetIkiMs: number;
  readonly transferValue?: number;
  readonly userFocus?: number;
  readonly recentExposure?: number;
  readonly fatigue?: number;
  readonly errorRecoverySlowdown?: number;
}

export interface ScheduledFeature extends SchedulableFeature {
  readonly priority: number;
  readonly explanation: string;
  readonly breakdown: PriorityBreakdown;
}

function featurePriorityInput(
  feature: SchedulableFeature,
  nowMs: number,
  totalSamples: number,
  targetAccuracy: number
): PriorityInput {
  const hoursSincePractice =
    feature.stats.lastPracticedAtMs === null
      ? null
      : Math.max(0, nowMs - feature.stats.lastPracticedAtMs) / 3_600_000;
  return {
    accuracy: betaMean(feature.stats.shortAccuracy),
    targetAccuracy,
    ikiMs: feature.stats.shortIkiMs,
    targetIkiMs: feature.targetIkiMs,
    sampleCount: feature.stats.sampleCount,
    uncertainty: Math.min(1, Math.sqrt(betaVariance(feature.stats.shortAccuracy)) * 8),
    hoursSincePractice,
    transferValue: feature.transferValue ?? 0.5,
    userFocus: feature.userFocus ?? 0,
    recentExposure: feature.recentExposure ?? 0,
    fatigue: feature.fatigue ?? 0,
    errorRecoverySlowdown: feature.errorRecoverySlowdown ?? 0,
    totalSamplesAcrossCandidates: totalSamples
  };
}

export function scheduleAdaptiveFeatures(
  features: readonly SchedulableFeature[],
  options: {
    readonly seed: string | number;
    readonly nowMs: number;
    readonly count?: number;
    readonly targetAccuracy?: number;
    readonly weights?: PriorityWeights;
  }
): ScheduledFeature[] {
  const count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("count must be a positive integer");
  }
  const random = createSeededRandom(options.seed);
  const totalSamples = features.reduce((sum, feature) => sum + feature.stats.sampleCount, 0);
  return features
    .map((feature): ScheduledFeature => {
      const breakdown = calculateAdaptivePriority(
        featurePriorityInput(feature, options.nowMs, totalSamples, options.targetAccuracy ?? 0.97),
        options.weights ?? DEFAULT_PRIORITY_WEIGHTS
      );
      const accuracy = betaMean(feature.stats.shortAccuracy);
      const reason =
        feature.stats.sampleCount < 8
          ? "样本较少，安排探索复测"
          : accuracy < (options.targetAccuracy ?? 0.97)
            ? `短期准确率 ${Math.round(accuracy * 100)}%，低于目标`
            : feature.stats.shortIkiMs !== null && feature.stats.shortIkiMs > feature.targetIkiMs
              ? `中位节奏估计慢于目标 ${Math.round(feature.stats.shortIkiMs - feature.targetIkiMs)} ms`
              : "间隔复测以检查保留";
      return {
        ...feature,
        priority: breakdown.priority + random.next() * 1e-9,
        explanation: reason,
        breakdown
      };
    })
    .sort((first, second) => second.priority - first.priority)
    .slice(0, Math.min(count, features.length));
}

/**
 * Deterministic single-character scheduler used only as a local comparator.
 * It intentionally ignores bigrams, trigrams and transfer context.
 */
export function scheduleKeybrLikeBaseline(
  features: readonly SchedulableFeature[],
  options: {
    readonly seed: string | number;
    readonly count?: number;
    readonly targetAccuracy?: number;
  }
): ScheduledFeature[] {
  const random = createSeededRandom(options.seed);
  const count = options.count ?? 3;
  const targetAccuracy = options.targetAccuracy ?? 0.97;
  const characterFeatures = features.filter(
    (feature) => feature.kind === "character" || feature.kind === "shifted-character"
  );
  const totalSamples = characterFeatures.reduce(
    (sum, feature) => sum + feature.stats.sampleCount,
    0
  );
  return characterFeatures
    .map((feature): ScheduledFeature => {
      const accuracy = betaMean(feature.stats.shortAccuracy);
      const accuracyGap = clamp01((targetAccuracy - accuracy) / 0.2);
      const speedGap =
        feature.stats.shortIkiMs === null
          ? 0.35
          : clamp01((feature.stats.shortIkiMs - feature.targetIkiMs) / feature.targetIkiMs);
      const exploration = Math.sqrt(
        Math.log(Math.max(2, totalSamples + 1)) / (feature.stats.sampleCount + 1)
      );
      const priority =
        0.6 * accuracyGap +
        0.3 * speedGap +
        0.1 * exploration -
        0.2 * clamp01(feature.recentExposure ?? 0) +
        random.next() * 1e-9;
      const breakdown = calculateAdaptivePriority({
        accuracy,
        targetAccuracy,
        ikiMs: feature.stats.shortIkiMs,
        targetIkiMs: feature.targetIkiMs,
        sampleCount: feature.stats.sampleCount,
        uncertainty: Math.min(1, exploration),
        hoursSincePractice: null,
        transferValue: 0,
        userFocus: 0,
        recentExposure: feature.recentExposure ?? 0,
        fatigue: 0,
        errorRecoverySlowdown: 0,
        totalSamplesAcrossCandidates: totalSamples
      });
      return {
        ...feature,
        priority: Math.max(0, priority),
        explanation:
          feature.stats.sampleCount < 8
            ? "单字符样本较少"
            : accuracyGap >= speedGap
              ? "单字符准确率短板"
              : "单字符速度短板",
        breakdown
      };
    })
    .sort((first, second) => second.priority - first.priority)
    .slice(0, Math.min(count, characterFeatures.length));
}

export type MicroBlockPhase =
  "warmup" | "blocked" | "interleave" | "transfer" | "fluency" | "explore";

export interface TextCandidate {
  readonly id: string;
  readonly text: string;
  readonly features: readonly string[];
  readonly naturalness: number;
  readonly difficulty: number;
  readonly recentUses?: number;
  readonly category?: string;
}

export interface MicroBlockOptions {
  readonly seed: string | number;
  readonly phase: MicroBlockPhase;
  readonly focusFeatures: readonly string[];
  readonly candidates: readonly TextCandidate[];
  readonly targetLength?: number;
  readonly minimumLength?: number;
  readonly maximumLength?: number;
  readonly targetDifficulty?: number;
  readonly allowedCategories?: readonly string[];
  readonly keyboardPreset?: KeyboardPreset;
}

export interface CandidateScore {
  readonly id: string;
  readonly score: number;
  readonly focusDensity: number;
  readonly naturalness: number;
  readonly difficultyFit: number;
  readonly alternation: number;
  readonly sameFingerLoad: number;
  readonly repetitionPenalty: number;
}

function countOccurrences(text: string, feature: string): number {
  const token = feature.replace(/^(key|char|bigram|trigram):/, "");
  if (token.length === 0) {
    return 0;
  }
  let count = 0;
  let position = 0;
  while (position <= text.length - token.length) {
    const found = text.indexOf(token, position);
    if (found < 0) {
      break;
    }
    count += 1;
    position = found + 1;
  }
  return count;
}

function featureDisplayLabel(feature: string): string {
  const token = feature.replace(/^(key|char|bigram|trigram):/, "");
  return feature.startsWith("bigram:") || feature.startsWith("trigram:")
    ? [...token].join("→")
    : token;
}

function handPatternMetrics(
  text: string,
  preset: KeyboardPreset
): { alternation: number; sameFingerLoad: number } {
  const bindings = Array.from(text)
    .map((character) => getBindingForCharacter(preset, character))
    .filter((binding) => binding !== undefined && binding.key.hand !== "thumb");
  if (bindings.length < 2) {
    return { alternation: 0.5, sameFingerLoad: 0 };
  }
  let alternations = 0;
  let sameFinger = 0;
  for (let index = 1; index < bindings.length; index += 1) {
    const previous = bindings[index - 1];
    const current = bindings[index];
    if (previous !== undefined && current !== undefined) {
      alternations += previous.key.hand === current.key.hand ? 0 : 1;
      sameFinger += previous.key.finger === current.key.finger ? 1 : 0;
    }
  }
  return {
    alternation: alternations / (bindings.length - 1),
    sameFingerLoad: sameFinger / (bindings.length - 1)
  };
}

export function scoreTextCandidate(
  candidate: TextCandidate,
  options: Pick<
    MicroBlockOptions,
    "phase" | "focusFeatures" | "targetDifficulty" | "keyboardPreset"
  >
): CandidateScore {
  const characters = Math.max(1, Array.from(candidate.text).length);
  const focusHits = options.focusFeatures.reduce(
    (sum, feature) => sum + countOccurrences(candidate.text, feature),
    0
  );
  const focusDensity = clamp01((focusHits * 2) / characters);
  const naturalness = clamp01(candidate.naturalness);
  const targetDifficulty = clamp01(options.targetDifficulty ?? 0.5);
  const difficultyFit = 1 - Math.min(1, Math.abs(candidate.difficulty - targetDifficulty));
  const { alternation, sameFingerLoad } = handPatternMetrics(
    candidate.text,
    options.keyboardPreset ?? SYMMETRIC_PRESET
  );
  const repetitionPenalty = Math.min(1, (candidate.recentUses ?? 0) / 5);
  const phaseWeights: Record<
    MicroBlockPhase,
    { focus: number; natural: number; difficulty: number; alternation: number }
  > = {
    warmup: { focus: 0.2, natural: 0.3, difficulty: 0.35, alternation: 0.15 },
    blocked: { focus: 0.55, natural: 0.1, difficulty: 0.2, alternation: 0.15 },
    interleave: { focus: 0.35, natural: 0.2, difficulty: 0.2, alternation: 0.25 },
    transfer: { focus: 0.25, natural: 0.45, difficulty: 0.2, alternation: 0.1 },
    fluency: { focus: 0.1, natural: 0.45, difficulty: 0.25, alternation: 0.2 },
    explore: { focus: 0.15, natural: 0.25, difficulty: 0.35, alternation: 0.25 }
  };
  const weights = phaseWeights[options.phase];
  const score =
    weights.focus * focusDensity +
    weights.natural * naturalness +
    weights.difficulty * difficultyFit +
    weights.alternation * alternation -
    0.15 * repetitionPenalty -
    (options.phase === "blocked" ? 0.05 : 0.15) * sameFingerLoad;
  return {
    id: candidate.id,
    score,
    focusDensity,
    naturalness,
    difficultyFit,
    alternation,
    sameFingerLoad,
    repetitionPenalty
  };
}

export interface GeneratedMicroBlock {
  readonly text: string;
  readonly phase: MicroBlockPhase;
  readonly focusFeatures: readonly string[];
  readonly candidateIds: readonly string[];
  readonly length: number;
  readonly score: number;
  readonly explanation: string;
  readonly seed: string | number;
}

const SAFE_PSEUDOWORDS = ["lanter", "pinvor", "melkin", "sorven", "talper", "nembit"] as const;

function fallbackText(random: RandomSource, targetLength: number): string {
  let text = "";
  while (text.length < targetLength) {
    const word =
      SAFE_PSEUDOWORDS[Math.floor(random.next() * SAFE_PSEUDOWORDS.length)] ?? SAFE_PSEUDOWORDS[0];
    text += text.length === 0 ? word : ` ${word}`;
  }
  return text.slice(0, targetLength).trimEnd();
}

export function generateMicroBlock(options: MicroBlockOptions): GeneratedMicroBlock {
  const minimumLength = options.minimumLength ?? 20;
  const maximumLength = options.maximumLength ?? 60;
  if (
    !Number.isInteger(minimumLength) ||
    !Number.isInteger(maximumLength) ||
    minimumLength < 1 ||
    maximumLength < minimumLength
  ) {
    throw new RangeError("Micro-block bounds must be positive ordered integers");
  }
  const targetLength = Math.max(minimumLength, Math.min(maximumLength, options.targetLength ?? 40));
  const allowed =
    options.allowedCategories === undefined
      ? options.candidates
      : options.candidates.filter(
          (candidate) =>
            candidate.category !== undefined &&
            options.allowedCategories?.includes(candidate.category) === true
        );
  const candidates = allowed.filter(
    (candidate) =>
      candidate.text.trim().length > 0 &&
      Number.isFinite(candidate.naturalness) &&
      Number.isFinite(candidate.difficulty)
  );
  const random = createSeededRandom(options.seed);
  if (candidates.length === 0) {
    const text = fallbackText(random, targetLength);
    return {
      text,
      phase: options.phase,
      focusFeatures: [...options.focusFeatures],
      candidateIds: [],
      length: Array.from(text).length,
      score: 0,
      explanation: "候选内容不足，使用明确标注的安全伪词作为探索样本",
      seed: options.seed
    };
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      scoring: scoreTextCandidate(candidate, options),
      jitter: random.next() * 0.08
    }))
    .sort(
      (first, second) => second.scoring.score + second.jitter - (first.scoring.score + first.jitter)
    );
  // Scheduled sequences must actually occur as sequences in the visible block.
  // Put one explicitly tagged candidate per typed focus first; character
  // weighting alone would incorrectly turn `bigram:ct` into separate c/t
  // exposure. The normal rank order still governs the remainder.
  const requiredItems: typeof ranked = [];
  for (const focus of options.focusFeatures) {
    const item = ranked.find(
      (candidate) =>
        !requiredItems.includes(candidate) &&
        candidate.candidate.features.includes(focus) &&
        countOccurrences(candidate.candidate.text, focus) > 0
    );
    if (item) requiredItems.push(item);
  }
  const ordered = [...requiredItems, ...ranked.filter((item) => !requiredItems.includes(item))];
  let text = "";
  const ids: string[] = [];
  let scoreTotal = 0;
  let cursor = 0;
  let lastSelectedText = "";
  // The hard cap guarantees malformed candidate sets cannot cause a loop.
  for (let step = 0; step < 128 && text.length < targetLength; step += 1) {
    const item = ordered[cursor % ordered.length];
    cursor += 1;
    if (item === undefined) {
      break;
    }
    const separator = text.length === 0 ? "" : " ";
    const remaining = targetLength - text.length;
    const selectedText = item.candidate.text.trim();
    const addition = `${separator}${selectedText}`;
    text += addition.slice(0, remaining);
    lastSelectedText = selectedText;
    ids.push(item.candidate.id);
    scoreTotal += item.scoring.score;
  }
  if (text.length < minimumLength) {
    const fill = fallbackText(random, targetLength - text.length + 1);
    text = `${text} ${fill}`.slice(0, targetLength).trimEnd();
  }
  text = text.trimEnd();
  if (text.length < minimumLength) {
    const needed = minimumLength - text.length;
    const fillSource = lastSelectedText || ordered[0]!.candidate.text.trim();
    const repetitions = Math.ceil(needed / fillSource.length);
    text += fillSource.repeat(repetitions).slice(0, needed);
  }
  const explanation =
    options.phase === "blocked"
      ? `集中练习 ${options.focusFeatures.slice(0, 3).map(featureDisplayLabel).join("、") || "当前弱项"}`
      : options.phase === "transfer"
        ? "把近期弱项放入更自然的上下文，检查迁移"
        : options.phase === "interleave"
          ? "在弱项与已学组合之间交错，降低连续轰炸"
          : `${options.phase} 微组：兼顾难度、节奏与探索`;
  return {
    text,
    phase: options.phase,
    focusFeatures: [...options.focusFeatures],
    candidateIds: ids,
    length: Array.from(text).length,
    score: ids.length === 0 ? 0 : scoreTotal / ids.length,
    explanation,
    seed: options.seed
  };
}

export interface LessonPhaseAllocation {
  readonly phase: MicroBlockPhase;
  readonly fraction: number;
}

export interface DifficultyPolicy {
  readonly accuracyFloor: number;
  readonly promotionAccuracy: number;
  readonly minimumStableSamples: number;
  readonly step: number;
}

export const DEFAULT_DIFFICULTY_POLICY: DifficultyPolicy = Object.freeze({
  accuracyFloor: 0.94,
  promotionAccuracy: 0.975,
  minimumStableSamples: 30,
  step: 0.08
});

export interface DifficultyAdjustment {
  readonly difficulty: number;
  readonly direction: "decrease" | "hold" | "increase";
  readonly reason: string;
}

export function adjustDifficulty(
  currentDifficulty: number,
  accuracy: number,
  stableSamples: number,
  fatigue: number,
  policy: DifficultyPolicy = DEFAULT_DIFFICULTY_POLICY
): DifficultyAdjustment {
  if (
    !Number.isFinite(currentDifficulty) ||
    currentDifficulty < 0 ||
    currentDifficulty > 1 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 1 ||
    !Number.isInteger(stableSamples) ||
    stableSamples < 0 ||
    !Number.isFinite(fatigue) ||
    fatigue < 0 ||
    fatigue > 1
  ) {
    throw new RangeError("Invalid difficulty-adjustment input");
  }
  if (accuracy < policy.accuracyFloor || fatigue >= 0.65) {
    return {
      difficulty: Math.max(0, currentDifficulty - policy.step),
      direction: "decrease",
      reason:
        fatigue >= 0.65
          ? "近期速度、准确率与离散度共同恶化，先降低负荷"
          : `准确率低于 ${Math.round(policy.accuracyFloor * 100)}% 保护线，先巩固动作`
    };
  }
  if (
    accuracy >= policy.promotionAccuracy &&
    stableSamples >= policy.minimumStableSamples &&
    fatigue < 0.4
  ) {
    return {
      difficulty: Math.min(1, currentDifficulty + policy.step),
      direction: "increase",
      reason: `在 ${stableSamples} 个稳定样本中达到晋级准确率，适度提高难度`
    };
  }
  return {
    difficulty: currentDifficulty,
    direction: "hold",
    reason:
      stableSamples < policy.minimumStableSamples
        ? "样本尚不足，维持难度继续观察"
        : "表现处于保护线与晋级线之间，维持当前难度"
  };
}

export function allocateLessonPhases(
  accuracy: number,
  durationMinutes: number,
  policy: Pick<DifficultyPolicy, "accuracyFloor" | "promotionAccuracy"> = DEFAULT_DIFFICULTY_POLICY
): readonly LessonPhaseAllocation[] {
  if (
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 1 ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    throw new RangeError("accuracy and duration must be positive and in range");
  }
  const isShort = durationMinutes <= 5;
  const warmup = isShort ? 0.1 : 0.08;
  const blocked =
    accuracy < policy.accuracyFloor ? 0.45 : accuracy >= policy.promotionAccuracy ? 0.35 : 0.4;
  const transfer =
    accuracy >= policy.promotionAccuracy
      ? 0.25
      : isShort && accuracy < policy.accuracyFloor
        ? 0.18
        : 0.2;
  const review = 0.2;
  const remainder = 1 - warmup - blocked - transfer - review;
  return [
    { phase: "warmup", fraction: warmup },
    { phase: "blocked", fraction: blocked },
    { phase: "interleave", fraction: review },
    { phase: "transfer", fraction: transfer },
    { phase: "fluency", fraction: remainder }
  ];
}
