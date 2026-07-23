/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { api } from "../api";
import { installDesktopLifecycleBridge, type DesktopLifecycleResult } from "../desktop-lifecycle";
import { testBootstrap } from "../test/fixtures";
import { PracticePage } from "./PracticePage";

const session = {
  session: {
    id: "00000000-0000-4000-8000-000000000101",
    lessonId: "00000000-0000-4000-8000-000000000102",
    status: "active"
  }
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function block(index: number, target: string, sourceStart?: number) {
  return {
    block: {
      id: `00000000-0000-4000-8000-00000000020${index}`,
      lesson_id: session.session.lessonId,
      block_index: index,
      block_type: index === 0 ? "warmup" : "focus",
      target_text: target,
      rationale: index === 0 ? "first block" : "second block",
      ...(sourceStart == null ? {} : { source_start: sourceStart })
    }
  };
}

function renderPractice(initialEntry: string, kind: "training" | "test" = "training") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ bootstrap: testBootstrap }} />,
        children: [{ path: "/train/session", element: <PracticePage kind={kind} /> }]
      }
    ],
    { initialEntries: [initialEntry] }
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function eventBatchCalls(post: MockInstance<typeof api.post>) {
  return post.mock.calls.filter(([path]) => String(path).endsWith("/events"));
}

async function typeFirstBlock() {
  fireEvent.click(screen.getByRole("button", { name: /^开始/u }));
  const surface = await screen.findByRole("textbox", { name: "打字练习输入区" });
  fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
  return surface;
}

beforeEach(() => {
  installDesktopLifecycleBridge();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PracticePage desktop lifecycle", () => {
  it("refuses native shutdown after session creation until the first block is owned", async () => {
    const firstBlock = deferred<ReturnType<typeof block>>();
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) return firstBlock.promise as Promise<T>;
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=27");
    fireEvent.click(screen.getByRole("button", { name: /^开始/u }));
    await waitFor(() =>
      expect(post.mock.calls.some(([path]) => String(path).includes("/blocks/next"))).toBe(true)
    );

    await expect(window.symtypeDesktop.prepareToHide()).resolves.toBe("failed");
    await expect(window.symtypeDesktop.requestQuit()).resolves.toBe("failed");
    expect(screen.queryByRole("dialog", { name: "结束这次训练？" })).not.toBeInTheDocument();

    firstBlock.resolve(block(0, "ab"));
    expect(await screen.findByRole("textbox", { name: "打字练习输入区" })).toBeVisible();
  });

  it("reuses the visible save-and-abandon confirmation for native quit", async () => {
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) return Promise.resolve(block(0, "ab") as T);
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1, checkpoint: 1 } } as T);
      }
      if (path.endsWith("/pause") || path.endsWith("/abandon")) {
        return Promise.resolve({ ok: true } as T);
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=29");
    const surface = await typeFirstBlock();
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });

    let cancelledQuit!: Promise<DesktopLifecycleResult>;
    act(() => {
      cancelledQuit = window.symtypeDesktop.requestQuit();
    });
    fireEvent.click(await screen.findByRole("button", { name: "继续训练" }));
    await expect(cancelledQuit).resolves.toBe("cancelled");

    let acceptedQuit!: Promise<DesktopLifecycleResult>;
    act(() => {
      acceptedQuit = window.symtypeDesktop.requestQuit();
    });
    fireEvent.click(await screen.findByRole("button", { name: "保存并退出" }));
    await expect(acceptedQuit).resolves.toBe("ready");
    expect(eventBatchCalls(post)).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(
      `/api/v1/sessions/${session.session.id}/abandon`,
      expect.any(Object)
    );
  });
});

describe("PracticePage completed-block retry", () => {
  it("resets the typing surface when the next block repeats the same target text", async () => {
    let blockRequests = 0;
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) {
        const response = block(blockRequests, "a");
        blockRequests += 1;
        return Promise.resolve(response as T);
      }
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1 } } as T);
      }
      if (path.endsWith("/pause")) return Promise.resolve({ saved: true } as T);
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=7");
    const completedSurface = await typeFirstBlock();

    await waitFor(() => expect(screen.getByText("0/1")).toBeVisible());
    const nextSurface = screen.getByRole("textbox", { name: "打字练习输入区" });

    expect(nextSurface).not.toBe(completedSurface);
    expect(nextSurface.querySelector(".typing-glyph.is-current")).toHaveTextContent("a");
    expect(eventBatchCalls(post)).toHaveLength(1);
  });

  it("keeps the completed block stable and retries next-block loading without reposting events", async () => {
    let blockRequests = 0;
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) {
        blockRequests += 1;
        if (blockRequests === 1) return Promise.resolve(block(0, "a") as T);
        if (blockRequests === 2) return Promise.reject(new Error("下一微组暂时不可用。"));
        return Promise.resolve(block(1, "b") as T);
      }
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1 } } as T);
      }
      if (path.endsWith("/pause")) return Promise.resolve({ saved: true } as T);
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=11");
    const surface = await typeFirstBlock();

    const retry = await screen.findByRole("button", { name: /重试保存并继续/u });
    expect(retry).toHaveTextContent("下一微组暂时不可用");
    expect(within(surface).getByText("a")).toBeVisible();
    expect(within(surface).queryByText("b")).not.toBeInTheDocument();
    expect(eventBatchCalls(post)).toHaveLength(1);

    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        within(screen.getByRole("textbox", { name: "打字练习输入区" })).getByText("b")
      ).toBeVisible()
    );
    expect(screen.queryByRole("button", { name: /重试保存并继续/u })).not.toBeInTheDocument();
    expect(eventBatchCalls(post)).toHaveLength(1);
    expect(post.mock.calls.filter(([path]) => String(path).includes("/blocks/next"))).toHaveLength(
      3
    );
  });

  it("retries idempotent custom-text progress before advancing and does not repost the block events", async () => {
    let blockRequests = 0;
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) {
        blockRequests += 1;
        return Promise.resolve((blockRequests === 1 ? block(0, "a", 0) : block(1, "b", 1)) as T);
      }
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1 } } as T);
      }
      if (path.endsWith("/pause")) return Promise.resolve({ saved: true } as T);
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);
    const patch = vi
      .spyOn(api, "patch")
      .mockRejectedValueOnce(new Error("阅读进度暂时不可写入。"))
      .mockResolvedValueOnce({ ok: true, readingPosition: 1 });

    renderPractice(
      "/train/session?mode=custom&duration=5&seed=13&customTextId=00000000-0000-4000-8000-000000000301"
    );
    const surface = await typeFirstBlock();

    const retry = await screen.findByRole("button", { name: /重试保存并继续/u });
    expect(retry).toHaveTextContent("阅读进度暂时不可写入");
    expect(within(surface).getByText("a")).toBeVisible();
    expect(eventBatchCalls(post)).toHaveLength(1);
    expect(patch).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        within(screen.getByRole("textbox", { name: "打字练习输入区" })).getByText("b")
      ).toBeVisible()
    );
    expect(eventBatchCalls(post)).toHaveLength(1);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0]).toEqual(patch.mock.calls[1]);
    expect(post.mock.calls.filter(([path]) => String(path).includes("/blocks/next"))).toHaveLength(
      2
    );
  });
});

describe("PracticePage trailing correction closure", () => {
  const completedSummary = {
    characters: 1,
    correct: 1,
    errors: 0,
    rawWpm: 1,
    netWpm: 1,
    keystrokeAccuracy: 1,
    finalTextAccuracy: 1,
    accuracy: 1,
    consistency: 1,
    activeMs: 15_000,
    longestAccurateStreak: 1,
    feedback: { good: "ok", bottleneck: "ok", next: "ok" },
    errorAnalysis: {
      version: 1,
      eventCount: 1,
      validTimingSamples: 0,
      baselineIkiMs: null,
      evidence: {},
      textIssues: [],
      behavioralIssues: []
    }
  };

  it("sends the trailing Backspace position when a timed test completes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) return Promise.resolve(block(0, "ab") as T);
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1, checkpoint: 0 } } as T);
      }
      if (path.endsWith("/complete")) {
        return Promise.resolve({ saved: true, summary: completedSummary } as T);
      }
      if (path === "/api/v1/tests") return Promise.resolve({ test: {} } as T);
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=test&seconds=15&seed=17", "test");
    fireEvent.click(screen.getByRole("button", { name: /^开始/u }));
    const surface = await screen.findByRole("textbox", { name: "打字练习输入区" });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });

    now = 16_100;
    act(() => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/api/v1/sessions/${session.session.id}/complete`,
        expect.objectContaining({
          correctionCheckpoint: { blockId: block(0, "ab").block.id, position: 0 }
        })
      )
    );
  });

  it("sends the trailing Backspace position when explicitly saving and exiting", async () => {
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) return Promise.resolve(block(0, "ab") as T);
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1, checkpoint: 0 } } as T);
      }
      if (path.endsWith("/pause") || path.endsWith("/abandon")) {
        return Promise.resolve({ ok: true } as T);
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=19");
    fireEvent.click(screen.getByRole("button", { name: /^开始/u }));
    const surface = await screen.findByRole("textbox", { name: "打字练习输入区" });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    fireEvent.keyDown(surface, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(surface, { key: "Escape", code: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "保存并退出" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/v1/sessions/${session.session.id}/abandon`, {
        correctionCheckpoint: { blockId: block(0, "ab").block.id, position: 0 }
      })
    );
  });

  it("sends a zero-position checkpoint when saving immediately after a manual restart", async () => {
    const postImplementation: typeof api.post = <T,>(path: string) => {
      if (path === "/api/v1/sessions") return Promise.resolve(session as T);
      if (path.includes("/blocks/next")) return Promise.resolve(block(0, "ab") as T);
      if (path.endsWith("/events")) {
        return Promise.resolve({ result: { accepted: 1, checkpoint: 0 } } as T);
      }
      if (path.endsWith("/pause") || path.endsWith("/abandon")) {
        return Promise.resolve({ ok: true } as T);
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    };
    const post = vi.spyOn(api, "post").mockImplementation(postImplementation);

    renderPractice("/train/session?mode=smart&duration=5&seed=23");
    fireEvent.click(screen.getByRole("button", { name: /^开始/u }));
    const surface = await screen.findByRole("textbox", { name: "打字练习输入区" });
    fireEvent.keyDown(surface, { key: "a", code: "KeyA" });
    fireEvent.click(screen.getByRole("button", { name: "重开当前微组" }));
    fireEvent.keyDown(surface, { key: "Escape", code: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "保存并退出" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/v1/sessions/${session.session.id}/abandon`, {
        correctionCheckpoint: { blockId: block(0, "ab").block.id, position: 0 }
      })
    );
  });
});
