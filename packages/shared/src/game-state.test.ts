import { describe, expect, it } from "vitest";

import {
  GAME_RULES,
  PINEAPPLE_LEVELS,
  applyGameEvent,
  continueAfterLevelComplete,
  createGameState,
  currentGameLevel,
  type GameState
} from "./game-state.js";

function atLevel(state: GameState, levelIndex: number): GameState {
  return {
    ...state,
    currentLevelIndex: levelIndex,
    phase: PINEAPPLE_LEVELS[levelIndex]?.phases ?? 1,
    status: "playing"
  };
}

describe("Pineapple Breach definitions", () => {
  it("contains six ordered, ability-specific levels", () => {
    expect(PINEAPPLE_LEVELS).toHaveLength(6);
    expect(PINEAPPLE_LEVELS.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(PINEAPPLE_LEVELS.map(({ ability }) => ability)).size).toBe(6);
  });

  it.each(["standard", "hard", "adaptive"] as const)(
    "publishes transparent bounded %s rules",
    (difficulty) => {
      const rules = GAME_RULES[difficulty];
      expect(rules.alertMaximum).toBe(100);
      expect(rules.errorAlert).toBeGreaterThan(0);
      expect(rules.maximumRecoveryPerPhase).toBeLessThan(rules.alertMaximum);
    }
  );
});

describe("alert and pause state machine", () => {
  it("raises alert on errors and allows only capped streak recovery", () => {
    let state = createGameState("run", "campaign", "standard");
    state = applyGameEvent(state, { type: "ERROR" });
    expect(state.alert).toBe(GAME_RULES.standard.errorAlert);
    for (let index = 0; index < 20; index += 1) {
      state = applyGameEvent(state, { type: "CORRECT" });
    }
    expect(state.recoveredAlertThisPhase).toBeLessThanOrEqual(
      GAME_RULES.standard.maximumRecoveryPerPhase
    );
    expect(state.score).toBe(20 * GAME_RULES.standard.pointsPerCorrect);
  });

  it.each(["PAUSE", "FOCUS_LOST"] as const)("pauses on %s and ignores gameplay", (type) => {
    let state = createGameState("run", "campaign", "standard");
    state = applyGameEvent(state, { type });
    expect(state.status).toBe("paused");
    const unchanged = applyGameEvent(state, { type: "CORRECT" });
    expect(unchanged).toBe(state);
    expect(applyGameEvent(state, { type: "RESUME" }).status).toBe("playing");
  });
});

describe("fair failure reset rules", () => {
  it.each(["TIMEOUT", "ACCURACY_GATE_FAILED"] as const)(
    "resets the current campaign level from phase 1 after %s",
    (type) => {
      let state = createGameState("run", "campaign", "standard", {}, ["signal-sync"]);
      state = { ...state, phase: 3, score: 500, alert: 80 };
      state = applyGameEvent(state, { type });
      expect(state).toMatchObject({
        status: "failed",
        currentLevelIndex: 1,
        phase: 1,
        score: 0,
        alert: 0,
        completedLevelIds: ["signal-sync"]
      });
      expect(applyGameEvent(state, { type: "RESTART_AFTER_FAILURE" }).status).toBe("playing");
    }
  );

  it("resets an entire hardcore run to level 1 while retaining durable bests", () => {
    let state = createGameState("run", "hardcore", "hard", { "signal-sync": 900 });
    state = {
      ...state,
      currentLevelIndex: 4,
      phase: 2,
      completedLevelIds: ["signal-sync", "firewall-routing"],
      score: 700
    };
    state = applyGameEvent(state, { type: "TIMEOUT" });
    expect(state).toMatchObject({
      status: "failed",
      currentLevelIndex: 0,
      phase: 1,
      score: 0,
      completedLevelIds: [],
      personalBestByLevel: { "signal-sync": 900 }
    });
  });

  it("fails at the published maximum alert", () => {
    let state = createGameState("run", "campaign", "hard");
    for (let index = 0; index < 4; index += 1) {
      state = applyGameEvent(state, { type: "ERROR" });
    }
    expect(state.status).toBe("failed");
    expect(state.failureReason).toBe("alert-maxed");
  });
});

describe("level completion", () => {
  it("requires every phase and unlocks the next level with durable achievements", () => {
    let state = createGameState("run", "campaign", "standard");
    expect(applyGameEvent(state, { type: "LEVEL_COMPLETE" })).toBe(state);
    state = applyGameEvent(state, { type: "PHASE_COMPLETE" });
    state = applyGameEvent(state, { type: "PHASE_COMPLETE" });
    state = applyGameEvent(state, { type: "CORRECT" });
    state = applyGameEvent(state, { type: "LEVEL_COMPLETE" });
    expect(state).toMatchObject({
      status: "level-complete",
      currentLevelIndex: 1,
      phase: 1,
      completedLevelIds: ["signal-sync"]
    });
    expect(state.achievementIds).toContain("complete:signal-sync");
    expect(state.achievementIds).toContain("flawless:signal-sync");
    expect(state.personalBestByLevel["signal-sync"]).toBeGreaterThan(0);
    state = continueAfterLevelComplete(state);
    expect(state.status).toBe("playing");
    expect(currentGameLevel(state).id).toBe("firewall-routing");
  });

  it("finishes the campaign after the sixth level", () => {
    let state = atLevel(createGameState("run", "campaign", "adaptive"), 5);
    state = applyGameEvent(state, { type: "LEVEL_COMPLETE" });
    expect(state.status).toBe("campaign-complete");
    expect(state.completedLevelIds).toContain("vault-phrase");
  });
});
