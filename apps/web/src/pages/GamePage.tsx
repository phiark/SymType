import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_RULES } from "@symtype/shared";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Gamepad2,
  LockKeyhole,
  Medal,
  RotateCcw,
  ShieldAlert,
  Trophy,
  X,
  Zap
} from "lucide-react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { soundEngine } from "../audio";
import {
  TypingSurface,
  type TypingProgress,
  type TypingSurfaceHandle
} from "../components/TypingSurface";
import { ErrorState, LoadingState, PageHeader, SegmentedControl } from "../components/ui";
import { userErrorText } from "../error-presentation";
import { usePersistentEvents } from "../hooks/usePersistentEvents";
import { useSessionNavigationGuard } from "../hooks/useSessionNavigationGuard";
import { activeKeyboardLayout } from "../keyboard";
import type { AchievementRecord, BootstrapData, GameLevelDefinition, StoredEvent } from "../types";

type Difficulty = "standard" | "hard" | "adaptive";
type RunMode = "campaign" | "hardcore";

interface GameRun {
  id: string;
  mode: RunMode;
  difficulty: Difficulty;
  status: "active" | "completed";
  current_level: number;
  score: number;
  alert_value: number;
  levels: {
    level_number: number;
    attempt_number: number;
    status: string;
    score: number;
    alert_value: number;
  }[];
}

interface GameResponse {
  run: GameRun;
  level: GameLevelDefinition;
  targetText: string;
  plan?: {
    tuning?: {
      timeLimitSeconds?: number;
      requiredKeystrokeAccuracy?: number;
    };
    stages?: Array<{
      stage: 1 | 2 | 3;
      title: string;
      instruction: string;
      targets?: Array<{ text: string }>;
    }>;
  };
}

interface GameProgressLevel {
  level?: number;
  level_number?: number;
  unlocked?: boolean;
  completed?: boolean;
  status?: string;
  bestScore?: number;
  best_score?: number;
  personalBest?: number;
  personal_best?: number;
}

interface GameProgressRun extends Partial<GameRun> {
  id: string;
  status: "active" | "completed";
}

interface GameProgressResponse {
  levels?: GameProgressLevel[];
  runs?: GameProgressRun[];
  activeRun?: GameProgressRun | null;
  active_run?: GameProgressRun | null;
  unlockedLevel?: number;
  completedLevels?: number[];
  personalBests?: Array<{ level: number; score: number }>;
  achievements?: AchievementRecord[];
  personalBest?: number | null;
  personal_best?: number | null;
  bestScore?: number | null;
  best_score?: number | null;
}

const levelFallbacks = [
  { name: "Port Scan / 信号同步", description: "输入短字符串，先建立准确率与节奏。" },
  { name: "Firewall Routing", description: "左右键区交替与食指边界组合。" },
  { name: "Credential Forge", description: "大小写、数字与符号；所有字符串都明显虚构。" },
  { name: "Packet Repair", description: "识别并重打易混淆组合。" },
  { name: "Trace Countdown", description: "在透明倒计时内完成自然句或伪代码。" },
  { name: "Vault Phrase", description: "输入非 BIP-39 的虚构菠萝短语，完成剧情。" }
];

const achievementDefinitions = [
  { id: "first-fiction-breach", name: "首次通关", detail: "完成一次完整六关任务" },
  { id: "error-free-level", name: "无错通关", detail: "任一关在一次尝试中全部无错" },
  { id: "hard-campaign", name: "Hard 通关", detail: "以 Hard 难度完成六关" }
] as const;

function readableDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function GameExitConfirmation({
  open,
  saving,
  resolving,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  saving: boolean;
  resolving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>退出当前关卡？</Dialog.Title>
          <Dialog.Description>
            已产生的有效按键会先安全保存在本机，随后结束本关。下次继续当前任务时，本关从阶段
            1、零警戒重新开始。
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="button button--secondary" type="button" disabled={saving}>
                继续本关
              </button>
            </Dialog.Close>
            <button
              className="button button--danger"
              type="button"
              disabled={saving || resolving}
              onClick={onConfirm}
            >
              {saving ? "正在保存…" : "保存并退出"}
            </button>
          </div>
          <Dialog.Close className="dialog-close" aria-label="关闭" disabled={saving}>
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GamePage({ play = false }: { play?: boolean }) {
  const { bootstrap } = useOutletContext<{ bootstrap: BootstrapData }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");
  const [runMode, setRunMode] = useState<RunMode>("campaign");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [briefing, setBriefing] = useState(true);
  const [outcome, setOutcome] = useState<"success" | "failure" | null>(null);
  const [failureReason, setFailureReason] = useState<
    "alert-maxed" | "timeout" | "accuracy-gate" | null
  >(null);
  const [alertValue, setAlertValue] = useState(0);
  const alertRef = useRef(0);
  const accurateStreakRef = useRef(0);
  const recoveredAlertRef = useRef(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const deadlineRef = useRef(0);
  const pauseStartedAtRef = useRef<number | null>(null);
  const timeoutCommittedRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lessonIdRef = useRef<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState(0);
  const blockIdRef = useRef<string | null>(null);
  const surfaceRef = useRef<TypingSurfaceHandle>(null);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const resolvingRef = useRef(false);
  const pendingResolutionRef = useRef<{
    result: "success" | "failure";
    progress?: TypingProgress;
    failureReason?: "alert-maxed" | "timeout" | "accuracy-gate";
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [levelTarget, setLevelTarget] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<1 | 2 | 3>(1);
  const levelAttemptsRef = useRef(0);
  const levelCorrectRef = useRef(0);
  const levelErrorsRef = useRef(0);
  const levelElapsedRef = useRef(0);
  const pendingStageRef = useRef<2 | 3 | null>(null);
  const exitWasPausedRef = useRef(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const runId = params.get("run");
  const gameQuery = useQuery({
    queryKey: ["game-run", runId],
    queryFn: () => api.get<GameResponse>(`/api/v1/game/runs/${runId}`),
    enabled: play && Boolean(runId),
    refetchOnWindowFocus: false
  });
  const achievementsQuery = useQuery({
    queryKey: ["game-achievements"],
    queryFn: () => api.get<{ achievements: AchievementRecord[] }>("/api/v1/game/achievements"),
    enabled: !play,
    retry: false
  });
  const progressQuery = useQuery({
    queryKey: ["game-progress"],
    queryFn: () => api.get<GameProgressResponse>("/api/v1/game/progress"),
    enabled: !play,
    retry: false
  });
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
  const currentCorrectionCheckpoint = useCallback(() => {
    const blockId = blockIdRef.current;
    const position = surfaceRef.current?.getCorrectionPosition() ?? null;
    return blockId && position != null ? { blockId, position } : undefined;
  }, []);
  const { blocker, bypassNextNavigation } = useSessionNavigationGuard(Boolean(sessionId));

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const openExitConfirmation = useCallback(() => {
    if (!exitOpen) exitWasPausedRef.current = pausedRef.current;
    setPaused(true);
    setExitOpen(true);
  }, [exitOpen]);

  const cancelExit = useCallback(() => {
    if (exitSaving) return;
    if (blocker.state === "blocked") blocker.reset();
    setExitOpen(false);
    setPaused(exitWasPausedRef.current);
  }, [blocker, exitSaving]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const timer = window.setTimeout(openExitConfirmation, 0);
    return () => window.clearTimeout(timer);
  }, [blocker.state, openExitConfirmation]);

  const startCampaign = async () => {
    setStarting(true);
    setStartError("");
    try {
      const response = await api.post<{ run: GameRun }>("/api/v1/game/runs", {
        mode: runMode,
        difficulty
      });
      void navigate(`/game/play?run=${response.run.id}`);
    } catch (error) {
      setStartError(userErrorText(error, "start"));
    } finally {
      setStarting(false);
    }
  };

  const game = gameQuery.data;
  const currentLevel = game?.run.current_level ?? 1;
  const currentAttempt = game?.run.levels
    .filter((attempt) => attempt.level_number === currentLevel)
    .sort((left, right) => right.attempt_number - left.attempt_number)[0];
  const activeDifficulty = game?.run.difficulty ?? difficulty;
  const alertRules = GAME_RULES[activeDifficulty];
  const secondsForLevel = useMemo(() => {
    if (!game) return 45;
    const plannedSeconds = Number(game.plan?.tuning?.timeLimitSeconds);
    if (Number.isFinite(plannedSeconds) && plannedSeconds >= 15) return plannedSeconds;
    if (game.run.difficulty === "hard") return Math.max(24, 42 - currentLevel * 2);
    if (game.run.difficulty === "adaptive") return Math.max(30, 50 - currentLevel * 2);
    return Math.max(34, 58 - currentLevel * 2);
  }, [currentLevel, game]);

  useEffect(() => {
    if (!play || !game || (!briefing && !outcome && game.run.status !== "completed")) return;
    window.setTimeout(() => statusHeadingRef.current?.focus(), 0);
  }, [briefing, game, outcome, play]);

  useEffect(() => {
    if (!play || !runId) return;
    if (game?.run.status === "completed") {
      soundEngine.play("success");
      void queryClient.invalidateQueries({ queryKey: ["statistics"] });
    }
  }, [game?.run.status, play, queryClient, runId]);

  const beginLevel = async (freshGame: GameResponse) => {
    if (resolvingRef.current) return;
    const freshLevel = freshGame.run.current_level;
    const plannedSeconds = Number(freshGame.plan?.tuning?.timeLimitSeconds);
    const freshSeconds =
      Number.isFinite(plannedSeconds) && plannedSeconds >= 15
        ? plannedSeconds
        : freshGame.run.difficulty === "hard"
          ? Math.max(24, 42 - freshLevel * 2)
          : freshGame.run.difficulty === "adaptive"
            ? Math.max(30, 50 - freshLevel * 2)
            : Math.max(34, 58 - freshLevel * 2);
    try {
      soundEngine.configure(bootstrap.settings);
      await soundEngine.unlock();
      const response = await api.post<{ session: { id: string; lessonId: string } }>(
        "/api/v1/sessions",
        {
          kind: "game",
          mode: `pineapple-level-${freshLevel}`,
          strategy: "adaptive",
          seed: Date.now() % 2_147_483_647,
          focus: []
        }
      );
      const blockResponse = await api.post<{ block: { id: string; target_text: string } }>(
        `/api/v1/lessons/${response.session.lessonId}/blocks/next`,
        {
          blockIndex: 0,
          seed: freshLevel * 7919,
          mode: `game-${freshLevel}`,
          length: Math.max(20, Math.min(120, freshGame.targetText.length)),
          focus: [],
          gameRunId: runId,
          gameStage: 1,
          phase: "focus"
        }
      );
      sessionIdRef.current = response.session.id;
      lessonIdRef.current = response.session.lessonId;
      blockIdRef.current = blockResponse.block.id;
      setLevelTarget(blockResponse.block.target_text);
      setSessionId(response.session.id);
      setLessonId(response.session.lessonId);
      setSessionStartedAtMs(performance.now());
      setAlertValue(0);
      alertRef.current = 0;
      accurateStreakRef.current = 0;
      recoveredAlertRef.current = 0;
      levelAttemptsRef.current = 0;
      levelCorrectRef.current = 0;
      levelErrorsRef.current = 0;
      levelElapsedRef.current = 0;
      pendingStageRef.current = null;
      setCurrentStage(1);
      setTimeLeft(freshSeconds * 1000);
      deadlineRef.current = performance.now() + freshSeconds * 1000;
      pauseStartedAtRef.current = null;
      timeoutCommittedRef.current = false;
      setOutcome(null);
      setFailureReason(null);
      setPaused(false);
      setSaveError("");
      setBriefing(false);
      window.setTimeout(() => surfaceRef.current?.focus(), 50);
    } catch (error) {
      setSaveError(userErrorText(error, "start"));
      setBriefing(true);
    }
  };

  const resolveLevel = useCallback(
    async (
      result: "success" | "failure",
      progress?: TypingProgress,
      reason?: "alert-maxed" | "timeout" | "accuracy-gate"
    ) => {
      if (!runId || resolvingRef.current) return;
      pendingResolutionRef.current = {
        result,
        ...(progress ? { progress } : {}),
        ...(reason ? { failureReason: reason } : {})
      };
      const correctionCheckpoint = currentCorrectionCheckpoint();
      resolvingRef.current = true;
      setResolving(true);
      if (result === "failure") soundEngine.play("alarm");
      else soundEngine.play("success");
      let committed = false;
      try {
        await flush();
        const completedSessionId = sessionIdRef.current;
        if (!completedSessionId) throw new Error("当前游戏 session 已失效，请重开本关。");
        await api.post(`/api/v1/sessions/${completedSessionId}/complete`, {
          activeMs: Math.round(Math.max(1000, secondsForLevel * 1000 - timeLeft)),
          ...(correctionCheckpoint ? { correctionCheckpoint } : {})
        });
        await api.post(`/api/v1/game/runs/${runId}/level-result`, {
          sessionId: completedSessionId,
          outcome: result,
          alertValue: alertRef.current,
          ...(reason ? { failureReason: reason } : {})
        });
        await gameQuery.refetch();
        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        pendingResolutionRef.current = null;
        setOutcome(result);
        setFailureReason(result === "failure" ? (reason ?? null) : null);
        setSaveError("");
        committed = true;
      } catch (error) {
        setPaused(true);
        setSaveError(userErrorText(error, "session"));
      } finally {
        if (committed) {
          sessionIdRef.current = null;
          lessonIdRef.current = null;
          blockIdRef.current = null;
          setSessionId(null);
          setLessonId(null);
          setLevelTarget(null);
        }
        resolvingRef.current = false;
        setResolving(false);
      }
    },
    [currentCorrectionCheckpoint, flush, gameQuery, queryClient, runId, secondsForLevel, timeLeft]
  );

  const loadGameStage = useCallback(
    async (nextStage: 2 | 3) => {
      if (!game || !runId || !lessonIdRef.current) {
        setSaveError("本关无法继续。已经保存的游戏进度不受影响；请退出并重新打开本关。");
        return;
      }
      setResolving(true);
      try {
        await flush();
        const blockResponse = await api.post<{ block: { id: string; target_text: string } }>(
          `/api/v1/lessons/${lessonIdRef.current}/blocks/next`,
          {
            blockIndex: nextStage - 1,
            seed: currentLevel * 7919,
            mode: `game-${currentLevel}`,
            length: Math.max(20, Math.min(120, game.targetText.length)),
            focus: [],
            gameRunId: runId,
            gameStage: nextStage,
            phase: "focus"
          }
        );
        blockIdRef.current = blockResponse.block.id;
        recoveredAlertRef.current = 0;
        accurateStreakRef.current = 0;
        pendingStageRef.current = null;
        setCurrentStage(nextStage);
        setLevelTarget(blockResponse.block.target_text);
        setSaveError("");
        setPaused(false);
        window.setTimeout(() => surfaceRef.current?.focus(), 50);
      } catch (error) {
        pendingStageRef.current = nextStage;
        setPaused(true);
        setSaveError(userErrorText(error, "session"));
      } finally {
        setResolving(false);
      }
    },
    [currentLevel, flush, game, runId]
  );

  const completeStage = useCallback(
    async (progress: TypingProgress) => {
      if (!game || !runId || resolvingRef.current) return;
      levelAttemptsRef.current += progress.attempts;
      levelCorrectRef.current += progress.correct;
      levelErrorsRef.current += progress.errors;
      levelElapsedRef.current += progress.elapsedMs;
      const requiredAccuracy =
        Number(game.plan?.tuning?.requiredKeystrokeAccuracy) ||
        (game.run.difficulty === "hard" ? 0.96 : game.run.difficulty === "adaptive" ? 0.94 : 0.9);
      if (currentStage >= 3) {
        const attempts = Math.max(1, levelAttemptsRef.current);
        const elapsedMs = Math.max(50, levelElapsedRef.current);
        const minutes = elapsedMs / 60_000;
        const combined: TypingProgress = {
          position: levelCorrectRef.current + levelErrorsRef.current,
          attempts: levelAttemptsRef.current,
          correct: levelCorrectRef.current,
          errors: levelErrorsRef.current,
          rawWpm: levelAttemptsRef.current / 5 / minutes,
          netWpm: Math.max(
            0,
            levelAttemptsRef.current / 5 / minutes - levelErrorsRef.current / minutes
          ),
          currentWpm: progress.currentWpm,
          accuracy: levelCorrectRef.current / attempts,
          peakWpm: progress.peakWpm,
          elapsedMs
        };
        const result = combined.accuracy >= requiredAccuracy ? "success" : "failure";
        await resolveLevel(result, combined, result === "failure" ? "accuracy-gate" : undefined);
        return;
      }

      const nextStage = (currentStage + 1) as 2 | 3;
      pendingStageRef.current = nextStage;
      await loadGameStage(nextStage);
    },
    [currentStage, game, loadGameStage, resolveLevel, runId]
  );

  useEffect(() => {
    if (!sessionId) {
      pauseStartedAtRef.current = null;
      return;
    }
    const timestamp = performance.now();
    if (paused) {
      pauseStartedAtRef.current ??= timestamp;
      return;
    }
    if (pauseStartedAtRef.current != null) {
      deadlineRef.current += timestamp - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }
  }, [paused, sessionId]);

  useEffect(() => {
    if (briefing || outcome || paused || !sessionId || resolvingRef.current) return;
    const tick = () => {
      const next = Math.max(0, deadlineRef.current - performance.now());
      setTimeLeft(next);
      if (next === 0 && !timeoutCommittedRef.current) {
        timeoutCommittedRef.current = true;
        void resolveLevel("failure", undefined, "timeout");
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [briefing, outcome, paused, resolveLevel, sessionId]);

  const onGameEvent = (event: Omit<StoredEvent, "sequence">) => {
    const sequence = enqueue(event);
    if (sequence == null) return false;
    let next = alertRef.current;
    if (event.isCorrect) {
      accurateStreakRef.current += 1;
      if (
        accurateStreakRef.current >= alertRules.recoveryStreak &&
        recoveredAlertRef.current < alertRules.maximumRecoveryPerPhase
      ) {
        const recovery = Math.min(
          alertRules.recoveryPerCorrect,
          alertRules.maximumRecoveryPerPhase - recoveredAlertRef.current,
          next
        );
        next -= recovery;
        recoveredAlertRef.current += recovery;
      }
    } else {
      accurateStreakRef.current = 0;
      next += alertRules.errorAlert;
    }
    if (event.wasLongPause) next += alertRules.longPauseAlert;
    next = Math.max(0, Math.min(alertRules.alertMaximum, next));
    alertRef.current = next;
    setAlertValue(next);
    if (next >= alertRules.alertMaximum) {
      // TypingSurface clears a trailing correction checkpoint immediately
      // after this callback accepts the key. Resolve in the following
      // microtask so the saved checkpoint describes the accepted event.
      queueMicrotask(() => void resolveLevel("failure", undefined, "alert-maxed"));
    }
    return true;
  };

  const exitActiveLevel = async () => {
    setExitSaving(true);
    setPaused(true);
    setSaveError("");
    try {
      const correctionCheckpoint = currentCorrectionCheckpoint();
      await flush();
      if (sessionIdRef.current) {
        await api.post(`/api/v1/sessions/${sessionIdRef.current}/abandon`, {
          ...(correctionCheckpoint ? { correctionCheckpoint } : {})
        });
      }
      sessionIdRef.current = null;
      lessonIdRef.current = null;
      blockIdRef.current = null;
      setSessionId(null);
      setLessonId(null);
      setLevelTarget(null);
      setExitOpen(false);
      if (blocker.state === "blocked") {
        blocker.proceed();
      } else {
        bypassNextNavigation();
        void navigate(runId ? `/game?resume=${encodeURIComponent(runId)}` : "/game", {
          replace: true
        });
      }
    } catch (error) {
      setSaveError(userErrorText(error, "session"));
    } finally {
      setExitSaving(false);
    }
  };

  const achievements = [
    ...(achievementsQuery.data?.achievements ?? []),
    ...(progressQuery.data?.achievements ?? [])
  ].filter(
    (achievement, index, values) =>
      values.findIndex((candidate) => candidate.achievement_id === achievement.achievement_id) ===
      index
  );
  const achievementIds = new Set(achievements.map((achievement) => achievement.achievement_id));
  const progressRuns = progressQuery.data?.runs ?? [];
  const activeRun =
    progressQuery.data?.activeRun ??
    progressQuery.data?.active_run ??
    progressRuns.find((run) => run.status === "active") ??
    null;
  const hasCompletedRun =
    achievementIds.has("first-fiction-breach") ||
    progressRuns.some((run) => run.status === "completed");
  const furthestReached = Math.max(
    1,
    Number(progressQuery.data?.unlockedLevel) || 1,
    ...progressRuns.map((run) => Number(run.current_level) || 1),
    activeRun ? Number(activeRun.current_level) || 1 : 1
  );
  const progressLevels = progressQuery.data?.levels ?? [];
  const completedLevels = new Set(progressQuery.data?.completedLevels ?? []);
  const levelPersonalBests = progressQuery.data?.personalBests ?? [];
  const runScores = progressRuns
    .filter((run) => run.status === "completed")
    .map((run) => Number(run.score))
    .filter((score) => Number.isFinite(score));
  const personalBest = [
    progressQuery.data?.personalBest,
    progressQuery.data?.personal_best,
    progressQuery.data?.bestScore,
    progressQuery.data?.best_score,
    ...runScores
  ]
    .map((score) => Number(score))
    .filter((score) => Number.isFinite(score) && score > 0)
    .sort((first, second) => second - first)[0];
  const progressUnavailable =
    progressQuery.error instanceof ApiError && progressQuery.error.status === 404;
  const resumableRunId = activeRun?.id ?? params.get("resume");

  if (!play) {
    return (
      <div className="page game-landing">
        <PageHeader
          eyebrow="Pineapple Breach"
          title="菠萝公司的文字防线"
          description="六关打字挑战。剧情和字符串全部虚构。"
          action={
            resumableRunId ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void navigate(`/game/play?run=${resumableRunId}`)}
              >
                继续当前任务 <ArrowRight size={16} />
              </button>
            ) : undefined
          }
        />
        <section className="game-start panel">
          <div>
            <SegmentedControl
              label="难度"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: "standard", label: "Standard" },
                { value: "hard", label: "Hard" },
                { value: "adaptive", label: "Adaptive" }
              ]}
            />
            <SegmentedControl
              label="Run 规则"
              value={runMode}
              onChange={setRunMode}
              options={[
                { value: "campaign", label: "Campaign" },
                { value: "hardcore", label: "Hardcore Run" }
              ]}
            />
          </div>
          <div className="rule-warning" data-hardcore={runMode === "hardcore"}>
            <AlertTriangle size={19} />
            <p>
              {runMode === "hardcore" ? (
                <>
                  <strong>Hardcore：任一关失败，整个任务从第 1 关、零分、零警戒重新开始。</strong>{" "}
                  已完成的个人最佳仍保留。
                </>
              ) : (
                <>
                  <strong>Campaign：失败时当前关从阶段 1、零分、零警戒重开。</strong>{" "}
                  已通关前置关卡保持解锁。
                </>
              )}
            </p>
          </div>
          {startError ? (
            <p className="error-notice" role="alert">
              {startError}
            </p>
          ) : null}
          <button
            className="button button--primary button--large"
            type="button"
            disabled={starting}
            onClick={() => void startCampaign()}
          >
            {starting ? "正在准备任务…" : "启动新任务"}
            <ArrowRight size={18} />
          </button>
        </section>
        <section className="game-hero panel">
          <div>
            <p className="game-kicker">
              <ShieldAlert size={16} />
              LOCAL TRAINING SIMULATION
            </p>
            <h2>在监测系统锁定你之前，完成六次纯文字同步。</h2>
            <p>
              每关从当前弱点模型取材。错误、长停顿和超时会增加警戒；连续正确可有限降低，规则不会暗改。
            </p>
            <div className="game-rules">
              <span>
                <Zap size={16} />
                错误 +{alertRules.errorAlert} 警戒
              </span>
              <span>
                <AlertTriangle size={16} />
                长停顿 +{alertRules.longPauseAlert}
              </span>
              <span>
                <CheckCircle2 size={16} />
                连续 {alertRules.recoveryStreak} 键后 −{alertRules.recoveryPerCorrect}（本关最多{" "}
                {alertRules.maximumRecoveryPerPhase}）
              </span>
            </div>
          </div>
          <div className="pineapple-seal" aria-hidden="true">
            <span>PB</span>
            <small>SIM / 06</small>
          </div>
        </section>

        {progressQuery.isError && !progressUnavailable ? (
          <div className="game-progress-error" role="alert">
            <span>{userErrorText(progressQuery.error, "load")}</span>
            <button
              className="text-button"
              type="button"
              onClick={() => void progressQuery.refetch()}
            >
              <RotateCcw size={15} />
              重试
            </button>
          </div>
        ) : progressUnavailable ? (
          <p className="game-progress-note">
            暂时无法读取任务汇总；关卡只显示已确认的成就，并保守地从第 1 关开始。
          </p>
        ) : progressQuery.isLoading ? (
          <p className="game-progress-note" role="status">
            正在读取任务进度与个人最佳…
          </p>
        ) : null}

        <section className="game-level-list" aria-label="六关解锁状态">
          {Array.from({ length: 6 }, (_, index) => {
            const levelNumber = index + 1;
            const level = bootstrap.gameLevels[index];
            const fallback = levelFallbacks[index];
            const saved = progressLevels.find(
              (item) => Number(item.level_number ?? item.level) === levelNumber
            );
            const completed =
              hasCompletedRun ||
              completedLevels.has(levelNumber) ||
              saved?.completed === true ||
              saved?.status === "success" ||
              (activeRun != null && Number(activeRun.current_level) > levelNumber);
            const unlocked =
              completed ||
              saved?.unlocked === true ||
              levelNumber === 1 ||
              Number(progressQuery.data?.unlockedLevel) >= levelNumber ||
              furthestReached >= levelNumber;
            const savedLevelBest = levelPersonalBests.find(
              (result) => Number(result.level) === levelNumber
            )?.score;
            const best = [
              savedLevelBest,
              saved?.bestScore,
              saved?.best_score,
              saved?.personalBest,
              saved?.personal_best
            ]
              .map((score) => Number(score))
              .find((score) => Number.isFinite(score) && score > 0);
            return (
              <article
                key={levelNumber}
                data-state={completed ? "complete" : unlocked ? "open" : "locked"}
              >
                <span>{String(levelNumber).padStart(2, "0")}</span>
                <div>
                  <strong>{level?.name || fallback?.name}</strong>
                  <p>{level?.description || fallback?.description}</p>
                  <small>
                    {completed
                      ? `已通关${best ? ` · 最佳 ${best.toLocaleString()} 分` : ""}`
                      : unlocked
                        ? levelNumber === activeRun?.current_level
                          ? "当前任务正在此关"
                          : "已解锁，可在任务中进入"
                        : "完成前一关后解锁"}
                  </small>
                </div>
                {completed ? (
                  <CheckCircle2 aria-label="已通关" size={18} />
                ) : unlocked ? (
                  <CircleDot aria-label="已解锁" size={18} />
                ) : (
                  <LockKeyhole aria-label="未解锁" size={17} />
                )}
              </article>
            );
          })}
        </section>

        <section className="game-achievements panel" aria-labelledby="game-achievements-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Medal size={15} />
                本地成就
              </p>
              <h2 id="game-achievements-title">只展示已经保存的结果</h2>
            </div>
            {personalBest ? (
              <strong className="game-personal-best">
                完整 Run 最高 {personalBest.toLocaleString()} 分
              </strong>
            ) : null}
          </div>
          {achievementsQuery.isError ? (
            <div className="game-progress-error" role="alert">
              <span>{userErrorText(achievementsQuery.error, "load")}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => void achievementsQuery.refetch()}
              >
                <RotateCcw size={15} />
                重试
              </button>
            </div>
          ) : achievementsQuery.isLoading ? (
            <p className="game-progress-note" role="status">
              正在读取本地成就…
            </p>
          ) : (
            <div className="achievement-grid">
              {achievementDefinitions.map((definition) => {
                const record = achievements.find(
                  (achievement) => achievement.achievement_id === definition.id
                );
                const unlocked = Boolean(record);
                const unlockedDate = readableDate(record?.unlocked_at);
                return (
                  <article key={definition.id} data-unlocked={unlocked}>
                    {unlocked ? <CheckCircle2 size={18} /> : <LockKeyhole size={17} />}
                    <span>
                      <strong>{definition.name}</strong>
                      <small>
                        {unlocked
                          ? `已获得${unlockedDate ? ` · ${unlockedDate}` : ""}`
                          : definition.detail}
                      </small>
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (!runId) return <ErrorState context="game" onRetry={() => navigate("/game")} />;
  if (gameQuery.isLoading) return <LoadingState label="正在读取菠萝公司任务状态…" />;
  if (gameQuery.isError || !game)
    return <ErrorState error={gameQuery.error} onRetry={() => void gameQuery.refetch()} />;
  if (game.run.status === "completed")
    return (
      <div className="game-complete">
        <section>
          <Trophy size={36} />
          <p className="eyebrow">任务完成</p>
          <h1 ref={statusHeadingRef} tabIndex={-1}>
            PINEAPPLE VAULT // SYNCHRONIZED
          </h1>
          <p>六关全部完成。本地成绩已保存，游戏数据保持 game 标签，不进入正式测试排名。</p>
          <strong>{game.run.score.toLocaleString()} 分</strong>
          <div>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => navigate("/analytics")}
            >
              查看游戏统计
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => navigate("/game")}
            >
              返回 campaign
            </button>
          </div>
        </section>
      </div>
    );

  const level = game.level ?? levelFallbacks[currentLevel - 1];
  const activeStage = game.plan?.stages?.find((stage) => stage.stage === currentStage);
  if (briefing || outcome) {
    const failed = outcome === "failure";
    const succeeded = outcome === "success";
    return (
      <div className="game-briefing">
        <button
          className="text-button"
          type="button"
          onClick={() => navigate(runId ? `/game?resume=${encodeURIComponent(runId)}` : "/game")}
        >
          <ArrowLeft size={16} />
          退出到任务选择
        </button>
        <section>
          <span className="mission-number">LEVEL {String(currentLevel).padStart(2, "0")} / 06</span>
          {failed ? (
            <AlertTriangle className="outcome-mark outcome-mark--failure" size={34} />
          ) : succeeded ? (
            <CheckCircle2 className="outcome-mark" size={34} />
          ) : (
            <Gamepad2 className="outcome-mark" size={34} />
          )}
          <h1 ref={statusHeadingRef} tabIndex={-1}>
            {failed ? "信号被切断" : succeeded ? "阶段同步完成" : level?.name}
          </h1>
          <p>
            {failed
              ? `${
                  failureReason === "timeout"
                    ? "倒计时归零。"
                    : failureReason === "accuracy-gate"
                      ? "三阶段击键准确率未达到本难度门槛。"
                      : "警戒值达到上限。"
                } ${
                  game.run.mode === "hardcore"
                    ? "Hardcore 规则已执行：整个任务回到第 1 关、零分、零警戒。"
                    : `第 ${currentLevel} 关从阶段 1、零分、零警戒重开；前置关卡仍解锁。`
                }`
              : succeeded
                ? "结果已经写入本机。继续前先读取下一关目标。"
                : level?.description}
          </p>
          {!outcome ? (
            <div className="mission-rules">
              <div>
                <strong>目标</strong>
                <span>{level?.objective ?? "在警戒达到 100 前准确输入显示文字。"}</span>
              </div>
              <div>
                <strong>透明规则</strong>
                <span>失焦自动暂停倒计时；不能用切走页面绕过计时。</span>
              </div>
              <div>
                <strong>安全边界</strong>
                <span>所有密钥与短语明显虚构，绝非真实凭据格式。</span>
              </div>
              <div>
                <strong>关卡结构</strong>
                <span>本关包含 3 个阶段；失败后不会保留关内 checkpoint。</span>
              </div>
            </div>
          ) : null}
          {saveError ? (
            <p className="error-notice" role="alert">
              {saveError}
            </p>
          ) : null}
          <button
            className="button button--primary button--large"
            type="button"
            onClick={() => {
              setSaveError("");
              void gameQuery.refetch().then((result) => {
                if (result.data) void beginLevel(result.data);
                else setSaveError(userErrorText(result.error, "load"));
              });
            }}
          >
            {failed ? (
              <>
                <RotateCcw size={18} />
                从规则指定位置重开
              </>
            ) : succeeded ? (
              <>
                进入下一关 <ArrowRight size={18} />
              </>
            ) : (
              <>
                开始关卡 <ArrowRight size={18} />
              </>
            )}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="game-play">
      <div className="game-hud">
        <div>
          <span>
            LEVEL {currentLevel}/6 · STAGE {currentStage}/3
          </span>
          <strong>{level?.name}</strong>
          <span>本轮分数 {Number(currentAttempt?.score ?? 0).toLocaleString()}</span>
        </div>
        <div className="game-timer" data-low={timeLeft < 10_000}>
          {Math.ceil(timeLeft / 1000)}
          <small>SEC</small>
        </div>
        <div
          className="alert-meter"
          role="progressbar"
          aria-label="游戏警戒值"
          aria-valuemin={0}
          aria-valuemax={alertRules.alertMaximum}
          aria-valuenow={Math.round(alertValue)}
        >
          <span>
            <ShieldAlert size={15} />
            警戒 {Math.round(alertValue)} / 100
          </span>
          <i>
            <b style={{ width: `${alertValue}%` }} />
          </i>
        </div>
        <div className="save-state" role="status" aria-live="polite">
          <span className="status-dot" />
          本机记录 {pendingCount ? `待保存 ${pendingCount}` : "已保存"}
        </div>
      </div>
      <p className="game-rule-line" aria-live="polite">
        {activeStage ? `${activeStage.title}：${activeStage.instruction} · ` : null}
        错误 +{alertRules.errorAlert} · 长停顿 +{alertRules.longPauseAlert} · 连续{" "}
        {alertRules.recoveryStreak} 键后每键 −{alertRules.recoveryPerCorrect}（最多 −
        {alertRules.maximumRecoveryPerPhase}）· 达到 {alertRules.alertMaximum} 或超时即失败
      </p>
      <TypingSurface
        ref={surfaceRef}
        target={levelTarget ?? game.targetText}
        mode={`game-${currentLevel}`}
        settings={{
          ...bootstrap.settings,
          keyboardVisible: currentLevel < 3 ? bootstrap.settings.keyboardVisible : false
        }}
        layout={activeKeyboardLayout(bootstrap)}
        sessionStartedAtMs={sessionStartedAtMs}
        active={Boolean(sessionId) && !resolving && !saveError && !isAtCapacity}
        onEvent={onGameEvent}
        onComplete={(progress) => {
          void completeStage(progress);
        }}
        onExitRequest={openExitConfirmation}
        onPauseChange={setPaused}
      />
      {saveError ? (
        <button
          className="save-error-banner"
          type="button"
          onClick={() => {
            const pending = pendingResolutionRef.current;
            setSaveError("");
            if (pending) {
              void resolveLevel(pending.result, pending.progress, pending.failureReason);
            } else if (pendingStageRef.current) void loadGameStage(pendingStageRef.current);
            else void flush().catch(() => undefined);
          }}
        >
          <AlertTriangle size={17} />
          <span>{saveError}</span>
          <strong>重试保存</strong>
        </button>
      ) : null}
      {paused ? (
        <p className="paused-game-note" role="status">
          游戏已暂停；倒计时不会继续。
        </p>
      ) : null}
      <GameExitConfirmation
        open={exitOpen}
        saving={exitSaving}
        resolving={resolving}
        onOpenChange={(open) => {
          if (open) openExitConfirmation();
          else cancelExit();
        }}
        onConfirm={() => void exitActiveLevel()}
      />
      <span className="sr-only">
        当前游戏记录{sessionId ? "已建立" : "未开始"}，关卡内容
        {lessonId ? "已载入" : "未创建"}。
      </span>
    </div>
  );
}
