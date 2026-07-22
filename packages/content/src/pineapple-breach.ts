import { countFocusHits, type FocusInput } from "./focus.js";
import { SeededRandom } from "./seed.js";
import type { GameDifficulty, PineappleLevelId, Seed } from "./types.js";

export interface GameTarget {
  readonly id: string;
  readonly text: string;
  readonly kind: "short-string" | "natural-text" | "safe-pseudocode" | "fictional-prop";
  readonly safetyLabel: "fictional-local-training-only";
}

export interface GameStageDefinition {
  readonly stage: 1 | 2 | 3;
  readonly title: string;
  readonly instruction: string;
  readonly targets: readonly GameTarget[];
}

export interface AlertRules {
  readonly maximum: 100;
  readonly errorIncrease: number;
  readonly longPauseAfterMilliseconds: number;
  readonly longPauseIncrease: number;
  readonly timeoutIncrease: 100;
  readonly accurateStreakLength: number;
  readonly accurateStreakDecrease: number;
  readonly minimum: 0;
}

export interface DifficultyTuning {
  readonly timeLimitSeconds: number;
  readonly requiredKeystrokeAccuracy: number;
  readonly targetCountPerStage: number;
  readonly selectionMode: "seeded-balanced" | "seeded-demanding" | "weakness-weighted";
  readonly alert: AlertRules;
}

const WEAKNESS_BOOST_BY_SELECTION_MODE = Object.freeze({
  "seeded-balanced": 1.5,
  "seeded-demanding": 2.5,
  "weakness-weighted": 4
} satisfies Record<DifficultyTuning["selectionMode"], number>);

export interface PineappleBreachLevel {
  readonly id: PineappleLevelId;
  readonly order: 1 | 2 | 3 | 4 | 5 | 6;
  readonly title: string;
  readonly displayName: string;
  readonly skillFocus: readonly string[];
  readonly briefing: string;
  readonly successStory: string;
  readonly safetyNotice: string;
  readonly sourceId: "symtype-original-practice-v1";
  readonly licenseId: "symtype-original-content-cc0";
  readonly stages: readonly GameStageDefinition[];
  readonly difficulties: Readonly<Record<GameDifficulty, DifficultyTuning>>;
}

export const GAME_RESET_POLICY = Object.freeze({
  campaign: "restart-current-level-from-stage-1" as const,
  hardcore: "restart-run-from-level-1" as const,
  retainCompletedEarlierLevelsInCampaign: true,
  retainInLevelCheckpointAfterFailure: false
});

function tuning(
  baseSeconds: number,
  accuracy: number
): Readonly<Record<GameDifficulty, DifficultyTuning>> {
  return Object.freeze({
    standard: {
      timeLimitSeconds: baseSeconds,
      requiredKeystrokeAccuracy: accuracy,
      targetCountPerStage: 2,
      selectionMode: "seeded-balanced",
      alert: {
        maximum: 100,
        errorIncrease: 14,
        longPauseAfterMilliseconds: 3_200,
        longPauseIncrease: 7,
        timeoutIncrease: 100,
        accurateStreakLength: 8,
        accurateStreakDecrease: 4,
        minimum: 0
      }
    },
    hard: {
      timeLimitSeconds: Math.max(18, Math.round(baseSeconds * 0.72)),
      requiredKeystrokeAccuracy: Math.min(0.99, accuracy + 0.04),
      targetCountPerStage: 3,
      selectionMode: "seeded-demanding",
      alert: {
        maximum: 100,
        errorIncrease: 19,
        longPauseAfterMilliseconds: 2_400,
        longPauseIncrease: 10,
        timeoutIncrease: 100,
        accurateStreakLength: 10,
        accurateStreakDecrease: 3,
        minimum: 0
      }
    },
    adaptive: {
      timeLimitSeconds: Math.max(22, Math.round(baseSeconds * 0.88)),
      requiredKeystrokeAccuracy: Math.min(0.98, accuracy + 0.02),
      targetCountPerStage: 2,
      selectionMode: "weakness-weighted",
      alert: {
        maximum: 100,
        errorIncrease: 16,
        longPauseAfterMilliseconds: 2_800,
        longPauseIncrease: 8,
        timeoutIncrease: 100,
        accurateStreakLength: 9,
        accurateStreakDecrease: 4,
        minimum: 0
      }
    }
  });
}

function target(id: string, text: string, kind: GameTarget["kind"] = "short-string"): GameTarget {
  return { id, text, kind, safetyLabel: "fictional-local-training-only" };
}

export const PINEAPPLE_BREACH_LEVELS: readonly PineappleBreachLevel[] = Object.freeze([
  {
    id: "signal-sync",
    order: 1,
    title: "Port Scan",
    displayName: "Signal Sync",
    skillFocus: ["short strings", "accuracy", "steady rhythm"],
    briefing:
      "Match the glowing fruit-console labels. This is a theatrical signal board, not a real network tool.",
    successStory:
      "The cardboard signal board glows green, and the rehearsal moves to the next scene.",
    safetyNotice: "Every label is invented for an offline typing game.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(54, 0.9),
    stages: [
      {
        stage: 1,
        title: "Warm signal",
        instruction: "Type each short label exactly as shown.",
        targets: [target("sig-1-a", "fyn"), target("sig-1-b", "jun"), target("sig-1-c", "mint")]
      },
      {
        stage: 2,
        title: "Stable pulse",
        instruction: "Keep an even pace through the longer labels.",
        targets: [target("sig-2-a", "palm"), target("sig-2-b", "cove"), target("sig-2-c", "bright")]
      },
      {
        stage: 3,
        title: "Clean finish",
        instruction: "Complete the final fictional signal set without rushing.",
        targets: [
          target("sig-3-a", "mint cove"),
          target("sig-3-b", "bright palm"),
          target("sig-3-c", "juniper light")
        ]
      }
    ]
  },
  {
    id: "firewall-routing",
    order: 2,
    title: "Firewall Routing",
    displayName: "Color Gate Routing",
    skillFocus: ["hand alternation", "index boundaries", "bigram transitions"],
    briefing:
      "Route painted fruit cards through a fictional stage prop by alternating hands and crossing index-key boundaries.",
    successStory:
      "The painted gates swing open in perfect rhythm, revealing a basket of paper pineapples.",
    safetyNotice: "The gates and routes exist only in the Pineapple Breach story.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(58, 0.91),
    stages: [
      {
        stage: 1,
        title: "Alternating lanes",
        instruction: "Keep the left-right pattern smooth.",
        targets: [
          target("route-1-a", "red fern"),
          target("route-1-b", "tiny grove"),
          target("route-1-c", "fresh lime")
        ]
      },
      {
        stage: 2,
        title: "Index crossing",
        instruction: "Stay accurate as the sequence crosses the center keys.",
        targets: [
          target("route-2-a", "craft young"),
          target("route-2-b", "brave human"),
          target("route-2-c", "green motion")
        ]
      },
      {
        stage: 3,
        title: "Mixed routing",
        instruction: "Blend alternation and center-key movement.",
        targets: [
          target("route-3-a", "The bright fern turns."),
          target("route-3-b", "A calm runner finds the gate."),
          target("route-3-c", "Green fruit moves in rhythm.")
        ]
      }
    ]
  },
  {
    id: "credential-forge",
    order: 3,
    title: "Credential Forge",
    displayName: "Prop Badge Forge",
    skillFocus: ["capital letters", "digits", "symbols", "opposite-hand Shift"],
    briefing:
      "Copy obviously fictional prop-badge labels for the Pineapple Company costume desk. They are not usable credentials.",
    successStory: "The costume desk stamps each prop badge with a cheerful pineapple seal.",
    safetyNotice: "These labeled props deliberately do not use real credential formats.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(62, 0.92),
    stages: [
      {
        stage: 1,
        title: "Capital stamps",
        instruction: "Use the suggested opposite-hand Shift for each capital.",
        targets: [
          target("badge-1-a", "PROP: Pine-7!", "fictional-prop"),
          target("badge-1-b", "DEMO: Juice+4", "fictional-prop"),
          target("badge-1-c", "FICTION: Plum#8", "fictional-prop")
        ]
      },
      {
        stage: 2,
        title: "Symbol marks",
        instruction: "Match every symbol and digit on the prop card.",
        targets: [
          target("badge-2-a", "NOT-A-KEY: Sun_6?", "fictional-prop"),
          target("badge-2-b", "PROP-ONLY: Mint@3", "fictional-prop"),
          target("badge-2-c", "DEMO-BADGE: Lime&5", "fictional-prop")
        ]
      },
      {
        stage: 3,
        title: "Mixed-case seal",
        instruction: "Finish the badge line with careful case changes.",
        targets: [
          target("badge-3-a", "PineApple PROP #47!", "fictional-prop"),
          target("badge-3-b", "JuiceCart DEMO +29?", "fictional-prop"),
          target("badge-3-c", "FruitStage FICTION = 83%", "fictional-prop")
        ]
      }
    ]
  },
  {
    id: "packet-repair",
    order: 4,
    title: "Packet Repair",
    displayName: "Pattern Card Repair",
    skillFocus: ["confusable pairs", "transposition recovery", "same-finger transitions"],
    briefing:
      "Repair mixed-up letter cards on a fictional conveyor by retyping each shown pattern exactly.",
    successStory: "The paper conveyor hums again, and every fruit card lands in the correct tray.",
    safetyNotice: "No external data or real communication is involved.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(60, 0.93),
    stages: [
      {
        stage: 1,
        title: "Pair check",
        instruction: "Notice the order before typing each pair.",
        targets: [
          target("repair-1-a", "cl lc cl"),
          target("repair-1-b", "mn nm mn"),
          target("repair-1-c", "br rb br")
        ]
      },
      {
        stage: 2,
        title: "Repeated pieces",
        instruction: "Keep repeats, omissions, and swaps under control.",
        targets: [
          target("repair-2-a", "mint mitt mint"),
          target("repair-2-b", "cove cover cove"),
          target("repair-2-c", "bright bring bright")
        ]
      },
      {
        stage: 3,
        title: "Context repair",
        instruction: "Carry the difficult pairs into a short sentence.",
        targets: [
          target("repair-3-a", "The calm climber brings mint."),
          target("repair-3-b", "Mina moves the narrow crate."),
          target("repair-3-c", "Bright cards cross the lower rail.")
        ]
      }
    ]
  },
  {
    id: "trace-countdown",
    order: 5,
    title: "Trace Countdown",
    displayName: "Spotlight Countdown",
    skillFocus: ["speed under a limit", "accuracy recovery", "natural text", "safe pseudocode"],
    briefing:
      "Finish the rehearsal lines before the stage spotlight reaches full brightness. Accuracy and speed both matter.",
    successStory: "The final line lands on cue, and the spotlight fades to a warm gold.",
    safetyNotice:
      "The countdown is a transparent local game timer; the text contains no real procedure.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(70, 0.94),
    stages: [
      {
        stage: 1,
        title: "Natural cue",
        instruction: "Type the sentence smoothly before time expires.",
        targets: [
          target("trace-1-a", "The amber lamp blinks while the paper kite turns.", "natural-text"),
          target("trace-1-b", "A quiet bell marks the next scene.", "natural-text"),
          target("trace-1-c", "Three bright cards wait beside the curtain.", "natural-text")
        ]
      },
      {
        stage: 2,
        title: "Prop logic",
        instruction: "Copy the invented, non-executable stage notation.",
        targets: [
          target("trace-2-a", "IF lamp is amber THEN mark crate ready END", "safe-pseudocode"),
          target("trace-2-b", "WHEN bell rings: move paper fruit; WAIT", "safe-pseudocode"),
          target("trace-2-c", "REPEAT 3 TIMES: turn blue card; PAUSE", "safe-pseudocode")
        ]
      },
      {
        stage: 3,
        title: "Final countdown",
        instruction: "Balance speed and accuracy through the longer cue.",
        targets: [
          target(
            "trace-3-a",
            "When the blue lamp shines, place seven paper leaves beside the golden crate.",
            "natural-text"
          ),
          target(
            "trace-3-b",
            "The stage manager checks each cue, then raises the bright pineapple flag.",
            "natural-text"
          ),
          target(
            "trace-3-c",
            "Keep a steady rhythm while the cardboard clock counts the final scene.",
            "natural-text"
          )
        ]
      }
    ]
  },
  {
    id: "vault-phrase",
    order: 6,
    title: "Vault Phrase",
    displayName: "Fiction Vault Finale",
    skillFocus: ["mixed case", "symbols", "long sequences", "sustained accuracy"],
    briefing:
      "Complete the finale with a labeled prop phrase made from invented words, digits, and punctuation.",
    successStory:
      "The papier-mache vault opens, confetti falls, and the Pineapple Company rehearsal is complete.",
    safetyNotice:
      "Every finale string is marked as a prop, is not a wallet phrase, and is not a real key or recovery format.",
    sourceId: "symtype-original-practice-v1",
    licenseId: "symtype-original-content-cc0",
    difficulties: tuning(78, 0.95),
    stages: [
      {
        stage: 1,
        title: "Invented word seal",
        instruction: "Type the clearly invented prop words and separators.",
        targets: [
          target("vault-1-a", "PROP-ONLY :: zibble-7 / quindle-4 / plumzor-9", "fictional-prop"),
          target("vault-1-b", "NOT-A-WALLET :: vexloom-2 / froodle-8 / narpin-5", "fictional-prop"),
          target("vault-1-c", "STAGE-FICTION :: wuzzle-3 / brimlet-6 / yonderp-1", "fictional-prop")
        ]
      },
      {
        stage: 2,
        title: "Mixed-case prop",
        instruction: "Preserve capitals, digits, spaces, and punctuation.",
        targets: [
          target("vault-2-a", "Prop Finale: Zibble_7 + Quindle_4 = Plumzor!", "fictional-prop"),
          target("vault-2-b", "Fiction Vault: VexLoom#2 / Froodle#8 / Narpin#5", "fictional-prop"),
          target("vault-2-c", "Stage Seal: Wuzzle-3, Brimlet-6, Yonderp-1", "fictional-prop")
        ]
      },
      {
        stage: 3,
        title: "Final pineapple seal",
        instruction: "Complete the last fictional line with steady accuracy.",
        targets: [
          target(
            "vault-3-a",
            "PINEAPPLE PROP ONLY :: Zibble-7! Quindle-4? Plumzor-9.",
            "fictional-prop"
          ),
          target(
            "vault-3-b",
            "NOT A KEY OR WALLET :: VexLoom_2 + Froodle_8 + Narpin_5",
            "fictional-prop"
          ),
          target(
            "vault-3-c",
            "FICTIONAL FINALE :: Wuzzle#3 / Brimlet#6 / Yonderp#1",
            "fictional-prop"
          )
        ]
      }
    ]
  }
]);

/** Stable public name requested by the app layer. */
export const GAME_LEVELS = PINEAPPLE_BREACH_LEVELS;

export const PINEAPPLE_ACHIEVEMENTS = Object.freeze([
  {
    id: "first-fiction-breach",
    title: "Curtain Call",
    description: "Complete all six fictional campaign levels once."
  },
  {
    id: "error-free-level",
    title: "Clean Prop Run",
    description: "Complete any level without a typing error."
  },
  {
    id: "hard-campaign",
    title: "Golden Pineapple",
    description: "Complete the fictional campaign on Hard difficulty."
  }
] as const);

export interface PlannedGameStage {
  readonly stage: 1 | 2 | 3;
  readonly title: string;
  readonly instruction: string;
  readonly targets: readonly GameTarget[];
}

export interface GameLevelPlan {
  readonly levelId: PineappleLevelId;
  readonly difficulty: GameDifficulty;
  readonly tuning: DifficultyTuning;
  readonly stages: readonly PlannedGameStage[];
  readonly safetyNotice: string;
}

export interface GenerateGameLevelPlanOptions {
  readonly levelId: PineappleLevelId;
  readonly difficulty: GameDifficulty;
  readonly seed: Seed;
  readonly focus?: FocusInput;
}

export function getGameLevel(levelId: PineappleLevelId): PineappleBreachLevel {
  const level = GAME_LEVELS.find((candidate) => candidate.id === levelId);
  if (level === undefined) {
    throw new RangeError(`Unknown Pineapple Breach level: ${levelId}`);
  }
  return level;
}

function chooseTargets(
  targets: readonly GameTarget[],
  count: number,
  random: SeededRandom,
  focus: FocusInput | undefined,
  weaknessBoost: number
): readonly GameTarget[] {
  const chosen: GameTarget[] = [];
  for (let index = 0; index < count; index += 1) {
    const pool = targets.filter((candidate) => candidate.id !== chosen.at(-1)?.id);
    const selected = random.weightedPick(pool.length > 0 ? pool : targets, (candidate) => {
      return 1 + countFocusHits(candidate.text, focus) * weaknessBoost;
    });
    chosen.push(selected);
  }
  return chosen;
}

export function generateGameLevelPlan(options: GenerateGameLevelPlanOptions): GameLevelPlan {
  const level = getGameLevel(options.levelId);
  const tuningForDifficulty = level.difficulties[options.difficulty];
  const random = new SeededRandom(`${options.seed}:${options.levelId}:${options.difficulty}`);
  const weaknessBoost = WEAKNESS_BOOST_BY_SELECTION_MODE[tuningForDifficulty.selectionMode];
  return {
    levelId: level.id,
    difficulty: options.difficulty,
    tuning: tuningForDifficulty,
    safetyNotice: level.safetyNotice,
    stages: level.stages.map((stage) => ({
      stage: stage.stage,
      title: stage.title,
      instruction: stage.instruction,
      targets: chooseTargets(
        stage.targets,
        tuningForDifficulty.targetCountPerStage,
        random,
        options.focus,
        weaknessBoost
      )
    }))
  };
}

export function getGameLevelText(
  levelId: PineappleLevelId,
  difficulty: GameDifficulty,
  seed: Seed,
  focus?: FocusInput
): string {
  const plan = generateGameLevelPlan({
    levelId,
    difficulty,
    seed,
    ...(focus === undefined ? {} : { focus })
  });
  return plan.stages.flatMap((stage) => stage.targets.map((entry) => entry.text)).join("\n");
}
