#!/usr/bin/env node

/* global AbortSignal, URL, console, fetch, process */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { decideDependencyPlan } from "./launcher-state.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
const nodeMinor = Number.parseInt(process.versions.node.split(".")[1] ?? "0", 10);
const supportedRuntime = (nodeMajor === 22 && nodeMinor >= 12) || nodeMajor === 24;
const diagnosticOverride = process.env.SYMTYPE_ALLOW_UNSUPPORTED_NODE === "1";
const isWindows = platform() === "win32";
if (!isWindows) process.umask(0o077);
const npmExecutable = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgumentPrefix = isWindows ? ["/d", "/s", "/c", "npm"] : [];
const stateDirectory = join(projectRoot, "node_modules", ".symtype-launcher");
const installStatePath = join(stateDirectory, "install-state.json");
const buildStatePath = join(stateDirectory, "build-state.json");
const serverInfoFilename = "server-info.json";
const launchLockFilename = "launcher.lock";
const healthPath = "/api/v1/health";
const requiredDependencyFiles = [
  "node_modules/better-sqlite3/package.json",
  "node_modules/fastify/package.json",
  "node_modules/react/package.json",
  "node_modules/tsup/package.json",
  "node_modules/typescript/package.json",
  "node_modules/vite/package.json"
];
const requiredBuildOutputs = [
  "apps/web/dist/index.html",
  "apps/server/dist/index.js",
  "packages/shared/dist/index.js",
  "packages/content/dist/index.js"
];
const buildOutputDirectories = [
  "apps/web/dist",
  "apps/server/dist",
  "packages/shared/dist",
  "packages/content/dist"
];
const buildInputExtensions = new Set([
  ".avif",
  ".cjs",
  ".css",
  ".csv",
  ".gif",
  ".html",
  ".ico",
  ".js",
  ".json",
  ".jsx",
  ".jpg",
  ".jpeg",
  ".less",
  ".mjs",
  ".m4a",
  ".md",
  ".mp3",
  ".ogg",
  ".otf",
  ".png",
  ".sass",
  ".scss",
  ".svg",
  ".ttf",
  ".ts",
  ".tsx",
  ".txt",
  ".wav",
  ".wasm",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
  ".yaml",
  ".yml"
]);
const ignoredBuildDirectories = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);

let launcherLogPath;
let ownedLaunchLockPath;
let activeServerChild;

function dataDirectory() {
  const override = process.env.SYMTYPE_DATA_DIR?.trim();
  if (override) {
    const resolved = resolve(projectRoot, override);
    const canonical = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (canonical === parse(canonical).root) {
      throw new Error("SYMTYPE_DATA_DIR 不能指向文件系统根目录；请选择专用的 SymType 数据目录。");
    }
    return resolved;
  }
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

function timestamp() {
  return new Date().toISOString();
}

function writeLog(level, message) {
  const rendered = `[${timestamp()}] [${level}] ${message}`;
  if (level === "ERROR" || level === "WARN") console.error(rendered);
  else console.log(rendered);
  if (launcherLogPath) appendFileSync(launcherLogPath, `${rendered}\n`, "utf8");
}

function writeCommandChunk(chunk, toError = false) {
  const text = chunk.toString();
  if (toError) process.stderr.write(text);
  else process.stdout.write(text);
  if (launcherLogPath) appendFileSync(launcherLogPath, text);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`SymType 本地启动器

用法:
  node scripts/start-local.mjs [--no-open] [--dry-run]

选项:
  --no-open  启动并等待健康检查，但不自动打开浏览器
  --dry-run  只检查环境并报告将执行的动作，不安装、构建、迁移或启动
  --help     显示本帮助

环境变量:
  SYMTYPE_DATA_DIR                     覆盖本机数据目录
  SYMTYPE_PORT                         首选端口（冲突时服务器会选择安全空闲端口）
  SYMTYPE_OPEN_BROWSER=0               不自动打开浏览器
  SYMTYPE_ALLOW_UNSUPPORTED_NODE=1     仅用于诊断的非受支持 Node 覆盖`);
}

function parseArguments(argv) {
  const options = { noOpen: false, dryRun: false };
  for (const argument of argv) {
    if (argument === "--no-open") options.noOpen = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") return { ...options, help: true };
    else throw new Error(`无法识别的启动参数：${argument}。使用 --help 查看可用选项。`);
  }
  return options;
}

function assertRuntime() {
  if (!supportedRuntime && !diagnosticOverride) {
    throw new Error(
      `需要 Node.js 22 LTS（22.12 或更新）或 24 LTS；当前是 ${process.version}。` +
        "请安装受支持的 LTS 版本后重试。若只为诊断，可设置 " +
        "SYMTYPE_ALLOW_UNSUPPORTED_NODE=1；该覆盖不保证原生 SQLite 依赖可运行。"
    );
  }
  if (!supportedRuntime) {
    writeLog(
      "WARN",
      `正在使用诊断覆盖运行非受支持的 ${process.version}；结果不能视为发布支持证据。`
    );
  }

  const npmResult = spawnSync(npmExecutable, [...npmArgumentPrefix, "--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (npmResult.error || npmResult.status !== 0) {
    throw new Error("找不到可用的 npm。请重新安装 Node.js LTS（安装包应包含 npm）。");
  }
  const npmVersion = npmResult.stdout.trim();
  const npmMajor = Number.parseInt(npmVersion.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(npmMajor) || npmMajor < 10) {
    throw new Error(`需要 npm 10 或更新版本；当前是 ${npmVersion || "未知版本"}。`);
  }
  return npmVersion;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJsonAtomically(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function extension(path) {
  const basename = path.slice(path.lastIndexOf(sep) + 1);
  const index = basename.lastIndexOf(".");
  return index >= 0 ? basename.slice(index) : "";
}

function collectBuildInputs(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredBuildDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectBuildInputs(path, result);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
    if (
      buildInputExtensions.has(extension(path)) ||
      entry.name === ".env" ||
      entry.name.startsWith(".env.")
    ) {
      result.push(path);
    }
  }
  return result;
}

function buildFingerprint() {
  const inputs = [
    join(projectRoot, "package.json"),
    join(projectRoot, "package-lock.json"),
    join(projectRoot, "tsconfig.base.json"),
    ...collectBuildInputs(join(projectRoot, "apps")),
    ...collectBuildInputs(join(projectRoot, "packages"))
  ];
  const hash = createHash("sha256");
  for (const input of [...new Set(inputs)].sort()) {
    if (!existsSync(input)) continue;
    hash.update(relative(projectRoot, input).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(input));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function runCommand(label, args) {
  writeLog("INFO", `${label}：npm ${args.join(" ")}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(npmExecutable, [...npmArgumentPrefix, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => writeCommandChunk(chunk));
    child.stderr.on("data", (chunk) => writeCommandChunk(chunk, true));
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(`${label}失败${signal ? `（信号 ${signal}）` : `（退出码 ${String(code)}）`}。`)
        );
      }
    });
  });
}

function dependencyPlan(lockHash) {
  const state = readJson(installStatePath);
  const missingDependencies = requiredDependencyFiles.filter(
    (path) => !existsSync(join(projectRoot, path))
  );
  return decideDependencyPlan({
    lockHash,
    state,
    nodeModulesPresent: existsSync(join(projectRoot, "node_modules")),
    missingDependencies,
    nodeAbi: process.versions.modules,
    runtimePlatform: platform(),
    runtimeArchitecture: process.arch
  });
}

function recordInstallState(lockHash, npmVersion) {
  writeJsonAtomically(installStatePath, {
    lockHash,
    node: process.versions.node,
    nodeAbi: process.versions.modules,
    npm: npmVersion,
    platform: platform(),
    architecture: process.arch,
    verifiedAt: timestamp()
  });
}

function fileHasContent(path) {
  try {
    const status = statSync(path);
    return status.isFile() && status.size > 0;
  } catch {
    return false;
  }
}

function pathIsInside(candidate, directory) {
  const child = relative(directory, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function collectFiles(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(path, result);
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function currentBuildOutputManifest() {
  return buildOutputDirectories
    .flatMap((directory) => {
      const absoluteDirectory = join(projectRoot, directory);
      return existsSync(absoluteDirectory) ? collectFiles(absoluteDirectory) : [];
    })
    .sort()
    .map((path) => ({
      path: relative(projectRoot, path).split(sep).join("/"),
      bytes: statSync(path).size,
      sha256: sha256File(path)
    }));
}

function outputManifestIsCurrent(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) return false;
  const allowedDirectories = buildOutputDirectories.map((directory) =>
    resolve(projectRoot, directory)
  );
  return manifest.every((entry) => {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      return false;
    }
    const path = resolve(projectRoot, entry.path);
    if (!allowedDirectories.some((directory) => pathIsInside(path, directory))) return false;
    try {
      const status = statSync(path);
      return status.isFile() && status.size === entry.bytes && sha256File(path) === entry.sha256;
    } catch {
      return false;
    }
  });
}

function missingBuildOutputs() {
  const missing = requiredBuildOutputs.filter(
    (output) => !fileHasContent(join(projectRoot, output))
  );
  const webIndexPath = join(projectRoot, "apps", "web", "dist", "index.html");
  if (!fileHasContent(webIndexPath)) return missing;

  const webDistDirectory = dirname(webIndexPath);
  const indexHtml = readFileSync(webIndexPath, "utf8");
  const references = indexHtml.matchAll(/(?:href|src)=["']([^"']+)["']/gu);
  for (const match of references) {
    const reference = match[1];
    if (!reference || (!reference.startsWith("/assets/") && !reference.startsWith("assets/"))) {
      continue;
    }
    const candidate = resolve(webDistDirectory, reference.replace(/^\//u, ""));
    const relativeCandidate = relative(webDistDirectory, candidate);
    if (
      relativeCandidate.startsWith(`..${sep}`) ||
      relativeCandidate === ".." ||
      !fileHasContent(candidate)
    ) {
      missing.push(`apps/web/dist/${reference.replace(/^\//u, "")}`);
    }
  }
  return [...new Set(missing)];
}

function buildPlan(fingerprint) {
  const missingOutputs = missingBuildOutputs();
  if (missingOutputs.length > 0) {
    return { build: true, reason: `缺少产物：${missingOutputs.join("、")}` };
  }
  const state = readJson(buildStatePath);
  if (!state || state.fingerprint !== fingerprint) {
    return { build: true, reason: "源码或构建配置自上次成功构建后有变化" };
  }
  if (!outputManifestIsCurrent(state.outputManifest)) {
    return { build: true, reason: "生产产物清单缺失或有文件损坏" };
  }
  return { build: false, reason: "生产产物与当前源码指纹一致" };
}

async function prepareProject(npmVersion, dryRun) {
  const lockfilePath = join(projectRoot, "package-lock.json");
  if (!existsSync(lockfilePath)) {
    throw new Error("缺少 package-lock.json；为保证可重复安装，启动器不会自动生成替代 lockfile。");
  }
  const lockHash = sha256File(lockfilePath);
  const dependencies = dependencyPlan(lockHash);
  writeLog("INFO", `依赖检查：${dependencies.reason}。`);

  if (!dryRun && dependencies.action === "install") {
    await runCommand("安装锁定依赖", ["ci", "--include=dev", "--no-audit", "--no-fund"]);
    recordInstallState(lockHash, npmVersion);
  } else if (!dryRun && dependencies.action === "rebuild") {
    await runCommand("重建本机 SQLite 模块", [
      "rebuild",
      "better-sqlite3",
      "--no-audit",
      "--no-fund"
    ]);
    recordInstallState(lockHash, npmVersion);
  }

  const fingerprint = buildFingerprint();
  const build = buildPlan(fingerprint);
  writeLog("INFO", `构建检查：${build.reason}。`);
  if (!dryRun && build.build) {
    await runCommand("构建生产版本", ["run", "build"]);
    const missingAfterBuild = missingBuildOutputs();
    if (missingAfterBuild.length > 0) {
      throw new Error(`构建命令成功但仍缺少产物：${missingAfterBuild.join("、")}。`);
    }
    const outputManifest = currentBuildOutputManifest();
    if (outputManifest.length === 0) {
      throw new Error("构建命令成功但没有生成可验证的生产产物清单。");
    }
    writeJsonAtomically(buildStatePath, {
      fingerprint,
      outputManifest,
      builtAt: timestamp()
    });
  }

  if (!dryRun) await runCommand("检查并执行数据库迁移", ["run", "migrate"]);
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function safeLocalUrl(rawValue) {
  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname)) return undefined;
    if (parsed.username || parsed.password) return undefined;
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function readServerInfo(appDataDirectory) {
  const path = join(appDataDirectory, serverInfoFilename);
  try {
    if (statSync(path).size > 64 * 1024) return undefined;
    const candidate = readJson(path);
    if (!candidate || !Number.isInteger(candidate.pid) || candidate.pid <= 0) return undefined;
    if (
      typeof candidate.databasePath !== "string" ||
      resolve(candidate.databasePath) !== join(appDataDirectory, "symtype.sqlite3")
    ) {
      return undefined;
    }
    const url = safeLocalUrl(candidate.url);
    if (!url) return undefined;
    return { ...candidate, url };
  } catch {
    return undefined;
  }
}

async function healthAt(url, timeoutMs = 1_250) {
  try {
    const response = await fetch(new URL(healthPath, url), {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    if (body?.ok !== true || body?.service !== "symtype" || body?.integrity?.ok !== true) {
      return undefined;
    }
    return body;
  } catch {
    return undefined;
  }
}

async function findHealthyInstance(appDataDirectory) {
  const info = readServerInfo(appDataDirectory);
  if (!info || !processIsAlive(info.pid)) return undefined;
  const health = await healthAt(info.url);
  return health ? { info, health } : undefined;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLaunchLock() {
  if (!ownedLaunchLockPath) return;
  try {
    unlinkSync(ownedLaunchLockPath);
  } catch {
    // A missing ephemeral lock does not affect user data or the running server.
  }
  ownedLaunchLockPath = undefined;
}

async function waitForConcurrentLauncher(appDataDirectory, lockPath, ownerPid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const instance = await findHealthyInstance(appDataDirectory);
    if (instance) return { instance, released: false };
    if (!existsSync(lockPath) || !processIsAlive(ownerPid)) {
      return { instance: undefined, released: true };
    }
    await delay(300);
  }
  return { instance: undefined, released: false };
}

async function acquireLaunchLock(appDataDirectory) {
  const path = join(appDataDirectory, launchLockFilename);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify({ pid: process.pid, createdAt: timestamp() })}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      ownedLaunchLockPath = path;
      return undefined;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readJson(path);
      const ownerAge = Date.now() - Date.parse(owner?.createdAt ?? "");
      const ownerActive = Number.isInteger(owner?.pid) && processIsAlive(owner.pid);
      if (ownerActive && Number.isFinite(ownerAge) && ownerAge < 10 * 60_000) {
        writeLog("INFO", "另一个 SymType 启动器正在工作；等待它完成健康检查。");
        const outcome = await waitForConcurrentLauncher(appDataDirectory, path, owner.pid, 180_000);
        if (outcome.instance) return outcome.instance;
        if (outcome.released) continue;
        throw new Error("另一个启动器仍在运行，但 3 分钟内没有出现健康实例。请查看启动日志。");
      }
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if (unlinkError?.code === "ENOENT") continue;
        throw new Error(`无法清理失效的启动锁：${errorMessage(unlinkError)}`);
      }
    }
  }
  throw new Error("无法取得本地启动锁。");
}

async function spawnServer(appDataDirectory) {
  const serverEntry = join(projectRoot, "apps", "server", "dist", "index.js");
  if (!existsSync(serverEntry)) throw new Error("服务器构建产物不存在，无法启动。");

  const requestedHost = process.env.SYMTYPE_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHostname(requestedHost)) {
    throw new Error(
      `SYMTYPE_HOST=${requestedHost} 不是回环地址；本地启动器拒绝把服务暴露到局域网。`
    );
  }

  const serverLogPath = join(appDataDirectory, "logs", "symtype.log");
  const logDescriptor = openSync(serverLogPath, "a");
  appendFileSync(
    serverLogPath,
    `\n[${timestamp()}] [launcher] starting production server from ${projectRoot}\n`,
    "utf8"
  );

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: projectRoot,
      detached: false,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SYMTYPE_DATA_DIR: appDataDirectory,
        SYMTYPE_HOST: requestedHost
      },
      stdio: ["ignore", logDescriptor, logDescriptor],
      windowsHide: true
    });
    closeSync(logDescriptor);
    child.once("error", (error) => rejectPromise(error));
    child.once("spawn", () => {
      activeServerChild = child;
      resolvePromise(child);
    });
  });
}

async function waitForStartedServer(appDataDirectory, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务器在健康检查前退出（退出码 ${String(child.exitCode)}）。`);
    }
    const info = readServerInfo(appDataDirectory);
    if (info?.pid === child.pid) {
      const health = await healthAt(info.url);
      if (health) return { info, health };
    }
    await delay(250);
  }
  throw new Error("服务器启动后 30 秒内未通过健康检查。");
}

async function openBrowser(url) {
  const command =
    platform() === "darwin"
      ? { executable: "open", args: [url] }
      : platform() === "win32"
        ? { executable: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
        : { executable: "xdg-open", args: [url] };

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function keepServerRunning(child) {
  writeLog("INFO", "本次启动的服务器由当前终端管理；按 Ctrl+C 可安全停止。");
  const result = await new Promise((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
  activeServerChild = undefined;
  if (result.code === 0 || result.signal === "SIGINT" || result.signal === "SIGTERM") {
    writeLog("INFO", "SymType 本地服务器已停止。");
    return;
  }
  throw new Error(
    `服务器意外停止${result.signal ? `（信号 ${result.signal}）` : `（退出码 ${String(result.code)}）`}。`
  );
}

function stopActiveServer(signal) {
  if (!activeServerChild || activeServerChild.exitCode !== null) return false;
  try {
    return activeServerChild.kill(signal);
  } catch {
    return false;
  }
}

async function finishWithInstance(instance, shouldOpen) {
  writeLog(
    "INFO",
    `SymType 已就绪：${instance.info.url}（PID ${String(instance.info.pid)}，schema ${String(instance.health.schemaVersion)}）。`
  );
  if (!shouldOpen) {
    console.log(`请在浏览器中打开：${instance.info.url}`);
    return;
  }
  try {
    await openBrowser(instance.info.url);
    writeLog("INFO", "已请求系统默认浏览器打开 SymType。");
  } catch (error) {
    writeLog("WARN", `无法自动打开浏览器：${errorMessage(error)}。`);
    console.log(`请手动打开：${instance.info.url}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  process.chdir(projectRoot);
  const appDataDirectory = dataDirectory();
  mkdirSync(join(appDataDirectory, "logs"), { recursive: true });
  launcherLogPath = join(appDataDirectory, "logs", "launcher.log");
  writeLog("INFO", `项目目录：${projectRoot}`);
  writeLog("INFO", `数据目录：${appDataDirectory}`);
  const npmVersion = assertRuntime();
  writeLog("INFO", `运行环境：Node ${process.versions.node} / npm ${npmVersion}。`);

  const shouldOpen = !options.noOpen && process.env.SYMTYPE_OPEN_BROWSER !== "0";
  const reusable = await findHealthyInstance(appDataDirectory);
  if (reusable && !options.dryRun) {
    writeLog("INFO", "发现同一数据目录的健康 SymType 实例，将直接复用。");
    await finishWithInstance(reusable, shouldOpen);
    return;
  }

  if (options.dryRun) {
    if (reusable) {
      writeLog("INFO", `dry-run 检测到可复用实例 ${reusable.info.url}；未打开浏览器。`);
    }
    await prepareProject(npmVersion, true);
    writeLog("INFO", "dry-run 完成；未安装、构建、迁移、启动或打开浏览器。");
    return;
  }

  const concurrentInstance = await acquireLaunchLock(appDataDirectory);
  if (concurrentInstance) {
    await finishWithInstance(concurrentInstance, shouldOpen);
    return;
  }

  try {
    await prepareProject(npmVersion, false);
    const secondReusableCheck = await findHealthyInstance(appDataDirectory);
    if (secondReusableCheck) {
      writeLog("INFO", "准备期间已有健康实例就绪，将复用该实例。");
      await finishWithInstance(secondReusableCheck, shouldOpen);
      return;
    }

    writeLog(
      "INFO",
      `启动本地服务（首选端口 ${process.env.SYMTYPE_PORT?.trim() || "4173"}；若占用会安全选择空闲端口）。`
    );
    const child = await spawnServer(appDataDirectory);
    const started = await waitForStartedServer(appDataDirectory, child);
    await finishWithInstance(started, shouldOpen);
    releaseLaunchLock();
    await keepServerRunning(child);
  } finally {
    releaseLaunchLock();
  }
}

process.once("SIGINT", () => {
  releaseLaunchLock();
  if (!stopActiveServer("SIGINT")) process.exit(130);
});
process.once("SIGTERM", () => {
  releaseLaunchLock();
  if (!stopActiveServer("SIGTERM")) process.exit(143);
});

try {
  await main();
} catch (error) {
  releaseLaunchLock();
  stopActiveServer("SIGTERM");
  const message = errorMessage(error);
  try {
    writeLog("ERROR", message);
  } catch {
    console.error(`[SymType] 启动失败：${message}`);
  }
  console.error("SymType 未修改或静默重建现有数据库。请先查看上面的错误。");
  if (launcherLogPath) console.error(`启动日志：${launcherLogPath}`);
  process.exitCode = 1;
}
