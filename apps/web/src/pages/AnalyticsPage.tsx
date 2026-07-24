import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Grid3X3,
  Info,
  Keyboard,
  Timer
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Link, useOutletContext } from "react-router-dom";

import { api } from "../api";
import { KeyboardHeatmap } from "../components/KeyboardHeatmap";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  SegmentedControl
} from "../components/ui";
import { activeKeyboardLayout } from "../keyboard";
import type { BootstrapData } from "../types";

type Period = "today" | "7d" | "30d" | "all";
type TrendKind = "training" | "test" | "game";
const featureTypeOptions = [
  { value: "key", label: "按键" },
  { value: "bigram", label: "二元组合" },
  { value: "trigram", label: "三元组合" },
  { value: "finger", label: "映射指区" },
  { value: "zone", label: "键区" },
  { value: "class", label: "字符类别" },
  { value: "content-mode", label: "内容模式" }
] as const;
interface Statistics {
  period: Period;
  overview: {
    sessions: number;
    active_ms: number;
    characters: number;
    correct: number;
    errors: number;
    raw_wpm?: number | null;
    net_wpm?: number | null;
    keystroke_accuracy?: number | null;
    consistency?: number | null;
    stable_wpm?: number | null;
    timing_samples?: number;
  };
  trend: {
    local_date: string;
    kind: string;
    active_ms: number;
    character_count: number;
    net_wpm: number;
    raw_wpm: number;
    accuracy: number;
    consistency: number;
  }[];
  features: {
    feature_type: string;
    feature_value: string;
    sample_count: number;
    accuracy: number;
    short_iki_ms: number | null;
    long_iki_ms: number | null;
    iki_mad_ms: number | null;
    learning_slope: number | null;
    last_practiced_at: string | null;
  }[];
  confusion: { target_char: string; actual_char: string; count: number }[];
  groups: {
    hand: string;
    finger: string;
    row: string;
    zone: string;
    class: string;
    shift_side: string;
    samples: number;
    accuracy: number;
    mean_iki_ms: number | null;
    median_iki_ms?: number | null;
    iki_mad_ms?: number | null;
    timing_samples?: number;
  }[];
  shiftSummary?: {
    left: number;
    right: number;
    both: number;
    missing: number;
    sameHand: number;
    capsLock: number;
  };
  recentErrors: {
    session_id: string;
    text_position: number;
    target_char: string;
    actual_char: string;
    physical_code: string;
    server_time: string;
  }[];
  errorAnalysis?: {
    version: 1;
    eventCount: number;
    validTimingSamples: number;
    baselineIkiMs: number | null;
    evidence: Record<
      "text" | "timing" | "combinations" | "balance" | "shift" | "fatigue",
      {
        status: "insufficient" | "limited" | "sufficient";
        sampleCount: number;
        minimumSamples: number;
      }
    >;
    textIssues: ErrorAnalysisIssue[];
    behavioralIssues: ErrorAnalysisIssue[];
  };
  experiment?: {
    enabled: boolean;
    assignment: "disabled" | "balanced-by-local-date";
    minimumDays: number;
    daysObserved: number;
    eligibleForComparison: boolean;
    conclusion: string;
    groups: ExperimentGroup[];
  };
}

interface ExperimentGroup {
  strategy: "adaptive" | "baseline";
  sessions: number;
  days: number;
  activeMinutes: number;
  characters: number;
  correctCharacters: number;
  exposureEvents: number;
  netWpm: number | null;
  accuracy: number | null;
  accuracy95HalfWidth: number | null;
  effectiveCorrectCharactersPerMinute: number | null;
  transferGapWpm: number | null;
  subjectiveDifficulty: number | null;
  subjectiveFatigue: number | null;
  subjectiveSamples: number;
  exitRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  thresholdTargetWpm: number;
  thresholdTargetAccuracy: number;
  thresholdMinimumTimingSamples: number;
  thresholdSessionsEvaluated: number;
  thresholdTimingEligibleSessions: number;
  thresholdReachedAt: string | null;
  correctCharactersToThreshold: number | null;
  activeMinutesToThreshold: number | null;
  retention: Record<
    "24h" | "72h" | "7d",
    {
      status: "insufficient" | "descriptive";
      pairCount: number;
      minimumPairs: number;
      baselineCharacters: number;
      retestCharacters: number;
      timingPairCount: number;
      accuracyDelta: number | null;
      stableWpmDelta: number | null;
    }
  >;
  postErrorRecoverySamples: number;
  postErrorRecoveryMs: number | null;
  calibrationSampleCount: number;
  calibrationMinimumSamples: number;
  calibrationExpectedError: number | null;
  calibrationBuckets: {
    lower: number;
    upper: number;
    sampleCount: number;
    meanPredicted: number | null;
    observedAccuracy: number | null;
    absoluteGap: number | null;
  }[];
  weaknessChange: {
    status: "insufficient" | "limited" | "descriptive";
    featureCount: number;
    minimumFeatures: number;
    exposureEvents: number;
    improvedFeatureCount: number;
    accuracyDelta: number | null;
    medianIkiDeltaMs: number | null;
  };
}

interface ErrorAnalysisIssue {
  kind: string;
  count: number;
  topFeatures: { feature: string; count: number; severity: number }[];
}

const ERROR_GUIDANCE: Record<string, { label: string; action: string }> = {
  transposition: {
    label: "相邻字符换序",
    action: "把该组合放进短组，先守住顺序，再逐步恢复节奏；一次换序只计一个问题。"
  },
  "adjacent-key-confusion": {
    label: "相邻键混淆",
    action: "交替练目标键与相邻键，并在自然单词中复测。"
  },
  "number-symbol-confusion": {
    label: "数字与 Shift 符号混淆",
    action: "用同一物理键成对练习数字与符号，明确切换 Shift。"
  },
  "shift-error": {
    label: "大小写不匹配",
    action: "降低节奏，先确认目标大小写，再复测相反手 Shift。"
  },
  omission: {
    label: "漏键",
    action: "缩短微组并开启遇错停止，确认完整输入后再提速。"
  },
  repeat: {
    label: "重复键",
    action: "降低连击速度，练习清晰抬键与下一字符过渡。"
  },
  insertion: {
    label: "多余输入",
    action: "在短句中复测相邻位置，优先保持字符数与顺序。"
  },
  substitution: {
    label: "其他替换",
    action: "把最常见的实际输入与目标字符成对加入弱点急救。"
  },
  "correct-but-slow": {
    label: "正确但慢",
    action: "保持正确动作，用短组小幅提高节奏，不把单次慢键当成已确认瓶颈。"
  },
  "post-error-slowdown": {
    label: "错误后明显减速",
    action: "练习错误后的平稳恢复；先恢复准确率，不追赶丢失的速度。"
  },
  "slow-bigram": {
    label: "二元组合偏慢",
    action: "优先复测该组合，不重复轰炸组成它的单个字符。"
  },
  "slow-trigram": {
    label: "三元组合偏慢",
    action: "把组合放入可读短词或伪词，验证是否能迁移。"
  },
  "same-finger-cross-row": {
    label: "同一映射指区跨行偏慢",
    action: "用上下行交替短组复测；这里只按键位映射推断，不代表检测到真实手指。"
  },
  "hand-imbalance": {
    label: "左右映射键区节奏不均",
    action: "给较慢一侧安排短组，并用跨手组合作为节奏基线。"
  },
  "finger-imbalance": {
    label: "映射指区节奏不均",
    action: "聚焦较慢键区后插入已掌握组合，避免连续过度使用。"
  },
  "shift-use-error": {
    label: "Shift 侧别问题",
    action: "复测漏 Shift 与同手 Shift；建议默认使用目标键相反侧 Shift。"
  },
  "error-burst": {
    label: "提速时连续错误",
    action: "下一组先降速守住准确率，稳定后再恢复速度挑战。"
  },
  "suspected-fatigue": {
    label: "近期窗口共同恶化",
    action: "速度、准确率和离散度同时变差；先休息或切换轻量组，再观察是否重复出现。"
  }
};

const EVIDENCE_LABELS = {
  text: "文本错误",
  timing: "节奏",
  combinations: "组合",
  balance: "映射键区平衡",
  shift: "Shift",
  fatigue: "近期窗口"
} as const;

function evidenceLabel(status: "insufficient" | "limited" | "sufficient"): string {
  if (status === "sufficient") return "证据充足";
  if (status === "limited") return "证据有限";
  return "样本不足";
}

function visibleFeature(feature: string): string {
  return feature
    .replace("missing-shift", "漏 Shift")
    .replace("same-hand-shift", "同手 Shift")
    .replace("caps-lock", "Caps Lock")
    .replace("both-shifts", "双 Shift");
}

function featureTag(feature: Statistics["features"][number]): string {
  if (feature.sample_count < 12) return "样本不足";
  if (feature.accuracy < 0.94 && (feature.short_iki_ms ?? 0) < 300) return "快但易错";
  if (feature.accuracy >= 0.975 && (feature.short_iki_ms ?? 0) > 500) return "慢但准";
  if ((feature.iki_mad_ms ?? 0) > 160) return "不稳定";
  if (
    feature.last_practiced_at &&
    Date.now() - new Date(feature.last_practiced_at).getTime() > 7 * 86400000
  )
    return "疑似遗忘";
  return "在进步";
}

function metricOrInsufficient(value: number | null, digits = 1): string {
  return value == null ? "样本不足" : value.toFixed(digits);
}

function signedMetric(value: number | null, unit: string, digits = 1): string {
  if (value == null) return "尚无结论";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}${unit}`;
}

function strategyLabel(strategy: ExperimentGroup["strategy"]): string {
  return strategy === "adaptive" ? "Adaptive" : "Keybr-like baseline";
}

export function AnalyticsPage() {
  const { bootstrap } = useOutletContext<{ bootstrap: BootstrapData }>();
  const [period, setPeriod] = useState<Period>("7d");
  const [featureType, setFeatureType] = useState("key");
  const [trendKind, setTrendKind] = useState<TrendKind>("training");
  const query = useQuery({
    queryKey: ["statistics", period],
    queryFn: () => api.get<Statistics>(`/api/v1/statistics?period=${period}`)
  });
  const filteredFeatures = useMemo(
    () =>
      (query.data?.features ?? [])
        .filter((feature) => feature.feature_type === featureType)
        .slice(0, 40),
    [featureType, query.data]
  );
  const featureTypeLabel =
    featureTypeOptions.find((option) => option.value === featureType)?.label ?? featureType;
  if (query.isLoading) return <LoadingState label="正在汇总本机训练事件…" />;
  if (query.isError || !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  const shiftSummary = data.shiftSummary ?? {
    left: 0,
    right: 0,
    both: 0,
    missing: 0,
    sameHand: 0,
    capsLock: 0
  };
  const errorAnalysis = data.errorAnalysis ?? {
    version: 1 as const,
    eventCount: data.overview.characters,
    validTimingSamples: 0,
    baselineIkiMs: null,
    evidence: {
      text: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 1 },
      timing: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 5 },
      combinations: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 8 },
      balance: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 10 },
      shift: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 1 },
      fatigue: { status: "insufficient" as const, sampleCount: 0, minimumSamples: 18 }
    },
    textIssues: [],
    behavioralIssues: []
  };
  const actionableIssues = [...errorAnalysis.textIssues, ...errorAnalysis.behavioralIssues]
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
  const accuracy = data.overview.characters ? data.overview.correct / data.overview.characters : 0;
  const weightedWpm = data.trend.length
    ? data.trend.reduce((sum, item) => sum + item.net_wpm * item.character_count, 0) /
      Math.max(
        1,
        data.trend.reduce((sum, item) => sum + item.character_count, 0)
      )
    : 0;
  const periodNetWpm = data.overview.net_wpm ?? weightedWpm;
  const periodRawWpm = data.overview.raw_wpm;
  const stableWpm = data.overview.stable_wpm;
  const rhythmConsistency = data.overview.consistency;
  const chartData = data.trend
    .filter((item) =>
      trendKind === "training"
        ? item.kind === "training" || item.kind === "calibration"
        : item.kind === trendKind
    )
    .map((item) => ({ ...item, accuracyPercent: item.accuracy * 100 }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="个人分析"
        title="把数据变成下一次行动"
        description="所有结果都来自保存在本机的训练记录；训练、测试和游戏保留各自标签。"
        action={
          <SegmentedControl
            label="时间范围"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "today", label: "今日" },
              { value: "7d", label: "7 日" },
              { value: "30d", label: "30 日" },
              { value: "all", label: "全部" }
            ]}
          />
        }
      />
      <section className="metric-grid metric-grid--four">
        <MetricCard
          label="有效练习"
          value={`${Math.round(data.overview.active_ms / 60000)} 分钟`}
          detail={`${data.overview.sessions} 节`}
          tone="accent"
        />
        <MetricCard
          label="字符"
          value={data.overview.characters.toLocaleString()}
          detail={`${data.overview.errors} 次错误`}
        />
        <MetricCard
          label="净 / 原始 WPM"
          value={data.overview.characters ? periodNetWpm.toFixed(1) : "—"}
          detail={
            periodRawWpm == null
              ? "原始速度样本不足"
              : `原始 ${periodRawWpm.toFixed(1)} · 稳定 ${stableWpm == null ? "样本不足" : stableWpm.toFixed(1)}`
          }
        />
        <MetricCard
          label="击键准确率"
          value={data.overview.characters ? `${(accuracy * 100).toFixed(1)}%` : "—"}
          detail={
            rhythmConsistency == null
              ? "节奏一致性样本不足"
              : `节奏一致性 ${(rhythmConsistency * 100).toFixed(1)}%`
          }
          tone={accuracy >= 0.975 ? "good" : "neutral"}
        />
      </section>
      <section className="panel experiment-panel" aria-labelledby="experiment-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              <Activity size={15} />
              本地交叉策略观察
            </p>
            <h2 id="experiment-heading">训练算法实验</h2>
          </div>
          {data.experiment?.enabled ? (
            <p
              className={`experiment-status ${data.experiment.eligibleForComparison ? "is-ready" : ""}`}
              role="status"
            >
              {data.experiment.eligibleForComparison ? "可以描述性比较" : "尚无结论"}
            </p>
          ) : null}
        </div>
        {!data.experiment ? (
          <EmptyState
            title="尚无实验摘要"
            description="当前没有可显示的策略实验数据；这里不会补入推测值。"
          />
        ) : !data.experiment.enabled ? (
          <div className="experiment-disabled">
            <p>{data.experiment.conclusion}</p>
            <p>
              如需参与本地比较，可前往设置中的“目标与算法”开启“本地训练算法交替试验”。开启后按本地日期整日分配策略，至少积累两周且两组样本充足前仍会显示尚无结论。
            </p>
            <Link className="button button--secondary" to="/settings#settings-goals">
              前往实验设置
            </Link>
          </div>
        ) : (
          <>
            <div className="experiment-summary">
              <p>{data.experiment.conclusion}</p>
              <dl aria-label="实验样本门槛">
                <div>
                  <dt>分配方式</dt>
                  <dd>
                    {data.experiment.assignment === "balanced-by-local-date"
                      ? "按本地日期平衡交替"
                      : "未分配"}
                  </dd>
                </div>
                <div>
                  <dt>观察训练日</dt>
                  <dd>
                    {data.experiment.daysObserved}/{data.experiment.minimumDays} 天
                  </dd>
                </div>
                <div>
                  <dt>解释边界</dt>
                  <dd>
                    {data.experiment.eligibleForComparison
                      ? "仅描述本机样本，不证明因果或统计显著"
                      : "两组达到门槛前不比较优劣"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="table-wrap experiment-table-wrap">
              <table>
                <caption>
                  adaptive 与 keybr-like baseline
                  的本地样本；破折号或“样本不足”表示当前没有足够证据。
                </caption>
                <thead>
                  <tr>
                    <th scope="col">策略</th>
                    <th scope="col">训练量</th>
                    <th scope="col">净 WPM</th>
                    <th scope="col">准确率（95% 半宽）</th>
                    <th scope="col">有效正确字符/分</th>
                    <th scope="col">迁移差距</th>
                    <th scope="col">主观难度 / 疲劳</th>
                    <th scope="col">退出率</th>
                    <th scope="col">校准诊断</th>
                  </tr>
                </thead>
                <tbody>
                  {data.experiment.groups.map((group) => (
                    <tr key={group.strategy}>
                      <th scope="row">{strategyLabel(group.strategy)}</th>
                      <td>
                        {group.sessions} 节 · {group.days} 天
                        <small>
                          {group.activeMinutes.toFixed(1)} 分钟 · {group.characters} 字符 ·{" "}
                          {group.exposureEvents} 次曝光
                        </small>
                      </td>
                      <td>{metricOrInsufficient(group.netWpm)}</td>
                      <td>
                        {group.accuracy == null
                          ? "样本不足"
                          : `${(group.accuracy * 100).toFixed(1)}%${
                              group.accuracy95HalfWidth == null
                                ? ""
                                : ` ± ${(group.accuracy95HalfWidth * 100).toFixed(1)}%`
                            }`}
                      </td>
                      <td>{metricOrInsufficient(group.effectiveCorrectCharactersPerMinute)}</td>
                      <td>
                        {group.transferGapWpm == null
                          ? "样本不足"
                          : `${group.transferGapWpm.toFixed(1)} WPM`}
                      </td>
                      <td>
                        {group.subjectiveSamples
                          ? `${metricOrInsufficient(group.subjectiveDifficulty)} / ${metricOrInsufficient(group.subjectiveFatigue)}`
                          : "样本不足"}
                        <small>{group.subjectiveSamples} 份反馈</small>
                      </td>
                      <td>
                        {group.exitRate == null
                          ? "样本不足"
                          : `${(group.exitRate * 100).toFixed(1)}%`}
                      </td>
                      <td>
                        Brier {metricOrInsufficient(group.brierScore, 3)} · Log loss{" "}
                        {metricOrInsufficient(group.logLoss, 3)}
                        <small>
                          n={group.calibrationSampleCount} · ECE{" "}
                          {group.calibrationExpectedError == null
                            ? "尚无结论"
                            : group.calibrationExpectedError.toFixed(3)}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="experiment-evidence-grid" aria-label="实验纵向证据">
              {data.experiment.groups.map((group) => (
                <article
                  className="experiment-evidence-card"
                  aria-label={`${strategyLabel(group.strategy)} 扩展实验证据`}
                  key={group.strategy}
                >
                  <header>
                    <div>
                      <p className="eyebrow">纵向证据</p>
                      <h3>{strategyLabel(group.strategy)}</h3>
                    </div>
                    <span>
                      {group.thresholdTimingEligibleSessions}/{group.thresholdSessionsEvaluated}{" "}
                      节可估速
                    </span>
                  </header>

                  <dl className="experiment-evidence-metrics">
                    <div>
                      <dt>达到当前稳定门槛</dt>
                      <dd>
                        {group.correctCharactersToThreshold == null ||
                        group.activeMinutesToThreshold == null ? (
                          "尚无结论"
                        ) : (
                          <>
                            {group.correctCharactersToThreshold} 个正确字符 ·{" "}
                            {group.activeMinutesToThreshold.toFixed(1)} 分钟
                          </>
                        )}
                        <small>
                          目标 {group.thresholdTargetWpm.toFixed(0)} WPM /{" "}
                          {(group.thresholdTargetAccuracy * 100).toFixed(1)}% · 每节至少{" "}
                          {group.thresholdMinimumTimingSamples} 个有效 IKI
                          {group.thresholdReachedAt
                            ? ` · 首次达到 ${new Date(group.thresholdReachedAt).toLocaleDateString("zh-CN")}`
                            : ""}
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>错误后恢复</dt>
                      <dd>
                        {group.postErrorRecoveryMs == null
                          ? "尚无结论"
                          : `${group.postErrorRecoveryMs.toFixed(0)} ms`}
                        <small>{group.postErrorRecoverySamples} 个错误后有效节奏样本</small>
                      </dd>
                    </div>
                    <div>
                      <dt>弱项曝光后的变化</dt>
                      <dd>
                        {group.weaknessChange.status === "descriptive" ? (
                          <>
                            准确率{" "}
                            {signedMetric(
                              group.weaknessChange.accuracyDelta == null
                                ? null
                                : group.weaknessChange.accuracyDelta * 100,
                              "%",
                              1
                            )}{" "}
                            · IKI {signedMetric(group.weaknessChange.medianIkiDeltaMs, " ms", 0)}
                          </>
                        ) : (
                          "尚无结论"
                        )}
                        <small>
                          {group.weaknessChange.featureCount}/{group.weaknessChange.minimumFeatures}{" "}
                          个弱项 · {group.weaknessChange.exposureEvents} 次曝光 ·{" "}
                          {group.weaknessChange.improvedFeatureCount} 个出现改善
                        </small>
                      </dd>
                    </div>
                  </dl>

                  <div className="experiment-retention">
                    <h4>同焦点延迟复测</h4>
                    <ul>
                      {(["24h", "72h", "7d"] as const).map((window) => {
                        const retention = group.retention[window];
                        return (
                          <li key={window}>
                            <strong>{window}</strong>
                            <span>
                              {retention.status === "descriptive"
                                ? `准确率 ${signedMetric(retention.accuracyDelta == null ? null : retention.accuracyDelta * 100, "%")} · 稳定 WPM ${signedMetric(retention.stableWpmDelta, " WPM")}`
                                : "尚无结论"}
                              <small>
                                {retention.pairCount}/{retention.minimumPairs} 对 · 基线{" "}
                                {retention.baselineCharacters} / 复测 {retention.retestCharacters}{" "}
                                字符 · {retention.timingPairCount} 对可估速
                              </small>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="experiment-calibration">
                    <h4>预测概率校准</h4>
                    <p>
                      {group.calibrationExpectedError == null
                        ? `尚无结论 · ${group.calibrationSampleCount}/${group.calibrationMinimumSamples} 个样本`
                        : `ECE ${group.calibrationExpectedError.toFixed(3)} · n=${group.calibrationSampleCount}`}
                    </p>
                    <ul aria-label={`${strategyLabel(group.strategy)} 概率校准分桶`}>
                      {group.calibrationBuckets.map((bucket) => (
                        <li key={bucket.lower}>
                          <strong>
                            {(bucket.lower * 100).toFixed(0)}–{(bucket.upper * 100).toFixed(0)}%
                          </strong>
                          <span>
                            {bucket.meanPredicted == null || bucket.observedAccuracy == null
                              ? "尚无结论"
                              : `${(bucket.meanPredicted * 100).toFixed(0)}% → ${(bucket.observedAccuracy * 100).toFixed(0)}%`}
                          </span>
                          <small>n={bucket.sampleCount}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="experiment-causality-note">
                    弱项前后变化与留存差值只描述本机观察样本，不证明训练策略造成了变化。
                  </p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="panel" aria-labelledby="error-analysis-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              <Info size={15} />
              可观察错误分析
            </p>
            <h2 id="error-analysis-heading">错误模式与下一次行动</h2>
          </div>
          <p className="chart-summary">
            {errorAnalysis.baselineIkiMs == null
              ? "稳定节奏基线：样本不足"
              : `稳健 IKI 基线 ${Math.round(errorAnalysis.baselineIkiMs)} ms · ${errorAnalysis.validTimingSamples} 个有效节奏样本`}
          </p>
        </div>
        <p className="shift-summary-note">
          结论只来自当前范围内的训练事件；手与手指项表示当前键盘映射推断的键区表现，不检测真实手指，也不诊断肌肉记忆。
        </p>
        <dl className="shift-summary" aria-label="错误分析证据覆盖">
          {(Object.keys(EVIDENCE_LABELS) as (keyof typeof EVIDENCE_LABELS)[]).map((key) => {
            const item = errorAnalysis.evidence[key];
            return (
              <div key={key}>
                <dt>{EVIDENCE_LABELS[key]}</dt>
                <dd>
                  {evidenceLabel(item.status)} · {item.sampleCount}/{item.minimumSamples}
                </dd>
              </div>
            );
          })}
        </dl>
        {actionableIssues.length ? (
          <div className="group-list" aria-label="可行动错误摘要">
            {actionableIssues.map((issue) => {
              const guidance = ERROR_GUIDANCE[issue.kind] ?? {
                label: issue.kind,
                action: "在下一轮短组中复测；样本继续增加后再判断是否稳定出现。"
              };
              const features = issue.topFeatures
                .slice(0, 3)
                .map((feature) => visibleFeature(feature.feature))
                .join("、");
              return (
                <div key={issue.kind}>
                  <span>
                    <strong>{guidance.label}</strong>
                    <small>
                      {issue.count} 次可观察信号{features ? ` · ${features}` : ""}
                    </small>
                  </span>
                  <span>
                    <small>{guidance.action}</small>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={errorAnalysis.eventCount ? "当前没有足够证据形成错误模式" : "等待真实训练事件"}
            description={
              errorAnalysis.eventCount
                ? "继续积累样本；不会把一次波动包装成确定结论。"
                : "完成课程后，这里会根据本机训练记录生成可行动摘要。"
            }
          />
        )}
      </section>
      <section className="panel analytics-trend">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              <BarChart3 size={15} />
              速度与准确率
            </p>
            <h2>按训练、测试与游戏分开查看</h2>
          </div>
          <div>
            <div className="filter-chips compact">
              {(["training", "test", "game"] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={trendKind === kind}
                  className={trendKind === kind ? "is-active" : ""}
                  onClick={() => setTrendKind(kind)}
                >
                  {kind === "training" ? "训练" : kind === "test" ? "测试" : "游戏"}
                </button>
              ))}
            </div>
            <p className="chart-summary">
              图表摘要：
              {chartData.length
                ? `${chartData.length} 个${trendKind === "training" ? "训练" : trendKind === "test" ? "测试" : "游戏"}数据点，最近净 WPM ${chartData.at(-1)?.net_wpm.toFixed(1)}。`
                : "当前类型与范围没有数据。"}
            </p>
          </div>
        </div>
        {chartData.length ? (
          <div className="chart-frame chart-frame--large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="local_date"
                  tickFormatter={(value: string) => value.slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis yAxisId="wpm" axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="accuracy"
                  orientation="right"
                  domain={[80, 100]}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Legend />
                <Area
                  yAxisId="wpm"
                  type="monotone"
                  dataKey="net_wpm"
                  name="净 WPM"
                  stroke="var(--accent)"
                  fill="var(--accent-soft)"
                  strokeWidth={2}
                />
                <Area
                  yAxisId="accuracy"
                  type="monotone"
                  dataKey="accuracyPercent"
                  name="准确率 %"
                  stroke="var(--success)"
                  fill="transparent"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            title="没有可以绘制的趋势"
            description="完成对应类型后显示；空状态不会填入假数据。"
          />
        )}
      </section>
      <div className="two-column-grid analytics-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Keyboard size={15} />
                键盘热力图
              </p>
              <h2>字符准确率 × 样本量</h2>
            </div>
          </div>
          {data.features.some((feature) => feature.feature_type === "key") ? (
            <KeyboardHeatmap features={data.features} layout={activeKeyboardLayout(bootstrap)} />
          ) : (
            <EmptyState title="热力图等待样本" description="至少完成一轮字母练习后开始着色。" />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Grid3X3 size={15} />
                混淆矩阵
              </p>
              <h2>实际输入 → 目标输入</h2>
            </div>
          </div>
          {data.confusion.length ? (
            <div className="confusion-grid">
              {data.confusion.map((item) => (
                <div key={`${item.target_char}-${item.actual_char}`}>
                  <span>{item.actual_char || "∅"}</span>
                  <ArrowRightMini />
                  <span>{item.target_char || "∅"}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="当前范围没有混淆" description="只有真实错误才会出现在这里。" />
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              <Activity size={15} />
              逐特征状态
            </p>
            <h2>速度、错误率、置信区间与学习斜率</h2>
          </div>
          <div className="filter-chips compact">
            {featureTypeOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={featureType === option.value}
                className={featureType === option.value ? "is-active" : ""}
                onClick={() => setFeatureType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {filteredFeatures.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                {featureTypeLabel}特征的样本量、准确率、置信区间、节奏与学习斜率
              </caption>
              <thead>
                <tr>
                  <th scope="col">特征</th>
                  <th scope="col">状态</th>
                  <th scope="col">样本</th>
                  <th scope="col">准确率</th>
                  <th scope="col">95% 近似区间</th>
                  <th scope="col">短期 IKI</th>
                  <th scope="col">学习斜率</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeatures.map((feature) => {
                  const half = feature.sample_count
                    ? 1.96 *
                      Math.sqrt(
                        (feature.accuracy * (1 - feature.accuracy) +
                          1 / (feature.sample_count + 4)) /
                          (feature.sample_count + 4)
                      )
                    : 0;
                  return (
                    <tr key={`${feature.feature_type}-${feature.feature_value}`}>
                      <td>
                        <strong>
                          {feature.feature_value === " " ? "Space" : feature.feature_value}
                        </strong>
                      </td>
                      <td>
                        <span className="status-tag">{featureTag(feature)}</span>
                      </td>
                      <td>{feature.sample_count}</td>
                      <td>{(feature.accuracy * 100).toFixed(1)}%</td>
                      <td>
                        {feature.sample_count
                          ? `${Math.max(0, (feature.accuracy - half) * 100).toFixed(1)}–${Math.min(100, (feature.accuracy + half) * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td>
                        {feature.short_iki_ms ? `${Math.round(feature.short_iki_ms)} ms` : "—"}
                      </td>
                      <td>
                        {feature.learning_slope == null ? (
                          "样本不足"
                        ) : (
                          <span className={feature.learning_slope >= 0 ? "positive" : "negative"}>
                            {feature.learning_slope >= 0 ? (
                              <ArrowUpRight size={14} />
                            ) : (
                              <ArrowDownRight size={14} />
                            )}{" "}
                            {feature.learning_slope.toFixed(3)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="这个特征层还没有样本"
            description="SymType 会在样本不足时显示无结论，而不是夸大一次表现。"
          />
        )}
      </section>
      <div className="two-column-grid analytics-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Timer size={15} />
                映射键区聚合
              </p>
              <h2>手、手指、行、区域与 Shift</h2>
            </div>
          </div>
          <dl className="shift-summary" aria-label="Shift 侧别统计">
            {[
              ["左 Shift", shiftSummary.left],
              ["右 Shift", shiftSummary.right],
              ["漏 Shift", shiftSummary.missing],
              ["同手 Shift", shiftSummary.sameHand],
              ["Caps Lock", shiftSummary.capsLock]
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="shift-summary-note">
            左/右/漏 Shift 只统计需要 Shift 的目标；同手错误按目标键映射推断，Caps Lock 单独计数。
          </p>
          {data.groups.length ? (
            <div className="group-list">
              {data.groups.slice(0, 12).map((group, index) => (
                <div key={`${group.hand}-${group.finger}-${group.zone}-${index}`}>
                  <span>
                    <strong>{group.finger}</strong>
                    <small>
                      {group.hand} · {group.row} · {group.zone} · Shift {group.shift_side}
                    </small>
                  </span>
                  <span>
                    <strong>{Math.round(group.accuracy * 100)}%</strong>
                    <small>
                      {group.samples} 样本 ·{" "}
                      {(group.median_iki_ms ?? group.mean_iki_ms)
                        ? `${Math.round(group.median_iki_ms ?? group.mean_iki_ms ?? 0)} ms 中位` +
                          (group.iki_mad_ms != null
                            ? ` · MAD ${Math.round(group.iki_mad_ms)} ms`
                            : " · 样本不足以估计 MAD")
                        : "无合格 IKI"}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="尚无键区聚合"
              description="这里描述的是当前映射推断的键区表现，不是实际手指检测。"
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Info size={15} />
                最近错误回放
              </p>
              <h2>只显示训练上下文</h2>
            </div>
          </div>
          {data.recentErrors.length ? (
            <div className="error-replay">
              {data.recentErrors.map((error, index) => (
                <div key={`${error.session_id}-${error.text_position}-${index}`}>
                  <code>{error.actual_char || "∅"}</code>
                  <span>应为</span>
                  <code>{error.target_char || "∅"}</code>
                  <small>
                    {error.physical_code} · 位置 {error.text_position + 1}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="当前范围没有错误"
              description="不会读取或展示训练区以外的任何键入内容。"
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ArrowRightMini() {
  return <span aria-hidden="true">→</span>;
}
