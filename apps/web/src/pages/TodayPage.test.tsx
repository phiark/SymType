/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { TodayPage } from "./TodayPage";

vi.mock("recharts", () => ({
  Area: () => null,
  AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

function dashboardFixture() {
  return {
    goal: { daily_minutes: 10, target_wpm: 45 },
    streak: { current_days: 3, longest_days: 6 },
    today: {
      active_ms: 270_000,
      sessions: 1,
      characters: 220,
      accuracy: 0.98,
      net_wpm: 39
    },
    trend: [
      { local_date: "2026-07-19", net_wpm: 35, accuracy: 0.96, active_ms: 300_000 },
      { local_date: "2026-07-20", net_wpm: 39, accuracy: 0.98, active_ms: 270_000 }
    ],
    weaknesses: [],
    lastSession: null,
    retention: null
  };
}

function renderToday(overrides: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockResolvedValue({ ...dashboardFixture(), ...overrides });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前位置">{`${location.pathname}${location.search}`}</output>;
}

describe("TodayPage data accessibility", () => {
  it("exposes the daily goal as a progressbar and gives the chart a text equivalent", async () => {
    renderToday();

    const progress = await screen.findByRole("progressbar", { name: "今日训练目标" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "10");
    expect(progress).toHaveAttribute("aria-valuenow", "4.5");
    expect(progress).toHaveAttribute("aria-valuetext", "已练习 4.5 分钟，目标 10 分钟");

    const summary = screen.getByText(/2 个按日数据点，从 2026-07-19 到 2026-07-20/u);
    expect(summary).toHaveTextContent("最近净速度 39.0 WPM、准确率 98.0%，较首日提高 4.0 WPM");
    expect(screen.getByRole("img", { name: "最近十四日净 WPM 趋势图" })).toHaveAttribute(
      "aria-describedby",
      summary.id
    );
  });

  it("explains weakness priority with samples, target gap, and recency", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    renderToday({
      weaknesses: [
        {
          feature_type: "bigram",
          feature_value: "ct",
          sample_count: 42,
          accuracy: 0.94,
          short_iki_ms: 349,
          last_practiced_at: "2026-07-19T08:00:00.000Z"
        }
      ]
    });

    fireEvent.click(await screen.findByText("查看本轮重点与依据"));
    expect(
      await screen.findByText(
        /组合 “ct” 有 42 个样本，短期准确率 94%，稳健短期 IKI 约 349 ms，比 45 WPM 目标节奏慢 31%，2 天未复测/u
      )
    ).toBeVisible();
  });

  it("propagates the selected intent and server-goal duration from the primary action", async () => {
    vi.spyOn(api, "get").mockResolvedValue(dashboardFixture());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/train/session" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "速度挑战" }));
    fireEvent.click(screen.getByRole("button", { name: /开始今日训练/u }));

    expect(await screen.findByRole("status", { name: "当前位置" })).toHaveTextContent(
      "/train/session?mode=smart&duration=10&bias=speed&auto=1"
    );
  });
});
