import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

if (process.platform !== "win32") process.umask(0o077);

const config = loadConfig();
mkdirSync(dirname(config.logPath), { recursive: true });
const { app } = await createApp(config);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "SymType is saving and shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

let address: string;
try {
  address = await app.listen({ host: config.host, port: config.port });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "EADDRINUSE") throw error;
  app.log.warn({ requestedPort: config.port }, "Port is busy; selecting a safe loopback port");
  address = await app.listen({ host: config.host, port: 0 });
}

const info = {
  url: address,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  databasePath: config.databasePath
};
writeFileSync(join(config.dataDir, "server-info.json"), JSON.stringify(info, null, 2), "utf8");
app.log.info(info, "SymType is ready");
