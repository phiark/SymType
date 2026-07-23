import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServerInfo, watchParentPipe, writeServerInfo } from "./desktop-launch.js";
import { PRODUCT_VERSION } from "./product-version.js";
import { StartupTimeline } from "./startup-timings.js";

if (process.platform !== "win32") process.umask(0o077);

const startupTimeline = new StartupTimeline();
const config = loadConfig();
mkdirSync(dirname(config.logPath), { recursive: true });
const { app } = await createApp(config, { startupTimeline });

let stopping = false;
let stopWatchingParent: () => void = () => undefined;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  stopWatchingParent();
  app.log.info({ signal }, "SymType is saving and shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
if (config.desktopLaunch) {
  stopWatchingParent = watchParentPipe(process.stdin, () => {
    void shutdown("PARENT_PIPE_CLOSED");
  });
}

let address: string;
try {
  address = await app.listen({ host: config.host, port: config.port });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "EADDRINUSE") throw error;
  app.log.warn({ requestedPort: config.port }, "Port is busy; selecting a safe loopback port");
  address = await app.listen({ host: config.host, port: 0 });
}

startupTimeline.mark("listenerReady");
const info = createServerInfo(config, address, PRODUCT_VERSION, {
  pid: process.pid,
  parentPid: process.ppid,
  startupTimings: startupTimeline.snapshot()
});
writeServerInfo(config.dataDir, info);
app.log.info(
  {
    url: info.url,
    pid: info.pid,
    parentPid: info.parentPid,
    productVersion: info.productVersion,
    buildId: info.buildId,
    distribution: info.distribution,
    databasePath: info.databasePath,
    startupTimings: info.startupTimings
  },
  "SymType is ready"
);
