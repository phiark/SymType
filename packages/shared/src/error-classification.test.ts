import { describe, expect, it } from "vitest";

import {
  classifyBehavioralIssues,
  classifyTextErrors,
  type TypingSignalEvent
} from "./error-classification.js";

describe("text error alignment", () => {
  it("counts an adjacent swap once, not as two substitutions", () => {
    const issues = classifyTextErrors("cat", "cta");
    expect(issues).toEqual([
      {
        kind: "transposition",
        target: "at",
        actual: "ta",
        targetStart: 1,
        targetEnd: 3,
        actualStart: 1,
        actualEnd: 3
      }
    ]);
  });

  it.each([
    ["a", "s", "adjacent-key-confusion"],
    ["1", "!", "number-symbol-confusion"],
    ["A", "a", "shift-error"],
    ["cat", "ct", "omission"],
    ["book", "boook", "repeat"],
    ["cat", "cut", "substitution"]
  ])("classifies %s → %s as %s", (target, actual, expected) => {
    expect(classifyTextErrors(target, actual).map(({ kind }) => kind)).toContain(expected);
  });

  it("aligns mixed edits without overlapping consumed ranges", () => {
    const issues = classifyTextErrors("the cat", "teh caat");
    expect(issues.map(({ kind }) => kind)).toEqual(["transposition", "repeat"]);
    for (let index = 1; index < issues.length; index += 1) {
      expect(issues[index]!.targetStart).toBeGreaterThanOrEqual(issues[index - 1]!.targetEnd);
      expect(issues[index]!.actualStart).toBeGreaterThanOrEqual(issues[index - 1]!.actualEnd);
    }
  });
});

describe("behavioral signal classification", () => {
  const event = (target: string, ikiMs: number, correct = true): TypingSignalEvent => ({
    target,
    actual: correct ? target : "x",
    correct,
    ikiMs
  });

  it("detects slow correct keys, slow combinations, and same-finger cross-row travel", () => {
    const issues = classifyBehavioralIssues([event("e", 100), event("d", 170), event("x", 180)], {
      baselineIkiMs: 100,
      slowRatio: 1.45,
      minimumGroupSamples: 10
    });
    expect(issues.map(({ kind }) => kind)).toContain("correct-but-slow");
    expect(issues.map(({ kind }) => kind)).toContain("slow-bigram");
    expect(issues.map(({ kind }) => kind)).toContain("slow-trigram");
    expect(issues.map(({ kind }) => kind)).toContain("same-finger-cross-row");
  });

  it("uses the persisted session mapping metadata instead of assuming the default finger zone", () => {
    const issues = classifyBehavioralIssues(
      [
        {
          ...event("e", 100),
          mappedHand: "right",
          mappedFinger: "right-index",
          keyboardRow: "top"
        },
        {
          ...event("a", 180),
          mappedHand: "right",
          mappedFinger: "right-index",
          keyboardRow: "home"
        }
      ],
      { baselineIkiMs: 100, minimumGroupSamples: 10 }
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: "same-finger-cross-row", feature: "ea" })
    );
  });

  it("detects post-error slowdown and Shift-side errors", () => {
    const issues = classifyBehavioralIssues(
      [event("c", 90, false), { ...event("T", 180), shiftAssessment: "same-hand-shift" }],
      { baselineIkiMs: 100 }
    );
    expect(issues.map(({ kind }) => kind)).toContain("post-error-slowdown");
    expect(issues.map(({ kind }) => kind)).toContain("shift-use-error");
  });

  it("detects mapped hand imbalance only with enough samples", () => {
    const left = Array.from({ length: 6 }, () => event("f", 100));
    const right = Array.from({ length: 6 }, () => event("j", 150));
    const issues = classifyBehavioralIssues([...left, ...right], {
      baselineIkiMs: 100,
      minimumGroupSamples: 5,
      imbalanceRatio: 1.2
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: "hand-imbalance", feature: "right" })
    );
  });

  it("detects a fast burst of errors", () => {
    const issues = classifyBehavioralIssues(
      [
        event("a", 70, false),
        event("s", 75, false),
        event("d", 72, true),
        event("f", 74, false),
        event("g", 73, true)
      ],
      { baselineIkiMs: 100 }
    );
    expect(issues.map(({ kind }) => kind)).toContain("error-burst");
  });

  it("requires speed, accuracy, and dispersion to jointly worsen before fatigue", () => {
    const early = [100, 100, 101, 99, 100, 101].map((iki) => event("a", iki));
    const middle = [110, 112, 108, 111, 109, 110].map((iki) => event("s", iki));
    const late = [130, 150, 170, 140, 180, 160].map((iki, index) => event("d", iki, index < 4));
    const issues = classifyBehavioralIssues([...early, ...middle, ...late], {
      baselineIkiMs: 100,
      fatigueWindow: 18
    });
    expect(issues.map(({ kind }) => kind)).toContain("suspected-fatigue");
  });
});
