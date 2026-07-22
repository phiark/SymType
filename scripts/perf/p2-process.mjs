/* global AbortSignal, URL, fetch, process */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export const projectRoot = resolve(import.meta.dirname, "../..");
export const builtServerEntry = join(projectRoot, "apps/server/dist/index.js");
export const builtWebDirectory = join(projectRoot, "apps/web/dist");
const eventLoopPreload = join(projectRoot, "scripts/perf/p2-event-loop-preload.mjs");

const TRIAL_PREFIX = "symtype-perf-p2-";

export function assertProductionBuild(options = {}) {
  const required = [builtServerEntry];
  if (options.web !== false) required.push(join(builtWebDirectory, "index.html"));
  const missing = required.filter((path) => !existsSync(path) || statSync(path).size === 0);
  if (missing.length > 0) {
    throw new Error(`Missing production output: ${missing.join(", ")}. Run npm run build first.`);
  }
}

export function assertSupportedPerformanceRuntime() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (!((major === 22 && minor >= 12) || major === 24)) {
    throw new Error(
      `Performance release evidence requires supported Node 22 or 24; found ${process.version}.`
    );
  }
}

export function createTrialDataDirectory(label) {
  const safeLabel = label.replaceAll(/[^a-z0-9-]/giu, "-").slice(0, 40);
  const parent = process.env.SYMTYPE_PERF_TEMP_ROOT
    ? resolve(process.env.SYMTYPE_PERF_TEMP_ROOT)
    : tmpdir();
  mkdirSync(parent, { recursive: true });
  const trialRoot = mkdtempSync(join(parent, `${TRIAL_PREFIX}${safeLabel}-`));
  const dataDir = join(trialRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  return { trialRoot, dataDir };
}

export function copyFixtureDatabase(source, dataDir) {
  if (!source) return null;
  const absoluteSource = resolve(source);
  if (!existsSync(absoluteSource) || statSync(absoluteSource).size === 0) {
    throw new Error(`Fixture database is missing or empty: ${absoluteSource}`);
  }
  mkdirSync(dataDir, { recursive: true });
  const destination = join(dataDir, "symtype.sqlite3");
  copyFileSync(absoluteSource, destination);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${absoluteSource}${suffix}`)) {
      copyFileSync(`${absoluteSource}${suffix}`, `${destination}${suffix}`);
    }
  }
  return destination;
}

export function removeTrialDirectory(trialRoot) {
  const absolute = resolve(trialRoot);
  if (!absolute.startsWith(resolve(tmpdir())) && !absolute.includes(TRIAL_PREFIX)) {
    throw new Error(`Refusing to remove a directory outside the scoped P2 area: ${absolute}`);
  }
  if (!absolute.includes(TRIAL_PREFIX)) {
    throw new Error(`Refusing to remove a directory without the P2 prefix: ${absolute}`);
  }
  rmSync(absolute, { recursive: true, force: true });
}

export async function selectLoopbackPort() {
  return await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? rejectPromise(error) : resolvePromise(port)));
    });
  });
}

function boundedAppend(current, chunk) {
  const next = `${current}${chunk.toString()}`;
  return next.length > 200_000 ? next.slice(-200_000) : next;
}

export function spawnOwnedProcess(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    stdio: options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout = boundedAppend(output.stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr = boundedAppend(output.stderr, chunk);
  });
  return { child, output };
}

export async function waitForHealthyServer(dataDir, child, startedAt, timeoutMs = 30_000) {
  const infoPath = join(dataDir, "server-info.json");
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Owned process exited before health readiness with code ${child.exitCode}.`);
    }
    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8"));
        const url = new URL(info.url);
        const response = await fetch(new URL("/api/v1/health", url), {
          cache: "no-store",
          signal: AbortSignal.timeout(1_000)
        });
        const health = await response.json();
        if (response.ok && health?.ok === true && health?.integrity?.ok === true) {
          return { info, health, url: url.toString(), readyMs: performance.now() - startedAt };
        }
      } catch {
        // The server-info file and listener can become visible in separate scheduler turns.
      }
    }
    await delay(20);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs} ms.`);
}

export async function startProductionServer(options) {
  assertProductionBuild({ web: options.web !== false });
  const port = options.port ?? (await selectLoopbackPort());
  const startedAt = performance.now();
  const serverArguments = options.instrumentEventLoop
    ? ["--import", eventLoopPreload, builtServerEntry]
    : [builtServerEntry];
  const owned = spawnOwnedProcess(process.execPath, serverArguments, {
    ipc: options.instrumentEventLoop === true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SYMTYPE_DATA_DIR: options.dataDir,
      SYMTYPE_HOST: "127.0.0.1",
      SYMTYPE_PORT: String(port),
      SYMTYPE_LOG_LEVEL: "silent",
      ...(options.env ?? {})
    }
  });
  try {
    const readiness = await waitForHealthyServer(
      options.dataDir,
      owned.child,
      startedAt,
      options.timeoutMs
    );
    return { ...owned, ...readiness, port };
  } catch (error) {
    await stopOwnedProcess(owned.child);
    throw new Error(`${error.message}\n${owned.output.stdout}\n${owned.output.stderr}`);
  }
}

export async function stopOwnedProcess(child, timeoutMs = 5_000) {
  const startedAt = performance.now();
  if (child.exitCode !== null || child.signalCode) {
    return { graceful: true, code: child.exitCode, signal: child.signalCode, shutdownMs: 0 };
  }
  const exit = new Promise((resolvePromise) =>
    child.once("exit", (code, signal) => resolvePromise({ code, signal, timedOut: false }))
  );
  child.kill("SIGTERM");
  const result = await Promise.race([
    exit,
    delay(timeoutMs).then(() => ({ code: null, signal: null, timedOut: true }))
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    await exit;
  }
  return {
    graceful: !result.timedOut,
    code: result.code,
    signal: result.signal,
    shutdownMs: performance.now() - startedAt
  };
}

export function supportedRuntimeEnvironment(extra = {}) {
  return {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
    SYMTYPE_OPEN_BROWSER: "0",
    ...extra
  };
}
