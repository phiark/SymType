/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { useSessionNavigationGuard } from "./useSessionNavigationGuard";

afterEach(cleanup);

function GuardHarness({ lifecycle }: { lifecycle: string[] }) {
  const { blocker } = useSessionNavigationGuard(true);
  return (
    <main>
      <h1>活动训练</h1>
      <Link to="/left">离开页面</Link>
      {blocker.state === "blocked" ? (
        <div role="dialog" aria-label="确认离开">
          <button type="button" onClick={() => blocker.reset()}>
            继续训练
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                lifecycle.push("flush");
                await Promise.resolve();
                lifecycle.push("abandon");
                blocker.proceed();
              })();
            }}
          >
            保存并退出
          </button>
        </div>
      ) : null}
    </main>
  );
}

describe("useSessionNavigationGuard", () => {
  it("blocks same-app navigation until flush and abandon complete", async () => {
    const lifecycle: string[] = [];
    const router = createMemoryRouter(
      [
        { path: "/session", element: <GuardHarness lifecycle={lifecycle} /> },
        { path: "/left", element: <h1>目标页面</h1> }
      ],
      { initialEntries: ["/session"] }
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("link", { name: "离开页面" }));
    expect(await screen.findByRole("dialog", { name: "确认离开" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "目标页面" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存并退出" }));
    expect(await screen.findByRole("heading", { name: "目标页面" })).toBeVisible();
    expect(lifecycle).toEqual(["flush", "abandon"]);
  });

  it("requests native confirmation for a hard unload while active", () => {
    const router = createMemoryRouter(
      [{ path: "/session", element: <GuardHarness lifecycle={[]} /> }],
      { initialEntries: ["/session"] }
    );
    render(<RouterProvider router={router} />);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
