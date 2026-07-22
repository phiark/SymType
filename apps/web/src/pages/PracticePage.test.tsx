/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { api } from "../api";
import { testBootstrap } from "../test/fixtures";
import { PracticePage } from "./PracticePage";

const session = {
  session: {
    id: "00000000-0000-4000-8000-000000000101",
    lessonId: "00000000-0000-4000-8000-000000000102",
    status: "active"
  }
};

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

function renderPractice(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ bootstrap: testBootstrap }} />,
        children: [{ path: "/train/session", element: <PracticePage /> }]
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PracticePage completed-block retry", () => {
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

    await waitFor(() => expect(within(surface).getByText("b")).toBeVisible());
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

    await waitFor(() => expect(within(surface).getByText("b")).toBeVisible());
    expect(eventBatchCalls(post)).toHaveLength(1);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0]).toEqual(patch.mock.calls[1]);
    expect(post.mock.calls.filter(([path]) => String(path).includes("/blocks/next"))).toHaveLength(
      2
    );
  });
});
