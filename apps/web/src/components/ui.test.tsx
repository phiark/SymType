/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorState } from "./ui";

afterEach(cleanup);

describe("ErrorState", () => {
  it.each(["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource"])(
    "normalizes browser-specific connection text: %s",
    (message) => {
      render(<ErrorState message={message} />);
      expect(
        screen.getByText("无法连接本机服务。请确认 SymType 仍在运行，然后重试。")
      ).toBeVisible();
    }
  );

  it("preserves a diagnostic server message", () => {
    render(<ErrorState message="数据库完整性检查失败。" />);
    expect(screen.getByText("数据库完整性检查失败。")).toBeVisible();
  });
});
