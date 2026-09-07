/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { soundEngine } from "../audio";
import { testBootstrap } from "../test/fixtures";
import type { BootstrapData } from "../types";
import { OnboardingPage } from "./OnboardingPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderOnboarding(bootstrap: BootstrapData = testBootstrap) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingPage bootstrap={bootstrap} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("OnboardingPage trust boundary", () => {
  it("explains local data durability and the inferred-finger limitation before setup", () => {
    renderOnboarding();

    expect(screen.getByText("只在这台电脑")).toBeVisible();
    expect(screen.getByText(/安全保存在这台电脑；清浏览器数据不会删除/u)).toBeVisible();
    expect(screen.getByText("不检测真实手指")).toBeVisible();
    expect(screen.getByText(/按当前映射推断的键区表现/u)).toBeVisible();
  });

  it("keeps local-audio and sensitive-text notices in the guided flow", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /开始设置/u }));
    expect(screen.getByText(/本地 Web Audio 合成，不加载远程音频/u)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /继续/u }));
    expect(screen.getByText(/不要输入真实密码、API key、私钥/u)).toBeVisible();
  });

  it("keeps audio denial non-blocking and explains how training can continue", async () => {
    vi.spyOn(soundEngine, "unlock").mockResolvedValue(false);
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /开始设置/u }));
    fireEvent.click(screen.getByRole("switch", { name: "声音反馈" }));
    fireEvent.click(screen.getByRole("button", { name: /试听并解锁声音/u }));

    expect(await screen.findByRole("status")).toHaveTextContent("浏览器未允许声音；训练仍可继续");
    expect(screen.getByRole("button", { name: /^继续/u })).toBeEnabled();
  });

  it("plays an allowed preview cue when errors-only audio was already selected", async () => {
    vi.spyOn(soundEngine, "unlock").mockResolvedValue(true);
    const play = vi.spyOn(soundEngine, "play").mockImplementation(() => undefined);
    renderOnboarding({
      ...testBootstrap,
      settings: { ...testBootstrap.settings, soundEnabled: true, soundMode: "errors" }
    });

    fireEvent.click(screen.getByRole("button", { name: /开始设置/u }));
    fireEvent.click(screen.getByRole("button", { name: /试听并解锁声音/u }));

    expect(await screen.findByRole("status")).toHaveTextContent("声音已解锁");
    expect(play).toHaveBeenCalledWith("error");
  });

  it("moves keyboard focus to each step heading", () => {
    renderOnboarding();

    expect(screen.getByRole("progressbar", { name: "首次设置进度" })).toHaveAttribute(
      "aria-valuetext",
      "第 1 步，共 3 步"
    );
    expect(screen.getByRole("heading", { name: /为 Symmetric 指法/u })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /开始设置/u }));
    expect(screen.getByRole("progressbar", { name: "首次设置进度" })).toHaveAttribute(
      "aria-valuenow",
      "2"
    );
    expect(screen.getByRole("heading", { name: "先让训练适合你的环境。" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /继续/u }));
    expect(screen.getByRole("heading", { name: "选择这次想取样的区域。" })).toHaveFocus();
  });

  it("keeps choices and exposes a retryable alert when saving fails", async () => {
    vi.spyOn(api, "patch").mockRejectedValue(new Error("无法连接本地服务器，请重试。"));
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /开始设置/u }));
    fireEvent.click(screen.getByRole("button", { name: /继续/u }));
    const digits = screen.getByRole("button", { name: /数字ANSI 数字行/u });
    fireEvent.click(digits);
    expect(digits).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "稍后校准" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本次更改尚未保存");
    expect(screen.getByRole("alert")).toHaveTextContent("已保存的数据未受影响");
    expect(screen.getByRole("alert")).not.toHaveTextContent("无法连接本地服务器");
    expect(screen.getByRole("button", { name: /数字ANSI 数字行/u })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "稍后校准" })).toBeEnabled();
  });
});
