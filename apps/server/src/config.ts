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
  desktopLaunch?: DesktopLaunchConfig;
}

export interface DesktopLaunchConfig {
  launchNonce: string;
  buildId: string;
  parentPid: number;
}

const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DESKTOP_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;

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

function loadDesktopLaunchConfig(host: string): DesktopLaunchConfig | undefined {
  const mode = process.env.SYMTYPE_DESKTOP_MODE?.trim();
  const launchNonce = process.env.SYMTYPE_DESKTOP_LAUNCH_NONCE?.trim();
  const buildId = process.env.SYMTYPE_BUILD_ID?.trim();
  const hasDesktopMetadata = Boolean(launchNonce || buildId);

  if (!mode && !hasDesktopMetadata) return undefined;
  if (mode !== "1") {
    throw new Error(
      "SYMTYPE_DESKTOP_MODE must be 1 when packaged-desktop launch metadata is present."
    );
  }
  if (host !== "127.0.0.1") {
    throw new Error("Packaged desktop launches must bind exactly to 127.0.0.1.");
  }
  if (process.env.SYMTYPE_PORT?.trim() !== "0") {
    throw new Error(
      "Packaged desktop launches must request an ephemeral port with SYMTYPE_PORT=0."
    );
  }
  if (!launchNonce || !DESKTOP_NONCE_PATTERN.test(launchNonce)) {
    throw new Error("SYMTYPE_DESKTOP_LAUNCH_NONCE must be a 32-128 character base64url value.");
  }
  if (!buildId || !BUILD_ID_PATTERN.test(buildId)) {
    throw new Error("SYMTYPE_BUILD_ID must be a safe 1-128 character build identifier.");
  }

  return { launchNonce, buildId, parentPid: process.ppid };
}

export function loadConfig(): ServerConfig {
  const dataDir = defaultDataDirectory();
  const host = requireLoopbackBindHost(process.env.SYMTYPE_HOST);
  const desktopLaunch = loadDesktopLaunchConfig(host);
  const rawPort = Number.parseInt(process.env.SYMTYPE_PORT ?? "4173", 10);
  return {
    host,
    port:
      desktopLaunch && rawPort === 0
        ? 0
        : Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65_536
          ? rawPort
          : 4173,
    dataDir,
    databasePath: join(dataDir, "symtype.sqlite3"),
    logPath: join(dataDir, "logs", "symtype.log"),
    webDist: resolve(process.env.SYMTYPE_WEB_DIST ?? join(process.cwd(), "apps", "web", "dist")),
    isTest: process.env.NODE_ENV === "test",
    ...(desktopLaunch ? { desktopLaunch } : {})
  };
}
