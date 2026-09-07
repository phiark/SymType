/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VirtualKeyboard } from "./VirtualKeyboard";

afterEach(cleanup);

describe("VirtualKeyboard symmetric boundary keys", () => {
  it.each([
    ["c", "左食指", "leftIndex"],
    ["b", "左食指", "leftIndex"],
    ["n", "右食指", "rightIndex"],
    ["m", "右食指", "rightIndex"],
    ["4", "左食指", "leftIndex"],
    ["5", "左食指", "leftIndex"],
    ["6", "右食指", "rightIndex"],
    ["7", "右食指", "rightIndex"]
  ])("renders %s with the explicit %s zone", (label, finger, token) => {
    render(<VirtualKeyboard showFingerColors />);

    expect(screen.getByTitle(`${label} · ${finger}`)).toHaveAttribute("data-finger", token);
  });

  it("distinguishes both Shift keys and announces the suggested next finger", () => {
    render(<VirtualKeyboard nextCode="ShiftRight" showFingerColors />);

    expect(screen.getByTitle("Shift · 左小指")).toHaveAttribute("data-finger", "leftPinky");
    const rightShift = screen.getByTitle("Shift · 右小指");
    expect(rightShift).toHaveAttribute("data-finger", "rightPinky");
    expect(rightShift).toHaveAttribute("aria-current", "true");
    expect(rightShift).toHaveTextContent("右小指");
    expect(screen.getByText(/应用不检测真实手指动作/u)).toBeVisible();
  });

  it("retains textual finger guidance when colors are disabled", () => {
    render(<VirtualKeyboard nextCode="KeyC" showFingerColors={false} />);

    const key = screen.getByTitle("c · 左食指");
    expect(key).toHaveAttribute("data-finger", "neutral");
    expect(key).toHaveTextContent("左食指");
  });

  it("derives ANSI row stagger and special-key proportions from shared geometry", () => {
    const { container } = render(<VirtualKeyboard showFingerColors />);
    const keyboard = screen.getByLabelText("ANSI US QWERTY 虚拟键盘");
    const rows = within(keyboard)
      .getAllByRole("generic")
      .filter((element) => element.classList.contains("keyboard-row"));

    expect(rows.map((row) => row.getAttribute("data-row"))).toEqual([
      "number",
      "top",
      "home",
      "bottom",
      "space"
    ]);

    const expectedGridGeometry = [
      ["` · 左小指", "1 / span 8"],
      ["Delete · 右小指", "105 / span 16"],
      ["Tab · 左小指", "1 / span 12"],
      ["q · 左小指", "13 / span 8"],
      ["Caps · 左小指", "1 / span 14"],
      ["a · 左小指", "15 / span 8"],
      ["Return · 右小指", "103 / span 18"],
      ["Shift · 左小指", "1 / span 18"],
      ["z · 左无名指", "19 / span 8"],
      ["Shift · 右小指", "99 / span 22"],
      ["Space · 拇指", "40 / span 50"]
    ] as const;

    for (const [title, gridColumn] of expectedGridGeometry) {
      expect(screen.getByTitle(title)).toHaveStyle({ gridColumn });
    }

    expect(container.querySelectorAll(".keyboard-key")).toHaveLength(54);
    expect(screen.getByTitle("Delete · 右小指")).toHaveAttribute("data-width", "2");
    expect(screen.getByTitle("q · 左小指")).toHaveAttribute("data-column", "1.5");
  });

  it("keeps visible non-color cues for zone boundaries and home keys", () => {
    render(<VirtualKeyboard nextCode="KeyF" showFingerColors />);

    expect(screen.getByTitle("g · 左食指")).not.toHaveAttribute("data-zone-start");
    expect(screen.getByTitle("h · 右食指")).toHaveAttribute("data-zone-start", "true");
    expect(screen.getByTitle("f · 左食指 · 定位键")).toHaveAttribute("data-home-key", "true");
    expect(screen.getByTitle("j · 右食指 · 定位键")).toHaveAttribute("data-home-key", "true");
    expect(screen.getByTitle("f · 左食指 · 定位键")).toHaveTextContent("左食指");
    expect(screen.getByText(/同类手指使用同色，分区边界与文字共同表示/u)).toBeVisible();
  });
});
