/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testBootstrap } from "./test/fixtures";
import { SoundEngine } from "./audio";
import type { AppSettings } from "./types";

class FakeAudioParam {
  public value = 0;
  public readonly setValueAtTime = vi.fn();
  public readonly exponentialRampToValueAtTime = vi.fn();
}

class FakeAudioNode {
  public readonly connect = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  public readonly gain = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  public type: OscillatorType = "sine";
  public readonly frequency = new FakeAudioParam();
  public readonly start = vi.fn();
  public readonly stop = vi.fn();
}

class FakeAudioContext {
  public static instances: FakeAudioContext[] = [];
  public state: AudioContextState = "suspended";
  public readonly destination = new FakeAudioNode();
  public readonly currentTime = 1;
  public readonly gains: FakeGainNode[] = [];
  public readonly oscillators: FakeOscillatorNode[] = [];
  public readonly resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });

  public constructor() {
    FakeAudioContext.instances.push(this);
  }

  public createGain(): GainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  public createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...testBootstrap.settings, soundEnabled: true, soundMode: "all", ...overrides };
}

describe("SoundEngine", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("unlocks one reusable context and synthesizes every local cue", async () => {
    const engine = new SoundEngine();
    engine.configure(settings({ soundTheme: "terminal", volume: 0.35 }));

    await expect(engine.unlock()).resolves.toBe(true);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(1);

    for (const cue of [
      "key",
      "space",
      "error",
      "milestone",
      "complete",
      "alarm",
      "success"
    ] as const) {
      engine.play(cue);
    }

    const context = FakeAudioContext.instances[0];
    expect(context?.oscillators).toHaveLength(7);
    expect(context?.gains).toHaveLength(8);
    expect(context?.gains[0]?.gain.value).toBe(0.35);
    expect(
      context?.oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)
    ).toBe(true);
    expect(
      context?.oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 1)
    ).toBe(true);
  });

  it("honors key-only and error-only filters without allocating filtered cues", async () => {
    const keysEngine = new SoundEngine();
    keysEngine.configure(settings({ soundMode: "keys" }));
    await keysEngine.unlock();
    for (const cue of [
      "key",
      "space",
      "error",
      "milestone",
      "complete",
      "alarm",
      "success"
    ] as const) {
      keysEngine.play(cue);
    }
    expect(FakeAudioContext.instances[0]?.oscillators).toHaveLength(2);

    const errorsEngine = new SoundEngine();
    errorsEngine.configure(settings({ soundMode: "errors" }));
    await errorsEngine.unlock();
    for (const cue of [
      "key",
      "space",
      "error",
      "milestone",
      "complete",
      "alarm",
      "success"
    ] as const) {
      errorsEngine.play(cue);
    }
    expect(FakeAudioContext.instances[1]?.oscillators).toHaveLength(2);
  });

  it("does not allocate audio when disabled and reports gesture unlock failure nonblockingly", async () => {
    const disabled = new SoundEngine();
    disabled.configure(settings({ soundEnabled: false }));
    await expect(disabled.unlock()).resolves.toBe(true);
    disabled.play("key");
    expect(FakeAudioContext.instances).toHaveLength(0);

    class DeniedAudioContext extends FakeAudioContext {
      public override readonly resume = vi.fn(() => Promise.reject(new Error("gesture denied")));
    }
    vi.stubGlobal("AudioContext", DeniedAudioContext);
    const denied = new SoundEngine();
    denied.configure(settings());
    await expect(denied.unlock()).resolves.toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});
