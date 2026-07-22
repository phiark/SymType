/* global process */

import { monitorEventLoopDelay } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({ resolution: 1 });
histogram.enable();

process.on("message", (message) => {
  if (message?.type === "symtype-perf:event-loop-reset") {
    histogram.reset();
    process.send?.({ type: "symtype-perf:event-loop-reset-result", id: message.id });
  }
  if (message?.type === "symtype-perf:event-loop-snapshot") {
    process.send?.({
      type: "symtype-perf:event-loop-snapshot-result",
      id: message.id,
      count: Number(histogram.count),
      minMs: Number(histogram.min) / 1_000_000,
      maxMs: Number(histogram.max) / 1_000_000,
      meanMs: Number(histogram.mean) / 1_000_000,
      p95Ms: Number(histogram.percentile(95)) / 1_000_000,
      p99Ms: Number(histogram.percentile(99)) / 1_000_000
    });
  }
});

process.once("exit", () => histogram.disable());
