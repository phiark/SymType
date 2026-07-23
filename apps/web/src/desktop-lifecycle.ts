export type DesktopLifecycleResult = "ready" | "cancelled" | "failed";

export interface DesktopLifecycleBridge {
  prepareToHide: () => Promise<DesktopLifecycleResult>;
  requestQuit: () => Promise<DesktopLifecycleResult>;
}

export interface DesktopLifecycleHandler {
  prepareToHide: () => DesktopLifecycleResult | Promise<DesktopLifecycleResult>;
  requestQuit: () => DesktopLifecycleResult | Promise<DesktopLifecycleResult>;
}

declare global {
  interface Window {
    symtypeDesktop: DesktopLifecycleBridge;
  }
}

const RESULTS = new Set<DesktopLifecycleResult>(["ready", "cancelled", "failed"]);
let activeRegistration: { handler: DesktopLifecycleHandler } | undefined;

async function invoke(operation: keyof DesktopLifecycleHandler): Promise<DesktopLifecycleResult> {
  const handler = activeRegistration?.handler;
  if (!handler) return "ready";
  try {
    const result = await handler[operation]();
    return RESULTS.has(result) ? result : "failed";
  } catch {
    return "failed";
  }
}

const bridge: DesktopLifecycleBridge = Object.freeze({
  prepareToHide: () => invoke("prepareToHide"),
  requestQuit: () => invoke("requestQuit")
});

export function installDesktopLifecycleBridge(target: Window = window): DesktopLifecycleBridge {
  target.symtypeDesktop = bridge;
  return bridge;
}

export function registerDesktopLifecycleHandler(handler: DesktopLifecycleHandler): () => void {
  const registration = { handler };
  activeRegistration = registration;
  return () => {
    if (activeRegistration === registration) activeRegistration = undefined;
  };
}
