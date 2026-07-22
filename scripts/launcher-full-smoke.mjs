#!/usr/bin/env node

/* global AbortSignal, console, fetch, process */

import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { platform, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(scriptDirectory, "..");
const defaultNode = "/opt/homebrew/Cellar/node/24.3.0/bin/node";
const copiedTopLevelEntries = new Set([
  ".env.example",
  "apps",
  "package-lock.json",
  "package.json",
  "packages",
  "scripts",
  "start.bat",
  "start.command",
  "start.sh",
  "tsconfig.base.json",
  "tsconfig.json"
]);
const excludedDirectoryNames = new Set([
  ".git",
  ".symtype-data",
  ".symtype-test-data",
  ".webtest-venv",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results"
]);

function parseArguments(argv) {
  const options = {
    allowUnsupported: false,
    keep: false,
    node: existsSync(defaultNode) ? defaultNode : process.execPath,
    offline: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-unsupported") options.allowUnsupported = true;
    else if (argument === "--keep") options.keep = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--node") {
      const value = argv[index + 1];
      if (!value) throw new Error("--node requires an executable path");
      options.node = resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/launcher-full-smoke.mjs [options]

Options:
  --node PATH           Node 22.12+ or Node 24 executable
  --offline             require npm to use its existing local cache
  --allow-unsupported   diagnostic only; never release evidence
  --keep                preserve the isolated fixture for diagnosis`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function shouldCopy(source) {
  const relativePath = relative(sourceRoot, source);
  if (!relativePath) return true;
  const parts = relativePath.split(sep);
  if (!copiedTopLevelEntries.has(parts[0])) return false;
  if (
    parts[0] === "scripts" &&
    parts[1] &&
    !["launcher-state.mjs", "start-local.mjs"].includes(parts[1])
  ) {
    return false;
  }
  if (parts.some((part) => excludedDirectoryNames.has(part))) return false;
  const name = basename(source);
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
  if (name.endsWith(".log") || name.includes(".sqlite3")) return false;
  try {
    if (lstatSync(source).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  return true;
}

function appendBounded(buffer, chunk) {
  const combined = `${buffer}${chunk.toString()}`;
  return combined.length > 200_000 ? combined.slice(-200_000) : combined;
}

function spawnCaptured(executable, args, options) {
  const child = spawn(executable, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
    process.stderr.write(chunk);
  });
  return { child, output: () => ({ stderr, stdout }) };
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return await Promise.race([
    new Promise((resolvePromise) => child.once("exit", (code) => resolvePromise(code))),
    delay(timeoutMs).then(() => {
      throw new Error(`Process ${String(child.pid)} did not exit within ${String(timeoutMs)}ms`);
    })
  ]);
}

async function stopManagedLaunch(launch, label) {
  launch.child.kill(platform() === "win32" ? "SIGTERM" : "SIGINT");
  const exitCode = await waitForExit(launch.child, 20_000);
  if (exitCode !== 0) {
    const output = launch.output();
    throw new Error(`${label} exited ${String(exitCode)}:\n${output.stdout}\n${output.stderr}`);
  }
}

async function waitForHealthyInfo(dataDirectory, timeoutMs) {
  const infoPath = join(dataDirectory, "server-info.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8"));
        const response = await fetch(new URL("/api/v1/health", info.url), {
          cache: "no-store",
          signal: AbortSignal.timeout(1_500)
        });
        const body = await response.json();
        if (response.ok && body?.ok === true && body?.integrity?.ok === true) {
          return { body, info };
        }
      } catch {
        // Atomic readiness is established only after both metadata and health agree.
      }
    }
    await delay(250);
  }
  throw new Error(`No healthy isolated instance appeared within ${String(timeoutMs)}ms`);
}

async function listenOnRandomLoopbackPort() {
  const server = createServer(() => {});
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
  return { port: address.port, server };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.node)) throw new Error(`Node executable not found: ${options.node}`);

  const version = spawnSync(options.node, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) throw new Error(`Could not execute ${options.node}`);
  console.log(`Using ${version.stdout.trim()} for isolated launcher acceptance.`);

  const fixtureBase = mkdtempSync(join(tmpdir(), "symtype-launcher-acceptance-"));
  const fixtureRoot = join(fixtureBase, "project");
  const dataDirectory = join(fixtureBase, "data");
  const callerDirectory = join(fixtureBase, "caller");
  const launcherPath = join(fixtureRoot, "scripts", "start-local.mjs");
  let firstLaunch;
  let occupiedPort;

  try {
    cpSync(sourceRoot, fixtureRoot, { filter: shouldCopy, recursive: true });
    mkdirSync(callerDirectory);

    occupiedPort = await listenOnRandomLoopbackPort();
    const environment = {
      ...process.env,
      PATH: `${dirname(options.node)}${delimiter}${process.env.PATH ?? ""}`,
      SYMTYPE_DATA_DIR: dataDirectory,
      SYMTYPE_OPEN_BROWSER: "0",
      SYMTYPE_PORT: String(occupiedPort.port),
      NODE_ENV: "production",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_omit: "dev"
    };
    delete environment.SYMTYPE_ALLOW_UNSUPPORTED_NODE;
    if (options.allowUnsupported) environment.SYMTYPE_ALLOW_UNSUPPORTED_NODE = "1";
    if (options.offline) environment.npm_config_offline = "true";

    firstLaunch = spawnCaptured(options.node, [launcherPath, "--no-open"], {
      cwd: callerDirectory,
      env: environment
    });
    const started = await waitForHealthyInfo(dataDirectory, 240_000);
    const finalUrl = new URL(started.info.url);
    if (Number(finalUrl.port) === occupiedPort.port) {
      throw new Error("Launcher reused the occupied preferred port instead of falling back");
    }
    if (started.body.service !== "symtype") throw new Error("Unexpected health service identity");
    if (!firstLaunch.output().stdout.includes("npm ci --include=dev")) {
      throw new Error("Clean install did not explicitly include the build/test toolchain");
    }

    const reuse = spawnSync(options.node, [launcherPath, "--no-open"], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: environment,
      timeout: 20_000
    });
    if (reuse.status !== 0 || !reuse.stdout.includes("直接复用")) {
      throw new Error(`Healthy-instance reuse failed:\n${reuse.stdout}\n${reuse.stderr}`);
    }

    await stopManagedLaunch(firstLaunch, "First launcher");
    firstLaunch = undefined;

    if (!existsSync(join(dataDirectory, "symtype.sqlite3"))) {
      throw new Error("The isolated launch did not create its SQLite database");
    }
    if (platform() !== "win32") {
      const backupDirectory = join(dataDirectory, "backups");
      const backupFilename = readdirSync(backupDirectory).find((name) => name.endsWith(".sqlite3"));
      const privatePaths = [
        dataDirectory,
        backupDirectory,
        join(dataDirectory, "logs"),
        join(dataDirectory, "logs", "launcher.log"),
        join(dataDirectory, "logs", "symtype.log"),
        join(dataDirectory, "server-info.json"),
        join(dataDirectory, "symtype.sqlite3"),
        ...(backupFilename ? [join(backupDirectory, backupFilename)] : [])
      ];
      for (const path of privatePaths) {
        if ((lstatSync(path).mode & 0o077) !== 0) {
          throw new Error(`New application-data path is not owner-only: ${path}`);
        }
      }
    }

    firstLaunch = spawnCaptured(options.node, [launcherPath, "--no-open"], {
      cwd: tmpdir(),
      env: environment
    });
    await waitForHealthyInfo(dataDirectory, 60_000);
    await delay(200);
    const unchangedOutput = firstLaunch.output().stdout;
    if (
      !unchangedOutput.includes("lockfile 与已安装依赖一致") ||
      !unchangedOutput.includes("生产产物与当前源码指纹一致") ||
      unchangedOutput.includes("安装锁定依赖：npm") ||
      unchangedOutput.includes("构建生产版本：npm")
    ) {
      throw new Error(`Unchanged offline restart repeated install/build:\n${unchangedOutput}`);
    }
    await stopManagedLaunch(firstLaunch, "Unchanged restart");
    firstLaunch = undefined;

    const webAssetsDirectory = join(fixtureRoot, "apps", "web", "dist", "assets");
    const expendableOutput = readdirSync(webAssetsDirectory).find((name) => name.endsWith(".map"));
    if (!expendableOutput)
      throw new Error("Could not find a built lazy/source-map asset to damage");
    unlinkSync(join(webAssetsDirectory, expendableOutput));

    firstLaunch = spawnCaptured(options.node, [launcherPath, "--no-open"], {
      cwd: callerDirectory,
      env: environment
    });
    await waitForHealthyInfo(dataDirectory, 120_000);
    await delay(200);
    const repairedOutput = firstLaunch.output().stdout;
    if (
      !repairedOutput.includes("生产产物清单缺失或有文件损坏") ||
      !repairedOutput.includes("构建生产版本：npm")
    ) {
      throw new Error(`Damaged output did not trigger a production rebuild:\n${repairedOutput}`);
    }
    await stopManagedLaunch(firstLaunch, "Damaged-output restart");
    firstLaunch = undefined;

    const lockfilePath = join(fixtureRoot, "package-lock.json");
    const originalLockfile = readFileSync(lockfilePath, "utf8");
    const changedLockfile = JSON.parse(originalLockfile);
    changedLockfile.symtypeLauncherSmoke = "hash-change-only";
    writeFileSync(lockfilePath, `${JSON.stringify(changedLockfile, null, 2)}\n`, "utf8");
    const changedLockDryRun = spawnSync(options.node, [launcherPath, "--dry-run", "--no-open"], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: environment,
      timeout: 20_000
    });
    writeFileSync(lockfilePath, originalLockfile, "utf8");
    if (
      changedLockDryRun.status !== 0 ||
      !changedLockDryRun.stdout.includes("package-lock.json 已变化") ||
      !changedLockDryRun.stdout.includes("未安装、构建、迁移、启动或打开浏览器")
    ) {
      throw new Error(
        `Lockfile-change dry-run did not report an install plan safely:\n` +
          `${changedLockDryRun.stdout}\n${changedLockDryRun.stderr}`
      );
    }

    console.log(
      `Launcher acceptance passed: wrong cwd, production-env clean install/build/migrate, ` +
        `occupied-port fallback (${String(occupiedPort.port)} -> ${finalUrl.port}), health, live ` +
        `reuse, private POSIX file modes, unchanged offline restart, damaged-output rebuild, ` +
        `lockfile-change planning, and graceful shutdown.`
    );
  } finally {
    if (firstLaunch?.child.exitCode === null) {
      firstLaunch.child.kill("SIGTERM");
      try {
        await waitForExit(firstLaunch.child, 10_000);
      } catch {
        firstLaunch.child.kill("SIGKILL");
      }
    }
    if (occupiedPort) {
      await new Promise((resolvePromise) => occupiedPort.server.close(resolvePromise));
    }
    if (options.keep) console.log(`Preserved fixture: ${fixtureBase}`);
    else rmSync(fixtureBase, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
