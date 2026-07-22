import type { AppSettings } from "./types";

type SoundName = "key" | "space" | "error" | "milestone" | "complete" | "alarm" | "success";

const profiles: Record<
  AppSettings["soundTheme"],
  Record<SoundName, { frequency: number; duration: number; gain: number; wave: OscillatorType }>
> = {
  soft: {
    key: { frequency: 520, duration: 0.025, gain: 0.06, wave: "sine" },
    space: { frequency: 360, duration: 0.035, gain: 0.065, wave: "sine" },
    error: { frequency: 155, duration: 0.085, gain: 0.11, wave: "triangle" },
    milestone: { frequency: 760, duration: 0.11, gain: 0.09, wave: "sine" },
    complete: { frequency: 880, duration: 0.22, gain: 0.09, wave: "sine" },
    alarm: { frequency: 210, duration: 0.16, gain: 0.11, wave: "sawtooth" },
    success: { frequency: 980, duration: 0.25, gain: 0.1, wave: "triangle" }
  },
  mechanical: {
    key: { frequency: 820, duration: 0.018, gain: 0.075, wave: "square" },
    space: { frequency: 430, duration: 0.032, gain: 0.08, wave: "square" },
    error: { frequency: 120, duration: 0.1, gain: 0.12, wave: "sawtooth" },
    milestone: { frequency: 920, duration: 0.1, gain: 0.1, wave: "square" },
    complete: { frequency: 1040, duration: 0.2, gain: 0.1, wave: "triangle" },
    alarm: { frequency: 170, duration: 0.18, gain: 0.13, wave: "sawtooth" },
    success: { frequency: 1160, duration: 0.24, gain: 0.11, wave: "square" }
  },
  terminal: {
    key: { frequency: 640, duration: 0.022, gain: 0.06, wave: "square" },
    space: { frequency: 480, duration: 0.03, gain: 0.065, wave: "square" },
    error: { frequency: 190, duration: 0.09, gain: 0.11, wave: "square" },
    milestone: { frequency: 960, duration: 0.08, gain: 0.09, wave: "square" },
    complete: { frequency: 1120, duration: 0.2, gain: 0.09, wave: "square" },
    alarm: { frequency: 230, duration: 0.15, gain: 0.12, wave: "square" },
    success: { frequency: 1280, duration: 0.22, gain: 0.1, wave: "square" }
  }
};

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: AppSettings | null = null;

  configure(settings: AppSettings): void {
    this.settings = settings;
    if (this.master) this.master.gain.value = settings.volume;
  }

  async unlock(): Promise<boolean> {
    if (!this.settings?.soundEnabled) return true;
    try {
      this.context ??= new AudioContext({ latencyHint: "interactive" });
      this.master ??= this.context.createGain();
      this.master.gain.value = this.settings.volume;
      this.master.connect(this.context.destination);
      if (this.context.state !== "running") await this.context.resume();
      return this.context.state === "running";
    } catch {
      return false;
    }
  }

  play(name: SoundName): void {
    const settings = this.settings;
    const context = this.context;
    const master = this.master;
    if (!settings?.soundEnabled || !context || !master || context.state !== "running") return;
    if (settings.soundMode === "errors" && name !== "error" && name !== "alarm") return;
    if (settings.soundMode === "keys" && !["key", "space"].includes(name)) return;
    const tone = profiles[settings.soundTheme][name];
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(tone.gain, start + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.005);
  }
}

export const soundEngine = new SoundEngine();
