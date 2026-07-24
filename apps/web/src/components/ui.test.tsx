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
      render(<ErrorState error={new Error(message)} />);
      expect(screen.getByRole("heading", { name: "SymType 暂时没有回应" })).toBeVisible();
      expect(
        screen.getByText("已保存的数据仍保留在这台电脑。请确认 SymType 正在运行，然后重试。")
      ).toBeVisible();
    }
  );

  it("does not expose an unknown diagnostic message", () => {
    render(<ErrorState error={new Error("数据库完整性检查失败：/private/user-data.sqlite")} />);
    expect(screen.getByRole("heading", { name: "暂时无法读取数据" })).toBeVisible();
    expect(screen.queryByText(/user-data|SQLite|数据库/u)).not.toBeInTheDocument();
  });
});
