import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

import type { ServerConfig } from "./config.js";
import type { StartupTimingSnapshot } from "./startup-timings.js";

export interface ServerInfo {
  protocolVersion: 1;
  url: string;
  pid: number;
  parentPid: number;
  startedAt: string;
  databasePath: string;
  productVersion: string;
  buildId: string;
  distribution: "macos-app" | "source";
  launchNonce?: string;
  startupTimings?: StartupTimingSnapshot;
}

export function createServerInfo(
  config: ServerConfig,
  address: string,
  productVersion: string,
  runtime: {
    pid: number;
    parentPid: number;
    startedAt?: string;
    startupTimings?: StartupTimingSnapshot;
  } = {
    pid: process.pid,
    parentPid: process.ppid
  }
): ServerInfo {
  return {
    protocolVersion: 1,
    url: address,
    pid: runtime.pid,
    parentPid: config.desktopLaunch?.parentPid ?? runtime.parentPid,
    startedAt: runtime.startedAt ?? new Date().toISOString(),
    databasePath: config.databasePath,
    productVersion,
    buildId: config.desktopLaunch?.buildId ?? productVersion,
    distribution: config.desktopLaunch ? "macos-app" : "source",
    ...(config.desktopLaunch ? { launchNonce: config.desktopLaunch.launchNonce } : {}),
    ...(runtime.startupTimings ? { startupTimings: runtime.startupTimings } : {})
  };
}

export function writeServerInfo(dataDir: string, info: ServerInfo): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const destination = join(dataDir, "server-info.json");
  const temporary = join(dataDir, `.server-info.${String(info.pid)}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(info, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  renameSync(temporary, destination);
  return destination;
}

export function watchParentPipe(stream: Readable, onDisconnect: () => void): () => void {
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    onDisconnect();
  };
  const onError = () => disconnect();

  stream.once("end", disconnect);
  stream.once("close", disconnect);
  stream.once("error", onError);
  stream.resume();

  return () => {
    stream.removeListener("end", disconnect);
    stream.removeListener("close", disconnect);
    stream.removeListener("error", onError);
  };
}
