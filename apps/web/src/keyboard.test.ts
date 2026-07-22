import { describe, expect, it } from "vitest";
import { runtimeDefaultAdvancedWeights } from "@symtype/shared";

import { activeKeyboardLayout, focusCharactersForScopes } from "./keyboard";
import type { BootstrapData } from "./types";

function bootstrapWithMapping(): BootstrapData {
  return {
    csrfToken: "test",
    profile: { id: "profile", display_name: "Local" },
    settings: {
      onboardingComplete: true,
      calibrationComplete: true,
      theme: "system",
      reducedMotion: false,
      keyboardVisible: true,
      keyboardFingerColors: true,
      soundEnabled: false,
      soundTheme: "soft",
      soundMode: "all",
      volume: 0.5,
      activeLayoutId: "custom",
      stopOnError: false,
      backspaceMode: "enabled",
      fontSize: 28,
      lineHeight: 1.5,
      caretStyle: "bar",
      smoothScroll: true,
      targetWpm: 45,
      minimumAccuracy: 0.94,
      progressionAccuracy: 0.975,
      trainingBias: "balanced",
      defaultDurationMinutes: 10,
      experimentEnabled: false,
      advancedWeights: runtimeDefaultAdvancedWeights
    },
    layouts: [
      {
        id: "custom",
        name: "Custom",
        preset: "custom",
        is_active: 1,
        mappings: [
          {
            physical_code: "KeyC",
            unshifted: "c",
            shifted: "C",
            hand: "right",
            finger: "right-index",
            keyboard_row: "bottom",
            zone: "right-index",
            key_width: 1
          }
        ]
      }
    ],
    goal: { daily_minutes: 10, target_wpm: 45, minimum_accuracy: 0.94 },
    contentModes: [],
    gameLevels: [],
    algorithmVersion: "test",
    dataLocation: "/test",
    storageAuthority: "server-sqlite"
  };
}

describe("active keyboard layout", () => {
  it("uses the server-authoritative custom mapping for guidance and event dimensions", () => {
    const layout = activeKeyboardLayout(bootstrapWithMapping());
    expect(layout.find((key) => key.code === "KeyC")).toMatchObject({
      hand: "right",
      finger: "right-index",
      zone: "right-index"
    });
  });

  it("expands visible scope labels into explicit physical-layout characters", () => {
    const layout = activeKeyboardLayout(bootstrapWithMapping());
    const rightIndex = focusCharactersForScopes(["右食指"], layout);
    expect(rightIndex).toContain("c");
    expect(rightIndex).toContain("C");
    expect(focusCharactersForScopes(["数字"], layout).join("")).toBe("1234567890");
    expect(focusCharactersForScopes(["大小写"], layout)).toEqual(
      expect.arrayContaining(["a", "A", "m", "M"])
    );
  });

  it("intersects independent filter dimensions and unions alternatives within one dimension", () => {
    const layout = activeKeyboardLayout(bootstrapWithMapping());

    expect(focusCharactersForScopes(["左手", "数字"], layout).join("")).toBe("12345");
    expect(focusCharactersForScopes(["右手", "数字"], layout).join("")).toBe("67890");
    expect(focusCharactersForScopes(["左手", "食指区", "数字"], layout).join("")).toBe("45");
    expect(focusCharactersForScopes(["左小指", "左无名指", "数字"], layout).join("")).toBe("12");
    expect(focusCharactersForScopes(["左手", "右手", "数字"], layout).join("")).toBe("1234567890");
  });
});
