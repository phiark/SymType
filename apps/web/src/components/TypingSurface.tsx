import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import {
  getKeyByCharacter,
  netWpm as calculateNetWpm,
  rawWpm as calculateRawWpm,
  SYMMETRIC_LAYOUT,
  type KeyDefinition
} from "@symtype/shared";
import { LogOut, Pause, Play, RotateCcw } from "lucide-react";

import { soundEngine } from "../audio";
import type { AppSettings, StoredEvent } from "../types";
import { VirtualKeyboard } from "./VirtualKeyboard";

export interface TypingProgress {
  position: number;
  attempts: number;
  correct: number;
  errors: number;
  rawWpm: number;
  netWpm: number;
  currentWpm: number;
  accuracy: number;
  peakWpm: number;
  elapsedMs: number;
}

export interface TypingSurfaceHandle {
  focus: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  getProgress: () => TypingProgress;
  getCorrectionPosition: () => number | null;
}

interface TypingSurfaceProps {
  target: string;
  mode: string;
  settings: AppSettings;
  layout?: readonly KeyDefinition[];
  sessionStartedAtMs?: number;
  active: boolean;
  autoPauseOnBlur?: boolean;
  showToolbar?: boolean;
  onEvent: (event: Omit<StoredEvent, "sequence">) => boolean | void;
  onComplete: (progress: TypingProgress) => void;
  onExitRequest?: () => void;
  onPauseChange?: (paused: boolean) => void;
  onProgress?: (progress: TypingProgress) => void;
}

interface GlyphResult {
  actual: string;
  correct: boolean;
  corrected: boolean;
}

type GlyphState = "current" | "untouched" | "correct" | "incorrect" | "corrected";

function getCharacterClass(character: string): string {
  if (/[a-z]/u.test(character)) return "lowercase";
  if (/[A-Z]/u.test(character)) return "uppercase";
  if (/\d/u.test(character)) return "digit";
  if (/\s/u.test(character)) return "whitespace";
  return "symbol";
}

function glyphAccessibilityLabel(character: string, state: GlyphState, actual?: string): string {
  const characterLabel = spokenGlyph(character);
  if (state === "current") return `${characterLabel}，当前待输入`;
  if (state === "untouched") return `${characterLabel}，未输入`;
  if (state === "correct") return `${characterLabel}，已正确输入`;
  if (state === "corrected") return `${characterLabel}，已改正`;
  return `${characterLabel}，输入错误${actual ? `，实际输入 ${spokenGlyph(actual)}` : ""}`;
}

function shiftSideFrom(set: ReadonlySet<string>): "left" | "right" | "both" | "none" {
  const left = set.has("ShiftLeft");
  const right = set.has("ShiftRight");
  if (left && right) return "both";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

function visibleGlyph(character: string): string {
  if (character === " ") return "·";
  if (character === "\n") return "↵\n";
  if (character === "\t") return "⇥";
  return character;
}

function spokenGlyph(character: string): string {
  if (character === " ") return "空格";
  if (character === "\n") return "换行";
  if (character === "\t") return "制表符";
  return character;
}

function stableWindowWpm(ikis: readonly number[]): number {
  if (ikis.length < 5) return 0;
  const sorted = [...ikis].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return median > 0 ? 12_000 / median : 0;
}

export const TypingSurface = memo(
  forwardRef<TypingSurfaceHandle, TypingSurfaceProps>(function TypingSurface(
    {
      target,
      mode,
      settings,
      layout = SYMMETRIC_LAYOUT,
      sessionStartedAtMs = 0,
      active,
      autoPauseOnBlur = true,
      showToolbar = true,
      onEvent,
      onComplete,
      onExitRequest,
      onPauseChange,
      onProgress
    },
    forwardedRef
  ) {
    const surfaceRef = useRef<HTMLDivElement>(null);
    const pauseOverlayRef = useRef<HTMLDivElement>(null);
    const pauseContinueRef = useRef<HTMLButtonElement>(null);
    const startedAtRef = useRef(0);
    const pausedAtRef = useRef(0);
    const pausedTotalRef = useRef(0);
    const lastKeyAtRef = useRef<number | null>(null);
    const rollingIkiRef = useRef<number[]>([]);
    const pressedShiftRef = useRef(new Set<string>());
    const backspaceCountRef = useRef(0);
    const correctionPositionRef = useRef<number | null>(null);
    const afterErrorRef = useRef(false);
    const afterPauseRef = useRef(false);
    const refocusRef = useRef(true);
    const completingRef = useRef(false);
    const lastProgressReportRef = useRef({ attempts: -1, clockMs: 0 });
    const onPauseChangeRef = useRef(onPauseChange);
    const transientTimeoutsRef = useRef(new Set<number>());
    const [results, setResults] = useState<GlyphResult[]>([]);
    const [pendingStoppedError, setPendingStoppedError] = useState(false);
    const [position, setPosition] = useState(0);
    const [attempts, setAttempts] = useState(0);
    const [correct, setCorrect] = useState(0);
    const [errors, setErrors] = useState(0);
    const [currentWpm, setCurrentWpm] = useState(0);
    const [peakWpm, setPeakWpm] = useState(0);
    const [paused, setPaused] = useState(false);
    const [pressedCode, setPressedCode] = useState<string>();
    const [lastWrong, setLastWrong] = useState(false);
    const [clockMs, setClockMs] = useState(() => performance.now());

    const scheduleTransient = useCallback((callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => {
        transientTimeoutsRef.current.delete(timer);
        callback();
      }, delayMs);
      transientTimeoutsRef.current.add(timer);
    }, []);

    const clearTransients = useCallback(() => {
      for (const timer of transientTimeoutsRef.current) window.clearTimeout(timer);
      transientTimeoutsRef.current.clear();
    }, []);

    useEffect(() => clearTransients, [clearTransients]);

    const elapsedMs =
      startedAtRef.current === 0
        ? 0
        : Math.max(
            0,
            (paused ? pausedAtRef.current : clockMs) - startedAtRef.current - pausedTotalRef.current
          );
    const metricDurationMs = attempts === 0 ? 0 : Math.max(50, elapsedMs);
    const submittedErrors = results.filter((result) => !result.correct).length;
    const uncorrectedErrors = submittedErrors + Number(pendingStoppedError);
    const rawWpm = calculateRawWpm(attempts, metricDurationMs);
    const netWpm = calculateNetWpm(attempts, uncorrectedErrors, metricDurationMs);
    const accuracy = attempts === 0 ? 1 : correct / attempts;
    const progress: TypingProgress = useMemo(
      () => ({
        position,
        attempts,
        correct,
        errors,
        rawWpm,
        netWpm,
        currentWpm,
        accuracy,
        peakWpm,
        elapsedMs
      }),
      [
        accuracy,
        attempts,
        correct,
        currentWpm,
        elapsedMs,
        errors,
        netWpm,
        peakWpm,
        position,
        rawWpm
      ]
    );

    const reset = useCallback(() => {
      startedAtRef.current = 0;
      pausedAtRef.current = 0;
      pausedTotalRef.current = 0;
      lastKeyAtRef.current = null;
      rollingIkiRef.current = [];
      backspaceCountRef.current = 0;
      correctionPositionRef.current = null;
      afterErrorRef.current = false;
      afterPauseRef.current = false;
      refocusRef.current = true;
      completingRef.current = false;
      setResults([]);
      setPendingStoppedError(false);
      setPosition(0);
      setAttempts(0);
      setCorrect(0);
      setErrors(0);
      setCurrentWpm(0);
      setPeakWpm(0);
      setPaused(false);
      onPauseChangeRef.current?.(false);
      setLastWrong(false);
      setClockMs(performance.now());
      scheduleTransient(() => surfaceRef.current?.focus(), 0);
    }, [scheduleTransient]);

    const restartCurrentBlock = useCallback(() => {
      const needsPersistedCorrection = attempts > 0 || correctionPositionRef.current !== null;
      reset();
      if (needsPersistedCorrection) {
        correctionPositionRef.current = 0;
        backspaceCountRef.current = 1;
      }
    }, [attempts, reset]);

    useEffect(() => {
      onPauseChangeRef.current = onPauseChange;
    }, [onPauseChange]);

    const setPauseState = useCallback(
      (next: boolean) => {
        if (next === paused) return;
        if (next) {
          pausedAtRef.current = performance.now();
        } else if (pausedAtRef.current) {
          pausedTotalRef.current += performance.now() - pausedAtRef.current;
          pausedAtRef.current = 0;
          afterPauseRef.current = true;
          refocusRef.current = true;
          scheduleTransient(() => surfaceRef.current?.focus(), 0);
        }
        setPaused(next);
        onPauseChange?.(next);
      },
      [onPauseChange, paused, scheduleTransient]
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => surfaceRef.current?.focus(),
        pause: () => setPauseState(true),
        resume: () => setPauseState(false),
        reset,
        getProgress: () => progress,
        getCorrectionPosition: () => correctionPositionRef.current
      }),
      [progress, reset, setPauseState]
    );

    useEffect(() => {
      reset();
      // Target boundaries intentionally reset the transient surface; persisted sequence is external.
    }, [reset, target]);

    useEffect(() => {
      const surface = surfaceRef.current;
      const current = surface?.querySelector<HTMLElement>(".typing-glyph.is-current");
      if (!surface || !current || surface.clientHeight <= 0) return;
      const padding = Math.min(48, surface.clientHeight * 0.2);
      const glyphTop = current.offsetTop;
      const glyphBottom = glyphTop + current.offsetHeight;
      const visibleTop = surface.scrollTop + padding;
      const visibleBottom = surface.scrollTop + surface.clientHeight - padding;
      if (glyphTop >= visibleTop && glyphBottom <= visibleBottom) return;
      surface.scrollTo({
        top: Math.max(
          0,
          glyphTop - surface.clientHeight / 2 + Math.max(1, current.offsetHeight) / 2
        ),
        behavior: settings.smoothScroll ? "smooth" : "auto"
      });
    }, [position, settings.smoothScroll, target]);

    useEffect(() => {
      const timer = window.setInterval(() => setClockMs(performance.now()), 500);
      return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
      if (!paused) return;
      scheduleTransient(() => pauseContinueRef.current?.focus(), 0);
    }, [paused, scheduleTransient]);

    useEffect(() => {
      const previous = lastProgressReportRef.current;
      const dueByCount = progress.attempts === 0 || progress.attempts % 4 === 0;
      const dueByTime = clockMs - previous.clockMs >= 400;
      const completed = progress.position >= target.length;
      if (previous.attempts !== progress.attempts && (dueByCount || completed || dueByTime)) {
        lastProgressReportRef.current = { attempts: progress.attempts, clockMs };
        onProgress?.(progress);
      }
    }, [clockMs, onProgress, progress, target.length]);

    useEffect(() => {
      if (!autoPauseOnBlur) return;
      const pauseForFocusLoss = () => {
        if (active && !paused) setPauseState(true);
      };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") pauseForFocusLoss();
      };
      window.addEventListener("blur", pauseForFocusLoss);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("blur", pauseForFocusLoss);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }, [active, autoPauseOnBlur, paused, setPauseState]);

    const nextKey = useMemo(
      () => getKeyByCharacter(target[position] ?? "", layout),
      [layout, position, target]
    );
    const nextShiftCode = useMemo(() => {
      const character = target[position] ?? "";
      if (!nextKey || nextKey.shifted !== character || nextKey.shifted === nextKey.unshifted)
        return undefined;
      if (nextKey.hand === "left") return "ShiftRight" as const;
      if (nextKey.hand === "right") return "ShiftLeft" as const;
      return undefined;
    }, [nextKey, position, target]);
    const controlsEnabled = active && !completingRef.current;

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!active) return;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        pressedShiftRef.current.add(event.code);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onExitRequest?.();
        return;
      }
      if (paused) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setPauseState(false);
        }
        return;
      }
      if (event.nativeEvent.isComposing || event.key === "Process" || event.keyCode === 229) return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const isCharacterInput =
        event.key.length === 1 || event.key === "Enter" || event.key === "Tab";
      if (completingRef.current) {
        if (event.key === "Backspace" || isCharacterInput) event.preventDefault();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        if (settings.backspaceMode === "disabled" || position === 0) return;
        backspaceCountRef.current += 1;
        const amount =
          settings.backspaceMode === "words"
            ? Math.max(1, target.slice(0, position).match(/\S+\s*$/u)?.[0].length ?? 1)
            : 1;
        const nextPosition = Math.max(0, position - amount);
        correctionPositionRef.current = nextPosition;
        setPendingStoppedError(false);
        setPosition(nextPosition);
        setResults((current) => current.slice(0, nextPosition));
        refocusRef.current = false;
        return;
      }
      if (!isCharacterInput) return;
      event.preventDefault();

      const expected = target[position];
      if (expected === undefined) return;
      const actual = event.key === "Enter" ? "\n" : event.key === "Tab" ? "\t" : event.key;
      const isCorrect = actual === expected;
      const isCorrection = backspaceCountRef.current > 0;
      const clientTime = performance.now();
      setClockMs(clientTime);
      const wasUnstarted = startedAtRef.current === 0;
      if (wasUnstarted) startedAtRef.current = clientTime;
      const rawIki = lastKeyAtRef.current == null ? null : clientTime - lastKeyAtRef.current;
      const wasLongPause = rawIki != null && rawIki > 3000;
      const mapped = getKeyByCharacter(expected, layout);
      const previousTarget = position > 0 ? target[position - 1] : "";
      const previousTwo = position > 1 ? target.slice(position - 2, position) : "";
      const thisProgressAttempts = attempts + 1;
      const thisProgressCorrect = correct + Number(isCorrect);
      const thisProgressErrors = errors + Number(!isCorrect);
      const thisElapsed = Math.max(50, clientTime - startedAtRef.current - pausedTotalRef.current);
      const thisUncorrectedErrors = submittedErrors + Number(!isCorrect);
      const thisRaw = calculateRawWpm(thisProgressAttempts, thisElapsed);
      const thisNet = calculateNetWpm(thisProgressAttempts, thisUncorrectedErrors, thisElapsed);

      const accepted = onEvent({
        clientTimeMs:
          clientTime - (sessionStartedAtMs > 0 ? sessionStartedAtMs : startedAtRef.current),
        targetChar: expected,
        actualChar: actual,
        physicalCode: event.code,
        shiftSide: shiftSideFrom(pressedShiftRef.current),
        modifiers: {
          shift: event.shiftKey,
          capsLock: event.getModifierState("CapsLock"),
          altGraph: event.getModifierState("AltGraph")
        },
        isCorrect,
        isCorrection,
        backspaceCount: backspaceCountRef.current,
        ikiMs: rawIki,
        featureChar: expected,
        bigram: previousTarget ? `${previousTarget}${expected}` : null,
        trigram: previousTwo.length === 2 ? `${previousTwo}${expected}` : null,
        mappedHand: mapped?.hand ?? "unknown",
        mappedFinger: mapped?.finger ?? "unknown",
        keyboardRow: mapped?.row ?? "unknown",
        zone: mapped?.zone ?? "unknown",
        characterClass: getCharacterClass(expected),
        contentMode: mode,
        textPosition: position,
        isWordBoundary: /\s/u.test(expected),
        isAfterError: afterErrorRef.current,
        wasRefocus: refocusRef.current,
        wasPaused: afterPauseRef.current,
        wasLongPause,
        wasThrottled: rawIki != null && rawIki > 10_000,
        wasRepeat: false
      });
      if (accepted === false) {
        if (wasUnstarted) startedAtRef.current = 0;
        return;
      }

      lastKeyAtRef.current = clientTime;
      backspaceCountRef.current = 0;
      correctionPositionRef.current = null;
      afterErrorRef.current = !isCorrect;
      afterPauseRef.current = false;
      refocusRef.current = false;
      setPressedCode(event.code);
      scheduleTransient(() => setPressedCode(undefined), 70);
      setAttempts(thisProgressAttempts);
      setCorrect(thisProgressCorrect);
      setErrors(thisProgressErrors);
      if (rawIki != null && rawIki >= 25 && rawIki <= 3000 && !wasLongPause) {
        rollingIkiRef.current = [...rollingIkiRef.current.slice(-9), rawIki];
      } else if (wasLongPause) {
        rollingIkiRef.current = [];
      }
      const stableCurrent = stableWindowWpm(rollingIkiRef.current);
      setCurrentWpm(stableCurrent);
      if (stableCurrent > 0) setPeakWpm((current) => Math.max(current, stableCurrent));
      setLastWrong(!isCorrect);
      setPendingStoppedError(settings.stopOnError && !isCorrect);

      if (isCorrect) soundEngine.play(expected === " " ? "space" : "key");
      else soundEngine.play("error");
      if (thisProgressCorrect > 0 && thisProgressCorrect % 50 === 0) soundEngine.play("milestone");

      if (!isCorrect && settings.stopOnError) {
        scheduleTransient(() => setLastWrong(false), 180);
        return;
      }

      const nextPosition = position + 1;
      setPosition(nextPosition);
      setResults((current) => [
        ...current,
        { actual, correct: isCorrect, corrected: isCorrection && isCorrect }
      ]);
      if (nextPosition >= target.length) {
        completingRef.current = true;
        const finalProgress: TypingProgress = {
          position: nextPosition,
          attempts: thisProgressAttempts,
          correct: thisProgressCorrect,
          errors: thisProgressErrors,
          rawWpm: thisRaw,
          netWpm: thisNet,
          currentWpm: stableCurrent,
          accuracy: thisProgressCorrect / thisProgressAttempts,
          peakWpm: Math.max(peakWpm, stableCurrent),
          elapsedMs: thisElapsed
        };
        scheduleTransient(() => onComplete(finalProgress), 0);
      }
    };

    const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        pressedShiftRef.current.delete(event.code);
      }
    };

    return (
      <div className="typing-workspace">
        {showToolbar ? (
          <div className="typing-toolbar" aria-label="训练状态">
            <div>
              <strong>{currentWpm > 0 ? Math.round(currentWpm) : "—"}</strong>
              <span>当前 WPM</span>
            </div>
            <div>
              <strong>{Math.round(netWpm)}</strong>
              <span>平均净 WPM</span>
            </div>
            <div>
              <strong>{peakWpm > 0 ? Math.round(peakWpm) : "—"}</strong>
              <span>稳定峰值</span>
            </div>
            <div>
              <strong>{Math.round(accuracy * 100)}%</strong>
              <span>击键准确率</span>
            </div>
            <div>
              <strong>
                {position}/{target.length}
              </strong>
              <span>字符</span>
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={!controlsEnabled}
              onClick={() => setPauseState(!paused)}
              aria-label={paused ? "继续" : "暂停"}
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              className="icon-button"
              type="button"
              disabled={!controlsEnabled}
              onClick={() => {
                if (controlsEnabled) restartCurrentBlock();
              }}
              aria-label="重开当前微组"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        ) : null}
        <div className="typing-surface-frame">
          <div
            ref={surfaceRef}
            className={`typing-surface${paused ? " is-paused" : ""}${lastWrong ? " has-error" : ""}`}
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              scrollBehavior: settings.smoothScroll ? "smooth" : "auto"
            }}
            role="textbox"
            aria-label="打字练习输入区"
            aria-describedby="typing-surface-instructions typing-surface-status"
            aria-invalid={lastWrong}
            aria-multiline="true"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onFocus={() => {
              refocusRef.current = true;
            }}
            onBlur={() => {
              pressedShiftRef.current.clear();
            }}
            data-caret={settings.caretStyle}
          >
            <span className="sr-only" id="typing-surface-instructions">
              请键入显示文本。IME 组合期间不会记录按键。按 Escape 可保存并退出。
            </span>
            {Array.from(target).map((character, index) => {
              const result = results[index];
              const current = index === position;
              const state: GlyphState = result
                ? result.corrected
                  ? "corrected"
                  : result.correct
                    ? "correct"
                    : "incorrect"
                : current
                  ? "current"
                  : "untouched";
              return (
                <span
                  className={`typing-glyph${result ? (result.correct ? " is-correct" : " is-wrong") : ""}${result?.corrected ? " is-corrected" : ""}${current ? " is-current" : ""}`}
                  data-actual={result && !result.correct ? visibleGlyph(result.actual) : undefined}
                  data-state={state}
                  aria-current={current ? "true" : undefined}
                  aria-label={glyphAccessibilityLabel(character, state, result?.actual)}
                  key={`${index}-${character}`}
                >
                  {visibleGlyph(character)}
                </span>
              );
            })}
          </div>
          {paused ? (
            <div
              ref={pauseOverlayRef}
              className="pause-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pause-overlay-title"
              aria-describedby="pause-overlay-description"
              onKeyDown={(event) => {
                // The dialog lives inside the typing surface. Keep button activation from bubbling
                // into the surface's paused Enter/Space shortcut.
                event.stopPropagation();
                if (event.key === "Escape" && onExitRequest) {
                  event.preventDefault();
                  onExitRequest();
                  return;
                }
                if (event.key !== "Tab") return;
                const controls = Array.from(
                  pauseOverlayRef.current?.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)"
                  ) ?? []
                );
                if (!controls.length) return;
                event.preventDefault();
                const currentIndex = Math.max(
                  0,
                  controls.indexOf(document.activeElement as HTMLButtonElement)
                );
                const direction = event.shiftKey ? -1 : 1;
                controls[(currentIndex + direction + controls.length) % controls.length]?.focus();
              }}
            >
              <div className="pause-overlay__content">
                <strong id="pause-overlay-title">训练已暂停</strong>
                <span id="pause-overlay-description">计时已停止。可继续，或打开安全退出确认。</span>
                <div className="pause-overlay__actions">
                  <button
                    ref={pauseContinueRef}
                    className="button button--primary"
                    type="button"
                    onClick={() => setPauseState(false)}
                  >
                    <Play size={18} /> 继续训练
                  </button>
                  {onExitRequest ? (
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={onExitRequest}
                    >
                      <LogOut size={18} /> 退出
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <span className="sr-only" id="typing-surface-status" aria-live="polite">
            {paused
              ? "训练已暂停。"
              : lastWrong
                ? `输入错误；当前目标字符是 ${spokenGlyph(target[position] ?? "")}。`
                : ""}
          </span>
        </div>
        {settings.keyboardVisible ? (
          <VirtualKeyboard
            layout={layout}
            {...(nextKey ? { nextCode: nextKey.code } : {})}
            {...(nextShiftCode ? { nextShiftCode } : {})}
            {...(pressedCode ? { pressedCode } : {})}
            showFingerColors={settings.keyboardFingerColors}
          />
        ) : null}
      </div>
    );
  })
);
