import { describe, expect, it } from "vitest";

import {
  describeUnsupportedCustomTextCharacter,
  findUnsupportedCustomTextCharacter,
  normalizeCustomTextContent
} from "./custom-text.js";

describe("custom-text ANSI validation", () => {
  it("normalizes Windows and legacy Mac line endings without changing supported content", () => {
    expect(normalizeCustomTextContent("first\r\nsecond\rthird\n\tend")).toBe(
      "first\nsecond\nthird\n\tend"
    );
    expect(
      findUnsupportedCustomTextCharacter("first\nsecond\t`~!@#$%^&*()_+[]{}\\|;:'\",.<>/?")
    ).toBeUndefined();
  });

  it("reports unsupported Unicode by code point at its persisted UTF-16 offset", () => {
    const unsupported = findUnsupportedCustomTextCharacter("ok🙂—");
    expect(unsupported).toEqual({ character: "🙂", offset: 2, codePoint: 0x1f642 });
    if (!unsupported) throw new Error("Expected an unsupported Unicode character");
    expect(describeUnsupportedCustomTextCharacter(unsupported)).toContain("第 3 个字符（U+1F642）");
  });
});
