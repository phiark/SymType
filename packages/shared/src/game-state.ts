export type GameMode = "campaign" | "hardcore";
export type GameDifficulty = "standard" | "hard" | "adaptive";
export type GameStatus =
  "playing" | "paused" | "failed" | "level-complete" | "campaign-complete" | "quit";

export interface GameLevelDefinition {
  readonly id: string;
  readonly order: number;
  readonly name: string;
  readonly ability: string;
  readonly phases: number;
}

export const PINEAPPLE_LEVELS: readonly GameLevelDefinition[] = Object.freeze([
  { id: "signal-sync", order: 1, name: "Signal Sync", ability: "short-string accuracy", phases: 3 },
  {
    id: "firewall-routing",
    order: 2,
    name: "Firewall Routing",
    ability: "hand alternation and index boundaries",
    phases: 3
  },
  {
    id: "credential-forge",
    order: 3,
    name: "Credential Forge",
    ability: "case, numbers, and symbols",
    phases: 3
  },
  {
    id: "packet-repair",
    order: 4,
    name: "Packet Repair",
    ability: "confusion recovery",
    phases: 3
  },
  {
    id: "trace-countdown",
    order: 5,
    name: "Trace Countdown",
    ability: "speed with an accuracy floor",
    phases: 3
  },
  {
    id: "vault-phrase",
    order: 6,
    name: "Vault Phrase",
    ability: "fictional formatted phrase accuracy",
    phases: 3
  }
]);

export interface GameRules {
  readonly alertMaximum: number;
  readonly errorAlert: number;
  readonly longPauseAlert: number;
  readonly timeoutAlert: number;
  readonly recoveryStreak: number;
  readonly recoveryPerCorrect: number;
  readonly maximumRecoveryPerPhase: number;
  readonly pointsPerCorrect: number;
}

export const GAME_RULES: Readonly<Record<GameDifficulty, GameRules>> = Object.freeze({
  standard: {
    alertMaximum: 100,
    errorAlert: 18,
    longPauseAlert: 8,
    timeoutAlert: 100,
    recoveryStreak: 5,
    recoveryPerCorrect: 2,
    maximumRecoveryPerPhase: 16,
    pointsPerCorrect: 10
  },
  hard: {
    alertMaximum: 100,
    errorAlert: 25,
    longPauseAlert: 12,
    timeoutAlert: 100,
    recoveryStreak: 7,
    recoveryPerCorrect: 1,
    maximumRecoveryPerPhase: 10,
    pointsPerCorrect: 14
  },
  adaptive: {
    alertMaximum: 100,
    errorAlert: 20,
    longPauseAlert: 10,
    timeoutAlert: 100,
    recoveryStreak: 5,
    recoveryPerCorrect: 2,
    maximumRecoveryPerPhase: 14,
    pointsPerCorrect: 12
  }
});

export type GameFailureReason = "alert-maxed" | "timeout" | "accuracy-gate";

export interface GameState {
  readonly runId: string;
  readonly mode: GameMode;
  readonly difficulty: GameDifficulty;
  readonly status: GameStatus;
  readonly currentLevelIndex: number;
  readonly phase: number;
  readonly score: number;
  readonly alert: number;
  readonly accurateStreak: number;
  readonly recoveredAlertThisPhase: number;
  readonly errorsThisLevel: number;
  readonly completedLevelIds: readonly string[];
  readonly personalBestByLevel: Readonly<Record<string, number>>;
  readonly achievementIds: readonly string[];
  readonly failureReason: GameFailureReason | null;
  readonly pauseReason: "manual" | "focus-lost" | null;
}

export function createGameState(
  runId: string,
  mode: GameMode,
  difficulty: GameDifficulty,
  personalBestByLevel: Readonly<Record<string, number>> = {},
  previouslyCompletedLevelIds: readonly string[] = [],
  achievementIds: readonly string[] = []
): GameState {
  if (runId.trim().length === 0) {
    throw new Error("runId cannot be empty");
  }
  const completed = mode === "campaign" ? [...previouslyCompletedLevelIds] : [];
  const firstIncomplete = PINEAPPLE_LEVELS.findIndex((level) => !completed.includes(level.id));
  return {
    runId,
    mode,
    difficulty,
    status: "playing",
    currentLevelIndex: firstIncomplete < 0 ? 0 : firstIncomplete,
    phase: 1,
    score: 0,
    alert: 0,
    accurateStreak: 0,
    recoveredAlertThisPhase: 0,
    errorsThisLevel: 0,
    completedLevelIds: completed,
    personalBestByLevel: { ...personalBestByLevel },
    achievementIds: [...achievementIds],
    failureReason: null,
    pauseReason: null
  };
}

export type GameEvent =
  | { readonly type: "CORRECT" }
  | { readonly type: "ERROR" }
  | { readonly type: "LONG_PAUSE" }
  | { readonly type: "TIMEOUT" }
  | { readonly type: "ACCURACY_GATE_FAILED" }
  | { readonly type: "PHASE_COMPLETE" }
  | { readonly type: "LEVEL_COMPLETE" }
  | { readonly type: "PAUSE" }
  | { readonly type: "FOCUS_LOST" }
  | { readonly type: "RESUME" }
  | { readonly type: "RESTART_AFTER_FAILURE" }
  | { readonly type: "QUIT" };

function addUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function failState(state: GameState, reason: GameFailureReason): GameState {
  const hardcore = state.mode === "hardcore";
  return {
    ...state,
    status: "failed",
    currentLevelIndex: hardcore ? 0 : state.currentLevelIndex,
    phase: 1,
    score: 0,
    alert: 0,
    accurateStreak: 0,
    recoveredAlertThisPhase: 0,
    errorsThisLevel: 0,
    // Campaign keeps already completed prerequisites. Hardcore loses this run's
    // campaign progress, while personal bests and achievements remain durable.
    completedLevelIds: hardcore ? [] : [...state.completedLevelIds],
    failureReason: reason,
    pauseReason: null
  };
}

function withAlertIncrease(
  state: GameState,
  increase: number,
  reasonAtMaximum: GameFailureReason
): GameState {
  const rules = GAME_RULES[state.difficulty];
  const alert = Math.min(rules.alertMaximum, state.alert + increase);
  if (alert >= rules.alertMaximum) {
    return failState({ ...state, alert }, reasonAtMaximum);
  }
  return { ...state, alert, accurateStreak: 0 };
}

export function applyGameEvent(state: GameState, event: GameEvent): GameState {
  if (event.type === "QUIT") {
    return { ...state, status: "quit", pauseReason: null };
  }
  if (event.type === "RESTART_AFTER_FAILURE") {
    if (state.status !== "failed") {
      return state;
    }
    return {
      ...state,
      status: "playing",
      phase: 1,
      score: 0,
      alert: 0,
      accurateStreak: 0,
      recoveredAlertThisPhase: 0,
      errorsThisLevel: 0,
      failureReason: null,
      pauseReason: null
    };
  }
  if (event.type === "PAUSE" || event.type === "FOCUS_LOST") {
    if (state.status !== "playing") {
      return state;
    }
    return {
      ...state,
      status: "paused",
      pauseReason: event.type === "FOCUS_LOST" ? "focus-lost" : "manual"
    };
  }
  if (event.type === "RESUME") {
    return state.status === "paused" ? { ...state, status: "playing", pauseReason: null } : state;
  }
  if (state.status !== "playing") {
    return state;
  }

  const rules = GAME_RULES[state.difficulty];
  if (event.type === "CORRECT") {
    const accurateStreak = state.accurateStreak + 1;
    const canRecover =
      accurateStreak >= rules.recoveryStreak &&
      state.recoveredAlertThisPhase < rules.maximumRecoveryPerPhase;
    const recovery = canRecover
      ? Math.min(
          rules.recoveryPerCorrect,
          rules.maximumRecoveryPerPhase - state.recoveredAlertThisPhase,
          state.alert
        )
      : 0;
    return {
      ...state,
      accurateStreak,
      score: state.score + rules.pointsPerCorrect,
      alert: state.alert - recovery,
      recoveredAlertThisPhase: state.recoveredAlertThisPhase + recovery
    };
  }
  if (event.type === "ERROR") {
    const updated = withAlertIncrease(state, rules.errorAlert, "alert-maxed");
    return updated.status === "failed"
      ? updated
      : { ...updated, errorsThisLevel: state.errorsThisLevel + 1 };
  }
  if (event.type === "LONG_PAUSE") {
    return withAlertIncrease(state, rules.longPauseAlert, "alert-maxed");
  }
  if (event.type === "TIMEOUT") {
    return failState(state, "timeout");
  }
  if (event.type === "ACCURACY_GATE_FAILED") {
    return failState(state, "accuracy-gate");
  }
  if (event.type === "PHASE_COMPLETE") {
    const level = PINEAPPLE_LEVELS[state.currentLevelIndex];
    if (level === undefined || state.phase >= level.phases) {
      return state;
    }
    return {
      ...state,
      phase: state.phase + 1,
      accurateStreak: 0,
      recoveredAlertThisPhase: 0
    };
  }
  if (event.type === "LEVEL_COMPLETE") {
    const level = PINEAPPLE_LEVELS[state.currentLevelIndex];
    if (level === undefined || state.phase !== level.phases) {
      return state;
    }
    const best = Math.max(state.personalBestByLevel[level.id] ?? 0, state.score);
    const completedLevelIds = addUnique(state.completedLevelIds, level.id);
    let achievementIds = addUnique(state.achievementIds, `complete:${level.id}`);
    if (state.errorsThisLevel === 0) {
      achievementIds = addUnique(achievementIds, `flawless:${level.id}`);
    }
    achievementIds = addUnique(achievementIds, `difficulty:${state.difficulty}`);
    const finalLevel = state.currentLevelIndex === PINEAPPLE_LEVELS.length - 1;
    return {
      ...state,
      status: finalLevel ? "campaign-complete" : "level-complete",
      currentLevelIndex: finalLevel ? state.currentLevelIndex : state.currentLevelIndex + 1,
      phase: 1,
      score: 0,
      alert: 0,
      accurateStreak: 0,
      recoveredAlertThisPhase: 0,
      errorsThisLevel: 0,
      completedLevelIds,
      personalBestByLevel: { ...state.personalBestByLevel, [level.id]: best },
      achievementIds,
      failureReason: null,
      pauseReason: null
    };
  }
  return state;
}

export function continueAfterLevelComplete(state: GameState): GameState {
  return state.status === "level-complete" ? { ...state, status: "playing" } : state;
}

export function currentGameLevel(state: GameState): GameLevelDefinition {
  const level = PINEAPPLE_LEVELS[state.currentLevelIndex];
  if (level === undefined) {
    throw new Error(`Invalid game level index ${state.currentLevelIndex}`);
  }
  return level;
}
