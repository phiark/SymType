/* global console, performance, process */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import { summarizeSamples } from "./lib/index.js";
import {
  copyFixtureDatabase,
  createTrialDataDirectory,
  projectRoot,
  removeTrialDirectory,
  selectLoopbackPort,
  spawnOwnedProcess,
  startProductionServer,
  stopOwnedProcess,
  supportedRuntimeEnvironment,
  waitForHealthyServer
} from "./p2-process.mjs";

const LAUNCHER_PATH = join(projectRoot, "scripts/start-local.mjs");

function resetBackupState(dataDir) {
  const databasePath = join(dataDir, "symtype.sqlite3");
  if (existsSync(databasePath)) {
    const database = new Database(databasePath);
    try {
      const table = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backups'")
        .get();
      if (table) database.prepare("DELETE FROM backups").run();
    } finally {
      database.close();
    }
  }
  rmSync(join(dataDir, "backups"), { recursive: true, force: true });
  mkdirSync(join(dataDir, "backups"), { recursive: true });
}

function backupSnapshot(dataDir) {
  const databasePath = join(dataDir, "symtype.sqlite3");
  if (!existsSync(databasePath)) return [];
  const database = new Database(databasePath, { readonly: true });
  try {
    const table = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backups'")
      .get();
    if (!table) return [];
    return database
      .prepare(
        "SELECT id, path, checksum, byte_size AS byteSize FROM backups WHERE reason = ? ORDER BY id"
      )
      .all("automatic-startup")
      .map((row) => ({ ...row, fileExists: existsSync(row.path) }));
  } finally {
    database.close();
  }
}

async function prepareTrial(label, backupState, options) {
  const trial = createTrialDataDirectory(label);
  copyFixtureDatabase(options.fixture, trial.dataDir);
  resetBackupState(trial.dataDir);
  if (backupState !== "cached-backup") return trial;
  const warm = await startProductionServer({
    dataDir: trial.dataDir,
    timeoutMs: options.timeoutMs
  });
  const cleanup = await stopOwnedProcess(warm.child);
  const cached = backupSnapshot(trial.dataDir);
  if (!cleanup.graceful || cached.length !== 1 || !cached[0].fileExists) {
    removeTrialDirectory(trial.trialRoot);
    throw new Error("Warmup did not create one verified same-day automatic backup.");
  }
  return trial;
}

function validBackupTransition(state, before, after) {
  if (after.length !== 1 || !after[0].fileExists) return false;
  return state === "first-backup"
    ? before.length === 0
    : before.length === 1 && before[0].id === after[0].id;
}

async function directTrial(state, index, options) {
  const trial = await prepareTrial(`direct-${state}-${index}`, state, options);
  try {
    const before = backupSnapshot(trial.dataDir);
    const server = await startProductionServer({
      dataDir: trial.dataDir,
      timeoutMs: options.timeoutMs
    });
    const cleanup = await stopOwnedProcess(server.child);
    if (!cleanup.graceful || !validBackupTransition(state, before, backupSnapshot(trial.dataDir))) {
      throw new Error(`Direct ${state} trial failed cleanup or backup validation.`);
    }
    return { readyMs: server.readyMs, shutdownMs: cleanup.shutdownMs };
  } finally {
    removeTrialDirectory(trial.trialRoot);
  }
}

async function launcherTrial(state, index, options, verifyCache = true) {
  const trial = await prepareTrial(`launcher-${state}-${index}`, state, options);
  try {
    const before = backupSnapshot(trial.dataDir);
    const port = await selectLoopbackPort();
    const startedAt = performance.now();
    const owned = spawnOwnedProcess(process.execPath, [LAUNCHER_PATH, "--no-open"], {
      env: supportedRuntimeEnvironment({
        CI: "true",
        NODE_ENV: "production",
        SYMTYPE_DATA_DIR: trial.dataDir,
        SYMTYPE_PORT: String(port),
        SYMTYPE_LOG_LEVEL: "silent"
      })
    });
    const ready = await waitForHealthyServer(
      trial.dataDir,
      owned.child,
      startedAt,
      options.timeoutMs
    );
    const cleanup = await stopOwnedProcess(owned.child);
    const output = `${owned.output.stdout}\n${owned.output.stderr}\n${readLauncherLog(trial.dataDir)}`;
    const cacheValid = launcherCacheIsValid(output);
    if (!cleanup.graceful || !validBackupTransition(state, before, backupSnapshot(trial.dataDir))) {
      throw new Error(`Launcher ${state} trial failed cleanup or backup validation.`);
    }
    if (verifyCache && !cacheValid)
      throw new Error("A measured launcher trial used an invalid cache state.");
    return { readyMs: ready.readyMs, shutdownMs: cleanup.shutdownMs, cacheValid };
  } finally {
    removeTrialDirectory(trial.trialRoot);
  }
}

function readLauncherLog(dataDir) {
  const path = join(dataDir, "logs/launcher.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function launcherCacheIsValid(output) {
  return (
    output.includes("lockfile 与已安装依赖一致") &&
    output.includes("生产产物与当前源码指纹一致") &&
    !output.includes("安装锁定依赖：npm") &&
    !output.includes("构建生产版本：npm")
  );
}

async function measure(label, runner, options, scenarios) {
  const combined = [];
  for (const state of ["first-backup", "cached-backup"]) {
    const readiness = [];
    const shutdown = [];
    for (let index = 0; index < options.samples; index += 1) {
      const result = await runner(state, index, options);
      readiness.push(result.readyMs);
      shutdown.push(result.shutdownMs);
      console.log(
        `${label} ${state} ${index + 1}/${options.samples}: ${result.readyMs.toFixed(2)} ms`
      );
    }
    combined.push(...readiness);
    scenarios[label][state] = {
      readiness: summarizeSamples(readiness),
      gracefulShutdown: summarizeSamples(shutdown)
    };
  }
  return summarizeSamples(combined);
}

export async function measureStartupScenarios(options) {
  const scenarios = { directServer: {}, launcherAppWork: {} };
  await launcherTrial("cached-backup", "cache-prime", options, false);
  const health = await measure("directServer", directTrial, options, scenarios);
  const appWork = await measure("launcherAppWork", launcherTrial, options, scenarios);
  return { health, appWork, scenarios };
}
