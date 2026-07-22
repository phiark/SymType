/* global clearTimeout, setTimeout */

let metricRequestId = 0;

export async function resetServerEventLoopMonitor(child) {
  await requestChildMetric(
    child,
    "symtype-perf:event-loop-reset",
    "symtype-perf:event-loop-reset-result"
  );
}

export async function readServerEventLoopMonitor(child) {
  return await requestChildMetric(
    child,
    "symtype-perf:event-loop-snapshot",
    "symtype-perf:event-loop-snapshot-result"
  );
}

async function requestChildMetric(child, type, expectedType, timeoutMs = 5_000) {
  if (!child.connected || typeof child.send !== "function") {
    throw new Error("Server event-loop instrumentation IPC is unavailable.");
  }
  const id = ++metricRequestId;
  return await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`Timed out waiting for ${expectedType}.`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (message?.type !== expectedType || message.id !== id) return;
      cleanup();
      resolvePromise(message);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
    };
    child.on("message", onMessage);
    child.send({ type, id }, (error) => {
      if (!error) return;
      cleanup();
      rejectPromise(error);
    });
  });
}
