/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testBootstrap } from "../test/fixtures";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppShell keyboard navigation", () => {
  it("offers a skip link and focuses main content after route changes", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell bootstrap={testBootstrap} />}>
            <Route index element={<h1>今日内容</h1>} />
            <Route path="analytics" element={<h1>分析内容</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
      "href",
      "#main-content"
    );
    const main = screen.getByRole("main");
    expect(main).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "分析" }));
    expect(screen.getByRole("heading", { name: "分析内容" })).toBeVisible();
    expect(main).toHaveFocus();
  });

  it("keeps the focused-session wordmark non-navigable", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    render(
      <MemoryRouter initialEntries={["/train/session"]}>
        <Routes>
          <Route element={<AppShell bootstrap={testBootstrap} />}>
            <Route path="train/session" element={<h1>训练进行中</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByLabelText("SymType 专注模式")).toBeVisible();
    expect(screen.queryByRole("link", { name: /SymType/u })).not.toBeInTheDocument();
  });
});
