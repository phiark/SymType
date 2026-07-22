import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

export function readViteManifest(webDist) {
  const path = join(webDist, ".vite/manifest.json");
  if (!existsSync(path)) throw new Error(`Vite manifest not found: ${path}`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (!manifest || typeof manifest !== "object") throw new Error("Vite manifest is not an object.");
  return manifest;
}

export function findManifestKey(manifest, source) {
  const normalized = source.replaceAll("\\", "/");
  const match = Object.entries(manifest).find(
    ([key, entry]) =>
      key.replaceAll("\\", "/").endsWith(normalized) ||
      entry.src?.replaceAll("\\", "/").endsWith(normalized)
  );
  if (!match) throw new Error(`Manifest has no entry for ${source}.`);
  return match[0];
}

export function staticEntryClosure(manifest, roots) {
  const pending = [...roots];
  const seen = new Set();
  while (pending.length > 0) {
    const key = pending.shift();
    if (!key || seen.has(key)) continue;
    const entry = manifest[key];
    if (!entry) throw new Error(`Manifest import is missing: ${key}.`);
    seen.add(key);
    pending.push(...(entry.imports ?? []));
  }
  return [...seen].sort();
}

export function filesForEntries(manifest, entryKeys) {
  const javascript = new Set();
  const css = new Set();
  const assets = new Set();
  for (const key of entryKeys) {
    const entry = manifest[key];
    if (!entry) continue;
    if (entry.file) javascript.add(entry.file);
    for (const path of entry.css ?? []) css.add(path);
    for (const path of entry.assets ?? []) assets.add(path);
  }
  return {
    javascript: [...javascript].sort(),
    css: [...css].sort(),
    assets: [...assets].sort()
  };
}

export function measureFiles(webDist, paths) {
  return paths.map((path) => {
    const absolutePath = resolve(webDist, path);
    const bytes = readFileSync(absolutePath);
    return {
      path,
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  });
}

export function sumFileMeasurements(records) {
  return records.reduce(
    (total, record) => ({
      rawBytes: total.rawBytes + record.rawBytes,
      gzipBytes: total.gzipBytes + record.gzipBytes
    }),
    { rawBytes: 0, gzipBytes: 0 }
  );
}

export function sourceModulesForFiles(webDist, javascriptPaths) {
  const byFile = {};
  for (const path of javascriptPaths) {
    const mapPath = resolve(webDist, `${path}.map`);
    if (!existsSync(mapPath)) {
      byFile[path] = [];
      continue;
    }
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    byFile[path] = [...new Set(map.sources ?? [])].sort();
  }
  return byFile;
}

export function forbiddenFirstRouteModules(modulesByFile) {
  const chart = new Map();
  const game = new Map();
  for (const [file, modules] of Object.entries(modulesByFile)) {
    for (const source of modules) {
      const normalized = source.replaceAll("\\", "/").toLowerCase();
      if (normalized.includes("/recharts/") || normalized.includes("/areachart.")) {
        chart.set(file, [...(chart.get(file) ?? []), source]);
      }
      if (normalized.includes("/pages/gamepage.") || normalized.includes("/game-state.")) {
        game.set(file, [...(game.get(file) ?? []), source]);
      }
    }
  }
  const groupedChart = groupedModuleFindings(chart);
  const groupedGame = groupedModuleFindings(game);
  return {
    chart: groupedChart,
    game: groupedGame,
    pass: groupedChart.length === 0 && groupedGame.length === 0
  };
}

function groupedModuleFindings(files) {
  return [...files.entries()].map(([file, sources]) => ({
    file,
    moduleCount: sources.length,
    sampleSources: sources.slice(0, 10)
  }));
}

export function scanRemoteFindings(webDist) {
  const findings = { remoteFonts: [], probableRequests: [], urlLiterals: [] };
  for (const path of walkFiles(webDist)) {
    if (!/\.(?:css|html|js)$/u.test(path)) continue;
    const relativePath = relative(webDist, path).replaceAll("\\", "/");
    const text = readFileSync(path, "utf8");
    const urls = [...text.matchAll(/https?:\/\/[^\s"'`)<]+/gu)].map((match) => match[0]);
    for (const url of [...new Set(urls)].sort())
      findings.urlLiterals.push({ file: relativePath, url });
    for (const match of text.matchAll(/(?:fetch|import)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/gu)) {
      findings.probableRequests.push({ file: relativePath, url: match[1] });
    }
    if (path.endsWith(".css")) {
      for (const match of text.matchAll(/(?:@import|src\s*:)[^;]*(https?:\/\/[^\s"')]+)/gu)) {
        findings.remoteFonts.push({ file: relativePath, url: match[1] });
      }
    }
    if (path.endsWith(".html")) {
      for (const match of text.matchAll(
        /<(?:script|link)[^>]+(?:src|href)=["'](https?:\/\/[^"']+)/gu
      )) {
        findings.probableRequests.push({ file: relativePath, url: match[1] });
      }
    }
  }
  return findings;
}

export function sourceMapInventory(webDist) {
  const maps = walkFiles(webDist).filter((path) => path.endsWith(".map"));
  return {
    policy:
      maps.length > 0 ? "public production source maps are present" : "no production source maps",
    count: maps.length,
    totalBytes: maps.reduce((sum, path) => sum + statSync(path).size, 0),
    files: maps.map((path) => relative(webDist, path).replaceAll("\\", "/")).sort()
  };
}

function walkFiles(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, result);
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
