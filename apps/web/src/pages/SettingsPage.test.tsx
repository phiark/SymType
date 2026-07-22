/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { runtimeDefaultAdvancedWeights, runtimeSettingsLimits } from "@symtype/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { testBootstrap } from "../test/fixtures";
import type { BootstrapData } from "../types";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bootstrap: BootstrapData = {
  ...testBootstrap,
  settings: {
    ...testBootstrap.settings,
    activeLayoutId: "custom-layout",
    advancedWeights: runtimeDefaultAdvancedWeights
  },
  layouts: [
    {
      id: "custom-layout",
      name: "可编辑映射",
      preset: "custom",
      is_active: 1,
      mappings: [
        {
          physical_code: "KeyC",
          unshifted: "c",
          shifted: "C",
          hand: "left",
          finger: "left-index",
          keyboard_row: "bottom",
          zone: "index",
          key_width: 1
        }
      ]
    }
  ]
};

function renderSettings(
  options: {
    bootstrap?: BootstrapData;
    backups?: Promise<unknown>;
  } = {}
) {
  vi.spyOn(api, "get").mockImplementation(
    () => options.backups ?? Promise.resolve({ backups: [] })
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route element={<Outlet context={{ bootstrap: options.bootstrap ?? bootstrap }} />}>
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsPage accessibility", () => {
  it("gives repeated controls stable accessible names", async () => {
    renderSettings();

    expect(await screen.findByRole("combobox", { name: "主题" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "训练字号" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Backspace 行为" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "音色" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "每日训练目标" })).toBeVisible();
    fireEvent.click(screen.getByText("高级权重"));
    expect(screen.getByRole("slider", { name: "算法权重 accuracy" })).toBeVisible();
    expect(screen.getByLabelText("KeyC 的建议手")).toHaveTextContent("左手");
    expect(screen.getByRole("combobox", { name: "KeyC 的建议手指" })).toBeVisible();
    expect(screen.getByLabelText("KeyC 的训练区域")).toHaveTextContent("left-index");
  });

  it("derives hand and zone from an edited finger before saving the complete mapping", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ ok: true });
    renderSettings();

    const finger = await screen.findByRole("combobox", { name: "KeyC 的建议手指" });
    fireEvent.change(finger, { target: { value: "right-index" } });

    expect(screen.getByLabelText("KeyC 的建议手")).toHaveTextContent("右手");
    expect(screen.getByLabelText("KeyC 的训练区域")).toHaveTextContent("right-index");
    fireEvent.click(screen.getByRole("button", { name: "保存逐键映射" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/v1/layouts/custom-layout/mappings", {
        mappings: [
          expect.objectContaining({
            code: "KeyC",
            hand: "right",
            finger: "right-index",
            zone: "right-index"
          })
        ]
      })
    );
  });

  it("announces and recovers from a search with no matching settings", async () => {
    renderSettings();
    const search = await screen.findByRole("searchbox", { name: "搜索设置" });

    fireEvent.change(search, { target: { value: "不存在的设置关键词" } });

    expect(screen.getByText("找到 0 个设置分组。")).toHaveClass("sr-only");
    expect(screen.getByText("没有匹配的设置")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByRole("heading", { name: "外观与辅助" })).toBeVisible();
  });

  it("renders every fixed advanced weight and the full shared legal ranges", async () => {
    const restored: BootstrapData = {
      ...bootstrap,
      settings: {
        ...bootstrap.settings,
        defaultDurationMinutes: runtimeSettingsLimits.defaultDurationMinutes.max,
        targetWpm: runtimeSettingsLimits.targetWpm.max,
        minimumAccuracy: runtimeSettingsLimits.accuracy.min,
        progressionAccuracy: runtimeSettingsLimits.accuracy.max,
        advancedWeights: {
          ...runtimeDefaultAdvancedWeights,
          recovery: runtimeSettingsLimits.advancedWeight.max
        }
      },
      goal: {
        daily_minutes: runtimeSettingsLimits.dailyMinutes.max,
        target_wpm: runtimeSettingsLimits.targetWpm.max,
        minimum_accuracy: runtimeSettingsLimits.accuracy.min
      }
    };
    renderSettings({ bootstrap: restored });

    const duration = await screen.findByRole("slider", { name: "默认训练时长" });
    expect(duration).toHaveAttribute(
      "min",
      String(runtimeSettingsLimits.defaultDurationMinutes.min)
    );
    expect(duration).toHaveAttribute(
      "max",
      String(runtimeSettingsLimits.defaultDurationMinutes.max)
    );
    expect(duration).toHaveValue(String(runtimeSettingsLimits.defaultDurationMinutes.max));

    expect(screen.getByRole("slider", { name: "每日训练目标" })).toHaveValue(
      String(runtimeSettingsLimits.dailyMinutes.max)
    );
    expect(screen.getByRole("slider", { name: "目标速度" })).toHaveValue(
      String(runtimeSettingsLimits.targetWpm.max)
    );
    expect(screen.getByRole("slider", { name: "最低准确率" })).toHaveValue(
      String(runtimeSettingsLimits.accuracy.min)
    );
    expect(screen.getByRole("slider", { name: "提高难度准确率阈值" })).toHaveValue(
      String(runtimeSettingsLimits.accuracy.max)
    );

    fireEvent.click(screen.getByText("高级权重"));
    const advancedSliders = screen.getAllByRole("slider", { name: /算法权重/u });
    expect(advancedSliders).toHaveLength(6);
    for (const slider of advancedSliders) {
      expect(slider).toHaveAttribute("min", String(runtimeSettingsLimits.advancedWeight.min));
      expect(slider).toHaveAttribute("max", String(runtimeSettingsLimits.advancedWeight.max));
    }
    expect(screen.getByRole("slider", { name: "算法权重 recovery" })).toHaveValue(
      String(runtimeSettingsLimits.advancedWeight.max)
    );
  });

  it("restores every advanced weight default and persists the reset", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ settings: bootstrap.settings });
    renderSettings({
      bootstrap: {
        ...bootstrap,
        settings: {
          ...bootstrap.settings,
          advancedWeights: Object.fromEntries(
            Object.keys(runtimeDefaultAdvancedWeights).map((key) => [key, 1.75])
          ) as BootstrapData["settings"]["advancedWeights"]
        }
      }
    });

    fireEvent.click(await screen.findByText("高级权重"));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认权重" }));
    for (const [key, value] of Object.entries(runtimeDefaultAdvancedWeights)) {
      expect(screen.getByRole("slider", { name: `算法权重 ${key}` })).toHaveValue(String(value));
    }
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[0]).toBe("/api/v1/preferences");
    expect(put.mock.calls[0]?.[1]).toMatchObject({
      settings: { advancedWeights: runtimeDefaultAdvancedWeights }
    });
  });

  it("keeps edits made during a save dirty and includes them in the next save", async () => {
    let resolveFirst: ((value: { settings: BootstrapData["settings"] }) => void) | undefined;
    const firstSave = new Promise<{ settings: BootstrapData["settings"] }>((resolve) => {
      resolveFirst = resolve;
    });
    const put = vi
      .spyOn(api, "put")
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue({ settings: bootstrap.settings });
    renderSettings();

    fireEvent.change(await screen.findByRole("combobox", { name: "主题" }), {
      target: { value: "dark" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));

    const duration = screen.getByRole("slider", { name: "默认训练时长" });
    fireEvent.change(duration, {
      target: { value: String(runtimeSettingsLimits.defaultDurationMinutes.max) }
    });
    expect(duration).toHaveValue(String(runtimeSettingsLimits.defaultDurationMinutes.max));

    resolveFirst?.({ settings: bootstrap.settings });
    expect(
      await screen.findByRole("button", {
        name: "关闭通知：本次保存已完成；保存期间的新更改仍未保存。"
      })
    ).toBeVisible();
    const secondSave = screen.getByRole("button", { name: "保存更改" });
    expect(secondSave).toBeEnabled();
    fireEvent.click(secondSave);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1]?.[1]).toMatchObject({
      settings: { defaultDurationMinutes: runtimeSettingsLimits.defaultDurationMinutes.max }
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled());
  });

  it("keeps settings usable and exposes an alert when the backup list fails", async () => {
    renderSettings({ backups: Promise.reject(new Error("快照目录暂不可读")) });

    expect(await screen.findByRole("combobox", { name: "主题" })).toBeVisible();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法读取最近快照：快照目录暂不可读");
    expect(screen.getByRole("button", { name: "重试读取" })).toBeVisible();
  });

  it("announces a failed settings save with alert semantics", async () => {
    vi.spyOn(api, "put").mockRejectedValue(new Error("SQLite 暂时繁忙"));
    renderSettings();

    fireEvent.change(await screen.findByRole("combobox", { name: "主题" }), {
      target: { value: "dark" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SQLite 暂时繁忙");
    expect(screen.getByRole("button", { name: "保存更改" })).toBeEnabled();
  });
});
