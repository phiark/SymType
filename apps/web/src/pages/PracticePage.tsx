import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  adjustDifficulty,
  allocateLessonPhases,
  median,
  medianAbsoluteDeviation
} from "@symtype/shared";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CloudOff,
  Database,
  Headphones,
  LoaderCircle,
  Save,
  X
} from "lucide-react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { soundEngine } from "../audio";
import {
  activeElapsedMs,
  CALIBRATION_BLOCK_LENGTH,
  CALIBRATION_MAX_ACTIVE_MS,
  calibrationCategoryForBlock,
  calibrationCompletionDecision,
  resolveCalibrationActiveMs
} from "../calibration-policy";
import {
  TypingSurface,
  type TypingProgress,
  type TypingSurfaceHandle
} from "../components/TypingSurface";
import { MetricCard } from "../components/ui";
import { userErrorText } from "../error-presentation";
import { strategyForLocalDate } from "../experiment";
import { usePersistentEvents } from "../hooks/usePersistentEvents";
import { useSessionNavigationGuard } from "../hooks/useSessionNavigationGuard";
import { activeKeyboardLayout, focusCharactersForScopes } from "../keyboard";
import type { BootstrapData, SessionSummary, StoredEvent } from "../types";

type Phase = "warmup" | "focus" | "retest" | "transfer" | "fluency" | "explore";
type TrainingBias = "accuracy" | "balanced" | "speed";

interface SessionResponse {
  session: { id: string; lessonId: string; status: string };
}

interface BlockRecord {
  id: string;
  lesson_id: string;
  block_index: number;
  block_type: string;
  target_text: string;
  rationale: string;
  source_start?: number;
}

interface CalibrationResult {
  segments: { label: string; accuracy: number; wpm: number; samples: number }[];
  consistency: number;
  balance: string;
  slowKeys: string[];
  slowCombos: string[];
  suggestedWpm: number;
}

const calibrationCategoryIds = [
  "letters",
  "bigrams",
  "index",
  "digits",
  "symbols",
  "shift"
] as const;
type CalibrationCategory = (typeof calibrationCategoryIds)[number];

const calibrationCategoryDetails: Record<CalibrationCategory, { label: string; scope: string }> = {
  letters: { label: "字母", scope: "字母" },
  bigrams: { label: "常见二元组合", scope: "字母" },
  index: { label: "食指边界", scope: "食指区" },
  digits: { label: "数字", scope: "数字" },
  symbols: { label: "标点 / 符号", scope: "符号" },
  shift: { label: "大小写 / Shift", scope: "大小写" }
};

function isCalibrationCategory(value: string): value is CalibrationCategory {
  return calibrationCategoryIds.includes(value as CalibrationCategory);
}

function calibrationResult(
  events: readonly Omit<StoredEvent, "sequence">[],
  fallbackWpm: number,
  categories: readonly CalibrationCategory[]
): CalibrationResult {
  const segments = categories.map((category) => {
    const samples = events.filter((event) => event.contentMode === `calibration-${category}`);
    const correctIkis = samples.flatMap((event) =>
      event.isCorrect && event.ikiMs != null && !event.wasLongPause ? [event.ikiMs] : []
    );
    const center = median(correctIkis);
    return {
      label: calibrationCategoryDetails[category].label,
      accuracy: samples.length
        ? samples.filter((event) => event.isCorrect).length / samples.length
        : 0,
      wpm: center == null || center <= 0 ? 0 : 12_000 / center,
      samples: samples.length
    };
  });
  const validIkis = events.flatMap((event) =>
    event.isCorrect && event.ikiMs != null && !event.wasLongPause ? [event.ikiMs] : []
  );
  const center = median(validIkis);
  const dispersion = medianAbsoluteDeviation(validIkis);
  const consistency =
    center == null || dispersion == null || center === 0 ? 0 : Math.max(0, 1 - dispersion / center);
  const handWpm = (hand: string) => {
    const handCenter = median(
      events.flatMap((event) =>
        event.mappedHand === hand && event.isCorrect && event.ikiMs != null && !event.wasLongPause
          ? [event.ikiMs]
          : []
      )
    );
    return handCenter == null || handCenter <= 0 ? 0 : 12_000 / handCenter;
  };
  const ranked = <K extends "featureChar" | "bigram">(key: K) => {
    const groups = new Map<string, number[]>();
    for (const event of events) {
      const value = event[key];
      if (!value || !event.isCorrect || event.ikiMs == null || event.wasLongPause) continue;
      groups.set(value, [...(groups.get(value) ?? []), event.ikiMs]);
    }
    return [...groups.entries()]
      .filter(([, values]) => values.length >= 2)
      .sort((first, second) => (median(second[1]) ?? 0) - (median(first[1]) ?? 0))
      .slice(0, 3)
      .map(([value]) => value);
  };
  const observed = segments.filter((segment) => segment.wpm > 0).map((segment) => segment.wpm);
  const conservative = observed.length ? Math.min(...observed) : fallbackWpm;
  return {
    segments,
    consistency,
    balance: `左手 ${Math.round(handWpm("left"))} / 右手 ${Math.round(handWpm("right"))} WPM`,
    slowKeys: ranked("featureChar"),
    slowCombos: ranked("bigram"),
    suggestedWpm: Math.max(10, Math.round(conservative * 0.9))
  };
}

const phaseLabels: Record<Phase, string> = {
  warmup: "热身",
  focus: "聚焦",
  retest: "间隔复测",
  transfer: "迁移",
  fluency: "流畅度",
  explore: "探索样本"
};

function activeContextLabel(kind: "training" | "test", mode: string, blockType?: string): string {
  if (kind === "test") return "测试";
  if (mode === "calibration" && blockType?.startsWith("calibration-")) {
    const category = blockType.replace("calibration-", "");
    return isCalibrationCategory(category)
      ? `基线 · ${calibrationCategoryDetails[category].label}`
      : "基线取样";
  }
  return phaseLabels[(blockType as Phase | undefined) ?? "focus"] ?? "训练";
}

const trainingBiasLabels: Record<TrainingBias, string> = {
  accuracy: "准确优先",
  balanced: "平衡",
  speed: "速度挑战"
};

function resolveTrainingBias(value: string | null, fallback: TrainingBias): TrainingBias {
  return value === "accuracy" || value === "balanced" || value === "speed" ? value : fallback;
}

function phaseFor(
  index: number,
  totalBlocks: number,
  accuracy: number,
  durationMinutes: number,
  policy: { accuracyFloor: number; promotionAccuracy: number }
): Phase {
  if (index === 0) return "warmup";
  const phases = allocateLessonPhases(accuracy, durationMinutes, policy).map((allocation) => ({
    phase:
      allocation.phase === "blocked"
        ? ("focus" as const)
        : allocation.phase === "interleave"
          ? ("retest" as const)
          : allocation.phase,
    fraction: allocation.fraction
  }));
  const position = (index + 0.5) / Math.max(1, totalBlocks);
  let cumulative = 0;
  for (const allocation of phases) {
    cumulative += allocation.fraction;
    if (position <= cumulative) return allocation.phase;
  }
  return "fluency";
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function PracticePage({ kind = "training" }: { kind?: "training" | "test" }) {
  const { bootstrap } = useOutletContext<{ bootstrap: BootstrapData }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const surfaceRef = useRef<TypingSurfaceHandle>(null);
  const completionHeadingRef = useRef<HTMLHeadingElement>(null);
  const finishingRef = useRef(false);
  const blockCompletionInFlightRef = useRef(false);
  const pendingBlockCompletionRef = useRef<TypingProgress | null>(null);
  const eventHistoryRef = useRef<Array<Omit<StoredEvent, "sequence">>>([]);
  const startedAtRef = useRef(0);
  const pauseStartedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const isPausedRef = useRef(false);
  const recoveryAttemptedRef = useRef(new Set<string>());
  const sessionIdRef = useRef<string | null>(null);
  const lessonIdRef = useRef<string | null>(null);
  const blockIdRef = useRef<string | null>(null);
  const exitWasPausedRef = useRef(false);
  const cancellingBlockedNavigationRef = useRef(false);
  const sessionSeedRef = useRef(0);
  const [state, setState] = useState<"ready" | "starting" | "running" | "saving" | "complete">(
    "ready"
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [block, setBlock] = useState<BlockRecord | null>(null);
  const [blockIndex, setBlockIndex] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [progress, setProgress] = useState<TypingProgress | null>(null);
  const [blockCompletionPending, setBlockCompletionPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [audioNotice, setAudioNotice] = useState("");
  const [exitOpen, setExitOpen] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState(0);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [difficultyRating, setDifficultyRating] = useState(3);
  const [fatigueRating, setFatigueRating] = useState(2);
  const [feedbackState, setFeedbackState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [feedbackError, setFeedbackError] = useState("");

  useEffect(() => {
    if (state !== "complete") return;
    window.setTimeout(() => completionHeadingRef.current?.focus(), 0);
  }, [state]);

  const mode = params.get("mode") || (kind === "test" ? "test" : "smart");
  const bias = resolveTrainingBias(params.get("bias"), bootstrap.settings.trainingBias);
  const requestedSeconds = params.get("seconds") ? Number(params.get("seconds")) : null;
  const requestedDurationMinutes = requestedSeconds
    ? requestedSeconds / 60
    : Number(
        params.get("duration") || (kind === "test" ? 1 : bootstrap.settings.defaultDurationMinutes)
      );
  const durationMinutes =
    mode === "calibration"
      ? resolveCalibrationActiveMs(requestedDurationMinutes) / 60_000
      : Math.min(120, Math.max(0.25, requestedDurationMinutes));
  const focus = useMemo(() => Array.from(params.get("focus") || ""), [params]);
  const scopeLabels = useMemo(
    () => (params.get("scope") || "").split(",").filter(Boolean),
    [params]
  );
  const selectedCalibrationCategories = useMemo(() => {
    const requested = [
      ...new Set(
        (params.get("calibrationCategories") || "").split(",").filter(isCalibrationCategory)
      )
    ];
    return requested.length ? requested : [...calibrationCategoryIds];
  }, [params]);
  const displayLabels = useMemo(() => {
    const label = params.get("label");
    return label ? [label] : scopeLabels;
  }, [params, scopeLabels]);
  const customTextId = params.get("customTextId") || undefined;
  const stageId = params.get("stage") || undefined;
  const includeInModel = params.get("includeInModel") === "1";
  const sessionKind = mode === "calibration" ? "calibration" : kind;
  const keyboardLayout = useMemo(() => activeKeyboardLayout(bootstrap), [bootstrap]);
  const durationMs = durationMinutes * 60_000;
  const maxBlocks =
    kind === "test"
      ? 100
      : mode === "calibration"
        ? Math.max(selectedCalibrationCategories.length, Math.ceil(durationMinutes * 2))
        : Math.min(16, Math.max(4, Math.ceil(durationMinutes)));

  const replaceSessionParam = useCallback(
    (value?: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set("session", value);
      else next.delete("session");
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const getEventContext = useCallback(
    () => ({
      ...(lessonIdRef.current ? { lessonId: lessonIdRef.current } : {}),
      ...(blockIdRef.current ? { blockId: blockIdRef.current } : {})
    }),
    []
  );
  const { enqueue, flush, pendingCount, isAtCapacity } = usePersistentEvents(
    sessionId,
    getEventContext,
    setSaveError
  );
  const { blocker, bypassNextNavigation } = useSessionNavigationGuard(
    Boolean(sessionId) && state !== "complete"
  );

  const openExitConfirmation = useCallback(() => {
    if (!exitOpen) {
      exitWasPausedRef.current = isPausedRef.current;
      surfaceRef.current?.pause();
    }
    setExitOpen(true);
  }, [exitOpen]);

  const cancelExit = useCallback(() => {
    if (exitSaving) return;
    if (blocker.state === "blocked") {
      cancellingBlockedNavigationRef.current = true;
      blocker.reset();
    }
    setExitOpen(false);
    if (!exitWasPausedRef.current) surfaceRef.current?.resume();
  }, [blocker, exitSaving]);

  useEffect(() => {
    if (blocker.state !== "blocked") {
      cancellingBlockedNavigationRef.current = false;
      return;
    }
    if (cancellingBlockedNavigationRef.current) return;
    const timer = window.setTimeout(openExitConfirmation, 0);
    return () => window.clearTimeout(timer);
  }, [blocker.state, openExitConfirmation]);

  const elapsedActiveMs = useCallback(() => {
    return activeElapsedMs({
      startedAtMs: startedAtRef.current,
      nowMs: performance.now(),
      pausedAtMs: pauseStartedAtRef.current,
      pausedTotalMs: pausedTotalRef.current,
      paused: isPausedRef.current
    });
  }, []);

  const currentCorrectionCheckpoint = useCallback(() => {
    const blockId = blockIdRef.current;
    const position = surfaceRef.current?.getCorrectionPosition() ?? null;
    return blockId && position != null ? { blockId, position } : undefined;
  }, []);

  const requestBlock = useCallback(
    async (currentLessonId: string, index: number, lastProgress?: TypingProgress) => {
      const lastAccuracy = lastProgress?.accuracy ?? 1;
      const policy = {
        accuracyFloor: bootstrap.settings.minimumAccuracy,
        promotionAccuracy: bootstrap.settings.progressionAccuracy,
        minimumStableSamples: 30,
        step: 0.08
      };
      const phase = phaseFor(index, maxBlocks, lastAccuracy, durationMinutes, policy);
      const calibrationCategory =
        mode === "calibration"
          ? calibrationCategoryForBlock(selectedCalibrationCategories, index)
          : undefined;
      const calibrationScope = calibrationCategory
        ? calibrationCategoryDetails[calibrationCategory].scope
        : undefined;
      const effectiveScopes = calibrationScope ? [calibrationScope] : scopeLabels;
      const effectiveFocus = calibrationScope
        ? focusCharactersForScopes(effectiveScopes, keyboardLayout)
        : focus;
      const baseDifficulty = bias === "accuracy" ? 0.35 : bias === "speed" ? 0.75 : 0.55;
      const adjusted = adjustDifficulty(
        baseDifficulty,
        lastAccuracy,
        lastProgress?.attempts ?? 0,
        0,
        policy
      );
      const phaseLength: Record<Phase, number> = {
        warmup: 38,
        focus: 42,
        retest: 46,
        transfer: 54,
        fluency: 58,
        explore: 48
      };
      const adaptiveLength = Math.round(phaseLength[phase] * (0.8 + adjusted.difficulty * 0.4));
      const response = await api.post<{ block: BlockRecord }>(
        `/api/v1/lessons/${currentLessonId}/blocks/next`,
        {
          blockIndex: index,
          seed: (sessionSeedRef.current + index * 7919) % 2_147_483_647,
          mode,
          length:
            kind === "test"
              ? 72
              : mode === "calibration"
                ? CALIBRATION_BLOCK_LENGTH
                : adaptiveLength,
          focus: effectiveFocus,
          scopeLabels: effectiveScopes,
          allowedCharacters: effectiveFocus,
          strictScope: effectiveScopes.length > 0 || mode === "calibration" || mode === "rescue",
          ...(customTextId ? { customTextId } : {}),
          ...(calibrationCategory ? { calibrationCategory } : {}),
          phase
        }
      );
      blockIdRef.current = response.block.id;
      setBlock(response.block);
      setBlockIndex(index);
      setState("running");
      window.setTimeout(() => surfaceRef.current?.focus(), 50);
    },
    [
      bias,
      bootstrap.settings.minimumAccuracy,
      bootstrap.settings.progressionAccuracy,
      customTextId,
      durationMinutes,
      focus,
      keyboardLayout,
      kind,
      maxBlocks,
      mode,
      scopeLabels,
      selectedCalibrationCategories
    ]
  );

  const start = async () => {
    setState("starting");
    setSaveError("");
    blockCompletionInFlightRef.current = false;
    pendingBlockCompletionRef.current = null;
    setBlockCompletionPending(false);
    setCalibration(null);
    setFeedbackState("idle");
    eventHistoryRef.current = [];
    pauseStartedAtRef.current = 0;
    pausedTotalRef.current = 0;
    isPausedRef.current = false;
    setSessionPaused(false);
    soundEngine.configure(bootstrap.settings);
    const audioReady = await soundEngine.unlock();
    if (!audioReady && bootstrap.settings.soundEnabled) {
      setAudioNotice("浏览器未解锁声音；训练继续，点击页面后可在设置中再次试听。 ");
    }
    try {
      const requestedSeedParam = params.get("seed");
      const requestedSeed = requestedSeedParam == null ? Number.NaN : Number(requestedSeedParam);
      const randomSeed = globalThis.crypto?.getRandomValues
        ? (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1)
        : Date.now();
      const sessionSeed =
        Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 2_147_483_647
          ? requestedSeed
          : randomSeed % 2_147_483_647;
      sessionSeedRef.current = sessionSeed;
      const response = await api.post<SessionResponse>("/api/v1/sessions", {
        kind: sessionKind,
        mode,
        strategy: strategyForLocalDate(bootstrap.settings.experimentEnabled),
        seed: sessionSeed,
        focus,
        ...(stageId ? { stageId } : {}),
        ...(customTextId ? { includeInModel } : {})
      });
      sessionIdRef.current = response.session.id;
      lessonIdRef.current = response.session.lessonId;
      setSessionId(response.session.id);
      setLessonId(response.session.lessonId);
      replaceSessionParam(response.session.id);
      await requestBlock(response.session.lessonId, 0);
      const sessionStart = performance.now();
      startedAtRef.current = sessionStart;
      setSessionStartedAtMs(sessionStart);
      setRemainingMs(durationMs);
    } catch (error) {
      setSaveError(userErrorText(error, "start"));
      setState("ready");
    }
  };

  const finishSession = useCallback(
    async (activeMs?: number): Promise<boolean> => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || finishingRef.current) return false;
      const correctionCheckpoint = currentCorrectionCheckpoint();
      finishingRef.current = true;
      setState("saving");
      try {
        await flush();
        const response = await api.post<{ saved: boolean; summary: SessionSummary }>(
          `/api/v1/sessions/${activeSessionId}/complete`,
          {
            activeMs: Math.round(activeMs ?? Math.max(1000, elapsedActiveMs())),
            ...(correctionCheckpoint ? { correctionCheckpoint } : {})
          }
        );
        if (kind === "test" && response.summary.characters > 0) {
          await api.post("/api/v1/tests", {
            sessionId: activeSessionId,
            durationSeconds: Math.round(durationMs / 1000)
          });
        }
        setSummary(response.summary);
        if (mode === "calibration") {
          setCalibration(
            calibrationResult(
              eventHistoryRef.current,
              response.summary.netWpm,
              selectedCalibrationCategories
            )
          );
          await api.patch("/api/v1/settings", { calibrationComplete: true });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }
        setState("complete");
        bypassNextNavigation();
        replaceSessionParam();
        soundEngine.play("complete");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["statistics"] }),
          queryClient.invalidateQueries({ queryKey: ["tests"] })
        ]);
        return true;
      } catch (error) {
        finishingRef.current = false;
        setSaveError(`${userErrorText(error, "save")} 尚未保存的按键仍保留在当前页面；请重试。`);
        setState("running");
        return false;
      }
    },
    [
      durationMs,
      elapsedActiveMs,
      flush,
      currentCorrectionCheckpoint,
      kind,
      mode,
      bypassNextNavigation,
      queryClient,
      replaceSessionParam,
      selectedCalibrationCategories
    ]
  );

  const completeBlock = async (blockProgress: TypingProgress) => {
    if (!lessonId || blockCompletionInFlightRef.current) return;
    blockCompletionInFlightRef.current = true;
    pendingBlockCompletionRef.current ??= blockProgress;
    setBlockCompletionPending(true);
    try {
      await flush();
      if (customTextId && block) {
        await api.patch(`/api/v1/custom-texts/${customTextId}/progress`, {
          readingPosition: (block.source_start ?? 0) + block.target_text.length,
          blockId: block.id
        });
      }
      const elapsed = elapsedActiveMs();
      const calibrationDecision =
        mode === "calibration"
          ? calibrationCompletionDecision({
              elapsedActiveMs: elapsed,
              targetActiveMs: durationMs,
              selectedCategories: selectedCalibrationCategories,
              contentModes: eventHistoryRef.current.map((event) => event.contentMode),
              atBlockBoundary: true
            })
          : null;
      const shouldFinish = calibrationDecision
        ? calibrationDecision.shouldComplete
        : (kind !== "test" && blockIndex + 1 >= maxBlocks) || elapsed >= durationMs;
      if (shouldFinish) {
        if (await finishSession(elapsed)) {
          pendingBlockCompletionRef.current = null;
          setBlockCompletionPending(false);
        }
        return;
      }
      await requestBlock(lessonId, blockIndex + 1, blockProgress);
      pendingBlockCompletionRef.current = null;
      setBlockCompletionPending(false);
      setSaveError("");
    } catch (error) {
      setSaveError(
        `${userErrorText(error, "session")} 当前微组仍保留在本页；点击重试会复用同一批次，不会把本组误记为已前进。`
      );
      setState("running");
    } finally {
      blockCompletionInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (state !== "running" || (kind !== "test" && mode !== "calibration") || sessionPaused) return;
    const timer = window.setInterval(() => {
      const elapsed = elapsedActiveMs();
      const next = Math.max(0, durationMs - elapsed);
      setRemainingMs(next);
      if (kind === "test" && next === 0) void finishSession(elapsed);
      if (
        mode === "calibration" &&
        elapsed >= CALIBRATION_MAX_ACTIVE_MS &&
        calibrationCompletionDecision({
          elapsedActiveMs: elapsed,
          targetActiveMs: durationMs,
          selectedCategories: selectedCalibrationCategories,
          contentModes: eventHistoryRef.current.map((event) => event.contentMode),
          atBlockBoundary: false
        }).shouldComplete
      ) {
        void finishSession(elapsed);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [
    durationMs,
    elapsedActiveMs,
    finishSession,
    kind,
    mode,
    selectedCalibrationCategories,
    sessionPaused,
    state
  ]);

  const handlePauseChange = (paused: boolean) => {
    if (paused && !isPausedRef.current) {
      pauseStartedAtRef.current = performance.now();
    } else if (!paused && isPausedRef.current && pauseStartedAtRef.current) {
      pausedTotalRef.current += performance.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = 0;
    }
    isPausedRef.current = paused;
    setSessionPaused(paused);
    if (sessionIdRef.current) {
      void api
        .post(`/api/v1/sessions/${sessionIdRef.current}/pause`, { paused })
        .catch((error: unknown) => {
          setSaveError(userErrorText(error, "save"));
        });
    }
  };

  useEffect(() => {
    return () => {
      if (sessionIdRef.current && !finishingRef.current) {
        void flush().catch(() => undefined);
      }
    };
  }, [flush]);

  useEffect(() => {
    const interruptedSessionId = params.get("session");
    if (
      !interruptedSessionId ||
      interruptedSessionId === sessionIdRef.current ||
      recoveryAttemptedRef.current.has(interruptedSessionId)
    )
      return;
    recoveryAttemptedRef.current.add(interruptedSessionId);
    setState("starting");
    void api
      .post<{ recovered: boolean; status: string }>(
        `/api/v1/sessions/${interruptedSessionId}/recover`,
        { disposition: "abandon" }
      )
      .then(async () => {
        setRecoveryNotice(
          "上次刷新中断的半节课程已标记为放弃；已经保存的按键仍保留，但不会冒充完成课程。"
        );
        replaceSessionParam();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["statistics"] })
        ]);
      })
      .catch((error: unknown) => {
        setSaveError(userErrorText(error, "session"));
      })
      .finally(() => setState("ready"));
  }, [params, queryClient, replaceSessionParam]);

  const abandon = async () => {
    setExitSaving(true);
    setSaveError("");
    try {
      if (sessionIdRef.current) {
        const correctionCheckpoint = currentCorrectionCheckpoint();
        await flush();
        await api.post(`/api/v1/sessions/${sessionIdRef.current}/abandon`, {
          ...(correctionCheckpoint ? { correctionCheckpoint } : {})
        });
      }
      sessionIdRef.current = null;
      lessonIdRef.current = null;
      blockIdRef.current = null;
      setSessionId(null);
      setLessonId(null);
      setExitOpen(false);
      if (blocker.state === "blocked") {
        blocker.proceed();
      } else {
        bypassNextNavigation();
        void navigate(kind === "test" ? "/test" : "/train", { replace: true });
      }
    } catch (error) {
      setSaveError(userErrorText(error, "session"));
    } finally {
      setExitSaving(false);
    }
  };

  const saveSubjectiveFeedback = async () => {
    const completedSessionId = sessionIdRef.current;
    if (!completedSessionId) {
      setFeedbackError("当前课程标识已失效，无法保存主观反馈。");
      setFeedbackState("error");
      return;
    }
    setFeedbackState("saving");
    setFeedbackError("");
    try {
      await api.post(`/api/v1/sessions/${completedSessionId}/feedback`, {
        difficulty: difficultyRating,
        fatigue: fatigueRating
      });
      setFeedbackState("saved");
      await queryClient.invalidateQueries({ queryKey: ["statistics"] });
    } catch (error) {
      setFeedbackError(userErrorText(error, "save"));
      setFeedbackState("error");
    }
  };

  if (state === "ready" || state === "starting") {
    return (
      <div className="practice-ready">
        <button
          className="text-button practice-back"
          type="button"
          onClick={() => navigate(kind === "test" ? "/test" : "/train")}
        >
          <ArrowLeft size={16} />
          返回{kind === "test" ? "测试" : "训练"}
        </button>
        <section className="ready-card">
          <p className="eyebrow">{kind === "test" ? "正式打字测试" : "自适应微组"}</p>
          <h1>
            {kind === "test"
              ? `${Math.round(durationMs / 1000)} 秒测试`
              : mode === "smart"
                ? "今日智能课程"
                : mode.replaceAll("-", " ")}
          </h1>
          <p>
            {kind === "test"
              ? "测试单独标记；游戏和练习成绩不会进入正式测试排名。"
              : mode === "calibration"
                ? `基线会按所选类别轮换取样，并至少记录 ${durationMinutes} 分钟有效活动时间；暂停不计时。`
                : "当前可见微组开始后不会改写。每个边界会用刚产生的数据重排下一组。"}
          </p>
          {kind === "training" && mode !== "calibration" ? (
            <div className="focus-summary" aria-label="本轮训练计划">
              <span>本轮计划</span>
              <i>{durationMinutes} 分钟</i>
              <i>{trainingBiasLabels[bias]}</i>
              {params.get("auto") === "1" ? <i>系统按今日目标选择</i> : null}
            </div>
          ) : null}
          <div className="ready-facts">
            <div>
              <Database size={19} />
              <span>
                <strong>安全保存到本机</strong>
                <small>24 个事件或最迟 3 秒自动保存到本机</small>
              </span>
            </div>
            <div>
              <Headphones size={19} />
              <span>
                <strong>点击后解锁声音</strong>
                <small>兼容 Safari 用户手势限制</small>
              </span>
            </div>
          </div>
          {displayLabels.length || focus.length ? (
            <div className="focus-summary">
              <span>训练范围</span>
              {(displayLabels.length ? displayLabels : focus).map((item) => (
                <i key={item}>{item}</i>
              ))}
            </div>
          ) : null}
          {audioNotice ? <p className="inline-notice">{audioNotice}</p> : null}
          {recoveryNotice ? (
            <p className="inline-notice" role="status">
              {recoveryNotice}
            </p>
          ) : null}
          {saveError ? (
            <p className="error-notice" role="alert">
              {saveError}
            </p>
          ) : null}
          <button
            className="button button--primary button--large"
            type="button"
            disabled={state === "starting"}
            onClick={() => void start()}
          >
            {state === "starting" ? (
              <>
                <LoaderCircle className="spin" size={18} />
                正在准备…
              </>
            ) : (
              <>
                开始 <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="keyboard-hint">
            开始后直接键入；Esc 退出，空格/Enter 从暂停继续。IME 组合中的按键不会记录。
          </p>
        </section>
      </div>
    );
  }

  if (state === "complete" && summary) {
    const hasTrainingEvidence = summary.characters > 0;
    return (
      <div className="completion-page">
        <section className="completion-card">
          <div className="completion-icon" data-empty={!hasTrainingEvidence || undefined}>
            {hasTrainingEvidence ? <CheckCircle2 size={29} /> : <CircleAlert size={29} />}
          </div>
          <p className="eyebrow">
            <Save size={14} />
            {hasTrainingEvidence ? "已安全保存到这台电脑" : "已安全关闭，未计入训练统计"}
          </p>
          <h1 ref={completionHeadingRef} tabIndex={-1}>
            {hasTrainingEvidence
              ? kind === "test"
                ? "测试完成"
                : "这一轮完成了"
              : kind === "test"
                ? "这次测试没有有效输入"
                : "这一轮没有有效输入"}
          </h1>
          <p>
            {hasTrainingEvidence
              ? "摘要和关键逐键事件已持久化；现在关闭页面不会丢失本轮历史。"
              : "没有记录到训练区内的有效字符，因此本轮不会增加今日目标、连续天数或个人最佳。"}
          </p>
          {hasTrainingEvidence ? (
            <div className="metric-grid metric-grid--four">
              {mode === "calibration" ? (
                <>
                  <MetricCard
                    label="有效活动"
                    value={formatDuration(summary.activeMs)}
                    detail="不含页面切出与暂停"
                    tone="accent"
                  />
                  <MetricCard
                    label="有效样本"
                    value={`${summary.characters} 字符`}
                    detail="仅统计训练区内按键"
                  />
                  <MetricCard
                    label="击键准确率"
                    value={`${Math.round(summary.keystrokeAccuracy * 1000) / 10}%`}
                    detail={`最终文本准确率 ${Math.round(summary.finalTextAccuracy * 1000) / 10}%`}
                    tone={
                      summary.keystrokeAccuracy >= bootstrap.settings.progressionAccuracy
                        ? "good"
                        : "neutral"
                    }
                  />
                  <MetricCard
                    label="节奏稳定性"
                    value={`${Math.round(summary.consistency * 100)}%`}
                    detail={`最长准确连击 ${summary.longestAccurateStreak}`}
                  />
                </>
              ) : (
                <>
                  <MetricCard label="净 WPM" value={summary.netWpm.toFixed(1)} tone="accent" />
                  <MetricCard label="原始 WPM" value={summary.rawWpm.toFixed(1)} />
                  <MetricCard
                    label="击键准确率"
                    value={`${Math.round(summary.keystrokeAccuracy * 1000) / 10}%`}
                    detail={`最终文本准确率 ${Math.round(summary.finalTextAccuracy * 1000) / 10}%`}
                    tone={
                      summary.keystrokeAccuracy >= bootstrap.settings.progressionAccuracy
                        ? "good"
                        : "neutral"
                    }
                  />
                  <MetricCard
                    label="一致性"
                    value={`${Math.round(summary.consistency * 100)}%`}
                    detail={`最长准确连击 ${summary.longestAccurateStreak}`}
                  />
                </>
              )}
            </div>
          ) : null}
          {hasTrainingEvidence ? (
            <div className="feedback-list">
              <div>
                <span>做得好</span>
                <p>{summary.feedback.good}</p>
              </div>
              <div>
                <span>主要瓶颈</span>
                <p>{summary.feedback.bottleneck}</p>
              </div>
              <div>
                <span>下一次计划</span>
                <p>{summary.feedback.next}</p>
              </div>
            </div>
          ) : (
            <div className="feedback-list">
              <div>
                <span>已安全保存</span>
                <p>课程状态已经关闭，不需要恢复或清理未完成记录。</p>
              </div>
              <div>
                <span>未计入</span>
                <p>没有生成速度、准确率、排行榜、目标、连续天数或个人最佳。</p>
              </div>
              <div>
                <span>重新开始</span>
                <p>返回入口重开，并确认打字输入区已获得焦点后再键入。</p>
              </div>
            </div>
          )}
          {hasTrainingEvidence ? (
            <section className="subjective-feedback" aria-labelledby="subjective-feedback-title">
              <div>
                <span>可选</span>
                <h2 id="subjective-feedback-title">这一轮主观感受</h2>
                <p>仅用于本机的长期算法实验，不会覆盖逐键事实。</p>
              </div>
              <label>
                主观难度
                <select
                  value={difficultyRating}
                  disabled={feedbackState === "saving" || feedbackState === "saved"}
                  onChange={(event) => {
                    setDifficultyRating(Number(event.target.value));
                    setFeedbackState("idle");
                  }}
                >
                  <option value={1}>1 · 很轻松</option>
                  <option value={2}>2 · 轻松</option>
                  <option value={3}>3 · 合适</option>
                  <option value={4}>4 · 困难</option>
                  <option value={5}>5 · 很困难</option>
                </select>
              </label>
              <label>
                疲劳感
                <select
                  value={fatigueRating}
                  disabled={feedbackState === "saving" || feedbackState === "saved"}
                  onChange={(event) => {
                    setFatigueRating(Number(event.target.value));
                    setFeedbackState("idle");
                  }}
                >
                  <option value={1}>1 · 无疲劳</option>
                  <option value={2}>2 · 轻微</option>
                  <option value={3}>3 · 中等</option>
                  <option value={4}>4 · 明显</option>
                  <option value={5}>5 · 很疲劳</option>
                </select>
              </label>
              <button
                className="button button--secondary"
                type="button"
                disabled={feedbackState === "saving" || feedbackState === "saved"}
                onClick={() => void saveSubjectiveFeedback()}
              >
                {feedbackState === "saving"
                  ? "正在保存…"
                  : feedbackState === "saved"
                    ? "感受已保存"
                    : "保存感受"}
              </button>
              <p
                className={feedbackState === "error" ? "error-notice" : "inline-notice"}
                role={feedbackState === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {feedbackState === "saved" ? "已安全保存，可用于两周交叉策略报告。" : feedbackError}
              </p>
            </section>
          ) : null}
          {hasTrainingEvidence && calibration ? (
            <>
              <section className="calibration-result">
                <div>
                  <span>区域基线</span>
                  <strong>建议起点 {calibration.suggestedWpm} WPM</strong>
                </div>
                <div className="calibration-segments">
                  {calibration.segments.map((segment) => (
                    <div key={segment.label}>
                      <span>{segment.label}</span>
                      <strong>{segment.wpm ? `${Math.round(segment.wpm)} WPM` : "样本不足"}</strong>
                      <small>
                        {Math.round(segment.accuracy * 100)}% · {segment.samples} 次
                      </small>
                    </div>
                  ))}
                </div>
                <p>
                  节奏稳定性 {Math.round(calibration.consistency * 100)}% · {calibration.balance}
                </p>
                <p>
                  最慢键：{calibration.slowKeys.join("、") || "样本不足"} · 最慢组合：
                  {calibration.slowCombos.join("、") || "样本不足"}
                </p>
              </section>
            </>
          ) : null}
          <div className="completion-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() =>
                navigate(hasTrainingEvidence ? "/analytics" : kind === "test" ? "/test" : "/train")
              }
            >
              {hasTrainingEvidence ? "查看详细分析" : kind === "test" ? "返回测试" : "返回训练"}
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => navigate(hasTrainingEvidence && kind === "test" ? "/test" : "/")}
            >
              {hasTrainingEvidence ? "完成" : "回到今日"} <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="practice-page">
      <div
        className={`practice-context-bar${kind === "training" && mode !== "calibration" ? " is-compact" : ""}`}
      >
        {kind === "test" || mode === "calibration" ? (
          <div className="practice-context-meta">
            <span>{activeContextLabel(kind, mode, block?.block_type)}</span>
            <strong>
              {kind === "test"
                ? formatDuration(remainingMs)
                : `剩余 ${formatDuration(remainingMs)}`}
            </strong>
          </div>
        ) : null}
        <div
          className="context-progress"
          role="progressbar"
          aria-label={
            kind === "test"
              ? "测试时间进度"
              : mode === "calibration"
                ? "基线有效活动时间进度"
                : "课程字符进度"
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            Math.min(
              100,
              kind === "test" || mode === "calibration"
                ? (1 - remainingMs / durationMs) * 100
                : ((blockIndex +
                    (progress?.position ?? 0) / Math.max(1, block?.target_text.length ?? 1)) /
                    maxBlocks) *
                    100
            )
          )}
        >
          <i
            style={{
              width: `${Math.min(100, kind === "test" || mode === "calibration" ? (1 - remainingMs / durationMs) * 100 : ((blockIndex + (progress?.position ?? 0) / Math.max(1, block?.target_text.length ?? 1)) / maxBlocks) * 100)}%`
            }}
          />
        </div>
        <div
          className="save-state"
          data-error={Boolean(saveError)}
          role="status"
          aria-live="polite"
        >
          {saveError ? (
            <>
              <CloudOff size={15} />
              保存待重试
            </>
          ) : pendingCount ? (
            <>
              <LoaderCircle className="spin" size={15} />
              待保存 {pendingCount}
            </>
          ) : (
            <>
              <Database size={15} />
              已保存
            </>
          )}
        </div>
      </div>
      {block ? (
        <>
          <TypingSurface
            ref={surfaceRef}
            target={block.target_text}
            mode={
              mode === "calibration" && block.block_type.startsWith("calibration-")
                ? block.block_type
                : mode
            }
            settings={bootstrap.settings}
            layout={keyboardLayout}
            sessionStartedAtMs={sessionStartedAtMs}
            active={state === "running" && !isAtCapacity}
            onEvent={(event: Omit<StoredEvent, "sequence">) => {
              const sequence = enqueue(event);
              if (sequence == null) return false;
              eventHistoryRef.current.push(event);
              return true;
            }}
            onComplete={(value) => void completeBlock(value)}
            onProgress={setProgress}
            onExitRequest={openExitConfirmation}
            onPauseChange={handlePauseChange}
          />
        </>
      ) : (
        <div className="center-state">
          <LoaderCircle className="spin" />
          <p>正在生成下一微组…</p>
        </div>
      )}
      {saveError ? (
        <button
          className="save-error-banner"
          type="button"
          onClick={() => {
            setSaveError("");
            const pending = pendingBlockCompletionRef.current;
            if (pending) void completeBlock(pending);
            else if (kind === "test" && remainingMs <= 0) void finishSession(durationMs);
            else void flush().catch(() => undefined);
          }}
        >
          <CloudOff size={17} />
          <span>{saveError}</span>
          <strong>{blockCompletionPending ? "重试保存并继续" : "立即重试"}</strong>
        </button>
      ) : null}
      <Dialog.Root
        open={exitOpen}
        onOpenChange={(open) => {
          if (open) openExitConfirmation();
          else cancelExit();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>结束这次训练？</Dialog.Title>
            <Dialog.Description>
              已产生的有效按键会先安全保存到这台电脑。本轮将标记为已放弃，不会伪装成已完成课程。
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button className="button button--secondary" type="button" disabled={exitSaving}>
                  继续训练
                </button>
              </Dialog.Close>
              <button
                className="button button--danger"
                type="button"
                disabled={exitSaving}
                onClick={() => void abandon()}
              >
                {exitSaving ? "正在保存…" : "保存并退出"}
              </button>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭" disabled={exitSaving}>
              <X size={18} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
