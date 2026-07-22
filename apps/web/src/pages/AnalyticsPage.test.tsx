/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { testBootstrap } from "../test/fixtures";
import { AnalyticsPage } from "./AnalyticsPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function baseStatistics() {
  return {
    period: "7d",
    overview: { sessions: 2, active_ms: 90_000, characters: 42, correct: 35, errors: 7 },
    trend: [],
    features: [],
    confusion: [],
    groups: [],
    recentErrors: [],
    shiftSummary: { left: 2, right: 3, both: 0, missing: 1, sameHand: 1, capsLock: 0 },
    experiment: {
      enabled: false,
      assignment: "disabled",
      minimumDays: 14,
      daysObserved: 0,
      eligibleForComparison: false,
      conclusion: "训练算法实验未开启；没有进行策略比较。",
      groups: []
    }
  };
}

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/analytics"]}>
        <Routes>
          <Route element={<Outlet context={{ bootstrap: testBootstrap }} />}>
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AnalyticsPage error analysis", () => {
  it("turns persisted event findings into actions without claiming real finger detection", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...baseStatistics(),
      errorAnalysis: {
        version: 1,
        eventCount: 42,
        validTimingSamples: 30,
        baselineIkiMs: 126,
        evidence: {
          text: { status: "sufficient", sampleCount: 42, minimumSamples: 1 },
          timing: { status: "sufficient", sampleCount: 30, minimumSamples: 5 },
          combinations: { status: "sufficient", sampleCount: 30, minimumSamples: 8 },
          balance: { status: "sufficient", sampleCount: 30, minimumSamples: 10 },
          shift: { status: "sufficient", sampleCount: 4, minimumSamples: 1 },
          fatigue: { status: "sufficient", sampleCount: 42, minimumSamples: 18 }
        },
        textIssues: [
          {
            kind: "transposition",
            count: 1,
            topFeatures: [{ feature: "ta→at", count: 1, severity: 1 }]
          },
          {
            kind: "adjacent-key-confusion",
            count: 2,
            topFeatures: [{ feature: "g→f", count: 2, severity: 1 }]
          }
        ],
        behavioralIssues: [
          {
            kind: "shift-use-error",
            count: 2,
            topFeatures: [
              { feature: "missing-shift", count: 1, severity: 1 },
              { feature: "same-hand-shift", count: 1, severity: 1 }
            ]
          },
          {
            kind: "same-finger-cross-row",
            count: 1,
            topFeatures: [{ feature: "dx", count: 1, severity: 0.5 }]
          },
          {
            kind: "suspected-fatigue",
            count: 1,
            topFeatures: [{ feature: "recent-window", count: 1, severity: 0.3 }]
          }
        ]
      }
    });

    renderAnalytics();

    expect(await screen.findByRole("heading", { name: "错误模式与下一次行动" })).toBeVisible();
    expect(screen.getByText("相邻键混淆")).toBeVisible();
    expect(screen.getByText("相邻字符换序")).toBeVisible();
    expect(screen.getByText("Shift 侧别问题")).toBeVisible();
    expect(screen.getByText(/漏 Shift、同手 Shift/u)).toBeVisible();
    expect(screen.getByText("同一映射指区跨行偏慢")).toBeVisible();
    expect(screen.getByText("近期窗口共同恶化")).toBeVisible();
    expect(screen.getByText(/不检测真实手指，也不诊断肌肉记忆/u)).toBeVisible();
    expect(screen.getByText(/稳健 IKI 基线 126 ms/u)).toBeVisible();
  });

  it("labels sparse evidence explicitly and does not manufacture an issue", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...baseStatistics(),
      overview: { sessions: 1, active_ms: 1_000, characters: 1, correct: 1, errors: 0 },
      errorAnalysis: {
        version: 1,
        eventCount: 1,
        validTimingSamples: 0,
        baselineIkiMs: null,
        evidence: {
          text: { status: "limited", sampleCount: 1, minimumSamples: 1 },
          timing: { status: "insufficient", sampleCount: 0, minimumSamples: 5 },
          combinations: { status: "insufficient", sampleCount: 0, minimumSamples: 8 },
          balance: { status: "insufficient", sampleCount: 0, minimumSamples: 10 },
          shift: { status: "insufficient", sampleCount: 0, minimumSamples: 1 },
          fatigue: { status: "insufficient", sampleCount: 1, minimumSamples: 18 }
        },
        textIssues: [],
        behavioralIssues: []
      }
    });

    renderAnalytics();

    expect(await screen.findByText("当前没有足够证据形成错误模式")).toBeVisible();
    expect(screen.getByText("稳定节奏基线：样本不足")).toBeVisible();
    expect(screen.getAllByText(/样本不足/u).length).toBeGreaterThan(3);
    expect(screen.queryByText("相邻键混淆")).not.toBeInTheDocument();
  });
});

describe("AnalyticsPage capability dimensions", () => {
  it("exposes authoritative content-mode performance as an actionable feature dimension", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...baseStatistics(),
      features: [
        {
          feature_type: "content-mode",
          feature_value: "source-code",
          sample_count: 24,
          accuracy: 0.958,
          short_iki_ms: 215,
          long_iki_ms: 230,
          iki_mad_ms: 42,
          learning_slope: -1.5,
          last_practiced_at: new Date().toISOString()
        }
      ]
    });

    renderAnalytics();

    const contentMode = await screen.findByRole("button", { name: "内容模式" });
    fireEvent.click(contentMode);
    expect(contentMode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table", { name: /内容模式特征/u })).toBeVisible();
    expect(screen.getByText("source-code")).toBeVisible();
  });
});

describe("AnalyticsPage training experiment", () => {
  it("explains how to enable the experiment without inventing a comparison", async () => {
    vi.spyOn(api, "get").mockResolvedValue(baseStatistics());

    renderAnalytics();

    expect(await screen.findByRole("heading", { name: "训练算法实验" })).toBeVisible();
    expect(screen.getByText("训练算法实验未开启；没有进行策略比较。")).toBeVisible();
    expect(screen.getByRole("link", { name: "前往实验设置" })).toHaveAttribute(
      "href",
      "/settings#settings-goals"
    );
    expect(
      screen.queryByRole("table", { name: /adaptive 与 keybr-like baseline/u })
    ).not.toBeInTheDocument();
  });

  it("shows both real groups and keeps an insufficient-sample conclusion explicit", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...baseStatistics(),
      experiment: {
        enabled: true,
        assignment: "balanced-by-local-date",
        minimumDays: 14,
        daysObserved: 3,
        eligibleForComparison: false,
        conclusion: "尚无结论：至少需要 14 个训练日且两种策略各 5 次已完成训练。",
        groups: [
          {
            strategy: "adaptive",
            sessions: 2,
            days: 2,
            activeMinutes: 8.5,
            characters: 520,
            correctCharacters: 501,
            exposureEvents: 520,
            netWpm: 42.3,
            accuracy: 0.963,
            accuracy95HalfWidth: 0.016,
            effectiveCorrectCharactersPerMinute: 58.9,
            transferGapWpm: null,
            subjectiveDifficulty: null,
            subjectiveFatigue: null,
            subjectiveSamples: 0,
            exitRate: 0,
            brierScore: 0.121,
            logLoss: 0.402,
            thresholdTargetWpm: 45,
            thresholdTargetAccuracy: 0.975,
            thresholdMinimumTimingSamples: 20,
            thresholdSessionsEvaluated: 2,
            thresholdTimingEligibleSessions: 2,
            thresholdReachedAt: "2026-07-20T10:00:00.000Z",
            correctCharactersToThreshold: 501,
            activeMinutesToThreshold: 8.5,
            retention: {
              "24h": {
                status: "descriptive",
                pairCount: 2,
                minimumPairs: 2,
                baselineCharacters: 100,
                retestCharacters: 110,
                timingPairCount: 2,
                accuracyDelta: 0.025,
                stableWpmDelta: 3.4
              },
              "72h": {
                status: "insufficient",
                pairCount: 1,
                minimumPairs: 2,
                baselineCharacters: 50,
                retestCharacters: 52,
                timingPairCount: 1,
                accuracyDelta: null,
                stableWpmDelta: null
              },
              "7d": {
                status: "insufficient",
                pairCount: 0,
                minimumPairs: 2,
                baselineCharacters: 0,
                retestCharacters: 0,
                timingPairCount: 0,
                accuracyDelta: null,
                stableWpmDelta: null
              }
            },
            postErrorRecoverySamples: 4,
            postErrorRecoveryMs: 420,
            calibrationSampleCount: 520,
            calibrationMinimumSamples: 30,
            calibrationExpectedError: 0.04,
            calibrationBuckets: [
              {
                lower: 0,
                upper: 0.2,
                sampleCount: 0,
                meanPredicted: null,
                observedAccuracy: null,
                absoluteGap: null
              },
              {
                lower: 0.2,
                upper: 0.4,
                sampleCount: 0,
                meanPredicted: null,
                observedAccuracy: null,
                absoluteGap: null
              },
              {
                lower: 0.4,
                upper: 0.6,
                sampleCount: 20,
                meanPredicted: 0.54,
                observedAccuracy: 0.6,
                absoluteGap: 0.06
              },
              {
                lower: 0.6,
                upper: 0.8,
                sampleCount: 200,
                meanPredicted: 0.72,
                observedAccuracy: 0.75,
                absoluteGap: 0.03
              },
              {
                lower: 0.8,
                upper: 1,
                sampleCount: 300,
                meanPredicted: 0.93,
                observedAccuracy: 0.97,
                absoluteGap: 0.04
              }
            ],
            weaknessChange: {
              status: "descriptive",
              featureCount: 3,
              minimumFeatures: 3,
              exposureEvents: 60,
              improvedFeatureCount: 2,
              accuracyDelta: 0.08,
              medianIkiDeltaMs: -36
            }
          },
          {
            strategy: "baseline",
            sessions: 1,
            days: 1,
            activeMinutes: 4.2,
            characters: 244,
            correctCharacters: 229,
            exposureEvents: 5,
            netWpm: null,
            accuracy: null,
            accuracy95HalfWidth: null,
            effectiveCorrectCharactersPerMinute: null,
            transferGapWpm: null,
            subjectiveDifficulty: null,
            subjectiveFatigue: null,
            subjectiveSamples: 0,
            exitRate: null,
            brierScore: null,
            logLoss: null,
            thresholdTargetWpm: 45,
            thresholdTargetAccuracy: 0.975,
            thresholdMinimumTimingSamples: 20,
            thresholdSessionsEvaluated: 1,
            thresholdTimingEligibleSessions: 0,
            thresholdReachedAt: null,
            correctCharactersToThreshold: null,
            activeMinutesToThreshold: null,
            retention: {
              "24h": {
                status: "insufficient",
                pairCount: 0,
                minimumPairs: 2,
                baselineCharacters: 0,
                retestCharacters: 0,
                timingPairCount: 0,
                accuracyDelta: null,
                stableWpmDelta: null
              },
              "72h": {
                status: "insufficient",
                pairCount: 0,
                minimumPairs: 2,
                baselineCharacters: 0,
                retestCharacters: 0,
                timingPairCount: 0,
                accuracyDelta: null,
                stableWpmDelta: null
              },
              "7d": {
                status: "insufficient",
                pairCount: 0,
                minimumPairs: 2,
                baselineCharacters: 0,
                retestCharacters: 0,
                timingPairCount: 0,
                accuracyDelta: null,
                stableWpmDelta: null
              }
            },
            postErrorRecoverySamples: 0,
            postErrorRecoveryMs: null,
            calibrationSampleCount: 5,
            calibrationMinimumSamples: 30,
            calibrationExpectedError: null,
            calibrationBuckets: Array.from({ length: 5 }, (_, index) => ({
              lower: index / 5,
              upper: (index + 1) / 5,
              sampleCount: index === 3 ? 5 : 0,
              meanPredicted: index === 3 ? 0.7 : null,
              observedAccuracy: index === 3 ? 0.8 : null,
              absoluteGap: index === 3 ? 0.1 : null
            })),
            weaknessChange: {
              status: "insufficient",
              featureCount: 0,
              minimumFeatures: 3,
              exposureEvents: 0,
              improvedFeatureCount: 0,
              accuracyDelta: null,
              medianIkiDeltaMs: null
            }
          }
        ]
      }
    });

    renderAnalytics();

    expect(
      await screen.findByText("尚无结论：至少需要 14 个训练日且两种策略各 5 次已完成训练。")
    ).toBeVisible();
    expect(screen.getByText("尚无结论", { selector: ".experiment-status" })).toHaveAttribute(
      "role",
      "status"
    );
    expect(screen.getByText("3/14 天")).toBeVisible();
    const table = screen.getByRole("table", { name: /adaptive 与 keybr-like baseline/u });
    expect(table).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "Adaptive" })).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "Keybr-like baseline" })).toBeVisible();
    expect(screen.getAllByText("样本不足").length).toBeGreaterThan(2);
    const adaptiveEvidence = screen.getByRole("article", {
      name: "Adaptive 扩展实验证据"
    });
    expect(within(adaptiveEvidence).getByText(/501 个正确字符/u)).toBeVisible();
    expect(within(adaptiveEvidence).getByText("420 ms")).toBeVisible();
    expect(within(adaptiveEvidence).getByText(/2\/2 对/u)).toBeVisible();
    expect(within(adaptiveEvidence).getByText(/ECE 0\.040/u)).toBeVisible();
    expect(within(adaptiveEvidence).getByText(/3\/3 个弱项/u)).toBeVisible();
    const baselineEvidence = screen.getByRole("article", {
      name: "Keybr-like baseline 扩展实验证据"
    });
    expect(within(baselineEvidence).getAllByText("尚无结论").length).toBeGreaterThan(4);
    expect(within(baselineEvidence).getByText(/5\/30 个样本/u)).toBeVisible();
  });
});
