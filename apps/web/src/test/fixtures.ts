import { runtimeDefaultAdvancedWeights } from "@symtype/shared";

import type { AppSettings, BootstrapData } from "../types";

export const testSettings = {
  onboardingComplete: false,
  calibrationComplete: false,
  theme: "system",
  reducedMotion: false,
  keyboardVisible: true,
  keyboardFingerColors: true,
  soundEnabled: false,
  soundTheme: "soft",
  soundMode: "all",
  volume: 0.5,
  activeLayoutId: "symmetric-default",
  stopOnError: false,
  backspaceMode: "enabled",
  fontSize: 32,
  lineHeight: 1.6,
  caretStyle: "bar",
  smoothScroll: true,
  targetWpm: 40,
  minimumAccuracy: 0.94,
  progressionAccuracy: 0.97,
  trainingBias: "balanced",
  defaultDurationMinutes: 10,
  experimentEnabled: false,
  advancedWeights: runtimeDefaultAdvancedWeights
} satisfies AppSettings;

export const testBootstrap = {
  csrfToken: "test-csrf",
  profile: { id: "local-test-profile", display_name: "Local typist" },
  settings: testSettings,
  layouts: [],
  goal: { daily_minutes: 10, target_wpm: 40, minimum_accuracy: 0.94 },
  contentModes: [],
  gameLevels: [],
  algorithmVersion: "test",
  dataLocation: "/tmp/symtype-test.sqlite",
  storageAuthority: "server-sqlite"
} satisfies BootstrapData;
