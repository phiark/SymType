import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock3, Flame, Gauge, Sparkles } from "lucide-react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeader } from "../components/ui";
import type { BootstrapData, DashboardData } from "../types";

type TrainingIntent = "accuracy" | "balanced" | "speed";

const trainingIntents: ReadonlyArray<{ id: TrainingIntent; label: string }> = [
  { id: "accuracy", label: "准确优先" },
  { id: "balanced", label: "平衡" },
  { id: "speed", label: "速度挑战" }
];

function recencyDescription(lastPracticedAt: string | null): string {
  if (!lastPracticedAt) return "还没有可靠的复测时间";
  const practicedAt = new Date(lastPracticedAt).getTime();
  if (!Number.isFinite(practicedAt)) return "复测时间不可用";
  const days = Math.max(0, Math.floor((Date.now() - practicedAt) / 86_400_000));
  return days === 0 ? "今天已复测" : `${days} 天未复测`;
}

function recommendation(weaknesses: DashboardData["weaknesses"], targetWpm: number): string {
  const first = weaknesses[0];
  if (!first) return "先完成一次基线或短训练，系统才会根据真实样本安排重点。";
  const label =
    first.feature_type === "bigram"
      ? "组合"
      : first.feature_type === "trigram"
        ? "三元组合"
        : "字符";
  const safeTargetWpm = Number.isFinite(targetWpm) && targetWpm > 0 ? targetWpm : 45;
  const targetIkiMs = 60_000 / (safeTargetWpm * 5);
  const speed =
    first.short_iki_ms == null
      ? "速度样本仍少"
      : (() => {
          const gapPercent = Math.round(
            (Math.abs(first.short_iki_ms - targetIkiMs) / targetIkiMs) * 100
          );
          const direction = first.short_iki_ms > targetIkiMs ? "慢" : "快";
          return `稳健短期 IKI 约 ${Math.round(first.short_iki_ms)} ms，比 ${Math.round(safeTargetWpm)} WPM 目标节奏${direction} ${gapPercent}%`;
        })();
  return `${label} “${first.feature_value}” 有 ${first.sample_count} 个样本，短期准确率 ${Math.round(first.accuracy * 100)}%，${speed}，${recencyDescription(first.last_practiced_at)}；本轮安排短组，再放入自然文本复测。`;
}

function trendSummary(trend: DashboardData["trend"]): string {
  const first = trend[0];
  const latest = trend.at(-1);
  if (!first || !latest) return "当前没有按日趋势数据。";
  const delta = latest.net_wpm - first.net_wpm;
  const direction =
    Math.abs(delta) < 0.05
      ? "与首日基本持平"
      : `较首日${delta > 0 ? "提高" : "降低"} ${Math.abs(delta).toFixed(1)} WPM`;
  return `${trend.length} 个按日数据点，从 ${first.local_date} 到 ${latest.local_date}；最近净速度 ${latest.net_wpm.toFixed(1)} WPM、准确率 ${(latest.accuracy * 100).toFixed(1)}%，${direction}。`;
}

export function TodayPage() {
  const outlet = useOutletContext<{ bootstrap?: BootstrapData } | null>();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/api/v1/dashboard")
  });
  const navigate = useNavigate();
  const [intent, setIntent] = useState<TrainingIntent>(
    outlet?.bootstrap?.settings.trainingBias ?? "balanced"
  );
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : "无法读取今日训练。"}
        onRetry={() => void query.refetch()}
      />
    );
  const data = query.data;
  const practicedMinutesExact = data.today.active_ms / 60_000;
  const practicedMinutes = Math.floor(practicedMinutesExact);
  const goalComplete = data.today.active_ms >= data.goal.daily_minutes * 60_000;
  const goalProgress = Math.min(1, practicedMinutesExact / Math.max(1, data.goal.daily_minutes));
  const remainingGoal = Math.max(1, Math.ceil(data.goal.daily_minutes - practicedMinutesExact));
  const systemDuration = [5, 10, 15, 20].find((value) => value >= remainingGoal) ?? 20;
  const startTraining = (duration: number, automatic = false) => {
    const search = new URLSearchParams({
      mode: "smart",
      duration: String(duration),
      bias: intent
    });
    if (automatic) search.set("auto", "1");
    void navigate(`/train/session?${search.toString()}`);
  };

  return (
    <div className="page page--today">
      <PageHeader
        eyebrow="今日训练"
        title={new Intl.DateTimeFormat("zh-CN", {
          month: "long",
          day: "numeric",
          weekday: "long"
        }).format(new Date())}
        description="短而明确的一轮，比盲目堆字符更有价值。"
      />
      <section className="today-hero">
        <div className="today-hero__main">
          <div
            className="goal-ring"
            style={{ "--progress": `${goalProgress * 360}deg` } as React.CSSProperties}
            role="progressbar"
            aria-label="今日训练目标"
            aria-valuemin={0}
            aria-valuemax={data.goal.daily_minutes}
            aria-valuenow={Math.min(data.goal.daily_minutes, practicedMinutesExact)}
            aria-valuetext={`已练习 ${practicedMinutesExact.toFixed(1)} 分钟，目标 ${data.goal.daily_minutes} 分钟`}
          >
            <div>
              <strong>{practicedMinutes}</strong>
              <span>/ {data.goal.daily_minutes} 分钟</span>
            </div>
          </div>
          <div>
            <p className="eyebrow">
              <Sparkles size={15} />
              系统建议
            </p>
            <h2>
              {goalComplete
                ? "今日目标已完成，适合做一次轻量保留复测。"
                : "先守住动作，再把弱点带回自然文本。"}
            </h2>
            <p>{recommendation(data.weaknesses, data.goal.target_wpm)}</p>
            <fieldset className="today-intent">
              <legend>本轮训练倾向</legend>
              <div className="segmented-control">
                {trainingIntents.map((option) => (
                  <button
                    className={intent === option.id ? "is-active" : ""}
                    type="button"
                    aria-pressed={intent === option.id}
                    onClick={() => setIntent(option.id)}
                    key={option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              className="button button--primary button--large"
              type="button"
              onClick={() => startTraining(systemDuration, true)}
            >
              开始今日训练 <ArrowRight size={18} />
            </button>
          </div>
        </div>
        <div className="quick-duration">
          <span>快捷时长</span>
          {[5, 10, 15, 20].map((duration) => (
            <button type="button" onClick={() => startTraining(duration)} key={duration}>
              {duration}
              <small>分钟</small>
            </button>
          ))}
          <button
            type="button"
            title={`根据今日剩余目标选择 ${systemDuration} 分钟`}
            onClick={() => startTraining(systemDuration, true)}
          >
            系统<small>{systemDuration} 分钟</small>
          </button>
        </div>
      </section>
      <section className="metric-grid metric-grid--four">
        <MetricCard
          label="今天练习"
          value={`${practicedMinutes} 分钟`}
          detail={`${data.today.sessions} 节 · ${data.today.characters} 字符`}
          tone="accent"
        />
        <MetricCard
          label="近期净速度"
          value={data.today.characters ? `${Math.round(data.today.net_wpm)} WPM` : "—"}
          detail={data.today.characters ? "标准 5 字符 = 1 word" : "完成训练后显示"}
        />
        <MetricCard
          label="今天准确率"
          value={data.today.characters ? `${Math.round(data.today.accuracy * 100)}%` : "—"}
          detail="有效击键准确率"
          tone={data.today.accuracy >= 0.975 ? "good" : "neutral"}
        />
        <MetricCard
          label="连续训练"
          value={`${data.streak.current_days} 天`}
          detail={`个人最长 ${data.streak.longest_days} 天`}
        />
      </section>
      <div className="two-column-grid">
        <section className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Gauge size={15} />
                14 日趋势
              </p>
              <h2>净 WPM 与训练节奏</h2>
            </div>
            <button className="text-button" type="button" onClick={() => navigate("/analytics")}>
              查看分析 <ArrowRight size={15} />
            </button>
          </div>
          {data.trend.length ? (
            <>
              <p className="chart-text-summary" id="today-trend-summary">
                图表摘要：{trendSummary(data.trend)}
              </p>
              <div
                className="chart-frame"
                role="img"
                aria-label="最近十四日净 WPM 趋势图"
                aria-describedby="today-trend-summary"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend}>
                    <defs>
                      <linearGradient id="todayTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="var(--accent)" stopOpacity={0.28} />
                        <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="local_date"
                      tickFormatter={(value: string) => value.slice(5)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide domain={[0, "auto"]} />
                    <Tooltip
                      formatter={(value) => [`${Math.round(Number(value))} WPM`, "净速度"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="net_wpm"
                      stroke="var(--accent)"
                      strokeWidth={2.2}
                      fill="url(#todayTrend)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <EmptyState
              title="趋势等待第一批数据"
              description="完成一次训练后，这里会显示真实的按日趋势。"
            />
          )}
        </section>
        <section className="panel weakness-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                <Flame size={15} />
                当前三大弱点
              </p>
              <h2>下一轮最值得练什么</h2>
            </div>
          </div>
          {data.weaknesses.length ? (
            <ol className="weakness-list">
              {data.weaknesses.map((item, index) => (
                <li key={`${item.feature_type}-${item.feature_value}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.feature_value === " " ? "Space" : item.feature_value}</strong>
                    <small>
                      {item.feature_type} · 样本 {item.sample_count}
                    </small>
                  </div>
                  <div className="weakness-meter">
                    <i style={{ width: `${Math.max(4, item.accuracy * 100)}%` }} />
                    <small>{Math.round(item.accuracy * 100)}% 准确</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="还没有弱点结论"
              description="样本不足时，SymType 不会把一个偶然慢键说成已知弱点。"
            />
          )}
        </section>
      </div>
      <section className="retention-strip">
        <Clock3 size={20} />
        <div>
          <strong>延迟保留复测</strong>
          <p>
            {data.retention
              ? `间隔 ${data.retention.hoursGap.toFixed(1)} 小时后的复测：净 WPM ${data.retention.netWpmDelta >= 0 ? "+" : ""}${data.retention.netWpmDelta.toFixed(1)}，准确率 ${data.retention.accuracyDelta >= 0 ? "+" : ""}${(data.retention.accuracyDelta * 100).toFixed(1)} 个百分点（${data.retention.sampleCount} 个样本）。`
              : data.lastSession
                ? `最近课程已保存；尚未形成有足够间隔的对应复测，因此不对保留作结论。`
                : "完成首轮训练后，下一次会安排短复测并显示保留差异。"}
          </p>
        </div>
      </section>
    </div>
  );
}
