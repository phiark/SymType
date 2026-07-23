import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { getBindingForCharacter, SYMMETRIC_PRESET } from "@symtype/shared";

export interface AudioProbe {
  constructed: number;
  resumed: number;
  played: Array<{ frequency: number; wave: OscillatorType }>;
}

export async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: AudioProbe = { constructed: 0, resumed: 0, played: [] };
    Object.defineProperty(window, "__symtypeAudioProbe", { configurable: true, value: probe });

    class FakeAudioParam {
      value = 0;
      setValueAtTime(value: number) {
        this.value = value;
        return this;
      }
      exponentialRampToValueAtTime(value: number) {
        this.value = value;
        return this;
      }
    }
    class FakeAudioNode {
      connect() {
        return this;
      }
    }
    class FakeGainNode extends FakeAudioNode {
      gain = new FakeAudioParam();
    }
    class FakeOscillatorNode extends FakeAudioNode {
      type: OscillatorType = "sine";
      frequency = new FakeAudioParam();
      start() {
        probe.played.push({ frequency: this.frequency.value, wave: this.type });
      }
      stop() {}
    }
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      currentTime = 0;
      destination = new FakeAudioNode();
      constructor() {
        probe.constructed += 1;
      }
      createGain() {
        return new FakeGainNode();
      }
      createOscillator() {
        return new FakeOscillatorNode();
      }
      resume() {
        probe.resumed += 1;
        this.state = "running";
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext
    });
  });
}

export async function audioProbe(page: Page): Promise<AudioProbe> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __symtypeAudioProbe: AudioProbe;
        }
      ).__symtypeAudioProbe
  );
}

export async function bootstrap(request: APIRequestContext) {
  const response = await request.get("/api/v1/bootstrap");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    csrfToken: string;
    settings: Record<string, unknown>;
    dataLocation: string;
  };
}

export async function mutate<T>(
  request: APIRequestContext,
  method: "post" | "patch" | "put",
  path: string,
  data: unknown
): Promise<T> {
  const boot = await bootstrap(request);
  const response = await request[method](path, {
    data,
    headers: { "X-SymType-CSRF": boot.csrfToken }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

export async function resetOnboarding(request: APIRequestContext): Promise<void> {
  await mutate(request, "patch", "/api/v1/settings", {
    onboardingComplete: false,
    calibrationComplete: false,
    stopOnError: false,
    soundEnabled: true,
    keyboardVisible: true,
    theme: "system",
    reducedMotion: false
  });
}

const progressTables = [
  "sessions",
  "lessons",
  "micro_blocks",
  "event_batches",
  "keystroke_events",
  "feature_stats",
  "daily_summaries",
  "tests",
  "personal_bests",
  "game_runs",
  "game_levels",
  "achievements"
] as const;

/**
 * Restore a real, schema-validated backup with user progress removed. Visual tests use the public
 * backup boundary instead of private reset APIs or mocked statistics, so they remain independent of
 * file order while still rendering the production SQLite path.
 */
export async function restoreFreshE2eState(
  request: APIRequestContext,
  settingsPatch: Record<string, unknown> = {}
): Promise<void> {
  const exportedResponse = await request.get("/api/v1/export/json");
  expect(exportedResponse.ok(), await exportedResponse.text()).toBeTruthy();
  const backup = (await exportedResponse.json()) as {
    data: Record<string, Array<Record<string, unknown>>>;
  };

  for (const table of progressTables) backup.data[table] = [];
  backup.data.streaks = (backup.data.streaks ?? []).map((row) => ({
    ...row,
    current_days: 0,
    longest_days: 0,
    last_completed_date: null
  }));
  backup.data.custom_texts = (backup.data.custom_texts ?? [])
    .filter((row) => row.source_id != null)
    .map((row) => ({ ...row, reading_position: 0 }));
  const defaultLayoutIds = new Set(["symmetric-default", "standard-default"]);
  backup.data.keyboard_layouts = (backup.data.keyboard_layouts ?? [])
    .filter((row) => defaultLayoutIds.has(String(row.id)))
    .map((row) => ({ ...row, is_active: row.id === "symmetric-default" ? 1 : 0 }));
  backup.data.key_mappings = (backup.data.key_mappings ?? []).filter((row) =>
    defaultLayoutIds.has(String(row.layout_id))
  );
  backup.data.settings = (backup.data.settings ?? []).map((row) => {
    const value = JSON.parse(String(row.value_json)) as Record<string, unknown>;
    return {
      ...row,
      value_json: JSON.stringify({
        ...value,
        onboardingComplete: true,
        calibrationComplete: false,
        theme: "light",
        reducedMotion: false,
        keyboardVisible: true,
        activeLayoutId: "symmetric-default",
        ...settingsPatch
      })
    };
  });

  const preview = await mutate<{ ok: boolean }>(request, "post", "/api/v1/import/preview", backup);
  expect(preview.ok).toBe(true);
  const restored = await mutate<{ restored: boolean }>(
    request,
    "post",
    "/api/v1/import/commit",
    backup
  );
  expect(restored.restored).toBe(true);
}

export async function finishOnboarding(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  if (
    await page
      .getByRole("heading", { name: /为 Symmetric 指法建立/ })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: /开始设置/ }).click();
    await page.getByRole("button", { name: /^继续/ }).click();
    await page.getByRole("button", { name: "稍后校准" }).click();
  }
  await expect(
    page.getByRole("heading", { level: 1, name: /\d+月\d+日\s*星期[一二三四五六日]/u })
  ).toBeVisible();
}

async function pressTargetCharacter(page: Page, character: string): Promise<void> {
  if (character === "\n") {
    await page.keyboard.press("Enter");
    return;
  }
  if (character === "\t") {
    await page.keyboard.press("Tab");
    return;
  }
  const binding = getBindingForCharacter(SYMMETRIC_PRESET, character);
  expect(binding, `No ANSI US physical key for ${JSON.stringify(character)}`).toBeDefined();
  if (!binding) return;
  if (binding.shifted) {
    const shift = binding.key.hand === "left" ? "ShiftRight" : "ShiftLeft";
    await page.keyboard.down(shift);
    await page.keyboard.press(binding.key.code);
    await page.keyboard.up(shift);
    return;
  }
  await page.keyboard.press(binding.key.code);
}

async function typeTargetWithClock(
  page: Page,
  target: string,
  beforeKey?: () => Promise<void>
): Promise<void> {
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  await surface.focus();
  for (const character of target) {
    if (beforeKey) await beforeKey();
    await pressTargetCharacter(page, character);
  }
}

export async function typeTarget(page: Page, target: string): Promise<void> {
  await typeTargetWithClock(page, target);
}

function visibleTargetGlyph(character: string): string {
  if (character === " ") return "·";
  if (character === "\n") return "↵\n";
  if (character === "\t") return "⇥";
  return character;
}

export async function typeTargetAtPace(
  page: Page,
  target: string,
  intervalMs = 120
): Promise<void> {
  expect(intervalMs).toBeGreaterThanOrEqual(25);
  const surface = page.getByRole("textbox", { name: "打字练习输入区" });
  const expectedGlyphs = Array.from(target, visibleTargetGlyph);
  // A block response can arrive before React swaps the completed surface for the next block.
  // Wait for both the authoritative target and its initial caret before sending physical keys.
  await expect
    .poll(() =>
      surface.locator(".typing-glyph").evaluateAll((glyphs) => ({
        glyphs: glyphs.map((glyph) => glyph.textContent ?? ""),
        currentIndex: glyphs.findIndex((glyph) => glyph.classList.contains("is-current"))
      }))
    )
    .toEqual({ glyphs: expectedGlyphs, currentIndex: 0 });
  await typeTargetWithClock(page, target, () => page.clock.fastForward(intervalMs));
  // TypingSurface defers its completion callback with setTimeout(0). Observe either the
  // completed target or an already-rendered successor: fast WebKit runs can replace the
  // surface before the assertion starts, while slower runs leave the completed target in
  // place until the fake clock advances.
  await expect
    .poll(async () => {
      const rendered = await surface.locator(".typing-glyph").evaluateAll((glyphs) => ({
        glyphs: glyphs.map((glyph) => glyph.textContent ?? ""),
        currentIndex: glyphs.findIndex((glyph) => glyph.classList.contains("is-current"))
      }));
      const sameTarget =
        rendered.glyphs.length === expectedGlyphs.length &&
        rendered.glyphs.every((glyph, index) => glyph === expectedGlyphs[index]);
      if (!sameTarget) return "advanced";
      return rendered.currentIndex === -1 ? "completed" : `typing:${rendered.currentIndex}`;
    })
    .toMatch(/^(?:advanced|completed)$/u);
  await page.clock.runFor(1);
}

export async function assertNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}
