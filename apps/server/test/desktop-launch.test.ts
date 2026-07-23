import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { loadConfig, type ServerConfig } from "../src/config.js";
import { createServerInfo, watchParentPipe, writeServerInfo } from "../src/desktop-launch.js";
import { PRODUCT_VERSION } from "../src/product-version.js";

const DESKTOP_ENVIRONMENT_KEYS = [
  "SYMTYPE_DATA_DIR",
  "SYMTYPE_HOST",
  "SYMTYPE_PORT",
  "SYMTYPE_DESKTOP_MODE",
  "SYMTYPE_DESKTOP_LAUNCH_NONCE",
  "SYMTYPE_BUILD_ID"
] as const;

describe.sequential("packaged desktop launch protocol", () => {
  let originalEnvironment: Partial<Record<(typeof DESKTOP_ENVIRONMENT_KEYS)[number], string>>;
  let temporaryDirectories: string[];

  beforeEach(() => {
    originalEnvironment = {};
    temporaryDirectories = [];
    for (const key of DESKTOP_ENVIRONMENT_KEYS) {
      const value = process.env[key];
      if (value !== undefined) originalEnvironment[key] = value;
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of DESKTOP_ENVIRONMENT_KEYS) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "symtype-desktop-protocol-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  function configureDesktopEnvironment(): void {
    process.env.SYMTYPE_DATA_DIR = temporaryDirectory();
    process.env.SYMTYPE_HOST = "127.0.0.1";
    process.env.SYMTYPE_PORT = "0";
    process.env.SYMTYPE_DESKTOP_MODE = "1";
    process.env.SYMTYPE_DESKTOP_LAUNCH_NONCE = "0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.SYMTYPE_BUILD_ID = "2.1.0+1.481a2cb";
  }

  test("accepts an authenticated desktop launch on an ephemeral IPv4 loopback port", () => {
    configureDesktopEnvironment();

    const config = loadConfig();

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 0,
      desktopLaunch: {
        launchNonce: "0123456789abcdef0123456789abcdef0123456789abcdef",
        buildId: "2.1.0+1.481a2cb",
        parentPid: process.ppid
      }
    });
  });

  test("uses the server package metadata as the product version authority", () => {
    const packageMetadata = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { version: string };

    expect(PRODUCT_VERSION).toBe(packageMetadata.version);
  });

  test("preserves source-launcher port fallback and rejects partial desktop metadata", () => {
    process.env.SYMTYPE_PORT = "0";
    expect(loadConfig().port).toBe(4173);

    process.env.SYMTYPE_DESKTOP_LAUNCH_NONCE = "0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(() => loadConfig()).toThrow(/SYMTYPE_DESKTOP_MODE must be 1/u);

    process.env.SYMTYPE_DESKTOP_MODE = "1";
    process.env.SYMTYPE_HOST = "localhost";
    process.env.SYMTYPE_BUILD_ID = "2.1.0+1";
    expect(() => loadConfig()).toThrow(/bind exactly to 127\.0\.0\.1/u);
  });

  test("writes additive private metadata atomically with owner-only permissions", () => {
    configureDesktopEnvironment();
    const config = loadConfig();
    const info = createServerInfo(config, "http://127.0.0.1:54321", PRODUCT_VERSION, {
      pid: 1234,
      parentPid: 4321,
      startedAt: "2026-07-23T00:00:00.000Z"
    });

    expect(info).toEqual({
      protocolVersion: 1,
      url: "http://127.0.0.1:54321",
      pid: 1234,
      parentPid: process.ppid,
      startedAt: "2026-07-23T00:00:00.000Z",
      databasePath: config.databasePath,
      productVersion: PRODUCT_VERSION,
      buildId: "2.1.0+1.481a2cb",
      distribution: "macos-app",
      launchNonce: "0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    const path = writeServerInfo(config.dataDir, info);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(info);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("source launch metadata stays compatible and omits a launch nonce", () => {
    const dataDir = temporaryDirectory();
    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 4173,
      dataDir,
      databasePath: join(dataDir, "symtype.sqlite3"),
      logPath: join(dataDir, "logs", "symtype.log"),
      webDist: join(dataDir, "web"),
      isTest: true
    };

    expect(
      createServerInfo(config, "http://127.0.0.1:4173", PRODUCT_VERSION, {
        pid: 11,
        parentPid: 10,
        startedAt: "2026-07-23T00:00:00.000Z"
      })
    ).toEqual({
      protocolVersion: 1,
      url: "http://127.0.0.1:4173",
      pid: 11,
      parentPid: 10,
      startedAt: "2026-07-23T00:00:00.000Z",
      databasePath: config.databasePath,
      productVersion: PRODUCT_VERSION,
      buildId: PRODUCT_VERSION,
      distribution: "source"
    });
  });

  test("shuts down exactly once when the owned parent pipe closes", async () => {
    const parentPipe = new PassThrough();
    const disconnected = vi.fn();
    const cleanup = watchParentPipe(parentPipe, disconnected);

    parentPipe.end();
    await new Promise<void>((resolve) => parentPipe.once("close", resolve));

    expect(disconnected).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
