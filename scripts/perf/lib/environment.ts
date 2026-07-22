import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface EnvironmentOptions {
  readonly command: string;
  readonly cacheState: string;
  readonly sqliteVersion?: string;
  readonly fixture?: string;
}

export interface EnvironmentMetadata {
  readonly capturedAt: string;
  readonly command: string;
  readonly cacheState: string;
  readonly fixture?: string;
  readonly operatingSystem: { platform: string; release: string; architecture: string };
  readonly processor: { model: string; logicalCores: number };
  readonly memoryBytes: number;
  readonly nodeVersion: string;
  readonly npmVersion: string | null;
  readonly sqliteVersion?: string;
  readonly worktree: {
    readonly commit: string | null;
    readonly dirty: boolean;
    readonly statusLineCount: number;
    readonly statusSha256: string;
  };
}

export function captureEnvironmentMetadata(options: EnvironmentOptions): EnvironmentMetadata {
  const processorList = cpus();
  const worktree = captureWorktree();
  return {
    capturedAt: new Date().toISOString(),
    command: options.command,
    cacheState: options.cacheState,
    ...(options.fixture ? { fixture: options.fixture } : {}),
    operatingSystem: { platform: platform(), release: release(), architecture: process.arch },
    processor: {
      model: processorList[0]?.model ?? "unknown",
      logicalCores: processorList.length
    },
    memoryBytes: totalmem(),
    nodeVersion: process.version,
    npmVersion: captureNpmVersion(),
    ...(options.sqliteVersion ? { sqliteVersion: options.sqliteVersion } : {}),
    worktree
  };
}

function captureNpmVersion(): string | null {
  const executableDirectory = dirname(process.execPath);
  const installedCli = join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(installedCli)) return commandOutput(process.execPath, [installedCli, "--version"]);
  const sibling = join(executableDirectory, process.platform === "win32" ? "npm.cmd" : "npm");
  if (existsSync(sibling)) {
    const resolved = realpathSync(sibling);
    if (resolved.endsWith(".js")) return commandOutput(process.execPath, [resolved, "--version"]);
    return commandOutput(sibling, ["--version"]);
  }
  return commandOutput("npm", ["--version"]);
}

function captureWorktree(): EnvironmentMetadata["worktree"] {
  const status = commandOutput("git", ["status", "--short", "--untracked-files=all"]) ?? "";
  const commit = commandOutput("git", ["rev-parse", "HEAD"]);
  const lines = status === "" ? [] : status.split("\n");
  return {
    commit,
    dirty: lines.length > 0,
    statusLineCount: lines.length,
    statusSha256: createHash("sha256").update(status).digest("hex")
  };
}

function commandOutput(command: string, arguments_: readonly string[]): string | null {
  const result = spawnSync(command, arguments_, { encoding: "utf8", timeout: 5_000 });
  if (result.status !== 0) return null;
  const output = result.stdout.trim();
  return output === "" ? null : output;
}
