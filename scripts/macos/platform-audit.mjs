/* global Buffer, URL, process */

import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, sep } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { MACOS_RELEASE } from "./release-config.mjs";
import {
  assertAppResourceAllowlist,
  directorySize,
  listFiles,
  pathExists,
  runCommand,
  verifyReleaseManifest
} from "./release-lib.mjs";

const ALLOWED_LINK_PREFIXES = Object.freeze([
  "/System/Library/",
  "/usr/lib/",
  "@executable_path/",
  "@loader_path/",
  "@rpath/"
]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".plist"]);
const ABSOLUTE_BUILD_PATH_MARKERS = Object.freeze(["/Users/", "/home/runner/work/"]);

export function extractCoverageInstrumentation(loadCommands) {
  const artifacts = [];
  for (const line of loadCommands.split("\n")) {
    const match = line.match(
      /^\s*(?:segname|sectname)\s+(__LLVM_COV|__llvm_(?:cov|prf)[A-Za-z0-9_]*)\s*$/u
    );
    if (match && !artifacts.includes(match[1])) artifacts.push(match[1]);
  }
  return artifacts;
}

export function extractCoverageSymbols(symbols) {
  return [
    ...new Set(
      symbols
        .split("\n")
        .map((symbol) => symbol.trim())
        .filter((symbol) => /^_+(?:gcov|llvm_gcov|llvm_profile)(?:_|$)/u.test(symbol))
    )
  ];
}

export async function findMachOFiles(root) {
  const result = [];
  for (const file of await listFiles(root)) {
    const fileStat = await stat(file);
    if (!fileStat.isFile()) continue;
    const inspection = await runCommand("/usr/bin/file", ["-b", file], {
      capture: true,
      quiet: true
    });
    if (inspection.stdout.includes("Mach-O")) result.push(file);
  }
  return result;
}

export async function signApplicationInsideOut(appPath, options = {}) {
  const machOFiles = await findMachOFiles(appPath);
  machOFiles.sort((left, right) => right.split(sep).length - left.split(sep).length);
  for (const file of machOFiles) {
    const arguments_ = ["--force", "--sign", "-", "--timestamp=none"];
    if (options.nodeEntitlements && file === join(appPath, "Contents", "Helpers", "node")) {
      arguments_.push("--entitlements", options.nodeEntitlements);
    }
    arguments_.push(file);
    await runCommand("/usr/bin/codesign", arguments_);
  }

  const nestedBundles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      if (
        path !== appPath &&
        [".app", ".appex", ".framework", ".xpc"].some((suffix) => entry.name.endsWith(suffix))
      ) {
        nestedBundles.push(path);
      }
      await visit(path);
    }
  }
  await visit(appPath);
  nestedBundles.sort((left, right) => right.split(sep).length - left.split(sep).length);
  for (const bundle of nestedBundles) {
    await runCommand("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", bundle]);
  }
}

async function assertInfoPlist(appPath, buildNumber) {
  const plist = join(appPath, "Contents", "Info.plist");
  const expected = {
    CFBundleIdentifier: MACOS_RELEASE.bundleIdentifier,
    CFBundleShortVersionString: MACOS_RELEASE.productVersion,
    CFBundleVersion: buildNumber,
    LSMinimumSystemVersion: MACOS_RELEASE.minimumMacOS
  };
  for (const [key, value] of Object.entries(expected)) {
    const result = await runCommand("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist], {
      capture: true,
      quiet: true
    });
    if (result.stdout !== String(value)) {
      throw new Error(`Info.plist ${key} must be ${value}, received ${result.stdout}`);
    }
  }
}

async function assertArm64MachO(appPath) {
  const machOFiles = await findMachOFiles(appPath);
  if (machOFiles.length < 3) {
    throw new Error(
      `Expected native app, Node, and SQLite Mach-O files; found ${machOFiles.length}`
    );
  }

  for (const file of machOFiles) {
    const architectures = await runCommand("/usr/bin/lipo", ["-archs", file], {
      capture: true,
      quiet: true
    });
    if (architectures.stdout !== MACOS_RELEASE.architecture) {
      throw new Error(
        `${relative(appPath, file)} must contain only arm64, received ${architectures.stdout}`
      );
    }

    const loadCommands = await runCommand("/usr/bin/otool", ["-l", file], {
      capture: true,
      quiet: true
    });
    const symbols = await runCommand("/usr/bin/nm", ["-gj", file], {
      capture: true,
      quiet: true
    });
    const coverageInstrumentation = [
      ...extractCoverageInstrumentation(loadCommands.stdout),
      ...extractCoverageSymbols(symbols.stdout)
    ];
    if (coverageInstrumentation.length > 0) {
      throw new Error(
        `${relative(appPath, file)} contains release coverage instrumentation: ` +
          coverageInstrumentation.join(", ")
      );
    }
    const minimumVersions = extractMacOSMinimumVersions(loadCommands.stdout);
    if (minimumVersions.length === 0) {
      throw new Error(`${relative(appPath, file)} does not declare a macOS minimum version`);
    }
    for (const version of minimumVersions) {
      if (compareVersions(version, MACOS_RELEASE.minimumMacOS) > 0) {
        throw new Error(
          `${relative(appPath, file)} requires macOS ${version}, above the declared ${MACOS_RELEASE.minimumMacOS}`
        );
      }
    }

    const links = await runCommand("/usr/bin/otool", ["-L", file], {
      capture: true,
      quiet: true
    });
    for (const line of links.stdout.split("\n").slice(1)) {
      const dependency = line.trim().split(" (")[0];
      if (!dependency || ALLOWED_LINK_PREFIXES.some((prefix) => dependency.startsWith(prefix))) {
        continue;
      }
      throw new Error(
        `${relative(appPath, file)} has a non-system dynamic dependency: ${dependency}`
      );
    }
  }
  return machOFiles;
}

export function extractMacOSMinimumVersions(loadCommands) {
  const versions = [];
  const commandBlocks = loadCommands.split(/(?=^Load command \d+\s*$)/gm);
  for (const block of commandBlocks) {
    const command = block.match(/^\s*cmd\s+(LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX)\s*$/m)?.[1];
    if (command === "LC_BUILD_VERSION") {
      const minimum = block.match(/^\s*minos\s+([0-9]+(?:\.[0-9]+){1,2})\s*$/m)?.[1];
      if (minimum) versions.push(minimum);
    } else if (command === "LC_VERSION_MIN_MACOSX") {
      const minimum = block.match(/^\s*version\s+([0-9]+(?:\.[0-9]+){1,2})\s*$/m)?.[1];
      if (minimum) versions.push(minimum);
    }
  }
  return versions;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function assertNoAbsoluteBuildPaths(appPath) {
  const offenders = [];
  for (const file of await listFiles(join(appPath, "Contents", "Resources"))) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const contents = await readFile(file, "utf8");
    if (ABSOLUTE_BUILD_PATH_MARKERS.some((marker) => contents.includes(marker))) {
      offenders.push(relative(appPath, file));
    }
  }
  if (offenders.length > 0) {
    throw new Error(`Absolute build paths found in packaged text files: ${offenders.join(", ")}`);
  }
}

async function verifyEmbeddedNode(appPath) {
  const node = join(appPath, "Contents", "Helpers", "node");
  const runtime = await runCommand(
    node,
    [
      "--input-type=commonjs",
      "-e",
      "process.stdout.write(JSON.stringify({version:process.versions.node,abi:process.versions.modules,arch:process.arch}))"
    ],
    { capture: true, quiet: true }
  );
  const values = JSON.parse(runtime.stdout);
  const expected = {
    version: MACOS_RELEASE.nodeVersion,
    abi: MACOS_RELEASE.nodeAbi,
    arch: MACOS_RELEASE.architecture
  };
  for (const [key, value] of Object.entries(expected)) {
    if (values[key] !== value) {
      throw new Error(`Embedded Node ${key} must be ${value}, received ${values[key]}`);
    }
  }

  const runtimeDirectory = join(appPath, "Contents", "Resources", "app");
  await runCommand(
    node,
    [
      "--input-type=commonjs",
      "-e",
      [
        'const Database=require("better-sqlite3");',
        'const db=new Database(":memory:");',
        'db.prepare("select 1").get();',
        "db.close();",
        "process.stdout.write(process.versions.modules)"
      ].join("")
    ],
    { cwd: runtimeDirectory, capture: true, quiet: true }
  );
}

async function assertNodeEntitlements(appPath) {
  const node = join(appPath, "Contents", "Helpers", "node");
  const result = await runCommand(
    "/usr/bin/codesign",
    ["--display", "--entitlements", ":-", node],
    { capture: true, quiet: true }
  );
  const entitlements = `${result.stdout}\n${result.stderr}`;
  if (!entitlements.includes("com.apple.security.cs.allow-jit")) {
    throw new Error("Embedded Node signature is missing the allow-jit entitlement");
  }
  for (const forbidden of [
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation"
  ]) {
    if (entitlements.includes(forbidden)) {
      throw new Error(`Embedded Node signature contains forbidden entitlement ${forbidden}`);
    }
  }
}

async function requestJson(url) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const request_ = request(url, { method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", rejectPromise);
      response.on("end", () => {
        try {
          resolvePromise({
            statusCode: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        } catch (error) {
          rejectPromise(error);
        }
      });
    });
    request_.setTimeout(5_000, () => request_.destroy(new Error("Health request timed out")));
    request_.on("error", rejectPromise);
    request_.end();
  });
}

async function waitForServerInfo(path, child, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged server exited before readiness with code ${String(child.exitCode)} and signal ${String(child.signalCode)}`
      );
    }
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await delay(25);
  }
  throw new Error(`Packaged server did not write ${path} within ${timeoutMilliseconds} ms`);
}

async function waitForChildExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await Promise.race([
    new Promise((resolvePromise) => {
      child.once("exit", (code, signal) => resolvePromise({ code, signal }));
    }),
    delay(timeoutMilliseconds).then(() => null)
  ]);
}

export async function smokePackagedServer(appPath, options = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "symtype-packaged-smoke-"));
  const node = join(appPath, "Contents", "Helpers", "node");
  const serverEntry = join(appPath, "Contents", "Resources", "app", "server", "index.js");
  const webDistribution = join(appPath, "Contents", "Resources", "app", "web");
  const launchNonce = "A".repeat(43);
  const buildId = `${MACOS_RELEASE.productVersion}+${MACOS_RELEASE.buildNumber}.audit`;
  const output = [];
  const child = spawn(node, [serverEntry], {
    cwd: join(appPath, "Contents", "Resources", "app"),
    env: {
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      MACOSX_DEPLOYMENT_TARGET: MACOS_RELEASE.minimumMacOS,
      NODE_ENV: "production",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      SYMTYPE_BUILD_ID: buildId,
      SYMTYPE_DATA_DIR: dataDirectory,
      SYMTYPE_DESKTOP_LAUNCH_NONCE: launchNonce,
      SYMTYPE_DESKTOP_MODE: "1",
      SYMTYPE_HOST: "127.0.0.1",
      SYMTYPE_PORT: "0",
      SYMTYPE_WEB_DIST: webDistribution
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.spawnError = null;
  child.on("error", (error) => {
    child.spawnError = error;
  });
  child.stdin.on("error", () => undefined);
  const collect = (chunk) => {
    if (output.reduce((total, item) => total + item.length, 0) < 128 * 1024) {
      output.push(chunk);
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let completed = false;
  try {
    const info = await waitForServerInfo(join(dataDirectory, "server-info.json"), child, 15_000);
    const url = new URL(info.url);
    const expectedInfo = {
      protocolVersion: 1,
      pid: child.pid,
      parentPid: process.pid,
      productVersion: MACOS_RELEASE.productVersion,
      buildId,
      distribution: "macos-app",
      launchNonce,
      databasePath: join(dataDirectory, "symtype.sqlite3")
    };
    for (const [field, value] of Object.entries(expectedInfo)) {
      if (info[field] !== value) {
        throw new Error(
          `Packaged server-info ${field} must be ${String(value)}, received ${String(info[field])}`
        );
      }
    }
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !/^[1-9][0-9]*$/.test(url.port)
    ) {
      throw new Error(`Packaged server reported a non-loopback URL: ${info.url}`);
    }
    if (Number.isNaN(Date.parse(info.startedAt))) {
      throw new Error(`Packaged server reported an invalid start time: ${String(info.startedAt)}`);
    }

    const health = await (options.requestHealth ?? requestJson)(new URL("/api/v1/health", url));
    if (
      health.statusCode !== 200 ||
      health.body?.ok !== true ||
      health.body?.service !== "symtype" ||
      health.body?.version !== MACOS_RELEASE.productVersion ||
      health.body?.integrity?.ok !== true ||
      health.body?.schemaVersion !== 10 ||
      health.body?.algorithmVersion !== "adaptive-v1"
    ) {
      throw new Error(`Packaged server health validation failed: ${JSON.stringify(health)}`);
    }

    child.stdin.end();
    const exit = await waitForChildExit(child, 10_000);
    if (!exit || exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `Packaged server did not exit gracefully after parent-pipe EOF: ${JSON.stringify(exit)}`
      );
    }
    completed = true;
    return {
      pid: info.pid,
      url: info.url,
      schemaVersion: health.body.schemaVersion,
      algorithmVersion: health.body.algorithmVersion,
      integrity: health.body.integrity.detail
    };
  } catch (error) {
    const captured = Buffer.concat(output).toString("utf8").trim();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${
        captured ? `\nPackaged server output:\n${captured}` : ""
      }`,
      { cause: error }
    );
  } finally {
    if (!completed && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const stopped = await waitForChildExit(child, 2_000);
      if (!stopped) {
        child.kill("SIGKILL");
        await waitForChildExit(child, 2_000);
      }
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

export async function auditApplication(appPath, options = {}) {
  const required = [
    join(appPath, "Contents", "MacOS", MACOS_RELEASE.productName),
    join(appPath, "Contents", "Helpers", "node"),
    join(appPath, "Contents", "Resources", "app", "server", "index.js"),
    join(appPath, "Contents", "Resources", "app", "web", "index.html"),
    join(appPath, "Contents", "Resources", "release-manifest.json")
  ];
  for (const path of required) {
    if (!(await pathExists(path))) {
      throw new Error(`Required application path is missing: ${path}`);
    }
  }

  await assertAppResourceAllowlist(join(appPath, "Contents", "Resources", "app"));
  const manifest = await verifyReleaseManifest(appPath);
  await assertInfoPlist(appPath, options.expectedBuildNumber ?? manifest.buildNumber);
  const machOFiles = await assertArm64MachO(appPath);
  await assertNoAbsoluteBuildPaths(appPath);

  if (!options.skipSignature) {
    await runCommand(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      { capture: true, quiet: true }
    );
    await assertNodeEntitlements(appPath);
  }
  await verifyEmbeddedNode(appPath);
  const serverSmoke = await smokePackagedServer(appPath);

  const bytes = await directorySize(appPath);
  if (bytes > MACOS_RELEASE.appSizeLimitBytes) {
    throw new Error(
      `${basename(appPath)} is ${(bytes / 1024 / 1024).toFixed(2)} MiB; the limit is 200 MiB`
    );
  }
  return {
    bytes,
    machOFiles: machOFiles.map((file) => relative(appPath, file)),
    serverSmoke
  };
}
