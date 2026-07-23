/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emittedEvents,
  LOWER_A_CORRECT_EVENT,
  LOWER_A_CORRECTION_EVENT,
  LOWER_A_RECOVERY_EVENT,
  LOWER_A_WRONG_EVENT,
  renderGoldenSurface,
  visibleGlyphs
} from "./TypingSurface.golden-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TypingSurface V1 policy golden behavior", () => {
  it("freezes enabled Backspace correction and continue-on-error behavior", () => {
    const clock = { now: 20_000 };
    const { handle, onEvent, surface } = renderGoldenSurface("ab", clock);

    clock.now = 20_100;
    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    clock.now = 20_150;
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    clock.now = 20_200;
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(emittedEvents(onEvent)).toEqual([LOWER_A_WRONG_EVENT, LOWER_A_CORRECTION_EVENT]);
    expect(handle.current?.getProgress()).toEqual({
      position: 1,
      attempts: 2,
      correct: 1,
      errors: 1,
      rawWpm: 240,
      netWpm: 240,
      currentWpm: 0,
      accuracy: 0.5,
      peakWpm: 0,
      elapsedMs: 100
    });
    expect(visibleGlyphs(surface)).toEqual([
      { className: "typing-glyph is-correct", dataActual: null, text: "a" },
      { className: "typing-glyph is-current", dataActual: null, text: "b" }
    ]);
  });

  it("freezes stop-on-error at the current target without marking a correction", () => {
    const clock = { now: 30_000 };
    const { handle, onEvent, surface } = renderGoldenSurface("ab", clock, {
      settings: { stopOnError: true }
    });

    clock.now = 30_100;
    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    expect(screen.getByText("0/2")).toBeVisible();
    clock.now = 30_200;
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(emittedEvents(onEvent)).toEqual([LOWER_A_WRONG_EVENT, LOWER_A_RECOVERY_EVENT]);
    expect(handle.current?.getProgress()).toEqual({
      position: 1,
      attempts: 2,
      correct: 1,
      errors: 1,
      rawWpm: 240,
      netWpm: 240,
      currentWpm: 0,
      accuracy: 0.5,
      peakWpm: 0,
      elapsedMs: 100
    });
    expect(visibleGlyphs(surface)).toEqual([
      { className: "typing-glyph is-correct", dataActual: null, text: "a" },
      { className: "typing-glyph is-current", dataActual: null, text: "b" }
    ]);
  });

  it("freezes disabled Backspace as a no-op with no synthetic event", () => {
    const clock = { now: 40_000 };
    const { handle, onEvent, surface } = renderGoldenSurface("ab", clock, {
      settings: { backspaceMode: "disabled" }
    });

    clock.now = 40_100;
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    clock.now = 40_200;
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });

    expect(emittedEvents(onEvent)).toEqual([LOWER_A_CORRECT_EVENT]);
    expect(handle.current?.getProgress()).toEqual({
      position: 1,
      attempts: 1,
      correct: 1,
      errors: 0,
      rawWpm: 240,
      netWpm: 240,
      currentWpm: 0,
      accuracy: 1,
      peakWpm: 0,
      elapsedMs: 0
    });
    expect(visibleGlyphs(surface)).toEqual([
      { className: "typing-glyph is-correct", dataActual: null, text: "a" },
      { className: "typing-glyph is-current", dataActual: null, text: "b" }
    ]);
  });

  it("freezes word Backspace at the current word boundary without emitting an event", () => {
    const clock = { now: 50_000 };
    const { handle, onEvent, surface } = renderGoldenSurface("abc defg", clock, {
      settings: { backspaceMode: "words" }
    });

    for (const [index, character] of Array.from("abc def").entries()) {
      clock.now = 50_100 + index * 100;
      fireEvent.keyDown(surface, {
        key: character,
        code: character === " " ? "Space" : `Key${character.toUpperCase()}`
      });
    }
    expect(screen.getByText("7/8")).toBeVisible();
    clock.now = 50_800;
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });

    expect(
      emittedEvents(onEvent).map((event) => ({
        targetChar: event.targetChar,
        actualChar: event.actualChar,
        textPosition: event.textPosition,
        isCorrect: event.isCorrect,
        isCorrection: event.isCorrection,
        backspaceCount: event.backspaceCount,
        clientTimeMs: event.clientTimeMs,
        ikiMs: event.ikiMs
      }))
    ).toEqual([
      {
        targetChar: "a",
        actualChar: "a",
        textPosition: 0,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 100,
        ikiMs: null
      },
      {
        targetChar: "b",
        actualChar: "b",
        textPosition: 1,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 200,
        ikiMs: 100
      },
      {
        targetChar: "c",
        actualChar: "c",
        textPosition: 2,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 300,
        ikiMs: 100
      },
      {
        targetChar: " ",
        actualChar: " ",
        textPosition: 3,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 400,
        ikiMs: 100
      },
      {
        targetChar: "d",
        actualChar: "d",
        textPosition: 4,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 500,
        ikiMs: 100
      },
      {
        targetChar: "e",
        actualChar: "e",
        textPosition: 5,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 600,
        ikiMs: 100
      },
      {
        targetChar: "f",
        actualChar: "f",
        textPosition: 6,
        isCorrect: true,
        isCorrection: false,
        backspaceCount: 0,
        clientTimeMs: 700,
        ikiMs: 100
      }
    ]);
    expect(onEvent).toHaveBeenCalledTimes(7);
    expect(handle.current?.getProgress()).toEqual({
      position: 4,
      attempts: 7,
      correct: 7,
      errors: 0,
      rawWpm: 140,
      netWpm: 140,
      currentWpm: 120,
      accuracy: 1,
      peakWpm: 120,
      elapsedMs: 600
    });
    expect(visibleGlyphs(surface)).toEqual([
      { className: "typing-glyph is-correct", dataActual: null, text: "a" },
      { className: "typing-glyph is-correct", dataActual: null, text: "b" },
      { className: "typing-glyph is-correct", dataActual: null, text: "c" },
      { className: "typing-glyph is-correct", dataActual: null, text: "·" },
      { className: "typing-glyph is-current", dataActual: null, text: "d" },
      { className: "typing-glyph", dataActual: null, text: "e" },
      { className: "typing-glyph", dataActual: null, text: "f" },
      { className: "typing-glyph", dataActual: null, text: "g" }
    ]);
    expect(screen.getByText("4/8")).toBeVisible();
  });
});
