import { describe, expect, it } from "vitest";

import {
  applyGameEvent,
  continueAfterLevelComplete,
  createGameState,
  type GameEvent,
  type GameState
} from "./index.js";

function gamePoint(state: GameState): string {
  return [
    state.status,
    state.currentLevelIndex,
    state.phase,
    state.score,
    state.alert,
    state.accurateStreak,
    state.recoveredAlertThisPhase,
    state.errorsThisLevel,
    state.failureReason,
    state.pauseReason
  ]
    .map(String)
    .join("|");
}

describe("V1 golden Pineapple Breach state machine", () => {
  it("freezes alert, score, pause, timeout, and campaign restart", () => {
    let state = createGameState(
      "run-golden",
      "campaign",
      "standard",
      { "signal-sync": 500 },
      ["signal-sync"],
      ["complete:signal-sync"]
    );
    const trajectory = [gamePoint(state)];
    const events: readonly GameEvent[] = [
      { type: "ERROR" },
      { type: "CORRECT" },
      { type: "CORRECT" },
      { type: "CORRECT" },
      { type: "CORRECT" },
      { type: "CORRECT" },
      { type: "LONG_PAUSE" },
      { type: "PAUSE" },
      { type: "RESUME" },
      { type: "TIMEOUT" },
      { type: "RESTART_AFTER_FAILURE" }
    ];
    for (const event of events) {
      state = applyGameEvent(state, event);
      trajectory.push(gamePoint(state));
    }
    expect(trajectory).toEqual([
      "playing|1|1|0|0|0|0|0|null|null",
      "playing|1|1|0|18|0|0|1|null|null",
      "playing|1|1|10|18|1|0|1|null|null",
      "playing|1|1|20|18|2|0|1|null|null",
      "playing|1|1|30|18|3|0|1|null|null",
      "playing|1|1|40|18|4|0|1|null|null",
      "playing|1|1|50|16|5|2|1|null|null",
      "playing|1|1|50|24|0|2|1|null|null",
      "paused|1|1|50|24|0|2|1|null|manual",
      "playing|1|1|50|24|0|2|1|null|null",
      "failed|1|1|0|0|0|0|0|timeout|null",
      "playing|1|1|0|0|0|0|0|null|null"
    ]);
    expect([state.completedLevelIds, state.personalBestByLevel, state.achievementIds]).toEqual([
      ["signal-sync"],
      { "signal-sync": 500 },
      ["complete:signal-sync"]
    ]);
  });

  it("freezes Hardcore reset and completed-level score conversion", () => {
    let hardcore: GameState = {
      ...createGameState(
        "hardcore-golden",
        "hardcore",
        "hard",
        { "signal-sync": 900 },
        [],
        ["difficulty:hard"]
      ),
      currentLevelIndex: 4,
      phase: 2,
      completedLevelIds: ["signal-sync", "firewall-routing"],
      score: 700,
      alert: 50
    };
    hardcore = applyGameEvent(hardcore, { type: "TIMEOUT" });
    expect([
      gamePoint(hardcore),
      hardcore.completedLevelIds,
      hardcore.personalBestByLevel,
      hardcore.achievementIds
    ]).toEqual([
      "failed|0|1|0|0|0|0|0|timeout|null",
      [],
      { "signal-sync": 900 },
      ["difficulty:hard"]
    ]);
    hardcore = applyGameEvent(hardcore, { type: "RESTART_AFTER_FAILURE" });
    expect(gamePoint(hardcore)).toBe("playing|0|1|0|0|0|0|0|null|null");

    let level = createGameState("level-golden", "campaign", "standard");
    const events: readonly GameEvent[] = [
      { type: "CORRECT" },
      { type: "PHASE_COMPLETE" },
      { type: "CORRECT" },
      { type: "PHASE_COMPLETE" },
      { type: "CORRECT" },
      { type: "CORRECT" },
      { type: "LEVEL_COMPLETE" }
    ];
    for (const event of events) level = applyGameEvent(level, event);
    expect([
      gamePoint(level),
      level.completedLevelIds,
      level.personalBestByLevel,
      level.achievementIds
    ]).toEqual([
      "level-complete|1|1|0|0|0|0|0|null|null",
      ["signal-sync"],
      { "signal-sync": 40 },
      ["complete:signal-sync", "flawless:signal-sync", "difficulty:standard"]
    ]);
    expect(gamePoint(continueAfterLevelComplete(level))).toBe("playing|1|1|0|0|0|0|0|null|null");
  });
});
