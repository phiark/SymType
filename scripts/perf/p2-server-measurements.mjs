/* global Buffer */

import { setTimeout as delay } from "node:timers/promises";

import { summarizeSamples } from "./lib/index.js";
import {
  createTrainingSession,
  deterministicBatchUuid,
  eventForTarget,
  nextBlockRequest,
  requestJson,
  timedJsonRequest
} from "./p2-http.mjs";
import { readServerEventLoopMonitor, resetServerEventLoopMonitor } from "./p2-event-loop-ipc.mjs";

async function runTimedRequests(baseUrl, path, requestOptions, count, warmups) {
  for (let index = 0; index < warmups; index += 1) {
    const options = await requestOptions(index, false);
    await requestJson(baseUrl, path(index), options);
  }
  const samples = [];
  const responseBytes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index + warmups;
    const options = await requestOptions(offset, true);
    const result = await timedJsonRequest(baseUrl, path(offset), options);
    samples.push(result.elapsedMs);
    responseBytes.push(Buffer.byteLength(JSON.stringify(result.body)));
  }
  return { latency: summarizeSamples(samples), responseBytes: summarizeSamples(responseBytes) };
}

async function measureReads(baseUrl, options) {
  const scenarios = {};
  const combined = [];
  for (const [name, requestPath] of [
    ["settings", "/api/v1/settings"],
    ["dashboard", "/api/v1/dashboard"],
    ["statisticsAll", "/api/v1/statistics?period=all"]
  ]) {
    const result = await runTimedRequests(
      baseUrl,
      () => requestPath,
      async () => ({}),
      options.samples,
      options.warmups
    );
    scenarios[name] = result;
    combined.push(...result.latency.samples);
  }
  return { metric: summarizeSamples(combined), scenarios };
}

async function measureSettingsSave(baseUrl, csrfToken, options) {
  return await runTimedRequests(
    baseUrl,
    () => "/api/v1/settings",
    async (index) => ({
      method: "PATCH",
      csrfToken,
      body: { volume: index % 2 === 0 ? 0.42 : 0.43 }
    }),
    options.samples,
    options.warmups
  );
}

async function measureNextBlocks(baseUrl, csrfToken, options) {
  const session = await createTrainingSession(baseUrl, csrfToken, 8_101);
  return await runTimedRequests(
    baseUrl,
    () => `/api/v1/lessons/${session.lessonId}/blocks/next`,
    async (index) => ({
      method: "POST",
      csrfToken,
      body: nextBlockRequest(index, 8_200 + index, 60)
    }),
    options.samples,
    options.warmups
  );
}

async function measureEventSaves(baseUrl, csrfToken, mappings, options) {
  const session = await createTrainingSession(baseUrl, csrfToken, 9_101);
  const blockResponse = await requestJson(
    baseUrl,
    `/api/v1/lessons/${session.lessonId}/blocks/next`,
    {
      method: "POST",
      csrfToken,
      body: nextBlockRequest(0, 9_202, 120)
    }
  );
  return await runTimedRequests(
    baseUrl,
    () => `/api/v1/sessions/${session.id}/events`,
    async (index) => ({
      method: "POST",
      csrfToken,
      body: {
        batchId: deterministicBatchUuid(index + 1),
        lessonId: session.lessonId,
        blockId: blockResponse.block.id,
        events: [eventForTarget(blockResponse.block.target_text, index, mappings)]
      }
    }),
    options.samples,
    options.warmups
  );
}

export async function measureServerOperations(server, bootstrap, options) {
  await resetServerEventLoopMonitor(server.child);
  await delay(25);
  const reads = await measureReads(server.url, options);
  const settingsSave = await measureSettingsSave(server.url, bootstrap.csrfToken, options);
  const nextBlock = await measureNextBlocks(server.url, bootstrap.csrfToken, options);
  const eventSave = await measureEventSaves(
    server.url,
    bootstrap.csrfToken,
    bootstrap.activeLayoutMappings,
    options
  );
  await delay(25);
  const eventLoop = await readServerEventLoopMonitor(server.child);
  if (!Number.isFinite(eventLoop.p99Ms) || eventLoop.count < 1) {
    throw new Error("Built server event-loop instrumentation returned no samples.");
  }
  return {
    reads,
    settingsSave,
    nextBlock,
    eventSave,
    commonSave: summarizeSamples([...settingsSave.latency.samples, ...eventSave.latency.samples]),
    eventLoop
  };
}
