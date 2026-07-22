import { describe, expect, it } from "vitest";

import {
  KEYBOARD_ROWS,
  STANDARD_LAYOUT,
  STANDARD_PRESET,
  SYMMETRIC_LAYOUT,
  SYMMETRIC_PRESET,
  assessShiftUse,
  characterForPhysicalKey,
  clonePreset,
  getBindingForCharacter,
  getKeyByCharacter,
  getKeyByCode,
  parseKeyboardEvent,
  recommendedShiftForCharacter,
  replaceKeyMapping,
  type Finger
} from "./keyboard-layout.js";

const symmetricLetters: Readonly<Record<Finger, string>> = {
  "left-pinky": "qa",
  "left-ring": "wsz",
  "left-middle": "edx",
  "left-index": "rfcvtgb",
  "right-index": "yhnujm",
  "right-middle": "ik",
  "right-ring": "ol",
  "right-pinky": "p",
  thumb: ""
};

const standardLetters: Readonly<Record<Finger, string>> = {
  "left-pinky": "qaz",
  "left-ring": "wsx",
  "left-middle": "edc",
  "left-index": "rfvtgb",
  "right-index": "yhnujm",
  "right-middle": "ik",
  "right-ring": "ol",
  "right-pinky": "p",
  thumb: ""
};

describe("ANSI US keyboard data", () => {
  it("exports stable rows and compatibility arrays", () => {
    expect(KEYBOARD_ROWS).toEqual(["number", "top", "home", "bottom", "space"]);
    expect(SYMMETRIC_LAYOUT).toBe(SYMMETRIC_PRESET.keys);
    expect(STANDARD_LAYOUT).toBe(STANDARD_PRESET.keys);
  });

  it.each([
    ["symmetric", SYMMETRIC_PRESET, symmetricLetters],
    ["standard", STANDARD_PRESET, standardLetters]
  ] as const)("maps every letter in the %s preset", (_name, preset, expected) => {
    for (const [finger, letters] of Object.entries(expected)) {
      for (const letter of letters) {
        expect(getBindingForCharacter(preset, letter)?.key.finger).toBe(finger);
      }
    }
    const mappedLetters = preset.keys.filter((key) => key.category === "letter");
    expect(mappedLetters).toHaveLength(26);
    expect(new Set(mappedLetters.map((key) => key.unshifted)).size).toBe(26);
  });

  it.each([
    ["Backquote", "`", "~", "left-pinky"],
    ["Digit1", "1", "!", "left-pinky"],
    ["Digit2", "2", "@", "left-ring"],
    ["Digit3", "3", "#", "left-middle"],
    ["Digit4", "4", "$", "left-index"],
    ["Digit5", "5", "%", "left-index"],
    ["Digit6", "6", "^", "right-index"],
    ["Digit7", "7", "&", "right-index"],
    ["Digit8", "8", "*", "right-middle"],
    ["Digit9", "9", "(", "right-ring"],
    ["Digit0", "0", ")", "right-pinky"],
    ["Minus", "-", "_", "right-pinky"],
    ["Equal", "=", "+", "right-pinky"]
  ] as const)("maps number-row edge %s explicitly", (code, plain, shifted, finger) => {
    for (const preset of [SYMMETRIC_PRESET, STANDARD_PRESET]) {
      const key = getKeyByCode(preset, code);
      expect(key).toMatchObject({ code, unshifted: plain, shifted, finger, row: "number" });
    }
  });

  it("keeps Standard identical except for the documented Z/X/C zone change", () => {
    const changedCodes = new Set(["KeyZ", "KeyX", "KeyC"]);
    for (const symmetric of SYMMETRIC_LAYOUT) {
      const standard = getKeyByCode(symmetric.code, STANDARD_LAYOUT);
      expect(standard).toBeDefined();
      expect(standard).toMatchObject({
        code: symmetric.code,
        unshifted: symmetric.unshifted,
        shifted: symmetric.shifted,
        row: symmetric.row,
        width: symmetric.width
      });
      if (!changedCodes.has(symmetric.code)) {
        expect(standard?.finger).toBe(symmetric.finger);
        expect(standard?.hand).toBe(symmetric.hand);
      }
    }
    expect(getKeyByCode("KeyZ", STANDARD_LAYOUT)?.finger).toBe("left-pinky");
    expect(getKeyByCode("KeyX", STANDARD_LAYOUT)?.finger).toBe("left-ring");
    expect(getKeyByCode("KeyC", STANDARD_LAYOUT)?.finger).toBe("left-middle");
  });

  it.each([
    ["KeyC", "left-index"],
    ["KeyB", "left-index"],
    ["KeyN", "right-index"],
    ["KeyM", "right-index"],
    ["Comma", "right-middle"],
    ["Period", "right-ring"],
    ["Slash", "right-pinky"],
    ["BracketLeft", "right-pinky"],
    ["Quote", "right-pinky"],
    ["ShiftLeft", "left-pinky"],
    ["ShiftRight", "right-pinky"]
  ] as const)("protects Symmetric boundary key %s", (code, finger) => {
    expect(getKeyByCode(SYMMETRIC_PRESET, code)?.finger).toBe(finger);
  });

  it.each([SYMMETRIC_PRESET, STANDARD_PRESET])(
    "has unique physical codes and complete display geometry for $name",
    (preset) => {
      expect(new Set(preset.keys.map((key) => key.code)).size).toBe(preset.keys.length);
      for (const key of preset.keys) {
        expect(key.width).toBeGreaterThan(0);
        expect(key.column).toBeGreaterThanOrEqual(0);
        expect(KEYBOARD_ROWS).toContain(key.row);
        expect(key.zone).toBe(key.finger);
      }
    }
  );

  it("supports compatibility lookup forms", () => {
    expect(getKeyByCode("KeyC")?.finger).toBe("left-index");
    expect(getKeyByCode("KeyC", STANDARD_LAYOUT)?.finger).toBe("left-middle");
    expect(getKeyByCode(STANDARD_PRESET, "KeyC")?.finger).toBe("left-middle");
    expect(getKeyByCharacter("C")?.code).toBe("KeyC");
  });
});

describe("physical code and Shift parsing", () => {
  it.each([
    ["KeyC", false, false, "c"],
    ["KeyC", true, false, "C"],
    ["KeyC", false, true, "C"],
    ["KeyC", true, true, "c"],
    ["Digit4", false, false, "4"],
    ["Digit4", true, false, "$"],
    ["Slash", true, false, "?"],
    ["Space", true, false, " "]
  ] as const)("resolves %s with shift=%s caps=%s", (code, shiftKey, capsLock, expected) => {
    const key = getKeyByCode(code);
    expect(key).toBeDefined();
    expect(characterForPhysicalKey(key!, shiftKey, capsLock)).toBe(expected);
  });

  it("uses KeyboardEvent.code rather than a locale-dependent key label", () => {
    expect(
      parseKeyboardEvent({
        code: "KeyY",
        key: "z",
        shiftKey: false
      })
    ).toMatchObject({
      kind: "printable",
      code: "KeyY",
      character: "y",
      inferredFinger: "right-index"
    });
  });

  it.each([
    [{ code: "KeyA", key: "Process", shiftKey: false }, "composition"],
    [{ code: "KeyA", shiftKey: false, isComposing: true }, "composition"],
    [{ code: "KeyA", shiftKey: false, metaKey: true }, "system-shortcut"],
    [{ code: "IntlRo", shiftKey: false }, "unknown-code"]
  ] as const)("ignores unsafe/non-ANSI event %#", (event, reason) => {
    expect(parseKeyboardEvent(event)).toEqual({
      kind: "ignored",
      reason,
      code: event.code
    });
  });

  it("returns editing and modifier keys as controls", () => {
    expect(parseKeyboardEvent({ code: "Backspace", shiftKey: false })).toMatchObject({
      kind: "control",
      code: "Backspace"
    });
  });

  it.each([
    ["A", "ShiftRight", ["ShiftRight"], false, "correct-opposite-hand"],
    ["A", "ShiftRight", ["ShiftLeft"], false, "same-hand-shift"],
    ["Y", "ShiftLeft", ["ShiftLeft"], false, "correct-opposite-hand"],
    ["?", "ShiftLeft", ["ShiftLeft"], false, "correct-opposite-hand"],
    ["A", "ShiftRight", [], false, "missing-shift"],
    ["A", "ShiftRight", ["ShiftLeft", "ShiftRight"], false, "both-shifts"],
    ["A", "ShiftRight", [], true, "caps-lock"],
    ["a", null, [], false, "not-required"]
  ] as const)(
    "assesses Shift use for %s",
    (character, recommended, active, capsLock, assessment) => {
      expect(recommendedShiftForCharacter(SYMMETRIC_PRESET, character)).toBe(recommended);
      expect(assessShiftUse(SYMMETRIC_PRESET, character, active, capsLock)).toBe(assessment);
    }
  );
});

describe("custom preset editing", () => {
  it("clones and changes a mapping without mutating its source", () => {
    const clone = clonePreset(SYMMETRIC_PRESET, "custom-1", "My mapping");
    const changed = replaceKeyMapping(clone, "KeyC", {
      hand: "left",
      finger: "left-middle",
      zone: "left-middle"
    });
    expect(getKeyByCode(changed, "KeyC")?.finger).toBe("left-middle");
    expect(getKeyByCode(SYMMETRIC_PRESET, "KeyC")?.finger).toBe("left-index");
  });

  it("rejects inconsistent and unknown mappings", () => {
    expect(() =>
      replaceKeyMapping(SYMMETRIC_PRESET, "KeyC", {
        hand: "right",
        finger: "left-middle",
        zone: "left-middle"
      })
    ).toThrow(/same physical assignment/);
    expect(() =>
      replaceKeyMapping(SYMMETRIC_PRESET, "NoSuchKey", {
        hand: "left",
        finger: "left-middle",
        zone: "left-middle"
      })
    ).toThrow(/Unknown ANSI key code/);
  });
});
