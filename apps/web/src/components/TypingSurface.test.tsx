/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, Profiler, useCallback, useState, type ProfilerOnRenderCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testSettings } from "../test/fixtures";
import type { AppSettings, StoredEvent } from "../types";
import { TypingSurface, type TypingProgress, type TypingSurfaceHandle } from "./TypingSurface";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderSurface(
  target = "ab",
  options: {
    active?: boolean;
    settings?: Partial<AppSettings>;
    onProgress?: (progress: TypingProgress) => void;
    onEvent?: (event: Omit<StoredEvent, "sequence">) => boolean | void;
    onExitRequest?: () => void;
    onPauseChange?: (paused: boolean) => void;
  } = {}
) {
  const onEvent = vi.fn<(event: Omit<StoredEvent, "sequence">) => boolean | void>(
    options.onEvent ?? (() => undefined)
  );
  const onComplete = vi.fn();
  const onProgress = options.onProgress ?? vi.fn<(progress: TypingProgress) => void>();
  const ref = createRef<TypingSurfaceHandle>();
  const surface = (active: boolean) => (
    <TypingSurface
      ref={ref}
      target={target}
      mode="smart"
      settings={{ ...testSettings, keyboardVisible: false, ...options.settings }}
      active={active}
      onEvent={onEvent}
      onComplete={onComplete}
      onProgress={onProgress}
      {...(options.onExitRequest ? { onExitRequest: options.onExitRequest } : {})}
      {...(options.onPauseChange ? { onPauseChange: options.onPauseChange } : {})}
    />
  );
  const view = render(surface(options.active ?? true));
  return {
    surface: screen.getByRole("textbox", { name: "打字练习输入区" }),
    onEvent,
    onComplete,
    ref,
    rerenderActive: (active: boolean) => view.rerender(surface(active))
  };
}

describe("TypingSurface keyboard event boundary", () => {
  it("keeps current, untouched, incorrect, corrected, and correct glyph states distinct", () => {
    const { surface } = renderSurface("ab");
    const glyphs = surface.querySelectorAll<HTMLElement>(".typing-glyph");

    expect(glyphs[0]).toHaveAttribute("data-state", "current");
    expect(glyphs[0]).toHaveAttribute("aria-current", "true");
    expect(glyphs[0]).toHaveAttribute("aria-label", "a，当前待输入");
    expect(glyphs[1]).toHaveAttribute("data-state", "untouched");
    expect(glyphs[1]).toHaveAttribute("aria-label", "b，未输入");

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    expect(glyphs[0]).toHaveAttribute("data-state", "incorrect");
    expect(glyphs[0]).toHaveAttribute("aria-label", "a，输入错误，实际输入 x");
    expect(glyphs[1]).toHaveAttribute("data-state", "current");

    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    expect(glyphs[0]).toHaveAttribute("data-state", "corrected");
    expect(glyphs[0]).toHaveClass("is-correct", "is-corrected");
    expect(glyphs[0]).toHaveAttribute("aria-label", "a，已改正");
    expect(glyphs[1]).toHaveAttribute("data-state", "current");
  });

  it("announces whitespace glyphs by meaning instead of their visual marks", () => {
    const { surface } = renderSurface(" \n\t");
    const glyphs = surface.querySelectorAll<HTMLElement>(".typing-glyph");

    expect(glyphs[0]).toHaveAttribute("aria-label", "空格，当前待输入");
    expect(glyphs[1]).toHaveAttribute("aria-label", "换行，未输入");
    expect(glyphs[2]).toHaveAttribute("aria-label", "制表符，未输入");

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    expect(glyphs[0]).toHaveAttribute("aria-label", "空格，输入错误，实际输入 x");
  });

  it("keeps pause actions keyboard-contained and delegates exit to the guarded owner", async () => {
    const onExitRequest = vi.fn();
    const { surface } = renderSurface("ab", { onExitRequest });

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    const dialog = screen.getByRole("dialog", { name: "训练已暂停" });
    const continueButton = within(dialog).getByRole("button", { name: "继续训练" });
    const exitButton = within(dialog).getByRole("button", { name: "退出" });
    await waitFor(() => expect(continueButton).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(continueButton, { key: "Tab" });
    expect(exitButton).toHaveFocus();
    fireEvent.keyDown(exitButton, { key: "Tab" });
    expect(continueButton).toHaveFocus();
    fireEvent.keyDown(continueButton, { key: "Tab", shiftKey: true });
    expect(exitButton).toHaveFocus();

    fireEvent.keyDown(exitButton, { key: "Enter" });
    expect(dialog).toBeVisible();
    fireEvent.click(exitButton);
    expect(onExitRequest).toHaveBeenCalledTimes(1);
    expect(dialog).toBeVisible();

    fireEvent.click(continueButton);
    await waitFor(() => expect(surface).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "训练已暂停" })).not.toBeInTheDocument();
  });

  it("cancels transient callbacks when the surface unmounts", async () => {
    vi.useFakeTimers();
    const { surface, onComplete } = renderSurface("a", { settings: { stopOnError: true } });

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();
    await act(() => vi.runAllTimers());

    expect(vi.getTimerCount()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ignores IME composition events and operating-system key repeats", () => {
    const { surface, onEvent, onComplete } = renderSurface();

    fireEvent.keyDown(surface, { key: "a", code: "KeyA", isComposing: true });
    fireEvent.keyDown(surface, { key: "Process", code: "KeyA", keyCode: 229 });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA", repeat: true });

    expect(onEvent).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText("0/2")).toBeVisible();

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actualChar: "a",
        physicalCode: "KeyA",
        textPosition: 0,
        wasRepeat: false
      })
    );
  });

  it("records the held Shift side without treating Shift itself as a character", () => {
    const { surface, onEvent } = renderSurface("A!");

    fireEvent.keyDown(surface, { key: "Shift", code: "ShiftRight", shiftKey: true });
    expect(onEvent).not.toHaveBeenCalled();
    fireEvent.keyDown(surface, { key: "A", code: "KeyA", shiftKey: true });

    expect(onEvent).toHaveBeenCalledTimes(1);
    const recorded = onEvent.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({ actualChar: "A", isCorrect: true, shiftSide: "right" });
    expect(recorded?.modifiers.shift).toBe(true);
  });

  it("records Shift side, number, and shifted symbol by physical key", () => {
    const { surface, onEvent } = renderSurface("A1!z");

    fireEvent.keyDown(surface, { key: "Shift", code: "ShiftRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "A", code: "KeyA", shiftKey: true });
    fireEvent.keyUp(surface, { key: "Shift", code: "ShiftRight" });
    fireEvent.keyDown(surface, { key: "1", code: "Digit1" });
    fireEvent.keyDown(surface, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    fireEvent.keyDown(surface, { key: "!", code: "Digit1", shiftKey: true });
    fireEvent.keyUp(surface, { key: "Shift", code: "ShiftLeft" });

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      targetChar: "A",
      actualChar: "A",
      physicalCode: "KeyA",
      shiftSide: "right",
      characterClass: "uppercase",
      isCorrect: true
    });
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      targetChar: "1",
      actualChar: "1",
      physicalCode: "Digit1",
      shiftSide: "none",
      characterClass: "digit",
      mappedFinger: "left-pinky",
      isCorrect: true
    });
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({
      targetChar: "!",
      actualChar: "!",
      physicalCode: "Digit1",
      shiftSide: "left",
      characterClass: "symbol",
      mappedFinger: "left-pinky",
      isCorrect: true
    });
  });

  it("marks the first key after Backspace as a correction without duplicating progress", () => {
    const { surface, onEvent } = renderSurface("abc");

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    expect(screen.getByText("1/3")).toBeVisible();
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    expect(screen.getByText("0/3")).toBeVisible();
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    fireEvent.keyDown(surface, { key: "b", code: "KeyB" });

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      targetChar: "a",
      actualChar: "x",
      isCorrect: false,
      isCorrection: false,
      backspaceCount: 0,
      textPosition: 0
    });
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      targetChar: "a",
      actualChar: "a",
      isCorrect: true,
      isCorrection: true,
      backspaceCount: 1,
      textPosition: 0,
      isAfterError: true
    });
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({
      targetChar: "b",
      actualChar: "b",
      isCorrect: true,
      isCorrection: false,
      backspaceCount: 0,
      textPosition: 1
    });
    expect(screen.getByText("2/3")).toBeVisible();
  });

  it("exposes a trailing Backspace checkpoint until a correcting key is accepted", async () => {
    let readCheckpoint = (): number | null | undefined => undefined;
    let checkpointAfterAcceptedCallback: number | null | undefined;
    const { surface, ref } = renderSurface("ab", {
      onEvent: (event) => {
        if (event.isCorrection) {
          queueMicrotask(() => {
            checkpointAfterAcceptedCallback = readCheckpoint();
          });
        }
      }
    });
    readCheckpoint = () => ref.current?.getCorrectionPosition();

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    expect(ref.current?.getCorrectionPosition()).toBe(0);

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    await act(() => Promise.resolve());
    expect(ref.current?.getCorrectionPosition()).toBeNull();
    expect(checkpointAfterAcceptedCallback).toBeNull();
    const progress = ref.current?.getProgress();
    expect(progress).toMatchObject({ errors: 1 });
    expect(progress?.rawWpm).toBeGreaterThan(0);
    expect(progress?.netWpm).toBe(progress?.rawWpm);
  });

  it("rejects Backspace and character input after completion is latched", () => {
    const { surface, onEvent, ref } = renderSurface("a");

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    expect(screen.getByText("1/1")).toBeVisible();

    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });

    expect(screen.getByText("1/1")).toBeVisible();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(ref.current?.getCorrectionPosition()).toBeNull();
    expect(screen.getByRole("button", { name: "重开当前微组" })).toBeDisabled();
  });

  it("keeps a trailing correction checkpoint when controls become inactive during save", () => {
    const { surface, ref, rerenderActive } = renderSurface("ab");

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    expect(ref.current?.getCorrectionPosition()).toBe(0);

    rerenderActive(false);
    const restart = screen.getByRole("button", { name: "重开当前微组" });
    expect(restart).toBeDisabled();
    fireEvent.click(restart);

    expect(ref.current?.getCorrectionPosition()).toBe(0);
    expect(ref.current?.getProgress()).toMatchObject({ position: 0, attempts: 1 });
  });

  it("persists a manual restart until save or the first replacement key", () => {
    const { surface, onEvent, ref } = renderSurface("ab");

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    const restart = screen.getByRole("button", { name: "重开当前微组" });
    fireEvent.click(restart);
    fireEvent.click(restart);

    expect(ref.current?.getCorrectionPosition()).toBe(0);
    expect(ref.current?.getProgress()).toMatchObject({ position: 0, attempts: 0 });

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        textPosition: 0,
        isCorrection: true,
        backspaceCount: 1
      })
    );
    expect(ref.current?.getCorrectionPosition()).toBeNull();
  });

  it("keeps the caret on an error when stop-on-error is enabled", () => {
    const { surface, onEvent, ref } = renderSurface("ab", { settings: { stopOnError: true } });

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });
    expect(screen.getByText("0/2")).toBeVisible();
    expect(ref.current?.getProgress()).toMatchObject({ errors: 1, netWpm: 0 });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(screen.getByText("1/2")).toBeVisible();
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      targetChar: "a",
      actualChar: "a",
      isAfterError: true,
      textPosition: 0
    });
    expect(ref.current?.getProgress().netWpm).toBe(ref.current?.getProgress().rawWpm);
  });

  it("applies disabled and word Backspace policies without inventing events", () => {
    const disabled = renderSurface("ab", { settings: { backspaceMode: "disabled" } });
    fireEvent.keyDown(disabled.surface, { key: "a", code: "KeyA" });
    fireEvent.keyDown(disabled.surface, { key: "Backspace", code: "Backspace" });
    expect(screen.getByText("1/2")).toBeVisible();
    expect(disabled.onEvent).toHaveBeenCalledTimes(1);
    cleanup();

    const words = renderSurface("abc defg", { settings: { backspaceMode: "words" } });
    for (const character of "abc def") {
      fireEvent.keyDown(words.surface, {
        key: character,
        code: character === " " ? "Space" : `Key${character.toUpperCase()}`
      });
    }
    expect(screen.getByText("7/8")).toBeVisible();
    fireEvent.keyDown(words.surface, { key: "Backspace", code: "Backspace" });
    expect(screen.getByText("4/8")).toBeVisible();
    expect(words.onEvent).toHaveBeenCalledTimes(7);
  });

  it.each([
    [false, "auto"],
    [true, "smooth"]
  ] as const)("keeps the current glyph visible with smooth-scroll=%s", (smoothScroll, behavior) => {
    const { surface } = renderSurface("abc", { settings: { smoothScroll } });
    const nextGlyph = surface.querySelectorAll<HTMLElement>(".typing-glyph")[1];
    expect(nextGlyph).toBeDefined();
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 0, writable: true }
    });
    Object.defineProperties(nextGlyph!, {
      offsetTop: { configurable: true, value: 160 },
      offsetHeight: { configurable: true, value: 20 }
    });
    const scrollTo = vi.fn();
    Object.defineProperty(surface, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior });
  });

  it("attributes a wrong key to the expected target zone while retaining its physical code", () => {
    const { surface, onEvent } = renderSurface("a");

    fireEvent.keyDown(surface, { key: "x", code: "KeyX" });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChar: "a",
        actualChar: "x",
        physicalCode: "KeyX",
        mappedHand: "left",
        mappedFinger: "left-pinky",
        keyboardRow: "home",
        zone: "left-pinky"
      })
    );
  });

  it("marks only the first accepted key after resume as paused and refocused", () => {
    const { surface, onEvent } = renderSurface("abc");
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.keyDown(surface, { key: "b", code: "KeyB" });
    fireEvent.keyDown(surface, { key: "c", code: "KeyC" });

    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({ wasPaused: true, wasRefocus: true });
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({ wasPaused: false, wasRefocus: false });
  });

  it("throttles parent progress reports during a repeatable 24-key burst", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    const target = "abcdefghijklmnopqrstuvwx------";
    const onProgress = vi.fn();
    const { surface, onEvent } = renderSurface(target, { onProgress });

    for (const character of target.slice(0, 24)) {
      fireEvent.keyDown(surface, { key: character, code: `Key${character.toUpperCase()}` });
    }

    expect(onEvent).toHaveBeenCalledTimes(24);
    const reportedAttempts = onProgress.mock.calls.map(
      ([progress]) => (progress as { attempts: number }).attempts
    );
    expect(reportedAttempts).toEqual([0, 4, 8, 12, 16, 20, 24]);
    expect(onProgress.mock.calls.length).toBeLessThan(24 / 2);
  });

  it("keeps page-shell commits below half the keystroke count in a profiled burst", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    const target = "abcdefghijklmnopqrstuvwx------";
    const shellCommits: Parameters<ProfilerOnRenderCallback>[1][] = [];
    const onShellRender: ProfilerOnRenderCallback = (_id, phase) => shellCommits.push(phase);

    function ProfiledHarness() {
      const [reportedPosition, setReportedPosition] = useState(-1);
      const reportProgress = useCallback(
        (next: TypingProgress) => setReportedPosition(next.position),
        []
      );

      return (
        <>
          <Profiler id="practice-page-shell" onRender={onShellRender}>
            <output data-testid="reported-position">{reportedPosition}</output>
          </Profiler>
          <TypingSurface
            target={target}
            mode="smart"
            settings={{ ...testSettings, keyboardVisible: false }}
            active
            onEvent={() => undefined}
            onComplete={() => undefined}
            onProgress={reportProgress}
          />
        </>
      );
    }

    render(<ProfiledHarness />);
    const surface = screen.getByRole("textbox", { name: "打字练习输入区" });
    for (const character of target.slice(0, 24)) {
      fireEvent.keyDown(surface, { key: character, code: `Key${character.toUpperCase()}` });
    }

    expect(screen.getByTestId("reported-position")).toHaveTextContent("24");
    expect(shellCommits).toHaveLength(8);
    expect(shellCommits.length).toBeLessThan(24 / 2);
  });

  it("reports current and peak WPM only after a stable five-interval window", () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { surface } = renderSurface("abcdefg");

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    expect(screen.getByText("当前 WPM").previousElementSibling).toHaveTextContent("—");
    expect(screen.getByText("稳定峰值").previousElementSibling).toHaveTextContent("—");

    for (const character of "bcdef") {
      now += 200;
      fireEvent.keyDown(surface, { key: character, code: `Key${character.toUpperCase()}` });
    }
    expect(screen.getByText("当前 WPM").previousElementSibling).toHaveTextContent("60");
    expect(screen.getByText("稳定峰值").previousElementSibling).toHaveTextContent("60");

    now += 4_000;
    fireEvent.keyDown(surface, { key: "g", code: "KeyG" });
    expect(screen.getByText("当前 WPM").previousElementSibling).toHaveTextContent("—");
    expect(screen.getByText("稳定峰值").previousElementSibling).toHaveTextContent("60");
  });

  it("does not advance the visible target when persistence rejects an event", () => {
    const onEvent = vi.fn(() => false);
    const { surface, onComplete } = renderSurface("ab", { onEvent });

    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(screen.getByText("0/2")).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reset resumes a paused surface and informs the parent timer", () => {
    const onPauseChange = vi.fn();
    renderSurface("ab", { onPauseChange });
    onPauseChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(onPauseChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "重开当前微组" }));

    expect(onPauseChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "暂停" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "继续训练" })).not.toBeInTheDocument();
  });
});
