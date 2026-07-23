import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, test } from "vitest";

interface ServerInfo {
  pid: number;
  url: string;
  databasePath: string;
}

interface SpawnedProcess {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const cleanupDirectories = new Set<string>();
const children = new Set<ChildProcessWithoutNullStreams>();
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverDirectory, "../..");

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    reservation.once("error", rejectPromise);
    reservation.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No loopback port was allocated");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    reservation.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
  return address.port;
}

function capture(child: ChildProcessWithoutNullStreams): SpawnedProcess {
  children.add(child);
  child.once("exit", () => children.delete(child));
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-80_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, output: () => output };
}

function launchServer(dataDirectory: string, port: number): SpawnedProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(serverDirectory, "src/index.ts")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SYMTYPE_DATA_DIR: dataDirectory,
        SYMTYPE_HOST: "127.0.0.1",
        SYMTYPE_PORT: String(port),
        SYMTYPE_WEB_DIST: join(dataDirectory, "web-not-built")
      },
      stdio: "pipe"
    }
  );
  child.stdin.end();
  return capture(child);
}

function launchLockHolder(dataDirectory: string): SpawnedProcess {
  const lockModuleUrl = pathToFileURL(join(serverDirectory, "src/server-runtime-lock.ts")).href;
  const source = `
    import { ServerRuntimeLock } from ${JSON.stringify(lockModuleUrl)};
    const lock = ServerRuntimeLock.acquire(process.env.SYMTYPE_TEST_DATA_DIR);
    process.stdout.write("LOCK_READY:" + String(process.pid) + "\\n");
    const keepAlive = setInterval(() => undefined, 60_000);
    const shutdown = () => {
      clearInterval(keepAlive);
      lock.release();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SYMTYPE_TEST_DATA_DIR: dataDirectory
      },
      stdio: "pipe"
    }
  );
  child.stdin.end();
  return capture(child);
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000
): Promise<ExitResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    new Promise<ExitResult>((resolvePromise) =>
      child.once("exit", (code, signal) => resolvePromise({ code, signal }))
    ),
    delay(timeoutMs).then(() => {
      throw new Error(`Process ${String(child.pid)} did not exit within ${String(timeoutMs)} ms`);
    })
  ]);
}

async function waitForOutput(
  spawned: SpawnedProcess,
  expected: string,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawned.output().includes(expected)) return;
    if (spawned.child.exitCode !== null || spawned.child.signalCode !== null) {
      throw new Error(`Process exited before "${expected}":\n${spawned.output()}`);
    }
    await delay(25);
  }
  throw new Error(`Process did not emit "${expected}":\n${spawned.output()}`);
}

async function waitForReady(
  server: SpawnedProcess,
  dataDirectory: string,
  timeoutMs = 20_000
): Promise<ServerInfo> {
  const infoPath = join(dataDirectory, "server-info.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`Server exited before readiness:\n${server.output()}`);
    }
    if (existsSync(infoPath)) {
      const info = JSON.parse(readFileSync(infoPath, "utf8")) as ServerInfo;
      if (info.pid === server.child.pid) {
        try {
          const response = await fetch(new URL("/api/v1/health", info.url));
          if (response.ok) return info;
        } catch {
          // The info file can be visible just before the listener accepts requests.
        }
      }
    }
    await delay(100);
  }
  throw new Error(`Server did not become ready:\n${server.output()}`);
}

function expectDatabaseAbsent(dataDirectory: string): void {
  expect(existsSync(join(dataDirectory, "symtype.sqlite3"))).toBe(false);
  expect(existsSync(join(dataDirectory, "symtype.sqlite3-wal"))).toBe(false);
  expect(existsSync(join(dataDirectory, "symtype.sqlite3-shm"))).toBe(false);
}

afterEach(async () => {
  const spawnedChildren = [...children];
  for (const child of spawnedChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  const orphanErrors: Error[] = [];
  for (const child of spawnedChildren) {
    try {
      await waitForExit(child, 5_000);
    } catch (error) {
      orphanErrors.push(error as Error);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      try {
        await waitForExit(child, 2_000);
      } catch (killError) {
        orphanErrors.push(killError as Error);
      }
    }
  }
  children.clear();

  for (const directory of cleanupDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  cleanupDirectories.clear();

  if (orphanErrors.length > 0) {
    throw new AggregateError(orphanErrors, "Server runtime lock tests left orphan processes");
  }
});

describe("server lifetime ownership", () => {
  test("rejects a real service before opening SQLite while another process only holds the lock", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "symtype-runtime-lock-"));
    cleanupDirectories.add(dataDirectory);
    const holder = launchLockHolder(dataDirectory);
    await waitForOutput(holder, `LOCK_READY:${String(holder.child.pid)}`);
    expectDatabaseAbsent(dataDirectory);

    const server = launchServer(dataDirectory, await availablePort());
    const serverExit = await waitForExit(server.child);
    expect(serverExit.code).not.toBe(0);
    expect(serverExit.signal).toBeNull();
    expect(server.output()).toContain(
      `Another SymType service already owns this data directory (PID ${String(holder.child.pid)})`
    );
    expect(server.output()).not.toContain("SymType is ready");
    expectDatabaseAbsent(dataDirectory);

    holder.child.kill("SIGTERM");
    expect(await waitForExit(holder.child)).toEqual({ code: 0, signal: null });
    expect(existsSync(join(dataDirectory, "server-runtime.lock"))).toBe(false);
  });

  test("recovers a token-validated stale lock after the holder is killed", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "symtype-runtime-lock-killed-"));
    cleanupDirectories.add(dataDirectory);
    const holder = launchLockHolder(dataDirectory);
    await waitForOutput(holder, `LOCK_READY:${String(holder.child.pid)}`);
    expectDatabaseAbsent(dataDirectory);

    holder.child.kill("SIGKILL");
    expect(await waitForExit(holder.child)).toEqual({ code: null, signal: "SIGKILL" });
    expect(existsSync(join(dataDirectory, "server-runtime.lock"))).toBe(true);

    const server = launchServer(dataDirectory, await availablePort());
    const serverInfo = await waitForReady(server, dataDirectory);
    expect(serverInfo.databasePath).toBe(join(dataDirectory, "symtype.sqlite3"));
    expect(existsSync(serverInfo.databasePath)).toBe(true);

    const health = await fetch(new URL("/api/v1/health", serverInfo.url));
    expect(health.ok).toBe(true);
    expect((await health.json()) as { integrity: { ok: boolean } }).toMatchObject({
      integrity: { ok: true }
    });

    server.child.kill("SIGTERM");
    expect(await waitForExit(server.child)).toEqual({ code: 0, signal: null });
    expect(existsSync(join(dataDirectory, "server-runtime.lock"))).toBe(false);
  });
});
