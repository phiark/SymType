/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
});
