/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emittedEvents, renderGoldenSurface, visibleGlyphs } from "./TypingSurface.golden-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TypingSurface V1 canonical golden behavior", () => {
  it("freezes the canonical modifier, symbol, error, event, metric, and glyph sequence", () => {
    const clock = { now: 10_000 };
    const { handle, onComplete, onEvent, surface } = renderGoldenSurface("A1!Ab c", clock);

    clock.now = 10_025;
    fireEvent.keyDown(surface, { key: "a", code: "KeyA", isComposing: true });
    clock.now = 10_050;
    fireEvent.keyDown(surface, { key: "a", code: "KeyA", repeat: true });
    expect(emittedEvents(onEvent)).toEqual([]);
    expect(handle.current?.getProgress()).toEqual({
      position: 0,
      attempts: 0,
      correct: 0,
      errors: 0,
      rawWpm: 0,
      netWpm: 0,
      currentWpm: 0,
      accuracy: 1,
      peakWpm: 0,
      elapsedMs: 0
    });

    clock.now = 10_100;
    fireEvent.keyDown(surface, { key: "Shift", code: "ShiftRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "A", code: "KeyA", shiftKey: true });
    fireEvent.keyUp(surface, { key: "Shift", code: "ShiftRight" });

    clock.now = 10_200;
    fireEvent.keyDown(surface, { key: "1", code: "Digit1" });

    clock.now = 10_300;
    fireEvent.keyDown(surface, { key: "Shift", code: "ShiftRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "!", code: "Digit1", shiftKey: true });
    fireEvent.keyUp(surface, { key: "Shift", code: "ShiftRight" });

    clock.now = 10_400;
    fireEvent.keyDown(surface, { key: "CapsLock", code: "CapsLock" });
    fireEvent.keyDown(surface, {
      key: "A",
      code: "KeyA",
      modifierCapsLock: true
    });
    fireEvent.keyUp(surface, { key: "CapsLock", code: "CapsLock" });

    clock.now = 10_500;
    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });

    clock.now = 10_600;
    fireEvent.keyDown(surface, { key: " ", code: "Space" });

    expect(emittedEvents(onEvent)).toEqual([
      {
        clientTimeMs: 100,
        targetChar: "A",
        actualChar: "A",
        physicalCode: "KeyA",
        shiftSide: "right",
        modifiers: { shift: true, capsLock: false, altGraph: false },
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: null,
        featureChar: "A",
        bigram: null,
        trigram: null,
        mappedHand: "left",
        mappedFinger: "left-pinky",
        keyboardRow: "home",
        zone: "left-pinky",
        characterClass: "uppercase",
        contentMode: "smart",
        textPosition: 0,
        isWordBoundary: false,
        isAfterError: false,
        wasRefocus: true,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      },
      {
        clientTimeMs: 200,
        targetChar: "1",
        actualChar: "1",
        physicalCode: "Digit1",
        shiftSide: "none",
        modifiers: { shift: false, capsLock: false, altGraph: false },
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: 100,
        featureChar: "1",
        bigram: "A1",
        trigram: null,
        mappedHand: "left",
        mappedFinger: "left-pinky",
        keyboardRow: "number",
        zone: "left-pinky",
        characterClass: "digit",
        contentMode: "smart",
        textPosition: 1,
        isWordBoundary: false,
        isAfterError: false,
        wasRefocus: false,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      },
      {
        clientTimeMs: 300,
        targetChar: "!",
        actualChar: "!",
        physicalCode: "Digit1",
        shiftSide: "right",
        modifiers: { shift: true, capsLock: false, altGraph: false },
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: 100,
        featureChar: "!",
        bigram: "1!",
        trigram: "A1!",
        mappedHand: "left",
        mappedFinger: "left-pinky",
        keyboardRow: "number",
        zone: "left-pinky",
        characterClass: "symbol",
        contentMode: "smart",
        textPosition: 2,
        isWordBoundary: false,
        isAfterError: false,
        wasRefocus: false,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      },
      {
        clientTimeMs: 400,
        targetChar: "A",
        actualChar: "A",
        physicalCode: "KeyA",
        shiftSide: "none",
        modifiers: { shift: false, capsLock: true, altGraph: false },
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: 100,
        featureChar: "A",
        bigram: "!A",
        trigram: "1!A",
        mappedHand: "left",
        mappedFinger: "left-pinky",
        keyboardRow: "home",
        zone: "left-pinky",
        characterClass: "uppercase",
        contentMode: "smart",
        textPosition: 3,
        isWordBoundary: false,
        isAfterError: false,
        wasRefocus: false,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      },
      {
        clientTimeMs: 500,
        targetChar: "b",
        actualChar: "x",
        physicalCode: "KeyX",
        shiftSide: "none",
        modifiers: { shift: false, capsLock: false, altGraph: false },
        isCorrect: false,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: 100,
        featureChar: "b",
        bigram: "Ab",
        trigram: "!Ab",
        mappedHand: "left",
        mappedFinger: "left-index",
        keyboardRow: "bottom",
        zone: "left-index",
        characterClass: "lowercase",
        contentMode: "smart",
        textPosition: 4,
        isWordBoundary: false,
        isAfterError: false,
        wasRefocus: false,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      },
      {
        clientTimeMs: 600,
        targetChar: " ",
        actualChar: " ",
        physicalCode: "Space",
        shiftSide: "none",
        modifiers: { shift: false, capsLock: false, altGraph: false },
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        ikiMs: 100,
        featureChar: " ",
        bigram: "b ",
        trigram: "Ab ",
        mappedHand: "thumb",
        mappedFinger: "thumb",
        keyboardRow: "space",
        zone: "thumb",
        characterClass: "whitespace",
        contentMode: "smart",
        textPosition: 5,
        isWordBoundary: true,
        isAfterError: true,
        wasRefocus: false,
        wasPaused: false,
        wasLongPause: false,
        wasThrottled: false,
        wasRepeat: false
      }
    ]);
    expect(handle.current?.getProgress()).toEqual({
      position: 6,
      attempts: 6,
      correct: 5,
      errors: 1,
      rawWpm: 144,
      netWpm: 24,
      currentWpm: 120,
      accuracy: 0.8333333333333334,
      peakWpm: 120,
      elapsedMs: 500
    });
    expect(visibleGlyphs(surface)).toEqual([
      { className: "typing-glyph is-correct", dataActual: null, text: "A" },
      { className: "typing-glyph is-correct", dataActual: null, text: "1" },
      { className: "typing-glyph is-correct", dataActual: null, text: "!" },
      { className: "typing-glyph is-correct", dataActual: null, text: "A" },
      { className: "typing-glyph is-wrong", dataActual: "x", text: "b" },
      { className: "typing-glyph is-correct", dataActual: null, text: "·" },
      { className: "typing-glyph is-current", dataActual: null, text: "c" }
    ]);
    expect(screen.getByText("6/7")).toBeVisible();
    expect(screen.getByText("当前 WPM").previousElementSibling).toHaveTextContent("120");
    expect(screen.getByText("平均净 WPM").previousElementSibling).toHaveTextContent("24");
    expect(screen.getByText("稳定峰值").previousElementSibling).toHaveTextContent("120");
    expect(screen.getByText("击键准确率").previousElementSibling).toHaveTextContent("83%");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
