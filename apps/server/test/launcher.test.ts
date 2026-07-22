import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync
} from "node:fs";
import { delimiter, dirname, join, parse, resolve } from "node:path";
import { platform, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import { decideDependencyPlan } from "../../../scripts/launcher-state.mjs";

const projectRoot = resolve(import.meta.dirname, "../../..");
const launcherPath = join(projectRoot, "scripts", "start-local.mjs");
const knownNode24Path = "/opt/homebrew/Cellar/node/24.3.0/bin/node";
const temporaryDirectories: string[] = [];

function runtimeIsSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return (major === 22 && minor >= 12) || major === 24;
}

const supportedNodePath =
  process.env.SYMTYPE_TEST_SUPPORTED_NODE ??
  (existsSync(knownNode24Path)
    ? knownNode24Path
    : runtimeIsSupported(process.versions.node)
      ? process.execPath
      : undefined);

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `symtype-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function launcherEnvironment(dataDirectory: string, nodeExecutable = process.execPath) {
  const privateSentinel = "must-not-appear-in-launcher-log";
  return {
    ...process.env,
    CI: "true",
    PATH: `${dirname(nodeExecutable)}${delimiter}${process.env.PATH ?? ""}`,
    SYMTYPE_DATA_DIR: dataDirectory,
    SYMTYPE_LAUNCHER_PRIVATE_SENTINEL: privateSentinel,
    SYMTYPE_OPEN_BROWSER: "0"
  };
}

function runLauncher(options: {
  nodeExecutable?: string;
  args?: string[];
  cwd?: string;
  dataDirectory: string;
}) {
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  return spawnSync(nodeExecutable, [launcherPath, ...(options.args ?? [])], {
    cwd: options.cwd ?? projectRoot,
    encoding: "utf8",
    env: launcherEnvironment(options.dataDirectory, nodeExecutable),
    timeout: 15_000
  });
}

function currentRuntimeIsSupported(): boolean {
  return runtimeIsSupported(process.versions.node);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

describe("one-click launcher", () => {
  test.skipIf(!supportedNodePath || !existsSync(supportedNodePath))(
    "accepts a supported Node LTS, resolves its own project root, and keeps dry-run read-only",
    () => {
      if (!supportedNodePath) throw new Error("No supported Node executable is available");
      const fixtureRoot = temporaryDirectory("launcher-supported");
      const dataDirectory = join(fixtureRoot, "data");
      const result = runLauncher({
        args: ["--dry-run", "--no-open"],
        cwd: fixtureRoot,
        dataDirectory,
        nodeExecutable: supportedNodePath
      });

      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`项目目录：${projectRoot}`);
      expect(result.stdout).toContain("运行环境：Node ");
      expect(result.stdout).toContain("未安装、构建、迁移、启动或打开浏览器");

      const topLevelFiles = readdirSync(dataDirectory);
      expect(topLevelFiles).toEqual(["logs"]);
      const launcherLog = readFileSync(join(dataDirectory, "logs", "launcher.log"), "utf8");
      expect(launcherLog).not.toContain("must-not-appear-in-launcher-log");
      expect(existsSync(join(dataDirectory, "symtype.sqlite3"))).toBe(false);
      expect(existsSync(join(dataDirectory, "server-info.json"))).toBe(false);
      expect(existsSync(join(dataDirectory, "launcher.lock"))).toBe(false);
    }
  );

  test.skipIf(currentRuntimeIsSupported())("rejects an unsupported Node release clearly", () => {
    const fixtureRoot = temporaryDirectory("launcher-unsupported");
    const result = runLauncher({
      args: ["--dry-run", "--no-open"],
      dataDirectory: join(fixtureRoot, "data")
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "需要 Node.js 22 LTS（22.12 或更新）或 24 LTS"
    );
    expect(existsSync(join(fixtureRoot, "data", "symtype.sqlite3"))).toBe(false);
  });

  test.skipIf(platform() === "win32" || !supportedNodePath || !existsSync(supportedNodePath))(
    "POSIX wrappers launch relative to themselves instead of the caller directory",
    () => {
      if (!supportedNodePath) throw new Error("No supported Node executable is available");
      for (const wrapper of ["start.sh", "start.command"]) {
        const fixtureRoot = temporaryDirectory(`launcher-${wrapper.replace(".", "-")}`);
        const dataDirectory = join(fixtureRoot, "data");
        const result = spawnSync(join(projectRoot, wrapper), ["--dry-run", "--no-open"], {
          cwd: tmpdir(),
          encoding: "utf8",
          env: launcherEnvironment(dataDirectory, supportedNodePath),
          timeout: 15_000
        });

        expect(result.error).toBeUndefined();
        expect(result.status, `${wrapper}\n${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toContain(`项目目录：${projectRoot}`);
        expect(existsSync(join(dataDirectory, "symtype.sqlite3"))).toBe(false);
      }
    }
  );

  test("Windows wrapper anchors itself and preserves a readable failure path", () => {
    const wrapper = readFileSync(join(projectRoot, "start.bat"), "utf8");

    expect(wrapper).toContain('set "SYMTYPE_PROJECT_DIR=%~dp0"');
    expect(wrapper).toContain('cd /d "%SYMTYPE_PROJECT_DIR%"');
    expect(wrapper).toContain('node "%SYMTYPE_PROJECT_DIR%scripts\\start-local.mjs" %*');
    expect(wrapper).toContain("pause");
  });

  test("coordinator keeps production-environment installs buildable and verifies every output", () => {
    const coordinator = readFileSync(launcherPath, "utf8");
    const fullSmoke = readFileSync(join(projectRoot, "scripts", "launcher-full-smoke.mjs"), "utf8");

    expect(coordinator).toContain('["ci", "--include=dev", "--no-audit", "--no-fund"]');
    expect(coordinator).toContain("currentBuildOutputManifest");
    expect(coordinator).toContain("outputManifestIsCurrent");
    expect(coordinator).toContain("sha256: sha256File(path)");
    expect(fullSmoke).toContain('NODE_ENV: "production"');
    expect(fullSmoke).toContain('npm_config_omit: "dev"');
    expect(fullSmoke).toContain('"launcher-state.mjs"');
    expect(fullSmoke).toContain("unchanged offline restart");
    expect(fullSmoke).toContain("damaged-output rebuild");
  });

  test("dependency state rebuilds ABI-only changes and reinstalls platform changes", () => {
    const currentState = {
      lockHash: "lock-v1",
      nodeAbi: "137",
      platform: "darwin",
      architecture: "arm64"
    };
    const plan = (overrides: Partial<Parameters<typeof decideDependencyPlan>[0]> = {}) =>
      decideDependencyPlan({
        lockHash: "lock-v1",
        state: currentState,
        nodeModulesPresent: true,
        missingDependencies: [],
        nodeAbi: "137",
        runtimePlatform: "darwin",
        runtimeArchitecture: "arm64",
        ...overrides
      });

    expect(plan()).toEqual({
      action: "none",
      reason: "lockfile 与已安装依赖一致"
    });
    expect(plan({ nodeAbi: "138" })).toMatchObject({ action: "rebuild" });
    expect(plan({ runtimePlatform: "linux" })).toMatchObject({ action: "install" });
    expect(plan({ runtimeArchitecture: "x64" })).toMatchObject({ action: "install" });
    expect(plan({ nodeAbi: "138", runtimePlatform: "linux" })).toMatchObject({
      action: "install"
    });
  });

  test.skipIf(platform() === "win32")("POSIX entry points retain executable permissions", () => {
    for (const path of ["start.sh", "start.command", "scripts/start-local.mjs"]) {
      expect(statSync(join(projectRoot, path)).mode & 0o111, path).not.toBe(0);
    }
  });

  test("unknown arguments fail before install, build, migration, or server startup", () => {
    const fixtureRoot = temporaryDirectory("launcher-argument");
    const dataDirectory = join(fixtureRoot, "data");
    const result = runLauncher({ args: ["--launch-everything"], dataDirectory });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("无法识别的启动参数");
    expect(existsSync(dataDirectory)).toBe(false);
  });

  test("refuses to use a filesystem root as application data", () => {
    const result = runLauncher({
      args: ["--dry-run", "--no-open"],
      dataDirectory: parse(projectRoot).root
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("不能指向文件系统根目录");
  });

  test.skipIf(platform() === "win32")(
    "refuses an existing data-directory symlink that resolves to the filesystem root",
    () => {
      const fixtureRoot = temporaryDirectory("launcher-root-link");
      const dataDirectory = join(fixtureRoot, "root-link");
      symlinkSync(parse(projectRoot).root, dataDirectory);
      const result = runLauncher({ args: ["--dry-run", "--no-open"], dataDirectory });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("不能指向文件系统根目录");
    }
  );
});
