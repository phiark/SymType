/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installDesktopLifecycleBridge, type DesktopLifecycleResult } from "../desktop-lifecycle";
import { useDesktopSessionLifecycle } from "./useDesktopSessionLifecycle";

function Harness({
  active,
  critical = false,
  flush,
  pause,
  requestExit,
  onError
}: {
  active: boolean;
  critical?: boolean;
  flush: () => Promise<void>;
  pause: () => void;
  requestExit: () => void;
  onError: (message: string) => void;
}) {
  const { completeDesktopQuitRequest, runDesktopQuitPersistence } = useDesktopSessionLifecycle({
    active,
    isCriticalMutationInFlight: () => critical,
    flush,
    pause,
    requestExitConfirmation: requestExit,
    onError
  });
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void runDesktopQuitPersistence(flush).then(
            () => completeDesktopQuitRequest("ready"),
            () => completeDesktopQuitRequest("failed")
          );
        }}
      >
        保存并退出
      </button>
      <button type="button" onClick={() => completeDesktopQuitRequest("cancelled")}>
        继续训练
      </button>
    </div>
  );
}

beforeEach(() => {
  installDesktopLifecycleBridge();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("desktop session lifecycle bridge", () => {
  it("has a browser-safe ready fallback when no session page owns the lifecycle", async () => {
    await expect(window.symtypeDesktop.prepareToHide()).resolves.toBe("ready");
    await expect(window.symtypeDesktop.requestQuit()).resolves.toBe("ready");
  });

  it("pauses and flushes before a native window hide", async () => {
    const lifecycle: string[] = [];
    render(
      <Harness
        active
        pause={() => lifecycle.push("pause")}
        flush={() => {
          lifecycle.push("flush");
          return Promise.resolve();
        }}
        requestExit={() => lifecycle.push("confirm")}
        onError={vi.fn()}
      />
    );

    await expect(window.symtypeDesktop.prepareToHide()).resolves.toBe("ready");
    expect(lifecycle).toEqual(["pause", "flush"]);
  });

  it("keeps native quit pending until the existing exit confirmation resolves", async () => {
    const requestExit = vi.fn();
    render(
      <Harness
        active
        pause={vi.fn()}
        flush={vi.fn().mockResolvedValue(undefined)}
        requestExit={requestExit}
        onError={vi.fn()}
      />
    );

    let quitResult!: Promise<DesktopLifecycleResult>;
    act(() => {
      quitResult = window.symtypeDesktop.requestQuit();
    });
    expect(requestExit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "继续训练" }));
    await expect(quitResult).resolves.toBe("cancelled");
  });

  it("does not apply the persistence deadline while the user is deciding", async () => {
    vi.useFakeTimers();
    render(
      <Harness
        active
        pause={vi.fn()}
        flush={vi.fn().mockResolvedValue(undefined)}
        requestExit={vi.fn()}
        onError={vi.fn()}
      />
    );

    let settled = false;
    const quitResult = window.symtypeDesktop.requestQuit().finally(() => {
      settled = true;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(settled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "继续训练" }));
    await expect(quitResult).resolves.toBe("cancelled");
  });

  it("fails a native quit when confirmed persistence stops responding", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    render(
      <Harness
        active
        pause={vi.fn()}
        flush={() => new Promise<void>(() => undefined)}
        requestExit={vi.fn()}
        onError={onError}
      />
    );

    const quitResult = window.symtypeDesktop.requestQuit();
    fireEvent.click(screen.getByRole("button", { name: "保存并退出" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await expect(quitResult).resolves.toBe("failed");
    expect(onError).toHaveBeenCalledWith(
      "保存等待超过 10 秒；尚未确认写入的数据仍保留在当前页面。"
    );
  });

  it("reports a failed flush without discarding the page error", async () => {
    const onError = vi.fn();
    render(
      <Harness
        active={false}
        pause={vi.fn()}
        flush={vi.fn().mockRejectedValue(new Error("SQLite 暂时忙碌"))}
        requestExit={vi.fn()}
        onError={onError}
      />
    );

    await expect(window.symtypeDesktop.requestQuit()).resolves.toBe("failed");
    expect(onError).toHaveBeenCalledWith("SQLite 暂时忙碌");
  });

  it("refuses hide and quit while a critical server mutation is in flight", async () => {
    const pause = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const requestExit = vi.fn();
    render(
      <Harness
        active={false}
        critical
        pause={pause}
        flush={flush}
        requestExit={requestExit}
        onError={vi.fn()}
      />
    );

    await expect(window.symtypeDesktop.prepareToHide()).resolves.toBe("failed");
    await expect(window.symtypeDesktop.requestQuit()).resolves.toBe("failed");
    expect(pause).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(requestExit).not.toHaveBeenCalled();
  });
});
