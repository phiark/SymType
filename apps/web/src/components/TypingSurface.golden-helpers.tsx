/* eslint-disable react-refresh/only-export-components -- test-only event fixtures and render helpers */

import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { vi } from "vitest";

import { testSettings } from "../test/fixtures";
import type { AppSettings, StoredEvent } from "../types";
import { TypingSurface, type TypingProgress, type TypingSurfaceHandle } from "./TypingSurface";

type EmittedEvent = Omit<StoredEvent, "sequence">;

export const LOWER_A_WRONG_EVENT = {
  clientTimeMs: 100,
  targetChar: "a",
  actualChar: "x",
  physicalCode: "KeyX",
  shiftSide: "none",
  modifiers: { shift: false, capsLock: false, altGraph: false },
  isCorrect: false,
  isCorrection: false,
  backspaceCount: 0,
  ikiMs: null,
  featureChar: "a",
  bigram: null,
  trigram: null,
  mappedHand: "left",
  mappedFinger: "left-pinky",
  keyboardRow: "home",
  zone: "left-pinky",
  characterClass: "lowercase",
  contentMode: "smart",
  textPosition: 0,
  isWordBoundary: false,
  isAfterError: false,
  wasRefocus: true,
  wasPaused: false,
  wasLongPause: false,
  wasThrottled: false,
  wasRepeat: false
} as const satisfies EmittedEvent;

export const LOWER_A_CORRECTION_EVENT = {
  clientTimeMs: 200,
  targetChar: "a",
  actualChar: "a",
  physicalCode: "KeyA",
  shiftSide: "none",
  modifiers: { shift: false, capsLock: false, altGraph: false },
  isCorrect: true,
  isCorrection: true,
  backspaceCount: 1,
  ikiMs: 100,
  featureChar: "a",
  bigram: null,
  trigram: null,
  mappedHand: "left",
  mappedFinger: "left-pinky",
  keyboardRow: "home",
  zone: "left-pinky",
  characterClass: "lowercase",
  contentMode: "smart",
  textPosition: 0,
  isWordBoundary: false,
  isAfterError: true,
  wasRefocus: false,
  wasPaused: false,
  wasLongPause: false,
  wasThrottled: false,
  wasRepeat: false
} as const satisfies EmittedEvent;

export const LOWER_A_RECOVERY_EVENT = {
  clientTimeMs: 200,
  targetChar: "a",
  actualChar: "a",
  physicalCode: "KeyA",
  shiftSide: "none",
  modifiers: { shift: false, capsLock: false, altGraph: false },
  isCorrect: true,
  isCorrection: false,
  backspaceCount: 0,
  ikiMs: 100,
  featureChar: "a",
  bigram: null,
  trigram: null,
  mappedHand: "left",
  mappedFinger: "left-pinky",
  keyboardRow: "home",
  zone: "left-pinky",
  characterClass: "lowercase",
  contentMode: "smart",
  textPosition: 0,
  isWordBoundary: false,
  isAfterError: true,
  wasRefocus: false,
  wasPaused: false,
  wasLongPause: false,
  wasThrottled: false,
  wasRepeat: false
} as const satisfies EmittedEvent;

export const LOWER_A_CORRECT_EVENT = {
  clientTimeMs: 100,
  targetChar: "a",
  actualChar: "a",
  physicalCode: "KeyA",
  shiftSide: "none",
  modifiers: { shift: false, capsLock: false, altGraph: false },
  isCorrect: true,
  isCorrection: false,
  backspaceCount: 0,
  ikiMs: null,
  featureChar: "a",
  bigram: null,
  trigram: null,
  mappedHand: "left",
  mappedFinger: "left-pinky",
  keyboardRow: "home",
  zone: "left-pinky",
  characterClass: "lowercase",
  contentMode: "smart",
  textPosition: 0,
  isWordBoundary: false,
  isAfterError: false,
  wasRefocus: true,
  wasPaused: false,
  wasLongPause: false,
  wasThrottled: false,
  wasRepeat: false
} as const satisfies EmittedEvent;

export function renderGoldenSurface(
  target: string,
  clock: { now: number },
  options: {
    settings?: Partial<AppSettings>;
    sessionStartedAtMs?: number;
  } = {}
) {
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  const handle = createRef<TypingSurfaceHandle>();
  const onEvent = vi.fn<(event: EmittedEvent) => boolean | void>();
  const onComplete = vi.fn<(progress: TypingProgress) => void>();

  render(
    <TypingSurface
      ref={handle}
      target={target}
      mode="smart"
      settings={{ ...testSettings, keyboardVisible: false, ...options.settings }}
      sessionStartedAtMs={options.sessionStartedAtMs ?? clock.now}
      active
      autoPauseOnBlur={false}
      onEvent={onEvent}
      onComplete={onComplete}
    />
  );

  return {
    handle,
    onComplete,
    onEvent,
    surface: screen.getByRole("textbox", { name: "打字练习输入区" })
  };
}

export function emittedEvents(
  onEvent: ReturnType<typeof vi.fn<(event: EmittedEvent) => boolean | void>>
) {
  return onEvent.mock.calls.map(([event]) => event);
}

export function visibleGlyphs(surface: HTMLElement) {
  return Array.from(surface.querySelectorAll<HTMLElement>(".typing-glyph")).map((glyph) => ({
    className: glyph.className,
    dataActual: glyph.getAttribute("data-actual"),
    text: glyph.textContent
  }));
}
