import type { BrowserHotPathProbe, BrowserListenerProbe } from "./types";

function probe(): BrowserHotPathProbe {
  const value = window.__symtypePerfProbe;
  if (!value) throw new Error("The browser hot-path probe is not initialized");
  return value;
}

function initializeProbe(): void {
  const supports = (type: string) =>
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes(type);
  window.__symtypePerfProbe = {
    audio: { contexts: 0, createdNodes: 0, endedNodes: 0, scheduleMs: [] },
    domNodes: 0,
    eventTiming: { supported: supports("event"), durations: [] },
    handlerMs: [],
    inputToRafMs: [],
    listeners: 0,
    listenerKeys: new Set(),
    longTasks: { supported: supports("longtask"), durations: [] },
    timers: 0,
    timerKeys: new Set(),
    trustedKeydowns: 0
  };
}

function listenerProbe(): BrowserListenerProbe {
  const value = window.__symtypeListenerProbe;
  if (!value) throw new Error("The browser listener probe is not initialized");
  return value;
}

function initializeListenerProbe(): void {
  // The saved native methods are invoked with an explicit EventTarget.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeAdd = EventTarget.prototype.addEventListener;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeRemove = EventTarget.prototype.removeEventListener;
  window.__symtypeListenerProbe = {
    nativeAdd,
    nativeRemove,
    nextObjectId: 1,
    objectIds: new WeakMap(),
    records: new WeakMap(),
    wrappers: new WeakMap()
  };
}

function listenerObjectId(value: object): number {
  const runtime = listenerProbe();
  let id = runtime.objectIds.get(value);
  if (id == null) {
    id = runtime.nextObjectId++;
    runtime.objectIds.set(value, id);
  }
  return id;
}

function listenerKey(
  target: object,
  type: string,
  listener: object,
  options?: boolean | AddEventListenerOptions
): string {
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  return `${listenerObjectId(target)}:${type}:${listenerObjectId(listener)}:${Number(capture)}`;
}

function installAddListenerProbe(): void {
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const runtime = listenerProbe();
    if (!listener) return runtime.nativeAdd.call(this, type, listener, options);
    const identity = listener as object;
    const key = listenerKey(this, type, identity, options);
    let wrapperMap = runtime.wrappers.get(identity);
    wrapperMap ??= new Map();
    runtime.wrappers.set(identity, wrapperMap);
    let wrapped = wrapperMap.get(key);
    if (!wrapped) {
      wrapped = function (this: EventTarget, event: Event) {
        const startedAt = performance.now();
        try {
          if (typeof listener === "function") return listener.call(this, event);
          return listener.handleEvent(event);
        } finally {
          const record = listenerProbe().records.get(event);
          if (record) record.handlerMs += performance.now() - startedAt;
        }
      };
      wrapperMap.set(key, wrapped);
      probe().listenerKeys.add(key);
      probe().listeners = probe().listenerKeys.size;
    }
    return runtime.nativeAdd.call(this, type, wrapped, options);
  };
}

function installRemoveListenerProbe(): void {
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const runtime = listenerProbe();
    if (!listener) return runtime.nativeRemove.call(this, type, listener, options);
    const identity = listener as object;
    const key = listenerKey(this, type, identity, options);
    const wrapped = runtime.wrappers.get(identity)?.get(key) ?? listener;
    runtime.wrappers.get(identity)?.delete(key);
    probe().listenerKeys.delete(key);
    probe().listeners = probe().listenerKeys.size;
    return runtime.nativeRemove.call(this, type, wrapped, options);
  };
}

function installInputProbe(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) return;
      probe().trustedKeydowns += 1;
      const record = { handlerMs: 0 };
      listenerProbe().records.set(event, record);
      requestAnimationFrame((timestamp) => {
        probe().handlerMs.push(record.handlerMs);
        probe().inputToRafMs.push(Math.max(0, timestamp - event.timeStamp));
      });
    },
    true
  );
}

function installTimeoutProbe(): void {
  const state = probe();
  const nativeSet = window.setTimeout.bind(window);
  const nativeClear = window.clearTimeout.bind(window);
  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    value: (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      let timer = 0;
      const invoked = (...callbackArgs: unknown[]) => {
        state.timerKeys.delete(timer);
        state.timers = state.timerKeys.size;
        if (typeof callback === "function") {
          const callable = callback as (...values: unknown[]) => void;
          callable(...callbackArgs);
        }
      };
      timer = nativeSet(invoked, delay, ...args);
      state.timerKeys.add(timer);
      state.timers = state.timerKeys.size;
      return timer;
    }
  });
  Object.defineProperty(window, "clearTimeout", {
    configurable: true,
    value: (timer: number) => {
      state.timerKeys.delete(timer);
      state.timers = state.timerKeys.size;
      nativeClear(timer);
    }
  });
}

function installIntervalProbe(): void {
  const state = probe();
  const nativeSet = window.setInterval.bind(window);
  const nativeClear = window.clearInterval.bind(window);
  Object.defineProperty(window, "setInterval", {
    configurable: true,
    value: (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      const timer = nativeSet(callback, delay, ...args);
      state.timerKeys.add(timer);
      state.timers = state.timerKeys.size;
      return timer;
    }
  });
  Object.defineProperty(window, "clearInterval", {
    configurable: true,
    value: (timer: number) => {
      state.timerKeys.delete(timer);
      state.timers = state.timerKeys.size;
      nativeClear(timer);
    }
  });
}

function installAudioProbe(): void {
  const state = probe();
  const NativeAudioContext = window.AudioContext;
  if (!NativeAudioContext) return;
  let keyId = 0;
  let lastScheduledKeyId = -1;
  let lastKeyStartedAt = 0;
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) return;
      keyId += 1;
      lastKeyStartedAt = performance.now();
    },
    true
  );
  class MeasuredAudioContext extends NativeAudioContext {
    constructor(options?: AudioContextOptions) {
      super(options);
      state.audio.contexts += 1;
    }
    override createOscillator(): OscillatorNode {
      const oscillator = super.createOscillator();
      state.audio.createdNodes += 1;
      oscillator.onended = () => {
        state.audio.endedNodes += 1;
      };
      const nativeStart = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => {
        if (lastScheduledKeyId !== keyId && lastKeyStartedAt > 0) {
          lastScheduledKeyId = keyId;
          state.audio.scheduleMs.push(performance.now() - lastKeyStartedAt);
        }
        nativeStart(when);
      };
      return oscillator;
    }
  }
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: MeasuredAudioContext
  });
}

function installTimelineProbe(): void {
  const state = probe();
  if (typeof PerformanceObserver === "undefined") return;
  if (state.longTasks.supported) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.durations.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  }
  if (state.eventTiming.supported) {
    const options = { type: "event", buffered: true, durationThreshold: 16 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "keydown") state.eventTiming.durations.push(entry.duration);
      }
    }).observe(options);
  }
}

export function hotPathProbeSource(): string {
  const declarations = [
    probe,
    initializeProbe,
    listenerProbe,
    initializeListenerProbe,
    listenerObjectId,
    listenerKey,
    installAddListenerProbe,
    installRemoveListenerProbe,
    installInputProbe,
    installTimeoutProbe,
    installIntervalProbe,
    installAudioProbe,
    installTimelineProbe
  ].map((value) => value.toString());
  return `${declarations.join("\n")}\ninitializeProbe();\ninitializeListenerProbe();\ninstallAddListenerProbe();\ninstallRemoveListenerProbe();\ninstallInputProbe();\ninstallTimeoutProbe();\ninstallIntervalProbe();\ninstallAudioProbe();\ninstallTimelineProbe();`;
}
