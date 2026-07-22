import { homedir, platform } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  logPath: string;
  webDist: string;
  isTest: boolean;
}

const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function requireLoopbackBindHost(value: string | undefined): string {
  const host = value?.trim() || "127.0.0.1";
  const normalized = host.toLowerCase();
  if (!LOOPBACK_BIND_HOSTS.has(normalized)) {
    throw new Error(
      `SYMTYPE_HOST must be a loopback-only host (127.0.0.1, localhost, or ::1); received ${JSON.stringify(host)}.`
    );
  }
  return normalized;
}

export function defaultDataDirectory(): string {
  const override = process.env.SYMTYPE_DATA_DIR?.trim();
  if (override) return resolve(override);

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "SymType");
  }
  if (platform() === "win32") {
    const appData = process.env.APPDATA?.trim();
    const base = appData && isAbsolute(appData) ? appData : join(homedir(), "AppData", "Roaming");
    return join(base, "SymType");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  const base =
    xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(homedir(), ".local", "share");
  return join(base, "symtype");
}

export function loadConfig(): ServerConfig {
  const dataDir = defaultDataDirectory();
  const rawPort = Number.parseInt(process.env.SYMTYPE_PORT ?? "4173", 10);
  return {
    host: requireLoopbackBindHost(process.env.SYMTYPE_HOST),
    port: Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65_536 ? rawPort : 4173,
    dataDir,
    databasePath: join(dataDir, "symtype.sqlite3"),
    logPath: join(dataDir, "logs", "symtype.log"),
    webDist: resolve(process.env.SYMTYPE_WEB_DIST ?? join(process.cwd(), "apps", "web", "dist")),
    isTest: process.env.NODE_ENV === "test"
  };
}
