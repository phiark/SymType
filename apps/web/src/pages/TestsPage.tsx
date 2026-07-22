import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Award, Clock3, Gauge, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { persistedTestErrorsSchema, type PersistedTestErrors } from "@symtype/shared";

import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeader } from "../components/ui";
import type { TestRecord } from "../types";

function parseTestErrors(value: string | undefined): PersistedTestErrors | null {
  try {
    const parsed = persistedTestErrorsSchema.safeParse(JSON.parse(value ?? "null") as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function TestsPage() {
  const navigate = useNavigate();
  const [customSeconds, setCustomSeconds] = useState(180);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["tests"],
    queryFn: () => api.get<{ tests: TestRecord[] }>("/api/v1/tests")
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : "无法读取测试记录。"}
        onRetry={() => void query.refetch()}
      />
    );
  const tests = query.data.tests;
  const rankedTests = [...tests].sort(
    (first, second) =>
      second.net_wpm - first.net_wpm ||
      second.accuracy - first.accuracy ||
      second.consistency - first.consistency
  );
  const best = rankedTests[0] ?? null;
  const stableCandidates = tests.filter(
    (item) => (item.keystroke_accuracy ?? item.accuracy) >= 0.97
  );
  const stable =
    stableCandidates.length >= 3
      ? [...stableCandidates].sort((first, second) => first.net_wpm - second.net_wpm)[
          Math.floor((stableCandidates.length - 1) * 0.25)
        ]
      : undefined;
  const start = (seconds: number) => navigate(`/test/session?mode=typing-test&seconds=${seconds}`);

  return (
    <div className="page">
      <PageHeader
        eyebrow="打字测试"
        title="把测试与训练分开看"
        description="固定时长，报告净/原始 WPM、击键准确率、一致性和错误明细。"
      />
      <section className="test-duration-grid">
        {[15, 30, 60, 120].map((seconds) => (
          <button
            className="test-duration-card"
            type="button"
            key={seconds}
            onClick={() => start(seconds)}
          >
            <Clock3 size={20} />
            <strong>{seconds}</strong>
            <span>秒</span>
            <ArrowRight size={17} />
          </button>
        ))}
        <div className="test-custom-card">
          <label htmlFor="custom-test-duration">自定义时长</label>
          <div>
            <input
              id="custom-test-duration"
              type="number"
              min={15}
              max={3600}
              value={customSeconds}
              onChange={(event) =>
                setCustomSeconds(Math.min(3600, Math.max(15, Number(event.target.value))))
              }
            />
            <span>秒</span>
            <button
              className="button button--primary"
              type="button"
              onClick={() => start(customSeconds)}
            >
              开始
            </button>
          </div>
        </div>
      </section>
      <section className="metric-grid metric-grid--three">
        <MetricCard
          label="最佳净速度"
          value={best ? `${best.net_wpm.toFixed(1)} WPM` : "—"}
          detail={best ? `${best.duration_seconds} 秒测试` : "尚无正式测试"}
          tone="accent"
        />
        <MetricCard
          label="最佳稳定速度"
          value={stable ? `${stable.net_wpm.toFixed(1)} WPM` : "—"}
          detail={
            stable
              ? `${stableCandidates.length} 个 ≥97% 样本的保守下四分位`
              : `需要至少 3 个高准确测试（当前 ${stableCandidates.length}）`
          }
          tone={stable ? "good" : "neutral"}
        />
        <MetricCard label="正式测试次数" value={tests.length} detail="游戏和训练不计入排名" />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              <Award size={15} />
              本地排行榜
            </p>
            <h2>只和自己的历史比较</h2>
          </div>
        </div>
        {rankedTests.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                本地正式打字测试排行榜，按净 WPM、准确率和一致性排序
              </caption>
              <thead>
                <tr>
                  <th scope="col">排名 / 日期</th>
                  <th scope="col">时长</th>
                  <th scope="col">净 WPM</th>
                  <th scope="col">原始 WPM</th>
                  <th scope="col">击键 / 最终准确率</th>
                  <th scope="col">一致性</th>
                  <th scope="col">错误明细</th>
                </tr>
              </thead>
              <tbody>
                {rankedTests.map((test, index) => {
                  const errors = parseTestErrors(test.errors_json);
                  const expanded = expandedTestId === test.id;
                  return (
                    <Fragment key={test.id}>
                      <tr>
                        <td>
                          <span className="rank">{index + 1}</span>
                          {new Intl.DateTimeFormat("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                          }).format(new Date(test.created_at))}
                        </td>
                        <td>{test.duration_seconds}s</td>
                        <td>
                          <strong>{test.net_wpm.toFixed(1)}</strong>
                        </td>
                        <td>{test.raw_wpm.toFixed(1)}</td>
                        <td>
                          {Math.round((test.keystroke_accuracy ?? test.accuracy) * 1000) / 10}% /{" "}
                          {test.final_text_accuracy == null
                            ? "—"
                            : `${Math.round(test.final_text_accuracy * 1000) / 10}%`}
                        </td>
                        <td>{Math.round(test.consistency * 100)}%</td>
                        <td>
                          <button
                            className="text-button"
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`test-errors-${test.id}`}
                            onClick={() => setExpandedTestId(expanded ? null : test.id)}
                          >
                            {errors ? `${errors.count} 次` : "记录损坏"} ·{" "}
                            {expanded ? "收起" : "查看"}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="test-error-row">
                          <td colSpan={7} id={`test-errors-${test.id}`}>
                            <div className="test-error-detail">
                              <strong>本次测试错误证据</strong>
                              {!errors ? (
                                <p role="alert">
                                  错误明细记录已损坏，不能把它解释为零错误。请从设置中的有效备份恢复。
                                </p>
                              ) : errors.count === 0 ? (
                                <p>没有记录到错误击键。</p>
                              ) : (
                                <>
                                  <p>
                                    共 {errors.count} 次；这里只显示 SymType
                                    训练区里的目标、实际输入、 物理键和位置。
                                  </p>
                                  <ul>
                                    {errors.topConfusions.slice(0, 8).map((error) => (
                                      <li
                                        key={`${error.target}-${error.actual}-${error.physicalCode}`}
                                      >
                                        目标 <code>{error.target || "∅"}</code> → 实际{" "}
                                        <code>{error.actual || "∅"}</code> · {error.physicalCode} ·{" "}
                                        {error.count} 次
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="还没有正式测试"
            description="从 15 秒熟悉流程；稳定速度需要更多样本，单次爆发不会被称为掌握。"
            action={
              <button className="button button--primary" type="button" onClick={() => start(15)}>
                开始 15 秒测试 <ArrowRight size={16} />
              </button>
            }
          />
        )}
      </section>
      <div className="explanation-grid">
        <div>
          <Gauge size={18} />
          <span>
            <strong>净 WPM</strong>
            <small>标准 5 字符计一词，并扣除未修正错误惩罚。</small>
          </span>
        </div>
        <div>
          <Target size={18} />
          <span>
            <strong>两种准确率</strong>
            <small>训练事件保留击键准确率；最终文本准确率按提交文本编辑距离计算。</small>
          </span>
        </div>
      </div>
    </div>
  );
}
