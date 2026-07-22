export interface NumericMetric {
  unit: string;
  samples?: number[];
  count?: number;
  median?: number;
  p95?: number;
  p99?: number;
  value?: number;
  supported?: boolean;
  reason?: string;
  method?: string;
}

export interface PageProbeSnapshot {
  audio: {
    contexts: number;
    createdNodes: number;
    endedNodes: number;
    scheduleMs: number[];
  };
  domNodes: number;
  eventTiming: {
    supported: boolean;
    durations: number[];
  };
  handlerMs: number[];
  inputToRafMs: number[];
  listeners: number;
  longTasks: {
    supported: boolean;
    durations: number[];
  };
  timers: number;
  trustedKeydowns: number;
}

export interface BrowserHotPathProbe extends PageProbeSnapshot {
  listenerKeys: Set<string>;
  timerKeys: Set<number>;
}

export interface BrowserListenerProbe {
  nativeAdd: typeof EventTarget.prototype.addEventListener;
  nativeRemove: typeof EventTarget.prototype.removeEventListener;
  nextObjectId: number;
  objectIds: WeakMap<object, number>;
  records: WeakMap<Event, { handlerMs: number }>;
  wrappers: WeakMap<object, Map<string, EventListenerOrEventListenerObject>>;
}

export interface LoadObservation {
  cls: number;
  fcpMs: number | null;
  lcpMs: number | null;
  longTaskSupported: boolean;
  tbtMs: number | null;
  transferBytes: number;
  unexplainedRemoteRequests: string[];
}

declare global {
  interface Window {
    __symtypeLoadProbe?: {
      cls: number;
      largestContentfulPaint: number | null;
      longTasks: number[];
    };
    __symtypePerfProbe?: BrowserHotPathProbe;
    __symtypeListenerProbe?: BrowserListenerProbe;
  }
}
