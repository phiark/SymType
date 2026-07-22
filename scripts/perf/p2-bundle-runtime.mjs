/* global URL, fetch, process */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

import {
  filesForEntries,
  findManifestKey,
  forbiddenFirstRouteModules,
  sourceModulesForFiles,
  staticEntryClosure
} from "./p2-bundle-graph.mjs";
import {
  createTrialDataDirectory,
  projectRoot,
  removeTrialDirectory,
  startProductionServer,
  stopOwnedProcess
} from "./p2-process.mjs";

export function runCleanProductionBuild() {
  const npmExecutable = join(
    dirname(process.execPath),
    process.platform === "win32" ? "npm.cmd" : "npm"
  );
  const commands = [
    ["run", "build", "-w", "@symtype/shared"],
    ["run", "build", "-w", "@symtype/content"],
    ["run", "build", "-w", "@symtype/web", "--", "--manifest"],
    ["run", "build", "-w", "@symtype/server"]
  ];
  const startedAt = new Date().toISOString();
  for (const args of commands) {
    const result = spawnSync(npmExecutable, args, {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error(`npm ${args.join(" ")} failed.\n${result.stdout}\n${result.stderr}`);
    }
  }
  return { clean: true, startedAt, completedAt: new Date().toISOString(), commands };
}

export function manifestGraph(manifest) {
  return Object.fromEntries(
    Object.entries(manifest)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        {
          file: entry.file,
          src: entry.src ?? null,
          isEntry: entry.isEntry === true,
          isDynamicEntry: entry.isDynamicEntry === true,
          imports: [...(entry.imports ?? [])].sort(),
          dynamicImports: [...(entry.dynamicImports ?? [])].sort(),
          css: [...(entry.css ?? [])].sort(),
          assets: [...(entry.assets ?? [])].sort()
        }
      ])
  );
}

export function duplicateModules(modulesByFile) {
  const filesByModule = new Map();
  for (const [file, modules] of Object.entries(modulesByFile)) {
    for (const source of modules) {
      const files = filesByModule.get(source) ?? [];
      files.push(file);
      filesByModule.set(source, files);
    }
  }
  return [...filesByModule.entries()]
    .filter(([, files]) => new Set(files).size > 1)
    .map(([source, files]) => ({ source, files: [...new Set(files)].sort() }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

export async function measureLocalTransfer(files) {
  const trial = createTrialDataDirectory("bundle-transfer");
  let server;
  let result;
  let operationError;
  try {
    server = await startProductionServer({ dataDir: trial.dataDir });
    const paths = [
      "/train/session",
      ...[...files.javascript, ...files.css, ...files.assets].map((path) => `/${path}`)
    ];
    const requests = [];
    for (const path of paths) requests.push(await transferRequest(server.url, path));
    result = {
      bytes: requests.reduce((sum, request) => sum + request.transferBytes, 0),
      requests
    };
  } catch (error) {
    operationError = error;
  }
  const cleanup = server ? await stopOwnedProcess(server.child) : null;
  removeTrialDirectory(trial.trialRoot);
  if (operationError) throw operationError;
  if (cleanup && !cleanup.graceful)
    throw new Error("Transfer probe server did not stop gracefully.");
  return result;
}

async function transferRequest(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { "accept-encoding": "br, gzip" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Transfer probe failed for ${path}: ${response.status}`);
  const decodedBytes = (await response.arrayBuffer()).byteLength;
  const contentLength = Number(response.headers.get("content-length"));
  return {
    path,
    contentEncoding: response.headers.get("content-encoding") ?? "identity",
    decodedBytes,
    transferBytes:
      Number.isFinite(contentLength) && contentLength > 0 ? contentLength : decodedBytes
  };
}

export function routeEvidence(manifest, webDist) {
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry === true);
  if (!entryKey) throw new Error("Vite manifest has no application entry.");
  const practiceKey = findManifestKey(manifest, "src/pages/PracticePage.tsx");
  const todayKey = findManifestKey(manifest, "src/pages/TodayPage.tsx");
  const practiceEntries = staticEntryClosure(manifest, [entryKey, practiceKey]);
  const entryEntries = staticEntryClosure(manifest, [entryKey]);
  const firstEntries = staticEntryClosure(manifest, [entryKey, todayKey]);
  const entryFiles = filesForEntries(manifest, entryEntries);
  const practiceFiles = filesForEntries(manifest, practiceEntries);
  const firstFiles = filesForEntries(manifest, firstEntries);
  const firstModules = sourceModulesForFiles(webDist, firstFiles.javascript);
  return {
    entryKey,
    practiceKey,
    todayKey,
    practiceEntries,
    entryEntries,
    firstEntries,
    entryFiles,
    practiceFiles,
    firstFiles,
    firstModules,
    exclusion: forbiddenFirstRouteModules(firstModules)
  };
}
