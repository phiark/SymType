/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { SYMMETRIC_LAYOUT } from "@symtype/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KeyboardHeatmap } from "./KeyboardHeatmap";

afterEach(cleanup);

describe("KeyboardHeatmap accessibility", () => {
  it("provides a keyboard-navigable table and a non-color summary", () => {
    render(
      <KeyboardHeatmap
        layout={SYMMETRIC_LAYOUT}
        features={[
          {
            feature_type: "key",
            feature_value: "c",
            sample_count: 20,
            accuracy: 0.9,
            short_iki_ms: 420
          },
          {
            feature_type: "key",
            feature_value: "x",
            sample_count: 5,
            accuracy: 1,
            short_iki_ms: 380
          }
        ]}
      />
    );

    const table = screen.getByRole("table", { name: "逐键准确率和样本量" });
    expect(table).toHaveAttribute("tabindex", "0");
    expect(table).toHaveAccessibleDescription(
      "覆盖 2 个字符、共 25 个样本。当前最低准确率为 c，90%。"
    );
    expect(screen.getByRole("cell", { name: "c，准确率 90%，20 个样本" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "v，样本不足" })).toBeVisible();
  });
});
