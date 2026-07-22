import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createApp, type AppContext } from "../src/app.js";
import { loadConfig, requireLoopbackBindHost } from "../src/config.js";

const HOST_HEADER = "127.0.0.1:4173";
const ORIGIN = `http://${HOST_HEADER}`;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe.sequential("direct-server security boundaries", () => {
  let dataDir = "";
  let previousDataDir: string | undefined;
  let previousHost: string | undefined;
  let previousNodeEnv: string | undefined;
  let previousLogLevel: string | undefined;
  let context: AppContext | undefined;

  beforeEach(() => {
    previousDataDir = process.env.SYMTYPE_DATA_DIR;
    previousHost = process.env.SYMTYPE_HOST;
    previousNodeEnv = process.env.NODE_ENV;
    previousLogLevel = process.env.SYMTYPE_LOG_LEVEL;
    dataDir = mkdtempSync(join(tmpdir(), "symtype-security-boundary-"));
    process.env.SYMTYPE_DATA_DIR = dataDir;
    process.env.SYMTYPE_HOST = "127.0.0.1";
    process.env.NODE_ENV = "test";
    process.env.SYMTYPE_LOG_LEVEL = "info";
  });

  afterEach(async () => {
    if (context) await context.app.close();
    context = undefined;
    rmSync(dataDir, { recursive: true, force: true });
    restoreEnvironment("SYMTYPE_DATA_DIR", previousDataDir);
    restoreEnvironment("SYMTYPE_HOST", previousHost);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("SYMTYPE_LOG_LEVEL", previousLogLevel);
  });

  test.each([
    [undefined, "127.0.0.1"],
    ["127.0.0.1", "127.0.0.1"],
    ["localhost", "localhost"],
    ["LOCALHOST", "localhost"],
    ["::1", "::1"]
  ])("loadConfig accepts only a canonical loopback bind host: %s", (input, expected) => {
    if (input === undefined) delete process.env.SYMTYPE_HOST;
    else process.env.SYMTYPE_HOST = input;
    expect(loadConfig().host).toBe(expected);
  });

  test.each(["0.0.0.0", "192.168.1.12", "symtype.invalid", "127.0.0.2", "[::1]"])(
    "loadConfig rejects an unsafe SYMTYPE_HOST before startup: %s",
    (host) => {
      process.env.SYMTYPE_HOST = host;
      expect(() => loadConfig()).toThrow(/loopback-only host/u);
    }
  );

  test("createApp rejects a bypassed unsafe bind host before opening SQLite", async () => {
    const config = loadConfig();
    const databasePath = config.databasePath;
    expect(existsSync(databasePath)).toBe(false);
    await expect(createApp({ ...config, host: "0.0.0.0", isTest: true })).rejects.toThrow(
      /loopback-only host/u
    );
    expect(existsSync(databasePath)).toBe(false);
  });

  test("direct index startup rejects an unsafe bind before creating its data directory", () => {
    const rejectedDataDir = join(dataDir, "rejected-direct-startup");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(REPOSITORY_ROOT, "apps/server/src/index.ts")],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          SYMTYPE_DATA_DIR: rejectedDataDir,
          SYMTYPE_HOST: "0.0.0.0",
          SYMTYPE_PORT: "0"
        },
        encoding: "utf8",
        timeout: 10_000
      }
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "SYMTYPE_HOST must be a loopback-only host"
    );
    expect(existsSync(rejectedDataDir)).toBe(false);
  });

  test("automatic request logs cannot emit query strings or CSRF tokens", async () => {
    const messages: string[] = [];
    context = await createApp(
      { ...loadConfig(), isTest: false },
      { logStream: { write: (message) => messages.push(message) } }
    );
    await context.app.ready();

    const secret = "csrf-token-that-must-not-enter-logs";
    const response = await context.app.inject({
      method: "GET",
      url: `/api/v1/diagnostics?csrf=${secret}`,
      headers: { host: HOST_HEADER }
    });
    expect(response.statusCode).toBe(200);
    expect(messages.join("")).not.toMatch(/incoming request|request completed/u);
    context.app.log.info({ route: "/api/v1/diagnostics" }, "explicit diagnostic remains available");

    const output = messages.join("");
    expect(output).toContain("explicit diagnostic remains available");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("?csrf=");
  });

  test("GET diagnostics is read-only and snapshot creation requires CSRF", async () => {
    context = await createApp({ ...loadConfig(), isTest: true });
    await context.app.ready();
    const diagnosticPath = join(dataDir, "diagnostic-summary.json");

    const read = await context.app.inject({
      method: "GET",
      url: "/api/v1/diagnostics",
      headers: { host: HOST_HEADER }
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json<{
      integrity: { ok: boolean };
      schemaVersion: number;
      databaseFile: string;
      diagnosticPath?: string;
    }>();
    expect(readBody).toMatchObject({
      integrity: { ok: true },
      databaseFile: "symtype.sqlite3"
    });
    expect(readBody.schemaVersion).toBeGreaterThan(0);
    expect(readBody).not.toHaveProperty("diagnosticPath");
    expect(existsSync(diagnosticPath)).toBe(false);

    const denied = await context.app.inject({
      method: "POST",
      url: "/api/v1/diagnostics/snapshot",
      headers: { host: HOST_HEADER, origin: ORIGIN }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "CSRF_FAILED" } });
    expect(existsSync(diagnosticPath)).toBe(false);

    const created = await context.app.inject({
      method: "POST",
      url: "/api/v1/diagnostics/snapshot",
      headers: {
        host: HOST_HEADER,
        origin: ORIGIN,
        "x-symtype-csrf": context.csrfToken
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ diagnosticPath });
    expect(existsSync(diagnosticPath)).toBe(true);
    const snapshot = readFileSync(diagnosticPath, "utf8");

    const readAgain = await context.app.inject({
      method: "GET",
      url: "/api/v1/diagnostics",
      headers: { host: HOST_HEADER }
    });
    expect(readAgain.statusCode).toBe(200);
    expect(readFileSync(diagnosticPath, "utf8")).toBe(snapshot);
  });

  test("the loopback validator rejects non-host values without normalization tricks", () => {
    expect(() => requireLoopbackBindHost("localhost:4173")).toThrow(/loopback-only host/u);
    expect(() => requireLoopbackBindHost("127.0.0.1\0.invalid")).toThrow(/loopback-only host/u);
  });
});
