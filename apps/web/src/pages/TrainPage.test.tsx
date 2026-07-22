/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { testBootstrap } from "../test/fixtures";
import { TrainPage } from "./TrainPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="current-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderTrain() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Outlet context={{ bootstrap: testBootstrap }} />}>
            <Route index element={<TrainPage />} />
            <Route path="train/session" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TrainPage progress-backed modes", () => {
  it("shows saved custom text metadata and resumes from the server-owned position", async () => {
    vi.spyOn(api, "get").mockImplementation((path) => {
      expect(path).toBe("/api/v1/custom-texts");
      return Promise.resolve({
        texts: [
          {
            id: "8de78c3d-d10b-48aa-9408-2166b67deffa",
            title: "Local chapter",
            file_type: "md",
            character_count: 1000,
            word_count: 180,
            include_in_model: 1,
            reading_position: 240,
            updated_at: "2026-07-20T00:00:00.000Z"
          }
        ]
      });
    });

    renderTrain();
    fireEvent.click(screen.getByRole("button", { name: /自定义文本/u }));

    expect(await screen.findByText("Local chapter")).toBeVisible();
    expect(screen.getByText("240 / 1,000 字符")).toBeVisible();
    expect(screen.getByText("计入模型")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /继续训练/u }));

    const location = await screen.findByRole("status", { name: "current-location" });
    const url = new URL(`http://symtype.local${location.textContent ?? ""}`);
    expect(url.pathname).toBe("/train/session");
    expect(url.searchParams.get("customTextId")).toBe("8de78c3d-d10b-48aa-9408-2166b67deffa");
    expect(url.searchParams.get("includeInModel")).toBe("1");
  });

  it("renders the eight-step ladder from saved truth and passes recognized scope plus explicit characters", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      stages: [
        { id: "home", order: 1, completed: true, unlocked: true },
        { id: "index", order: 2, completed: false, unlocked: true },
        { id: "other", order: 3, completed: false, unlocked: false },
        { id: "top", order: 4, completed: false, unlocked: false },
        { id: "bottom", order: 5, completed: false, unlocked: false },
        { id: "numbers", order: 6, completed: false, unlocked: false },
        { id: "symbols", order: 7, completed: false, unlocked: false },
        { id: "shift", order: 8, completed: false, unlocked: false }
      ]
    });

    renderTrain();
    fireEvent.click(screen.getByRole("button", { name: /传统分区课程/u }));

    const ladder = await screen.findByRole("list", { name: /传统课程/u });
    expect(within(ladder).getAllByRole("listitem")).toHaveLength(8);
    expect(await within(ladder).findByText("已完成")).toBeVisible();

    const indexStage = within(ladder).getAllByRole("listitem")[1]!;
    fireEvent.click(within(indexStage).getByRole("button", { name: /开始/u }));

    const location = await screen.findByRole("status", { name: "current-location" });
    const url = new URL(`http://symtype.local${location.textContent ?? ""}`);
    expect(url.searchParams.get("mode")).toBe("traditional");
    expect(url.searchParams.get("stage")).toBe("index");
    expect(url.searchParams.get("scope")).toBe("食指区,字母");
    expect(url.searchParams.get("focus")).toMatch(/[rcvtgbyhnumj]/u);
  });

  it("falls back to only the first stage when progress cannot be read", async () => {
    const getSpy = vi.spyOn(api, "get").mockRejectedValue(new Error("progress unavailable"));

    renderTrain();
    fireEvent.click(screen.getByRole("button", { name: /传统分区课程/u }));

    expect(await screen.findByText(/只开放第 1 阶/u)).toBeVisible();
    const ladder = screen.getByRole("list", { name: /传统课程/u });
    const stages = within(ladder).getAllByRole("listitem");
    expect(within(stages[0]!).getByRole("button", { name: /开始/u })).toBeEnabled();
    expect(within(stages[1]!).getByRole("button", { name: /开始/u })).toBeDisabled();
    expect(within(ladder).queryByText("已完成")).not.toBeInTheDocument();

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
  });
});
