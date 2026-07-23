/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "../api";
import { installDesktopLifecycleBridge } from "../desktop-lifecycle";
import { testBootstrap } from "../test/fixtures";
import { GameExitConfirmation, GamePage } from "./GamePage";

beforeEach(() => {
  installDesktopLifecycleBridge();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const gameBootstrap = {
  ...testBootstrap,
  gameLevels: Array.from({ length: 6 }, (_, index) => ({
    id: `level-${index + 1}`,
    level: index + 1,
    name: `Mission ${index + 1}`,
    description: `Fictional stage ${index + 1}`
  }))
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderGame() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ bootstrap: gameBootstrap }} />,
        children: [{ path: "/game", element: <GamePage /> }]
      }
    ],
    { initialEntries: ["/game"] }
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function renderGamePlay() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ bootstrap: gameBootstrap }} />,
        children: [{ path: "/game/play", element: <GamePage play /> }]
      }
    ],
    { initialEntries: ["/game/play?run=run-1"] }
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const activeGame = {
  run: {
    id: "run-1",
    mode: "campaign",
    difficulty: "standard",
    status: "active",
    current_level: 1,
    score: 0,
    alert_value: 0,
    levels: []
  },
  level: {
    id: "level-1",
    level: 1,
    name: "Mission 1",
    description: "Fictional stage 1",
    objective: "Type the fictional signal"
  },
  targetText: "a"
};

describe("GamePage persisted progress", () => {
  it("uses confirmed level, achievement and personal-best data", async () => {
    vi.spyOn(api, "get").mockImplementation((path) => {
      if (path === "/api/v1/game/achievements") {
        return Promise.resolve({
          achievements: [
            { achievement_id: "first-fiction-breach", unlocked_at: "2026-07-18T00:00:00.000Z" },
            { achievement_id: "error-free-level", unlocked_at: "2026-07-19T00:00:00.000Z" },
            { achievement_id: "hard-campaign", unlocked_at: "2026-07-20T00:00:00.000Z" }
          ]
        });
      }
      if (path === "/api/v1/game/progress") {
        return Promise.resolve({
          unlockedLevel: 3,
          completedLevels: [1, 2],
          personalBests: [
            { level: 1, score: 710 },
            { level: 2, score: 820 }
          ],
          personalBest: 2_400,
          runs: []
        });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderGame();

    expect(await screen.findByText("完整 Run 最高 2,400 分")).toBeVisible();
    expect(screen.getByText("Hard 通关").closest("article")).toHaveAttribute(
      "data-unlocked",
      "true"
    );
    expect(screen.getByText("首次通关").closest("article")).toHaveAttribute(
      "data-unlocked",
      "true"
    );
    expect(screen.getByText("无错通关").closest("article")).toHaveAttribute(
      "data-unlocked",
      "true"
    );
    const levels = screen
      .getAllByRole("article")
      .filter((node) => node.closest(".game-level-list"));
    expect(levels).toHaveLength(6);
    expect(levels[0]).toHaveAttribute("data-state", "complete");
    expect(levels[2]).toHaveAttribute("data-state", "complete");
    expect(within(levels[0]!).getByText("已通关 · 最佳 710 分")).toBeVisible();
  });

  it("shows a conservative first-level fallback when the optional progress API is absent", async () => {
    vi.spyOn(api, "get").mockImplementation((path) => {
      if (path === "/api/v1/game/achievements") return Promise.resolve({ achievements: [] });
      return Promise.reject(new ApiError(404, "NOT_FOUND", "missing optional endpoint"));
    });

    renderGame();

    expect(await screen.findByText(/保守地从第 1 关开始/u)).toBeVisible();
    const levelList = screen.getByRole("region", { name: "六关解锁状态" });
    const levels = within(levelList).getAllByRole("article");
    expect(levels[0]).toHaveAttribute("data-state", "open");
    expect(levels.slice(1).every((level) => level.dataset.state === "locked")).toBe(true);
  });

  it("surfaces run creation failures without leaving an unhandled action", async () => {
    vi.spyOn(api, "get").mockImplementation((path) => {
      if (path === "/api/v1/game/achievements") return Promise.resolve({ achievements: [] });
      return Promise.reject(new ApiError(404, "NOT_FOUND", "missing optional endpoint"));
    });
    vi.spyOn(api, "post").mockRejectedValue(new Error("database busy"));

    renderGame();
    fireEvent.click(await screen.findByRole("button", { name: /启动新任务/u }));

    expect(await screen.findByRole("alert")).toHaveTextContent("database busy");
    await waitFor(() => expect(screen.getByRole("button", { name: /启动新任务/u })).toBeEnabled());
  });

  it("offers the persisted active run as a resumable entry point", async () => {
    vi.spyOn(api, "get").mockImplementation((path) => {
      if (path === "/api/v1/game/achievements") return Promise.resolve({ achievements: [] });
      if (path === "/api/v1/game/progress") {
        return Promise.resolve({
          activeRun: {
            id: "run-resume-1",
            status: "active",
            current_level: 4,
            score: 1200
          },
          unlockedLevel: 4,
          completedLevels: [1, 2, 3],
          personalBests: []
        });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderGame();

    const resume = await screen.findByRole("button", { name: /继续当前 run/u });
    expect(resume).toBeVisible();
    const fourthLevel = within(screen.getByRole("region", { name: "六关解锁状态" })).getAllByRole(
      "article"
    )[3];
    expect(fourthLevel).toHaveTextContent("当前 run 正在此关");
  });
});

describe("GamePage active-session exit safety", () => {
  it("refuses native shutdown while a created game session is waiting for its first block", async () => {
    const firstBlock = deferred<{ block: { id: string; target_text: string } }>();
    vi.spyOn(api, "get").mockImplementation((path) => {
      if (path === "/api/v1/game/runs/run-1") return Promise.resolve(activeGame);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const post = vi.spyOn(api, "post").mockImplementation(<T,>(path: string) => {
      if (path === "/api/v1/sessions") {
        return Promise.resolve({
          session: { id: "game-session-1", lessonId: "game-lesson-1" }
        } as T);
      }
      if (path.includes("/blocks/next")) return firstBlock.promise;
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });

    renderGamePlay();
    fireEvent.click(await screen.findByRole("button", { name: /开始关卡/u }));
    await waitFor(() =>
      expect(post.mock.calls.some(([path]) => String(path).includes("/blocks/next"))).toBe(true)
    );

    await expect(window.symtypeDesktop.prepareToHide()).resolves.toBe("failed");
    await expect(window.symtypeDesktop.requestQuit()).resolves.toBe("failed");

    firstBlock.resolve({ block: { id: "game-block-1", target_text: "a" } });
    expect(await screen.findByRole("textbox", { name: "打字练习输入区" })).toBeVisible();
  });

  it("presents an explicit save-and-abandon choice instead of exiting on request", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <GameExitConfirmation
        open
        saving={false}
        resolving={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog", { name: "退出当前关卡？" })).toHaveTextContent(
      "先写入 SQLite"
    );
    expect(screen.getByRole("dialog", { name: "退出当前关卡？" })).toHaveTextContent(
      "标记为已放弃"
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并退出" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
